<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { EmbeddableMarkdownEditor } from "../../lib/editor";
import type SecondBrainPlugin from "../../main";

interface Props {
	plugin: SecondBrainPlugin;
	/** Current stored value (empty falls back to `defaultValue`). */
	value: string;
	/** Value the "Reset to default" link restores to. */
	defaultValue: string;
	placeholder?: string;
	/** Persisted on every editor change (live editing — no Save button). */
	onCommit: (value: string) => void;
}

const { plugin, value, defaultValue, placeholder = "", onCommit }: Props = $props();

let editorContainer: HTMLDivElement | undefined = $state();
let editor: EmbeddableMarkdownEditor | undefined = $state();
// The value shown/edited: stored value if set, else the default. Seeds the initial
// editor state only; callers remount (via {#key}) when the effective default changes.
// svelte-ignore state_referenced_locally
let current = $state(value?.trim() ? value : defaultValue);
const isAtDefault = $derived(current === defaultValue);

onMount(() => {
	if (!editorContainer) return;
	editor = new EmbeddableMarkdownEditor(plugin.app, editorContainer, {
		value: current,
		placeholder,
		cls: "capability-guidance-editor",
		editable: true,
		onChange: (next) => {
			current = next;
			onCommit(next);
		},
	});
});

onDestroy(() => {
	editor?.destroy();
});

function handleReset() {
	current = defaultValue;
	editor?.setValue(defaultValue);
	onCommit(defaultValue);
}
</script>

<div class="guidance-editor">
  <div bind:this={editorContainer} class="guidance-editor-container"></div>
  {#if !isAtDefault}
    <div class="guidance-editor-reset">
      <button type="button" class="guidance-reset-link" onclick={handleReset}>Reset to default</button>
    </div>
  {/if}
</div>

<style>
  .guidance-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .guidance-editor-container {
    min-height: 160px;
    max-height: 320px;
    overflow-y: auto;
    border-radius: 12px;
  }

  .guidance-editor-container :global(.cm-editor) {
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    font-family: var(--font-text);
    font-size: 0.95rem;
  }

  .guidance-editor-container :global(.cm-editor.cm-focused) {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--interactive-accent);
  }

  .guidance-editor-container :global(.cm-scroller) {
    padding: 10px 12px;
  }

  .guidance-editor-container :global(.cm-content) {
    min-height: 140px;
    caret-color: var(--text-normal);
  }

  .guidance-editor-container :global(.cm-line) {
    line-height: 1.6;
  }

  .guidance-editor-container :global(.cm-placeholder) {
    color: var(--text-muted);
  }

  .guidance-editor-reset {
    display: flex;
    justify-content: flex-end;
  }

  .guidance-reset-link {
    border: 0;
    background: transparent;
    color: var(--text-accent);
    cursor: pointer;
    padding: 0;
    font-size: var(--font-ui-smaller);
  }

  .guidance-reset-link:hover {
    text-decoration: underline;
  }
</style>
