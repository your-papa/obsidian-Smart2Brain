<script lang="ts">
import { onDestroy, onMount } from "svelte";
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
}

const { modal, plugin, accessors, description, readOnly }: Props = $props();

let editorContainer: HTMLDivElement | undefined = $state();
let editor: EmbeddableMarkdownEditor | undefined = $state();
let initialPromptValue = $state("");
let promptValue = $state("");
let isLoading = $state(true);
const defaultPrompt = $derived(accessors.defaultPrompt ?? BASE_SYSTEM_PROMPT);
const isDirty = $derived(promptValue !== initialPromptValue);
const isAtDefault = $derived(promptValue === defaultPrompt);
const showResetToDefault = $derived(!isAtDefault);

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
</script>

<div class="system-prompt-modal-content">
  <p class="system-prompt-description">{description}</p>
  {#if readOnly}
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
    {#if !readOnly && accessors.viewFinalPrompt}
      <Button buttonText="View Final" onClick={accessors.viewFinalPrompt} />
    {/if}
    {#if !readOnly && showResetToDefault}
      <Button buttonText="Reset to Default" onClick={handleResetToDefault} />
    {/if}
    {#if !readOnly && isDirty}
      <Button buttonText="Save" cta={true} onClick={handleSave} />
    {/if}
  </div>
</div>

<style>
  .system-prompt-modal-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0; /* Required for nested flex to shrink properly */
  }

  .system-prompt-description {
    flex-shrink: 0;
    margin: 0 0 12px 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  .system-prompt-editor-container {
    flex: 1 1 auto;
    min-height: 0; /* Required for flex child to shrink below content */
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
