<script lang="ts">
import { Notice } from "obsidian";
import { onDestroy, onMount } from "svelte";
import { t } from "svelte-i18n";
import { ExcludeFoldersModal } from "../../components/modal/ExcludeFoldersModal";
import { ModelSelectionModal } from "../../components/modal/ModelSelectionModal";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import ProgressBar from "../../components/ui/ProgressBar.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import { getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import type { SearchAlgorithm } from "../../types/plugin";
import { isVectorStoreInitialized, getVectorStoreService, type IndexingProgress } from "../../vectorstore";

const pluginData = getData();
const plugin = getPlugin();
const fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);

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

onMount(async () => {
	if (isVectorStoreInitialized()) {
		const service = getVectorStoreService();
		indexStats = await service.getStats();
		indexProgress = service.getProgress();
		unsubscribeProgress = service.onProgress((progress) => {
			const wasIndexing = indexProgress.isIndexing;
			indexProgress = progress;
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

async function rebuildIndex() {
	if (!isVectorStoreInitialized()) return;
	const service = getVectorStoreService();
	await service.rebuildIndex();
	indexStats = await service.getStats();
}

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

const hasOpenAICodexEmbeddingConflict = $derived(
	pluginData.defaultEmbedModel?.provider === "openai" && pluginData.isProviderUsingCodexAuth("openai"),
);

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

const searchAlgorithmOptions: {
	display: string;
	value: SearchAlgorithm;
}[] = $derived([
	{ display: $t("settings.search_algorithm.lexical"), value: "lexical" },
	{ display: $t("settings.search_algorithm.hybrid"), value: "hybrid" },
]);

const indexHeading = $derived.by(() => {
	switch (pluginData.searchAlgorithm) {
		case "lexical":
			return "Lexical Index";
		case "hybrid":
			return "Search Index";
		default:
			return "Search Index";
	}
});
</script>

<SettingGroup heading="Search Algorithm">
  <SettingItem
    name={$t("settings.search_algorithm.title")}
    desc={$t("settings.search_algorithm.desc")}
  >
    <Dropdown
      type="options"
      dropdown={searchAlgorithmOptions}
      selected={pluginData.searchAlgorithm}
      onchange={(v) => (pluginData.searchAlgorithm = v)}
    />
  </SettingItem>

  {#if pluginData.searchAlgorithm !== "lexical"}
    <SettingItem
      name="Embedding Model"
      desc="Select the model for semantic search. Required for hybrid search."
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

    {#if hasOpenAICodexEmbeddingConflict}
      <SettingItem
        name="OpenAI embeddings unavailable"
        desc="OpenAI Codex sign-in supports chat only. Switch the embedding model to another provider or use OpenAI API-key auth for RAG."
      />
    {/if}
  {/if}
</SettingGroup>

<SettingGroup heading={indexHeading}>
  {#if pluginData.searchAlgorithm === "lexical"}
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
    <SettingItem
      name="Index Status"
      desc={indexProgress.isIndexing
        ? `Indexing: ${indexProgress.currentFile ?? "..."}`
        : indexStats
          ? `${indexStats.documentCount} semantic + ${indexStats.lexicalDocumentCount} lexical notes indexed${indexStats.modelId ? ` (${indexStats.modelId})` : ""}`
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
      desc="Select an embedding model above to enable semantic search indexing."
    />
  {/if}

  <SettingItem name={$t("settings.excludeff")} desc={$t("settings.excludeff_desc")}>
    <Button onClick={() => fuzzySuggestModel.open()} buttonText="Manage Exclusions" />
  </SettingItem>
</SettingGroup>
