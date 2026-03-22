<script lang="ts">
import Button from "../ui/Button.svelte";
import Toggle from "../ui/Toggle.svelte";
import RangeSlider from "../ui/RangeSlider.svelte";
import Dropdown from "../ui/Dropdown.svelte";
import Search from "../ui/Search.svelte";
import Text from "../ui/Text.svelte";
import PresetColorSelector, { type PresetColorOption } from "../ui/PresetColorSelector.svelte";
import SettingContainer from "../settings/SettingContainer.svelte";
import type {
	ProjectionMethod,
	ClusteringAlgorithm,
	SmartGraphSettings,
	GraphMode,
	ColorGroup,
	GraphData,
} from "../../types/graph";
import { THEME_COLOR_VARS } from "../../types/graph";

const GRAPH_PRESET_COLOR_OPTIONS: Array<PresetColorOption & { cssVar?: string }> = [
	{ value: "#e93147", label: "Red", previewColor: "#e93147", cssVar: "--color-red" },
	{ value: "#086ddd", label: "Blue", previewColor: "#086ddd", cssVar: "--color-blue" },
	{ value: "#08b94e", label: "Green", previewColor: "#08b94e", cssVar: "--color-green" },
	{ value: "#ec7500", label: "Orange", previewColor: "#ec7500", cssVar: "--color-orange" },
	{ value: "#7852ee", label: "Purple", previewColor: "#7852ee", cssVar: "--color-purple" },
	{ value: "#00bfbc", label: "Cyan", previewColor: "#00bfbc", cssVar: "--color-cyan" },
	{ value: "#e0ac00", label: "Yellow", previewColor: "#e0ac00", cssVar: "--color-yellow" },
	{ value: "#d53984", label: "Pink", previewColor: "#d53984", cssVar: "--color-pink" },
	{ value: "#7a6ae6", label: "Accent", previewColor: "#7a6ae6", cssVar: "--interactive-accent" },
];

interface Props {
	settings: SmartGraphSettings;
	suggestedK: number | null;
	isLoading: boolean;
	graphMode: GraphMode;
	isTransitioning: boolean;
	nodeCount: number;
	edgeCount: number;
	graphData: GraphData;
	availableFolders: string[];
	availableTags: string[];
	selectedFolders: string[];
	selectedTags: string[];
	searchQuery: string;
	onSettingsChange: (settings: Partial<SmartGraphSettings>) => void;
	onFolderFilterChange: (folders: string[]) => void;
	onTagFilterChange: (tags: string[]) => void;
	onSearchChange: (query: string) => void;
	onFitToView: () => void;
	onRefresh: () => void;
	onApplyProjection?: () => void;
	onSmartCluster?: () => void;
	onBackToWiki?: () => void;
	onLabelClusters?: () => void;
	isLabeling?: boolean;
	lassoMode?: boolean;
	onLassoModeChange?: (active: boolean) => void;
	selectedCount?: number;
}

let {
	settings,
	suggestedK,
	isLoading,
	graphMode,
	isTransitioning,
	nodeCount,
	edgeCount,
	graphData,
	availableFolders,
	availableTags,
	selectedFolders,
	selectedTags,
	searchQuery,
	onSettingsChange,
	onFolderFilterChange,
	onTagFilterChange,
	onSearchChange,
	onFitToView,
	onRefresh,
	onApplyProjection,
	onSmartCluster,
	onBackToWiki,
	onLabelClusters,
	isLabeling = false,
	lassoMode = false,
	onLassoModeChange,
	selectedCount = 0,
}: Props = $props();

let isCollapsed = $state(true);
let isFilterOpen = $state(false);
let isInfoOpen = $state(false);

let graphStats = $derived.by(() => {
	const { nodes, edges } = graphData;
	if (nodes.length === 0) return null;

	const degrees = nodes.map((n) => n.degree ?? 0);
	const totalDegree = degrees.reduce((a, b) => a + b, 0);
	const avgDegree = totalDegree / nodes.length;
	const maxDegree = Math.max(...degrees);
	const unlinkedNotes = degrees.filter((d) => d === 0).length;

	const wikiEdges = edges.filter((e) => e.type === "wiki").length;

	// Graph density: ratio of actual edges to max possible edges
	const maxEdges = (nodes.length * (nodes.length - 1)) / 2;
	const density = maxEdges > 0 ? edges.length / maxEdges : 0;

	// Cluster count
	const clusters = new Set(nodes.map((n) => n.cluster).filter((c) => c != null));

	// Average shortest path (BFS, sampled for performance)
	const adj = new Map<string, Set<string>>();
	for (const n of nodes) adj.set(n.id, new Set());
	for (const e of edges) {
		adj.get(e.source)?.add(e.target);
		adj.get(e.target)?.add(e.source);
	}

	const sampleSize = Math.min(nodes.length, 50);
	const sampled =
		nodes.length <= sampleSize ? nodes : nodes.filter((_, i) => i % Math.ceil(nodes.length / sampleSize) === 0);
	let totalDist = 0;
	let pathCount = 0;
	let maxPath = 0;

	for (const start of sampled) {
		const dist = new Map<string, number>([[start.id, 0]]);
		const queue = [start.id];
		let qi = 0;
		while (qi < queue.length) {
			const cur = queue[qi++];
			const d = dist.get(cur)!;
			for (const nb of adj.get(cur) ?? []) {
				if (!dist.has(nb)) {
					dist.set(nb, d + 1);
					queue.push(nb);
				}
			}
		}
		for (const [, d] of dist) {
			if (d > 0) {
				totalDist += d;
				pathCount++;
				if (d > maxPath) maxPath = d;
			}
		}
	}

	const avgPath = pathCount > 0 ? totalDist / pathCount : 0;

	return {
		avgDegree,
		maxDegree,
		unlinkedNotes,
		wikiEdges,
		density,
		clusterCount: clusters.size,
		avgPath,
		diameter: maxPath,
	};
});

let hasActiveFilters = $derived(selectedFolders.length > 0 || selectedTags.length > 0 || searchQuery.length > 0);

// Per-section collapse state
let sectionOpen: Record<string, boolean> = $state({
	colorGroups: false,
	projection: true,
	layout: false,
});

// Track "dirty" projection/clustering settings that need an explicit Apply.
// Store the last-applied values so the button only appears when settings
// actually differ from what's currently rendered.
// svelte-ignore state_referenced_locally
let appliedProjection: ProjectionMethod = $state(settings.projectionMethod);
// svelte-ignore state_referenced_locally
let appliedUmapNeighbors: number = $state(settings.umapNeighbors);
// svelte-ignore state_referenced_locally
let appliedUmapMinDist: number = $state(settings.umapMinDist);
// svelte-ignore state_referenced_locally
let appliedAutoK: boolean = $state(settings.autoK);
// svelte-ignore state_referenced_locally
let appliedDefaultK: number = $state(settings.defaultK);
// svelte-ignore state_referenced_locally
let appliedClusteringAlgorithm: ClusteringAlgorithm = $state(settings.clusteringAlgorithm);
// svelte-ignore state_referenced_locally
let appliedMinClusterSize: number = $state(settings.minClusterSize);
// svelte-ignore state_referenced_locally
let appliedUseForceLayout: boolean = $state(settings.useForceLayout);

let projectionDirty = $derived(
	settings.projectionMethod !== appliedProjection ||
		(settings.projectionMethod === "umap" &&
			(settings.umapNeighbors !== appliedUmapNeighbors || settings.umapMinDist !== appliedUmapMinDist)) ||
		settings.autoK !== appliedAutoK ||
		(!settings.autoK && settings.defaultK !== appliedDefaultK) ||
		settings.clusteringAlgorithm !== appliedClusteringAlgorithm ||
		(settings.clusteringAlgorithm === "hdbscan" && settings.minClusterSize !== appliedMinClusterSize) ||
		settings.useForceLayout !== appliedUseForceLayout,
);

const projectionOptions = [
	{ display: "UMAP", value: "umap" as ProjectionMethod },
	{ display: "PCA", value: "pca" as ProjectionMethod },
];

const clusteringAlgorithmOptions = [
	{ display: "K-Means", value: "kmeans" as ClusteringAlgorithm },
	{ display: "HDBSCAN", value: "hdbscan" as ClusteringAlgorithm },
];

function handleProjectionChange(val: ProjectionMethod) {
	onSettingsChange({ projectionMethod: val });
}

function handleUmapNeighborsChange(val: number) {
	onSettingsChange({ umapNeighbors: val });
}

function handleUmapMinDistChange(val: number) {
	onSettingsChange({ umapMinDist: val });
}

function handleKChange(val: number) {
	onSettingsChange({ defaultK: val });
}

function handleAutoKChange(checked: boolean) {
	onSettingsChange({ autoK: checked });
}

function handleClusteringAlgorithmChange(val: ClusteringAlgorithm) {
	onSettingsChange({ clusteringAlgorithm: val });
}

function handleMinClusterSizeChange(val: number) {
	onSettingsChange({ minClusterSize: val });
}

function handleLabelZoomChange(val: number) {
	onSettingsChange({ labelZoomThreshold: val / 10 });
}

function handleLinkDistanceChange(val: number) {
	onSettingsChange({ linkDistance: val });
}

function handleChargeStrengthChange(val: number) {
	onSettingsChange({ chargeStrength: -val });
}

function handleFolderSelect(folder: string) {
	if (selectedFolders.includes(folder)) {
		onFolderFilterChange(selectedFolders.filter((f) => f !== folder));
	} else {
		onFolderFilterChange([...selectedFolders, folder]);
	}
}

function handleTagSelect(tag: string) {
	if (selectedTags.includes(tag)) {
		onTagFilterChange(selectedTags.filter((t) => t !== tag));
	} else {
		onTagFilterChange([...selectedTags, tag]);
	}
}

function clearFilters() {
	onFolderFilterChange([]);
	onTagFilterChange([]);
	onSearchChange("");
}

// Color group handlers
function getGraphPresetColorOptions(): PresetColorOption[] {
	return GRAPH_PRESET_COLOR_OPTIONS;
}

function resolveGraphGroupColor(color: string | undefined): string {
	const options = getGraphPresetColorOptions();
	return (
		options.find((option) => option.value === color)?.value ??
		GRAPH_PRESET_COLOR_OPTIONS.find((option) => color === `var(${option.cssVar})`)?.value ??
		(color && !THEME_COLOR_VARS.includes(color as (typeof THEME_COLOR_VARS)[number]) ? color : undefined) ??
		options[0]?.value ??
		"#000000"
	);
}

function addColorGroup() {
	const defaultColor = resolveGraphGroupColor(undefined);
	const updated: ColorGroup[] = [...settings.colorGroups, { query: "", color: defaultColor }];
	onSettingsChange({ colorGroups: updated });
}

function removeColorGroup(index: number) {
	const updated = settings.colorGroups.filter((_: ColorGroup, i: number) => i !== index);
	onSettingsChange({ colorGroups: updated });
}

function updateColorGroupQuery(index: number, query: string) {
	const updated = settings.colorGroups.map((g: ColorGroup, i: number) => (i === index ? { ...g, query } : g));
	onSettingsChange({ colorGroups: updated });
}

function updateColorGroupColor(index: number, color: string) {
	const updated = settings.colorGroups.map((g: ColorGroup, i: number) => (i === index ? { ...g, color } : g));
	onSettingsChange({ colorGroups: updated });
}
</script>

<div class="graph-toolbar">
  <!-- Action icons -->
  <Button iconId="maximize" onClick={onFitToView} tooltip="Fit graph to view" />
  <Button iconId="refresh-cw" onClick={onRefresh} tooltip="Rebuild graph" />
  {#if graphMode === "wiki" && !isTransitioning && onSmartCluster}
    <Button
      cta
      iconId="brain"
      onClick={onSmartCluster}
      tooltip="Smart Clustering: group notes by semantic similarity"
      disabled={isLoading}
    />
  {/if}
  {#if (graphMode === "smart" || isTransitioning) && onBackToWiki}
    <Button
      iconId="undo-2"
      onClick={onBackToWiki}
      tooltip="Back to wiki graph"
      disabled={isLoading || isTransitioning}
    />
  {/if}
  {#if (graphMode === "smart" || isTransitioning) && onLabelClusters}
    <Button
      iconId="tags"
      onClick={onLabelClusters}
      tooltip={isLabeling ? "Labeling…" : "Generate cluster labels with LLM"}
      disabled={isLabeling || isLoading || isTransitioning}
    />
  {/if}
  <!-- Lasso selection toggle -->
  <Button
    iconId="lasso"
    tooltip={lassoMode ? "Exit lasso selection" : "Lasso selection (or hold Shift + drag)"}
    onClick={() => onLassoModeChange?.(!lassoMode)}
    styles={lassoMode ? "is-active" : ""}
  />
  <!-- Info toggle -->
  <Button
    iconId="info"
    tooltip={isInfoOpen ? "Hide stats" : "Graph statistics"}
    onClick={() => (isInfoOpen = !isInfoOpen)}
  />
  <!-- Filter toggle -->
  <div class="toolbar-icon-wrapper">
    <Button
      iconId="filter"
      tooltip={isFilterOpen ? "Hide filters" : "Show filters"}
      onClick={() => (isFilterOpen = !isFilterOpen)}
    />
    {#if hasActiveFilters}
      <span class="toolbar-badge"></span>
    {/if}
  </div>
  <!-- Settings toggle -->
  <Button
    iconId="settings"
    tooltip={isCollapsed ? "Show controls" : "Hide controls"}
    onClick={() => (isCollapsed = !isCollapsed)}
  />
</div>

{#if isInfoOpen && graphStats}
  <div class="graph-info-card">
    <h4 class="graph-controls-title">Graph Statistics</h4>
    <div class="info-grid">
      <span class="info-label">Nodes</span>
      <span class="info-value">{nodeCount}</span>
      <span class="info-label">Edges</span>
      <span class="info-value">{edgeCount}</span>
      {#if graphStats.wikiEdges > 0}
        <span class="info-label">Wiki links</span>
        <span class="info-value">{graphStats.wikiEdges}</span>
      {/if}
      <span class="info-label">Avg connections</span>
      <span class="info-value">{graphStats.avgDegree.toFixed(1)}</span>
      <span class="info-label">Max connections</span>
      <span class="info-value">{graphStats.maxDegree}</span>
      <span class="info-label">Unlinked notes</span>
      <span class="info-value">{graphStats.unlinkedNotes}</span>
      <span class="info-label">Density</span>
      <span class="info-value">{(graphStats.density * 100).toFixed(2)}%</span>
      {#if graphStats.avgPath > 0}
        <span class="info-label">Avg path length</span>
        <span class="info-value">{graphStats.avgPath.toFixed(1)}</span>
        <span class="info-label">Diameter</span>
        <span class="info-value">{graphStats.diameter}</span>
      {/if}
      {#if graphStats.clusterCount > 0}
        <span class="info-label">Clusters</span>
        <span class="info-value">{graphStats.clusterCount}</span>
      {/if}
    </div>
  </div>
{/if}

{#if isFilterOpen}}
  <div class="graph-filter-panel">
    <div class="graph-filter-header">
      <h4 class="graph-controls-title">Filters</h4>
      {#if hasActiveFilters}
        <Button buttonText="Clear" onClick={clearFilters} />
      {/if}
    </div>
    <div class="graph-filter-body">
      <SettingContainer name="Search" desc="Highlight matching nodes">
        <Search value={searchQuery} placeholder="Search nodes..." onchange={onSearchChange} />
      </SettingContainer>

      {#if availableFolders.length > 0}
        <div class="filter-section">
          <div class="filter-label">Folder filter</div>
          <div class="filter-chips">
            {#each availableFolders.slice(0, 15) as folder}
              <button
                type="button"
                class="filter-chip"
                class:active={selectedFolders.includes(folder)}
                onclick={() => handleFolderSelect(folder)}
              >
                {folder}
              </button>
            {/each}
            {#if availableFolders.length > 15}
              <span class="filter-overflow">+{availableFolders.length - 15} more…</span>
            {/if}
          </div>
        </div>
      {/if}

      {#if availableTags.length > 0}
        <div class="filter-section">
          <div class="filter-label">Tag filter</div>
          <div class="filter-chips">
            {#each availableTags.slice(0, 15) as tag}
              <button
                type="button"
                class="filter-chip"
                class:active={selectedTags.includes(tag)}
                onclick={() => handleTagSelect(tag)}
              >
                {tag}
              </button>
            {/each}
            {#if availableTags.length > 15}
              <span class="filter-overflow">+{availableTags.length - 15} more…</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<div class="graph-controls" class:collapsed={isCollapsed}>
  {#if !isCollapsed}
    <div class="graph-controls-header">
      <h4 class="graph-controls-title" data-testid="graph-controls-title">Graph Controls</h4>
    </div>

    <div class="graph-controls-body">
      <!-- Stats bar -->
      <div class="graph-stats">
        <span class="graph-stat" data-testid="graph-node-count">{nodeCount} nodes</span>
        <span class="graph-stat" data-testid="graph-edge-count">{edgeCount} edges</span>
        <span class="graph-stat mode-badge" data-testid="graph-mode-badge"
          >{graphMode === "wiki" && !isTransitioning ? "Wiki" : "Smart"}</span
        >
        {#if isLoading}
          <span class="graph-stat loading">Computing...</span>
        {/if}
      </div>

      <!-- Color Groups (wiki mode only) -->
      {#if graphMode === "wiki"}
        <button
          type="button"
          class="section-header"
          onclick={() => (sectionOpen.colorGroups = !sectionOpen.colorGroups)}
        >
          <span>Color Groups</span>
          <svg
            class="section-chevron"
            class:open={sectionOpen.colorGroups}
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

        {#if sectionOpen.colorGroups}
          {#each settings.colorGroups as group, i}
            {@const graphColorOptions = getGraphPresetColorOptions()}
            <div class="color-group-row">
              <PresetColorSelector
                value={resolveGraphGroupColor(group.color)}
                options={graphColorOptions}
                popoverLabel="Group Color"
                triggerLabel={`Select color for group ${i + 1}`}
                onSelect={(color) => updateColorGroupColor(i, color)}
              />
              <Text
                inputType="text"
                value={group.query}
                placeholder="folder/ or #tag"
                onchange={(v) => updateColorGroupQuery(i, v)}
              />
              <Button iconId="x" onClick={() => removeColorGroup(i)} tooltip="Remove group" />
            </div>
          {/each}
          <div class="apply-bar">
            <Button iconId="plus" buttonText="Add group" onClick={addColorGroup} />
          </div>
        {/if}
      {/if}

      <!-- Projection & Clustering (smart mode only) -->
      {#if graphMode === "smart"}
        <button
          type="button"
          class="section-header"
          onclick={() => (sectionOpen.projection = !sectionOpen.projection)}
        >
          <span>Projection & Clustering</span>
          <svg
            class="section-chevron"
            class:open={sectionOpen.projection}
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

        {#if sectionOpen.projection}
          <SettingContainer
            name="Force layout"
            desc="Use force-directed layout instead of 2D projection"
          >
            <Toggle
              checked={settings.useForceLayout}
              onchange={(val) => onSettingsChange({ useForceLayout: val })}
            />
          </SettingContainer>

          {#if !settings.useForceLayout}
            <SettingContainer name="Projection" desc="2D layout algorithm">
              <Dropdown
                type="options"
                dropdown={projectionOptions}
                selected={settings.projectionMethod}
                onchange={handleProjectionChange}
              />
            </SettingContainer>

            {#if settings.projectionMethod === "umap"}
              <SettingContainer
                name="UMAP neighbors"
                desc="How many nearby points UMAP uses to shape the projection"
              >
                <RangeSlider
                  value={settings.umapNeighbors}
                  min={3}
                  max={50}
                  step={1}
                  showValue={true}
                  oncommit={handleUmapNeighborsChange}
                />
              </SettingContainer>

              <SettingContainer
                name="UMAP min dist"
                desc="How tightly UMAP is allowed to pack points together"
              >
                <RangeSlider
                  value={settings.umapMinDist}
                  min={0}
                  max={0.99}
                  step={0.01}
                  showValue={true}
                  oncommit={handleUmapMinDistChange}
                />
              </SettingContainer>
            {/if}
          {/if}

          <SettingContainer name="Algorithm" desc="Clustering method">
            <Dropdown
              type="options"
              dropdown={clusteringAlgorithmOptions}
              selected={settings.clusteringAlgorithm}
              onchange={handleClusteringAlgorithmChange}
            />
          </SettingContainer>

          {#if settings.clusteringAlgorithm === "kmeans"}
            <SettingContainer name="Auto K" desc="Automatically determine number of clusters">
              <Toggle checked={settings.autoK} onchange={handleAutoKChange} />
            </SettingContainer>

            {#if !settings.autoK}
              <SettingContainer name="Clusters (K)" desc="Number of semantic clusters">
                <RangeSlider
                  value={settings.defaultK}
                  min={2}
                  max={20}
                  step={1}
                  showValue={true}
                  oncommit={handleKChange}
                />
              </SettingContainer>
            {:else if suggestedK !== null}
              <div class="graph-info">
                Auto K: <strong>{suggestedK}</strong> clusters
              </div>
            {/if}
          {:else if settings.clusteringAlgorithm === "hdbscan"}
            <SettingContainer name="Min cluster size" desc="Min points to form a cluster">
              <RangeSlider
                value={settings.minClusterSize}
                min={2}
                max={50}
                step={1}
                showValue={true}
                oncommit={handleMinClusterSizeChange}
              />
            </SettingContainer>
          {/if}

          {#if projectionDirty && onApplyProjection}
            <div class="apply-bar">
              <Button
                cta
                buttonText="Apply"
                onClick={() => {
                  onApplyProjection();
                  appliedProjection = settings.projectionMethod;
                  appliedUmapNeighbors = settings.umapNeighbors;
                  appliedUmapMinDist = settings.umapMinDist;
                  appliedAutoK = settings.autoK;
                  appliedDefaultK = settings.defaultK;
                  appliedClusteringAlgorithm = settings.clusteringAlgorithm;
                  appliedMinClusterSize = settings.minClusterSize;
                  appliedUseForceLayout = settings.useForceLayout;
                }}
                tooltip="Apply projection & clustering changes"
                disabled={isLoading}
              />
            </div>
          {/if}
        {/if}
      {/if}

      <!-- Layout -->
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
        <SettingContainer name="Link distance" desc="Target distance between linked nodes">
          <RangeSlider
            value={settings.linkDistance}
            min={30}
            max={300}
            step={10}
            showValue={true}
            oncommit={handleLinkDistanceChange}
          />
        </SettingContainer>

        <SettingContainer name="Repulsion" desc="How strongly nodes push apart">
          <RangeSlider
            value={Math.abs(settings.chargeStrength)}
            min={10}
            max={800}
            step={10}
            showValue={true}
            oncommit={handleChargeStrengthChange}
          />
        </SettingContainer>

        <SettingContainer name="Label zoom" desc="Zoom level to show all labels (0 = off)">
          <RangeSlider
            value={Math.round(settings.labelZoomThreshold * 10)}
            min={0}
            max={20}
            step={1}
            showValue={true}
            oncommit={handleLabelZoomChange}
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
    gap: 4px;
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

  .graph-info-card {
    position: absolute;
    top: 8px;
    right: 44px;
    width: 220px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 12px;
    z-index: 10;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    font-size: 12px;
  }

  .info-label {
    color: var(--text-muted);
  }

  .info-value {
    color: var(--text-normal);
    font-weight: 500;
    text-align: right;
  }

  .graph-filter-panel {
    position: absolute;
    top: 8px;
    right: 44px;
    width: 260px;
    max-height: calc(100% - 16px);
    overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .graph-filter-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .graph-filter-body {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .graph-controls {
    position: absolute;
    top: 8px;
    right: 44px;
    width: 280px;
    max-height: calc(100% - 16px);
    overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .graph-controls.collapsed {
    display: none;
  }

  .graph-controls-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .graph-controls-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .graph-controls-body {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .graph-stats {
    display: flex;
    gap: 8px;
    padding: 4px 0;
    font-size: 11px;
    color: var(--text-muted);
  }

  .graph-stat.loading {
    color: var(--text-accent);
  }

  .graph-info {
    padding: 4px 8px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 6px 0;
    border: none;
    border-top: 1px solid var(--background-modifier-border);
    margin-top: 4px;
    background: none;
    cursor: pointer;
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

  .apply-bar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 0;
  }

  .filter-section {
    padding: 4px 0;
  }

  .filter-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .filter-chip {
    padding: 2px 8px;
    font-size: 11px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    background: var(--background-secondary);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .filter-chip:hover {
    background: var(--background-modifier-hover);
  }

  .filter-chip.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  .filter-overflow {
    font-size: 11px;
    color: var(--text-faint);
    padding: 2px 4px;
    align-self: center;
  }

  .mode-badge {
    font-weight: 600;
    color: var(--text-accent);
  }

  .color-group-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }

  .color-group-row :global(input[type="text"]) {
    flex: 1;
    min-width: 0;
  }
</style>
