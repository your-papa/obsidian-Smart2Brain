<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { DEFAULT_PLUGIN_EXTENSIONS } from "../../agent/prompts";
import { EmbeddableMarkdownEditor } from "../../lib/editor";
import type SecondBrainPlugin from "../../main";
import type { PluginPromptExtension } from "../../main";
import { getData } from "../../stores/dataStore.svelte";
import Button from "../ui/Button.svelte";
import type { PluginExtensionAccessors, PluginExtensionModal } from "./PluginExtensionModal";

interface Props {
	modal: PluginExtensionModal;
	plugin: SecondBrainPlugin;
	pluginId: string;
	onSave: () => void;
	accessors?: PluginExtensionAccessors;
}

const { modal, plugin, pluginId, onSave, accessors }: Props = $props();
const pluginData = getData();

// Use custom accessor if provided, otherwise use global pluginData
function getExtension(): PluginPromptExtension | undefined {
	return accessors?.getExtension() ?? pluginData.getPluginExtension(pluginId);
}

function updateExtension(updates: Partial<PluginPromptExtension>): void {
	if (accessors?.updateExtension) {
		accessors.updateExtension(updates);
	} else {
		pluginData.updatePluginExtension(pluginId, updates);
	}
}

const extension = $derived(getExtension());
const displayName = $derived(extension?.displayName ?? pluginId);
const hasDefault = $derived(!!DEFAULT_PLUGIN_EXTENSIONS[pluginId]);

// biome-ignore lint/style/useConst: Svelte bind:this requires let
let editorContainer: HTMLDivElement | undefined = $state();
let editor: EmbeddableMarkdownEditor | undefined = $state();
let promptValue = $state("");

onMount(() => {
	if (editorContainer) {
		initializeEditor();
	}
	// Set modal title
	modal.setTitle(`Edit: ${displayName}`);
});

onDestroy(() => {
	editor?.destroy();
});

function initializeEditor() {
	if (!editorContainer) return;
	const ext = getExtension();
	if (!ext) return;
	promptValue = ext.prompt;
	editor = new EmbeddableMarkdownEditor(plugin.app, editorContainer, {
		value: promptValue,
		placeholder: `Enter instructions for ${ext.displayName}...`,
		cls: "plugin-extension-editor",
		onChange: (value) => {
			promptValue = value;
		},
	});
}

function handleSave() {
	updateExtension({ prompt: promptValue });
	onSave();
	modal.close();
}

function handleResetToDefault() {
	if (hasDefault) {
		const defaultExt = DEFAULT_PLUGIN_EXTENSIONS[pluginId];
		updateExtension({ prompt: defaultExt.prompt });
		promptValue = defaultExt.prompt;
		editor?.setValue(promptValue);
	}
}
</script>

<div class="plugin-extension-modal-content">
	<p class="plugin-extension-description">
		Customize the prompt instructions for the {displayName} plugin.
		{#if !plugin.agentManager.isPluginInstalled(pluginId)}
			<span class="text-[--text-error]">(Plugin not installed)</span>
		{:else if !plugin.agentManager.isPluginEnabled(pluginId)}
			<span class="text-[--text-warning]">(Plugin not enabled)</span>
		{/if}
	</p>
	<div
		bind:this={editorContainer}
		class="plugin-extension-editor-container"
	></div>
	<div class="plugin-extension-actions">
		{#if hasDefault}
			<Button buttonText="Reset to Default" onClick={handleResetToDefault} />
		{/if}
		<div class="flex-1"></div>
		<Button buttonText="Cancel" onClick={() => modal.close()} />
		<Button buttonText="Save" cta={true} onClick={handleSave} />
	</div>
</div>

<style>
	.plugin-extension-modal-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.plugin-extension-description {
		flex-shrink: 0;
		margin: 0 0 12px 0;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	.plugin-extension-editor-container {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		border-radius: 12px;
	}

	.plugin-extension-editor-container :global(.cm-editor) {
		height: 100%;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 12px;
		font-family: var(--font-text);
		font-size: 0.95rem;
	}

	.plugin-extension-editor-container :global(.cm-editor.cm-focused) {
		outline: none;
		border-color: var(--interactive-accent);
		box-shadow: 0 0 0 1px var(--interactive-accent);
	}

	.plugin-extension-editor-container :global(.cm-scroller) {
		padding: 12px 14px;
	}

	.plugin-extension-editor-container :global(.cm-content) {
		min-height: 150px;
		caret-color: var(--text-normal);
	}

	.plugin-extension-editor-container :global(.cm-line) {
		line-height: 1.6;
	}

	.plugin-extension-editor-container :global(.cm-placeholder) {
		color: var(--text-muted);
	}

	.plugin-extension-actions {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 16px;
	}
</style>
