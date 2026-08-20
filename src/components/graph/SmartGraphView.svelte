<script lang="ts">
import { untrack, tick, onDestroy } from "svelte";
import { getAllTags, Notice, type WorkspaceLeaf } from "obsidian";
import { getPlugin } from "../../stores/state.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getIndexableVaultFiles, isAgentFilePath } from "../../utils/fileFiltering";
import { Logger } from "../../utils/logging";
import { isMobileUI } from "../../utils/platform";
import { ConfirmModal } from "../modal/ConfirmModal";
import {
	type GraphData,
	type GraphEdge,
	type GraphNode,
	type SpaceSegment,
	type SmartGraphSettings,
	DEFAULT_SMART_GRAPH_SETTINGS,
	generateClusterColors,
	THEME_COLOR_VARS,
} from "../../types/graph";
import {
	buildWikiGraph,
	buildSemanticEdges,
	readNativeGraphSettings,
	resolveSegments,
	type GraphFilter,
} from "../../views/smart-graph/graphDataBuilder";
import { getVectorStoreService, waitForVectorStore, waitForVectorStoreIndex } from "../../vectorstore";
import { labelTopics } from "../../views/smart-graph/topicLabeler";
import {
	buildTopicHierarchy,
	coarseResolutionFor,
	deriveGranularityLadder,
	maxGranularityLevel,
	MIN_GRANULARITY_LEVEL,
	resolutionToGranularity,
	summarizePartition,
	GRANULARITY_LEVEL_RESOLUTIONS,
	GRANULARITY_PROBE_RESOLUTIONS,
	granularityToResolution,
	type TopicHierarchy,
} from "../../utils/topicHierarchy";
import { edgeKey } from "../../utils/graphUtils";
import { buildCollapsedGraph, UNSORTED_CLUSTER } from "../../utils/mergeNodes";
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

/** Fine topic → parent topic nesting derived from the two levels. */
let topicHierarchy: TopicHierarchy | null = $state(null);

/**
 * The granularity slider's rungs for this vault, derived by probing (see
 * {@link deriveGranularityLevels}). Holds the static fallback until probing lands; the
 * slider stays hidden until then so its range never changes under the user.
 */
let granularityLadder: number[] = $state([...GRANULARITY_LEVEL_RESOLUTIONS]);

/**
 * True once probing has settled the ladder for the current graph. Gates both the
 * slider's appearance and the probe itself, so dragging can't re-trigger it.
 */
let hasDerivedGranularityLadder = $state(false);

/** Guards against overlapping probe runs while one is already in flight. */
let isDerivingGranularityLadder = false;

/**
 * Set after a build's initial fit, cleared when the first topics arrive.
 *
 * The initial fit necessarily frames a graph that has no topics yet; once Leiden
 * assigns them the cluster force reshapes everything, so the camera needs one
 * more pass to follow.
 */
let refitAfterTopicsSettle = false;

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

/**
 * Upper bound on notes for semantic edge building.
 *
 * Neighbour search is HNSW-accelerated past ~2k chunks (see
 * `computeSemanticPairs`), so the old O(n²) time wall is gone. What remains is
 * memory: every chunk vector is copied into the compute worker, roughly
 * notes × chunks-per-note × dim × 4 bytes — on the order of 150 MB at this cap
 * with dim 1024. Past it the transfer itself becomes the problem and the graph
 * stays wiki-only.
 */
const SEMANTIC_EDGE_MAX_NOTES = 20000;

/**
 * Scales cosine similarity into the same range as authored-link weights for
 * community detection. Below 1.0 so an explicit `[[link]]` stays the stronger
 * statement about how two notes relate.
 */
const SEMANTIC_LEIDEN_WEIGHT = 0.7;

/**
 * Colour for the folded "Unsorted" node — deliberately neutral so it reads as
 * leftovers rather than as another topic competing for attention.
 */
const UNSORTED_NODE_COLOR = "hsl(0, 0%, 55%)";

// Detail level 0–100: 100 = full graph, <100 = skeleton backbone (fewer nodes per topic)
let skeletonDetail = $state(100);

// Topics are always segmented by Leiden community; there is no other mode.
let segments: SpaceSegment[] = $state([]);
let focusedSegmentIds: Set<string> = $state(new Set());

/** LLM-generated topic names, keyed by topic id. Overrides the hub-filename default. */
let generatedClusterLabels: Record<number, string> = $state({});
/** True while topic labels are being generated. */
let isLabeling = $state(false);
/**
 * Cache of membership-signature → generated label, so re-running Leiden at the
 * same grouping (or toggling outline back and forth) doesn't re-spend API calls.
 */
let topicLabelCache = new Map<string, string>();
/** Aborts an in-flight labeling pass when the graph changes underneath it. */
let labelingAbort: AbortController | null = null;

let effectiveClusterLabels: Record<number, string> = $derived({
	...defaultClusterLabels,
	...generatedClusterLabels,
});

/**
 * `segments` with the current topic names applied.
 *
 * The label baked into a segment is the hub-filename default, fixed at the
 * moment Leiden resolved. AI names arrive later and only ever landed in
 * `effectiveClusterLabels`, so the canvas pills renamed themselves while the
 * panel's list kept the old names. Deriving the panel's copy keeps one source of
 * truth for what a topic is called. A segment's index *is* its cluster id (they
 * are assigned `cluster: i` from this same array in `resolveAndApplySegments`).
 */
let labeledSegments: SpaceSegment[] = $derived(
	segments.map((segment, cluster) => {
		const label = effectiveClusterLabels[cluster];
		return label === undefined || label === segment.label ? segment : { ...segment, label };
	}),
);

let graphData: GraphData = $state({ nodes: [], edges: [] });

/**
 * Which topics are folded into a single node.
 *
 * Collapse is per-topic: clicking a topic's label folds just that group, and
 * the atom button is a shortcut that folds or unfolds them all at once. Tracking
 * the collapsed set directly (rather than a global flag plus exceptions) keeps
 * the two entry points consistent — whatever the user does, this set is the
 * single answer to "what is folded right now".
 *
 * Independent of granularity: granularity decides *how many* topics exist, this decides
 * whether each is drawn as a group or as its notes.
 */
let collapsedTopics: Set<number> = $state(new Set());

/** All topic ids currently present, for collapse-all / expand-all. */
let allTopicIds: number[] = $derived.by(() => {
	const ids = new Set(graphData.nodes.map((node) => node.cluster).filter((c): c is number => c != null));
	// Notes with no topic are foldable too — in the merged view they'd otherwise
	// sit among the topic nodes looking like topics of their own.
	if (graphData.nodes.some((node) => node.cluster == null)) ids.add(UNSORTED_CLUSTER);
	return [...ids].sort((a, b) => a - b);
});

/**
 * Collapse-all as a *mode* rather than an enumerated set.
 *
 * Storing "every id at the time you pressed it" breaks under granularity: changing γ
 * re-runs Leiden, which both invents new topics and renumbers existing ones, so
 * a stored id set stops describing the graph almost immediately. As a mode, any
 * topic the new resolution produces is collapsed too — which is what the button
 * claims to mean.
 *
 * `expandedTopics` holds the exceptions the user has opened by hand.
 */
let collapseAll = $state(false);
/** Topics explicitly opened while collapse-all is on. */
let expandedTopics: Set<number> = $state(new Set());

/** The effective collapsed set for the current graph. */
let effectiveCollapsedTopics: Set<number> = $derived(
	collapseAll ? new Set(allTopicIds.filter((id) => !expandedTopics.has(id))) : collapsedTopics,
);

/** True when the graph is in collapse-all mode — drives the atom button. */
let isTopicsCollapsed = $derived(collapseAll);

/**
 * Collapse/expand in the selection bar acts on whole *topics*, so it's offered
 * only for a topic selection (`focusedClusters`), not an arbitrary lasso — a
 * freehand selection that happens to cover a topic's notes isn't the same as
 * choosing that topic, and folding it would surprise.
 *
 * The button expands when every selected topic is already collapsed, and
 * collapses otherwise, so a mixed selection resolves to one obvious action.
 */
let selectedTopicsCollapseAction: "collapse" | "expand" | null = $derived.by(() => {
	if (focusedClusters.size === 0) return null;
	const allCollapsed = [...focusedClusters].every((c) => effectiveCollapsedTopics.has(c));
	return allCollapsed ? "expand" : "collapse";
});

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
	if (skeletonDetail >= 100 || graphData.nodes.length === 0) return graphData;

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

/** The graph actually rendered: rolled up, thinned by Detail, or as-is. */
/**
 * The graph as rendered: topics collapsed to single nodes, thinned by Detail, or
 * as-is.
 *
 * Collapse is applied *after* the Detail filter so the two remain independent —
 * collapsing is about altitude, thinning is about density.
 */
let displayGraphData: GraphData = $derived.by(() => {
	const base = skeletonDetail < 100 ? skeletonGraphData : graphData;
	if (effectiveCollapsedTopics.size === 0) return base;
	return buildCollapsedGraph(base, {
		collapsedTopics: effectiveCollapsedTopics,
		topicLabels: effectiveClusterLabels,
		collapseUnsorted: true,
		unsortedColor: UNSORTED_NODE_COLOR,
	});
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
 * Fetch semantic similarity edges for the current node set.
 *
 * Returns an empty list (rather than throwing) whenever embeddings aren't
 * usable — no graph index configured, the store never came up, or the index
 * hasn't finished building. The graph stays wiki-only in that case.
 */
async function loadSemanticEdges(wikiData: GraphData, localBuildVersion: number): Promise<GraphEdge[]> {
	if (!data.graphEmbedIndex) return [];
	if (wikiData.nodes.length < 2 || wikiData.nodes.length > SEMANTIC_EDGE_MAX_NOTES) return [];

	const serviceReady = await waitForVectorStore();
	if (!serviceReady || localBuildVersion !== buildVersion) return [];

	const indexReady = await waitForVectorStoreIndex(data.graphEmbedIndex);
	if (!indexReady || localBuildVersion !== buildVersion) return [];

	const documents = await getVectorStoreService().getAllDocumentVectors();
	if (localBuildVersion !== buildVersion || documents.length === 0) return [];

	// Only connect notes that are actually on screen, and never duplicate a pair
	// the user already linked by hand.
	const includePaths = new Set(wikiData.nodes.map((node) => node.path));
	const wikiEdgeKeys = new Set(wikiData.edges.map((edge) => edgeKey(edge.source, edge.target)));

	return buildSemanticEdges(documents, includePaths, {
		neighborCount: settings.semanticNeighborCount,
		threshold: settings.semanticThreshold,
		excludeEdgeKeys: wikiEdgeKeys,
	});
}

/**
 * Build the graph structure and apply topic assignments.
 *
 * The wiki graph paints immediately so the view is never blank, then semantic
 * edges are fused in once embeddings resolve and Leiden runs over the union.
 * Topic detection therefore sees inferred relationships too, which is what lets
 * unlinked notes land in a topic at all.
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
		topicHierarchy = null;
		granularityLadder = [...GRANULARITY_LEVEL_RESOLUTIONS];
		// The ladder describes the old graph; hide the slider until it's re-derived.
		hasDerivedGranularityLadder = false;
		// A pending refit belongs to the build being replaced.
		refitAfterTopicsSettle = false;

		// Paint the authored graph right away so the view isn't blank while
		// embeddings load, then refine it once semantic edges arrive.
		resolveAndApplySegments(graphData);

		let semanticEdges: GraphEdge[] = [];
		try {
			semanticEdges = await loadSemanticEdges(wikiData, localBuildVersion);
		} catch (error) {
			// Embeddings are an enhancement, not a requirement — degrade to wiki-only.
			console.error("[SmartGraph] Failed to build semantic edges:", error);
		}
		if (localBuildVersion !== buildVersion) return;

		if (semanticEdges.length > 0) {
			const fused = { ...wikiData, edges: [...wikiData.edges, ...semanticEdges] };
			// Degree drives node size and the Detail filter's hub ranking. Recompute it
			// over the fused edge set so semantically-central notes read as hubs too.
			const degreeMap = new Map<string, number>();
			for (const edge of fused.edges) {
				degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
				degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
			}
			graphData = {
				...fused,
				nodes: fused.nodes.map((node) => ({ ...node, degree: degreeMap.get(node.path) ?? 0 })),
			};
			resolveAndApplySegments(graphData);
		}

		void runLeidenSegmentation();

		await tick();
		if (localBuildVersion !== buildVersion) return;
		try {
			canvasComponent?.fitToView();
		} catch {
			/* pixi not ready */
		}
		// The fit above frames the graph as it looks *before* topics exist. Leiden
		// is still running, and once it assigns communities the cluster-cohesion
		// force pulls the layout into a visibly different shape — so that first fit
		// is already stale and nodes drift out of view. Re-frame once the topics
		// have actually landed.
		refitAfterTopicsSettle = true;
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
		// Semantic edges are computed during the build, so changing how they're
		// derived needs a rebuild (unlike `showSemanticLinks`, which only hides them).
		semanticNeighborCount: settings.semanticNeighborCount,
		semanticThreshold: settings.semanticThreshold,
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
 * Re-run community detection when the user switches between fused and link-only
 * topics. Cached per mode, so flipping back and forth is instant after the first
 * run of each.
 */
let linkOnlyTopicsSignature = $derived(settings.linkOnlyTopics);
let linkOnlyTopicsInitial = true;
$effect(() => {
	linkOnlyTopicsSignature;
	untrack(() => {
		if (linkOnlyTopicsInitial) {
			linkOnlyTopicsInitial = false;
			return;
		}
		if (graphData.nodes.length === 0) return;
		// The ladder's rungs are the groupings *these* edges support, so switching
		// between fused and link-only invalidates them: link-only sees far fewer
		// edges and usually supports fewer distinct levels. Re-derive rather than
		// leave the slider offering levels the current edge set can't produce.
		hasDerivedGranularityLadder = false;
		void runLeidenSegmentation();
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
	labelingAbort?.abort();
});

/**
 * Drop every piece of state recorded against topic *numbers*.
 *
 * Cluster ids are size-sorted positions in a fresh partition, so "topic 3"
 * before and after a re-run are unrelated groups. Anything holding an id — a
 * fold, a focus, a selection — would silently reattach to the wrong topic.
 *
 * `collapseAll` survives deliberately: it's a mode, not an id, so it still means
 * what it says under any numbering.
 */
function clearTopicIndexedState() {
	if (collapsedTopics.size > 0) collapsedTopics = new Set();
	if (expandedTopics.size > 0) expandedTopics = new Set();
	// Focus and selection are id-keyed too — leaving them would highlight whichever
	// unrelated group inherited the number.
	if (focusedClusters.size > 0 || focusedSegmentIds.size > 0 || selectedPaths.length > 0) {
		handleClearSelection();
	}
}

// Handlers
function handleSettingsChange(partial: Partial<SmartGraphSettings>) {
	// Compared as partition identities rather than field-by-field: resolution,
	// seed and link-mode each re-run Leiden and renumber every topic, so keying
	// the reset off the key itself covers all three (and anything added later)
	// instead of relying on this list staying complete.
	const previousKey = currentPartitionKey();
	data.smartGraphSettings = { ...settings, ...partial };
	if (currentPartitionKey() !== previousKey) clearTopicIndexedState();
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

/**
 * Focus a topic and select its notes.
 *
 * `pan` is opt-in because the callers want opposite things: the "Focus on this
 * cluster" context-menu item exists to fly the camera there, while clicking a
 * topic label is a selection gesture — moving the view between clicks would
 * push the next label you meant to click off-screen.
 *
 * `multi` mirrors `handleFocusSegment`: plain click replaces the selection
 * (or clears it if this was the only one), Shift/⌘ toggles membership.
 */
function handleFocusCluster(cluster: number, pan = false, multi = true) {
	const next = new Set(focusedClusters);
	if (multi) {
		if (next.has(cluster)) next.delete(cluster);
		else next.add(cluster);
	} else if (next.size === 1 && next.has(cluster)) {
		next.clear();
	} else {
		next.clear();
		next.add(cluster);
	}
	focusedClusters = next;

	// Selecting a topic by its label and by its panel row are the same act, so keep
	// the panel's highlighted rows in step. `node.cluster` is the index into
	// `segments` (assigned as `cluster: i` in resolveAndApplySegments), so the id
	// is a direct lookup.
	focusedSegmentIds = new Set([...next].flatMap((c) => (segments[c] ? [segments[c].id] : [])));

	// Sync selection: select all nodes belonging to any focused cluster
	if (next.size > 0) {
		const paths = canvasComponent?.getNodePathsForClusters(next) ?? [];
		canvasComponent?.selectNodesByPaths(paths);
		handleSelectionChange(paths);
		if (pan) canvasComponent?.panToClusters(next);
	} else {
		handleSelectionChange([]);
		canvasComponent?.clearSelection();
	}
}

/**
 * Adopt a new selection: the single place that records it and mirrors it out.
 *
 * Every path that changes the selection routes through here — canvas lasso,
 * topic label, panel row — so the graph and each open chat's context tray can
 * never disagree about what is selected.
 */
function handleSelectionChange(paths: string[]) {
	selectedPaths = paths;
	const messenger = getSessionRegistry();
	if (messenger) {
		// Ambient: mirror the live graph selection into every open chat's tray.
		messenger.graphSelection = [...paths];
	}
}

function handleLassoModeChange(active: boolean) {
	lassoMode = active;
	if (!active) {
		canvasComponent?.clearSelection();
		handleSelectionChange([]);
	}
}

/**
 * Notes above which "Open all" asks first. Opening a tab per note has no undo,
 * and this is now reachable from a single keypress — a stray `O` on a 76-note
 * topic would bury the workspace.
 */
const OPEN_ALL_CONFIRM_THRESHOLD = 10;

// Touch devices have no keyboard, so don't advertise shortcuts they can't press.
const onMobile = isMobileUI();
/** Append a shortcut hint to a tooltip on desktop only. */
const withKey = (tooltip: string, key: string) => (onMobile ? tooltip : `${tooltip} (${key})`);

/**
 * Open a set of notes in tabs, confirming first past the threshold.
 *
 * Shared by the selection bar's "Open all" and a collapsed topic's context
 * menu — the latter routinely covers a whole topic, so it needs the guard at
 * least as much.
 */
async function handleOpenPaths(paths: string[]) {
	if (paths.length === 0) return;

	if (paths.length > OPEN_ALL_CONFIRM_THRESHOLD) {
		const modal = new ConfirmModal(
			plugin.app,
			"Open all notes",
			`This opens ${paths.length} notes in new tabs. Closing them again is manual.`,
			`Open ${paths.length} tabs`,
		);
		modal.open();
		if (!(await modal.promise)) return;
	}

	for (const path of paths) {
		plugin.app.workspace.openLinkText(path, "", "tab");
	}
}

function handleOpenAllSelected() {
	void handleOpenPaths(selectedPaths);
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
	focusedClusters = new Set();
	focusedSegmentIds = new Set();
	canvasComponent?.clearSelection();
	handleSelectionChange([]);
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

/**
 * Weight an edge for community detection on a common scale.
 *
 * Wiki weights are link counts (1, 2, 3…) while semantic weights are cosine
 * similarities (~0.55–1.0), so the raw values aren't comparable — passing them
 * through unchanged would let a single authored link dominate a strong semantic
 * match. Authored links are deliberately kept the stronger signal, with repeat
 * links damped so one heavily-linked pair can't swamp a topic.
 */
function leidenWeight(edge: GraphEdge): number {
	if (edge.type === "wiki") return 1 + Math.log2(Math.max(1, edge.weight));
	return edge.weight * SEMANTIC_LEIDEN_WEIGHT;
}

/**
 * The edges community detection runs over.
 *
 * Normally authored *and* inferred — that fusion is what lets notes with no wiki
 * links land in a topic. In link-only mode inferred edges are excluded so the
 * topics reflect nothing but the user's own linking.
 */
function getTopicEdges(): GraphEdge[] {
	return graphData.edges.filter((e) =>
		settings.linkOnlyTopics ? e.type === "wiki" : e.type === "wiki" || e.type === "semantic",
	);
}

/**
 * Cache key for one Leiden partition — the seed, resolution and edge mode fully
 * determine the result, so this doubles as an identity for "which grouping is
 * this". Link-only results must never share a slot with fused ones.
 */
function partitionKey(
	resolution: number,
	linkOnly = settings.linkOnlyTopics,
	seed: number = settings.leidenSeed,
): string {
	return `${seed}:${resolution}:${linkOnly ? "wiki" : "fused"}`;
}

/** The partition the controls are currently asking for. */
function currentPartitionKey(): string {
	return partitionKey(settings.leidenResolution);
}

async function runLeidenSegmentation() {
	const localBuildVersion = buildVersion;
	const topicEdges = getTopicEdges();
	if (topicEdges.length === 0) {
		// Link-only mode on a vault with no links at all: clear stale communities so
		// the graph honestly shows "nothing is linked" instead of the fused result.
		if (settings.linkOnlyTopics) {
			leidenCommunities = {};
			leidenCentrality = {};
			resolveAndApplySegments(graphData);
		}
		return;
	}

	const cacheKey = currentPartitionKey();
	const cached = leidenCache.get(cacheKey);
	if (cached) {
		Logger.info(`[SmartGraph] Leiden cache hit (γ=${settings.leidenResolution.toFixed(2)})`);
		leidenCommunities = cached.communities;
		leidenCentrality = cached.centrality;
		resolveAndApplySegments(graphData);
		// The hierarchy and the granularity ladder describe the *graph*, not the current γ,
		// so they're computed once per build. Re-running them here would fire on
		// every step of a slider drag, which is exactly the hot path.
		void computeTopicHierarchy(topicEdges);
		if (!hasDerivedGranularityLadder) void deriveGranularityLevels(topicEdges);
		return;
	}

	const sources = topicEdges.map((e) => e.source);
	const targets = topicEdges.map((e) => e.target);
	const weights = topicEdges.map(leidenWeight);
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
		`[SmartGraph] Leiden (γ=${settings.leidenResolution.toFixed(2)}, ${topicEdges.length} edges, ${graphData.nodes.length} nodes): ${Math.round(performance.now() - start)}ms`,
	);
	// Always worth caching — the result is correct for the settings it ran under,
	// even if those are no longer the ones on screen.
	leidenCache.set(cacheKey, { communities: result.communities, centrality: result.centrality });
	// …but only *apply* it if those settings are still current. `buildVersion`
	// alone can't tell: it tracks graph rebuilds, while γ, seed and link-mode all
	// change the partition without touching the graph. A slow run started at one γ
	// would otherwise land after the user moved to another (served instantly from
	// cache) and quietly replace it, leaving the controls describing a grouping
	// the canvas isn't showing.
	if (currentPartitionKey() !== cacheKey) {
		Logger.info("[SmartGraph] Discarding a Leiden result the settings have moved past");
		return;
	}
	leidenCommunities = result.communities;
	leidenCentrality = result.centrality;
	resolveAndApplySegments(graphData);
	void computeTopicHierarchy(topicEdges);
	void deriveGranularityLevels(topicEdges);
}

/**
 * Derive this vault's granularity ladder by probing candidate resolutions.
 *
 * How many *distinct* groupings a vault supports depends on its size and
 * structure — a fixed ladder is right for one vault and wrong for the next. So
 * each γ is run once and only those producing a new topic count become rungs;
 * the slider then has exactly as many steps as there are real groupings.
 *
 * Every probe also fills the Leiden cache, so this pays for itself: after it
 * finishes, moving the slider is instant at every level.
 */
async function deriveGranularityLevels(topicEdges: GraphEdge[]) {
	if (isDerivingGranularityLadder || hasDerivedGranularityLadder) return;
	isDerivingGranularityLadder = true;

	const localBuildVersion = buildVersion;
	// Captured once, and used for every probe below. The loop awaits between
	// rungs, so reading these live would let a mid-loop change split the ladder
	// across two partitions — and, because they also form the cache key, file
	// old-seed results under the new seed. One ladder must describe one partition.
	const linkOnly = settings.linkOnlyTopics;
	const seed = settings.leidenSeed;
	const sources = topicEdges.map((e) => e.source);
	const targets = topicEdges.map((e) => e.target);
	const weights = topicEdges.map(leidenWeight);

	const probes: Array<{ resolution: number; topicCount: number; isFragmented: boolean }> = [];
	const start = performance.now();

	try {
		for (const resolution of GRANULARITY_PROBE_RESOLUTIONS) {
			if (localBuildVersion !== buildVersion) return;

			const cacheKey = partitionKey(resolution, linkOnly, seed);
			let communities = leidenCache.get(cacheKey)?.communities;
			if (!communities) {
				try {
					const result = await leidenAsync(sources, targets, weights, false, seed, resolution);
					if (localBuildVersion !== buildVersion) return;
					leidenCache.set(cacheKey, { communities: result.communities, centrality: result.centrality });
					communities = result.communities;
				} catch (error) {
					// A failed probe just means one fewer candidate rung.
					Logger.error(`[SmartGraph] Granularity probe failed at γ=${resolution}:`, error);
					continue;
				}
			}
			probes.push({ resolution, ...summarizePartition(communities) });
		}

		if (localBuildVersion !== buildVersion) return;
		// The rungs describe the partition the probes ran under. If the seed or the
		// link mode moved on, publishing them would give the slider levels derived
		// from a grouping that is no longer on screen — and because the probes seed
		// the cache under the old partition, dragging would then hit misses and
		// skip levels.
		//
		// Re-probing has to happen from here. Whatever changed already called
		// `runLeidenSegmentation`, and that call's `deriveGranularityLevels` was
		// turned away by the `isDerivingGranularityLadder` guard while this run held
		// it — so nothing else is left to rebuild the ladder.
		if (linkOnly !== settings.linkOnlyTopics || seed !== settings.leidenSeed) {
			Logger.info("[SmartGraph] Re-probing the granularity ladder: the partition changed mid-derivation");
			isDerivingGranularityLadder = false;
			void deriveGranularityLevels(getTopicEdges());
			return;
		}

		const ladder = deriveGranularityLadder(probes);
		if (ladder) {
			granularityLadder = ladder;
			Logger.info(
				`[SmartGraph] Granularity ladder: ${ladder.length} levels (γ ${ladder.map((g) => g.toFixed(2)).join(", ")}) in ${Math.round(performance.now() - start)}ms`,
			);
		} else {
			// Too few distinct groupings to build a ladder from — keep the fallback,
			// but still reveal the slider so the control isn't withheld forever.
			Logger.info("[SmartGraph] Granularity ladder: too few distinct groupings, keeping the default");
		}
		hasDerivedGranularityLadder = true;
	} finally {
		isDerivingGranularityLadder = false;
	}
}

/**
 * Compute the parent level of the topic hierarchy.
 *
 * Runs Leiden a second time at a lower γ over the same edges, then nests the
 * current (fine) topics inside the result. This is what lets the outline view
 * roll notes *up* into a broader topic instead of hiding them.
 *
 * Failure is non-fatal: without a hierarchy the graph simply stays single-level.
 */
async function computeTopicHierarchy(topicEdges: GraphEdge[]) {
	const localBuildVersion = buildVersion;
	const fineResolution = settings.leidenResolution ?? 1.0;
	const coarseResolution = coarseResolutionFor(fineResolution);
	const cacheKey = partitionKey(coarseResolution);
	// The hierarchy nests the *live* `leidenCommunities` inside the coarse result
	// computed here, so the two have to come from the same partition. Remember
	// which one that is: the coarse Leiden below may await long enough for γ, the
	// seed or the link mode to move on.
	const finePartition = currentPartitionKey();

	let communities: Record<string, number>;
	const cached = leidenCache.get(cacheKey);
	if (cached) {
		communities = cached.communities;
	} else {
		try {
			const result = await leidenAsync(
				topicEdges.map((e) => e.source),
				topicEdges.map((e) => e.target),
				topicEdges.map(leidenWeight),
				false,
				settings.leidenSeed,
				coarseResolution,
			);
			if (localBuildVersion !== buildVersion) return;
			leidenCache.set(cacheKey, { communities: result.communities, centrality: result.centrality });
			communities = result.communities;
		} catch (error) {
			Logger.error("[SmartGraph] Coarse Leiden failed; hierarchy unavailable:", error);
			return;
		}
	}

	if (localBuildVersion !== buildVersion) return;
	// Pairing this coarse partition with a fine one it never nested under would
	// describe a parent structure that matches neither the controls nor the
	// canvas. The run triggered by whatever changed will rebuild it.
	if (currentPartitionKey() !== finePartition) {
		Logger.info("[SmartGraph] Discarding a hierarchy whose fine partition has moved on");
		return;
	}
	topicHierarchy = buildTopicHierarchy(communities, leidenCommunities);
	Logger.info(
		`[SmartGraph] Hierarchy: ${topicHierarchy.children.length} topics under ${topicHierarchy.parents.size} parents (γ ${coarseResolution.toFixed(2)} → ${fineResolution.toFixed(2)})`,
	);
}

/**
 * Clear the Leiden cache and re-run at the current γ. Used when the seed changes — old
 * cached entries are no longer valid because they cluster to different communities.
 * The granularity ladder is re-derived too, since its rungs came from the old seed.
 */
async function handleSeedChange() {
	leidenCache.clear();
	hasDerivedGranularityLadder = false;
	await runLeidenSegmentation();
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

	// Mirror into `focusedClusters` so the canvas agrees about which topics are
	// focused however the selection was made — panel row or topic label.
	const clusters = new Set<number>();
	for (const id of next) {
		const index = segments.findIndex((s) => s.id === id);
		if (index !== -1) clusters.add(index);
	}
	focusedClusters = clusters;

	// Resolve through the canvas rather than reading `segment.paths` directly: a
	// collapsed topic is one synthetic node standing for its members, and only the
	// canvas can map it back to real note paths. Reading the segment would hand
	// chat the pre-collapse paths, so a row click and a label click — the same act
	// — would disagree the moment a topic was folded.
	const paths = canvasComponent?.getNodePathsForClusters(clusters) ?? [];
	canvasComponent?.selectNodesByPaths(paths);
	handleSelectionChange(paths);
	// A plain row click is "take me to this topic", so framing it helps. A
	// Shift/⌘ click is building a multi-selection — moving the view mid-gesture
	// would shift the rows and labels the user is still aiming at.
	if (!multi) canvasComponent?.panToSelection();
}

/**
 * Resolve Leiden community segments from current graphData and apply coloring + centrality.
 */
function resolveAndApplySegments(gd: GraphData) {
	const themeColors = resolveThemeColors();
	const resolved = resolveSegments(plugin.app, gd, "leiden", {
		clusterMap: new Map(),
		clusterLabels: effectiveClusterLabels,
		themeColors,
		leidenCommunities,
	});
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
	const isLeiden = Object.keys(leidenCentrality).length > 0;
	// Paths touched by at least one authored wiki link — drives the isolated highlight.
	const linkedPaths = new Set<string>();
	for (const edge of gd.edges) {
		if (edge.type !== "wiki") continue;
		linkedPaths.add(edge.source);
		linkedPaths.add(edge.target);
	}
	if (resolved.length > 0) {
		// For the "Highlight bridges" toggle: a true bridge node is one where the MAJORITY of its
		// neighbors belong to a DIFFERENT community than its own. High-degree hubs link to
		// many clusters but are firmly assigned to one — their own community dominates their neighbor
		// vote, so they don't qualify. Only nodes that are structurally "between" communities do.
		// Both edge types count here, matching the Leiden input: a note that ties two topics together
		// by topic rather than by an authored link is exactly as much a bridge.
		const isTopicEdge = (edge: GraphEdge) => edge.type === "wiki" || edge.type === "semantic";
		let bridgeNodes: Set<string> | null = null;
		if (isLeiden) {
			// Build neighbor community vote counts per node
			const neighborCommunityVotes = new Map<string, Map<number, number>>();
			for (const edge of gd.edges) {
				if (!isTopicEdge(edge)) continue;
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
			// Count total topic-edge degree per node
			const wikiDegree = new Map<string, number>();
			for (const edge of gd.edges) {
				if (!isTopicEdge(edge)) continue;
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
				// "Isolated" means the user never linked this note — a note pulled into a
				// topic purely by semantic similarity is still unlinked, and that's exactly
				// the gap worth surfacing. So this counts authored links only, not `degree`
				// (which now includes inferred edges).
				const isIsolated = !linkedPaths.has(n.path);
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
		// Topic membership changed, so previously generated names may describe a
		// grouping that no longer exists. Drop them and (if enabled) re-label —
		// the cache means unchanged topics don't cost another call.
		generatedClusterLabels = {};
		if (settings.autoLabelClusters && settings.graphChatModel) {
			void runTopicLabeling();
		}
		// First *real* topics of this build have landed: the cluster force is about
		// to reshape the layout, so track it rather than leaving the camera on the
		// pre-topic framing. Requires actual communities — the early wiki-only
		// passes resolve segments before Leiden has produced any.
		if (refitAfterTopicsSettle && Object.keys(leidenCommunities).length > 0) {
			refitAfterTopicsSettle = false;
			void tick().then(() => canvasComponent?.followLayout());
		}
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

/**
 * Generate concept names for the current topics via the configured graph model.
 *
 * Notes are offered to the model in hub-first order (same ranking the default
 * label uses), so the most central notes describe the topic. Cheap and safe to
 * call repeatedly: unchanged topics are served from cache.
 */
async function runTopicLabeling() {
	if (!settings.graphChatModel || segments.length === 0) return;

	labelingAbort?.abort();
	const controller = new AbortController();
	labelingAbort = controller;
	const localBuildVersion = buildVersion;

	// Rank each topic's notes by degree so the titles we send are representative.
	const nodesByPath = new Map(graphData.nodes.map((node) => [node.path, node]));
	const topics = segments.map((segment, index) => {
		const titles = [...segment.paths]
			.map((path) => nodesByPath.get(path))
			.filter((node): node is GraphNode => node != null)
			.sort((left, right) => (right.degree ?? 0) - (left.degree ?? 0) || left.label.localeCompare(right.label))
			.map((node) => node.label);
		return { id: index, titles, fallbackLabel: segment.label };
	});

	isLabeling = true;
	try {
		const labels = await labelTopics(topics, settings.graphChatModel, {
			signal: controller.signal,
			cache: topicLabelCache,
		});
		// A rebuild (or unmount) landed while we were waiting — these labels are
		// keyed to topic ids that may no longer mean the same thing.
		if (controller.signal.aborted || localBuildVersion !== buildVersion) return;
		generatedClusterLabels = labels;
	} finally {
		if (labelingAbort === controller) {
			isLabeling = false;
			labelingAbort = null;
		}
	}
}

/** Manual "Label topics" action — ignores the auto toggle. */
function handleLabelTopics() {
	if (!settings.graphChatModel) {
		new Notice("Select a graph chat model in Settings → Graph to name topics.");
		return;
	}
	void runTopicLabeling();
}

// ─── Saved Views ─────────────────────────────────────────

function handleClearFocusedClusters() {
	handleClearSelection();
}

/**
 * Jump between the broadest topic level and wherever the user last was.
 *
 * This is a shortcut for dragging the Granularity slider to its left end —
 * pressing it again returns to the previous level. Every note stays on screen
 * either way; coarser grouping merges topics rather than hiding notes.
 */
async function handleSkeletonToggle() {
	// Guard against re-entry while a fresh Leiden run is in flight — otherwise rapid clicks
	// race on state writes and can leave the view stuck between modes.
	if (isLeidenRunning) return;

	// Two absolute commands: collapse all, expand all. Neither merges with the
	// folds the user made by hand — "all" means all, in both directions. Clearing
	// both per-topic sets on either press keeps that promise literal and stops a
	// stale fold reappearing later as state nothing on screen explains.
	collapseAll = !collapseAll;
	collapsedTopics = new Set();
	expandedTopics = new Set();

	// Re-frame the camera, but only after the layout has moved. Fitting
	// immediately frames the *old* positions and the nodes then drift out from
	// under the camera; a collapsed graph is also far smaller than the note-level
	// one, so without a refit a large vault leaves the few topic nodes off-screen.
	await tick();
	canvasComponent?.followLayout();
}

/**
 * Fold or unfold a set of topics.
 *
 * Takes an explicit target state rather than toggling each topic, because a
 * mixed selection has to resolve to one outcome — toggling per topic would
 * invert the mix instead of collapsing it.
 *
 * Under collapse-all the state is stored as *exceptions* (`expandedTopics`) so
 * that topics introduced by a later granularity change still arrive collapsed; outside it,
 * as the collapsed set itself. Both directions have to write to whichever set
 * is currently authoritative.
 */
async function setTopicsCollapsed(clusters: Iterable<number>, collapsed: boolean) {
	const targets = [...clusters];
	if (targets.length === 0) return;

	if (collapseAll) {
		const next = new Set(expandedTopics);
		for (const cluster of targets) {
			if (collapsed) next.delete(cluster);
			else next.add(cluster);
		}
		expandedTopics = next;
	} else {
		const next = new Set(collapsedTopics);
		for (const cluster of targets) {
			if (collapsed) next.add(cluster);
			else next.delete(cluster);
		}
		collapsedTopics = next;
	}

	// Folding is a local change, but it can still move the bounds enough to
	// strand nodes off-screen, so follow the settle like collapse-all.
	await tick();

	// Folding swaps a topic's notes for one synthetic node, so the selection has
	// to be re-derived against the new graph — otherwise it empties, the
	// selection bar disappears, and the Expand button goes with it.
	if (focusedClusters.size > 0) {
		const paths = canvasComponent?.getNodePathsForClusters(focusedClusters) ?? [];
		canvasComponent?.selectNodesByPaths(paths);
		handleSelectionChange(paths);
	}

	canvasComponent?.followLayout();
}

/** Apply the selection bar's collapse/expand verb to the selected topics. */
async function handleCollapseSelectedTopics() {
	if (selectedTopicsCollapseAction === null) return;
	await setTopicsCollapsed(focusedClusters, selectedTopicsCollapseAction === "collapse");
}

/** Commit a new topic resolution (γ) and re-run community detection. */
function handleTopicsCommit(resolution: number) {
	handleSettingsChange({ leidenResolution: resolution });
	void runLeidenSegmentation();
}

/**
 * Granularity level derived from the stored resolution, so the slider position
 * survives a reload and stays in sync if γ is changed from elsewhere.
 */
let granularityLevel = $derived(resolutionToGranularity(settings.leidenResolution ?? 1.0, granularityLadder));
/** Highest selectable level — shrinks to however many groupings this vault supports. */
let granularityMaxLevel = $derived(maxGranularityLevel(granularityLadder));

/**
 * Commit a new granularity level: map it to γ and re-run community detection.
 *
 * Changing granularity changes how many topics exist; collapsing (the atom) changes whether
 * they're drawn as groups or notes. The two are independent.
 */
function handleGranularityCommit(level: number) {
	handleTopicsCommit(granularityToResolution(level, granularityLadder));
}

/**
 * Step topic granularity by one level (arrow keys).
 *
 * Commits rather than using the drag path: a keypress is a discrete choice, so
 * the level should resolve even when it isn't already cached. Held arrows are
 * naturally rate-limited by the settle, and out-of-range steps no-op so the
 * ends of the ladder feel like ends rather than silently wrapping.
 */
function handleGranularityStep(delta: number) {
	if (!hasDerivedGranularityLadder) return;
	const next = granularityLevel + delta;
	if (next < MIN_GRANULARITY_LEVEL || next > granularityMaxLevel) return;
	handleGranularityCommit(next);
}

/**
 * Apply a granularity level *while the user is still dragging*.
 *
 * Every rung was computed during probing, so re-segmenting at a new level is a
 * cache hit and lands on the same frame — the graph re-groups under the knob
 * instead of after release, which is what makes granularity feel like a continuous view
 * of one structure rather than a series of separate queries.
 *
 * A level that somehow isn't cached is skipped rather than awaited: firing
 * Leiden runs mid-drag would queue work the user has already scrolled past.
 * `oncommit` still fires on release, so the final position always resolves.
 */
function handleGranularityChange(level: number) {
	const resolution = granularityToResolution(level, granularityLadder);
	if (resolution === settings.leidenResolution) return;

	const cached = leidenCache.get(partitionKey(resolution));
	if (!cached) return;

	handleSettingsChange({ leidenResolution: resolution });
	leidenCommunities = cached.communities;
	leidenCentrality = cached.centrality;
	resolveAndApplySegments(graphData);
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
      graphData={displayGraphData}
      directedWikiEdges={settings.directedWikiEdges}
      linkDistance={settings.linkDistance}
      chargeStrength={settings.chargeStrength}
      centerStrength={settings.centerStrength}
      linkStrength={settings.linkStrength}
      showWikiLinks={settings.showWikiLinks}
      showSemanticLinks={settings.showSemanticLinks ?? true}
      showTopicHulls={settings.showTopicHulls ?? true}
      {focusedClusters}
      clusterLabels={effectiveClusterLabels}
      showClusterLabels={settings.showClusterLabels ?? true}
      clusterCohesionStrength={settings.clusterCohesionStrength ?? 0.15}
      onNodeClick={handleNodeClick}
      onSetTopicCollapsed={(cluster, collapsed) => void setTopicsCollapsed([cluster], collapsed)}
      onRevealFile={handleRevealFile}
      onFocusCluster={handleFocusCluster}
      {lassoMode}
      onSelectionChange={handleSelectionChange}
      onClearFocusedClusters={handleClearFocusedClusters}
      onHoverPreview={handleHoverPreview}
      onSkeletonToggle={handleSkeletonToggle}
      immersed={isImmersed}
      onExitImmerse={handleExitImmerse}
      onCollapseSelectedTopics={() => void handleCollapseSelectedTopics()}
      onImmerse={() => void handleImmerse()}
      onOpenAllSelected={handleOpenAllSelected}
      onSendToChat={() => void handleSendToChat()}
      onOpenPaths={(paths) => void handleOpenPaths(paths)}
      onGranularityStep={handleGranularityStep}
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
          {#if selectedTopicsCollapseAction !== null}
            <Button
              buttonText={selectedTopicsCollapseAction === "collapse" ? "Collapse" : "Expand"}
              onClick={() => void handleCollapseSelectedTopics()}
              tooltip={withKey(
                selectedTopicsCollapseAction === "collapse"
                  ? "Fold the selected topics into single nodes"
                  : "Unfold the selected topics back into notes",
                "C",
              )}
            />
          {/if}
          <Button
            buttonText="Immerse"
            onClick={handleImmerse}
            tooltip={withKey("Rebuild graph with selected notes only", "I")}
          />
          <Button
            buttonText="Open all"
            onClick={handleOpenAllSelected}
            tooltip={withKey("Open all selected notes in new tabs", "O")}
          />
          {#if !hasOpenChat}
            <Button
              buttonText="Open in chat"
              onClick={handleSendToChat}
              tooltip={withKey("Reveal the chat and attach the selected notes", "A")}
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
    {granularityLevel}
    {granularityMaxLevel}
    granularityReady={hasDerivedGranularityLadder}
    onGranularityChange={handleGranularityChange}
    onGranularityCommit={handleGranularityCommit}
    isLeidenRunning={isLeidenRunning}
    {isLabeling}
    onLabelTopics={handleLabelTopics}
    {lassoMode}
    onLassoModeChange={handleLassoModeChange}
    {graphData}
    nodeCount={displayGraphData.nodes.length}
    segments={labeledSegments}
    {isTopicsCollapsed}
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
