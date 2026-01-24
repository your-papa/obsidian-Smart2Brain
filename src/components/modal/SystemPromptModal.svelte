<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { EmbeddableMarkdownEditor } from "../../lib/editor";
import type SecondBrainPlugin from "../../main";
import { getData } from "../../stores/dataStore.svelte";
import Button from "../ui/Button.svelte";
import type { SystemPromptAccessors, SystemPromptModal } from "./SystemPromptModal";

interface Props {
	modal: SystemPromptModal;
	plugin: SecondBrainPlugin;
	accessors?: SystemPromptAccessors;
}

const { modal, plugin, accessors }: Props = $props();
const pluginData = getData();

// biome-ignore lint/style/useConst: Svelte bind:this requires let
let editorContainer: HTMLDivElement | undefined = $state();
let editor: EmbeddableMarkdownEditor | undefined = $state();

// Use custom accessor if provided, otherwise use global pluginData
function getPrompt(): string {
	return accessors?.getPrompt() ?? pluginData.systemPrompt;
}

function setPrompt(prompt: string): void {
	if (accessors?.setPrompt) {
		accessors.setPrompt(prompt);
	} else {
		pluginData.systemPrompt = prompt;
	}
}

let promptValue = $state(getPrompt());

onMount(() => {
	if (editorContainer) {
		initializeEditor();
	}
});

onDestroy(() => {
	editor?.destroy();
});

function initializeEditor() {
	if (!editorContainer) return;
	promptValue = getPrompt();
	editor = new EmbeddableMarkdownEditor(plugin.app, editorContainer, {
		value: promptValue,
		placeholder: "Define the system prompt for the assistant...",
		cls: "system-prompt-editor",
		onChange: (value) => {
			promptValue = value;
		},
	});
}

function handleSave() {
	setPrompt(promptValue);
	plugin.agentManager?.updateSystemPrompt();
	modal.close();
}
</script>

<div class="system-prompt-modal-content">
	<p class="system-prompt-description">
		Customize the system instructions used for every chat.
	</p>
	<div
		bind:this={editorContainer}
		class="system-prompt-editor-container"
	></div>
	<div class="system-prompt-actions">
		<Button buttonText="Cancel" onClick={() => modal.close()} />
		<Button buttonText="Save" cta={true} onClick={handleSave} />
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
		justify-content: flex-end;
		gap: 8px;
		margin-top: 16px;
	}
</style>
