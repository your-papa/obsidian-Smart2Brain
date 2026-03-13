<script lang="ts">
  import { onDestroy } from "svelte";
  import { SelectionTracker, type SelectionRef } from "../../hooks/useSelection.svelte";
  import { icon } from "../../utils/utils";

  const PREVIEW_LENGTH = 60;

  interface Props {
    /** Bindable: the currently active selection ref (undefined when dismissed). */
    activeSelection?: SelectionRef | undefined;
  }

  let { activeSelection = $bindable(undefined) }: Props = $props();

  const tracker = new SelectionTracker();
  let dismissed = $state(false);

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
  <div class="selection-chip-container flex flex-row flex-wrap gap-1.5 pt-1">
    <button
      type="button"
      class="selection-chip"
      onclick={dismiss}
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
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
    max-width: 100%;
  }

  .selection-chip:hover {
    background: color-mix(in srgb, var(--interactive-accent) 20%, transparent);
    border-color: color-mix(in srgb, var(--interactive-accent) 40%, transparent);
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-preview {
    opacity: 0.7;
  }

  .chip-warning {
    flex-shrink: 0;
    font-size: 10px;
  }

  .chip-close {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.5;
    transition: opacity 0.15s ease;
  }

  .selection-chip:hover .chip-close {
    opacity: 1;
  }
</style>
