<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { IndexingReportModal } from "../modal/IndexingReportModal";
  import { ModelSelectionModal, type SelectedModel } from "../modal/ModelSelectionModal";
  import ManagedEntityItem from "./ManagedEntityItem.svelte";
  import ManagedEntitySection from "./ManagedEntitySection.svelte";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import ProgressBar from "../ui/ProgressBar.svelte";
  import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
  import IconButton from "../ui/IconButton.svelte";
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
  const indexes = $derived(pluginData.embeddingIndexes);

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

  function openAddIndexModal() {
    const currentSelection: SelectedModel | null = indexConfig
      ? {
          provider: indexConfig.provider,
          model: indexConfig.model,
        }
      : null;

    const modal = new ModelSelectionModal(plugin, "embedding", currentSelection, (selected) => {
      if (!selected) return;
      pluginData.setEmbedIndex(purpose, selected.provider, selected.model);
      if (isVectorStoreInitialized()) {
        getVectorStoreService().ensureIndex(`${selected.provider}:${selected.model}`);
      }
    });
    modal.open();
  }

  function clearSelectedIndex() {
    if (!indexId) return;
    pluginData.clearEmbedIndex(purpose);
    indexProgress = {
      isIndexing: false,
      total: 0,
      indexed: 0,
      skipped: 0,
      currentFile: null,
      percentage: 0,
    };
  }

  function selectIndex(targetIndexId: string) {
    const selected = pluginData.getEmbeddingIndex(targetIndexId);
    if (!selected) return;
    pluginData.setEmbedIndex(purpose, selected.provider, selected.model);
    if (isVectorStoreInitialized()) {
      getVectorStoreService().ensureIndex(targetIndexId);
    }
  }

  async function deleteIndex(targetIndexId: string) {
    if (!isVectorStoreInitialized()) return;
    await getVectorStoreService().deleteIndex(targetIndexId);
    if (targetIndexId === indexId) {
      indexProgress = {
        isIndexing: false,
        total: 0,
        indexed: 0,
        skipped: 0,
        currentFile: null,
        percentage: 0,
      };
    }
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

  function formatDate(timestamp: number | null): string {
    if (!timestamp) return "Never built";
    return new Date(timestamp).toLocaleDateString();
  }

  function usedBy(targetIndexId: string): string[] {
    const purposes: string[] = [];
    if (pluginData.searchEmbedIndex === targetIndexId) purposes.push("Search");
    if (pluginData.graphEmbedIndex === targetIndexId) purposes.push("Graph");
    return purposes;
  }

  function describeUsage(targetIndexId: string): string {
    const users = usedBy(targetIndexId);
    if (users.length === 2) return "Shared by Search and Graph";
    if (users.length === 1) return `Used by ${users[0]} only`;
    return "Not assigned to Search or Graph";
  }

  function describeCurrentSelection(): string {
    if (!indexConfig) {
      return purpose === "search"
        ? "No index selected. Semantic search is currently disabled."
        : "No index selected. Semantic graph features are currently disabled.";
    }
    const usage = describeUsage(indexId!);
    return `${indexConfig.model} is the active ${purpose} index. ${usage}.`;
  }
</script>

<ManagedEntitySection
  heading="Embedding Indexes"
  description={purpose === "search"
    ? "Select which configured embedding index powers semantic search. Add a new index from the model picker, then manage selection from the list below."
    : "Select which configured embedding index powers semantic graph features. Add a new index from the model picker, then manage selection from the list below."}
  emptyMessage="No embedding indexes configured yet."
>
  {#snippet actions()}
    <div class="flex items-center gap-2 justify-between">
      <div class="setting-item-description text-sm text-[--text-muted]">
        {describeCurrentSelection()}
      </div>
      <div class="flex items-center gap-2">
        {#if indexProgress.isIndexing}
          <div class="index-progress-summary">
            <ProgressBar progress={indexProgress.percentage} />
            <span>
              {indexProgress.indexed}/{indexProgress.total}
              {#if indexProgress.skipped > 0}
                ({indexProgress.skipped} skipped)
              {/if}
            </span>
          </div>
          <Button buttonText="Cancel" onClick={cancelIndexing} />
        {:else}
          <Button buttonText="Add Index" onClick={openAddIndexModal} />
          {#if indexId}
            <Button
              buttonText={purpose === "search" ? "Disable Search" : "Disable Graph"}
              onClick={clearSelectedIndex}
            />
          {/if}
          {#if indexId && documentCount > 0}
            <IconButton icon="list" label="View indexing report" onclick={openIndexingReport} />
          {/if}
        {/if}
      </div>
    </div>
  {/snippet}

  {#if indexes.length > 0}
    {#each indexes as entry (entry.id)}
      {@const entryProviderDef = getProviderDefinition(
        entry.provider,
        pluginData.getAllProviderMeta(),
      )}
      {@const EntryLogo =
        entryProviderDef && "logo" in entryProviderDef && entryProviderDef.logo
          ? entryProviderDef.logo
          : GenericAIIcon}
      {@const selected = entry.id === indexId}
      <ManagedEntityItem
        name={entry.model}
        desc={`${entry.documentCount} notes indexed`}
        meta={`${entryProviderDef?.displayName ?? entry.provider} · ${formatDate(entry.lastBuiltAt)} · ${describeUsage(entry.id)}`}
        {selected}
      >
        {#snippet leading()}
          <EntryLogo width={16} height={16} />
        {/snippet}

        {#snippet badges()}
          {#if selected}
            <Badge label="Selected" tone="accent" />
          {/if}
          {#if usedBy(entry.id).includes("Search")}
            <Badge label="Search" />
          {/if}
          {#if usedBy(entry.id).includes("Graph")}
            <Badge label="Graph" />
          {/if}
        {/snippet}

        {#snippet actions()}
          {#if !selected}
            <Button
              buttonText={purpose === "search" ? "Use for Search" : "Use for Graph"}
              onClick={() => selectIndex(entry.id)}
            />
          {/if}
          <IconButton
            icon="trash"
            label="Delete index"
            onclick={() => void deleteIndex(entry.id)}
          />
        {/snippet}
      </ManagedEntityItem>
    {/each}
  {/if}
</ManagedEntitySection>

<style>
  .index-progress-summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 220px;
  }

  .index-progress-summary span {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
