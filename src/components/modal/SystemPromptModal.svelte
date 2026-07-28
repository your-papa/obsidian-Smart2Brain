<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { diffWords } from "diff";
import { BASE_SYSTEM_PROMPT } from "../../agent/prompts";
import { EmbeddableMarkdownEditor } from "../../lib/editor";
import type SecondBrainPlugin from "../../main";
import Button from "../ui/Button.svelte";
import type { SystemPromptAccessors, SystemPromptModal } from "./SystemPromptModal";

interface Props {
	modal: SystemPromptModal;
	plugin: SecondBrainPlugin;
	accessors: SystemPromptAccessors;
	description: string;
	readOnly: boolean;
	showDiff?: boolean;
}

const { modal, plugin, accessors, description, readOnly, showDiff = false }: Props = $props();

type ViewMode = "edit" | "diff";

let editorContainer: HTMLDivElement | undefined = $state();
let editor: EmbeddableMarkdownEditor | undefined = $state();
let initialPromptValue = $state("");
let promptValue = $state("");
let isLoading = $state(true);
let viewMode: ViewMode = $state<ViewMode>("edit");

// Initialise to diff when the modal was opened with showDiff=true.
$effect(() => {
	if (showDiff) viewMode = "diff";
});

const defaultPrompt = $derived(accessors.defaultPrompt ?? BASE_SYSTEM_PROMPT);
const isDirty = $derived(promptValue !== initialPromptValue);
const isAtDefault = $derived(promptValue === defaultPrompt);
const canShowDiff = $derived(!readOnly && !isAtDefault);

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
	if (readOnly) {
		void loadPrompt();
		return;
	}
	void initializeEditor();
});

onDestroy(() => {
	editor?.destroy();
});

async function loadPrompt() {
	promptValue = await accessors.getPrompt();
	initialPromptValue = promptValue;
	isLoading = false;
}

async function initializeEditor() {
	if (!editorContainer) return;
	await loadPrompt();
	editor = new EmbeddableMarkdownEditor(plugin.app, editorContainer, {
		value: promptValue,
		placeholder: "Define the system prompt for the assistant...",
		cls: "system-prompt-editor",
		editable: true,
		onChange: (value) => {
			promptValue = value;
		},
	});
}

async function handleSave() {
	accessors.setPrompt?.(promptValue);
	plugin.agentManager?.invalidateSystemPromptCaches();
	modal.close();
}

function handleResetToDefault() {
	promptValue = defaultPrompt;
	editor?.setValue(defaultPrompt);
}

function handleUseNewDefault() {
	handleResetToDefault();
	viewMode = "edit";
}
</script>

<div class="system-prompt-modal-content">
  <p class="system-prompt-description">{description}</p>

  {#if viewMode === "diff" && canShowDiff}
    <div class="prompt-diff-container">
      <div class="prompt-diff-pane">
        <div class="prompt-diff-pane-label">Yours</div>
        <pre class="prompt-diff-text">{@html renderDiffSide(promptValue, defaultPrompt, "old")}</pre>
      </div>
      <div class="prompt-diff-pane">
        <div class="prompt-diff-pane-label">New default</div>
        <pre class="prompt-diff-text">{@html renderDiffSide(promptValue, defaultPrompt, "new")}</pre>
      </div>
    </div>
  {:else if readOnly}
    <div class="system-prompt-preview-container">
      {#if isLoading}
        <div class="system-prompt-loading">Loading prompt…</div>
      {:else}
        <pre class="system-prompt-preview">{promptValue}</pre>
      {/if}
    </div>
  {:else}
    <div bind:this={editorContainer} class="system-prompt-editor-container">
      {#if isLoading}
        <div class="system-prompt-loading">Loading prompt…</div>
      {/if}
    </div>
  {/if}

  <div class="system-prompt-actions">
    <Button buttonText={readOnly ? "Close" : "Cancel"} onClick={() => modal.close()} />
    <div class="flex-1"></div>
    {#if viewMode === "diff" && canShowDiff}
      <Button buttonText="Back to editor" onClick={() => (viewMode = "edit")} />
      <Button buttonText="Use new default" cta={true} onClick={handleUseNewDefault} />
    {:else}
      {#if !readOnly && accessors.viewFinalPrompt}
        <Button buttonText="View Final" onClick={accessors.viewFinalPrompt} />
      {/if}
      {#if !readOnly && !isAtDefault}
        <Button buttonText="Reset to Default" onClick={handleResetToDefault} />
      {/if}
      {#if canShowDiff}
        <Button buttonText="Diff with default" onClick={() => (viewMode = "diff")} />
      {/if}
      {#if !readOnly && isDirty}
        <Button buttonText="Save" cta={true} onClick={handleSave} />
      {/if}
    {/if}
  </div>
</div>

<style>
  .system-prompt-modal-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .system-prompt-description {
    flex-shrink: 0;
    margin: 0 0 12px 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  /* ── Two-pane diff ── */
  .prompt-diff-container {
    display: flex;
    gap: 12px;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .prompt-diff-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-y: auto;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    padding: 12px 14px;
  }

  .prompt-diff-pane-label {
    font-size: var(--font-ui-smaller);
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 8px;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .prompt-diff-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-monospace);
    font-size: 0.9rem;
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

  /* ── Editor / preview (unchanged from before) ── */
  .system-prompt-editor-container {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    border-radius: 12px;
  }

  .system-prompt-preview-container {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    padding: 12px 14px;
  }

  .system-prompt-preview {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-monospace);
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--text-normal);
    user-select: text;
  }

  .system-prompt-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  .system-prompt-editor-container :global(.cm-editor) {
    height: 100%;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    font-family: var(--font-text);
    font-size: 0.95rem;
  }

  .system-prompt-editor-container :global(.cm-editor.cm-focused) {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--interactive-accent);
  }

  .system-prompt-editor-container :global(.cm-scroller) {
    padding: 12px 14px;
  }

  .system-prompt-editor-container :global(.cm-content) {
    min-height: 200px;
    caret-color: var(--text-normal);
  }

  .system-prompt-editor-container :global(.cm-line) {
    line-height: 1.6;
  }

  .system-prompt-editor-container :global(.cm-placeholder) {
    color: var(--text-muted);
  }

  .system-prompt-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
  }
</style>
