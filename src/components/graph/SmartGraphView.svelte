<script lang="ts">
import { untrack, tick } from "svelte";
import { getAllTags, Notice } from "obsidian";
import { getPlugin } from "../../stores/state.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getIndexableVaultFiles } from "../../utils/fileFiltering";
import { Logger } from "../../utils/logging";
import {
	type GraphData,
	type GraphEdge,
	type SegmentBy,
	type SpaceSegment,
	type ViewFilter,
	type SmartGraphSettings,
	DEFAULT_SMART_GRAPH_SETTINGS,
	THEME_COLOR_VARS,
} from "../../types/graph";
import {
	buildWikiGraph,
	readNativeGraphSettings,
	resolveSegments,
	applySegments,
	type GraphFilter,
} from "../../views/smart-graph/graphDataBuilder";
import { leidenAsync } from "../../utils/computeWorkerManager";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";
import { VIEW_TYPE_SMART_GRAPH } from "../../views/smart-graph/SmartGraphView";
import { getMessenger } from "../../stores/chatStore.svelte";
import LoadingAnimation from "../ui/LoadingAnimation.svelte";
import Button from "../ui/Button.svelte";
import GraphCanvas from "./GraphCanvas.svelte";
import GraphControls from "./GraphControls.svelte";

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

// Leiden community state — computed async in worker, cleared on graph rebuild
let leidenCommunities: Record<string, number> = $state({});
// Betweenness centrality per node — computed alongside Leiden, cleared on rebuild
let leidenCentrality: Record<string, number> = $state({});

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
let immersePaths: Set<string> | null = $state(null);
let isImmersed: boolean = $derived(immersePaths !== null);
let focusedClusters: Set<number> = $state(new Set());

// Detail level 0–100: 100 = full graph, <100 = skeleton backbone (fewer clusters + only hubs/bridges)
let skeletonDetail = $state(100);

// Segment / Color-by state — always leiden
let segmentBy: SegmentBy = $derived("leiden" as SegmentBy);
let segments: SpaceSegment[] = $state([]);
let focusedSegmentIds: Set<string> = $state(new Set());
/** Per-segment color overrides set by the user. */
let segmentColorOverrides: Record<string, string> = $state({});

let pendingSpaceFilter: ViewFilter | null = $state(null);

let effectiveClusterLabels: Record<number, string> = $derived({ ...defaultClusterLabels });

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

/**
 * Skeleton view: structural backbone of the vault, parameterised by skeletonDetail (0–100).
 *
 * detail=0  → fewest clusters (3), only the single top hub + high-centrality bridges per cluster
 * detail=100 → all clusters, many hubs per cluster (approaches the full graph)
 *
 * Edges: only wiki edges whose both endpoints survived the node filter.
 */
let skeletonGraphData: GraphData = $derived.by(() => {
	if (skeletonDetail >= 100 || segmentBy !== "leiden" || graphData.nodes.length === 0) return graphData;

	const t = skeletonDetail / 100; // 0–1

	// Number of top clusters: lerp from 3 (min) up to all clusters
	const clusterSizes = new Map<number, number>();
	for (const node of graphData.nodes) {
		if (node.cluster == null) continue;
		clusterSizes.set(node.cluster, (clusterSizes.get(node.cluster) ?? 0) + 1);
	}
	const totalClusters = clusterSizes.size;
	const topN = Math.max(3, Math.round(3 + t * (totalClusters - 3)));

	// Hubs per cluster: lerp from 1 at t=0 to 10 at t=1
	const hubsPerCluster = Math.max(1, Math.round(1 + t * 9));

	// Centrality threshold: at t=0 only nodes with centrality > 0.05 are bridges;
	// at t=1 any non-zero centrality qualifies
	const centralityThreshold = 0.05 * (1 - t);

	// Pick the top-N clusters by size
	const topClusters = new Set(
		[...clusterSizes.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, topN)
			.map(([id]) => id),
	);

	// For each kept cluster, collect nodes sorted by degree descending
	const clusterNodes = new Map<number, typeof graphData.nodes>();
	for (const node of graphData.nodes) {
		if (node.cluster == null || !topClusters.has(node.cluster)) continue;
		const list = clusterNodes.get(node.cluster) ?? [];
		list.push(node);
		clusterNodes.set(node.cluster, list);
	}
	for (const list of clusterNodes.values()) {
		list.sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
	}

	const keptPaths = new Set<string>();
	for (const nodes of clusterNodes.values()) {
		for (let i = 0; i < Math.min(hubsPerCluster, nodes.length); i++) {
			keptPaths.add(nodes[i].path);
		}
		for (const node of nodes) {
			if ((node.centrality ?? 0) > centralityThreshold) keptPaths.add(node.path);
		}
	}

	const nodes = graphData.nodes.filter((n) => keptPaths.has(n.path));
	const edges = graphData.edges.filter((e) => keptPaths.has(e.source) && keptPaths.has(e.target));
	return { nodes, edges };
});

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
	// `markdownOnly` narrows to just .md; explicit extension picks (if any) still win.
	const extensions = selectedExtensions.length > 0 ? selectedExtensions : settings.markdownOnly ? ["md"] : undefined;
	return {
		folders: selectedFolders.length > 0 ? selectedFolders : undefined,
		tags: selectedTags.length > 0 ? selectedTags : undefined,
		extensions,
	};
}

function createAutoRebuildSignature(filter: GraphFilter): string {
	return JSON.stringify({
		folders: [...(filter.folders ?? [])].sort(),
		tags: [...(filter.tags ?? [])].sort(),
		extensions: [...(filter.extensions ?? [])].sort(),
		showWikiLinks: settings.showWikiLinks,
		markdownOnly: settings.markdownOnly,
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
		const { graphData: wikiData } = buildWikiGraph(plugin.app, filter, immersePaths ?? undefined);
		graphData = wikiData;
		isLoading = false;

		resolveAndApplySegments(graphData);
		void runLeidenSegmentation();

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

// Rebuild on filter/settings changes (debounced 300ms)
$effect(() => {
	selectedFolders;
	selectedTags;
	selectedExtensions;
	settings.showWikiLinks;
	settings.markdownOnly;

	const timer = setTimeout(() => untrack(() => void buildGraph()), 300);
	return () => clearTimeout(timer);
});

// Re-apply segment coloring when highlight toggles change (no Leiden re-run needed)
$effect(() => {
	settings.highlightIsolated;
	settings.highlightBridges;
	untrack(() => {
		if (graphData.nodes.length > 0) resolveAndApplySegments(graphData);
	});
});

// Load native Obsidian graph settings (color groups, physics, etc.) as fallback
readNativeGraphSettings(plugin.app).then((native) => {
	nativeGraphSettings = native;
});

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

function handleExtensionFilterChange(extensions: string[]) {
	selectedExtensions = extensions;
}

function handleFitToView() {
	canvasComponent?.fitToView();
}

function handleRefresh() {
	loadFilterOptions();
	leidenCommunities = {};
	leidenCentrality = {};
	void buildGraph();
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
	focusedSegmentIds = new Set();
	pendingSpaceFilter = null;
	canvasComponent?.clearSelection();
	const messenger = getMessenger();
	if (messenger) {
		messenger.pendingGraphNotes = [];
	}
}

async function handleImmerse() {
	if (selectedPaths.length === 0) return;
	immersePaths = new Set(selectedPaths);
	canvasComponent?.clearSelection();
	selectedPaths = [];
	await buildGraph();
}

async function handleExitImmerse() {
	immersePaths = null;
	await buildGraph();
}

async function runLeidenSegmentation() {
	const wikiEdges = graphData.edges.filter((e) => e.type === "wiki");
	if (wikiEdges.length === 0) return;
	const sources = wikiEdges.map((e) => e.source);
	const targets = wikiEdges.map((e) => e.target);
	const weights = wikiEdges.map((e) => e.weight);
	const result = await leidenAsync(sources, targets, weights, true, settings.leidenSeed, settings.leidenResolution);
	leidenCommunities = result.communities;
	leidenCentrality = result.centrality;
	resolveAndApplySegments(graphData);
}

function handleSegmentColorChange(segmentId: string, color: string) {
	// "none" means revert to default theme color
	const resolvedColor = color === "none" ? "" : color;
	segmentColorOverrides = { ...segmentColorOverrides, [segmentId]: resolvedColor };
	segments = segments.map((s) => (s.id === segmentId ? { ...s, color: resolvedColor } : s));
	graphData = applySegments(graphData, segments);
}

function handleFocusSegment(segmentId: string, multi: boolean) {
	const next = new Set(focusedSegmentIds);
	if (multi) {
		// Shift/Cmd: toggle this segment in/out of the focused set
		if (next.has(segmentId)) {
			next.delete(segmentId);
		} else {
			next.add(segmentId);
		}
	} else {
		// Plain click: select only this segment, or deselect if already the only one
		if (next.size === 1 && next.has(segmentId)) {
			next.clear();
		} else {
			next.clear();
			next.add(segmentId);
		}
	}
	focusedSegmentIds = next;

	if (next.size === 0) {
		focusedClusters = new Set();
		canvasComponent?.clearSelection();
		handleSelectionChange([]);
		return;
	}

	// Union of all paths across focused segments
	const paths: string[] = [];
	for (const id of next) {
		const seg = segments.find((s) => s.id === id);
		if (seg) paths.push(...seg.paths);
	}
	canvasComponent?.selectNodesByPaths(paths);
	selectedPaths = paths;
	const messenger = getMessenger();
	if (messenger) messenger.pendingGraphNotes = [...paths];
	pendingSpaceFilter = { type: "any", conditions: [{ type: "paths", value: paths.slice() }] };
	canvasComponent?.panToSelection();
}

/**
 * Resolve Leiden community segments from current graphData and apply coloring + centrality.
 */
function resolveAndApplySegments(gd: GraphData) {
	const by = "leiden" as SegmentBy;
	const themeColors = resolveThemeColors();
	const resolved = resolveSegments(plugin.app, gd, by, {
		clusterMap: new Map(),
		clusterLabels: effectiveClusterLabels,
		themeColors,
		leidenCommunities,
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
	// strip stale color/cluster/centrality, apply betweenness centrality (leiden), apply segment color.
	const pathInfo = new Map<string, { color: string; cluster: number }>();
	for (let i = 0; i < resolved.length; i++) {
		for (const path of resolved[i].paths) {
			if (!pathInfo.has(path)) {
				pathInfo.set(path, { color: resolved[i].color, cluster: i });
			}
		}
	}
	const isLeiden = by === "leiden" && Object.keys(leidenCentrality).length > 0;
	if (resolved.length > 0) {
		// For the bridge ring: a true bridge node is one where the MAJORITY of its wiki-link
		// neighbors belong to a DIFFERENT community than its own. High-degree hubs link to many
		// clusters but are firmly assigned to one — their own community dominates their neighbor
		// vote, so they don't qualify. Only nodes that are structurally "between" communities do.
		let bridgeNodes: Set<string> | null = null;
		if (isLeiden) {
			// Build neighbor community vote counts per node (wiki edges only, same as Leiden input)
			const neighborCommunityVotes = new Map<string, Map<number, number>>();
			for (const edge of gd.edges) {
				if (edge.type !== "wiki") continue;
				const sc = leidenCommunities[edge.source];
				const tc = leidenCommunities[edge.target];
				if (sc === undefined || tc === undefined || sc === tc) continue;
				// source sees a foreign neighbor tc
				if (!neighborCommunityVotes.has(edge.source)) neighborCommunityVotes.set(edge.source, new Map());
				const sv = neighborCommunityVotes.get(edge.source)!;
				sv.set(tc, (sv.get(tc) ?? 0) + 1);
				// target sees a foreign neighbor sc
				if (!neighborCommunityVotes.has(edge.target)) neighborCommunityVotes.set(edge.target, new Map());
				const tv = neighborCommunityVotes.get(edge.target)!;
				tv.set(sc, (tv.get(sc) ?? 0) + 1);
			}
			// Count total wiki-link degree per node
			const wikiDegree = new Map<string, number>();
			for (const edge of gd.edges) {
				if (edge.type !== "wiki") continue;
				wikiDegree.set(edge.source, (wikiDegree.get(edge.source) ?? 0) + 1);
				wikiDegree.set(edge.target, (wikiDegree.get(edge.target) ?? 0) + 1);
			}
			bridgeNodes = new Set<string>();
			for (const [nodeId, foreignVotes] of neighborCommunityVotes) {
				const totalForeignLinks = [...foreignVotes.values()].reduce((a, b) => a + b, 0);
				const total = wikiDegree.get(nodeId) ?? 0;
				// Bridge: more than bridgeThreshold of its links go to nodes outside its own community
				if (total > 0 && totalForeignLinks / total > settings.bridgeThreshold) {
					bridgeNodes.add(nodeId);
				}
			}
		}
		graphData = {
			...gd,
			nodes: gd.nodes.map((n) => {
				const info = pathInfo.get(n.path);
				const rawCentrality = isLeiden ? leidenCentrality[n.id] : undefined;
				// Only mark as bridge (and draw the ring) when the node structurally spans communities.
				const centrality = rawCentrality !== undefined && bridgeNodes?.has(n.id) ? rawCentrality : undefined;
				const isBridge = centrality !== undefined;
				const isIsolated = (n.degree ?? 0) === 0;
				const highlighted =
					(settings.highlightBridges && isBridge) || (settings.highlightIsolated && isIsolated);
				return {
					...n,
					color: info?.color ?? undefined,
					cluster: info?.cluster ?? undefined,
					centrality,
					highlighted,
				};
			}),
		};
		const labels: Record<number, string> = {};
		for (let i = 0; i < resolved.length; i++) {
			labels[i] = resolved[i].label;
		}
		defaultClusterLabels = labels;
	} else {
		// No segments — strip stale colors/highlights in one pass
		graphData = {
			...gd,
			nodes: gd.nodes.map((n) =>
				n.color !== undefined || n.cluster !== undefined || n.centrality !== undefined || n.highlighted
					? { ...n, color: undefined, cluster: undefined, centrality: undefined, highlighted: false }
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

async function handleSkeletonToggle() {
	skeletonDetail = skeletonDetail < 100 ? 100 : 30;
	await tick();
	canvasComponent?.fitToView();
}

function handleHoverPreview(event: MouseEvent, path: string, targetEl: HTMLElement) {
	const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? "";
	plugin.app.workspace.trigger("hover-link", {
		event,
		source: VIEW_TYPE_SMART_GRAPH,
		hoverParent: plugin,
		targetEl,
		linktext: path,
		sourcePath,
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
      graphData={skeletonDetail < 100 ? skeletonGraphData : graphData}
      directedWikiEdges={settings.directedWikiEdges}
      linkDistance={settings.linkDistance}
      chargeStrength={settings.chargeStrength}
      centerStrength={settings.centerStrength}
      linkStrength={settings.linkStrength}
      showWikiLinks={settings.showWikiLinks}
      {focusedClusters}
      clusterLabels={effectiveClusterLabels}
      clusterCohesionStrength={settings.clusterCohesionStrength ?? 0.15}
      onNodeClick={handleNodeClick}
      onRevealFile={handleRevealFile}
      onFocusCluster={handleFocusCluster}
      onToggleWikiLinks={() => handleSettingsChange({ showWikiLinks: !settings.showWikiLinks })}
      {lassoMode}
      onSelectionChange={handleSelectionChange}
      onClearFocusedClusters={handleClearFocusedClusters}
      onHoverPreview={handleHoverPreview}
      onSkeletonToggle={handleSkeletonToggle}
      immersed={isImmersed}
      onExitImmerse={handleExitImmerse}
    />
  {/if}

  {#if isImmersed}
    <div class="graph-selection-bar">
      <span class="selection-count">{graphData.nodes.length} notes · immersed</span>
      <div class="selection-actions">
        <Button buttonText="Exit" onClick={handleExitImmerse} tooltip="Exit immerse (Esc)" />
      </div>
    </div>
  {:else if selectedPaths.length > 0}
    <div class="graph-selection-bar">
      <span class="selection-count">
        {selectedPaths.length} notes selected
      </span>
      <div class="selection-actions">
        <Button iconId="scan" onClick={handleZoomToSelection} tooltip="Zoom to selection (F)" />
        <Button buttonText="Immerse" onClick={handleImmerse} tooltip="Rebuild graph with selected notes only" />
        <Button
          buttonText="Open All"
          onClick={handleOpenAllSelected}
          tooltip="Open all selected notes in new tabs"
        />
        <Button
          buttonText="Clear"
          onClick={handleClearSelection}
          tooltip="Clear selection (Esc)"
        />
      </div>
    </div>
  {/if}

  <GraphControls
    {settings}
    {isLoading}
    loadingLabel={loadingMessage}
    onSettingsChange={handleSettingsChange}
    onFitToView={handleFitToView}
    onRefresh={handleRefresh}
    onRerunLeiden={() => void runLeidenSegmentation()}
    {lassoMode}
    onLassoModeChange={handleLassoModeChange}
    {graphData}
    nodeCount={skeletonDetail < 100 ? skeletonGraphData.nodes.length : graphData.nodes.length}
    {segments}
    focusedSegmentIds={focusedSegmentIds}
    onFocusSegment={handleFocusSegment}
    {skeletonDetail}
    onSkeletonDetailChange={(v) => (skeletonDetail = v)}
    onSkeletonDetailCommit={() => canvasComponent?.fitToView()}
    onSkeletonToggle={handleSkeletonToggle}
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
