<script lang="ts">
import { onDestroy } from "svelte";
import {
	VisibleNotesTracker,
	toVisibleNoteRefs,
	type VisibleNote,
	type VisibleNoteRef,
} from "../../hooks/useVisibleNotes.svelte";
import { icon } from "../../utils/utils";

const PROMOTABLE_VIEW_TYPES = new Set(["pdf", "image"]);

interface Props {
	/** Bindable: the currently active (non-deactivated) notes as serializable refs. */
	activeNotes?: VisibleNoteRef[];
	/** Path to exclude from display (e.g. when a selection chip covers this note). */
	excludePath?: string;
	/** Called when the user promotes a PDF/image chip to a direct attachment. */
	onPromoteToAttachment?: (note: VisibleNote) => void;
}

let { activeNotes = $bindable([]), excludePath, onPromoteToAttachment }: Props = $props();

const tracker = new VisibleNotesTracker();
let deactivated = $state(new Set<string>());

// Keep activeNotes in sync with tracker + deactivated set + excludePath
$effect(() => {
	const active = tracker.notes.filter((n) => !deactivated.has(n.file.path) && n.file.path !== excludePath);
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

function promote(event: Event, note: VisibleNote) {
	event.stopPropagation();
	// Deactivate the chip so it's excluded from activeNotes
	const next = new Set(deactivated);
	next.add(note.file.path);
	deactivated = next;
	onPromoteToAttachment?.(note);
}

onDestroy(() => tracker.destroy());
</script>

{#if tracker.notes.length > 0}
  <div class="visible-notes-chips flex flex-row flex-wrap gap-1.5 pt-2">
    {#each tracker.notes as note (note.file.path)}
      {#if note.file.path !== excludePath}
        {@const isDeactivated = deactivated.has(note.file.path)}
        <span class="visible-note-chip" class:deactivated={isDeactivated}>
          <button
            type="button"
            class="chip-toggle"
            onclick={() => toggle(note.file.path)}
            title={isDeactivated
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
          {#if PROMOTABLE_VIEW_TYPES.has(note.viewType) && onPromoteToAttachment && !isDeactivated}
            <button
              type="button"
              class="promote-btn"
              title="Attach to message for native provider processing"
              onclick={(e) => promote(e, note)}
            >
              <div use:icon={"paperclip"} style="--icon-size: 10px"></div>
            </button>
          {/if}
        </span>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .visible-note-chip {
    display: inline-flex;
    align-items: center;
    gap: 0;
    font-size: 11px;
    line-height: 1.2;
    background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 25%, transparent);
    border-radius: 4px;
    color: var(--text-normal);
    white-space: nowrap;
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

  .chip-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .chip-context {
    opacity: 0.7;
  }

  .promote-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 4px 2px 0;
    background: none;
    border: none;
    border-radius: 3px;
    color: var(--text-muted);
    cursor: pointer;
    opacity: 0.6;
    transition:
      opacity 0.15s ease,
      color 0.15s ease;
  }

  .promote-btn:hover {
    opacity: 1;
    color: var(--interactive-accent);
  }
</style>
