<script lang="ts">
import PickerPopover from "../ui/PickerPopover.svelte";
import Button from "../ui/Button.svelte";
import type { ContextUsageBreakdown } from "../../utils/tokenEstimator";

/**
 * Displays estimated context usage as a small circular progress indicator.
 * Designed to fit in the Input.svelte action row.
 */

interface Props {
	usagePercent: number; // 0-100
	used: number; // Tokens used (for tooltip)
	limit?: number; // Context window limit (for tooltip)
	breakdown: ContextUsageBreakdown;
	canSummarizeNow?: boolean;
	onSummarizeNow?: () => void | Promise<void>;
}

const { usagePercent, used, limit, breakdown, canSummarizeNow = false, onSummarizeNow }: Props = $props();

// Geometry in a 100-unit viewBox. The ring is sized so its outer edge (radius +
// half the stroke) fills ~73% of the 36px trigger, close to the 28px send button
// beside it: a ring that small next to a solid disc read as an ornament.
const radius = 33;
const strokeWidth = 8;
const circumference = 2 * Math.PI * radius;

// The ring is always rendered on desktop, so its low-usage state has to read as
// a gauge at rest rather than an idle spinner. Two things do that: the arc never
// drops below this floor (a round-capped pip at 12 o'clock, clearly "a little"
// rather than "nothing"), and the track behind it is fainter than the arc so the
// arc, not the track, is the shape the eye lands on.
const MIN_ARC_PERCENT = 4;
const arcPercent = $derived(Math.max(usagePercent, MIN_ARC_PERCENT));
const strokeDashoffset = $derived(circumference - (arcPercent / 100) * circumference);
const hasKnownLimit = $derived(limit !== undefined && limit > 0);

// Arc colour by usage level, via Obsidian's palette variables so themes can
// restyle it. The unknown-limit state is monochrome: there is no level to encode.
const arcClass = $derived.by(() => {
	if (!hasKnownLimit) return "s2b-context-ring-arc-unknown";
	if (usagePercent >= 95) return "s2b-context-ring-arc-critical";
	if (usagePercent >= 80) return "s2b-context-ring-arc-warning";
	return "s2b-context-ring-arc-normal";
});

const centerLabel = $derived.by(() => {
	if (!hasKnownLimit) return "?";
	return `${usagePercent.toFixed(0)}%`;
});

const distributionRows = $derived.by(() => {
	const total = Math.max(breakdown.totalTokens, 1);
	return [
		{
			label: "System Prompt",
			tokens: breakdown.systemPromptTokens,
			percent: (breakdown.systemPromptTokens / total) * 100,
		},
		{
			label: "Human",
			tokens: breakdown.humanTokens,
			percent: (breakdown.humanTokens / total) * 100,
		},
		{
			label: "AI",
			tokens: breakdown.assistantTokens,
			percent: (breakdown.assistantTokens / total) * 100,
		},
		{
			label: "Tool Messages",
			tokens: breakdown.toolTokens,
			percent: (breakdown.toolTokens / total) * 100,
		},
	].filter((row) => row.tokens > 0);
});

// Format tooltip text
const tooltipText = $derived.by(() => {
	const percent = usagePercent.toFixed(0);
	if (limit === undefined) {
		const usedK = Math.round(used / 1000);
		return `Context usage (est.): ${usedK}k tokens (limit unknown)`;
	}
	const usedK = Math.round(used / 1000);
	const limitK = Math.round(limit / 1000);
	return `Context usage (est.): ${percent}% (${usedK}k / ${limitK}k)`;
});

function formatNumber(value: number): string {
	return value.toLocaleString();
}

const maxContextLabel = $derived.by(() => {
	// Tested directly rather than via `hasKnownLimit`: narrowing does not flow through a
	// derived boolean, which is the only reason this needed an assertion. Same condition.
	if (limit === undefined || limit <= 0) return "Unknown";
	return formatNumber(limit);
});
</script>

<PickerPopover
  triggerStyles="context-usage-trigger"
  triggerClass="group relative w-9 h-9 flex items-center justify-center rounded-md p-0 appearance-none"
  contentClass="context-usage-popover"
  tooltip={tooltipText}
  align="end"
  sideOffset={6}
>
  {#snippet trigger()}
    <svg class="w-full h-full -rotate-90" viewBox="0 0 100 100" aria-label="Open context token distribution">
      <!-- Track -->
      <circle class="s2b-context-ring-track" fill="none" stroke-width={strokeWidth} cx="50" cy="50" r={radius} />
      <!-- Usage arc -->
      <circle
        class="s2b-context-ring-arc transition-all duration-300 {arcClass}"
        fill="none"
        stroke-width={strokeWidth}
        stroke-linecap="round"
        cx="50"
        cy="50"
        r={radius}
        stroke-dasharray={circumference}
        style="stroke-dashoffset: {strokeDashoffset};"
      />
    </svg>
    <!-- Live value in the centre: the number is what makes the ring a gauge
         rather than a decoration, and at this size a quiet muted label costs
         nothing visually. Brightens on hover with the rest of the control. -->
    <div
      class="s2b-context-ring-label absolute font-semibold tabular-nums transition-colors duration-150"
      class:s2b-context-ring-label-wide={centerLabel.length > 3}
    >
      {centerLabel}
    </div>
  {/snippet}

  <div class="context-usage-panel">
    <div class="context-usage-heading">Token Distribution (est.)</div>

    <div class="context-usage-summary">
      <span>Used</span>
      <span class="context-usage-summary-value">{formatNumber(breakdown.totalTokens)}</span>
      <span>Max</span>
      <span class="context-usage-summary-value">{maxContextLabel}</span>
    </div>

    <div class="picker-popover-separator menu-separator"></div>

    <div class="context-usage-rows">
      {#each distributionRows as row}
        <div class="context-usage-row">
          <span class="context-usage-row-label">{row.label}</span>
          <span class="context-usage-row-percent">{row.percent.toFixed(0)}%</span>
          <span class="context-usage-row-tokens">{formatNumber(row.tokens)}</span>
        </div>
      {/each}
    </div>

    {#if breakdown.draftAndPendingTokens > 0}
      <div class="context-usage-note">
        Draft + pending context: {formatNumber(breakdown.draftAndPendingTokens)}
      </div>
    {/if}

    <div class="context-usage-note">Older context is automatically compacted at about 80% usage.</div>

    <div class="context-usage-actions">
      <Button
        buttonText="Summarize now"
        cta
        disabled={!canSummarizeNow}
        onClick={() => onSummarizeNow?.()}
      />
    </div>
  </div>
</PickerPopover>

<style>
  :global(.context-usage-trigger),
  :global(.context-usage-trigger:hover),
  :global(.context-usage-trigger:active),
  :global(.context-usage-trigger:focus),
  :global(.context-usage-trigger:focus-visible),
  :global(.context-usage-trigger[data-state="open"]) {
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
  }

  .s2b-context-ring-track {
    /* Fainter than the arc: `--background-modifier-border` at full strength is
       the same grey as a spinner's idle track. */
    stroke: color-mix(in srgb, var(--background-modifier-border) 60%, transparent);
  }

  .s2b-context-ring-arc-normal {
    stroke: var(--color-green);
  }

  .s2b-context-ring-arc-warning {
    stroke: var(--color-yellow);
  }

  .s2b-context-ring-arc-critical {
    stroke: var(--color-red);
  }

  .s2b-context-ring-arc-unknown {
    stroke: var(--text-faint);
  }

  .s2b-context-ring-label {
    font-size: 8px;
    letter-spacing: -0.02em;
    line-height: 1;
    color: var(--text-muted);
  }

  /* "100%" is the one value that doesn't fit the hole at 8px; at that point the
     arc is a full ring, so overrunning it would put dark text on red. */
  .s2b-context-ring-label-wide {
    font-size: 6.5px;
    letter-spacing: -0.05em;
  }

  :global(.context-usage-trigger:hover) .s2b-context-ring-label,
  :global(.context-usage-trigger[data-state="open"]) .s2b-context-ring-label {
    color: var(--text-normal);
  }

  :global(.context-usage-popover) {
    min-width: 0;
    width: max-content;
  }

  .context-usage-panel {
    display: flex;
    flex-direction: column;
    min-width: 220px;
    padding: var(--size-4-3);
  }

  .context-usage-heading {
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
    margin-bottom: var(--size-4-2);
  }

  .context-usage-summary {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--size-4-2);
    row-gap: 2px;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    margin-bottom: var(--size-4-2);
  }

  .context-usage-summary-value {
    color: var(--text-normal);
  }

  .context-usage-rows {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-1);
  }

  .context-usage-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    column-gap: var(--size-4-2);
    align-items: center;
    font-size: var(--font-ui-smaller);
  }

  .context-usage-row-label {
    color: var(--text-normal);
  }

  .context-usage-row-percent,
  .context-usage-row-tokens {
    color: var(--text-muted);
    text-align: right;
  }

  .context-usage-note {
    margin-top: var(--size-4-1);
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
  }

  .context-usage-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--size-4-3);
  }
</style>
