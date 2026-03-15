<script lang="ts">
import { untrack } from "svelte";
import { getAllTags, Notice } from "obsidian";
import { HumanMessage } from "@langchain/core/messages";
import { getPlugin } from "../../stores/state.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getRegistry } from "../../providers/registry";
import type { ChatModelConfig } from "../../providers/index";
import { getVectorStoreService, isVectorStoreInitialized, waitForVectorStore } from "../../vectorstore";
import {
	type GraphData,
	type GraphMode,
	type SmartGraphSettings,
	DEFAULT_SMART_GRAPH_SETTINGS,
	THEME_COLOR_VARS,
} from "../../types/graph";
import {
	buildWikiGraph,
	buildGraphStructure,
	computeClusters,
	applyClusterMap,
	applyColorGroups,
	applySearchHighlight,
	type GraphFilter,
	type ClusterAssignment,
} from "../../views/smart-graph/graphDataBuilder";
import type { DocumentVector } from "../../vectorstore/types";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";
import { getMessenger } from "../../stores/chatStore.svelte";
import LoadingAnimation from "../ui/LoadingAnimation.svelte";
import Button from "../ui/Button.svelte";
import GraphCanvas from "./GraphCanvas.svelte";
import GraphControls from "./GraphControls.svelte";

const plugin = getPlugin();
const data = getData();

// Graph state
let settings: SmartGraphSettings = $derived({
	...DEFAULT_SMART_GRAPH_SETTINGS,
	...(data.smartGraphSettings ?? {}),
});
let graphData: GraphData = $state({ nodes: [], edges: [] });
let displayData: GraphData = $state({ nodes: [], edges: [] });
let graphMode: GraphMode = $state(data.lastGraphMode);
let isTransitioning = $state(false);
let isLoading = $state(false);
let suggestedK: number | null = $state(null);
let clusterLabels: Record<number, string> = $state({});
let isLabeling = $state(false);

// Cluster state — persisted across edge/layout rebuilds
let clusterMap: Map<string, ClusterAssignment> = $state(new Map());
let cachedFilteredDocs: DocumentVector[] = [];
let cachedVectors: Float32Array[] = [];

// Filter state
let selectedFolders: string[] = $state([]);
let selectedTags: string[] = $state([]);
let searchQuery = $state("");

// Available filters
let availableFolders: string[] = $state([]);
let availableTags: string[] = $state([]);

// Canvas ref
let canvasComponent: GraphCanvas | undefined = $state(undefined);

// Lasso / selection state
let lassoMode = $state(false);
let selectedPaths: string[] = $state([]);

// Build generation counter to discard stale async results
let buildGeneration = 0;

function getFilter(): GraphFilter {
	return {
		folders: selectedFolders.length > 0 ? selectedFolders : undefined,
		tags: selectedTags.length > 0 ? selectedTags : undefined,
		searchQuery: searchQuery || undefined,
	};
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
function buildWikiModeGraph(filter: GraphFilter): GraphData {
	const { graphData: wikiGraphData } = buildWikiGraph(plugin.app, settings, filter);
	return applyColorGroups(plugin.app, wikiGraphData, settings.colorGroups);
}

async function buildSmartModeGraph(
	gen: number,
	filter: GraphFilter,
): Promise<{
	graphData: GraphData;
	shouldAutoLabel: boolean;
}> {
	const ready = await waitForVectorStore();
	if (!ready) {
		return { graphData: { nodes: [], edges: [] }, shouldAutoLabel: false };
	}

	const vectorService = getVectorStoreService();
	const documents = await vectorService.getAllDocumentVectors();

	if (gen !== buildGeneration || documents.length === 0) {
		return { graphData: { nodes: [], edges: [] }, shouldAutoLabel: false };
	}

	const {
		graphData: rawGraph,
		filteredDocs,
		vectors,
		reducedVectors,
	} = await buildGraphStructure(plugin.app, documents, settings, filter);

	if (gen !== buildGeneration) {
		return { graphData: { nodes: [], edges: [] }, shouldAutoLabel: false };
	}

	// Detect whether the filtered document set changed
	const currentPaths = new Set(filteredDocs.map((d) => d.path));
	const clusterPaths = new Set(clusterMap.keys());
	const docSetChanged =
		currentPaths.size !== clusterPaths.size || [...currentPaths].some((p) => !clusterPaths.has(p));

	// Cache for future smart-mode rebuilds / labeling
	cachedFilteredDocs = filteredDocs;
	cachedVectors = vectors;

	let activeClusterMap = clusterMap;
	let shouldAutoLabel = false;
	if (clusterMap.size === 0 || docSetChanged) {
		const themeColors = resolveThemeColors();
		const result = await computeClusters(filteredDocs, vectors, settings, themeColors, undefined, reducedVectors);

		if (gen !== buildGeneration) {
			return { graphData: { nodes: [], edges: [] }, shouldAutoLabel: false };
		}

		clusterMap = result.clusterMap;
		activeClusterMap = result.clusterMap;
		suggestedK = settings.autoK ? result.k : null;
		clusterLabels = {};
		shouldAutoLabel = settings.autoLabelClusters && !!settings.graphChatModel;
	}

	return {
		graphData: applyClusterMap(rawGraph, activeClusterMap),
		shouldAutoLabel,
	};
}

async function rebuildGraph(targetMode: GraphMode = graphMode) {
	const gen = ++buildGeneration;
	isLoading = true;
	const filter = getFilter();

	try {
		if (targetMode === "wiki") {
			const nextGraphData = buildWikiModeGraph(filter);
			if (gen !== buildGeneration) return;
			graphMode = "wiki";
			data.lastGraphMode = "wiki";
			focusedClusters = new Set();
			graphData = nextGraphData;
			return;
		}

		const { graphData: nextGraphData, shouldAutoLabel } = await buildSmartModeGraph(gen, filter);
		if (gen !== buildGeneration) return;

		graphMode = "smart";
		data.lastGraphMode = "smart";
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
		}
	}
}

// Apply search highlighting as a derived transformation
$effect(() => {
	displayData = searchQuery ? applySearchHighlight(graphData, searchQuery) : graphData;
});

// Build graph on filter/settings changes (debounced to avoid rapid-fire builds)
// Note: projectionMethod, UMAP parameters, defaultK, and autoK are
// intentionally excluded — they only take effect when the user presses Apply.
$effect(() => {
	// Track reactive dependencies (edge, layout, filter settings)
	graphMode;
	selectedFolders;
	selectedTags;
	settings.showOrphans;
	settings.colorGroups;

	if (graphMode === "smart") {
		settings.similarityThreshold;
		settings.semanticNeighbors;
		settings.showWikiLinks;
		settings.showSemanticEdges;
	}

	// Debounce: schedule a rebuild and clean up on re-trigger
	const timer = setTimeout(() => {
		untrack(() => {
			void rebuildGraph();
		});
	}, 300);

	return () => clearTimeout(timer);
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
	if (graphMode === "smart") {
		// Force full recluster on refresh by clearing stored assignments
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
	clusterMap = new Map();
	if (graphMode === "smart") {
		void rebuildGraph("smart");
	}
}

async function handleSmartCluster() {
	if (graphMode === "smart" || isTransitioning) return;
	if (!isVectorStoreInitialized()) {
		new Notice("Smart Graph requires indexed embeddings. Build the vector store first.");
		return;
	}

	isTransitioning = true;
	try {
		await rebuildGraph("smart");
	} finally {
		isTransitioning = false;
	}
}

async function handleBackToWiki() {
	if (graphMode === "wiki" || isTransitioning) return;

	isTransitioning = true;
	try {
		await rebuildGraph("wiki");
	} finally {
		isTransitioning = false;
	}
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

// Cluster focus state
let focusedClusters: Set<number> = $state(new Set());

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
async function handleLabelClusters(sourceGraphData: GraphData = graphData, sourceGeneration = buildGeneration) {
	if (isLabeling) return;
	const chatModelConfig = settings.graphChatModel;

	if (!chatModelConfig) {
		new Notice("No graph chat model configured. Set one in Settings → Graph.");
		return;
	}

	isLabeling = true;

	try {
		// Group nodes by cluster
		const clusters = new Map<number, typeof sourceGraphData.nodes>();
		for (const node of sourceGraphData.nodes) {
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
</script>

<div class="smart-graph-view">
  {#if isLoading && graphData.nodes.length === 0}
    <div class="graph-loading">
      <LoadingAnimation />
      <p>Building graph...</p>
    </div>
  {:else}
    <GraphCanvas
      bind:this={canvasComponent}
      graphData={displayData}
      linkDistance={settings.linkDistance}
      chargeStrength={settings.chargeStrength}
      labelZoomThreshold={settings.labelZoomThreshold}
      discoveryMode={settings.discoveryMode}
      showSemanticEdges={graphMode === "smart" ? settings.showSemanticEdges : false}
      showWikiLinks={graphMode === "wiki" ? true : settings.showWikiLinks}
      useForceLayout={graphMode === "wiki" ? true : settings.useForceLayout}
      focusedClusters={focusedClusters}
      {clusterLabels}
      {isLabeling}
      onNodeClick={handleNodeClick}
      onRevealFile={handleRevealFile}
      onFocusCluster={handleFocusCluster}
      onToggleWikiLinks={() => handleSettingsChange({ showWikiLinks: !settings.showWikiLinks })}
      onToggleSemanticEdges={() =>
        handleSettingsChange({ showSemanticEdges: !settings.showSemanticEdges })}
      {lassoMode}
      onSelectionChange={handleSelectionChange}
    />
  {/if}

  {#if selectedPaths.length > 0}
    <div class="graph-selection-bar">
      <span class="selection-count">{selectedPaths.length} notes selected</span>
      <div class="selection-actions">
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
        <Button buttonText="Clear" onClick={handleClearSelection} tooltip="Clear selection" />
      </div>
    </div>
  {/if}

  <GraphControls
    {settings}
    {suggestedK}
    {isLoading}
    {graphMode}
    {isTransitioning}
    nodeCount={displayData.nodes.length}
    edgeCount={displayData.edges.length}
    graphData={displayData}
    {availableFolders}
    {availableTags}
    {selectedFolders}
    {selectedTags}
    {searchQuery}
    onSettingsChange={handleSettingsChange}
    onFolderFilterChange={handleFolderFilterChange}
    onTagFilterChange={handleTagFilterChange}
    onSearchChange={handleSearchChange}
    onFitToView={handleFitToView}
    onRefresh={handleRefresh}
    onApplyProjection={handleApplyProjection}
    onSmartCluster={handleSmartCluster}
    onBackToWiki={handleBackToWiki}
    onLabelClusters={graphMode === "smart" ? handleLabelClusters : undefined}
    {isLabeling}
    {lassoMode}
    onLassoModeChange={handleLassoModeChange}
    selectedCount={selectedPaths.length}
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
