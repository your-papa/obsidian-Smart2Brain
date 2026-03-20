<script lang="ts">
import { Popover } from "bits-ui";
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

const radius = 20; // Slightly larger radius for better visibility
const circumference = 2 * Math.PI * radius;
const strokeDashoffset = $derived(circumference - (usagePercent / 100) * circumference);
const hasKnownLimit = $derived(limit !== undefined && limit > 0);

// Determine color based on usage level
const colorClass = $derived.by(() => {
	if (!hasKnownLimit) return "text-[--text-muted]";
	if (usagePercent >= 95) return "text-red-500"; // Critical
	if (usagePercent >= 80) return "text-yellow-500"; // Warning
	return "text-green-500"; // Normal
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
	if (!hasKnownLimit) return "Unknown";
	return formatNumber(limit!);
});
</script>

<Popover.Root>
  <Popover.Trigger
    class="context-usage-trigger group relative w-9 h-9 flex items-center justify-center rounded-md border-none bg-transparent hover:bg-transparent active:bg-transparent focus:bg-transparent p-0 cursor-pointer appearance-none shadow-none"
    title={tooltipText}
    aria-label="Open context token distribution"
  >
    <svg class="w-full h-full -rotate-90" viewBox="0 0 100 100">
      <!-- Background circle -->
      <circle
        class="stroke-current text-[--background-modifier-border]"
        fill="none"
        stroke-width="8"
        cx="50"
        cy="50"
        r={radius}
      />
      <!-- Progress circle -->
      <circle
        class="stroke-current transition-all duration-300 {colorClass}"
        fill="none"
        stroke-width="8"
        cx="50"
        cy="50"
        r={radius}
        stroke-dasharray={circumference}
        style="stroke-dashoffset: {strokeDashoffset};"
      />
    </svg>
    <!-- Show value only on hover to keep the icon visually quiet by default -->
    <div
      class="absolute text-[12px] font-semibold opacity-0 transition-opacity duration-150 group-hover:opacity-100"
    >
      {centerLabel}
    </div>
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content
      class="bg-[--background-primary] rounded-md border border-solid border-[--background-modifier-border] shadow-md z-[var(--layer-popover)] p-3 min-w-[240px]"
      sideOffset={6}
    >
      <div class="text-xs font-semibold text-[--text-normal] mb-2">Token Distribution (est.)</div>
      <div class="mb-2 text-[11px] text-[--text-muted] grid grid-cols-[auto_1fr] gap-x-2">
        <div>Used:</div>
        <div>{formatNumber(breakdown.totalTokens)}</div>
        <div>Max:</div>
        <div>{maxContextLabel}</div>
      </div>
      <div class="space-y-1.5">
        {#each distributionRows as row}
          <div class="grid grid-cols-[1fr_auto_auto] gap-2 text-xs items-center">
            <div class="text-[--text-normal]">{row.label}</div>
            <div class="text-[--text-muted]">{row.percent.toFixed(0)}%</div>
            <div class="text-[--text-muted]">{formatNumber(row.tokens)}</div>
          </div>
        {/each}
      </div>
      {#if breakdown.draftAndPendingTokens > 0}
        <div class="mt-1 text-[11px] text-[--text-muted]">
          Draft + pending context: {formatNumber(breakdown.draftAndPendingTokens)}
        </div>
      {/if}
      <div class="mt-2 text-[11px] text-[--text-muted]">
        Older context is automatically compacted at about 80% usage.
      </div>
      <div class="mt-3 flex justify-end">
        <button
          class="text-xs px-2 py-1 rounded border border-solid border-[--background-modifier-border] bg-[--background-secondary] text-[--text-normal] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!canSummarizeNow}
          onclick={() => onSummarizeNow?.()}
        >
          Summarize now
        </button>
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

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
</style>
