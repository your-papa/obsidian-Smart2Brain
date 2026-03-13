<script lang="ts">
import { Notice } from "obsidian";
import type { Modal } from "obsidian";
import { onMount } from "svelte";
import IconButton from "../ui/IconButton.svelte";
import Button from "../ui/Button.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
import { ModelSelectionModal, type SelectedModel } from "./ModelSelectionModal";
import { getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { isVectorStoreInitialized, getVectorStoreService } from "../../vectorstore";

interface Props {
	modal: Modal;
	purpose: "search" | "graph";
	onSelect: (indexId: string | null) => void;
}

let { modal, purpose, onSelect }: Props = $props();

const pluginData = getData();
const plugin = getPlugin();

const indexes = $derived(pluginData.embeddingIndexes);
const selectedIndexId = $derived(purpose === "search" ? pluginData.searchEmbedIndex : pluginData.graphEmbedIndex);

let storageSizes = $state<Record<string, number>>({});
let documentCounts = $state<Record<string, number>>({});

onMount(async () => {
	if (!isVectorStoreInitialized()) return;
	const service = getVectorStoreService();
	for (const index of pluginData.embeddingIndexes) {
		const [size, stats] = await Promise.all([service.getStorageSize(index.id), service.getStats(index.id)]);
		storageSizes[index.id] = size;
		documentCounts[index.id] = stats.documentCount;
	}
});

function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** i;
	return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function handleSelect(indexId: string) {
	if (indexId === selectedIndexId) return;
	const idx = pluginData.getEmbeddingIndex(indexId);
	if (!idx) return;

	pluginData.setEmbedIndex(purpose, idx.provider, idx.model);

	if (isVectorStoreInitialized()) {
		const service = getVectorStoreService();
		service.ensureIndex(indexId);
	}

	onSelect(indexId);
	modal.close();
}

async function handleDelete(indexId: string) {
	if (!isVectorStoreInitialized()) return;
	const service = getVectorStoreService();
	await service.deleteIndex(indexId);
}

function handleAddModel() {
	let currentSelection: SelectedModel | null = null;
	if (selectedIndexId) {
		const sepIdx = selectedIndexId.indexOf(":");
		if (sepIdx > 0) {
			currentSelection = {
				provider: selectedIndexId.substring(0, sepIdx),
				model: selectedIndexId.substring(sepIdx + 1),
			};
		}
	}

	// Close this modal first to avoid stacked backdrops
	modal.close();

	// Defer opening the next modal to let Obsidian finish tearing down this one
	setTimeout(() => {
		const selectionModal = new ModelSelectionModal(plugin, "embedding", currentSelection, (selected) => {
			if (selected) {
				pluginData.setEmbedIndex(purpose, selected.provider, selected.model);
				const newIndexId = `${selected.provider}:${selected.model}`;

				if (isVectorStoreInitialized()) {
					const service = getVectorStoreService();
					service.ensureIndex(newIndexId);
				}

				onSelect(newIndexId);
			}
		});
		selectionModal.open();
	}, 0);
}

function formatDate(timestamp: number | null): string {
	if (!timestamp) return "Never built";
	return new Date(timestamp).toLocaleDateString();
}

function usedBy(indexId: string): string[] {
	const purposes: string[] = [];
	if (pluginData.searchEmbedIndex === indexId) purposes.push("Search");
	if (pluginData.graphEmbedIndex === indexId) purposes.push("Graph");
	return purposes;
}
</script>

<div class="flex flex-col gap-2 p-4">
  {#if indexes.length === 0}
    <div class="text-[--text-muted] text-sm text-center py-4">
      No embedding indexes yet. Add a model to get started.
    </div>
  {:else}
    {#each indexes as index (index.id)}
      {@const providerDef = getProviderDefinition(
        index.provider,
        pluginData.getAllProviderMeta(),
      )}
      {@const Logo =
        providerDef && "logo" in providerDef && providerDef.logo ? providerDef.logo : GenericAIIcon}
      {@const isSelected = index.id === selectedIndexId}
      {@const purposes = usedBy(index.id)}

      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex items-center gap-3 p-3 rounded-md cursor-pointer border border-solid {isSelected
          ? 'border-[--color-accent] bg-[--background-modifier-hover]'
          : 'border-[--background-modifier-border] hover:bg-[--background-modifier-hover]'}"
        onclick={() => handleSelect(index.id)}
      >
        <!-- Radio indicator -->
        <div
          class="w-4 h-4 rounded-full border-2 border-solid flex-shrink-0 flex items-center justify-center {isSelected
            ? 'border-[--color-accent]'
            : 'border-[--text-muted]'}"
        >
          {#if isSelected}
            <div class="w-2 h-2 rounded-full bg-[--color-accent]"></div>
          {/if}
        </div>

        <!-- Provider logo -->
        <Logo width={18} height={18} />

        <!-- Index info -->
        <div class="flex flex-col flex-1 min-w-0">
          <span class="text-sm font-medium truncate">{index.model}</span>
          <span class="text-xs text-[--text-muted]">
            {providerDef?.displayName ?? index.provider} · {documentCounts[index.id] ??
              index.documentCount} notes · {formatDate(index.lastBuiltAt)}
            {#if storageSizes[index.id]}
              · {formatSize(storageSizes[index.id])}
            {/if}
            {#if purposes.length > 0}
              · Used by: {purposes.join(", ")}
            {/if}
          </span>
        </div>

        <!-- Delete button -->
        <div onclick={(e) => e.stopPropagation()}>
          <IconButton
            icon="trash"
            label="Delete index"
            size="s"
            onclick={() => handleDelete(index.id)}
          />
        </div>
      </div>
    {/each}
  {/if}

  <!-- Add Model button -->
  <div class="flex justify-start pt-2">
    <Button iconId="plus" buttonText="Add Model" onClick={handleAddModel} />
  </div>
</div>
