<script lang="ts">
import { Notice } from "obsidian";
import { onMount, onDestroy } from "svelte";
import { t } from "svelte-i18n";
import { ExcludeFoldersModal } from "../../components/modal/ExcludeFoldersModal";
import { ModelSelectionModal } from "../../components/modal/ModelSelectionModal";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import ProgressBar from "../../components/ui/ProgressBar.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import type { SearchAlgorithm } from "../../main";
import { getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { isVectorStoreInitialized, getVectorStoreService, type IndexingProgress } from "../../vectorstore";

const pluginData = getData();
const plugin = getPlugin();

const fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);

// Index status state
let indexStats = $state<{
	documentCount: number;
	lexicalDocumentCount: number;
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
			const wasIndexing = indexProgress.isIndexing;
			indexProgress = progress;
			// Refresh stats when indexing completes
			if (!progress.isIndexing && wasIndexing) {
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

// Get display info for current embedding model
const currentEmbedModelDisplay = $derived.by(() => {
	if (!pluginData.defaultEmbedModel) return null;
	const provider = pluginData.defaultEmbedModel.provider;
	const model = pluginData.defaultEmbedModel.model;
	const providerDef = getProviderDefinition(provider, pluginData.getAllCustomProviderMeta());
	return {
		model,
		providerName: providerDef?.displayName ?? provider,
		logo: providerDef && "logo" in providerDef && providerDef.logo ? providerDef.logo : GenericAIIcon,
	};
});

function openEmbedModelSelectionModal() {
	const currentSelection = pluginData.defaultEmbedModel
		? {
				provider: pluginData.defaultEmbedModel.provider,
				model: pluginData.defaultEmbedModel.model,
			}
		: null;

	const modal = new ModelSelectionModal(plugin, "embedding", currentSelection, (selected) => {
		if (selected) {
			const isNewModel =
				!currentSelection ||
				currentSelection.provider !== selected.provider ||
				currentSelection.model !== selected.model;

			pluginData.defaultEmbedModel = { provider: selected.provider, model: selected.model };

			if (isNewModel) {
				new Notice("Embedding model changed. Rebuild the index for the new model to take effect.", 8000);
			}
		}
	});
	modal.open();
}

// Check if embeddings are configured
const isEmbeddingsConfigured = $derived(pluginData.defaultEmbedModel !== null);

// Search algorithm options
const searchAlgorithmOptions: {
	display: string;
	value: SearchAlgorithm;
	disabled?: boolean;
}[] = $derived([
	{ display: $t("settings.search_algorithm.lexical"), value: "lexical" },
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

// Dynamic index heading based on selected algorithm
const indexHeading = $derived.by(() => {
	switch (pluginData.searchAlgorithm) {
		case "lexical":
			return "Lexical Index";
		case "embeddings":
			return "Semantic Index";
		case "hybrid":
			return "Search Index";
		default:
			return "Search Index";
	}
});
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

  <!-- Embedding Model (only shown when semantic search is needed) -->
  {#if pluginData.searchAlgorithm !== "lexical"}
    <SettingItem
      name="Embedding Model"
      desc="Select the model for semantic search. Required for Embeddings and Hybrid search algorithms."
    >
      <Button onClick={openEmbedModelSelectionModal}>
        {#if currentEmbedModelDisplay}
          {@const Logo = currentEmbedModelDisplay.logo}
          <div class="flex items-center gap-2">
            <Logo width={14} height={14} />
            <span>{currentEmbedModelDisplay.model}</span>
          </div>
        {:else}
          <span class="text-[--text-muted]">Select embedding model</span>
        {/if}
      </Button>
    </SettingItem>
  {/if}
</SettingGroup>

<!-- Index Section -->
<SettingGroup heading={indexHeading}>
  {#if pluginData.searchAlgorithm === "lexical"}
    <!-- Lexical only: show lexical index stats -->
    <SettingItem
      name="Index Status"
      desc={indexProgress.isIndexing
        ? `Indexing: ${indexProgress.currentFile ?? "..."}`
        : indexStats
          ? `${indexStats.lexicalDocumentCount} notes indexed`
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
        <Button
          buttonText="Rebuild Index"
          onClick={rebuildIndex}
          disabled={!isVectorStoreInitialized()}
        />
      {/if}
    </SettingItem>
  {:else if pluginData.defaultEmbedModel}
    <!-- Semantic or Hybrid: show semantic index stats -->
    <SettingItem
      name="Index Status"
      desc={indexProgress.isIndexing
        ? `Indexing: ${indexProgress.currentFile ?? "..."}`
        : indexStats
          ? pluginData.searchAlgorithm === "hybrid"
            ? `${indexStats.documentCount} semantic + ${indexStats.lexicalDocumentCount} lexical notes indexed${indexStats.modelId ? ` (${indexStats.modelId})` : ""}`
            : `${indexStats.documentCount} notes indexed${indexStats.modelId ? ` using ${indexStats.modelId}` : ""}`
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
      desc="Configure a default embedding model to enable semantic search."
    />
  {/if}

  <SettingItem name={$t("settings.excludeff")} desc={$t("settings.excludeff_desc")}>
    <Button onClick={() => fuzzySuggestModel.open()} buttonText="Manage Exclusions" />
  </SettingItem>
</SettingGroup>
