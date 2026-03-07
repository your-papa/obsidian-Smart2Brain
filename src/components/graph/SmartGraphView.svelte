<script lang="ts">
  import { untrack } from "svelte";
  import { getAllTags, Notice } from "obsidian";
  import { HumanMessage } from "@langchain/core/messages";
  import { getPlugin } from "../../stores/state.svelte";
  import { getData } from "../../stores/dataStore.svelte";
  import { getRegistry } from "../../providers/registry";
  import { getVectorStoreService, isVectorStoreInitialized } from "../../vectorstore";
  import {
    type GraphData,
    type SmartGraphSettings,
    DEFAULT_SMART_GRAPH_SETTINGS,
    THEME_COLOR_VARS,
  } from "../../types/graph";
  import {
    buildGraphStructure,
    computeClusters,
    applyClusterMap,
    applySearchHighlight,
    type GraphFilter,
    type ClusterAssignment,
  } from "../../views/smart-graph/graphDataBuilder";
  import type { DocumentVector } from "../../vectorstore/types";
  import LoadingAnimation from "../ui/LoadingAnimation.svelte";
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
  async function rebuildGraph() {
    isLoading = true;

    const filter: GraphFilter = {
      folders: selectedFolders.length > 0 ? selectedFolders : undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      searchQuery: searchQuery || undefined,
    };

    try {
      if (!isVectorStoreInitialized()) {
        graphData = { nodes: [], edges: [] };
        return;
      }

      const vectorService = getVectorStoreService();
      const documents = await vectorService.getAllDocumentVectors();

      if (documents.length === 0) {
        graphData = { nodes: [], edges: [] };
        return;
      }

      const {
        graphData: rawGraph,
        filteredDocs,
        vectors,
      } = await buildGraphStructure(plugin.app, documents, settings, filter);

      // Detect whether the filtered document set changed
      const currentPaths = new Set(filteredDocs.map((d) => d.path));
      const clusterPaths = new Set(clusterMap.keys());
      const docSetChanged =
        currentPaths.size !== clusterPaths.size ||
        [...currentPaths].some((p) => !clusterPaths.has(p));

      // Cache for use by handleRecluster / handleLabelClusters
      cachedFilteredDocs = filteredDocs;
      cachedVectors = vectors;

      // Recluster when: first build, or document set changed
      if (clusterMap.size === 0 || docSetChanged) {
        const themeColors = resolveThemeColors();
        const result = computeClusters(filteredDocs, vectors, settings, themeColors);
        clusterMap = result.clusterMap;
        suggestedK = settings.autoK ? result.k : null;
        clusterLabels = {};

        // Auto-label clusters if enabled and a chat model is configured
        if (settings.autoLabelClusters && settings.graphChatModel) {
          // Fire-and-forget; handleLabelClusters manages its own isLabeling state
          handleLabelClusters();
        }
      }

      graphData = applyClusterMap(rawGraph, clusterMap);
    } catch (err) {
      console.error("[SmartGraph] Error building graph:", err);
      graphData = { nodes: [], edges: [] };
    } finally {
      isLoading = false;
    }
  }

  // Apply search highlighting as a derived transformation
  $effect(() => {
    displayData = searchQuery ? applySearchHighlight(graphData, searchQuery) : graphData;
  });

  // Build graph on filter/settings changes
  // Note: projectionMethod, defaultK, and autoK are intentionally excluded —
  // they only take effect when the user presses the Apply button.
  $effect(() => {
    // Track reactive dependencies (edge, layout, filter settings)
    selectedFolders;
    selectedTags;
    settings.showOrphans;
    settings.similarityThreshold;
    settings.semanticNeighbors;

    // Avoid tracking reads inside rebuildGraph (clusterMap, cachedVectors, etc.)
    untrack(() => {
      rebuildGraph();
    });
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
    // Force full recluster on refresh by clearing stored assignments
    clusterMap = new Map();
    rebuildGraph();
  }

  /**
   * Apply projection & clustering changes.
   * Forces a full rebuild with fresh clusters using the current projection
   * method and K settings.
   */
  function handleApplyProjection() {
    clusterMap = new Map();
    rebuildGraph();
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
  let focusedCluster: number | null = $state(null);

  function handleFocusCluster(cluster: number) {
    // Toggle: if already focused on this cluster, clear focus
    focusedCluster = focusedCluster === cluster ? null : cluster;
  }

  /**
   * Generate thematic labels for each cluster using the user's configured chat model.
   * Groups nodes by cluster, reads note content snippets, and sends a single batched prompt.
   */
  async function handleLabelClusters() {
    const chatModelConfig = settings.graphChatModel;

    if (!chatModelConfig) {
      new Notice("No graph chat model configured. Set one in Settings → Graph.");
      return;
    }

    isLabeling = true;

    try {
      // Group nodes by cluster
      const clusters = new Map<number, typeof graphData.nodes>();
      for (const node of graphData.nodes) {
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

      // Create LLM instance — disable thinking/reasoning for speed
      const registry = getRegistry();
      const baseLlm = registry.createChatInstance(chatModelConfig.provider, chatModelConfig.model, {
        ...chatModelConfig.modelConfig,
      });
      // Disable extended thinking/reasoning for providers that support it
      const llm =
        "bind" in baseLlm && typeof baseLlm.bind === "function"
          ? (baseLlm as any).bind({ thinking: { type: "disabled" }, reasoning: false })
          : baseLlm;

      const response = await llm.invoke([new HumanMessage(prompt)]);
      const text =
        typeof response.content === "string" ? response.content : JSON.stringify(response.content);

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
      new Notice(
        `Failed to generate cluster labels: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
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
      nodeSize={settings.nodeSize}
      linkDistance={settings.linkDistance}
      chargeStrength={settings.chargeStrength}
      labelZoomThreshold={settings.labelZoomThreshold}
      discoveryMode={settings.discoveryMode}
      showSemanticEdges={settings.showSemanticEdges}
      showWikiLinks={settings.showWikiLinks}
      {focusedCluster}
      {clusterLabels}
      {isLabeling}
      onNodeClick={handleNodeClick}
      onRevealFile={handleRevealFile}
      onFocusCluster={handleFocusCluster}
      onToggleWikiLinks={() => handleSettingsChange({ showWikiLinks: !settings.showWikiLinks })}
      onToggleSemanticEdges={() =>
        handleSettingsChange({ showSemanticEdges: !settings.showSemanticEdges })}
    />
  {/if}

  <GraphControls
    {settings}
    {suggestedK}
    {isLoading}
    nodeCount={displayData.nodes.length}
    edgeCount={displayData.edges.length}
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
    onLabelClusters={handleLabelClusters}
    {isLabeling}
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
</style>
