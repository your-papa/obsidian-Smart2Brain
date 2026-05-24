<script lang="ts">
import { untrack, onDestroy, tick } from "svelte";
import { getAllTags, Notice } from "obsidian";
import { HumanMessage } from "@langchain/core/messages";
import { getPlugin } from "../../stores/state.svelte";
import { getData, setImmersedSpace, onImmersionChange } from "../../stores/dataStore.svelte";
import { SpaceManagerModal } from "../modal/SpaceManagerModal";
import { getIndexableVaultFiles } from "../../utils/fileFiltering";
import { getRegistry } from "../../providers/registry";
import type { ChatModelConfig } from "../../providers/index";
import { Logger } from "../../utils/logging";
import { showSettingsLinkNotice } from "../../utils/settingsNotice";
import { getVectorStoreService, waitForVectorStore, waitForVectorStoreIndex } from "../../vectorstore";
import {
	type GraphData,
	type GraphEdge,
	type SegmentBy,
	type SpaceSegment,
	type Space,
	type ViewFilter,
	type SmartGraphSettings,
	DEFAULT_SMART_GRAPH_SETTINGS,
	THEME_COLOR_VARS,
} from "../../types/graph";
import { resolveViewFilter } from "../../lib/views";
import {
	buildWikiGraph,
	filterDocuments,
	computeClusters,
	readNativeGraphSettings,
	resolveSegments,
	applySegments,
	type GraphFilter,
	type ClusterAssignment,
} from "../../views/smart-graph/graphDataBuilder";
import { smartGraphCache, documentsKey, filteredKey, reducedKey } from "../../views/smart-graph/graphCache";
import { reduceDimensionsAsync, louvainAsync } from "../../utils/computeWorkerManager";
import type { DocumentVector } from "../../vectorstore/types";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";
import { VIEW_TYPE_SMART_GRAPH } from "../../views/smart-graph/SmartGraphView";
import { getMessenger } from "../../stores/chatStore.svelte";
import LoadingAnimation from "../ui/LoadingAnimation.svelte";
import Button from "../ui/Button.svelte";
import GraphCanvas from "./GraphCanvas.svelte";
import GraphControls from "./GraphControls.svelte";
import SpaceSwitcher from "../ui/SpaceSwitcher.svelte";

const plugin = getPlugin();
const data = getData();

// Graph state

// Native Obsidian graph settings — read from `.obsidian/graph.json` on mount
// and used as a middle layer between hardcoded defaults and user-persisted
// settings: DEFAULT → native Obsidian → user-defined.
let nativeGraphSettings: Partial<SmartGraphSettings> = $state({});

let settings: SmartGraphSettings = $derived({
	...DEFAULT_SMART_GRAPH_SETTINGS,
	...nativeGraphSettings,
	...(data.smartGraphSettings ?? {}),
});
let isLoading = $state(false);
let loadingMessage = $state("Building graph...");
let defaultClusterLabels: Record<number, string> = $state({});
let clusterLabels: Record<number, string> = $state({});
let isLabeling = $state(false);

// Cluster state — persisted across edge/layout rebuilds
let clusterMap: Map<string, ClusterAssignment> = $state(new Map());

// Louvain community state — computed async in worker, cleared on graph rebuild
let louvainCommunities: Record<string, number> = $state({});
// Betweenness centrality per node — computed alongside Louvain, cleared on rebuild
let louvainCentrality: Record<string, number> = $state({});

// Filter state
let selectedFolders: string[] = $state([]);
let selectedTags: string[] = $state([]);
let selectedExtensions: string[] = $state([]);

// Available filters
let availableFolders: string[] = $state([]);
let availableTags: string[] = $state([]);
let availableExtensions: string[] = $state([]);

// Canvas ref
let canvasComponent: GraphCanvas | undefined = $state(undefined);

// Lasso / selection state
let lassoMode = $state(false);
let selectedPaths: string[] = $state([]);
let focusedClusters: Set<number> = $state(new Set());

// Segment / Color-by state — driven by persisted settings, re-applies on change
let segmentBy: SegmentBy = $derived(settings.segmentBy ?? "none");
let segments: SpaceSegment[] = $state([]);
let selectedSegmentIds: Set<string> = $state(new Set());
let focusedSegmentId: string | null = $state(null);
/** Per-segment color overrides set by the user. */
let segmentColorOverrides: Record<string, string> = $state({});

// Re-apply coloring whenever spaces change (no full rebuild needed).
// segmentBy changes are handled directly in handleSegmentByChange for immediacy.
$effect(() => {
	void data.spaces;
	untrack(() => {
		if (graphData.nodes.length > 0 && (segmentBy !== "semantic" || clusterMap.size > 0)) {
			resolveAndApplySegments(graphData);
		}
	});
});

// Immersion state
const _restoredSpaceId = data.activeImmersedSpaceId ?? null;
let immersedSpaceId: string | null = $state(_restoredSpaceId);
// Restore the immersed-space store so search/agent pick it up immediately.
if (_restoredSpaceId) {
	const restoredSpace = data.spaces.find((s) => s.id === _restoredSpaceId);
	setImmersedSpace(restoredSpace ?? null);
}
let pendingSpaceFilter: ViewFilter | null = $state(null);
/** Frozen paths for a draft immersion (session-only, not persisted). */
let draftImmersionPaths: Set<string> | null = $state(null);
/** Resolved paths for the immersed space — constrains graph build. */
let immersedSpacePaths: Set<string> | null = $derived.by(() => {
	if (!immersedSpaceId) return null;
	if (immersedSpaceId === "__draft__") return draftImmersionPaths;
	const space = data.spaces.find((s) => s.id === immersedSpaceId);
	if (!space) return null;
	return resolveViewFilter(plugin.app, space.filter).paths;
});

// Sync graph-local immersion state when the shared SpaceSwitcher changes the store
const disposeImmersionSync = onImmersionChange((space) => {
	const newId = space?.id ?? null;
	// Skip if the graph itself triggered the change (already up to date)
	if (newId === immersedSpaceId) return;
	// Don't override a draft immersion from the external store
	if (immersedSpaceId === "__draft__" && newId !== null) return;
	immersedSpaceId = newId;
	draftImmersionPaths = null;
	void buildGraph();
});
onDestroy(disposeImmersionSync);

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

let graphData: GraphData = $state({ nodes: [], edges: [] });

// Build cancellation — abort stale builds when a new one starts
let currentBuild: AbortController | null = null;

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
		extensions: selectedExtensions.length > 0 ? selectedExtensions : undefined,
	};
}

function createAutoRebuildSignature(filter: GraphFilter): string {
	return JSON.stringify({
		folders: [...(filter.folders ?? [])].sort(),
		tags: [...(filter.tags ?? [])].sort(),
		extensions: [...(filter.extensions ?? [])].sort(),
		showWikiLinks: settings.showWikiLinks,
		immersedSpaceId,
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
	const vaultFiles = getIndexableVaultFiles(plugin.app.vault);

	// Folders: Get unique top-level and second-level folders
	const folders = new Set<string>();
	for (const file of vaultFiles) {
		const parts = file.path.split("/");
		if (parts.length > 1) {
			folders.add(parts[0]);
			if (parts.length > 2) {
				folders.add(`${parts[0]}/${parts[1]}`);
			}
		}
	}
	availableFolders = [...folders].sort();

	// Tags: Get all unique tags from the vault (only md files have metadata)
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

	// Extensions: Get all unique file extensions from the vault
	const extensions = new Set<string>();
	for (const file of vaultFiles) {
		extensions.add(file.extension.toLowerCase());
	}
	availableExtensions = [...extensions].sort();
}

/**
 * Build the graph structure and apply cluster assignments.
 * Shows the wiki graph immediately; semantic clusters are applied async in background.
 */
async function buildGraph() {
	currentBuild?.abort();
	const ac = new AbortController();
	currentBuild = ac;
	isLoading = true;
	loadingMessage = "Building graph...";

	try {
		const filter = getFilter();
		const constrainTo = immersedSpacePaths ?? undefined;
		const { graphData: wikiData } = buildWikiGraph(plugin.app, filter, constrainTo);
		graphData = wikiData;
		isLoading = false;

		if (segmentBy === "semantic") {
			const documents = await ensureDocumentsLoaded(ac.signal);
			if (ac.signal.aborted) return;
			if (!documents) {
				showSettingsLinkNotice(plugin.app, "Semantic cluster coloring requires indexed embeddings.", {
					tab: "graph",
					linkText: "Open graph settings",
				});
			} else {
				await computeAndApplyClusters(ac.signal, documents, filter);
				if (ac.signal.aborted) return;
			}
		}

		resolveAndApplySegments(graphData);
		if (segmentBy === "louvain") void runLouvainSegmentation();
		if (settings.autoLabelClusters && settings.graphChatModel && clusterMap.size > 0) {
			void handleLabelClusters(graphData);
		}

		await tick();
		try {
			canvasComponent?.fitToView();
		} catch {
			/* pixi not ready */
		}
	} catch (e) {
		if (ac.signal.aborted) return;
		console.error("[SmartGraph] Error building graph:", e);
		graphData = { nodes: [], edges: [] };
		isLoading = false;
	}
}

/** Load raw document vectors into cache (Layer 1). */
async function ensureDocumentsLoaded(signal: AbortSignal): Promise<DocumentVector[] | null> {
	const indexId = data.graphEmbedIndex;
	const configuredIndexCount = indexId ? (data.getEmbeddingIndex(indexId)?.documentCount ?? null) : null;
	const docKey = documentsKey(indexId, configuredIndexCount ?? 0);
	let documents = smartGraphCache.getDocuments(docKey);

	if (!documents) {
		setLoadingStage("Initializing vector index...");
		const serviceReady = await waitForVectorStore();
		if (!serviceReady || signal.aborted) return null;
		const ready = await waitForVectorStoreIndex(indexId);
		if (!ready || signal.aborted) return null;
		const vectorService = getVectorStoreService();
		setLoadingStage("Loading vectors from disk...");
		documents = await vectorService.getAllDocumentVectors();
		if (signal.aborted || documents.length === 0) return null;
		smartGraphCache.setDocuments(docKey, documents);
	}

	return documents;
}

/** Filter → PCA-reduce → cluster. Sets `clusterMap` state. */
async function computeAndApplyClusters(
	signal: AbortSignal,
	documents: DocumentVector[],
	filter: GraphFilter,
): Promise<void> {
	const indexId = data.graphEmbedIndex;
	const configuredIndexCount = indexId ? (data.getEmbeddingIndex(indexId)?.documentCount ?? null) : null;
	const docKey = documentsKey(indexId, configuredIndexCount ?? 0);
	const spaceConstraint = immersedSpacePaths;
	const filterK = filteredKey(docKey, filter.folders, filter.tags, filter.extensions, spaceConstraint);
	let filteredResult = smartGraphCache.getFiltered(filterK);

	if (!filteredResult) {
		const filtered = filterDocuments(plugin.app, documents, filter, spaceConstraint);
		if (filtered.length === 0) return;
		const vectors = filtered.map((doc) => doc.vector);
		smartGraphCache.setFiltered(filterK, filtered, vectors);
		filteredResult = smartGraphCache.getFiltered(filterK)!;
		Logger.info(`[SmartGraphCache] Filtered cached (${formatCount(filteredResult.filteredDocs.length)} docs)`);
	} else {
		Logger.info(`[SmartGraphCache] Filtered HIT (${formatCount(filteredResult.filteredDocs.length)} docs)`);
	}

	const { filteredDocs, vectors } = filteredResult;
	if (signal.aborted) return;

	// Fixed reduction dim scaled by vault size (replaces layoutFidelity-based plan)
	const REDUCTION_DIM = filteredDocs.length < 500 ? 50 : filteredDocs.length < 2000 ? 40 : 32;
	const reducK = reducedKey(filterK, REDUCTION_DIM);
	let reducedVectors = smartGraphCache.getReduced(reducK);

	if (!reducedVectors) {
		setLoadingStage(`Reducing ${formatCount(filteredDocs.length)} vectors...`);
		const t0 = performance.now();
		reducedVectors = await reduceDimensionsAsync(vectors, "pca", REDUCTION_DIM);
		Logger.info(
			`[SmartGraph] Vector reduction (${formatCount(filteredDocs.length)} notes): ${Math.round(performance.now() - t0)}ms`,
		);
		if (signal.aborted) return;
		smartGraphCache.setReduced(reducK, reducedVectors);
	} else {
		Logger.info("[SmartGraphCache] Reduced vectors HIT");
	}

	const cachedPathSetKey = smartGraphCache.getFilteredPathSetKey(filterK);
	const currentPathSetKey = filteredDocs
		.map((d) => d.path)
		.slice()
		.sort()
		.join("\0");
	const docSetChanged = clusterMap.size === 0 || cachedPathSetKey == null || currentPathSetKey !== cachedPathSetKey;

	if (docSetChanged) {
		const themeColors = resolveThemeColors();
		setLoadingStage(`Clustering ${formatCount(filteredDocs.length)} notes...`);
		const t0 = performance.now();
		const result = await computeClusters(filteredDocs, vectors, settings, themeColors, reducedVectors);
		logGraphPhase("Clustering", t0, filteredDocs.length);
		if (signal.aborted) return;
		clusterMap = result.clusterMap;
		clusterLabels = {};
	}
}

// Rebuild on filter/settings changes (debounced 300ms)
$effect(() => {
	selectedFolders;
	selectedTags;
	selectedExtensions;
	settings.showWikiLinks;
	immersedSpacePaths;

	const timer = setTimeout(() => untrack(() => void buildGraph()), 300);
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
		louvainCommunities = {};
		louvainCentrality = {};
	}
	lastDocCacheKey = key;
});

// Load filter options on mount
loadFilterOptions();

// Load native Obsidian graph settings (color groups, physics, etc.) as fallback
readNativeGraphSettings(plugin.app).then((native) => {
	nativeGraphSettings = native;
});

// Handlers
function handleSettingsChange(partial: Partial<SmartGraphSettings>) {
	data.smartGraphSettings = { ...settings, ...partial };
}

/**
 * Reset all user-persisted graph settings.
 * Merges `DEFAULT_SMART_GRAPH_SETTINGS` with native Obsidian settings
 * (from `.obsidian/graph.json`) so the result is the same as a fresh start.
 */
function handleResetSettings() {
	data.smartGraphSettings = {
		...DEFAULT_SMART_GRAPH_SETTINGS,
		...nativeGraphSettings,
		// Keep color groups empty so the effectiveColorGroups fallback kicks in
		colorGroups: [],
	};
}

function handleFolderFilterChange(folders: string[]) {
	selectedFolders = folders;
}

function handleTagFilterChange(tags: string[]) {
	selectedTags = tags;
}

function handleExtensionFilterChange(extensions: string[]) {
	selectedExtensions = extensions;
}

function handleFitToView() {
	canvasComponent?.fitToView();
}

function handleRefresh() {
	loadFilterOptions();
	smartGraphCache.clear();
	clusterMap = new Map();
	louvainCommunities = {};
	louvainCentrality = {};
	void buildGraph();
}

function handleApplyProjection() {
	smartGraphCache.clear();
	clusterMap = new Map();
	if (segmentBy === "semantic") void buildGraph();
}

function handleSwitchToSemantic() {}

function handleSwitchToForce() {}

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
	// When coloring by folder or tag, applySegments assigns cluster=index in the
	// segments array — so we can look up the segment directly by index and delegate
	// to handleFocusSegment so the filter uses folder/tag type instead of raw paths.
	if (segmentBy === "folder" || segmentBy === "tag" || segmentBy === "extension") {
		const segment = segments[cluster];
		if (segment) {
			const isFocused = focusedSegmentId === segment.id;
			handleFocusSegment(isFocused ? null : segment.id);
			return;
		}
	}

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
	pendingSpaceFilter =
		paths.length > 0 ? { type: "any", conditions: [{ type: "paths", value: paths.slice() }] } : null;
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
	focusedSegmentId = null;
	pendingSpaceFilter = null;
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
async function handleLabelClusters(sourceGraphData: GraphData | unknown = graphData) {
	if (isLabeling) return;
	const buildAtStart = currentBuild;
	const chatModelConfig = settings.graphChatModel;
	const activeGraphData =
		sourceGraphData &&
		typeof sourceGraphData === "object" &&
		"nodes" in sourceGraphData &&
		"edges" in sourceGraphData
			? (sourceGraphData as GraphData)
			: graphData;

	if (!chatModelConfig) {
		showSettingsLinkNotice(plugin.app, "No graph chat model configured.", {
			tab: "graph",
			linkText: "Open graph settings",
		});
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

		if (currentBuild !== buildAtStart) {
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

async function runLouvainSegmentation() {
	const wikiEdges = graphData.edges.filter((e) => e.type === "wiki");
	if (wikiEdges.length === 0) return;
	const sources = wikiEdges.map((e) => e.source);
	const targets = wikiEdges.map((e) => e.target);
	const weights = wikiEdges.map((e) => e.weight);
	const result = await louvainAsync(sources, targets, weights, true);
	louvainCommunities = result.communities;
	louvainCentrality = result.centrality;
	resolveAndApplySegments(graphData, "louvain");
}

function handleSegmentByChange(by: SegmentBy) {
	selectedSegmentIds = new Set();
	focusedSegmentId = null;
	segmentColorOverrides = {};
	// Clear AI-generated cluster labels — they belong to semantic clustering only.
	// Keeping them would bleed stale labels into folder/tag/spaces modes.
	if (by !== "semantic") {
		clusterLabels = {};
	}
	// Clear louvain state when switching away from louvain mode.
	if (by !== "louvain") {
		louvainCommunities = {};
		louvainCentrality = {};
	}
	handleSettingsChange({ segmentBy: by });

	if (by === "semantic" && clusterMap.size === 0) {
		void buildGraph();
	} else if (by === "louvain") {
		void runLouvainSegmentation();
	} else {
		// Pass `by` explicitly: `segmentBy` is a $derived of settings and may not have updated yet.
		resolveAndApplySegments(graphData, by);
	}
}

function handleSegmentColorChange(segmentId: string, color: string) {
	// "none" means revert to default theme color
	const resolvedColor = color === "none" ? "" : color;
	segmentColorOverrides = { ...segmentColorOverrides, [segmentId]: resolvedColor };
	segments = segments.map((s) => (s.id === segmentId ? { ...s, color: resolvedColor } : s));
	graphData = applySegments(graphData, segments);
}

function handleFocusSegment(segmentId: string | null) {
	focusedSegmentId = segmentId;
	if (segmentId == null) {
		focusedClusters = new Set();
		canvasComponent?.clearSelection();
		handleSelectionChange([]);
		return;
	}
	const segment = segments.find((s) => s.id === segmentId);
	if (segment) {
		const paths = [...segment.paths];
		canvasComponent?.selectNodesByPaths(paths);
		selectedPaths = paths;
		const messenger = getMessenger();
		if (messenger) messenger.pendingGraphNotes = [...paths];
		// Use semantic filter condition when the segment source is folder, tag, or extension
		if (segment.source === "folder") {
			const value = segmentId.replace(/^folder:/, "");
			pendingSpaceFilter = { type: "any", conditions: [{ type: "folder", value }] };
		} else if (segment.source === "tag") {
			const value = segmentId.replace(/^tag:/, "");
			pendingSpaceFilter = { type: "any", conditions: [{ type: "tag", value }] };
		} else if (segment.source === "extension") {
			const value = segmentId.replace(/^extension:/, "");
			pendingSpaceFilter = { type: "any", conditions: [{ type: "extension", value }] };
		} else {
			pendingSpaceFilter = { type: "any", conditions: [{ type: "paths", value: paths.slice() }] };
		}
		canvasComponent?.panToSelection();
	}
}

function handleToggleSegmentSelection(segmentId: string) {
	const next = new Set(selectedSegmentIds);
	if (next.has(segmentId)) {
		next.delete(segmentId);
	} else {
		next.add(segmentId);
	}
	selectedSegmentIds = next;
}

// ─── Spaces handlers ─────────────────────────────────────

function handleImmerseDraft(filter?: ViewFilter) {
	const f = filter ?? pendingSpaceFilter;
	if (!f) return;
	draftImmersionPaths = resolveViewFilter(plugin.app, f).paths;
	immersedSpaceId = "__draft__";
	setImmersedSpace({
		id: "__draft__",
		label: "Draft selection",
		filter: $state.snapshot(f) as ViewFilter,
		color: "#888888",
		createdAt: new Date().toISOString(),
	});
	// Draft immersion is session-only — don't persist to settings
	void buildGraph();
}

function handleExitImmersion() {
	const wasDraft = immersedSpaceId === "__draft__";
	immersedSpaceId = null;
	draftImmersionPaths = null;
	setImmersedSpace(null);
	if (!wasDraft) data.setActiveImmersedSpaceId(null);
	void buildGraph();
}

function handleOpenSpaceManager(opts?: { initialFilter?: ViewFilter; space?: Space }) {
	const snapped = opts?.space ? { ...opts, space: $state.snapshot(opts.space) as Space } : opts;
	new SpaceManagerModal(plugin.app, snapped).open();
}

/**
 * Resolve segments from current graphData and apply coloring.
 * Called after graph build or when segmentBy changes.
 * Pass `overrideBy` when calling from handleSegmentByChange to bypass the stale
 * `segmentBy` derived value (which hasn't updated yet when settings are written).
 */
function resolveAndApplySegments(gd: GraphData, overrideBy?: SegmentBy) {
	const by = overrideBy ?? segmentBy;
	const themeColors = resolveThemeColors();
	const resolved = resolveSegments(plugin.app, gd, by, {
		clusterMap,
		clusterLabels: effectiveClusterLabels,
		themeColors,
		spaces: data.spaces,
		louvainCommunities,
	});
	// Apply persistent color overrides (from user picks or bookmark restore)
	for (let i = 0; i < resolved.length; i++) {
		const override = segmentColorOverrides[resolved[i].id];
		if (override !== undefined) {
			resolved[i] = { ...resolved[i], color: override };
		}
	}
	segments = resolved;
	// Build path → segment lookup once so the single node-map pass below can do everything:
	// strip stale color/cluster/centrality, apply betweenness centrality (louvain), apply segment color.
	const pathInfo = new Map<string, { color: string; cluster: number }>();
	for (let i = 0; i < resolved.length; i++) {
		for (const path of resolved[i].paths) {
			if (!pathInfo.has(path)) {
				pathInfo.set(path, { color: resolved[i].color, cluster: i });
			}
		}
	}
	const isLouvain = by === "louvain" && Object.keys(louvainCentrality).length > 0;
	if (resolved.length > 0) {
		graphData = {
			...gd,
			nodes: gd.nodes.map((n) => {
				const info = pathInfo.get(n.path);
				const centrality = isLouvain ? louvainCentrality[n.id] : undefined;
				return {
					...n,
					color: info?.color ?? undefined,
					cluster: info?.cluster ?? undefined,
					centrality,
				};
			}),
		};
		const labels: Record<number, string> = {};
		for (let i = 0; i < resolved.length; i++) {
			labels[i] = resolved[i].label;
		}
		defaultClusterLabels = labels;
	} else {
		// No segments — strip stale colors in one pass
		graphData = {
			...gd,
			nodes: gd.nodes.map((n) =>
				n.color !== undefined || n.cluster !== undefined || n.centrality !== undefined
					? { ...n, color: undefined, cluster: undefined, centrality: undefined }
					: n,
			),
		};
		defaultClusterLabels = {};
	}
}

// ─── Saved Views ─────────────────────────────────────────

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

onDestroy(() => {
	setImmersedSpace(null);
});
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
      {graphData}
      linkDistance={settings.linkDistance}
      chargeStrength={settings.chargeStrength}
      centerStrength={settings.centerStrength}
      linkStrength={settings.linkStrength}
      showWikiLinks={settings.showWikiLinks}
      {focusedClusters}
      clusterLabels={effectiveClusterLabels}
      {isLabeling}
      clusterCohesionStrength={settings.clusterCohesionStrength ?? 0.15}
      onNodeClick={handleNodeClick}
      onRevealFile={handleRevealFile}
      onFocusCluster={handleFocusCluster}
      onToggleWikiLinks={() => handleSettingsChange({ showWikiLinks: !settings.showWikiLinks })}
      onImmerseDraft={handleImmerseDraft}
      onExitImmersion={handleExitImmersion}
      immersedInDraft={immersedSpaceId === "__draft__"}
      {lassoMode}
      onSelectionChange={handleSelectionChange}
      onClearFocusedClusters={handleClearFocusedClusters}
      onHoverPreview={handleHoverPreview}
    />
  {/if}

  <!-- Space switcher overlay -->
  <div class="graph-space-switcher">
    <SpaceSwitcher forceGlobal />
  </div>

  {#if selectedPaths.length > 0 || immersedSpaceId === "__draft__"}
    <div class="graph-selection-bar">
      <span class="selection-count">
        {#if immersedSpaceId === "__draft__" && selectedPaths.length === 0}
          Immersed in selection
        {:else}
          {selectedPaths.length} notes selected
        {/if}
      </span>
      <div class="selection-actions">
        {#if selectedPaths.length > 0}
          <Button iconId="scan" onClick={handleZoomToSelection} tooltip="Zoom to selection (F)" />
          <Button
            buttonText="Open All"
            onClick={handleOpenAllSelected}
            tooltip="Open all selected notes in new tabs"
          />
          {#if immersedSpaceId !== "__draft__"}
            <Button
              buttonText="Immerse"
              onClick={() => handleImmerseDraft()}
              tooltip="Immerse in selection (I)"
            />
          {/if}
          <Button
            buttonText="New Space"
            onClick={() =>
              handleOpenSpaceManager({
                initialFilter: { type: "paths", value: selectedPaths.slice() },
              })}
            tooltip="Save selection as a new space"
          />
        {/if}
        {#if immersedSpaceId === "__draft__"}
          <Button
            buttonText="Exit immersion"
            onClick={handleExitImmersion}
            tooltip="Exit immersion (I or Esc)"
          />
        {/if}
        {#if selectedPaths.length > 0}
          <Button
            buttonText="Clear"
            onClick={handleClearSelection}
            tooltip="Clear selection (Esc)"
          />
        {/if}
      </div>
    </div>
  {/if}

  <GraphControls
    {settings}
    {isLoading}
    loadingLabel={loadingMessage}
    {segmentBy}
    onSettingsChange={handleSettingsChange}
    onSegmentByChange={handleSegmentByChange}
    onResetSettings={handleResetSettings}
    onFitToView={handleFitToView}
    onRefresh={handleRefresh}
    onApplyProjection={handleApplyProjection}
    onLabelClusters={handleLabelClusters}
    {isLabeling}
    {lassoMode}
    onLassoModeChange={handleLassoModeChange}
    {graphData}
    nodeCount={graphData.nodes.length}
    {immersedSpaceId}
    {segments}
    {focusedSegmentId}
    onFocusSegment={handleFocusSegment}
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

  .graph-space-switcher {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    pointer-events: auto;
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
