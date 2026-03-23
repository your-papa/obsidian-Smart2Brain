<script lang="ts">
import { untrack } from "svelte";
import { getAllTags, Notice } from "obsidian";
import { HumanMessage } from "@langchain/core/messages";
import { getPlugin } from "../../stores/state.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getRegistry } from "../../providers/registry";
import type { ChatModelConfig } from "../../providers/index";
import { Logger } from "../../utils/logging";
import { getVectorStoreService, isVectorStoreInitialized, waitForVectorStoreIndex } from "../../vectorstore";
import {
	type GraphData,
	type GraphEdge,
	type LayoutMode,
	type ColorMode,
	type SmartGraphSettings,
	DEFAULT_SMART_GRAPH_SETTINGS,
	THEME_COLOR_VARS,
} from "../../types/graph";
import {
	buildWikiGraph,
	filterDocuments,
	getProjectionPlan,
	overlayWikiEdges,
	computeWikiDegree,
	createGraphNodes,
	computeClusters,
	applyClusterMap,
	applyColorGroups,
	applySearchHighlight,
	deriveClusterLabelsFromGraph,
	type GraphFilter,
	type ClusterAssignment,
	type GraphStructureResult,
} from "../../views/smart-graph/graphDataBuilder";
import {
	smartGraphCache,
	documentsKey,
	filteredKey,
	reducedKey,
	projectionKey,
} from "../../views/smart-graph/graphCache";
import { reduceDimensionsAsync, project2DAsync } from "../../utils/computeWorkerManager";
import type { DocumentVector } from "../../vectorstore/types";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";
import { VIEW_TYPE_SMART_GRAPH } from "../../views/smart-graph/SmartGraphView";
import { getMessenger } from "../../stores/chatStore.svelte";
import LoadingAnimation from "../ui/LoadingAnimation.svelte";
import Button from "../ui/Button.svelte";
import GraphCanvas from "./GraphCanvas.svelte";
import GraphControls from "./GraphControls.svelte";
import GraphInspector from "./GraphInspector.svelte";

const plugin = getPlugin();
const data = getData();

// Graph state
let settings: SmartGraphSettings = $derived({
	...DEFAULT_SMART_GRAPH_SETTINGS,
	...(data.smartGraphSettings ?? {}),
});
let graphData: GraphData = $state({ nodes: [], edges: [] });
/** Derived layout mode from persisted settings. */
let layoutMode: LayoutMode = $derived(settings.layoutMode);
/** Derived color mode from persisted settings. */
let colorMode: ColorMode = $derived(settings.colorMode);
let isLoading = $state(false);
let loadingMessage = $state("Building graph...");
let suggestedK: number | null = $state(null);
let defaultClusterLabels: Record<number, string> = $state({});
let clusterLabels: Record<number, string> = $state({});
let isLabeling = $state(false);

// Cluster state — persisted across edge/layout rebuilds
let clusterMap: Map<string, ClusterAssignment> = $state(new Map());

// Filter state
let selectedFolders: string[] = $state([]);
let selectedTags: string[] = $state([]);
let searchQuery = $state("");
let displayData: GraphData = $derived(searchQuery ? applySearchHighlight(graphData, searchQuery) : graphData);

// Available filters
let availableFolders: string[] = $state([]);
let availableTags: string[] = $state([]);

// Canvas ref
let canvasComponent: GraphCanvas | undefined = $state(undefined);

// Lasso / selection state
let lassoMode = $state(false);
let selectedPaths: string[] = $state([]);
let focusedClusters: Set<number> = $state(new Set());

// Inspector panel state
let inspectorOpen = $state(false);
let hasActiveFilters = $derived(selectedFolders.length > 0 || selectedTags.length > 0 || searchQuery.length > 0);

let effectiveClusterLabels: Record<number, string> = $derived({
	...defaultClusterLabels,
	...clusterLabels,
});

/** Cluster entries for the inspector legend (cluster id → color, label, count). */
let clusterLegendEntries = $derived.by(() => {
	const map = new Map<number, { color: string; count: number }>();
	for (const node of graphData.nodes) {
		if (node.cluster == null) continue;
		const existing = map.get(node.cluster);
		if (existing) {
			existing.count++;
		} else {
			map.set(node.cluster, { color: node.color ?? "", count: 1 });
		}
	}
	return [...map.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([cluster, { color, count }]) => ({
			cluster,
			color,
			label: effectiveClusterLabels[cluster] ?? `Cluster ${cluster}`,
			count,
		}));
});

let focusedClusterDetails = $derived.by(() => {
	if (focusedClusters.size === 0) return [];

	return [...focusedClusters]
		.sort((left, right) => left - right)
		.map((clusterId) => {
			const nodes = graphData.nodes.filter((node) => node.cluster === clusterId);
			const topNotes = [...nodes]
				.sort((left, right) => {
					const degreeDiff = (right.degree ?? 0) - (left.degree ?? 0);
					if (degreeDiff !== 0) return degreeDiff;
					return left.label.localeCompare(right.label);
				})
				.slice(0, 5)
				.map((node) => ({
					path: node.path,
					label: node.label,
					degree: node.degree ?? 0,
				}));

			return {
				cluster: clusterId,
				label: effectiveClusterLabels[clusterId] ?? `Cluster ${clusterId}`,
				noteCount: nodes.length,
				topNotes,
			};
		})
		.filter((cluster) => cluster.noteCount > 0);
});

// Build generation counter to discard stale async results
let buildGeneration = 0;
let lastAutoRebuildSignature: string | null = null;

function formatCount(count: number): string {
	return new Intl.NumberFormat().format(count);
}

function setLoadingStage(message: string): void {
	loadingMessage = message;
}

function logGraphPhase(phase: string, start: number, noteCount?: number): void {
	const durationMs = Math.round(performance.now() - start);
	const suffix = noteCount == null ? "" : ` (${formatCount(noteCount)} notes)`;
	Logger.info(`[SmartGraph] ${phase}${suffix}: ${durationMs}ms`);
}

function getFilter(): GraphFilter {
	return {
		folders: selectedFolders.length > 0 ? selectedFolders : undefined,
		tags: selectedTags.length > 0 ? selectedTags : undefined,
		searchQuery: searchQuery || undefined,
	};
}

function createAutoRebuildSignature(layout: LayoutMode, color: ColorMode, filter: GraphFilter): string {
	return JSON.stringify({
		layoutMode: layout,
		colorMode: color,
		folders: [...(filter.folders ?? [])].sort(),
		tags: [...(filter.tags ?? [])].sort(),
		colorGroups:
			color === "groups" ? settings.colorGroups.map((group) => ({ query: group.query, color: group.color })) : [],
		showWikiLinks: layout === "semantic" ? settings.showWikiLinks : true,
	});
}

/** Resolve the current theme colour palette from CSS variables. */
function resolveThemeColors(): string[] {
	const style = getComputedStyle(document.body);
	return THEME_COLOR_VARS.map((v) => style.getPropertyValue(v).trim()).filter(Boolean);
}

/**
 * Gather available folder and tag options from the vault.
 */
function loadFilterOptions() {
	// Folders: Get unique top-level and second-level folders
	const folders = new Set<string>();
	for (const file of plugin.app.vault.getMarkdownFiles()) {
		const parts = file.path.split("/");
		if (parts.length > 1) {
			folders.add(parts[0]);
			if (parts.length > 2) {
				folders.add(`${parts[0]}/${parts[1]}`);
			}
		}
	}
	availableFolders = [...folders].sort();

	// Tags: Get all unique tags from the vault
	const tags = new Set<string>();
	for (const file of plugin.app.vault.getMarkdownFiles()) {
		const cache = plugin.app.metadataCache.getFileCache(file);
		if (cache) {
			const fileTags = getAllTags(cache) ?? [];
			for (const tag of fileTags) {
				tags.add(tag);
			}
		}
	}
	availableTags = [...tags].sort();
}

/**
 * Build the graph structure (edges, positions, degree) and apply cluster
 * assignments. Clusters are only recomputed when the document set changes
 * (e.g. filter change) or on the very first build. Otherwise the existing
 * clusterMap is reused so that adjusting edge/layout settings keeps stable
 * cluster colours.
 */
/**
 * Ensure that the raw document vectors are loaded into the cache (Layer 1).
 * Returns the documents array, or null if the index isn't available.
 * Both `ensureClusterMap` and `buildForceLayoutGraph` use this to guarantee
 * the document cache is populated before constraining the node set.
 */
async function ensureDocumentsLoaded(gen: number): Promise<DocumentVector[] | null> {
	const indexId = data.graphEmbedIndex;
	const configuredIndexCount = indexId ? (data.getEmbeddingIndex(indexId)?.documentCount ?? null) : null;

	const docKey = documentsKey(indexId, configuredIndexCount ?? 0);
	let documents = smartGraphCache.getDocuments(docKey);

	if (!documents) {
		if (!isVectorStoreInitialized()) return null;
		setLoadingStage("Initializing vector index...");
		const ready = await waitForVectorStoreIndex(indexId);
		if (!ready) return null;

		const vectorService = getVectorStoreService();
		setLoadingStage("Loading vectors from disk...");
		documents = await vectorService.getAllDocumentVectors();
		if (gen !== buildGeneration || documents.length === 0) return null;
		smartGraphCache.setDocuments(docKey, documents);
	}

	return documents;
}

/**
 * Load embeddings from the cache / IndexedDB and compute clusters.
 * Shared by both force and semantic layout paths when colorMode is "clusters".
 * Returns the active cluster map, or null if vectors aren't available.
 */
async function ensureClusterMap(
	gen: number,
	filter: GraphFilter,
): Promise<{ activeClusterMap: Map<string, ClusterAssignment>; shouldAutoLabel: boolean } | null> {
	const documents = await ensureDocumentsLoaded(gen);
	if (!documents) return null;

	const indexId = data.graphEmbedIndex;
	const configuredIndexCount = indexId ? (data.getEmbeddingIndex(indexId)?.documentCount ?? null) : null;
	const docKey = documentsKey(indexId, configuredIndexCount ?? 0);

	// ── Layer 2: Filtered documents + extracted vectors ──────────────
	const filterK = filteredKey(docKey, filter.folders, filter.tags);
	let filteredResult = smartGraphCache.getFiltered(filterK);

	if (!filteredResult) {
		const filtered = filterDocuments(plugin.app, documents, filter);
		if (filtered.length === 0) return null;
		const vectors = filtered.map((doc) => doc.vector);
		smartGraphCache.setFiltered(filterK, filtered, vectors);
		filteredResult = smartGraphCache.getFiltered(filterK)!;
	}

	const { filteredDocs, vectors } = filteredResult;
	if (gen !== buildGeneration) return null;

	// ── Layer 3: PCA-reduced vectors (needed by some clustering algs) ─
	const plan = getProjectionPlan(filteredDocs.length, settings);
	const reducK = reducedKey(filterK, plan.reductionDim);
	let reducedVectors = smartGraphCache.getReduced(reducK);

	if (!reducedVectors) {
		setLoadingStage(`Reducing ${formatCount(filteredDocs.length)} vectors...`);
		reducedVectors = await reduceDimensionsAsync(vectors, "pca", plan.reductionDim);
		if (gen !== buildGeneration) return null;
		smartGraphCache.setReduced(reducK, reducedVectors);
	}

	// ── Clustering ───────────────────────────────────────────────────
	const cachedPathSetKey = smartGraphCache.getFilteredPathSetKey();
	const currentPathSetKey = filteredDocs
		.map((d) => d.path)
		.slice()
		.sort()
		.join("\0");
	const docSetChanged = clusterMap.size === 0 || cachedPathSetKey == null || currentPathSetKey !== cachedPathSetKey;

	let activeClusterMap = clusterMap;
	let shouldAutoLabel = false;
	if (docSetChanged) {
		const themeColors = resolveThemeColors();
		setLoadingStage(`Clustering ${formatCount(filteredDocs.length)} notes...`);
		const clusteringStart = performance.now();
		const result = await computeClusters(filteredDocs, vectors, settings, themeColors, reducedVectors);
		logGraphPhase("Clustering", clusteringStart, filteredDocs.length);

		if (gen !== buildGeneration) return null;

		clusterMap = result.clusterMap;
		activeClusterMap = result.clusterMap;
		suggestedK = settings.autoK ? result.k : null;
		clusterLabels = {};
		shouldAutoLabel = settings.autoLabelClusters && !!settings.graphChatModel;
	}

	return { activeClusterMap, shouldAutoLabel };
}

async function buildForceLayoutGraph(
	gen: number,
	filter: GraphFilter,
	activeColorMode: ColorMode,
): Promise<{ graphData: GraphData; shouldAutoLabel: boolean }> {
	// Always load the indexed documents so the force graph is constrained to
	// the same set of embedded files as the semantic graph. Without this,
	// un-indexed vault notes would appear in force mode but not in semantic.
	await ensureDocumentsLoaded(gen);
	const embeddedPaths = smartGraphCache.getDocumentPaths();
	const { graphData: wikiGraphData } = buildWikiGraph(plugin.app, filter, embeddedPaths ?? undefined);

	if (activeColorMode === "groups") {
		return { graphData: applyColorGroups(plugin.app, wikiGraphData, settings.colorGroups), shouldAutoLabel: false };
	}

	if (activeColorMode === "clusters") {
		const clusterResult = await ensureClusterMap(gen, filter);
		if (clusterResult) {
			const coloredGraph = applyClusterMap(wikiGraphData, clusterResult.activeClusterMap);
			defaultClusterLabels = deriveClusterLabelsFromGraph(coloredGraph);
			return { graphData: coloredGraph, shouldAutoLabel: clusterResult.shouldAutoLabel };
		}
		// Fall through — vectors not available, return uncolored graph
		new Notice("Cluster coloring requires indexed embeddings. Showing uncolored graph.");
	}

	return { graphData: wikiGraphData, shouldAutoLabel: false };
}

async function buildSemanticLayoutGraph(
	gen: number,
	filter: GraphFilter,
	activeColorMode: ColorMode,
): Promise<{
	graphData: GraphData;
	shouldAutoLabel: boolean;
}> {
	const EMPTY = { graphData: { nodes: [], edges: [] } as GraphData, shouldAutoLabel: false };

	// ── Layer 1: Raw document vectors (shared loader) ────────────────
	const documents = await ensureDocumentsLoaded(gen);
	if (!documents) return EMPTY;

	const indexId = data.graphEmbedIndex;
	const configuredIndexCount = indexId ? (data.getEmbeddingIndex(indexId)?.documentCount ?? null) : null;
	const docKey = documentsKey(indexId, configuredIndexCount ?? 0);

	// ── Layer 2: Filtered documents + extracted vectors ──────────────
	const filterK = filteredKey(docKey, filter.folders, filter.tags);
	let filteredResult = smartGraphCache.getFiltered(filterK);

	if (!filteredResult) {
		const filtered = filterDocuments(plugin.app, documents, filter);
		if (filtered.length === 0) return EMPTY;
		const vectors = filtered.map((doc) => doc.vector);
		smartGraphCache.setFiltered(filterK, filtered, vectors);
		filteredResult = smartGraphCache.getFiltered(filterK)!;
		Logger.info(`[SmartGraphCache] Filtered cached (${formatCount(filtered.length)} docs)`);
	} else {
		Logger.info(`[SmartGraphCache] Filtered HIT (${formatCount(filteredResult.filteredDocs.length)} docs)`);
	}

	const { filteredDocs, vectors } = filteredResult;
	if (gen !== buildGeneration) return EMPTY;

	// ── Layer 3: PCA-reduced vectors ─────────────────────────────────
	const plan = getProjectionPlan(filteredDocs.length, settings);
	const reducK = reducedKey(filterK, plan.reductionDim);
	let reducedVectors = smartGraphCache.getReduced(reducK);

	if (!reducedVectors) {
		setLoadingStage(`Reducing ${formatCount(filteredDocs.length)} vectors...`);
		const reductionStart = performance.now();
		reducedVectors = await reduceDimensionsAsync(vectors, "pca", plan.reductionDim);
		const reductionMs = performance.now() - reductionStart;
		Logger.info(
			`[SmartGraph] Vector reduction (${formatCount(filteredDocs.length)} notes): ${Math.round(reductionMs)}ms`,
		);

		if (gen !== buildGeneration) return EMPTY;
		smartGraphCache.setReduced(reducK, reducedVectors);
		Logger.info("[SmartGraphCache] Reduced vectors cached");
	} else {
		Logger.info("[SmartGraphCache] Reduced vectors HIT");
	}

	// ── Layer 4: 2D projection + graph assembly ──────────────────────
	const projK = projectionKey(
		reducK,
		settings.projectionMethod,
		plan.umapNeighbors ?? settings.umapNeighbors,
		settings.umapMinDist,
		plan.umapEpochs,
	);
	let structureResult = smartGraphCache.getProjection(projK);

	if (!structureResult) {
		setLoadingStage(`Projecting ${formatCount(filteredDocs.length)} notes into 2D...`);
		const projection2DStart = performance.now();
		const positions = await project2DAsync(reducedVectors, settings.projectionMethod, undefined, {
			nNeighbors: plan.umapNeighbors ?? settings.umapNeighbors,
			minDist: settings.umapMinDist,
			nEpochs: plan.umapEpochs,
		});
		const projection2DMs = performance.now() - projection2DStart;
		Logger.info(
			`[SmartGraph] 2D projection (${formatCount(filteredDocs.length)} notes): ${Math.round(projection2DMs)}ms`,
		);

		if (gen !== buildGeneration) return EMPTY;

		// Build graph from projected positions
		const filteredPathSet = new Set(filteredDocs.map((d) => d.path));
		const edges: GraphEdge[] = [];
		overlayWikiEdges(plugin.app, edges, filteredPathSet);
		const degreeMap = computeWikiDegree(edges);
		const nodes = createGraphNodes(filteredDocs, positions, degreeMap);
		const nodeIds = new Set(nodes.map((n) => n.id));
		const filteredEdges = settings.showWikiLinks
			? edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
			: [];

		structureResult = {
			graphData: { nodes, edges: filteredEdges },
			filteredDocs,
			vectors,
			reducedVectors,
			reductionMs: 0,
			projection2DMs,
		};
		smartGraphCache.setProjection(projK, structureResult);
		Logger.info("[SmartGraphCache] Projection cached");
	} else {
		Logger.info("[SmartGraphCache] Projection HIT");
		// showWikiLinks may have changed — rebuild edges from cached positions
		const filteredPathSet = new Set(filteredDocs.map((d) => d.path));
		const edges: GraphEdge[] = [];
		overlayWikiEdges(plugin.app, edges, filteredPathSet);
		const degreeMap = computeWikiDegree(edges);
		const nodes = structureResult.graphData.nodes.map((n) => ({
			...n,
			degree: degreeMap.get(n.id) ?? 0,
		}));
		const nodeIds = new Set(nodes.map((n) => n.id));
		const filteredEdges = settings.showWikiLinks
			? edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
			: [];
		structureResult = {
			...structureResult,
			graphData: { nodes, edges: filteredEdges },
		};
	}

	const { graphData: rawGraph } = structureResult;

	// Apply coloring based on the active color mode
	let coloredGraph: GraphData;
	let shouldAutoLabel = false;
	if (activeColorMode === "clusters") {
		const clusterResult = await ensureClusterMap(gen, filter);
		if (clusterResult) {
			coloredGraph = applyClusterMap(rawGraph, clusterResult.activeClusterMap);
			defaultClusterLabels = deriveClusterLabelsFromGraph(coloredGraph);
			shouldAutoLabel = clusterResult.shouldAutoLabel;
		} else {
			coloredGraph = rawGraph;
			defaultClusterLabels = {};
		}
	} else if (activeColorMode === "groups") {
		coloredGraph = applyColorGroups(plugin.app, rawGraph, settings.colorGroups);
		defaultClusterLabels = {};
	} else {
		// "none"
		coloredGraph = rawGraph;
		defaultClusterLabels = {};
	}

	return {
		graphData: coloredGraph,
		shouldAutoLabel,
	};
}

async function rebuildGraph(targetLayout: LayoutMode = layoutMode, targetColor: ColorMode = colorMode) {
	const gen = ++buildGeneration;
	isLoading = true;
	const buildStart = performance.now();
	setLoadingStage(targetLayout === "force" ? "Building wiki graph..." : "Preparing smart graph...");
	const filter = getFilter();
	lastAutoRebuildSignature = createAutoRebuildSignature(targetLayout, targetColor, filter);

	try {
		if (targetLayout === "force") {
			const { graphData: nextGraphData, shouldAutoLabel } = await buildForceLayoutGraph(gen, filter, targetColor);
			logGraphPhase("Force layout build", buildStart, nextGraphData.nodes.length);
			if (gen !== buildGeneration) return;
			graphData = nextGraphData;

			if (shouldAutoLabel) {
				void handleLabelClusters(nextGraphData, gen);
			}
			return;
		}

		const { graphData: nextGraphData, shouldAutoLabel } = await buildSemanticLayoutGraph(gen, filter, targetColor);
		logGraphPhase("Semantic layout build", buildStart, nextGraphData.nodes.length);
		if (gen !== buildGeneration) return;

		graphData = nextGraphData;

		if (shouldAutoLabel) {
			// Fire-and-forget; handleLabelClusters manages its own isLabeling state.
			void handleLabelClusters(nextGraphData, gen);
		}
	} catch (err) {
		console.error("[SmartGraph] Error building graph:", err);
		graphData = { nodes: [], edges: [] };
	} finally {
		if (gen === buildGeneration) {
			isLoading = false;
			setLoadingStage("Preparing smart graph...");
		}
	}
}

// displayData is $derived above — auto-applies search highlighting.

// Build graph on filter/settings changes (debounced to avoid rapid-fire builds)
// Note: projectionMethod, UMAP parameters, defaultK, and autoK are
// intentionally excluded — they only take effect when the user presses Apply.
$effect(() => {
	// Track reactive dependencies (layout, color, filter settings)
	layoutMode;
	colorMode;
	selectedFolders;
	selectedTags;
	settings.colorGroups;

	if (layoutMode === "semantic") {
		settings.showWikiLinks;
	}

	const filter = getFilter();
	const rebuildSignature = createAutoRebuildSignature(layoutMode, colorMode, filter);
	if (rebuildSignature === lastAutoRebuildSignature) {
		return;
	}
	lastAutoRebuildSignature = rebuildSignature;

	// Debounce: schedule a rebuild and clean up on re-trigger
	const timer = setTimeout(() => {
		untrack(() => {
			void rebuildGraph();
		});
	}, 300);

	return () => clearTimeout(timer);
});

// Invalidate the raw-documents cache when the embedding index changes or new
// documents are indexed. This mirrors how the vector index itself is
// rebuilt — the graph cache stays warm as long as the underlying data hasn't
// changed, and auto-invalidates when it has.
let lastDocCacheKey: string | null = null;
$effect(() => {
	const indexId = data.graphEmbedIndex;
	const indexConfig = indexId ? data.getEmbeddingIndex(indexId) : null;
	const docCount = indexConfig?.documentCount ?? 0;
	const key = documentsKey(indexId, docCount);

	if (lastDocCacheKey !== null && key !== lastDocCacheKey) {
		Logger.info(`[SmartGraphCache] Index changed (${lastDocCacheKey} → ${key}), invalidating cache`);
		smartGraphCache.clear();
		clusterMap = new Map();
	}
	lastDocCacheKey = key;
});

// Load filter options on mount
loadFilterOptions();

// Handlers
function handleSettingsChange(partial: Partial<SmartGraphSettings>) {
	data.smartGraphSettings = { ...settings, ...partial };
}

function handleFolderFilterChange(folders: string[]) {
	selectedFolders = folders;
}

function handleTagFilterChange(tags: string[]) {
	selectedTags = tags;
}

function handleSearchChange(query: string) {
	searchQuery = query;
}

function handleFitToView() {
	canvasComponent?.fitToView();
}

function handleRefresh() {
	loadFilterOptions();
	if (layoutMode === "semantic") {
		// Force full rebuild by clearing all caches
		smartGraphCache.clear();
		clusterMap = new Map();
	}
	void rebuildGraph();
}

/**
 * Apply projection & clustering changes.
 * Forces a full rebuild with fresh clusters using the current projection
 * method and K settings.
 */
function handleApplyProjection() {
	// Projection/clustering params changed — clear projection and cluster caches
	// but keep raw documents and filtered docs (those haven't changed).
	smartGraphCache.clear();
	clusterMap = new Map();
	if (layoutMode === "semantic") {
		void rebuildGraph("semantic");
	}
}

/**
 * Switch to semantic layout mode (embedding-based positions + clustering).
 * Guards against no-op, checks for vector store, triggers animated transition.
 */
function handleSwitchToSemantic() {
	if (layoutMode === "semantic") return;
	if (!isVectorStoreInitialized()) {
		new Notice("Semantic layout requires indexed embeddings. Build the vector store first.");
		return;
	}
	handleSettingsChange({ layoutMode: "semantic", colorMode: "clusters" });
}

/**
 * Switch back to force-directed layout mode.
 */
function handleSwitchToForce() {
	if (layoutMode === "force") return;
	handleSettingsChange({ layoutMode: "force", colorMode: "groups" });
}

function handleNodeClick(path: string) {
	plugin.app.workspace.openLinkText(path, "", false);
}

function handleRevealFile(path: string) {
	const file = plugin.app.vault.getAbstractFileByPath(path);
	if (file) {
		// Reveal in Obsidian's file explorer
		const explorer = plugin.app.workspace.getLeavesOfType("file-explorer")[0];
		if (explorer) {
			(explorer.view as any).revealInFolder?.(file);
		}
	}
}

function handleFocusCluster(cluster: number) {
	// Toggle: add or remove this cluster from the focused set
	const next = new Set(focusedClusters);
	if (next.has(cluster)) {
		next.delete(cluster);
	} else {
		next.add(cluster);
	}
	focusedClusters = next;

	// Sync selection: select all nodes belonging to any focused cluster
	if (next.size > 0) {
		const paths = canvasComponent?.getNodePathsForClusters(next) ?? [];
		canvasComponent?.selectNodesByPaths(paths);
		handleSelectionChange(paths);
		// Pan and zoom to frame the focused clusters
		canvasComponent?.panToClusters(next);
	} else {
		handleSelectionChange([]);
		canvasComponent?.clearSelection();
	}
}

function handleSelectionChange(paths: string[]) {
	selectedPaths = paths;
	// If a chat is already open, sync selection automatically
	const messenger = getMessenger();
	if (messenger) {
		messenger.pendingGraphNotes = [...paths];
	}
}

function handleLassoModeChange(active: boolean) {
	lassoMode = active;
	if (!active) {
		selectedPaths = [];
		canvasComponent?.clearSelection();
		const messenger = getMessenger();
		if (messenger) {
			messenger.pendingGraphNotes = [];
		}
	}
}

function handleOpenAllSelected() {
	for (const path of selectedPaths) {
		plugin.app.workspace.openLinkText(path, "", "tab");
	}
}

async function handleSendToChat() {
	const paths = selectedPaths;
	if (paths.length === 0) return;

	// Ensure a chat is open
	const { workspace } = plugin.app;
	const existingLeaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
	if (!existingLeaf) {
		await plugin.agentManager.createNewChat();
	} else {
		workspace.revealLeaf(existingLeaf);
	}

	// Queue graph notes as structured data (rendered as chips in the chat input)
	const messenger = getMessenger();
	if (messenger) {
		messenger.pendingGraphNotes = [...paths];
	} else {
		new Notice("Chat is not initialized yet. Please open a chat first.");
	}
}

function handleZoomToSelection() {
	canvasComponent?.panToSelection();
}

function handleClearSelection() {
	selectedPaths = [];
	focusedClusters = new Set();
	canvasComponent?.clearSelection();
	const messenger = getMessenger();
	if (messenger) {
		messenger.pendingGraphNotes = [];
	}
}

/**
 * Generate thematic labels for each cluster using the user's configured chat model.
 * Groups nodes by cluster, reads note content snippets, and sends a single batched prompt.
 */
async function handleLabelClusters(
	sourceGraphData: GraphData | unknown = graphData,
	sourceGeneration = buildGeneration,
) {
	if (isLabeling) return;
	const chatModelConfig = settings.graphChatModel;
	const activeGraphData =
		sourceGraphData &&
		typeof sourceGraphData === "object" &&
		"nodes" in sourceGraphData &&
		"edges" in sourceGraphData
			? (sourceGraphData as GraphData)
			: graphData;

	if (!chatModelConfig) {
		new Notice("No graph chat model configured. Set one in Settings → Graph.");
		return;
	}

	isLabeling = true;

	try {
		// Group nodes by cluster
		const clusters = new Map<number, GraphData["nodes"]>();
		for (const node of activeGraphData.nodes) {
			if (node.cluster == null) continue;
			const group = clusters.get(node.cluster) ?? [];
			group.push(node);
			clusters.set(node.cluster, group);
		}

		if (clusters.size === 0) {
			new Notice("No clusters found.");
			return;
		}

		// Build prompt with top 10 notes per cluster (by degree)
		let promptBody = "";
		const sortedClusterIds = [...clusters.keys()].sort((a, b) => a - b);

		for (const clusterId of sortedClusterIds) {
			const nodes = clusters.get(clusterId)!;
			// Take top 10 by degree
			const topNodes = [...nodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0)).slice(0, 10);

			promptBody += `\nCluster ${clusterId} (${nodes.length} notes):\n`;

			for (const node of topNodes) {
				let snippet = "";
				try {
					const file = plugin.app.vault.getAbstractFileByPath(node.path);
					if (file && "extension" in file) {
						const content = await plugin.app.vault.cachedRead(file as any);
						snippet = content.slice(0, 200).replace(/\n/g, " ").trim();
					}
				} catch {
					// Skip unreadable files
				}
				const title = node.label;
				promptBody += snippet ? `- "${title}" — ${snippet}\n` : `- "${title}"\n`;
			}
		}

		const prompt = `You are labeling clusters of notes in a knowledge graph.
For each cluster below, generate a short label (2-4 words) that captures the common theme of the notes.
${promptBody}
Respond with ONLY a JSON object mapping cluster number to label, no markdown fences:
{${sortedClusterIds.map((id) => `"${id}": "..."`).join(", ")}}`;

		// Create LLM instance — disable extended thinking/reasoning for speed.
		// This is best-effort: each provider handles these hints differently,
		// and providers that don't recognise the keys will silently ignore them.
		const registry = getRegistry();
		const provider = chatModelConfig.provider;

		const modelOptions: Partial<ChatModelConfig> & Record<string, unknown> = {
			...chatModelConfig.modelConfig,
		};

		// Anthropic: `thinking` must be set at construction time, not via bind()
		if (provider === "anthropic") {
			modelOptions.thinking = { type: "disabled" };
		}

		const baseLlm = registry.createChatInstance(provider, chatModelConfig.model, modelOptions);

		// For non-Anthropic providers that may support reasoning params (e.g.
		// OpenRouter exposes `reasoning`), use bind() as a best-effort hint.
		const llm =
			provider !== "anthropic" && "bind" in baseLlm && typeof baseLlm.bind === "function"
				? (baseLlm as any).bind({ reasoning: false })
				: baseLlm;

		const response = await llm.invoke([new HumanMessage(prompt)]);

		if (sourceGeneration !== buildGeneration) {
			return;
		}

		const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

		// Parse JSON response — strip markdown fences if present
		const jsonStr = text
			.replace(/^```(?:json)?\s*/i, "")
			.replace(/\s*```$/i, "")
			.trim();
		const parsed = JSON.parse(jsonStr) as Record<string, string>;

		// Convert string keys to number keys
		const labels: Record<number, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			const num = Number.parseInt(key, 10);
			if (!Number.isNaN(num) && typeof value === "string") {
				labels[num] = value;
			}
		}

		clusterLabels = labels;
		new Notice(`Generated labels for ${Object.keys(labels).length} clusters`);
	} catch (err) {
		console.error("[SmartGraph] Error generating cluster labels:", err);
		new Notice(`Failed to generate cluster labels: ${err instanceof Error ? err.message : "Unknown error"}`);
	} finally {
		isLabeling = false;
	}
}

function handleClearFocusedClusters() {
	handleClearSelection();
}

function handleHoverPreview(event: MouseEvent, path: string, targetEl: HTMLElement) {
	plugin.app.workspace.trigger("hover-link", {
		event,
		source: VIEW_TYPE_SMART_GRAPH,
		hoverParent: plugin,
		targetEl,
		linktext: path,
		sourcePath: path,
	});
}
</script>

<div class="smart-graph-view">
  {#if isLoading && graphData.nodes.length === 0}
    <div class="graph-loading">
      <LoadingAnimation />
			<p>{loadingMessage}</p>
    </div>
  {:else}
    <GraphCanvas
      bind:this={canvasComponent}
      graphData={displayData}
      mode={layoutMode}
      linkDistance={settings.linkDistance}
      chargeStrength={settings.chargeStrength}
      labelZoomThreshold={settings.labelZoomThreshold}
      showWikiLinks={layoutMode === "force" ? true : settings.showWikiLinks}
      {focusedClusters}
      clusterLabels={effectiveClusterLabels}
      {isLabeling}
      onNodeClick={handleNodeClick}
      onRevealFile={handleRevealFile}
      onFocusCluster={handleFocusCluster}
      onToggleWikiLinks={() => handleSettingsChange({ showWikiLinks: !settings.showWikiLinks })}
      {lassoMode}
      onSelectionChange={handleSelectionChange}
      onClearFocusedClusters={handleClearFocusedClusters}
      onHoverPreview={handleHoverPreview}
    />
  {/if}

  {#if selectedPaths.length > 0}
    <div class="graph-selection-bar">
      <span class="selection-count">{selectedPaths.length} notes selected</span>
      <div class="selection-actions">
        <Button
          iconId="scan"
          onClick={handleZoomToSelection}
          tooltip="Zoom to selection (F)"
        />
        <Button
          buttonText="Open All"
          onClick={handleOpenAllSelected}
          tooltip="Open all selected notes in new tabs"
        />
        {#if !plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT).length}
          <Button
            buttonText="Send to Chat"
            onClick={handleSendToChat}
            tooltip="Open a new chat with selected notes"
          />
        {/if}
        <Button buttonText="Clear" onClick={handleClearSelection} tooltip="Clear selection (Esc)" />
      </div>
    </div>
  {/if}

  <GraphInspector
    isCollapsed={!inspectorOpen}
    nodeCount={displayData.nodes.length}
    graphData={displayData}
    {colorMode}
    {isLoading}
    loadingLabel={loadingMessage}
    {layoutMode}
    {availableFolders}
    {availableTags}
    {selectedFolders}
    {selectedTags}
    {searchQuery}
    onFolderFilterChange={handleFolderFilterChange}
    onTagFilterChange={handleTagFilterChange}
    onSearchChange={handleSearchChange}
    selectedCount={selectedPaths.length}
    focusedClusterDetails={focusedClusterDetails}
    onClearFocusedClusters={handleClearFocusedClusters}
    onOpenFocusedClusters={handleOpenAllSelected}
    onSendFocusedClustersToChat={handleSendToChat}
    onOpenPath={handleNodeClick}
  />

  <GraphControls
    {settings}
    {suggestedK}
    {isLoading}
    loadingLabel={loadingMessage}
    {layoutMode}
    {colorMode}
    onSettingsChange={handleSettingsChange}
    onFitToView={handleFitToView}
    onRefresh={handleRefresh}
    onApplyProjection={handleApplyProjection}
    onSwitchToSemantic={handleSwitchToSemantic}
    onSwitchToForce={handleSwitchToForce}
    onLabelClusters={colorMode === "clusters" ? handleLabelClusters : undefined}
    {isLabeling}
    {lassoMode}
    onLassoModeChange={handleLassoModeChange}
    {clusterLegendEntries}
    {focusedClusters}
    onFocusCluster={handleFocusCluster}
    {inspectorOpen}
    {hasActiveFilters}
    onToggleInspector={() => (inspectorOpen = !inspectorOpen)}
  />
</div>

<style>
  .smart-graph-view {
    width: 100%;
    height: 100%;
    position: relative;
    background: var(--background-primary);
    overflow: hidden;
  }

  .graph-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--text-muted);
  }

  .graph-loading p {
    margin: 0;
    font-size: 14px;
  }

  .graph-selection-bar {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
    z-index: 12;
    white-space: nowrap;
  }

  .selection-count {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-normal);
  }

  .selection-actions {
    display: flex;
    gap: 6px;
  }
</style>
