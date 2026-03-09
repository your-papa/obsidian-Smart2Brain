<script lang="ts">
  import { untrack } from "svelte";
  import { getAllTags, Notice } from "obsidian";
  import { HumanMessage } from "@langchain/core/messages";
  import { getPlugin } from "../../stores/state.svelte";
  import { getData } from "../../stores/dataStore.svelte";
  import { getRegistry } from "../../providers/registry";
  import type { ChatModelConfig } from "../../providers/index";
  import { getVectorStoreService, isVectorStoreInitialized } from "../../vectorstore";
  import {
    type GraphData,
    type SmartGraphSettings,
    type GraphMode,
    DEFAULT_SMART_GRAPH_SETTINGS,
    THEME_COLOR_VARS,
  } from "../../types/graph";
  import {
    buildGraphStructure,
    buildWikiGraph,
    computeClusters,
    applyClusterMap,
    applyColorGroups,
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

  // Graph mode: "wiki" = force-directed wiki links, "smart" = projected clusters
  let graphMode: GraphMode = $state("wiki");
  let isTransitioning = $state(false);
  let transitionTargets: Map<string, { x: number; y: number }> | null = $state(null);

  // Smart graph pre-computed in the background for instant transition
  let precomputedSmartData: {
    graph: GraphData;
    targets: Map<string, { x: number; y: number }>;
    clusterMap: Map<string, ClusterAssignment>;
    suggestedK: number | null;
    filteredDocs: DocumentVector[];
    vectors: Float32Array[];
    reducedVectors: Float32Array[];
    rawGraph: GraphData;
  } | null = $state(null);
  let isPrecomputing = $state(false);
  let precomputeGeneration = 0;

  // Graph data to swap in after the position transition completes
  let pendingSmartGraph: GraphData | null = null;

  // Cluster state — persisted across edge/layout rebuilds
  let clusterMap: Map<string, ClusterAssignment> = $state(new Map());
  let cachedFilteredDocs: DocumentVector[] = [];
  let cachedVectors: Float32Array[] = [];
  let cachedReducedVectors: Float32Array[] = [];
  let cachedRawGraph: GraphData = { nodes: [], edges: [] };

  // Filter state
  let selectedFolders: string[] = $state([]);
  let selectedTags: string[] = $state([]);
  let searchQuery = $state("");

  // Available filters
  let availableFolders: string[] = $state([]);
  let availableTags: string[] = $state([]);

  // Canvas ref
  let canvasComponent: GraphCanvas | undefined = $state(undefined);

  // Build generation counter to discard stale async results
  let buildGeneration = 0;

  // When true, the next rebuild $effect schedule is skipped.
  // Used by handleTransitionEnd/handleBackToWiki to prevent a redundant
  // rebuildGraph() triggered by the graphMode change.
  let suppressNextRebuild = false;

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
   * Build the graph. In "wiki" mode, builds a wiki-link-only graph with
   * d3-force layout. In "smart" mode, runs the full reduce → cluster → project
   * pipeline. Clusters are only recomputed when the document set changes.
   */
  async function rebuildGraph() {
    const gen = ++buildGeneration;
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

      if (gen !== buildGeneration) return;

      if (documents.length === 0) {
        graphData = { nodes: [], edges: [] };
        return;
      }

      if (graphMode === "wiki") {
        // Wiki-only mode: force-directed layout with wiki link edges only
        const result = buildWikiGraph(plugin.app, documents, settings, filter);
        if (gen !== buildGeneration) return;

        cachedFilteredDocs = result.filteredDocs;
        cachedVectors = result.vectors;
        cachedReducedVectors = [];
        cachedRawGraph = result.graphData;
        clusterMap = new Map();
        suggestedK = null;
        clusterLabels = {};

        // Apply color groups
        graphData = applyColorGroups(plugin.app, result.graphData, settings.colorGroups);

        // Pre-compute smart graph in the background so the transition is instant
        precomputedSmartData = null;
        precomputeSmartGraph();
      } else {
        // Smart mode: full pipeline
        const {
          graphData: rawGraph,
          filteredDocs,
          vectors,
          reducedVectors,
        } = await buildGraphStructure(plugin.app, documents, settings, filter);

        if (gen !== buildGeneration) return;

        const currentPaths = new Set(filteredDocs.map((d) => d.path));
        const clusterPaths = new Set(clusterMap.keys());
        const docSetChanged =
          currentPaths.size !== clusterPaths.size ||
          [...currentPaths].some((p) => !clusterPaths.has(p));

        cachedFilteredDocs = filteredDocs;
        cachedVectors = vectors;
        cachedReducedVectors = reducedVectors;
        cachedRawGraph = rawGraph;

        if (clusterMap.size === 0 || docSetChanged) {
          const themeColors = resolveThemeColors();
          const result = await computeClusters(
            filteredDocs,
            vectors,
            settings,
            themeColors,
            rawGraph,
            reducedVectors,
          );
          if (gen !== buildGeneration) return;
          clusterMap = result.clusterMap;
          suggestedK = settings.autoK ? result.k : null;
          clusterLabels = {};

          if (settings.autoLabelClusters && settings.graphChatModel) {
            handleLabelClusters();
          }
        }

        graphData = applyClusterMap(rawGraph, clusterMap);
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

  /**
   * Pre-compute the smart clustering graph in the background so the
   * wiki → smart transition feels instant when the user clicks the button.
   */
  async function precomputeSmartGraph() {
    if (isPrecomputing) return;
    isPrecomputing = true;
    const gen = ++precomputeGeneration;

    try {
      if (!isVectorStoreInitialized()) return;

      const vectorService = getVectorStoreService();
      const documents = await vectorService.getAllDocumentVectors();
      if (documents.length === 0 || gen !== precomputeGeneration) return;

      const filter: GraphFilter = {
        folders: selectedFolders.length > 0 ? selectedFolders : undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        searchQuery: searchQuery || undefined,
      };

      const {
        graphData: rawGraph,
        filteredDocs,
        vectors,
        reducedVectors,
      } = await buildGraphStructure(plugin.app, documents, settings, filter);
      if (gen !== precomputeGeneration) return;

      const themeColors = resolveThemeColors();
      const result = await computeClusters(
        filteredDocs,
        vectors,
        settings,
        themeColors,
        rawGraph,
        reducedVectors,
      );
      if (gen !== precomputeGeneration) return;

      const clusteredGraph = applyClusterMap(rawGraph, result.clusterMap);
      const targets = new Map<string, { x: number; y: number }>();
      for (const node of clusteredGraph.nodes) {
        targets.set(node.id, { x: node.x, y: node.y });
      }

      precomputedSmartData = {
        graph: clusteredGraph,
        targets,
        clusterMap: result.clusterMap,
        suggestedK: settings.autoK ? result.k : null,
        filteredDocs,
        vectors,
        reducedVectors,
        rawGraph,
      };
    } catch (err) {
      console.error("[SmartGraph] Error pre-computing smart graph:", err);
    } finally {
      if (gen === precomputeGeneration) {
        isPrecomputing = false;
      }
    }
  }

  // Build graph on filter/settings changes (debounced to avoid rapid-fire builds)
  $effect(() => {
    // Track reactive dependencies (filter settings + color groups)
    selectedFolders;
    selectedTags;
    settings.showOrphans;
    settings.colorGroups;

    // In smart mode, also track edge-related settings
    if (graphMode === "smart") {
      settings.similarityThreshold;
      settings.semanticNeighbors;
      settings.showWikiLinks;
      settings.showSemanticEdges;
    }

    // Debounce: schedule a rebuild and clean up on re-trigger
    const timer = setTimeout(() => {
      untrack(() => {
        if (suppressNextRebuild) {
          suppressNextRebuild = false;
          return;
        }
        rebuildGraph();
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
    clusterMap = new Map();
    rebuildGraph();
  }

  /**
   * Apply projection & clustering changes (smart mode only).
   * Forces a full rebuild with fresh clusters.
   */
  function handleApplyProjection() {
    clusterMap = new Map();
    rebuildGraph();
  }

  /**
   * Transition from wiki mode to smart clustering mode.
   * Uses pre-computed data if available; otherwise computes on demand.
   * Sets only transitionTargets — graphData stays unchanged so the existing
   * d3 simulation keeps running while nodes animate to projected positions.
   */
  async function handleSmartClustering() {
    if (isTransitioning) return;

    // Helper: kick off the position transition using computed data
    const startTransition = (smartData: NonNullable<typeof precomputedSmartData>) => {
      cachedFilteredDocs = smartData.filteredDocs;
      cachedVectors = smartData.vectors;
      cachedReducedVectors = smartData.reducedVectors;
      cachedRawGraph = smartData.rawGraph;
      clusterMap = smartData.clusterMap;
      suggestedK = smartData.suggestedK;
      clusterLabels = {};

      if (settings.useForceLayout) {
        // Force layout mode: skip position animation, directly swap data
        // with cluster colors and let d3-force arrange nodes naturally.
        suppressNextRebuild = true;
        canvasComponent?.prepareDataSwap();
        graphMode = "smart";
        graphData = smartData.graph;
      } else {
        // Store the smart graph to apply after the transition finishes
        pendingSmartGraph = smartData.graph;

        // Apply cluster colors immediately so they animate with the transition
        const colorUpdates = new Map<string, { color?: string; cluster?: number }>();
        for (const [id, assignment] of smartData.clusterMap) {
          colorUpdates.set(id, { color: assignment.color, cluster: assignment.cluster });
        }
        canvasComponent?.updateNodeAppearance(colorUpdates);

        // Switch mode immediately so controls/UI update instantly.
        // suppressNextRebuild prevents the rebuild $effect from firing.
        // isTransitioning keeps useForceLayout=true so setupSimulation
        // $effect doesn't re-fire either.
        isTransitioning = true;
        suppressNextRebuild = true;
        graphMode = "smart";

        // Set transitionTargets — graphData stays as wiki graph so nodes
        // keep their current positions and the simulation can animate them
        transitionTargets = smartData.targets;
      }

      if (settings.autoLabelClusters && settings.graphChatModel) {
        handleLabelClusters();
      }
    };

    // Use pre-computed data for an instant transition
    if (precomputedSmartData) {
      startTransition(precomputedSmartData);
      return;
    }

    // Fall back to computing on demand (shows loading indicator)
    if (isLoading) return;
    isLoading = true;

    try {
      if (!isVectorStoreInitialized()) return;

      const vectorService = getVectorStoreService();
      const documents = await vectorService.getAllDocumentVectors();
      if (documents.length === 0) return;

      const filter: GraphFilter = {
        folders: selectedFolders.length > 0 ? selectedFolders : undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        searchQuery: searchQuery || undefined,
      };

      const {
        graphData: rawGraph,
        filteredDocs,
        vectors,
        reducedVectors,
      } = await buildGraphStructure(plugin.app, documents, settings, filter);

      const themeColors = resolveThemeColors();
      const result = await computeClusters(
        filteredDocs,
        vectors,
        settings,
        themeColors,
        rawGraph,
        reducedVectors,
      );

      const clusteredGraph = applyClusterMap(rawGraph, result.clusterMap);
      const targets = new Map<string, { x: number; y: number }>();
      for (const node of clusteredGraph.nodes) {
        targets.set(node.id, { x: node.x, y: node.y });
      }

      startTransition({
        graph: clusteredGraph,
        targets,
        clusterMap: result.clusterMap,
        suggestedK: settings.autoK ? result.k : null,
        filteredDocs,
        vectors,
        reducedVectors,
        rawGraph,
      });
    } catch (err) {
      console.error("[SmartGraph] Error during smart clustering:", err);
    } finally {
      isLoading = false;
    }
  }

  /**
   * Called when the d3 transition animation finishes.
   * Applies the pending smart graph (edges, colors) and finalises mode switch.
   */
  function handleTransitionEnd() {
    transitionTargets = null;

    if (pendingSmartGraph) {
      // Read back positions AND degrees from the running simulation so the
      // swap does not cause node size or position jumps.
      const positions = canvasComponent?.getNodePositions();
      const wikiDegrees = new Map<string, number>();
      for (const node of graphData.nodes) {
        wikiDegrees.set(node.id, node.degree ?? 0);
      }

      for (const node of pendingSmartGraph.nodes) {
        const pos = positions?.get(node.id);
        if (pos) {
          node.x = pos.x;
          node.y = pos.y;
        }
        // Keep wiki-era degree so getNodeRadius() produces the same size
        const wd = wikiDegrees.get(node.id);
        if (wd !== undefined) {
          node.degree = wd;
        }
      }

      // Tell canvas to skip fitToView/edge-fade on the next data swap
      canvasComponent?.prepareDataSwap();
      // Swap data first while isTransitioning is still true (keeps
      // useForceLayout stable so only one setupSimulation fires).
      graphData = pendingSmartGraph;
      pendingSmartGraph = null;
    }

    // Clear isTransitioning last — this flips useForceLayout to its
    // final value, but graphData is already the smart graph.
    isTransitioning = false;
  }

  /**
   * Go back to wiki graph mode.
   * Builds the wiki graph synchronously from cached data to avoid an async gap,
   * then lets the d3 force simulation smoothly rearrange nodes from their
   * cluster positions into the wiki-link-driven layout.
   */
  function handleBackToWiki() {
    if (isTransitioning) return;
    isTransitioning = true;

    // Build wiki graph synchronously from cached docs (already filtered)
    const docs = cachedFilteredDocs.length > 0 ? cachedFilteredDocs : [];
    const wikiResult = buildWikiGraph(plugin.app, docs, settings);
    const wikiGraph = applyColorGroups(plugin.app, wikiResult.graphData, settings.colorGroups);

    // Suppress the scheduled rebuild — we're already providing the correct data.
    suppressNextRebuild = true;
    graphMode = "wiki";
    clusterMap = new Map();
    clusterLabels = {};
    suggestedK = null;
    focusedCluster = null;

    // Set graph data – triggers setupSimulation which preserves old positions
    // and starts a gentle force simulation (alpha 0.3)
    graphData = wikiGraph;

    // Pre-compute smart graph again for the next transition
    precomputedSmartData = null;
    precomputeSmartGraph();

    // Clear transition state after force simulation settles (~2s)
    setTimeout(() => {
      isTransitioning = false;
    }, 2000);
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
    if (isLabeling) return;
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
      useForceLayout={graphMode === "wiki" || settings.useForceLayout || isTransitioning}
      {transitionTargets}
      onTransitionEnd={handleTransitionEnd}
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
    {graphMode}
    {isTransitioning}
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
    onSmartCluster={handleSmartClustering}
    onBackToWiki={handleBackToWiki}
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
