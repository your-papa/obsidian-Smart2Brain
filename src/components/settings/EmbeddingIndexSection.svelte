<script lang="ts">
import { onDestroy, untrack } from "svelte";
import { EmbeddingIndexSetupModal } from "../modal/EmbeddingIndexSetupModal";
import { IndexingReportModal } from "../modal/IndexingReportModal";
import ManagedEntityItem from "./ManagedEntityItem.svelte";
import ManagedEntitySection from "./ManagedEntitySection.svelte";
import Badge from "../ui/Badge.svelte";
import Button from "../ui/Button.svelte";
import ProgressBar from "../ui/ProgressBar.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
import { confirmDelete } from "../modal/ConfirmModal";
import { getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { isVectorStoreInitialized, getVectorStoreService, formatEta, type IndexingProgress } from "../../vectorstore";

interface Props {
	/** Which feature this embedding index is for */
	purpose: "search" | "graph";
}

let { purpose }: Props = $props();

const pluginData = getData();
const plugin = getPlugin();

const indexId = $derived(purpose === "search" ? pluginData.searchEmbedIndex : pluginData.graphEmbedIndex);
const indexConfig = $derived(indexId ? pluginData.getEmbeddingIndex(indexId) : null);
// Index progress
let indexProgress = $state<IndexingProgress>({
	isIndexing: false,
	total: 0,
	indexed: 0,
	skipped: 0,
	currentFile: null,
	percentage: 0,
	etaMs: null,
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
			etaMs: null,
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
	const currentSelection = indexConfig
		? {
				provider: indexConfig.provider,
				model: indexConfig.model,
			}
		: null;

	new EmbeddingIndexSetupModal(plugin, {
		purpose,
		currentSelection,
		onSave: (selectedModel, batchSize) => {
			pluginData.setEmbedIndex(purpose, selectedModel.provider, selectedModel.model, {
				batchSize,
			});
			if (isVectorStoreInitialized()) {
				getVectorStoreService().ensureIndex(`${selectedModel.provider}:${selectedModel.model}`);
			}
		},
	}).open();
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
		etaMs: null,
	};
}

function selectIndex(targetIndexId: string) {
	if (targetIndexId === indexId) {
		clearSelectedIndex();
		return;
	}
	const selected = pluginData.getEmbeddingIndex(targetIndexId);
	if (!selected) return;
	pluginData.setEmbedIndex(purpose, selected.provider, selected.model);
	if (isVectorStoreInitialized()) {
		getVectorStoreService().ensureIndex(targetIndexId);
	}
}

async function deleteIndex(targetIndexId: string) {
	if (!isVectorStoreInitialized()) return;
	const entry = indexes.find((e) => e.id === targetIndexId);
	if (!(await confirmDelete(plugin.app, entry?.model ?? targetIndexId))) return;
	await getVectorStoreService().deleteIndex(targetIndexId);
	if (targetIndexId === indexId) {
		indexProgress = {
			isIndexing: false,
			total: 0,
			indexed: 0,
			skipped: 0,
			currentFile: null,
			percentage: 0,
			etaMs: null,
		};
	}
}

function openIndexingReport(targetIndexId: string) {
	const modal = new IndexingReportModal(plugin, targetIndexId);
	modal.open();
}

function cancelIndexing() {
	if (indexId && isVectorStoreInitialized()) {
		getVectorStoreService().cancelIndexing(indexId);
	}
}

async function exportIndex(targetIndexId: string) {
	if (!isVectorStoreInitialized()) return;
	await getVectorStoreService().exportIndex(targetIndexId);
}

async function importFromFile() {
	if (!isVectorStoreInitialized()) return;
	const service = getVectorStoreService();
	const indexId = await service.importIndex();
	if (indexId) {
		const sep = indexId.indexOf(":");
		pluginData.setEmbedIndex(purpose, indexId.slice(0, sep), indexId.slice(sep + 1));
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

function describeCurrentSelection(): string {
	return purpose === "search"
		? "Embedding indexes power semantic search across your notes."
		: "Embedding indexes power semantic graph features across your notes.";
}

function getSelectionGroupLabel(): string {
	return purpose === "search" ? "Search embedding index" : "Graph embedding index";
}
</script>

<ManagedEntitySection
  heading="Embedding Indexes"
  actionsLayout="control"
  description={describeCurrentSelection()}
  emptyMessage="No embedding indexes configured yet."
  hasItems={indexes.length > 0}
>
  {#snippet actions()}
    <div class="flex items-center gap-2 justify-end">
      {#if indexProgress.isIndexing}
        <div class="index-progress-summary">
          <ProgressBar progress={indexProgress.percentage} />
          <span>
            {indexProgress.indexed}/{indexProgress.total}
            {#if indexProgress.skipped > 0}
              ({indexProgress.skipped} skipped)
            {/if}
            {#if indexProgress.etaMs !== null}
              (~{formatEta(indexProgress.etaMs)} left)
            {/if}
          </span>
        </div>
        <Button buttonText="Cancel" onClick={cancelIndexing} />
      {:else}
        <Button
          iconId="upload"
          ariaLabel="Import index from file"
          tooltip="Import index from file"
          onClick={() => void importFromFile()}
        />
        <Button buttonText="Add Index" cta={true} onClick={openAddIndexModal} />
      {/if}
    </div>
  {/snippet}

  {#if indexes.length > 0}
    <div class="embedding-index-list" role="radiogroup" aria-label={getSelectionGroupLabel()}>
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
          class="embedding-index-option"
          name={entry.model}
          meta={[
            entryProviderDef?.displayName ?? entry.provider,
            formatDate(entry.lastBuiltAt),
            `${entry.documentCount} notes indexed`,
          ]
            .filter(Boolean)
            .join(" · ")}
          {selected}
          clickable
          interactiveRole="radio"
          onclick={() => selectIndex(entry.id)}
        >
          {#snippet leading()}
            <EntryLogo width={16} height={16} />
          {/snippet}

          {#snippet badges()}
            {#if usedBy(entry.id).includes("Search")}
              <Badge label="Search" tone="accent" />
            {/if}
            {#if usedBy(entry.id).includes("Graph")}
              <Badge label="Graph" tone="accent" />
            {/if}
          {/snippet}

          {#snippet trailing()}
            <span class:selected class="embedding-index-radio" aria-hidden="true"></span>
          {/snippet}

          {#snippet actions()}
            {#if entry.documentCount > 0}
              <Button
                iconId="list"
                ariaLabel="View indexing report"
                tooltip="View indexing report"
                onClick={() => openIndexingReport(entry.id)}
              />
              <Button
                iconId="download"
                ariaLabel="Export index to file"
                tooltip="Export index to file"
                onClick={() => void exportIndex(entry.id)}
              />
            {/if}
            <Button
              iconId="trash"
              ariaLabel="Delete index"
              tooltip="Delete index"
              onClick={() => void deleteIndex(entry.id)}
            />
          {/snippet}
        </ManagedEntityItem>
      {/each}
    </div>
  {/if}
</ManagedEntitySection>

<style>
  .embedding-index-list {
    display: flex;
    flex-direction: column;
  }

  .embedding-index-radio {
    position: relative;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    border: 1.5px solid var(--background-modifier-border);
    background: var(--background-primary);
    flex-shrink: 0;
    transition:
      border-color 120ms ease,
      background-color 120ms ease,
      box-shadow 120ms ease;
  }

  .embedding-index-radio.selected {
    border-color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--interactive-accent) 14%, transparent);
  }

  .embedding-index-radio.selected::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--interactive-accent);
    transform: translate(-50%, -50%);
  }

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
