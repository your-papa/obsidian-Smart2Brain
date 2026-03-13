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
  <div class="graph-notes-chips flex flex-row flex-wrap gap-1.5 pt-1">
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
    padding: 2px 8px;
    font-size: 11px;
    line-height: 1.2;
    background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 25%, transparent);
    border-radius: 4px;
    color: var(--text-normal);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s ease,
      opacity 0.15s ease,
      border-color 0.15s ease;
  }

  .graph-note-chip:hover {
    background: color-mix(in srgb, var(--interactive-accent) 20%, transparent);
    border-color: color-mix(in srgb, var(--interactive-accent) 40%, transparent);
  }

  .graph-note-chip.deactivated {
    background: var(--background-primary);
    border-color: var(--background-modifier-border);
    color: var(--text-muted);
    opacity: 0.5;
  }

  .graph-note-chip.deactivated:hover {
    opacity: 0.75;
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
</style>
