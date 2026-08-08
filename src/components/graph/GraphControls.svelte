<script lang="ts">
import { Platform } from "obsidian";
import Button from "../ui/Button.svelte";
import RangeSlider from "../ui/RangeSlider.svelte";
import Toggle from "../ui/Toggle.svelte";
import SettingContainer from "../settings/SettingContainer.svelte";
import {
	type SmartGraphSettings,
	type GraphData,
	type SpaceSegment,
	DEFAULT_SMART_GRAPH_SETTINGS,
} from "../../types/graph";

interface Props {
	settings: SmartGraphSettings;
	isLoading?: boolean;
	loadingLabel?: string;
	onSettingsChange: (patch: Partial<SmartGraphSettings>) => void;
	onFitToView: () => void;
	onZoomIn?: () => void;
	onZoomOut?: () => void;
	onRefresh: () => void;
	onReapplySegments?: () => void;
	onSeedChange?: () => void;
	onTopicsCommit?: (resolution: number) => void;
	isLeidenRunning?: boolean;
	lassoMode?: boolean;
	onLassoModeChange?: (active: boolean) => void;
	graphData?: GraphData;
	nodeCount?: number;
	// Segments (community list)
	segments?: SpaceSegment[];
	focusedSegmentIds?: Set<string>;
	onFocusSegment?: (id: string, multi: boolean) => void;
	// Skeleton view
	skeletonDetail?: number;
	onSkeletonDetailChange?: (value: number) => void;
	onSkeletonDetailCommit?: (value: number) => void;
	onSkeletonToggle?: () => void;
}

let {
	settings,
	isLoading = false,
	loadingLabel = "",
	onSettingsChange,
	onFitToView,
	onZoomIn,
	onZoomOut,
	onRefresh,
	onReapplySegments,
	onSeedChange,
	onTopicsCommit,
	isLeidenRunning = false,
	lassoMode = false,
	onLassoModeChange,
	graphData = { nodes: [], edges: [] },
	nodeCount = 0,
	segments = [],
	focusedSegmentIds = new Set<string>(),
	onFocusSegment,
	skeletonDetail = 100,
	onSkeletonDetailChange,
	onSkeletonDetailCommit,
	onSkeletonToggle,
}: Props = $props();

let isCollapsed = $state(true);
let isDevCollapsed = $state(true);

let sectionOpen: Record<string, boolean> = $state({
	devLayout: false,
	devLeiden: false,
});

let graphStats = $derived.by(() => {
	const { nodes, edges } = graphData;
	if (nodes.length === 0) return null;

	const degrees = nodes.map((n) => n.degree ?? 0);
	const totalDegree = degrees.reduce((a, b) => a + b, 0);
	const avgDegree = totalDegree / nodes.length;
	const maxDegree = Math.max(...degrees);
	const unlinkedNotes = degrees.filter((d) => d === 0).length;
	const wikiEdges = edges.filter((e) => e.type === "wiki").length;
	const clusters = new Set(nodes.map((n) => n.cluster).filter((c) => c != null));

	return { avgDegree, maxDegree, unlinkedNotes, wikiEdges, clusterCount: clusters.size };
});

function handleLinkDistanceChange(val: number) {
	onSettingsChange({ linkDistance: val });
}

function handleChargeStrengthChange(val: number) {
	onSettingsChange({ chargeStrength: -Math.abs(val) });
}

function handleCenterStrengthChange(val: number) {
	onSettingsChange({ centerStrength: val / 100 });
}

function handleLinkStrengthChange(val: number) {
	onSettingsChange({ linkStrength: val / 100 });
}

function handleClusterCohesionStrengthChange(val: number) {
	onSettingsChange({ clusterCohesionStrength: val / 100 });
}
</script>

<!-- Unified vertical toolbar -->
<div class="graph-toolbar">
  <Button iconId="maximize" onClick={onFitToView} tooltip="Fit graph to view (F)" />
  {#if Platform.isMobile}
    <!-- Touch has no scroll-wheel zoom; expose on-screen +/- (pinch still works). -->
    <Button iconId="zoom-in" onClick={() => onZoomIn?.()} tooltip="Zoom in" />
    <Button iconId="zoom-out" onClick={() => onZoomOut?.()} tooltip="Zoom out" />
  {/if}
  <Button
    iconId="lasso"
    tooltip={lassoMode ? "Exit lasso selection" : "Lasso selection (or hold Shift + drag)"}
    onClick={() => onLassoModeChange?.(!lassoMode)}
    styles={lassoMode ? "is-active" : ""}
  />
  <Button
    iconId="atom"
    tooltip={isLeidenRunning
      ? "Computing topics…"
      : skeletonDetail < 100
        ? "Exit outline view (S)"
        : "Outline view: top topics and bridge notes only (S)"}
    onClick={() => onSkeletonToggle?.()}
    disabled={isLeidenRunning}
    styles={skeletonDetail < 100 ? "is-active" : ""}
  />
  <div class="toolbar-icon-wrapper">
    <Button
      iconId="sliders-horizontal"
      tooltip={isCollapsed ? "Show graph panel" : "Hide graph panel"}
      onClick={() => (isCollapsed = !isCollapsed)}
      styles={!isCollapsed ? "is-active" : ""}
    />
  </div>
  {#if import.meta.env.DEV}
    <div class="toolbar-icon-wrapper">
      <Button
        iconId="wrench"
        tooltip={isDevCollapsed ? "Show dev panel" : "Hide dev panel"}
        onClick={() => (isDevCollapsed = !isDevCollapsed)}
        styles={!isDevCollapsed ? "is-active" : ""}
      />
    </div>
  {/if}
</div>

<!-- Main settings panel -->
<div class="graph-controls" class:collapsed={isCollapsed}>
  {#if !isCollapsed}
    <div class="graph-controls-body">
      <!-- ── Stats row ──────────────────────────── -->
      <div class="stats-row">
        <span class="stats-text">
          {#if isLoading}
            <span class="loading-label">{loadingLabel}</span>
          {:else if graphStats}
            {nodeCount} notes · {graphStats.unlinkedNotes} isolated · {graphStats.avgDegree.toFixed(1)} avg links
          {:else}
            {nodeCount} notes
          {/if}
        </span>
      </div>

      <!-- ── Topics ───────────────────────────── -->
      {#if segments.length > 0}
        <span class="section-label">Topics · {segments.length} <span class="section-label-hint">shift/⌘ multi-select</span></span>
        <div class="segment-list">
          {#each segments as seg (seg.id)}
            <button
              type="button"
              class="segment-row"
              class:segment-row--active={focusedSegmentIds.has(seg.id)}
              onclick={(e) => onFocusSegment?.(seg.id, e.shiftKey || e.metaKey || e.ctrlKey)}
            >
              <span class="segment-dot" style="background-color: {seg.color}"></span>
              <span class="segment-label">{seg.label}</span>
              <span class="segment-count">{seg.paths.size}</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- ── Topics / Detail sliders ───────────── -->
      <SettingContainer name="Topics" desc="Number of topics — lower groups notes broadly, higher splits them finely" compact>
        <RangeSlider
          value={Math.round((settings.leidenResolution ?? 1.0) * 100)}
          min={10}
          max={300}
          step={5}
          showValue={true}
          oncommit={(v) => onTopicsCommit?.(v / 100)}
        />
      </SettingContainer>
      <SettingContainer name="Detail" desc="Nodes per topic — lower keeps only the top hubs and bridges" compact>
        <RangeSlider
          value={skeletonDetail}
          min={0}
          max={100}
          step={1}
          showValue={true}
          onchange={onSkeletonDetailChange}
          oncommit={onSkeletonDetailCommit}
        />
      </SettingContainer>

      <!-- ── Display ───────────────────────────── -->
      <span class="section-label">Display</span>
      <SettingContainer
        name="Markdown only"
        desc="Show only Markdown notes; off shows all indexable files"
        compact
      >
        <Toggle
          checked={settings.markdownOnly}
          onchange={(value) => onSettingsChange({ markdownOnly: value })}
        />
      </SettingContainer>
      <SettingContainer
        name="Direction arrows"
        desc="Show arrows for directed wiki links"
        compact
      >
        <Toggle
          checked={settings.directedWikiEdges}
          onchange={(value) => onSettingsChange({ directedWikiEdges: value })}
        />
      </SettingContainer>
      <SettingContainer
        name="Highlight isolated"
        desc="Mark notes with no wiki links in accent color"
        compact
      >
        <Toggle
          checked={settings.highlightIsolated}
          onchange={(value) => onSettingsChange({ highlightIsolated: value })}
        />
      </SettingContainer>
      <SettingContainer
        name="Highlight bridges"
        desc="Mark notes that connect multiple topics in accent color"
        compact
      >
        <Toggle
          checked={settings.highlightBridges}
          onchange={(value) => onSettingsChange({ highlightBridges: value })}
        />
      </SettingContainer>
    </div>
  {/if}
</div>

<!-- Dev panel (dev build only) -->
{#if import.meta.env.DEV}
  <div class="graph-controls graph-controls--dev" class:collapsed={isDevCollapsed}>
    {#if !isDevCollapsed}
      <div class="graph-controls-body">
        <button
          type="button"
          class="section-label section-label--collapsible"
          onclick={() => (sectionOpen.devLayout = !sectionOpen.devLayout)}
        >
          <span>Layout</span>
          <svg class="section-chevron" class:open={sectionOpen.devLayout} xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        {#if sectionOpen.devLayout}
          <SettingContainer name="Link distance" desc="Target distance between connected nodes" compact>
            <RangeSlider value={settings.linkDistance} min={30} max={500} step={5} showValue={true} oncommit={handleLinkDistanceChange} />
          </SettingContainer>
          <SettingContainer name="Repulsion" desc="How strongly nodes push each other apart" compact>
            <RangeSlider value={Math.abs(settings.chargeStrength)} min={10} max={1500} step={10} showValue={true} oncommit={handleChargeStrengthChange} />
          </SettingContainer>
          <SettingContainer name="Center force" desc="How strongly the graph is pulled toward the center" compact>
            <RangeSlider value={Math.round(settings.centerStrength * 100)} min={0} max={100} step={1} showValue={true} oncommit={handleCenterStrengthChange} />
          </SettingContainer>
          <SettingContainer name="Link strength" desc="How strongly edges pull connected nodes together" compact>
            <RangeSlider value={Math.round(settings.linkStrength * 100)} min={0} max={100} step={1} showValue={true} oncommit={handleLinkStrengthChange} />
          </SettingContainer>
          <SettingContainer name="Cluster cohesion" desc="How strongly nodes are pulled toward their cluster center" compact>
            <RangeSlider value={Math.round((settings.clusterCohesionStrength ?? 0.15) * 100)} min={0} max={100} step={1} showValue={true} oncommit={handleClusterCohesionStrengthChange} />
          </SettingContainer>
        {/if}

        <button
          type="button"
          class="section-label section-label--collapsible"
          onclick={() => (sectionOpen.devLeiden = !sectionOpen.devLeiden)}
        >
          <span>Leiden</span>
          <svg class="section-chevron" class:open={sectionOpen.devLeiden} xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        {#if sectionOpen.devLeiden}
          <SettingContainer name="Seed" desc="PRNG seed — same seed + graph = same topics" compact>
            <input
              type="number"
              class="dev-number-input"
              value={settings.leidenSeed ?? 42}
              min={0} max={999999} step={1}
              onchange={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (Number.isFinite(v)) { onSettingsChange({ leidenSeed: Math.round(v) }); onSeedChange?.(); }
              }}
            />
          </SettingContainer>
          <SettingContainer name="Bridge threshold" desc="Min fraction of foreign-topic neighbors to qualify as a bridge" compact>
            <RangeSlider value={Math.round((settings.bridgeThreshold ?? 0.4) * 100)} min={0} max={100} step={5} showValue={true} oncommit={(v) => { onSettingsChange({ bridgeThreshold: v / 100 }); onReapplySegments?.(); }} />
          </SettingContainer>
          <SettingContainer name="Detail bridge centrality" desc="Min betweenness centrality for bridges to survive at low Detail" compact>
            <RangeSlider value={Math.round((settings.skeletonBridgeCentralityThreshold ?? 0.05) * 1000)} min={0} max={200} step={1} showValue={true} oncommit={(v) => onSettingsChange({ skeletonBridgeCentralityThreshold: v / 1000 })} />
          </SettingContainer>
          <SettingContainer name="Outline Topics" desc="Topics value the atom toggle collapses to (γ ×100)" compact>
            <RangeSlider value={Math.round((settings.outlineViewResolution ?? 0.5) * 100)} min={10} max={300} step={5} showValue={true} oncommit={(v) => onSettingsChange({ outlineViewResolution: v / 100 })} />
          </SettingContainer>
          <SettingContainer name="Outline Detail" desc="Detail value the atom toggle collapses to (0–100)" compact>
            <RangeSlider value={settings.outlineViewDetail ?? 30} min={0} max={100} step={1} showValue={true} oncommit={(v) => onSettingsChange({ outlineViewDetail: v })} />
          </SettingContainer>
        {/if}

        <div class="dev-actions">
          <Button iconId="refresh-cw" onClick={onRefresh} tooltip="Rebuild graph" />
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .graph-toolbar {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 11;
  }

  .toolbar-icon-wrapper {
    position: relative;
    display: flex;
  }

  .graph-controls {
    position: absolute;
    top: 8px;
    right: 52px;
    width: 300px;
    max-height: calc(100% - 16px);
    overflow-y: auto;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    z-index: 10;
    box-shadow: none;
  }

  .graph-controls.collapsed {
    display: none;
  }

  .graph-controls--dev {
    top: 8px;
    right: 356px;
  }

  .graph-controls-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stats-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--background-modifier-border);
    margin-bottom: 4px;
  }

  .stats-text {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .loading-label {
    color: var(--text-faint);
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-top: 8px;
    padding-bottom: 2px;
  }

  .section-label-hint {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 10px;
    color: var(--text-faint);
    margin-left: 4px;
  }

  .section-chevron {
    transition: transform 0.15s ease;
    transform: rotate(-90deg);
    flex-shrink: 0;
  }

  .section-chevron.open {
    transform: rotate(0deg);
  }

  /* Segment list */
  .segment-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 0 6px;
  }

  .segment-row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 3px 6px;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-normal);
    text-align: left;
    transition: background-color 0.1s ease;
  }

  .segment-row:hover {
    background: var(--background-modifier-hover);
  }

  .segment-row--active {
    background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary));
  }

  .segment-dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    min-width: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .segment-label {
    flex: 1;
    font-size: var(--font-ui-small);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .segment-count {
    font-size: 0.7rem;
    color: var(--text-faint);
    flex-shrink: 0;
  }

  .dev-number-input {
    width: 72px;
    padding: 2px 6px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    text-align: right;
  }

  .section-label--collapsible {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .section-label--collapsible:hover {
    color: var(--text-normal);
  }

  .dev-actions {
    display: flex;
    gap: 4px;
    padding-top: 4px;
  }
</style>
