<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { EventRef } from "obsidian";
  import { getPlugin } from "../../stores/state.svelte";
  import { getData } from "../../stores/dataStore.svelte";
  import type { GraphData } from "../../types/graph";
  import {
    getVectorStoreService,
    waitForVectorStore,
    waitForVectorStoreIndex,
  } from "../../vectorstore";
  import Button from "../ui/Button.svelte";
  import LoadingAnimation from "../ui/LoadingAnimation.svelte";
  import GraphCanvas from "./GraphCanvas.svelte";
  import {
    buildLocalSemanticGraph,
    buildLocalWikiGraph,
    mergeLocalGraph,
  } from "../../views/local-smart-graph/localGraphDataBuilder";

  const plugin = getPlugin();
  const data = getData();

  const LOCAL_SEMANTIC_THRESHOLD = 0.35;

  type LocalViewMode = "graph" | "list";
  type LocalRelationshipMode = "linked" | "semantic" | "both";

  type LocalNeighborRow = {
    path: string;
    label: string;
    hasWiki: boolean;
    hasSemantic: boolean;
    semanticScore: number | null;
    relationshipLabel: string;
  };

  let canvasComponent: GraphCanvas | undefined = $state(undefined);
  let graphData: GraphData = $state({ nodes: [], edges: [] });
  let activePath: string | null = $state(null);
  let isLoadingSemantic = $state(false);
  let viewMode: LocalViewMode = $state("graph");
  let relationshipMode: LocalRelationshipMode = $state("both");
  let buildVersion = 0;
  let workspaceRefs: EventRef[] = [];

  const activeFile = $derived.by(() => {
    if (!activePath) return null;
    const file = plugin.app.vault.getAbstractFileByPath(activePath);
    return file?.path === activePath ? file : null;
  });

  const activeTitle = $derived.by(() => {
    if (activeFile && "basename" in activeFile) return activeFile.basename;
    if (!activePath) return "";
    return activePath.split("/").pop()?.replace(/\.md$/i, "") ?? activePath;
  });

  const hasSemanticIndex = $derived(Boolean(data.graphEmbedIndex));
  const wikiEdgeCount = $derived(graphData.edges.filter((edge) => edge.type === "wiki").length);
  const semanticEdgeCount = $derived(
    graphData.edges.filter((edge) => edge.type === "semantic").length,
  );

  const visibleGraphData = $derived.by(() => {
    const edges = graphData.edges.filter((edge) => {
      if (relationshipMode === "linked") return edge.type === "wiki";
      if (relationshipMode === "semantic") return edge.type === "semantic";
      if (relationshipMode === "both") return edge.type === "wiki" || edge.type === "semantic";
      return true;
    });

    const visibleNodeIds = new Set<string>();
    if (activePath) {
      visibleNodeIds.add(activePath);
    }
    for (const edge of edges) {
      visibleNodeIds.add(edge.source);
      visibleNodeIds.add(edge.target);
    }

    const nodes = graphData.nodes.filter((node) => visibleNodeIds.has(node.id));
    return { nodes, edges };
  });

  const neighborCount = $derived(
    visibleGraphData.nodes.filter((node) => (activePath ? node.id !== activePath : true)).length,
  );

  const visibleNeighborRows = $derived.by((): LocalNeighborRow[] => {
    if (!activePath) return [];

    const relationshipMap = new Map<string, { hasWiki: boolean; semanticScore: number | null }>();
    for (const edge of visibleGraphData.edges) {
      const neighborPath =
        edge.source === activePath ? edge.target : edge.target === activePath ? edge.source : null;
      if (!neighborPath || neighborPath === activePath) continue;

      const current = relationshipMap.get(neighborPath) ?? { hasWiki: false, semanticScore: null };
      if (edge.type === "wiki") {
        current.hasWiki = true;
      }
      if (edge.type === "semantic") {
        current.semanticScore = Math.max(
          current.semanticScore ?? Number.NEGATIVE_INFINITY,
          edge.weight,
        );
      }
      relationshipMap.set(neighborPath, current);
    }

    return visibleGraphData.nodes
      .filter((node) => node.id !== activePath)
      .map((node) => {
        const relationship = relationshipMap.get(node.id) ?? {
          hasWiki: false,
          semanticScore: null,
        };
        const hasSemantic = relationship.semanticScore != null;
        return {
          path: node.path,
          label: node.label,
          hasWiki: relationship.hasWiki,
          hasSemantic,
          semanticScore: relationship.semanticScore,
          relationshipLabel:
            relationship.hasWiki && hasSemantic
              ? "Both"
              : relationship.hasWiki
                ? "Linked"
                : "Semantic",
        };
      })
      .sort((left, right) => {
        const bothDiff =
          Number(right.hasWiki && right.hasSemantic) - Number(left.hasWiki && left.hasSemantic);
        if (bothDiff !== 0) return bothDiff;

        const semanticDiff =
          (right.semanticScore ?? Number.NEGATIVE_INFINITY) -
          (left.semanticScore ?? Number.NEGATIVE_INFINITY);
        if (semanticDiff !== 0) return semanticDiff;

        if (left.hasWiki !== right.hasWiki) return Number(right.hasWiki) - Number(left.hasWiki);
        return left.label.localeCompare(right.label);
      });
  });

  function syncActivePath(): string | null {
    const file = plugin.app.workspace.getActiveFile();
    activePath = file?.extension === "md" ? file.path : null;
    return activePath;
  }

  async function rebuildGraph(): Promise<void> {
    const localBuildVersion = ++buildVersion;
    const nextActivePath = syncActivePath();

    if (!nextActivePath) {
      graphData = { nodes: [], edges: [] };
      isLoadingSemantic = false;
      return;
    }

    const wikiGraph = buildLocalWikiGraph(plugin.app, nextActivePath);
    graphData = wikiGraph;

    if (!hasSemanticIndex) {
      isLoadingSemantic = false;
      return;
    }

    isLoadingSemantic = true;

    try {
      const serviceReady = await waitForVectorStore();
      if (!serviceReady || localBuildVersion !== buildVersion) return;

      const indexReady = await waitForVectorStoreIndex(data.graphEmbedIndex);
      if (!indexReady || localBuildVersion !== buildVersion) return;

      const documents = await getVectorStoreService().getAllDocumentVectors();
      if (localBuildVersion !== buildVersion) return;

      const semanticGraph = buildLocalSemanticGraph(plugin.app, nextActivePath, documents, {
        threshold: LOCAL_SEMANTIC_THRESHOLD,
      });

      if (localBuildVersion !== buildVersion) return;
      graphData = mergeLocalGraph(wikiGraph, semanticGraph, nextActivePath);
    } catch (error) {
      console.error("[LocalSmartGraph] Failed to build semantic neighborhood", error);
    } finally {
      if (localBuildVersion === buildVersion) {
        isLoadingSemantic = false;
      }
    }
  }

  function handleNodeClick(path: string) {
    plugin.app.workspace.openLinkText(path, "", false);
  }

  function handleRevealFile(path: string) {
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!file) return;

    const explorer = plugin.app.workspace.getLeavesOfType("file-explorer")[0];
    if (explorer) {
      (explorer.view as any).revealInFolder?.(file);
    }
  }

  function registerWorkspaceListeners() {
    const workspace = plugin.app.workspace;
    workspaceRefs = [
      workspace.on("file-open", () => {
        void rebuildGraph();
      }),
      workspace.on("active-leaf-change", () => {
        void rebuildGraph();
      }),
    ];
  }

  onMount(() => {
    registerWorkspaceListeners();
    void rebuildGraph();
  });

  onDestroy(() => {
    for (const ref of workspaceRefs) {
      plugin.app.workspace.offref(ref);
    }
    workspaceRefs = [];
    buildVersion++;
  });
</script>

<div class="local-smart-graph" data-testid="local-smart-graph-root">
  <div class="local-smart-graph__header">
    <div class="local-smart-graph__title-wrap">
      <p class="local-smart-graph__eyebrow">Local Smart Graph</p>
      <h2 class="local-smart-graph__title">{activeTitle || "No active note"}</h2>
      <p class="local-smart-graph__meta">
        {#if activePath}
          {neighborCount} neighboring {neighborCount === 1 ? "note" : "notes"}
          {#if relationshipMode !== "semantic"}
            <span> · {wikiEdgeCount} wiki link{wikiEdgeCount === 1 ? "" : "s"}</span>
          {/if}
          {#if relationshipMode !== "linked"}
            <span> · {semanticEdgeCount} semantic link{semanticEdgeCount === 1 ? "" : "s"}</span>
          {/if}
        {:else}
          Open a markdown note to follow its neighborhood.
        {/if}
      </p>
    </div>

    <div class="local-smart-graph__actions">
      <div class="local-smart-graph__mode-toggle" data-testid="local-smart-graph-view-mode">
        <Button
          buttonText="Graph"
          class:mod-cta={viewMode === "graph"}
          class="local-smart-graph__button"
          dataTestId="local-smart-graph-mode-graph"
          onClick={() => {
            viewMode = "graph";
          }}
        />
        <Button
          buttonText="List"
          class:mod-cta={viewMode === "list"}
          class="local-smart-graph__button"
          dataTestId="local-smart-graph-mode-list"
          onClick={() => {
            viewMode = "list";
          }}
        />
      </div>
      <div class="local-smart-graph__segmented" data-testid="local-smart-graph-relationship-mode">
        <Button
          buttonText="Linked"
          class:mod-cta={relationshipMode === "linked"}
          class="local-smart-graph__button"
          dataTestId="local-smart-graph-mode-linked"
          onClick={() => {
            relationshipMode = "linked";
          }}
        />
        <Button
          buttonText="Semantic"
          class:mod-cta={relationshipMode === "semantic"}
          class="local-smart-graph__button"
          dataTestId="local-smart-graph-mode-semantic"
          onClick={() => {
            relationshipMode = "semantic";
          }}
          disabled={!hasSemanticIndex}
        />
        <Button
          buttonText="Both"
          class:mod-cta={relationshipMode === "both"}
          class="local-smart-graph__button"
          dataTestId="local-smart-graph-mode-both"
          onClick={() => {
            relationshipMode = "both";
          }}
          disabled={!hasSemanticIndex}
        />
      </div>
      <Button
        buttonText="Fit"
        iconId="scan-search"
        class="local-smart-graph__button"
        dataTestId="local-smart-graph-fit"
        onClick={() => canvasComponent?.fitToView()}
        disabled={viewMode !== "graph" || visibleGraphData.nodes.length === 0}
      />
    </div>
  </div>

  <div class="local-smart-graph__status">
    {#if isLoadingSemantic}
      <div class="local-smart-graph__loading" data-testid="local-smart-graph-loading">
        <LoadingAnimation size={14} />
        <span>Refreshing semantic neighbors…</span>
      </div>
    {:else if !hasSemanticIndex}
      <span class="local-smart-graph__hint"
        >Semantic neighbors appear once a graph embedding index is configured.</span
      >
    {/if}
  </div>

  <div class="local-smart-graph__canvas-shell">
    {#if visibleGraphData.nodes.length > 0}
      {#if viewMode === "graph"}
        <GraphCanvas
          bind:this={canvasComponent}
          graphData={visibleGraphData}
          linkDistance={data.smartGraphSettings.linkDistance}
          chargeStrength={data.smartGraphSettings.chargeStrength}
          centerStrength={data.smartGraphSettings.centerStrength}
          linkStrength={data.smartGraphSettings.linkStrength}
          clusterCohesionStrength={0}
          showWikiLinks={true}
          onNodeClick={handleNodeClick}
          onRevealFile={handleRevealFile}
        />
      {:else}
        <div class="local-smart-graph__list" data-testid="local-smart-graph-list">
          {#each visibleNeighborRows as row (row.path)}
            <div class="local-smart-graph__list-row">
              <button
                class="local-smart-graph__list-main"
                type="button"
                onclick={() => handleNodeClick(row.path)}
              >
                <span class="local-smart-graph__list-title">{row.label}</span>
                <span class="local-smart-graph__list-path">{row.path}</span>
              </button>

              <div class="local-smart-graph__list-meta">
                <span class="local-smart-graph__badge">{row.relationshipLabel}</span>
                {#if row.semanticScore != null}
                  <span class="local-smart-graph__score"
                    >{Math.round(row.semanticScore * 100)}%</span
                  >
                {/if}
                <Button
                  iconId="folder-open"
                  ariaLabel={`Reveal ${row.label}`}
                  class="local-smart-graph__icon-button"
                  dataTestId={`local-smart-graph-reveal-${row.label}`}
                  onClick={() => handleRevealFile(row.path)}
                />
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="local-smart-graph__empty" data-testid="local-smart-graph-empty">
        {#if activePath}
          No neighboring notes found for this note.
        {:else}
          Open a markdown note to populate the local graph.
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .local-smart-graph {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    min-height: 0;
    padding: 12px;
  }

  .local-smart-graph__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .local-smart-graph__title-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .local-smart-graph__eyebrow {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .local-smart-graph__title {
    margin: 0;
    font-size: 1.2rem;
    line-height: 1.2;
  }

  .local-smart-graph__meta,
  .local-smart-graph__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .local-smart-graph__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .local-smart-graph__mode-toggle {
    display: inline-flex;
    gap: 8px;
  }

  .local-smart-graph__segmented {
    display: inline-flex;
    gap: 8px;
  }

  .local-smart-graph__button {
    white-space: nowrap;
  }

  .local-smart-graph__icon-button {
    flex-shrink: 0;
  }

  .local-smart-graph__status {
    min-height: 20px;
  }

  .local-smart-graph__loading {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .local-smart-graph__canvas-shell {
    position: relative;
    flex: 1;
    min-height: 280px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    overflow: hidden;
    background: radial-gradient(
        circle at top,
        color-mix(in srgb, var(--interactive-accent) 8%, transparent),
        transparent 45%
      ),
      var(--background-primary);
  }

  .local-smart-graph__empty {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
  }

  .local-smart-graph__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    overflow: auto;
    padding: 12px;
  }

  .local-smart-graph__list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--background-secondary) 72%, transparent);
  }

  .local-smart-graph__list-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: inherit;
  }

  .local-smart-graph__list-title {
    font-weight: 600;
    color: var(--text-normal);
  }

  .local-smart-graph__list-path {
    font-size: 0.82rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .local-smart-graph__list-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .local-smart-graph__badge,
  .local-smart-graph__score {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 0.78rem;
    line-height: 1;
  }

  .local-smart-graph__badge {
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
    color: var(--text-normal);
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 28%, transparent);
  }

  .local-smart-graph__score {
    background: color-mix(in srgb, var(--background-modifier-border) 55%, transparent);
    color: var(--text-muted);
  }

  @media (max-width: 720px) {
    .local-smart-graph__list-row {
      align-items: flex-start;
      flex-direction: column;
    }

    .local-smart-graph__list-meta {
      width: 100%;
      justify-content: flex-start;
      flex-wrap: wrap;
    }
  }
</style>
