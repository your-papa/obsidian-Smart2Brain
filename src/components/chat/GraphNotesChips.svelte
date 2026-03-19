<script lang="ts">
import { onDestroy } from "svelte";
import { icon } from "../../utils/utils";
import type { GraphNoteRef } from "../../stores/chatStore.svelte";

const BASENAME_RE = /(?:.*\/)?([^/]+?)(?:\.\w+)?$/;

interface Props {
	/** Bindable: the list of graph-selected note refs (after user dismissals). */
	activeGraphNotes?: GraphNoteRef[];
	/** Initial paths set externally (e.g. from Messenger.pendingGraphNotes). */
	paths?: string[];
}

let { activeGraphNotes = $bindable([]), paths = [] }: Props = $props();

let dismissed = $state(new Set<string>());

function basename(path: string): string {
	return BASENAME_RE.exec(path)?.[1] ?? path;
}

// Build refs from paths, excluding dismissed ones
$effect(() => {
	activeGraphNotes = paths.filter((p) => !dismissed.has(p)).map((p) => ({ path: p, basename: basename(p) }));
});

function toggle(path: string) {
	const next = new Set(dismissed);
	if (next.has(path)) {
		next.delete(path);
	} else {
		next.add(path);
	}
	dismissed = next;
}

/** Clear all graph notes (e.g. after sending a message). */
export function clear() {
	dismissed = new Set();
}
</script>

{#if paths.length > 0}
  <div class="graph-notes-chips inline-flex flex-row flex-wrap gap-1.5">
    {#each paths as path (path)}
      <button
        type="button"
        class="graph-note-chip"
        class:deactivated={dismissed.has(path)}
        onclick={() => toggle(path)}
        title={dismissed.has(path)
          ? `${path} (excluded — click to include)`
          : `${path} (included — click to exclude)`}
      >
        <div class="chip-icon" use:icon={"git-fork"} style="--icon-size: 12px"></div>
        <span>{basename(path)}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .graph-note-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    font-size: 11px;
    line-height: 1.15;
    background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-secondary));
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 16%, transparent);
    border-radius: 999px;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 10%, transparent),
      0 1px 2px color-mix(in srgb, black 10%, transparent);
    color: var(--text-normal);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s ease,
      transform 0.15s ease,
      opacity 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .graph-note-chip:hover {
    background: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--interactive-accent) 24%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 3px 8px color-mix(in srgb, black 12%, transparent);
    transform: translateY(-1px);
  }

  .graph-note-chip:focus-visible {
    outline: none;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 0 0 2px color-mix(in srgb, var(--interactive-accent) 28%, transparent),
      0 3px 8px color-mix(in srgb, black 12%, transparent);
  }

  .graph-note-chip.deactivated {
    background: var(--background-primary);
    border-color: color-mix(in srgb, var(--background-modifier-border) 85%, transparent);
    color: var(--text-muted);
    box-shadow: none;
    opacity: 0.6;
  }

  .graph-note-chip.deactivated:hover {
    transform: none;
    opacity: 0.75;
    box-shadow: none;
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.9;
  }
</style>
