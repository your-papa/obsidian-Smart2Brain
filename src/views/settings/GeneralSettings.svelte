<script lang="ts">
import { AnthropicLogo, OllamaLogo, OpenAILogo } from "@selemondev/svgl-svelte";
import type { TFolder } from "obsidian";
import { t } from "svelte-i18n";
import { ExcludeFoldersModal } from "../../components/modal/ExcludeFoldersModal";
import FolderSuggest from "../../components/modal/FolderSuggest.svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import Icon from "../../components/ui/Icon.svelte";
import SearchableDropdown from "../../components/ui/SearchableDropdown.svelte";
import Text from "../../components/ui/Text.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import type { SearchAlgorithm } from "../../main";
import type { ChatModel } from "../../stores/chatStore.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const pluginData = getData();
const plugin = getPlugin();
const models = useAvailableModels();

let fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);

function suggestFolders(): TFolder[] {
	return plugin.app.vault.getAllFolders(true);
}

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

// Use $derived to read from store - no local state sync needed
let selectedSearchAlgorithm = $derived(pluginData.searchAlgorithm);

// Handle search algorithm change with validation
function handleSearchAlgorithmChange(value: SearchAlgorithm) {
	if (value === "omnisearch" && !isOmnisearchInstalled) {
		console.warn("Omnisearch selected but plugin not available, switching to grep");
		pluginData.searchAlgorithm = "grep";
		return;
	}
	pluginData.searchAlgorithm = value;
}

// Model dropdown options - grouped by provider
const modelOptions = $derived(
	models.modelOptions.map((opt) => ({
		label: opt.label,
		value: opt.value,
		group: opt.chatModel.provider,
		chatModel: opt.chatModel,
	})),
);

// Track selected model value
let selectedModelValue = $state<string>("");

// Initialize from stored default chat model
let _initialized = $state(false);
$effect(() => {
	if (_initialized) return;
	const opts = models.modelOptions;
	if (!opts.length) return;

	const sel = pluginData.getDefaultChatModel();
	if (sel) {
		const key = `${sel.provider}:${sel.model}`;
		if (opts.some((o) => o.value === key)) {
			selectedModelValue = key;
			_initialized = true;
			return;
		}
	}
	selectedModelValue = opts[0].value;
	pluginData.setDefaultChatModel(opts[0].chatModel as ChatModel);
	_initialized = true;
});

function handleModelSelect(value: string) {
	selectedModelValue = value;
	const opt = models.modelOptions.find((o) => o.value === value);
	if (opt) pluginData.setDefaultChatModel(opt.chatModel as ChatModel);
}

// Helper to get provider from value
function getProvider(value: string): string {
	const opt = models.modelOptions.find((o) => o.value === value);
	return opt?.chatModel.provider ?? "";
}
</script>

<!-- Chat Settings -->
<SettingGroup heading="Chat Settings">
	<SettingItem name="Chats Folder" desc="Folder to store chat files and related data">
		<FolderSuggest
			app={plugin.app}
			value={pluginData.targetFolder}
			placeholder="Chats"
			suggestionFn={(q) =>
				suggestFolders().filter((f) => f.path.toLowerCase().includes(q.toLowerCase()))}
			onSelected={(path: string) => (pluginData.targetFolder = path)}
			onSubmit={(path: string) => (pluginData.targetFolder = path)}
		/>
	</SettingItem>

	<SettingItem name="Chat Name" desc="Default name for new chats">
		<Text
			inputType="text"
			placeholder="New Chat"
			value={pluginData.defaultChatName}
			onblur={(value: string) => (pluginData.defaultChatName = value)}
		/>
	</SettingItem>

	<SettingItem
		name="Generate Chat Title"
		desc="Automatically generate chat title based on the first message (uses API)"
	>
		<Toggle
			isToggled={pluginData.isGeneratingChatTitle}
			changeFunc={() => pluginData.toggleGeneratingChatTitle()}
		/>
	</SettingItem>

	<SettingItem name="Default Chat Model" desc="Model selected by default for new chats">
		{#if !models.hasProviders || !models.hasModels}
			<Button
				onClick={models.openSettings}
				buttonText={!models.hasProviders ? "Configure Provider" : "Configure Models"}
				iconId="settings"
			/>
		{:else}
			<SearchableDropdown
				options={modelOptions}
				selected={selectedModelValue}
				onSelect={handleModelSelect}
				placeholder="Select a model"
				searchPlaceholder="Search models..."
			>
				{#snippet renderGroupHeader({ group })}
					<div class="flex items-center gap-2">
						{#if group === "OpenAI"}
							<OpenAILogo style="fill: var(--text-muted)" height={12} width={12} />
						{:else if group === "Anthropic"}
							<AnthropicLogo style="fill: var(--text-muted)" height={12} width={12} />
						{:else if group === "Ollama"}
							<OllamaLogo style="fill: var(--text-muted)" height={12} width={12} />
						{:else}
							<Icon name="sparkles" size="xs" class="text-[--text-muted]" />
						{/if}
						<span>{group}</span>
					</div>
				{/snippet}

				{#snippet renderOption({ option, selected })}
					<span class="flex-1">{option.label}</span>
					{#if selected}
						<Icon name="check" size="xs" class="text-[--text-accent]" />
					{/if}
				{/snippet}

				{#snippet renderSelected({ option })}
					{@const provider = getProvider(option.value)}
					{#if provider === "OpenAI"}
						<OpenAILogo style="fill: var(--text-normal)" height={14} width={14} />
					{:else if provider === "Anthropic"}
						<AnthropicLogo style="fill: var(--text-normal)" height={14} width={14} />
					{:else if provider === "Ollama"}
						<OllamaLogo style="fill: var(--text-normal)" height={14} width={14} />
					{:else}
						<Icon name="sparkles" size="xs" />
					{/if}
					<span>{option.label}</span>
				{/snippet}
			</SearchableDropdown>
		{/if}
	</SettingItem>
</SettingGroup>

<!-- RAG Settings -->
<SettingGroup heading="RAG Settings">
	<SettingItem name={$t("settings.search_algorithm.title")} desc={$t("settings.search_algorithm.desc")}>
		<Dropdown
			type="options"
			dropdown={searchAlgorithmOptions}
			selected={selectedSearchAlgorithm}
			onSelect={handleSearchAlgorithmChange}
		/>
	</SettingItem>

	<SettingItem name={$t("settings.autostart")} desc={$t("settings.autostart_desc")}>
		<Toggle isToggled={pluginData.isAutostart} changeFunc={() => pluginData.toggleAutostart()} />
	</SettingItem>

	<SettingItem name="File Indexing" desc={$t("settings.excludeff_desc")}>
		<Button onClick={() => fuzzySuggestModel.open()} buttonText="Manage Exclusions" />
	</SettingItem>

	<SettingItem name={$t("settings.num_docs_retrieve")} desc={$t("settings.num_docs_retrieve_desc")}>
		<Text inputType="number" value={100} onchange={(docNum) => console.log("Not set up")} />
	</SettingItem>
</SettingGroup>
