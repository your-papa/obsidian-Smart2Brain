<script lang="ts">
import { Keymap } from "obsidian";
import { onDestroy } from "svelte";
import { SelectionTracker, type SelectionRef } from "../../hooks/useSelection.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";

const PREVIEW_LENGTH = 60;

interface Props {
	/** Bindable: the currently active selection ref (undefined when dismissed). */
	activeSelection?: SelectionRef | undefined;
}

let { activeSelection = $bindable(undefined) }: Props = $props();

const tracker = new SelectionTracker();
let dismissed = $state(false);
const sourcePath = $derived(getPlugin().app.workspace.getActiveFile()?.path ?? "");

$effect(() => {
	if (dismissed) {
		activeSelection = undefined;
	} else {
		activeSelection = tracker.selection;
	}
});

// When a new selection appears (different text), un-dismiss
$effect(() => {
	if (tracker.selection && dismissed) {
		dismissed = false;
	}
});

function dismiss() {
	dismissed = true;
	tracker.clear();
}

function onSelectionClick(evt: MouseEvent): void {
	if (!tracker.selection) return;
	if (Keymap.isModEvent(evt)) {
		evt.preventDefault();
		evt.stopPropagation();
		getPlugin().app.workspace.openLinkText(tracker.selection.path, sourcePath, true);
		return;
	}

	dismiss();
}

/** Clear the selection and tracker (e.g. after sending a message). */
export function clearSelection() {
	dismiss();
}

function preview(text: string): string {
	const oneLine = text.replace(/\n/g, " ").trim();
	if (oneLine.length <= PREVIEW_LENGTH) return oneLine;
	return `${oneLine.slice(0, PREVIEW_LENGTH)}…`;
}

onDestroy(() => tracker.destroy());
</script>

{#if tracker.selection && !dismissed}
  <div class="selection-chip-container inline-flex flex-row flex-wrap gap-1.5">
    <button
      type="button"
      class="selection-chip s2b-pill s2b-pill--interactive"
      onclick={onSelectionClick}
      title={`Selected text from ${tracker.selection.path} (click to dismiss)\n\n${tracker.selection.text.slice(0, 200)}`}
    >
      <div class="chip-icon" use:icon={tracker.selection.icon} style="--icon-size: 12px"></div>
      <span class="chip-label"
        >{tracker.selection.basename}<span class="chip-preview">
          · {preview(tracker.selection.text)}</span
        ></span
      >
      {#if tracker.isLong}
        <span class="chip-warning" title="Long selection — full text will be sent">⚠</span>
      {/if}
      <div class="chip-close" use:icon={"x"} style="--icon-size: 10px"></div>
    </button>
  </div>
{/if}

<style>
  .selection-chip {
    max-width: 100%;

    --s2b-pill-bg: color-mix(in srgb, var(--interactive-accent) 7%, var(--background-secondary));
    --s2b-pill-border: color-mix(
      in srgb,
      var(--interactive-accent) 18%,
      var(--background-modifier-border)
    );
    --s2b-pill-color: var(--text-normal);
    --s2b-pill-bg-hover: color-mix(
      in srgb,
      var(--interactive-accent) 10%,
      var(--background-secondary)
    );
    --s2b-pill-border-hover: color-mix(
      in srgb,
      var(--interactive-accent) 24%,
      var(--background-modifier-border)
    );
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-preview {
    opacity: 0.62;
  }

  .chip-warning {
    flex-shrink: 0;
    font-size: 10px;
  }

  .chip-close {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-left: 2px;
    padding-left: 6px;
    border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    opacity: 0.45;
    transition:
      opacity 0.15s ease,
      border-color 0.15s ease;
  }

  .selection-chip:hover .chip-close {
    opacity: 1;
    border-color: color-mix(in srgb, currentColor 22%, transparent);
  }
</style>
