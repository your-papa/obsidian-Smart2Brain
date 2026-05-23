<script lang="ts">
import { Keymap } from "obsidian";
import { getPlugin } from "../../stores/state.svelte";
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

const MAX_VISIBLE = 5;
let expanded = $state(false);
const hiddenCount = $derived(Math.max(0, paths.length - MAX_VISIBLE));
const visiblePaths = $derived(expanded ? paths : paths.slice(0, MAX_VISIBLE));

let dismissed = $state(new Set<string>());
const sourcePath = $derived(getPlugin().app.workspace.getActiveFile()?.path ?? "");

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

function onGraphChipClick(evt: MouseEvent, path: string): void {
	if (Keymap.isModEvent(evt)) {
		evt.preventDefault();
		evt.stopPropagation();
		getPlugin().app.workspace.openLinkText(path, sourcePath, true);
		return;
	}

	toggle(path);
}

/** Clear all graph notes (e.g. after sending a message). */
export function clear() {
	dismissed = new Set();
}
</script>

{#if paths.length > 0}
  <div class="graph-notes-chips inline-flex flex-row flex-wrap gap-1.5">
    {#each visiblePaths as path (path)}
      <button
        type="button"
        class="graph-note-chip s2b-pill s2b-pill--interactive"
        class:deactivated={dismissed.has(path)}
        onclick={(evt) => onGraphChipClick(evt, path)}
        title={dismissed.has(path)
          ? `${path} (excluded — click to include)`
          : `${path} (included — click to exclude)`}
      >
        <div class="chip-icon" use:icon={"git-fork"} style="--icon-size: 12px"></div>
        <span>{basename(path)}</span>
      </button>
    {/each}
    {#if !expanded && hiddenCount > 0}
      <button type="button" class="more-chip" onclick={() => (expanded = true)}
        >+{hiddenCount} more</button
      >
    {:else if expanded && paths.length > MAX_VISIBLE}
      <button type="button" class="more-chip" onclick={() => (expanded = false)}>show less</button>
    {/if}
  </div>
{/if}

<style>
  .graph-note-chip {
    --s2b-pill-bg: color-mix(in srgb, var(--interactive-accent) 6%, var(--background-secondary));
    --s2b-pill-border: color-mix(
      in srgb,
      var(--interactive-accent) 16%,
      var(--background-modifier-border)
    );
    --s2b-pill-color: var(--text-normal);
    --s2b-pill-bg-hover: color-mix(
      in srgb,
      var(--interactive-accent) 9%,
      var(--background-secondary)
    );
    --s2b-pill-border-hover: color-mix(
      in srgb,
      var(--interactive-accent) 22%,
      var(--background-modifier-border)
    );
  }

  .graph-note-chip.deactivated {
    --s2b-pill-bg: var(--background-primary);
    --s2b-pill-border: color-mix(in srgb, var(--background-modifier-border) 90%, transparent);
    --s2b-pill-color: var(--text-muted);
    --s2b-pill-bg-hover: var(--background-primary);
    --s2b-pill-border-hover: color-mix(in srgb, var(--background-modifier-border) 90%, transparent);
    --s2b-pill-color-hover: var(--text-muted);
    opacity: 0.6;
  }

  .graph-note-chip.deactivated:hover {
    opacity: 0.75;
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .more-chip {
    --s2b-pill-bg: var(--background-modifier-hover);
    --s2b-pill-border: var(--background-modifier-border);
    --s2b-pill-color: var(--text-muted);
    --s2b-pill-bg-hover: var(--background-modifier-border);
    --s2b-pill-color-hover: var(--text-normal);
  }
</style>
