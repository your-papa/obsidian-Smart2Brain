<script lang="ts">
import Button from "../ui/Button.svelte";
import RangeSlider from "../ui/RangeSlider.svelte";
import Toggle from "../ui/Toggle.svelte";
import SettingContainer from "../settings/SettingContainer.svelte";
import { isMobileUI } from "../../utils/platform";
import {
	type SmartGraphSettings,
	type GraphData,
	type SpaceSegment,
	DEFAULT_SMART_GRAPH_SETTINGS,
} from "../../types/graph";
import { maxZoomLevel, MIN_ZOOM_LEVEL } from "../../utils/topicHierarchy";

/** Slider length before the vault's real ladder has been derived. */
const MAX_ZOOM_LEVEL_FALLBACK = maxZoomLevel();

interface Props {
	settings: SmartGraphSettings;
	isLoading?: boolean;
	loadingLabel?: string;
	onSettingsChange: (patch: Partial<SmartGraphSettings>) => void;
	onFitToView: () => void;
	onRefresh: () => void;
	onReapplySegments?: () => void;
	onSeedChange?: () => void;
	/** Current zoom level, derived from the active Leiden resolution. */
	zoomLevel?: number;
	/** Highest selectable level — varies per vault, see deriveZoomLadder. */
	zoomMaxLevel?: number;
	/** False until the vault's zoom levels have been established. */
	zoomReady?: boolean;
	/** Apply a level mid-drag (cache hits only). */
	onZoomChange?: (zoom: number) => void;
	/** Commit a new zoom level — re-runs topic detection at the matching resolution. */
	onZoomCommit?: (zoom: number) => void;
	isLeidenRunning?: boolean;
	/** True while topic names are being generated. */
	isLabeling?: boolean;
	/** Manually (re)generate topic names via the configured graph model. */
	onLabelTopics?: () => void;
	lassoMode?: boolean;
	onLassoModeChange?: (active: boolean) => void;
	graphData?: GraphData;
	nodeCount?: number;
	// Segments (community list)
	segments?: SpaceSegment[];
	focusedSegmentIds?: Set<string>;
	onFocusSegment?: (id: string, multi: boolean) => void;
	/** True when topics are collapsed into single nodes. */
	isTopicsCollapsed?: boolean;
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
	onRefresh,
	onReapplySegments,
	onSeedChange,
	zoomLevel = 3,
	zoomMaxLevel = MAX_ZOOM_LEVEL_FALLBACK,
	zoomReady = false,
	onZoomChange,
	onZoomCommit,
	isLeidenRunning = false,
	isLabeling = false,
	onLabelTopics,
	lassoMode = false,
	onLassoModeChange,
	graphData = { nodes: [], edges: [] },
	nodeCount = 0,
	segments = [],
	focusedSegmentIds = new Set<string>(),
	onFocusSegment,
	isTopicsCollapsed = false,
	skeletonDetail = 100,
	onSkeletonDetailChange,
	onSkeletonDetailCommit,
	onSkeletonToggle,
}: Props = $props();

let isCollapsed = $state(true);
let isDevCollapsed = $state(true);

let sectionOpen: Record<string, boolean> = $state({
	devLayout: false,
	devSemantic: false,
	devLeiden: false,
});

let graphStats = $derived.by(() => {
	const { nodes, edges } = graphData;
	if (nodes.length === 0) return null;

	const degrees = nodes.map((n) => n.degree ?? 0);
	const totalDegree = degrees.reduce((a, b) => a + b, 0);
	const avgDegree = totalDegree / nodes.length;
	const maxDegree = Math.max(...degrees);

	// `degree` counts inferred semantic edges too, so it can't answer "how many notes
	// did I never link?" — count authored wiki links directly instead.
	const wikiLinkedPaths = new Set<string>();
	for (const edge of edges) {
		if (edge.type !== "wiki") continue;
		wikiLinkedPaths.add(edge.source);
		wikiLinkedPaths.add(edge.target);
	}
	const unlinkedNotes = nodes.filter((n) => !wikiLinkedPaths.has(n.path)).length;
	const wikiEdges = edges.filter((e) => e.type === "wiki").length;
	const semanticEdges = edges.filter((e) => e.type === "semantic").length;
	const clusters = new Set(nodes.map((n) => n.cluster).filter((c) => c != null));

	return { avgDegree, maxDegree, unlinkedNotes, wikiEdges, semanticEdges, clusterCount: clusters.size };
});

/**
 * Both states report a real number rather than describing the switch, because the
 * interesting question — "how much of my vault does my own linking actually
 * organise?" — is answered by comparing them. Turning inferred links off and
 * watching the coverage drop is the point of the control.
 */
let inferredLinksOn = $derived(!(settings.linkOnlyTopics ?? false) && (settings.showSemanticLinks ?? true));

let inferredLinksHint = $derived.by(() => {
	const total = graphData.nodes.length;
	if (!inferredLinksOn) {
		// Only report link coverage when topics really are link-only. A stored
		// half-state (hidden but still grouping) would make that number a lie.
		if (!settings.linkOnlyTopics) {
			return "Hidden, but still grouping notes. Toggle twice to exclude them from topics as well";
		}
		if (total === 0) return "Off — topics come from the links you wrote.";
		const placed = graphData.nodes.filter((n) => n.cluster != null).length;
		const percent = Math.round((placed / total) * 100);
		return `Your links alone group ${placed} of ${total} notes (${percent}%). The other ${total - placed} are unlinked.`;
	}
	const inferred = graphData.edges.filter((e) => e.type === "semantic").length;
	if (inferred === 0) {
		return "Connect notes by meaning as well as by the links you wrote — needs a graph embedding index";
	}
	return `Adding ${inferred} similarity connections so unlinked notes still find a topic. Turn off to see what your own links cover.`;
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

// Touch devices have no keyboard modifiers or hover, so the desktop shortcut
// hints ("F", "hold Shift + drag", "shift/⌘ multi-select") describe gestures
// the user cannot perform. Drop them on mobile rather than advertise a
// non-existent affordance.
const onMobile = isMobileUI();
const fitTooltip = onMobile ? "Fit graph to view" : "Fit graph to view (F)";
const lassoTooltip = onMobile ? "Lasso selection" : "Lasso selection (or hold Shift + drag)";
</script>

<!-- Unified vertical toolbar -->
<div class="graph-toolbar">
  <Button iconId="maximize" onClick={onFitToView} tooltip={fitTooltip} />
  <Button
    iconId="lasso"
    tooltip={lassoMode ? "Exit lasso selection" : lassoTooltip}
    onClick={() => onLassoModeChange?.(!lassoMode)}
    styles={lassoMode ? "is-active" : ""}
  />
  <Button
    iconId="atom"
    tooltip={isLeidenRunning
      ? "Computing topics…"
      : isTopicsCollapsed
        ? "Expand all topics back into notes (S)"
        : "Collapse all topics into single nodes (S) — or select topics and use Collapse"}
    onClick={() => onSkeletonToggle?.()}
    disabled={isLeidenRunning}
    styles={isTopicsCollapsed ? "is-active" : ""}
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
            {nodeCount} notes · {graphStats.unlinkedNotes} unlinked · {graphStats.wikiEdges} links{#if graphStats.semanticEdges > 0}{" "}· {graphStats.semanticEdges} inferred{/if}
          {:else}
            {nodeCount} notes
          {/if}
        </span>
      </div>

      <!-- ── Topics ───────────────────────────── -->
      <!-- Granularity and "Ignore inferred links" both decide *which topics exist*
           (they re-run Leiden), so they belong together and above the topic list
           they produce. Everything under Display only changes how the same topics
           are drawn. -->
      <span class="section-label">Topics</span>

      <!-- Held back until the vault's levels are known: the slider's length is
           derived, so showing it early would change its range under the user. -->
      {#if zoomReady}
        <!-- Not "Zoom": the graph has a literal one (scroll, +/-) that changes
             scale, while this changes how finely notes are grouped into topics.
             Two controls sharing that name in one panel is the confusion. -->
        <SettingContainer
          name="Granularity"
          desc={onMobile
            ? "Left: a few broad topics. Right: many specific ones. Every note stays visible."
            : "Left: a few broad topics. Right: many specific ones. Every note stays visible. (↑/↓ on the graph)"}
          compact
        >
          <RangeSlider
            value={zoomLevel}
            min={MIN_ZOOM_LEVEL}
            max={zoomMaxLevel}
            step={1}
            showValue={true}
            onchange={(v) => onZoomChange?.(v)}
            oncommit={(v) => onZoomCommit?.(v)}
          />
        </SettingContainer>
      {:else}
        <SettingContainer name="Granularity" desc="Working out this vault's topic levels…" compact>
          <span class="zoom-pending">…</span>
        </SettingContainer>
      {/if}

      <!-- One switch for the whole concept: inferred links are either part of the
           graph (drawn *and* grouping notes) or absent. Splitting "draw" from
           "count" allowed a state where hidden edges silently decided the topics.
           `showDesc` because the off-state description is a live measurement of
           the user's own linking — the whole point of turning this off. -->
      <SettingContainer name="Inferred links" desc={inferredLinksHint} compact showDesc>
        <Toggle
          checked={!(settings.linkOnlyTopics ?? false) && (settings.showSemanticLinks ?? true)}
          onchange={(value) =>
            onSettingsChange({ linkOnlyTopics: !value, showSemanticLinks: value })}
        />
      </SettingContainer>

      {#if segments.length > 0}
        <div class="section-label section-label--with-action">
          <span
            >Found · {segments.length}
            {#if !onMobile}<span class="section-label-hint">shift/⌘ multi-select</span>{/if}</span
          >
          <Button
            iconId={isLabeling ? "loader" : "sparkles"}
            ariaLabel="Name topics with AI"
            tooltip={isLabeling ? "Naming topics…" : "Name topics with AI"}
            onClick={() => onLabelTopics?.()}
            disabled={isLabeling}
            styles={isLabeling ? "is-spinning" : ""}
          />
        </div>
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
        name="Topic regions"
        desc="Tint the area behind each topic so groups read at a glance"
        compact
      >
        <Toggle
          checked={settings.showTopicHulls ?? true}
          onchange={(value) => onSettingsChange({ showTopicHulls: value })}
        />
      </SettingContainer>
      <SettingContainer
        name="Topic labels"
        desc="Show the topic name pills over the graph"
        compact
      >
        <Toggle
          checked={settings.showClusterLabels ?? true}
          onchange={(value) => onSettingsChange({ showClusterLabels: value })}
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
        {/if}

        <button
          type="button"
          class="section-label section-label--collapsible"
          onclick={() => (sectionOpen.devSemantic = !sectionOpen.devSemantic)}
        >
          <span>Semantic edges</span>
          <svg class="section-chevron" class:open={sectionOpen.devSemantic} xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        {#if sectionOpen.devSemantic}
          <SettingContainer name="Neighbors (k)" desc="Max inferred neighbors contributed per note" compact>
            <RangeSlider
              value={settings.semanticNeighborCount ?? 5}
              min={0}
              max={20}
              step={1}
              showValue={true}
              oncommit={(v) => onSettingsChange({ semanticNeighborCount: v })}
            />
          </SettingContainer>
          <SettingContainer name="Similarity threshold" desc="Min cosine similarity for an inferred edge (×100)" compact>
            <RangeSlider
              value={Math.round((settings.semanticThreshold ?? 0.55) * 100)}
              min={0}
              max={100}
              step={1}
              showValue={true}
              oncommit={(v) => onSettingsChange({ semanticThreshold: v / 100 })}
            />
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

  /* These render at 30x26 — well under the touch floor, and they're the only
     way to fit/lasso/segment the graph on a phone. Grow the tappable box via
     padding so the glyphs keep their size. */
  :global(.is-mobile) .graph-toolbar :global(button) {
    min-width: 44px;
    min-height: 44px;
    padding: 10px;
    box-sizing: border-box;
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

  /* On a phone a fixed 300px panel + 52px offset overflows and occludes the
     canvas — fit it to the viewport instead. */
  :global(.is-mobile) .graph-controls {
    width: min(300px, calc(100vw - 68px));
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

  .zoom-pending {
    font-size: var(--font-ui-small);
    color: var(--text-faint);
    padding-right: 4px;
  }

  .section-label--with-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  /* The label button reuses Obsidian's clickable-icon chrome; only the spin is ours. */
  .section-label--with-action :global(.is-spinning svg) {
    animation: s2b-label-spin 1s linear infinite;
  }

  @keyframes s2b-label-spin {
    to {
      transform: rotate(360deg);
    }
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
  /* The topic list is unbounded — a high zoom level can produce dozens of
     entries. Cap it and let it scroll on its own, so it can never push the
     Display toggles (or itself) out of the panel. */
  .segment-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 0 6px;
    max-height: 40vh;
    overflow-y: auto;
    /* Without this a flex child refuses to shrink below its content height,
       which would defeat the cap entirely. */
    min-height: 0;
    overscroll-behavior: contain;
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
