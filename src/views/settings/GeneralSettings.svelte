<script lang="ts">
import { Notice, type TFolder } from "obsidian";
import { t } from "svelte-i18n";
import { ExcludeFoldersModal } from "../../components/modal/ExcludeFoldersModal";
import FolderSuggest from "../../components/modal/FolderSuggest.svelte";
import { PluginExtensionModal } from "../../components/modal/PluginExtensionModal";
import { SystemPromptModal } from "../../components/modal/SystemPromptModal";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import Icon from "../../components/ui/Icon.svelte";
import IconButton from "../../components/ui/IconButton.svelte";
import SearchableDropdown from "../../components/ui/SearchableDropdown.svelte";
import Text from "../../components/ui/Text.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import type { SearchAlgorithm } from "../../main";
import { getProviderDefinition } from "../../providers/index";
import type { ChatModel } from "../../stores/chatStore.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const pluginData = getData();
const plugin = getPlugin();
const models = useAvailableModels();

let fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);
let systemPromptModal = new SystemPromptModal(plugin);

// Plugin extensions - reactive list
const pluginExtensions = $derived(Object.values(pluginData.pluginPromptExtensions));

function openExtensionModal(pluginId: string) {
	const modal = new PluginExtensionModal(plugin, pluginId, () => {
		plugin.agentManager?.updateSystemPrompt();
	});
	modal.open();
}

function toggleExtension(pluginId: string, newEnabled: boolean) {
	const installed = plugin.agentManager?.isPluginInstalled(pluginId) ?? false;
	const enabled = plugin.agentManager?.isPluginEnabled(pluginId) ?? false;
	const ext = pluginData.getPluginExtension(pluginId);
	const displayName = ext?.displayName ?? pluginId;

	if (!installed) {
		new Notice(`Please install the ${displayName} plugin first.`);
		return;
	}
	if (!enabled) {
		new Notice(`Please enable the ${displayName} plugin in Obsidian settings first.`);
		return;
	}

	pluginData.setPluginExtensionEnabled(pluginId, newEnabled);
	plugin.agentManager?.updateSystemPrompt();
}

function isPluginInstalled(pluginId: string): boolean {
	return plugin.agentManager?.isPluginInstalled(pluginId) ?? false;
}

function isPluginEnabled(pluginId: string): boolean {
	return plugin.agentManager?.isPluginEnabled(pluginId) ?? false;
}

function openPluginPage(pluginId: string) {
	// math-latex is built-in, no plugin page
	if (pluginId === "math-latex") return;
	// Open the community plugins page for this plugin
	window.open(`obsidian://show-plugin?id=${pluginId}`);
}

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

// Helper to get provider ID from model value
function getProviderId(value: string): string {
	const opt = models.modelOptions.find((o) => o.value === value);
	return opt?.chatModel.provider ?? "";
}
</script>

<!-- Chat Settings -->
<SettingGroup heading="Chat Settings">
	<SettingItem
		name="Chats Folder"
		desc="Folder to store chat files and related data"
	>
		<FolderSuggest
			app={plugin.app}
			value={pluginData.targetFolder}
			placeholder="Chats"
			suggestionFn={(q) =>
				suggestFolders().filter((f) =>
					f.path.toLowerCase().includes(q.toLowerCase()),
				)}
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

	<SettingItem
		name="Default Chat Model"
		desc="Model selected by default for new chats"
	>
		{#if !models.hasProviders || !models.hasModels}
			<Button
				onClick={models.openSettings}
				buttonText={!models.hasProviders
					? "Configure Provider"
					: "Configure Models"}
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
				{@const providerDef = getProviderDefinition(group, pluginData.getAllCustomProviderMeta())}
				{@const Logo = (providerDef && "logo" in providerDef && providerDef.logo) ? providerDef.logo : GenericAIIcon}
				<div class="flex items-center gap-2">
					<Logo width={12} height={12} class="text-[--text-muted]" />
					<span>{providerDef?.displayName ?? group}</span>
				</div>
			{/snippet}

			{#snippet renderOption({ option, selected })}
				<span class="flex-1">{option.label}</span>
				{#if selected}
					<Icon
						name="check"
						size="xs"
						class="text-[--text-accent]"
					/>
				{/if}
			{/snippet}

			{#snippet renderSelected({ option })}
				{@const providerId = getProviderId(option.value)}
				{@const providerDef = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta())}
				{@const Logo = (providerDef && "logo" in providerDef && providerDef.logo) ? providerDef.logo : GenericAIIcon}
				<Logo width={14} height={14} />
				<span>{option.label}</span>
			{/snippet}
			</SearchableDropdown>
		{/if}
	</SettingItem>

	<SettingItem
		name="System Prompt"
		desc="Customize the base system instructions used for every chat."
	>
		<Button
			buttonText="Edit Base Prompt"
			onClick={() => systemPromptModal.open()}
		/>
	</SettingItem>
</SettingGroup>

<!-- Plugin Extensions -->
<SettingGroup heading="Plugin Extensions">
	<div class="setting-item-description mb-3">
		Plugin-specific instructions are appended to your base prompt when the
		plugin is installed and enabled.
	</div>
	{#each pluginExtensions as ext (ext.pluginId)}
		{@const installed = isPluginInstalled(ext.pluginId)}
		{@const enabled = isPluginEnabled(ext.pluginId)}
		<div class="plugin-extension-item">
			<div class="plugin-extension-info">
				<div class="plugin-extension-header">
					<span class="plugin-extension-name">{ext.displayName}</span>
					{#if !installed}
						<button
							class="plugin-extension-badge not-installed clickable"
							onclick={() => openPluginPage(ext.pluginId)}
							title="Click to install"
						>
							Not installed
						</button>
					{:else if !enabled}
						<button
							class="plugin-extension-badge not-enabled clickable"
							onclick={() => openPluginPage(ext.pluginId)}
							title="Click to enable"
						>
							Not enabled
						</button>
					{/if}
				</div>
			</div>
			<div class="plugin-extension-controls">
				<Toggle
					isToggled={ext.enabled && enabled}
					changeFunc={() =>
						toggleExtension(ext.pluginId, !ext.enabled)}
				/>
				<IconButton
					icon="pencil"
					label="Edit {ext.displayName} prompt"
					onclick={() => openExtensionModal(ext.pluginId)}
				/>
			</div>
		</div>
	{/each}
</SettingGroup>

<!-- RAG Settings -->
<SettingGroup heading="RAG Settings">
	<SettingItem
		name={$t("settings.search_algorithm.title")}
		desc={$t("settings.search_algorithm.desc")}
	>
		<Dropdown
			type="options"
			dropdown={searchAlgorithmOptions}
			selected={selectedSearchAlgorithm}
			onSelect={handleSearchAlgorithmChange}
		/>
	</SettingItem>

	<SettingItem
		name={$t("settings.autostart")}
		desc={$t("settings.autostart_desc")}
	>
		<Toggle
			isToggled={pluginData.isAutostart}
			changeFunc={() => pluginData.toggleAutostart()}
		/>
	</SettingItem>

	<SettingItem name="File Indexing" desc={$t("settings.excludeff_desc")}>
		<Button
			onClick={() => fuzzySuggestModel.open()}
			buttonText="Manage Exclusions"
		/>
	</SettingItem>

	<SettingItem
		name={$t("settings.num_docs_retrieve")}
		desc={$t("settings.num_docs_retrieve_desc")}
	>
		<Text
			inputType="number"
			value={100}
			onchange={(docNum) => console.log("Not set up")}
		/>
	</SettingItem>
</SettingGroup>

<style>
	.plugin-extension-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 0;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.plugin-extension-item:last-child {
		border-bottom: none;
	}

	.plugin-extension-info {
		flex: 1;
	}

	.plugin-extension-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.plugin-extension-name {
		font-weight: 500;
	}

	.plugin-extension-badge {
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		font-weight: 500;
	}

	.plugin-extension-badge.not-enabled,
	.plugin-extension-badge.not-installed {
		background: var(--background-modifier-border);
		color: var(--text-muted);
	}

	.plugin-extension-badge.clickable {
		cursor: pointer;
		border: none;
		transition: opacity 0.15s ease;
	}

	.plugin-extension-badge.clickable:hover {
		opacity: 0.8;
		text-decoration: underline;
	}

	.plugin-extension-controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}
</style>
