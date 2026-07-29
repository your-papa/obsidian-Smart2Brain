<script lang="ts">
import { getData } from "../../stores/dataStore.svelte";
import type { SessionRegistry } from "../../stores/chatStore.svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import { icon } from "../../utils/utils";
import { DISMISS_ALL_ID, filterSuggestions, type SuggestedQuery } from "./chatRecommendations";

interface Props {
	registry: SessionRegistry;
}

let { registry }: Props = $props();

const data = getData();
const models = useAvailableModels();

/** True when the given embed index is assigned and actually populated. */
function indexPopulated(indexId: string | null): boolean {
	if (!indexId) return false;
	return (data.getEmbeddingIndex(indexId)?.documentCount ?? 0) > 0;
}

const ctx = $derived({
	hasChat: models.hasModels,
	hasSearch: indexPopulated(data.searchEmbedIndex),
	hasGraph: indexPopulated(data.graphEmbedIndex),
});

const visible = $derived(filterSuggestions(ctx, data.dismissedRecommendations));

function useSuggestion(s: SuggestedQuery): void {
	// Prefill only — the input effect mirrors this into the editor and focuses.
	registry.pendingInput = s.query ?? s.label;
}

function dismiss(id: string): void {
	data.dismissRecommendation(id);
}
</script>

{#if visible.length > 0}
  <div class="chat-recommendations flex flex-col items-center gap-3">
    <div class="recommendations-header flex items-center gap-2">
      <p class="text-sm opacity-70">Try asking…</p>
      <button
        type="button"
        class="dismiss-all clickable-icon"
        aria-label="Dismiss suggestions"
        title="Dismiss suggestions"
        onclick={() => dismiss(DISMISS_ALL_ID)}
      >
        <span use:icon={"x"} style="--icon-size: 14px"></span>
      </button>
    </div>
    <div class="recommendation-chips flex flex-row flex-wrap justify-center gap-1.5">
      {#each visible as s (s.id)}
        <div class="recommendation-chip-wrap inline-flex items-center">
          <button
            type="button"
            class="recommendation-chip s2b-pill s2b-pill--interactive"
            title={s.query ?? s.label}
            onclick={() => useSuggestion(s)}
          >
            <span class="chip-icon" use:icon={s.icon} style="--icon-size: 12px"></span>
            <span>{s.label}</span>
          </button>
          <button
            type="button"
            class="dismiss-chip clickable-icon"
            aria-label={`Dismiss "${s.label}"`}
            title="Dismiss this suggestion"
            onclick={() => dismiss(s.id)}
          >
            <span use:icon={"x"} style="--icon-size: 11px"></span>
          </button>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <!-- Fallback so the empty chat view is never completely blank (all dismissed / no capability). -->
  <div class="flex flex-col items-center">
    <p class="text-lg mb-1">Start a new conversation</p>
    <p class="text-sm opacity-70">Ask me anything about your notes.</p>
  </div>
{/if}

<style>
  .recommendation-chip {
    --s2b-pill-bg: var(--background-secondary);
    --s2b-pill-border: var(--background-modifier-border);
    --s2b-pill-color: var(--text-normal);
    --s2b-pill-bg-hover: var(--background-modifier-hover);
    --s2b-pill-border-hover: var(--background-modifier-border-hover);
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .dismiss-chip {
    opacity: 0;
    margin-left: -0.35rem;
    color: var(--text-muted);
    transition: opacity 120ms ease;
  }

  .recommendation-chip-wrap:hover .dismiss-chip,
  .dismiss-chip:focus-visible {
    opacity: 1;
  }

  .dismiss-all {
    color: var(--text-muted);
    opacity: 0.6;
  }

  .dismiss-all:hover {
    opacity: 1;
  }
</style>
