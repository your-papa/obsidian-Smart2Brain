<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { diffWords } from "diff";
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
// svelte-ignore state_referenced_locally
let current = $state(value?.trim() ? value : defaultValue);
const isAtDefault = $derived(current === defaultValue);
let showDiff = $state(false);

function renderDiffSide(oldText: string, newText: string, side: "old" | "new"): string {
	const parts = diffWords(oldText, newText);
	return parts
		.filter((p) => (side === "old" ? !p.added : !p.removed))
		.map((p) => {
			const escaped = p.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			if (side === "old" && p.removed) return `<mark class="s2b-prompt-diff-removed">${escaped}</mark>`;
			if (side === "new" && p.added) return `<mark class="s2b-prompt-diff-added">${escaped}</mark>`;
			return escaped;
		})
		.join("");
}

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
	showDiff = false;
}
</script>

<div class="guidance-editor">
  {#if showDiff}
    <div class="guidance-diff-container">
      <div class="guidance-diff-pane">
        <div class="guidance-diff-pane-label">Yours</div>
        <pre class="guidance-diff-text">{@html renderDiffSide(current, defaultValue, "old")}</pre>
      </div>
      <div class="guidance-diff-pane">
        <div class="guidance-diff-pane-label">Default</div>
        <pre class="guidance-diff-text">{@html renderDiffSide(current, defaultValue, "new")}</pre>
      </div>
    </div>
  {:else}
    <div bind:this={editorContainer} class="guidance-editor-container"></div>
  {/if}
  {#if !isAtDefault}
    <div class="guidance-editor-footer">
      <button type="button" class="guidance-reset-link" onclick={handleReset}>Reset to default</button>
      <button type="button" class="guidance-diff-link" onclick={() => (showDiff = !showDiff)}>
        {showDiff ? "Back to editor" : "Diff with default"}
      </button>
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

  /* ── Diff view ── */
  .guidance-diff-container {
    display: flex;
    gap: 10px;
    min-height: 160px;
    max-height: 320px;
    overflow: hidden;
  }

  .guidance-diff-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-y: auto;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    padding: 10px 12px;
  }

  .guidance-diff-pane-label {
    font-size: var(--font-ui-smaller);
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 6px;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .guidance-diff-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-text);
    font-size: 0.95rem;
    line-height: 1.6;
    color: var(--text-normal);
    user-select: text;
  }

  :global(mark.s2b-prompt-diff-removed) {
    background: color-mix(in srgb, var(--color-red) 35%, transparent);
    border-radius: 2px;
    color: inherit;
  }

  :global(mark.s2b-prompt-diff-added) {
    background: color-mix(in srgb, var(--color-green) 35%, transparent);
    border-radius: 2px;
    color: inherit;
  }

  /* ── Footer row ── */
  .guidance-editor-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }

  .guidance-reset-link,
  .guidance-diff-link {
    border: 0;
    background: transparent;
    color: var(--text-accent);
    cursor: pointer;
    padding: 0;
    font-size: var(--font-ui-smaller);
  }

  .guidance-reset-link:hover,
  .guidance-diff-link:hover {
    text-decoration: underline;
  }
</style>
