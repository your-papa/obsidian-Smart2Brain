<script lang="ts">
import Button from "../ui/Button.svelte";
import RangeSlider from "../ui/RangeSlider.svelte";
import Toggle from "../ui/Toggle.svelte";
import SettingContainer from "../settings/SettingContainer.svelte";
import { isMobileUI } from "../../utils/platform";
import { icon } from "../../utils/utils";
import {
	type SmartGraphSettings,
	type GraphData,
	type SpaceSegment,
	DEFAULT_SMART_GRAPH_SETTINGS,
} from "../../types/graph";
import { maxGranularityLevel, MIN_GRANULARITY_LEVEL } from "../../utils/topicHierarchy";

/** Slider length before the vault's real ladder has been derived. */
const MAX_GRANULARITY_LEVEL_FALLBACK = maxGranularityLevel();

interface Props {
	settings: SmartGraphSettings;
	isLoading?: boolean;
	loadingLabel?: string;
	onSettingsChange: (patch: Partial<SmartGraphSettings>) => void;
	onFitToView: () => void;
	onRefresh: () => void;
	onReapplySegments?: () => void;
	onSeedChange?: () => void;
	/** Current granularity level, derived from the active Leiden resolution. */
	granularityLevel?: number;
	/** Highest selectable level — varies per vault, see deriveGranularityLadder. */
	granularityMaxLevel?: number;
	/** False until the vault's granularity levels have been established. */
	granularityReady?: boolean;
	/** Apply a level mid-drag (cache hits only). */
	onGranularityChange?: (level: number) => void;
	/** Commit a new granularity level — re-runs topic detection at the matching resolution. */
	onGranularityCommit?: (level: number) => void;
	isLeidenRunning?: boolean;
	/** True while topic names are being generated. */
	isLabeling?: boolean;
	/** Manually (re)generate topic names via the configured graph model. */
	onLabelTopics?: () => void;
	/** Abort an in-flight naming run. */
	onCancelLabeling?: () => void;
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
	/** Collapse or expand all topics at once (the atom button / S shortcut). */
	onToggleCollapseAll?: () => void;
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
	granularityLevel = 3,
	granularityMaxLevel = MAX_GRANULARITY_LEVEL_FALLBACK,
	granularityReady = false,
	onGranularityChange,
	onGranularityCommit,
	isLeidenRunning = false,
	isLabeling = false,
	onLabelTopics,
	onCancelLabeling,
	lassoMode = false,
	onLassoModeChange,
	graphData = { nodes: [], edges: [] },
	nodeCount = 0,
	segments = [],
	focusedSegmentIds = new Set<string>(),
	onFocusSegment,
	isTopicsCollapsed = false,
	onToggleCollapseAll,
}: Props = $props();

let isCollapsed = $state(true);
let isDevCollapsed = $state(true);

/** Defaulted here rather than in the template — settings persisted before this
 *  toggle existed have no value for it, and topics-on is the established behaviour. */
let showTopics = $derived(settings.showTopics ?? true);

/**
 * Live height of the main panel, so the dev panel can stack directly beneath
 * it. Measured rather than assumed: the panel grows and shrinks as sections
 * are opened and as the topic list fills.
 */
let mainPanelHeight = $state(0);

let sectionOpen: Record<string, boolean> = $state({
	devLayout: false,
	devSemantic: false,
	devLeiden: false,
	devAppearance: false,
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

/**
 * What the control *is* — static across every state, so it lives behind the info
 * icon rather than taking a line of the panel. Separated from the measurement
 * below because the two have opposite lifetimes: this is read once while
 * learning the control, the number is read every time it changes.
 */
const INFERRED_LINKS_HELP =
	"Connect notes by meaning as well as by the links you wrote, so unlinked notes still find a topic. Turn it off to see what your own linking covers on its own. Requires a graph embedding index.";

/**
 * The live result of the current state — a measurement, not help. Stays inline
 * (`showDesc`) because it is the payoff for flipping the toggle: watching the
 * coverage drop is the whole point of turning inferred links off.
 *
 * Returns "" when there is nothing measured to report, so the row collapses back
 * to a plain toggle instead of holding a line for restated help.
 */
let inferredLinksHint = $derived.by(() => {
	const total = graphData.nodes.length;
	if (!inferredLinksOn) {
		// Only report link coverage when topics really are link-only. A stored
		// half-state (hidden but still grouping) would make that number a lie.
		if (!settings.linkOnlyTopics) {
			return "Hidden, but still grouping notes. Toggle twice to exclude them from topics as well";
		}
		if (total === 0) return "";
		const placed = graphData.nodes.filter((n) => n.cluster != null).length;
		const percent = Math.round((placed / total) * 100);
		return `Your links alone group ${placed} of ${total} notes (${percent}%). The other ${total - placed} are unlinked.`;
	}
	const inferred = graphData.edges.filter((e) => e.type === "semantic").length;
	// No index yet: there is no measurement to show, and the reason lives in the
	// info tooltip alongside the rest of the explanation.
	if (inferred === 0) return "";
	return `Adding ${inferred} similarity connections so unlinked notes still find a topic.`;
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

/**
 * Set γ directly, bypassing the granularity ladder.
 *
 * The user-facing slider snaps to the vault's derived rungs; this one is
 * deliberately continuous so a dev can probe values between them. Reuses the
 * seed callback because both change the Leiden partition identity, which is
 * exactly what needs recomputing.
 */
function handleResolutionChange(resolution: number) {
	onSettingsChange({ leidenResolution: resolution });
	onSeedChange?.();
}

/**
 * Every knob this panel exposes, so "reset" restores exactly what it can change
 * — and nothing else. Listing the keys explicitly (rather than spreading the
 * whole defaults object) keeps the user's model choice, colour groups and
 * filters untouched, and makes a newly added control's absence here obvious.
 */
const DEV_TUNABLE_KEYS = [
	"linkDistance",
	"chargeStrength",
	"centerStrength",
	"linkStrength",
	"clusterCohesionStrength",
	"semanticNeighborCount",
	"semanticThreshold",
	"leidenSeed",
	"leidenResolution",
	"bridgeThreshold",
	"minClusterSize",
	"linkOnlyTopics",
	"directedWikiEdges",
	"showTopicHulls",
	"showClusterLabels",
	"highlightBridges",
	"highlightIsolated",
	"markdownOnly",
] as const satisfies ReadonlyArray<keyof SmartGraphSettings>;

/**
 * Restore every tuning value in this panel to its shipped default.
 *
 * Fires the same follow-ups the individual controls do: the seed and γ change
 * the Leiden partition, and the semantic values change which edges exist, so
 * both need their recompute rather than just a settings write.
 */
function handleResetDevSettings() {
	const patch: Partial<SmartGraphSettings> = {};
	for (const key of DEV_TUNABLE_KEYS) {
		(patch as Record<string, unknown>)[key] = DEFAULT_SMART_GRAPH_SETTINGS[key];
	}
	onSettingsChange(patch);
	// Re-runs community detection at the restored seed/γ. The semantic values are
	// part of the parent's rebuild signature, so its own effect handles those.
	onSeedChange?.();
	onReapplySegments?.();
}

// Touch devices have no keyboard modifiers or hover, so the desktop shortcut
// hints ("F", "hold Shift + drag", "shift/⌘ multi-select") describe gestures
// the user cannot perform. Drop them on mobile rather than advertise a
// non-existent affordance.
const onMobile = isMobileUI();
const fitTooltip = onMobile ? "Fit graph to view" : "Fit graph to view (F)";
const lassoTooltip = onMobile ? "Lasso selection" : "Lasso selection (or hold Shift + drag)";

// Pointer/keyboard focus on the topic-naming button, which turns the spinner
// into a cancel control. Tracked here because Button exposes no hover state.
// On mobile there is no hover, so the X shows for the whole run instead of
// hiding the only way to stop it.
let labelButtonHot = $state(false);
let labelButtonEl = $state<HTMLButtonElement | undefined>(undefined);
const showCancelLabeling = $derived(isLabeling && (labelButtonHot || onMobile));

// Listener wiring + cleanup on a real DOM node — the one job $effect is for.
$effect(() => {
	const el = labelButtonEl;
	if (!el) return;

	const enter = () => (labelButtonHot = true);
	const leave = () => (labelButtonHot = false);
	el.addEventListener("mouseenter", enter);
	el.addEventListener("mouseleave", leave);
	el.addEventListener("focus", enter);
	el.addEventListener("blur", leave);
	return () => {
		el.removeEventListener("mouseenter", enter);
		el.removeEventListener("mouseleave", leave);
		el.removeEventListener("focus", enter);
		el.removeEventListener("blur", leave);
	};
});
</script>

<!--
  Unified vertical toolbar.

  Icons are `m` (18px), not Button's `s` (16px) default. This rail is a standing
  stack of tool toggles floating over the canvas — the same pattern as Obsidian's
  ribbon and nav-action buttons, which are 18px/30px. The 16px default matches
  view-header actions instead, which is a different, denser pattern, and at this
  size the rail read as undersized against the canvas.
-->
<div class="graph-toolbar">
  <Button iconId="maximize" onClick={onFitToView} tooltip={fitTooltip} />
  <Button
    iconId="lasso"
    tooltip={lassoMode ? "Exit lasso selection" : lassoTooltip}
    onClick={() => onLassoModeChange?.(!lassoMode)}
    styles={lassoMode ? "is-active" : ""}
  />
  <!-- Show/hide detected topics. Display-only, so flipping it is instant and the
       graph underneath is unchanged — that's what makes it readable as "here is
       what the clustering added". -->
  <Button
    iconId={showTopics ? "shapes" : "circle-dashed"}
    tooltip={showTopics
      ? "Hide topics — show the raw graph without clustering"
      : "Show topics — colour notes by their detected topic"}
    onClick={() => onSettingsChange({ showTopics: !showTopics })}
    styles={showTopics ? "is-active" : ""}
  />
  <Button
    iconId={isTopicsCollapsed ? "ungroup" : "group"}
    tooltip={isLeidenRunning
      ? "Computing topics…"
      : !showTopics
        ? "Turn topics on to collapse them"
        : isTopicsCollapsed
          ? "Expand all topics back into notes (S)"
          : "Collapse all topics into single nodes (S) — or select topics and use Collapse"}
    onClick={() => onToggleCollapseAll?.()}
    disabled={isLeidenRunning || !showTopics}
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
<div class="graph-controls" class:collapsed={isCollapsed} bind:clientHeight={mainPanelHeight}>
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

      <!-- ── Scope ────────────────────────────── -->
      <!-- What is in the graph at all. This sits above Topics because it decides
           the input: changing the file set changes which notes exist to be
           grouped, so every topic below is derived from whatever is scoped here.
           It previously sat under Display, which read as a cosmetic preference
           when it is the most consequential control in the panel. -->
      <span class="section-label">Scope</span>
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

      <!-- ── Topics ───────────────────────────── -->
      <!-- Granularity and "Inferred links" both decide *which topics exist*
           (they re-run Leiden), so they belong together and above the topic list
           they produce. Everything under Display only changes how the same topics
           are drawn. -->
      <span class="section-label">Topics</span>

      <!-- Held back until the vault's levels are known: the slider's length is
           derived, so showing it early would change its range under the user. -->
      {#if granularityReady}
        <!-- Distinct from the camera zoom (scroll, +/-), which changes scale.
             This changes how finely notes are grouped into topics — hence the
             separate `granularity*` vocabulary throughout. -->
        <SettingContainer
          name="Granularity"
          desc={onMobile
            ? "Left: a few broad topics. Right: many specific ones. Every note stays visible."
            : "Left: a few broad topics. Right: many specific ones. Every note stays visible. (↑/↓ on the graph)"}
          compact
        >
          <RangeSlider
            value={granularityLevel}
            min={MIN_GRANULARITY_LEVEL}
            max={granularityMaxLevel}
            step={1}
            showValue={true}
            onchange={(v) => onGranularityChange?.(v)}
            oncommit={(v) => onGranularityCommit?.(v)}
          />
        </SettingContainer>
      {:else}
        <SettingContainer name="Granularity" desc="Working out this vault's topic levels…" compact>
          <span class="granularity-pending">…</span>
        </SettingContainer>
      {/if}

      <!-- One switch for the whole concept: inferred links are either part of the
           graph (drawn *and* grouping notes) or absent. Splitting "draw" from
           "count" allowed a state where hidden edges silently decided the topics.

           The explanation lives behind the info icon; only the live measurement
           stays inline (`showDesc`), and `inferredLinksHint` returns "" when
           there is nothing measured — so the row holds a line for a number worth
           reading, never for restated help. -->
      <SettingContainer name="Inferred links" desc={inferredLinksHint} compact showDesc>
        {#snippet nameSuffix()}
          <span class="info-icon" aria-label={INFERRED_LINKS_HELP} use:icon={"info"}></span>
        {/snippet}
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
          <!-- The spinner doubles as the cancel control: hovering (or focusing)
               a live run swaps it for an X. Listeners go on the button itself
               rather than a wrapper — it is already focusable, so keyboard users
               reach the cancel affordance by tabbing to it. -->
          <Button
            bind:element={labelButtonEl}
            iconId={showCancelLabeling ? "x" : isLabeling ? "loader" : "sparkles"}
            ariaLabel={isLabeling ? "Cancel naming topics" : "Name topics with AI"}
            tooltip={isLabeling ? "Cancel naming" : "Name topics with AI"}
            onClick={() => (isLabeling ? onCancelLabeling?.() : onLabelTopics?.())}
            styles={isLabeling && !showCancelLabeling ? "is-spinning" : ""}
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
      <!-- Purely how the graph above is drawn — nothing here changes which notes
           are included or how they group. -->
      <span class="section-label">Display</span>
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
  <div
    class="graph-controls graph-controls--dev"
    class:collapsed={isDevCollapsed}
    class:graph-controls--main-open={!isCollapsed}
    style="--s2b-graph-main-panel-height: {mainPanelHeight}px"
  >
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
          onclick={() => (sectionOpen.devAppearance = !sectionOpen.devAppearance)}
        >
          <span>Appearance</span>
          <svg class="section-chevron" class:open={sectionOpen.devAppearance} xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        {#if sectionOpen.devAppearance}
          <SettingContainer name="Directed links" desc="Draw arrowheads on authored wiki links" compact>
            <Toggle checked={settings.directedWikiEdges ?? true} onchange={(v) => onSettingsChange({ directedWikiEdges: v })} />
          </SettingContainer>
          <SettingContainer name="Topic regions" desc="Tinted area behind each topic's notes" compact>
            <Toggle checked={settings.showTopicHulls ?? true} onchange={(v) => onSettingsChange({ showTopicHulls: v })} />
          </SettingContainer>
          <SettingContainer name="Topic labels" desc="Name pills drawn over each topic" compact>
            <Toggle checked={settings.showClusterLabels ?? true} onchange={(v) => onSettingsChange({ showClusterLabels: v })} />
          </SettingContainer>
          <SettingContainer name="Highlight bridges" desc="Ring notes whose neighbors are mostly in other topics" compact>
            <Toggle checked={settings.highlightBridges ?? false} onchange={(v) => { onSettingsChange({ highlightBridges: v }); onReapplySegments?.(); }} />
          </SettingContainer>
          <SettingContainer name="Highlight unlinked" desc="Ring notes with no authored links" compact>
            <Toggle checked={settings.highlightIsolated ?? false} onchange={(v) => { onSettingsChange({ highlightIsolated: v }); onReapplySegments?.(); }} />
          </SettingContainer>
          <SettingContainer name="Markdown only" desc="Exclude non-markdown files from the graph" compact>
            <Toggle checked={settings.markdownOnly ?? false} onchange={(v) => onSettingsChange({ markdownOnly: v })} />
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
          <SettingContainer name="Resolution (γ)" desc="Higher → more, smaller topics. The granularity slider's underlying value" compact>
            <RangeSlider
              value={Math.round((settings.leidenResolution ?? 1) * 100)}
              min={10}
              max={600}
              step={5}
              showValue={true}
              oncommit={(v) => handleResolutionChange(v / 100)}
            />
          </SettingContainer>
          <SettingContainer name="Bridge threshold" desc="Min fraction of foreign-topic neighbors to qualify as a bridge" compact>
            <RangeSlider value={Math.round((settings.bridgeThreshold ?? 0.4) * 100)} min={0} max={100} step={5} showValue={true} oncommit={(v) => { onSettingsChange({ bridgeThreshold: v / 100 }); onReapplySegments?.(); }} />
          </SettingContainer>
          <SettingContainer name="Link-only topics" desc="Detect topics from authored links alone, ignoring inferred edges" compact>
            <Toggle checked={settings.linkOnlyTopics ?? false} onchange={(v) => onSettingsChange({ linkOnlyTopics: v })} />
          </SettingContainer>
          <SettingContainer name="Min cluster size" desc="Groups smaller than this aren't treated as topics" compact>
            <RangeSlider value={settings.minClusterSize ?? 5} min={2} max={30} step={1} showValue={true} oncommit={(v) => onSettingsChange({ minClusterSize: v })} />
          </SettingContainer>
        {/if}

        <div class="dev-actions">
          <Button iconId="rotate-ccw" onClick={handleResetDevSettings} tooltip="Reset tuning to defaults" />
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

  /* Sized here rather than via Button's `iconSize` prop: for an icon-only button
     that prop also pins width/height to the icon size as an inline style, which
     would shrink the click target to 18px — a bigger glyph on a smaller thing to
     hit. Setting both from CSS keeps them independent.

     18px/30px matches Obsidian's ribbon and nav-action buttons. This rail is that
     pattern — a standing stack of tool toggles — not the denser 16px/28px
     view-header strip that Button defaults to. */
  .graph-toolbar :global(button.clickable-icon) {
    width: 30px;
    height: 30px;
  }

  .graph-toolbar :global(button.clickable-icon .s2b-button-icon) {
    width: var(--icon-m);
    height: var(--icon-m);
  }

  .graph-toolbar :global(button.clickable-icon svg) {
    width: var(--icon-m);
    height: var(--icon-m);
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

  /* Same column as the main panel rather than offset to its left: the two are
     toggled independently, so a fixed sideways offset left the dev panel
     floating over open canvas whenever the main panel was closed. Stacking
     below it keeps both anchored to the toolbar they belong to; when the main
     panel is closed this is the only thing in the column and sits right under
     the toolbar. */
  .graph-controls--dev {
    top: 8px;
    right: 52px;
  }

  /* Clear the main panel when both are open. It is 300px wide with a 16px
     viewport allowance, so cap the dev panel's own height to what is left. */
  .graph-controls--main-open {
    top: calc(8px + var(--s2b-graph-main-panel-height, 0px) + 8px);
    max-height: calc(100% - 24px - var(--s2b-graph-main-panel-height, 0px));
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

  .granularity-pending {
    font-size: var(--font-ui-small);
    color: var(--text-faint);
    padding-right: 4px;
  }

  /* Carries the static explanation as a tooltip, so the row keeps its inline
     line for the live measurement instead. Faint at rest and only resolving on
     hover — it is an affordance for help that is there when wanted, not a mark
     competing with the setting's own name. */
  .info-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--icon-xs);
    height: var(--icon-xs);
    color: var(--text-faint);
    cursor: help;
  }

  .info-icon:hover {
    color: var(--text-muted);
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
  /* The topic list is unbounded — a high granularity level can produce dozens of
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
