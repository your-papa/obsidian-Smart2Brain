<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { EmbeddingIndexModal } from "../modal/EmbeddingIndexModal";
  import { IndexingReportModal } from "../modal/IndexingReportModal";
  import SettingItem from "./SettingItem.svelte";
  import Button from "../ui/Button.svelte";
  import ProgressBar from "../ui/ProgressBar.svelte";
  import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
  import { getProviderDefinition } from "../../providers/index";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import {
    isVectorStoreInitialized,
    getVectorStoreService,
    type IndexingProgress,
  } from "../../vectorstore";

  interface Props {
    /** Which feature this embedding index is for */
    purpose: "search" | "graph";
  }

  let { purpose }: Props = $props();

  const pluginData = getData();
  const plugin = getPlugin();

  const indexId = $derived(
    purpose === "search" ? pluginData.searchEmbedIndex : pluginData.graphEmbedIndex,
  );
  const indexConfig = $derived(indexId ? pluginData.getEmbeddingIndex(indexId) : null);
  const providerDef = $derived(
    indexConfig
      ? getProviderDefinition(indexConfig.provider, pluginData.getAllProviderMeta())
      : null,
  );
  const Logo = $derived(
    providerDef && "logo" in providerDef && providerDef.logo ? providerDef.logo : GenericAIIcon,
  );
  // Index progress
  let indexProgress = $state<IndexingProgress>({
    isIndexing: false,
    total: 0,
    indexed: 0,
    skipped: 0,
    currentFile: null,
    percentage: 0,
  });

  // Document count derived from reactive pluginData
  const documentCount = $derived(indexConfig?.documentCount ?? 0);

  let unsubscribeProgress: (() => void) | null = null;

  function subscribeToIndex(id: string | null) {
    unsubscribeProgress?.();
    unsubscribeProgress = null;

    if (!id || !isVectorStoreInitialized()) {
      indexProgress = {
        isIndexing: false,
        total: 0,
        indexed: 0,
        skipped: 0,
        currentFile: null,
        percentage: 0,
      };
      return;
    }

    const service = getVectorStoreService();
    indexProgress = service.getProgress(id);
    unsubscribeProgress = service.onProgress((progress) => {
      indexProgress = progress;
    }, id);
  }

  $effect(() => {
    const id = indexId ?? null;
    untrack(() => subscribeToIndex(id));
  });

  onDestroy(() => {
    unsubscribeProgress?.();
  });

  function openEmbeddingIndexModal() {
    const modal = new EmbeddingIndexModal(plugin, purpose, (_indexId) => {
      // Selection handled inside modal via pluginData.setEmbedIndex
    });
    modal.open();
  }

  function openIndexingReport() {
    if (!indexId) return;
    const modal = new IndexingReportModal(plugin, indexId);
    modal.open();
  }

  function cancelIndexing() {
    if (indexId && isVectorStoreInitialized()) {
      getVectorStoreService().cancelIndexing(indexId);
    }
  }
</script>

<SettingItem
  name="Embedding Index"
  desc={indexId
    ? indexProgress.isIndexing
      ? `Indexing: ${indexProgress.currentFile ?? "..."}`
      : documentCount > 0
        ? `${documentCount} notes indexed`
        : "Index not built yet"
    : purpose === "search"
      ? "Semantic search is disabled. Choose an embedding model to enable it."
      : "Semantic graph features are disabled. Choose an embedding model to enable them."}
>
  <div class="flex items-center gap-2">
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
      <Button buttonText="Cancel" onClick={cancelIndexing} />
    {:else}
      {#if indexId && documentCount > 0}
        <Button iconId="list" tooltip="View indexing details" onClick={openIndexingReport} />
      {/if}
      <Button onClick={openEmbeddingIndexModal}>
        {#if indexConfig}
          <div class="flex items-center gap-2">
            <Logo width={14} height={14} />
            <span>{indexConfig.model}</span>
          </div>
        {:else}
          <span class="text-[--text-muted]">No index</span>
        {/if}
      </Button>
    {/if}
  </div>
</SettingItem>
