<script lang="ts">
import { onMount } from "svelte";
import { t } from "svelte-i18n";
import type SecondBrainPlugin from "../../main";
import type { BuiltInToolId, SearchAlgorithm, ToolConfig } from "../../main";
import { DEFAULT_TOOLS_CONFIG, getData } from "../../stores/dataStore.svelte";
import Button from "../ui/Button.svelte";
import Dropdown from "../ui/Dropdown.svelte";
import Text from "../ui/Text.svelte";
import TextArea from "../ui/TextArea.svelte";
import type { ToolConfigModal } from "./ToolConfigModal";

interface Props {
	modal: ToolConfigModal;
	plugin: SecondBrainPlugin;
	toolId: BuiltInToolId;
	onSave: () => void;
}

const { modal, plugin, toolId, onSave }: Props = $props();
const pluginData = getData();

// Get current tool config
const toolConfig = $derived(pluginData.getToolConfig(toolId));
const defaultConfig = DEFAULT_TOOLS_CONFIG[toolId];

// Editable state
let name = $state(toolConfig?.name ?? defaultConfig.name);
let description = $state(toolConfig?.description ?? defaultConfig.description);

// Tool-specific settings
let searchAlgorithm = $state<SearchAlgorithm>(
	(toolConfig?.settings as { algorithm?: SearchAlgorithm })?.algorithm ??
		(defaultConfig.settings as { algorithm?: SearchAlgorithm })?.algorithm ??
		"grep",
);
let maxResults = $state(
	(toolConfig?.settings as { maxResults?: number })?.maxResults ??
		(defaultConfig.settings as { maxResults?: number })?.maxResults ??
		10,
);
let maxContentLength = $state(
	(toolConfig?.settings as { maxContentLength?: number })?.maxContentLength ??
		(defaultConfig.settings as { maxContentLength?: number })?.maxContentLength ??
		0,
);
let includeMetadata = $state(
	(toolConfig?.settings as { includeMetadata?: boolean })?.includeMetadata ??
		(defaultConfig.settings as { includeMetadata?: boolean })?.includeMetadata ??
		true,
);

// Check if Omnisearch plugin is installed
const isOmnisearchInstalled = $derived(
	// @ts-ignore - Obsidian plugin API
	!!plugin.app.plugins?.getPlugin?.("omnisearch"),
);

// Search algorithm options
const searchAlgorithmOptions: {
	display: string;
	value: SearchAlgorithm;
	disabled?: boolean;
}[] = $derived([
	{ display: $t("settings.search_algorithm.grep"), value: "grep" },
	{
		display: isOmnisearchInstalled
			? $t("settings.search_algorithm.omnisearch")
			: $t("settings.search_algorithm.omnisearch_not_installed"),
		value: "omnisearch",
		disabled: !isOmnisearchInstalled,
	},
	{
		display: $t("settings.search_algorithm.embeddings"),
		value: "embeddings",
		disabled: true,
	},
]);

// Tool display names for the modal title
const toolDisplayNames: Record<BuiltInToolId, string> = {
	search_notes: "Search Notes",
	read_note: "Read Note",
	get_all_tags: "Get All Tags",
	get_properties: "Get Properties",
	execute_dataview_query: "Execute Dataview Query",
};

onMount(() => {
	modal.setTitle(`Configure: ${toolDisplayNames[toolId]}`);
});

function handleSave() {
	// Build updated config
	const updatedConfig: Partial<ToolConfig> = {
		name,
		description,
	};

	// Add tool-specific settings
	if (toolId === "search_notes") {
		updatedConfig.settings = {
			algorithm: searchAlgorithm,
			maxResults,
		};
	} else if (toolId === "read_note") {
		updatedConfig.settings = {
			maxContentLength,
		};
	} else if (toolId === "execute_dataview_query") {
		updatedConfig.settings = {
			includeMetadata,
		};
	}

	pluginData.updateToolConfig(toolId, updatedConfig);
	onSave();
	modal.close();
}

function handleResetToDefault() {
	name = defaultConfig.name;
	description = defaultConfig.description;

	if (toolId === "search_notes" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { algorithm: SearchAlgorithm; maxResults: number };
		searchAlgorithm = settings.algorithm;
		maxResults = settings.maxResults;
	} else if (toolId === "read_note" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { maxContentLength: number };
		maxContentLength = settings.maxContentLength;
	} else if (toolId === "execute_dataview_query" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { includeMetadata: boolean };
		includeMetadata = settings.includeMetadata;
	}
}
</script>

<div class="tool-config-modal-content">
	<!-- Tool Name -->
	<div class="tool-config-field">
		<label class="tool-config-label">Tool Name</label>
		<p class="tool-config-description">The name the AI agent sees for this tool. Use snake_case.</p>
		<Text
			inputType="text"
			value={name}
			placeholder={defaultConfig.name}
			onblur={(v) => (name = v)}
		/>
	</div>

	<!-- Tool Description -->
	<div class="tool-config-field">
		<label class="tool-config-label">Tool Description</label>
		<p class="tool-config-description">Describe what the tool does. The AI uses this to decide when to use the tool.</p>
		<TextArea
			class="w-full h-24"
			value={description}
			placeholder={defaultConfig.description}
			onblur={(v) => (description = v)}
		/>
	</div>

	<!-- Tool-specific settings -->
	{#if toolId === "search_notes"}
		<div class="tool-config-section">
			<h4 class="tool-config-section-title">Search Settings</h4>

			<div class="tool-config-field">
				<label class="tool-config-label">{$t("settings.search_algorithm.title")}</label>
				<p class="tool-config-description">{$t("settings.search_algorithm.desc")}</p>
				<Dropdown
					type="options"
					dropdown={searchAlgorithmOptions}
					selected={searchAlgorithm}
					onSelect={(v) => (searchAlgorithm = v)}
				/>
			</div>

			<div class="tool-config-field">
				<label class="tool-config-label">Max Results</label>
				<p class="tool-config-description">Maximum number of search results to return.</p>
				<Text
					inputType="number"
					value={maxResults}
					placeholder="10"
					onblur={(v) => (maxResults = Number.parseInt(String(v)) || 10)}
				/>
			</div>
		</div>
	{:else if toolId === "read_note"}
		<div class="tool-config-section">
			<h4 class="tool-config-section-title">Read Settings</h4>

			<div class="tool-config-field">
				<label class="tool-config-label">Max Content Length</label>
				<p class="tool-config-description">Maximum characters to return. Set to 0 for unlimited.</p>
				<Text
					inputType="number"
					value={maxContentLength}
					placeholder="0"
					onblur={(v) => (maxContentLength = Number.parseInt(String(v)) || 0)}
				/>
			</div>
		</div>
	{:else if toolId === "execute_dataview_query"}
		<div class="tool-config-section">
			<h4 class="tool-config-section-title">Dataview Settings</h4>

			<div class="tool-config-field">
				<label class="tool-config-label">Include Metadata</label>
				<p class="tool-config-description">Include file metadata in query results.</p>
				<input
					type="checkbox"
					checked={includeMetadata}
					onchange={(e) => (includeMetadata = e.currentTarget.checked)}
				/>
			</div>
		</div>
	{/if}

	<!-- Actions -->
	<div class="tool-config-actions">
		<Button buttonText="Reset to Default" onClick={handleResetToDefault} />
		<div class="flex-1"></div>
		<Button buttonText="Cancel" onClick={() => modal.close()} />
		<Button buttonText="Save" cta={true} onClick={handleSave} />
	</div>
</div>

<style>
	.tool-config-modal-content {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 8px 0;
	}

	.tool-config-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.tool-config-label {
		font-weight: 500;
		font-size: 0.95rem;
	}

	.tool-config-description {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin: 0 0 4px 0;
	}

	.tool-config-section {
		border-top: 1px solid var(--background-modifier-border);
		padding-top: 16px;
	}

	.tool-config-section-title {
		font-weight: 600;
		font-size: 0.9rem;
		margin: 0 0 12px 0;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.tool-config-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		border-top: 1px solid var(--background-modifier-border);
		padding-top: 16px;
		margin-top: 8px;
	}
</style>
