<script lang="ts">
  import Button from "../ui/Button.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import RangeSlider from "../ui/RangeSlider.svelte";
  import Dropdown from "../ui/Dropdown.svelte";
  import Search from "../ui/Search.svelte";
  import SettingContainer from "../settings/SettingContainer.svelte";
  import type { ProjectionMethod, SmartGraphSettings } from "../../types/graph";

  interface Props {
    settings: SmartGraphSettings;
    suggestedK: number | null;
    isLoading: boolean;
    nodeCount: number;
    edgeCount: number;
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
    onLabelClusters?: () => void;
    isLabeling?: boolean;
  }

  let {
    settings,
    suggestedK,
    isLoading,
    nodeCount,
    edgeCount,
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
    onLabelClusters,
    isLabeling = false,
  }: Props = $props();

  let isCollapsed = $state(false);
  let isFilterOpen = $state(false);

  let hasActiveFilters = $derived(
    selectedFolders.length > 0 || selectedTags.length > 0 || searchQuery.length > 0,
  );

  // Per-section collapse state
  let sectionOpen: Record<string, boolean> = $state({
    projection: true,
    edges: true,
    layout: false,
    display: false,
  });

  // Track "dirty" projection/clustering settings that need an explicit Apply.
  // Store the last-applied values so the button only appears when settings
  // actually differ from what's currently rendered.
  // svelte-ignore state_referenced_locally
  let appliedProjection: ProjectionMethod = $state(settings.projectionMethod);
  // svelte-ignore state_referenced_locally
  let appliedAutoK: boolean = $state(settings.autoK);
  // svelte-ignore state_referenced_locally
  let appliedDefaultK: number = $state(settings.defaultK);

  let projectionDirty = $derived(
    settings.projectionMethod !== appliedProjection ||
      settings.autoK !== appliedAutoK ||
      (!settings.autoK && settings.defaultK !== appliedDefaultK),
  );

  const projectionOptions = [
    { display: "UMAP", value: "umap" as ProjectionMethod },
    { display: "PCA", value: "pca" as ProjectionMethod },
  ];

  function handleProjectionChange(val: ProjectionMethod) {
    onSettingsChange({ projectionMethod: val });
  }

  function handleDiscoveryModeChange(checked: boolean) {
    onSettingsChange({ discoveryMode: checked });
  }

  function handleKChange(val: number) {
    onSettingsChange({ defaultK: val });
  }

  function handleAutoKChange(checked: boolean) {
    onSettingsChange({ autoK: checked });
  }

  function handleShowOrphansChange(checked: boolean) {
    onSettingsChange({ showOrphans: checked });
  }

  function handleLabelZoomChange(val: number) {
    onSettingsChange({ labelZoomThreshold: val / 10 });
  }

  function handleNodeSizeChange(val: number) {
    onSettingsChange({ nodeSize: val });
  }

  function handleLinkDistanceChange(val: number) {
    onSettingsChange({ linkDistance: val });
  }

  function handleChargeStrengthChange(val: number) {
    onSettingsChange({ chargeStrength: -val });
  }

  function handleThresholdChange(val: number) {
    onSettingsChange({ similarityThreshold: val / 100 });
  }

  function handleNeighborsChange(val: number) {
    onSettingsChange({ semanticNeighbors: val });
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
</script>

<div class="graph-toolbar">
  <!-- Action icons -->
  <Button iconId="maximize" onClick={onFitToView} tooltip="Fit graph to view" />
  <Button iconId="refresh-cw" onClick={onRefresh} tooltip="Rebuild graph" />
  {#if onLabelClusters}
    <Button
      iconId="tags"
      onClick={onLabelClusters}
      tooltip={isLabeling ? "Labeling…" : "Generate cluster labels with LLM"}
      disabled={isLabeling || isLoading}
    />
  {/if}
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

{#if isFilterOpen}
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
      <h4 class="graph-controls-title">Graph Controls</h4>
    </div>

    <div class="graph-controls-body">
      <!-- Stats bar -->
      <div class="graph-stats">
        <span class="graph-stat">{nodeCount} nodes</span>
        <span class="graph-stat">{edgeCount} edges</span>
        {#if isLoading}
          <span class="graph-stat loading">Computing...</span>
        {/if}
      </div>

      <!-- Projection & Clustering -->
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
        <SettingContainer name="Projection" desc="2D layout algorithm">
          <Dropdown
            type="options"
            dropdown={projectionOptions}
            selected={settings.projectionMethod}
            onchange={handleProjectionChange}
          />
        </SettingContainer>

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

        {#if projectionDirty && onApplyProjection}
          <div class="apply-bar">
            <Button
              cta
              buttonText="Apply"
              onClick={() => {
                onApplyProjection();
                appliedProjection = settings.projectionMethod;
                appliedAutoK = settings.autoK;
                appliedDefaultK = settings.defaultK;
              }}
              tooltip="Apply projection & clustering changes"
              disabled={isLoading}
            />
          </div>
        {/if}
      {/if}

      <!-- Edges & Connectivity -->
      <button
        type="button"
        class="section-header"
        onclick={() => (sectionOpen.edges = !sectionOpen.edges)}
      >
        <span>Edges & Connectivity</span>
        <svg
          class="section-chevron"
          class:open={sectionOpen.edges}
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

      {#if sectionOpen.edges}
        <SettingContainer name="Similarity" desc="Minimum similarity for edges (%)">
          <RangeSlider
            value={Math.round(settings.similarityThreshold * 100)}
            min={10}
            max={90}
            step={5}
            showValue={true}
            oncommit={handleThresholdChange}
          />
        </SettingContainer>

        <SettingContainer name="Neighbors" desc="Max neighbors per node">
          <RangeSlider
            value={settings.semanticNeighbors}
            min={1}
            max={15}
            step={1}
            showValue={true}
            oncommit={handleNeighborsChange}
          />
        </SettingContainer>
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
        <SettingContainer name="Node size" desc="Base radius of nodes">
          <RangeSlider
            value={settings.nodeSize}
            min={2}
            max={16}
            step={1}
            showValue={true}
            oncommit={handleNodeSizeChange}
          />
        </SettingContainer>

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
            max={50}
            step={5}
            showValue={true}
            oncommit={handleLabelZoomChange}
          />
        </SettingContainer>
      {/if}

      <!-- Display -->
      <button
        type="button"
        class="section-header"
        onclick={() => (sectionOpen.display = !sectionOpen.display)}
      >
        <span>Display</span>
        <svg
          class="section-chevron"
          class:open={sectionOpen.display}
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

      {#if sectionOpen.display}
        <SettingContainer name="Orphans" desc="Show unlinked nodes">
          <Toggle checked={settings.showOrphans} onchange={handleShowOrphansChange} />
        </SettingContainer>

        <SettingContainer name="Discovery" desc="Highlight semantic-only nodes">
          <Toggle checked={settings.discoveryMode} onchange={handleDiscoveryModeChange} />
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
</style>
