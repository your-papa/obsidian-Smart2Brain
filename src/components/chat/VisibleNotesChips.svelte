<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    VisibleNotesTracker,
    toVisibleNoteRefs,
    type VisibleNoteRef,
  } from "../../hooks/useVisibleNotes.svelte";
  import { icon } from "../../utils/utils";

  interface Props {
    /** Bindable: the currently active (non-deactivated) notes as serializable refs. */
    activeNotes?: VisibleNoteRef[];
    /** Path to exclude from display (e.g. when a selection chip covers this note). */
    excludePath?: string;
  }

  let { activeNotes = $bindable([]), excludePath }: Props = $props();

  const tracker = new VisibleNotesTracker();
  let deactivated = $state(new Set<string>());

  // Keep activeNotes in sync with tracker + deactivated set + excludePath
  $effect(() => {
    const active = tracker.notes.filter(
      (n) => !deactivated.has(n.file.path) && n.file.path !== excludePath,
    );
    activeNotes = toVisibleNoteRefs(active);
  });

  function toggle(path: string) {
    const next = new Set(deactivated);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    deactivated = next;
  }

  onDestroy(() => tracker.destroy());
</script>

{#if tracker.notes.length > 0}
  <div class="visible-notes-chips flex flex-row flex-wrap gap-1.5 pt-2">
    {#each tracker.notes as note (note.file.path)}
      {#if note.file.path !== excludePath}
        <button
          type="button"
          class="visible-note-chip"
          class:deactivated={deactivated.has(note.file.path)}
          onclick={() => toggle(note.file.path)}
          title={deactivated.has(note.file.path)
            ? `${note.file.path} (excluded — click to include)`
            : `${note.file.path} (included — click to exclude)`}
        >
          <div class="chip-icon" use:icon={note.icon} style="--icon-size: 12px"></div>
          <span
            >{note.file.basename}{#if note.context}<span class="chip-context">
                · {note.context}</span
              >{/if}</span
          >
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .visible-note-chip {
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

  .visible-note-chip:hover {
    background: color-mix(in srgb, var(--interactive-accent) 20%, transparent);
    border-color: color-mix(in srgb, var(--interactive-accent) 40%, transparent);
  }

  .visible-note-chip.deactivated {
    background: var(--background-primary);
    border-color: var(--background-modifier-border);
    color: var(--text-muted);
    opacity: 0.5;
  }

  .visible-note-chip.deactivated:hover {
    opacity: 0.75;
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .chip-context {
    opacity: 0.7;
  }
</style>
