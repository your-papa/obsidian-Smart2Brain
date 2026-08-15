<script lang="ts">
import { untrack, tick, onDestroy } from "svelte";
import { getAllTags, Notice, type WorkspaceLeaf } from "obsidian";
import { getPlugin } from "../../stores/state.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getIndexableVaultFiles, isAgentFilePath } from "../../utils/fileFiltering";
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
import { getSessionRegistry } from "../../stores/chatStore.svelte";
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
/**
 * True while a Leiden compute is in flight (fresh runs only; cache hits are effectively instant
 * and don't set this). Used to short-circuit the atom toggle and prevent racing state writes.
 */
let isLeidenRunning = $state(false);
let loadingMessage = $state("Building graph...");
let defaultClusterLabels: Record<number, string> = $state({});

// Leiden community state — computed async in worker, cleared on graph rebuild
let leidenCommunities: Record<string, number> = $state({});
// Betweenness centrality per node — computed alongside Leiden, cleared on rebuild
let leidenCentrality: Record<string, number> = $state({});

/**
 * Cache of Leiden results keyed by `${seed}:${resolution}`. Leiden is expensive (seconds on
 * large graphs) but pure over (seed, resolution, graph). We invalidate on every graph rebuild.
 */
let leidenCache = new Map<string, { communities: Record<string, number>; centrality: Record<string, number> }>();

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

// Whether a chat view is currently *visible* to the user. Graph selection is
// ambient (it shows in any open chat automatically), so the selection bar only
// needs an explicit "Open in Chat" action when there's no chat the user can
// currently see. A chat leaf parked in a collapsed sidebar (or hidden background
// tab) doesn't count. Tracked reactively via workspace listeners since
// getLeavesOfType() isn't reactive.
let hasOpenChat = $state(false);
function isLeafVisible(leaf: WorkspaceLeaf): boolean {
	const el = (leaf as { containerEl?: HTMLElement }).containerEl;
	if (el?.style.display === "none") return false;
	const root = leaf.getRoot();
	const { leftSplit, rightSplit } = plugin.app.workspace;
	// In a sidebar → only visible when that sidebar isn't collapsed.
	if (root === leftSplit) return !(leftSplit as { collapsed?: boolean }).collapsed;
	if (root === rightSplit) return !(rightSplit as { collapsed?: boolean }).collapsed;
	// Main editor area → visible unless the tab is hidden behind another (display:none).
	return true;
}
function refreshHasOpenChat() {
	hasOpenChat = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT).some(isLeafVisible);
}
refreshHasOpenChat();
const chatOpenEventRefs = [
	plugin.app.workspace.on("layout-change", refreshHasOpenChat),
	plugin.app.workspace.on("active-leaf-change", refreshHasOpenChat),
	// Collapsing/expanding a sidebar fires `resize` but not layout-change, so this
	// is what keeps the button in sync when the user toggles the chat sidebar.
	plugin.app.workspace.on("resize", refreshHasOpenChat),
];
onDestroy(() => {
	for (const ref of chatOpenEventRefs) plugin.app.workspace.offref(ref);
});

// Detail level 0–100: 100 = full graph, <100 = skeleton backbone (fewer nodes per topic)
let skeletonDetail = $state(100);

// Remembers the Topics slider value before the atom toggle collapsed it, so exit restores it.
let outlineViewPrevResolution: number | null = $state(null);

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
 * Detail view: shows only the top hubs and bridges per cluster, parameterised by skeletonDetail (0–100).
 *
 * detail=0   → 1 hub per cluster + only bridges above the skeletonBridgeCentralityThreshold
 * detail=100 → full graph (all nodes)
 *
 * All clusters are always shown; detail only controls how many nodes represent each one.
 * The bridge centrality threshold is a dev setting — a lower value keeps more bridges visible at low detail.
 * Edges: only wiki edges whose both endpoints survived the node filter.
 */
let skeletonGraphData: GraphData = $derived.by(() => {
	if (skeletonDetail >= 100 || segmentBy !== "leiden" || graphData.nodes.length === 0) return graphData;

	const t = skeletonDetail / 100; // 0–1

	// Hubs per cluster: lerp from 1 at t=0 to 10 at t=1
	const hubsPerCluster = Math.max(1, Math.round(1 + t * 9));

	// Bridge centrality cutoff: at t=0 only nodes above the configured threshold qualify;
	// at t=1 any non-zero centrality qualifies (i.e. all bridges)
	const centralityThreshold = (settings.skeletonBridgeCentralityThreshold ?? 0.05) * (1 - t);

	// For each cluster, collect nodes sorted by degree descending
	const clusterNodes = new Map<number, typeof graphData.nodes>();
	for (const node of graphData.nodes) {
		if (node.cluster == null) continue;
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

// Generation guard for async continuations. Bumped by every new build and by
// onDestroy, so a slow await (buildWikiGraph tick, leidenAsync, native-settings
// read) that resolves after a newer build started — or after the view was
// closed — bails instead of writing stale state over the current graph or onto
// a destroyed component. AbortController alone was insufficient: it was only
// checked in the catch, so success-path writes ran unconditionally.
let buildVersion = 0;
let isDestroyed = false;

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
		if (isAgentFilePath(file.path)) continue;
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
	const localBuildVersion = ++buildVersion;
	isLoading = true;
	loadingMessage = "Building graph...";

	try {
		const filter = getFilter();
		const { graphData: wikiData } = buildWikiGraph(plugin.app, filter, immersePaths ?? undefined);
		// A newer build (or unmount) superseded us before we could apply.
		if (localBuildVersion !== buildVersion) return;
		graphData = wikiData;
		isLoading = false;

		// Graph structure changed — previous Leiden runs are no longer valid.
		leidenCache.clear();

		resolveAndApplySegments(graphData);
		void runLeidenSegmentation();

		await tick();
		if (localBuildVersion !== buildVersion) return;
		try {
			canvasComponent?.fitToView();
		} catch {
			/* pixi not ready */
		}
	} catch (e) {
		if (ac.signal.aborted || localBuildVersion !== buildVersion) return;
		console.error("[SmartGraph] Error building graph:", e);
		graphData = { nodes: [], edges: [] };
		isLoading = false;
	}
}

// Rebuild on filter/settings changes (debounced 300ms).
// We depend on a derived signature so the effect only fires when the tracked *values* change,
// not whenever the `settings` derived is recomputed (which happens on any settings write,
// including leidenResolution changes that should NOT trigger a rebuild).
let buildGraphSignature = $derived(
	JSON.stringify({
		folders: selectedFolders,
		tags: selectedTags,
		extensions: selectedExtensions,
		showWikiLinks: settings.showWikiLinks,
		markdownOnly: settings.markdownOnly,
	}),
);
$effect(() => {
	buildGraphSignature;
	const timer = setTimeout(() => untrack(() => void buildGraph()), 300);
	return () => clearTimeout(timer);
});

// Re-apply segment coloring when highlight toggles change (no Leiden re-run needed).
// Use a derived signature to avoid firing on every settings write — see buildGraphSignature above.
let highlightSignature = $derived(`${settings.highlightIsolated}:${settings.highlightBridges}`);
$effect(() => {
	highlightSignature;
	untrack(() => {
		if (graphData.nodes.length > 0) resolveAndApplySegments(graphData);
	});
});

/**
 * Kick a background prefetch when the outline-view Leiden inputs change (γ or seed). This makes
 * changes made from the plugin's Settings → Graph tab pick up the same prefetch behavior the
 * dev panel already has: next atom press stays instant. Guarded by a value signature so the
 * effect only fires on actual value changes (not on every `settings` derived recompute).
 */
let outlineLeidenSignature = $derived(`${settings.leidenSeed}:${settings.outlineViewResolution}`);
let outlineLeidenSignatureInitial = true;
$effect(() => {
	outlineLeidenSignature;
	untrack(() => {
		// Skip the initial run — the fresh Leiden path already prefetches on its own after buildGraph.
		if (outlineLeidenSignatureInitial) {
			outlineLeidenSignatureInitial = false;
			return;
		}
		if (graphData.nodes.length === 0) return;
		const wikiEdges = graphData.edges.filter((e) => e.type === "wiki");
		if (wikiEdges.length === 0) return;
		void prefetchOutlineLeiden(wikiEdges);
	});
});

// Load native Obsidian graph settings (color groups, physics, etc.) as fallback
readNativeGraphSettings(plugin.app).then((native) => {
	// Guard against a resolve after the view was destroyed.
	if (isDestroyed) return;
	nativeGraphSettings = native;
});

onDestroy(() => {
	// Invalidate any in-flight async build/Leiden continuations so they bail
	// instead of writing $state on a destroyed component, and abort the current
	// build.
	isDestroyed = true;
	buildVersion++;
	currentBuild?.abort();
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
	const messenger = getSessionRegistry();
	if (messenger) {
		// Ambient: mirror the live graph selection into every open chat's tray.
		messenger.graphSelection = [...paths];
	}
}

function handleLassoModeChange(active: boolean) {
	lassoMode = active;
	if (!active) {
		selectedPaths = [];
		canvasComponent?.clearSelection();
		const messenger = getSessionRegistry();
		if (messenger) {
			messenger.graphSelection = [];
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

	// Reveal an existing chat (uncollapsing its sidebar) or create one.
	const { workspace } = plugin.app;
	const existingLeaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
	if (!existingLeaf) {
		await plugin.agentManager.createNewChat();
	} else {
		workspace.revealLeaf(existingLeaf);
	}

	const messenger = getSessionRegistry();
	if (messenger) {
		// Ambient selection (shown in every chat) …
		messenger.graphSelection = [...paths];
		// … plus a one-shot signal so the just-opened/focused chat grabs focus.
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
	const messenger = getSessionRegistry();
	if (messenger) {
		messenger.graphSelection = [];
	}
}

async function handleImmerse() {
	if (selectedPaths.length === 0) return;
	immersePaths = new Set(selectedPaths);
	// Immersing rebuilds the graph to contain ONLY these notes, so "selected"
	// stops meaning anything — every remaining node is in the set. Clearing just
	// `selectedPaths` + the canvas (as this did) left the focused clusters/segments
	// and every open chat's context tray still holding the pre-immerse selection,
	// so the tray showed stale notes and dimming persisted. Reuse the full reset.
	handleClearSelection();
	await buildGraph();
}

async function handleExitImmerse() {
	immersePaths = null;
	// Leaving immerse restores the full graph; any selection made inside the
	// immersed subset refers to a different node set, so drop it too.
	handleClearSelection();
	await buildGraph();
}

async function runLeidenSegmentation() {
	const localBuildVersion = buildVersion;
	const wikiEdges = graphData.edges.filter((e) => e.type === "wiki");
	if (wikiEdges.length === 0) return;

	const cacheKey = `${settings.leidenSeed}:${settings.leidenResolution}`;
	const cached = leidenCache.get(cacheKey);
	if (cached) {
		Logger.info(`[SmartGraph] Leiden cache hit (γ=${settings.leidenResolution.toFixed(2)})`);
		leidenCommunities = cached.communities;
		leidenCentrality = cached.centrality;
		resolveAndApplySegments(graphData);
		void prefetchOutlineLeiden(wikiEdges);
		return;
	}

	const sources = wikiEdges.map((e) => e.source);
	const targets = wikiEdges.map((e) => e.target);
	const weights = wikiEdges.map((e) => e.weight);
	const start = performance.now();
	isLeidenRunning = true;
	let result: Awaited<ReturnType<typeof leidenAsync>>;
	try {
		result = await leidenAsync(sources, targets, weights, true, settings.leidenSeed, settings.leidenResolution);
	} finally {
		isLeidenRunning = false;
	}
	// The graph was rebuilt (or the view closed) while Leiden ran; its
	// communities are keyed by nodes that may no longer exist. Discard them
	// rather than applying stale segments over the current graph.
	if (localBuildVersion !== buildVersion) return;
	Logger.info(
		`[SmartGraph] Leiden (γ=${settings.leidenResolution.toFixed(2)}, ${wikiEdges.length} edges, ${graphData.nodes.length} nodes): ${Math.round(performance.now() - start)}ms`,
	);
	leidenCache.set(cacheKey, { communities: result.communities, centrality: result.centrality });
	leidenCommunities = result.communities;
	leidenCentrality = result.centrality;
	resolveAndApplySegments(graphData);
	void prefetchOutlineLeiden(wikiEdges);
}

/**
 * Background pre-compute of the outline-view Leiden result at the user-configured γ, so the
 * first atom-toggle press is instant. Does NOT touch user-facing state — only fills the cache.
 * Bails if the graph has changed while it was running.
 */
async function prefetchOutlineLeiden(wikiEdges: GraphEdge[]) {
	const outlineResolution = settings.outlineViewResolution ?? 0.5;
	const key = `${settings.leidenSeed}:${outlineResolution}`;
	if (leidenCache.has(key)) return;

	const graphSnapshotEdges = graphData.edges;
	const sources = wikiEdges.map((e) => e.source);
	const targets = wikiEdges.map((e) => e.target);
	const weights = wikiEdges.map((e) => e.weight);
	const start = performance.now();
	const result = await leidenAsync(sources, targets, weights, true, settings.leidenSeed, outlineResolution);

	// If the graph was rebuilt while we were running, the cache was cleared and our result is stale.
	if (graphSnapshotEdges !== graphData.edges) {
		Logger.info("[SmartGraph] Prefetch discarded — graph changed during compute");
		return;
	}
	Logger.info(
		`[SmartGraph] Leiden prefetch (γ=${outlineResolution.toFixed(2)}, ${wikiEdges.length} edges): ${Math.round(performance.now() - start)}ms`,
	);
	leidenCache.set(key, { communities: result.communities, centrality: result.centrality });
}

/**
 * Clear the Leiden cache and re-run at the current γ. Used when the seed changes — old
 * cached entries are no longer valid because they cluster to different communities.
 * `runLeidenSegmentation` will kick off an outline prefetch on completion; the
 * outlineLeidenSignature effect additionally prefetches if only the outline γ was changed
 * from elsewhere (e.g. the plugin's Settings → Graph tab).
 */
async function handleSeedChange() {
	leidenCache.clear();
	await runLeidenSegmentation();
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
	const messenger = getSessionRegistry();
	if (messenger) messenger.graphSelection = [...paths];
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
		// For the "Highlight bridges" toggle: a true bridge node is one where the MAJORITY of its
		// wiki-link neighbors belong to a DIFFERENT community than its own. High-degree hubs link to
		// many clusters but are firmly assigned to one — their own community dominates their neighbor
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
				// Only record centrality on nodes that structurally span communities — these are the
				// "bridges" surfaced by the Highlight bridges toggle and consumed by the Detail filter.
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
	// Guard against re-entry while a fresh Leiden run is in flight — otherwise rapid clicks
	// race on state writes and can leave the view stuck between modes.
	if (isLeidenRunning) return;

	const entering = skeletonDetail >= 100;
	if (entering) {
		// Enter outline view: collapse to fewer topics AND fewer nodes per topic.
		outlineViewPrevResolution = settings.leidenResolution ?? 1.0;
		skeletonDetail = settings.outlineViewDetail ?? 30;
		handleSettingsChange({ leidenResolution: settings.outlineViewResolution ?? 0.5 });
		await runLeidenSegmentation();
	} else {
		// Exit outline view: restore Topics to the value that was active before entering, unless
		// the user manually changed it while inside outline (in which case outlineViewPrevResolution
		// was cleared by handleTopicsCommit and we leave the current γ alone).
		skeletonDetail = 100;
		if (outlineViewPrevResolution != null) {
			handleSettingsChange({ leidenResolution: outlineViewPrevResolution });
			outlineViewPrevResolution = null;
			await runLeidenSegmentation();
		}
	}
	await tick();
	canvasComponent?.fitToView();
}

/**
 * Called when the user commits a new Topics (γ) value from the main panel. If we're currently
 * inside outline view, drop the memoised "previous" γ so exiting no longer clobbers the user's
 * manual choice — from now on, outline exit will leave γ where it is.
 */
function handleTopicsCommit(resolution: number) {
	handleSettingsChange({ leidenResolution: resolution });
	if (skeletonDetail < 100) outlineViewPrevResolution = null;
	void runLeidenSegmentation();
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
      showClusterLabels={settings.showClusterLabels ?? true}
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

  {#if isImmersed || selectedPaths.length > 0}
    <div class="graph-selection-bar">
      <span class="selection-count">
        {#if selectedPaths.length > 0}
          {selectedPaths.length} notes selected{isImmersed ? " · immersed" : ""}
        {:else}
          {graphData.nodes.length} notes · immersed
        {/if}
      </span>
      <div class="selection-actions">
        {#if selectedPaths.length > 0}
          <Button iconId="scan" onClick={handleZoomToSelection} tooltip="Zoom to selection (F)" />
          <Button buttonText="Immerse" onClick={handleImmerse} tooltip="Rebuild graph with selected notes only" />
          <Button buttonText="Open all" onClick={handleOpenAllSelected} tooltip="Open all selected notes in new tabs" />
          {#if !hasOpenChat}
            <Button
              buttonText="Open in chat"
              onClick={handleSendToChat}
              tooltip="Reveal the chat and attach the selected notes"
            />
          {/if}
          <Button buttonText="Clear" onClick={handleClearSelection} tooltip="Clear selection (Esc)" />
        {:else}
          <Button buttonText="Exit" onClick={handleExitImmerse} tooltip="Exit immerse (Esc)" />
        {/if}
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
    onReapplySegments={() => resolveAndApplySegments(graphData)}
    onSeedChange={() => void handleSeedChange()}
    onTopicsCommit={handleTopicsCommit}
    isLeidenRunning={isLeidenRunning}
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

  /* Obsidian's mobile navbar floats over the bottom of the view, covering the
     last ~84px of the canvas — nodes that settle down there (isolated ones
     especially) end up under it and can't be tapped. Reserve the navbar's
     height the same way the chat composer does, so the graph's usable area
     ends above it. */
  :global(.is-mobile) .smart-graph-view {
    height: calc(100% - (52px + env(safe-area-inset-bottom)));
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

  /* On a phone the centered, nowrap bar overflows both screen edges — the
     buttons past the viewport can't be tapped. Pin it to the safe width,
     let the count + actions wrap, and let the actions fill the row so every
     button stays on-screen and comfortably tappable. */
  :global(.is-mobile) .graph-selection-bar {
    left: 8px;
    right: 8px;
    transform: none;
    max-width: none;
    flex-wrap: wrap;
    justify-content: center;
    white-space: normal;
    /* Sit clear of Obsidian's floating mobile navbar (a ~52px pill anchored to
       the bottom with a gap below it — it occupies ~84px of the viewport
       bottom and floats over the full-height graph canvas). Obsidian exposes
       no reliable height var for it, so clear it with a fixed offset plus any
       device safe-area inset. */
    bottom: calc(92px + var(--safe-area-inset-bottom, 0px));
  }

  :global(.is-mobile) .selection-actions {
    flex-wrap: wrap;
    justify-content: center;
  }
</style>
