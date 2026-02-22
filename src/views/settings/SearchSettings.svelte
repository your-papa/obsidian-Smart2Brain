<script lang="ts">
import { onMount, onDestroy } from "svelte";
import type { TFolder } from "obsidian";
import { t } from "svelte-i18n";
import type { Component } from "svelte";
import { ExcludeFoldersModal } from "../../components/modal/ExcludeFoldersModal";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import ProgressBar from "../../components/ui/ProgressBar.svelte";
import Text from "../../components/ui/Text.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import type { SearchAlgorithm } from "../../main";
import { getProviderDefinition, isEmbeddingProvider } from "../../providers/index";
import type { EmbedModelConfig, LogoProps } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { isVectorStoreInitialized, getVectorStoreService, type IndexingProgress } from "../../vectorstore";

const pluginData = getData();
const plugin = getPlugin();

const fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);

// Check if Omnisearch is installed
// @ts-ignore - Obsidian plugin API
const isOmnisearchInstalled = $derived(!!plugin.app.plugins?.getPlugin?.("omnisearch"));

// Index status state
let indexStats = $state<{
	documentCount: number;
	providerId: string | null;
	modelId: string | null;
	isReady: boolean;
} | null>(null);

let indexProgress = $state<IndexingProgress>({
	isIndexing: false,
	total: 0,
	indexed: 0,
	skipped: 0,
	currentFile: null,
	percentage: 0,
});

let unsubscribeProgress: (() => void) | null = null;

// Load index stats and subscribe to progress updates
onMount(async () => {
	if (isVectorStoreInitialized()) {
		const service = getVectorStoreService();
		indexStats = await service.getStats();
		indexProgress = service.getProgress();
		unsubscribeProgress = service.onProgress((progress) => {
			indexProgress = progress;
			// Refresh stats when indexing completes
			if (!progress.isIndexing && indexProgress.isIndexing) {
				service.getStats().then((stats) => {
					indexStats = stats;
				});
			}
		});
	}
});

onDestroy(() => {
	unsubscribeProgress?.();
});

// Rebuild the index
async function rebuildIndex() {
	if (!isVectorStoreInitialized()) return;
	const service = getVectorStoreService();
	await service.rebuildIndex();
	indexStats = await service.getStats();
}

// Helper to get logo for a provider
function getProviderLogo(providerId: string): Component<LogoProps> {
	const provider = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta());
	if (provider && "logo" in provider && provider.logo) {
		return provider.logo;
	}
	return GenericAIIcon;
}

// Helper to get display name for a provider
function getProviderDisplayName(providerId: string): string {
	const provider = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta());
	return provider?.displayName ?? providerId;
}

const configuredProviders = $derived(pluginData.getConfiguredProviders());

// Helper to check if provider supports embedding
function isEmbedProvider(providerId: string): boolean {
	const provider = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta());
	if (!provider) return false;
	return isEmbeddingProvider(provider);
}

// Get all embed models grouped by provider
const embedModelsByProvider = $derived.by(() => {
	const result: { provider: string; models: Record<string, EmbedModelConfig> }[] = [];
	for (const provider of configuredProviders) {
		if (isEmbedProvider(provider)) {
			const models = pluginData.getEmbedModels(provider);
			if (Object.keys(models).length > 0) {
				result.push({ provider, models });
			}
		}
	}
	return result;
});

// Build dropdown options for default embed model selection (grouped by provider)
const embedModelDropdownGroups = $derived.by(() => {
	const groups: { label: string; options: { display: string; value: string }[] }[] = [];

	// Add "None" option as first group
	groups.push({
		label: "Default",
		options: [{ display: "None (disable semantic search)", value: "" }],
	});

	for (const { provider, models } of embedModelsByProvider) {
		const displayName = getProviderDisplayName(provider);
		const options = Object.keys(models).map((modelId) => ({
			display: modelId,
			value: `${provider}::${modelId}`,
		}));
		if (options.length > 0) {
			groups.push({ label: displayName, options });
		}
	}

	return groups;
});

// Current default embed model as a serialized string "provider::model" or ""
const defaultEmbedModelValue = $derived(
	pluginData.defaultEmbedModel
		? `${pluginData.defaultEmbedModel.provider}::${pluginData.defaultEmbedModel.model}`
		: "",
);

function handleDefaultEmbedModelChange(value: string) {
	if (!value) {
		pluginData.defaultEmbedModel = null;
	} else {
		const [provider, model] = value.split("::");
		if (provider && model) {
			pluginData.defaultEmbedModel = { provider, model };
		}
	}
}

// Check if embeddings are configured
const isEmbeddingsConfigured = $derived(pluginData.defaultEmbedModel !== null);

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
		display: isEmbeddingsConfigured
			? $t("settings.search_algorithm.embeddings")
			: $t("settings.search_algorithm.embeddings_not_configured"),
		value: "embeddings",
		disabled: !isEmbeddingsConfigured,
	},
	{
		display: isEmbeddingsConfigured
			? $t("settings.search_algorithm.hybrid")
			: $t("settings.search_algorithm.hybrid_not_configured"),
		value: "hybrid",
		disabled: !isEmbeddingsConfigured,
	},
]);
</script>

<!-- Search Algorithm -->
<SettingGroup heading="Search Algorithm">
  <SettingItem
    name={$t("settings.search_algorithm.title")}
    desc={$t("settings.search_algorithm.desc")}
  >
    <Dropdown
      type="options"
      dropdown={searchAlgorithmOptions}
      selected={pluginData.searchAlgorithm}
      onSelect={(v) => (pluginData.searchAlgorithm = v)}
    />
  </SettingItem>

  <SettingItem name={$t("settings.num_docs_retrieve")} desc={$t("settings.num_docs_retrieve_desc")}>
    <Text
      inputType="number"
      value={pluginData.retrieveTopK}
      onchange={(val) => (pluginData.retrieveTopK = Number(val))}
    />
  </SettingItem>
</SettingGroup>

<!-- Embedding Model -->
<SettingGroup heading="Embedding Model">
  <SettingItem
    name="Default Embedding Model"
    desc="Select the model for semantic search. Required for Embeddings and Hybrid search algorithms."
  >
    <Dropdown
      type="groups"
      dropdown={embedModelDropdownGroups}
      selected={defaultEmbedModelValue}
      onSelect={handleDefaultEmbedModelChange}
    />
  </SettingItem>
</SettingGroup>

<!-- Vector Index -->
<SettingGroup heading="Vector Index">
  {#if pluginData.defaultEmbedModel}
    <SettingItem
      name="Index Status"
      desc={indexProgress.isIndexing
        ? `Indexing: ${indexProgress.currentFile ?? "..."}`
        : indexStats
          ? `${indexStats.documentCount} notes indexed${indexStats.modelId ? ` using ${indexStats.modelId}` : ""}`
          : "Index not loaded"}
    >
      {#if indexProgress.isIndexing}
        <div class="flex flex-col gap-2 min-w-[200px]">
          <ProgressBar progress={indexProgress.percentage} />
          <span class="text-xs text-[--text-muted]">
            {indexProgress.indexed}/{indexProgress.total}
            {#if indexProgress.skipped > 0}
              ({indexProgress.skipped} skipped)
            {/if}
          </span>
        </div>
      {:else}
        <Button buttonText="Rebuild Index" onClick={rebuildIndex} disabled={!indexStats?.isReady} />
      {/if}
    </SettingItem>
  {:else}
    <SettingItem
      name="Index Status"
      desc="Configure a default embedding model to enable the vector index."
    />
  {/if}

  <SettingItem name={$t("settings.excludeff")} desc={$t("settings.excludeff_desc")}>
    <Button onClick={() => fuzzySuggestModel.open()} buttonText="Manage Exclusions" />
  </SettingItem>
</SettingGroup>
