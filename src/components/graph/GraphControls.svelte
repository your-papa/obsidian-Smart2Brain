<script lang="ts">
import Button from "../ui/Button.svelte";
import RangeSlider from "../ui/RangeSlider.svelte";
import Dropdown from "../ui/Dropdown.svelte";
import SettingContainer from "../settings/SettingContainer.svelte";
import {
	type ClusteringAlgorithm,
	type SmartGraphSettings,
	type SegmentBy,
	type GraphData,
	type RegionSegment,
	DEFAULT_SMART_GRAPH_SETTINGS,
} from "../../types/graph";

interface Props {
	settings: SmartGraphSettings;
	isLoading?: boolean;
	loadingLabel?: string;
	segmentBy: SegmentBy;
	onSettingsChange: (patch: Partial<SmartGraphSettings>) => void;
	onSegmentByChange: (s: SegmentBy) => void;
	onResetSettings?: () => void;
	onFitToView: () => void;
	onRefresh: () => void;
	onApplyProjection?: () => void;
	onLabelClusters?: () => void;
	isLabeling?: boolean;
	lassoMode?: boolean;
	onLassoModeChange?: (active: boolean) => void;
	graphData?: GraphData;
	nodeCount?: number;
	// Spaces
	immersedSpaceId: string | null;
	// Segments
	segments?: RegionSegment[];
	focusedSegmentId?: string | null;
	onFocusSegment?: (id: string | null) => void;
}

let {
	settings,
	isLoading = false,
	loadingLabel = "",
	segmentBy,
	onSettingsChange,
	onSegmentByChange,
	onResetSettings,
	onFitToView,
	onRefresh,
	onApplyProjection,
	onLabelClusters,
	isLabeling = false,
	lassoMode = false,
	onLassoModeChange,
	graphData = { nodes: [], edges: [] },
	nodeCount = 0,
	immersedSpaceId,
	segments = [],
	focusedSegmentId = null,
	onFocusSegment,
}: Props = $props();

let isCollapsed = $state(true);

let sectionOpen: Record<string, boolean> = $state({
	colorBy: true,
	layout: false,
	overview: false,
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

const APPLY_KEYS = [
	"autoK",
	"defaultK",
	"clusteringAlgorithm",
	"minClusterSize",
] as const satisfies readonly (keyof SmartGraphSettings)[];

type ApplySnapshot = Pick<SmartGraphSettings, (typeof APPLY_KEYS)[number]>;

function takeSnapshot(s: SmartGraphSettings): ApplySnapshot {
	const snap = {} as ApplySnapshot;
	for (const k of APPLY_KEYS) (snap as Record<string, unknown>)[k] = s[k];
	return snap;
}

// svelte-ignore state_referenced_locally
let appliedSnapshot: ApplySnapshot = $state(takeSnapshot(settings));

let projectionDirty = $derived(APPLY_KEYS.some((k) => settings[k] !== appliedSnapshot[k]));

const clusteringAlgorithmOptions = [
	{ display: "K-Means", value: "kmeans" as ClusteringAlgorithm },
	{ display: "HDBSCAN", value: "hdbscan" as ClusteringAlgorithm },
];

function handleKChange(val: number) {
	onSettingsChange({ defaultK: val });
}

function handleClusteringAlgorithmChange(val: ClusteringAlgorithm) {
	onSettingsChange({ clusteringAlgorithm: val });
}

function handleMinClusterSizeChange(val: number) {
	onSettingsChange({ minClusterSize: val });
}

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

function handleResetSettings() {
	onResetSettings?.();
	appliedSnapshot = takeSnapshot(DEFAULT_SMART_GRAPH_SETTINGS);
}

const colorByOptions = [
	{ display: "None", value: "none" as SegmentBy },
	{ display: "Spaces", value: "regions" as SegmentBy },
	{ display: "Similarity", value: "semantic" as SegmentBy },
	{ display: "Link Communities", value: "louvain" as SegmentBy },
	{ display: "Folder", value: "folder" as SegmentBy },
	{ display: "Tag", value: "tag" as SegmentBy },
	{ display: "File Type", value: "extension" as SegmentBy },
];
</script>

<!-- Unified vertical toolbar -->
<div class="graph-toolbar">
  <Button iconId="maximize" onClick={onFitToView} tooltip="Fit graph to view (F)" />
  <Button iconId="refresh-cw" onClick={onRefresh} tooltip="Rebuild graph" />
  <Button
    iconId="lasso"
    tooltip={lassoMode ? "Exit lasso selection" : "Lasso selection (or hold Shift + drag)"}
    onClick={() => onLassoModeChange?.(!lassoMode)}
    styles={lassoMode ? "is-active" : ""}
  />
  <div class="toolbar-icon-wrapper">
    <Button
      iconId="sliders-horizontal"
      tooltip={isCollapsed ? "Show graph panel" : "Hide graph panel"}
      onClick={() => {
        isCollapsed = !isCollapsed;
      }}
      styles={!isCollapsed ? "is-active" : ""}
    />
    {#if immersedSpaceId}
      <span class="toolbar-badge"></span>
    {/if}
  </div>
</div>

<!-- Unified settings panel -->
<div class="graph-controls" class:collapsed={isCollapsed}>
  {#if !isCollapsed}
    <div class="graph-controls-header">
      <div>
        <h4 class="graph-controls-title" data-testid="graph-controls-title">Graph Panel</h4>
        <div class="graph-controls-subtitle">
          {nodeCount} notes · Force-directed
          {#if isLoading}
            <span class="loading-label"> · {loadingLabel}</span>
          {/if}
        </div>
      </div>
      <Button iconId="rotate-ccw" onClick={handleResetSettings} tooltip="Reset to defaults" />
    </div>

    <div class="graph-controls-body">
      <!-- ═══════════════════════════════════════ -->
      <!-- OVERVIEW SECTION                       -->
      <!-- ═══════════════════════════════════════ -->
      {#if graphStats}
        <button
          type="button"
          class="section-header section-header--first"
          onclick={() => (sectionOpen.overview = !sectionOpen.overview)}
        >
          <span>Overview</span>
          <svg
            class="section-chevron"
            class:open={sectionOpen.overview}
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg
          >
        </button>
        {#if sectionOpen.overview}
          <div class="overview-grid">
            <div class="overview-item">
              <span class="overview-label">Connections</span><span class="overview-value"
                >{graphStats.avgDegree.toFixed(1)} avg</span
              >
            </div>
            <div class="overview-item">
              <span class="overview-label">Hubs</span><span class="overview-value"
                >{graphStats.maxDegree} max</span
              >
            </div>
            <div class="overview-item">
              <span class="overview-label">Isolated</span><span class="overview-value"
                >{graphStats.unlinkedNotes}</span
              >
            </div>
            <div class="overview-item">
              <span class="overview-label">Wiki links</span><span class="overview-value"
                >{graphStats.wikiEdges}</span
              >
            </div>
          </div>
        {/if}
      {/if}

      <!-- ═══════════════════════════════════════ -->
      <!-- COLOR BY SECTION                       -->
      <!-- ═══════════════════════════════════════ -->
      <button
        type="button"
        class="section-header{graphStats ? '' : ' section-header--first'}"
        onclick={() => (sectionOpen.colorBy = !sectionOpen.colorBy)}
      >
        <span
          >Color by{segmentBy !== "none"
            ? ` · ${colorByOptions.find((o) => o.value === segmentBy)?.display ?? segmentBy}`
            : ""}</span
        >
        <svg
          class="section-chevron"
          class:open={sectionOpen.colorBy}
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg
        >
      </button>

      {#if sectionOpen.colorBy}
        <SettingContainer name="Color by" desc="How nodes are colored and grouped" compact>
          <Dropdown
            type="options"
            dropdown={colorByOptions}
            selected={segmentBy}
            onchange={(v) => onSegmentByChange(v)}
          />
        </SettingContainer>

        <!-- Segment list -->
        {#if segments.length > 0 && segmentBy !== "none"}
          <div class="segment-list">
            {#each segments as seg (seg.id)}
              <button
                type="button"
                class="segment-row"
                class:segment-row--active={focusedSegmentId === seg.id}
                onclick={() => onFocusSegment?.(focusedSegmentId === seg.id ? null : seg.id)}
              >
                <span class="segment-dot" style="background-color: {seg.color}"></span>
                <span class="segment-label">{seg.label}</span>
                <span class="segment-count">{seg.paths.size}</span>
              </button>
            {/each}
          </div>
        {/if}

        <!-- Similarity-specific: clustering controls -->
        {#if segmentBy === "semantic"}
          <SettingContainer name="Algorithm" desc="How nodes are grouped into clusters" compact>
            <Dropdown
              type="options"
              dropdown={clusteringAlgorithmOptions}
              selected={settings.clusteringAlgorithm}
              onchange={handleClusteringAlgorithmChange}
            />
          </SettingContainer>

          {#if settings.clusteringAlgorithm === "hdbscan"}
            <SettingContainer name="Min cluster size" desc="Smallest allowed cluster" compact>
              <RangeSlider
                value={settings.minClusterSize}
                min={2}
                max={50}
                step={1}
                showValue={true}
                oncommit={handleMinClusterSizeChange}
              />
            </SettingContainer>
          {:else}
            <SettingContainer
              name="Clusters (K)"
              desc={settings.autoK ? "Auto-determined" : "Number of clusters"}
              compact
            >
              {#if !settings.autoK}
                <RangeSlider
                  value={settings.defaultK}
                  min={2}
                  max={30}
                  step={1}
                  showValue={true}
                  oncommit={handleKChange}
                />
              {/if}
            </SettingContainer>
          {/if}

          <div class="color-by-actions">
            <Button
              buttonText={isLabeling ? "Labeling…" : "Label clusters"}
              onClick={onLabelClusters}
              disabled={isLabeling || isLoading}
            />
            {#if projectionDirty && onApplyProjection}
              <Button
                cta
                buttonText="Apply"
                onClick={() => {
                  onApplyProjection?.();
                  appliedSnapshot = takeSnapshot(settings);
                }}
                tooltip="Recompute clusters"
                disabled={isLoading}
              />
            {/if}
          </div>
        {/if}
      {/if}

      <!-- ═══════════════════════════════════════ -->
      <!-- LAYOUT SECTION                         -->
      <!-- ═══════════════════════════════════════ -->
      <button
        type="button"
        class="section-header"
        onclick={() => (sectionOpen.layout = !sectionOpen.layout)}
      >
        <span>Layout</span>
        <svg
          class="section-chevron"
          class:open={sectionOpen.layout}
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg
        >
      </button>

      {#if sectionOpen.layout}
        <SettingContainer
          name="Link distance"
          desc="Target distance between connected nodes"
          compact
        >
          <RangeSlider
            value={settings.linkDistance}
            min={30}
            max={500}
            step={5}
            showValue={true}
            oncommit={handleLinkDistanceChange}
          />
        </SettingContainer>
        <SettingContainer name="Repulsion" desc="How strongly nodes push each other apart" compact>
          <RangeSlider
            value={Math.abs(settings.chargeStrength)}
            min={10}
            max={1500}
            step={10}
            showValue={true}
            oncommit={handleChargeStrengthChange}
          />
        </SettingContainer>
        <SettingContainer
          name="Center force"
          desc="How strongly the graph is pulled toward the center"
          compact
        >
          <RangeSlider
            value={Math.round(settings.centerStrength * 100)}
            min={0}
            max={100}
            step={1}
            showValue={true}
            oncommit={handleCenterStrengthChange}
          />
        </SettingContainer>
        <SettingContainer
          name="Link strength"
          desc="How strongly edges pull connected nodes together"
          compact
        >
          <RangeSlider
            value={Math.round(settings.linkStrength * 100)}
            min={0}
            max={100}
            step={1}
            showValue={true}
            oncommit={handleLinkStrengthChange}
          />
        </SettingContainer>
        <SettingContainer
          name="Cluster cohesion"
          desc="How strongly nodes are pulled toward their cluster center"
          compact
        >
          <RangeSlider
            value={Math.round((settings.clusterCohesionStrength ?? 0.15) * 100)}
            min={0}
            max={100}
            step={1}
            showValue={true}
            oncommit={handleClusterCohesionStrengthChange}
          />
        </SettingContainer>
      {/if}
    </div>
  {/if}
</div>

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

  .toolbar-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--interactive-accent);
    pointer-events: none;
  }

  :global(.clickable-icon.is-active) {
    color: var(--interactive-accent);
    background: var(--interactive-accent-hover);
  }

  .graph-controls {
    position: absolute;
    top: 8px;
    right: 44px;
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

  .graph-controls-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .graph-controls-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .graph-controls-subtitle {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 1px;
  }

  .loading-label {
    color: var(--text-faint);
  }

  .graph-controls-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    padding: 6px 0 4px;
    border: none;
    border-top: 1px solid var(--background-modifier-border);
    margin-top: 4px;
    background: none;
    cursor: pointer;
  }

  .section-header--first {
    border-top: none;
    margin-top: 0;
  }

  .section-header:hover {
    color: var(--text-normal);
  }

  .section-chevron {
    transition: transform 0.15s ease;
    transform: rotate(-90deg);
    flex-shrink: 0;
  }

  .section-chevron.open {
    transform: rotate(0deg);
  }

  .overview-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 4px 0;
  }

  .overview-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: var(--background-primary);
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
  }

  .overview-label {
    font-size: 11px;
    color: var(--text-muted);
  }

  .overview-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
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
</style>
