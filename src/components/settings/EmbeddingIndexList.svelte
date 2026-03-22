<script lang="ts">
import { onMount } from "svelte";
import SettingItem from "./SettingItem.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
import { getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { isVectorStoreInitialized, getVectorStoreService } from "../../vectorstore";

const pluginData = getData();

const indexes = $derived(pluginData.embeddingIndexes);

let storageSizes = $state<Record<string, number>>({});

onMount(async () => {
	if (!isVectorStoreInitialized()) return;
	const service = getVectorStoreService();
	for (const index of pluginData.embeddingIndexes) {
		const size = await service.getStorageSize(index.id);
		storageSizes[index.id] = size;
	}
});

function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** i;
	return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function usedBy(indexId: string): string[] {
	const purposes: string[] = [];
	if (pluginData.searchEmbedIndex === indexId) purposes.push("Search");
	if (pluginData.graphEmbedIndex === indexId) purposes.push("Graph");
	return purposes;
}

function formatDate(timestamp: number | null): string {
	if (!timestamp) return "Never built";
	return `Built ${new Date(timestamp).toLocaleDateString()}`;
}
</script>

{#if indexes.length === 0}
  <SettingItem
    name="No indexes"
    desc="No embedding indexes have been created yet. Select an embedding model in Search or Graph settings to get started."
  />
{:else}
  {#each indexes as index (index.id)}
    {@const providerDef = getProviderDefinition(index.provider, pluginData.getAllProviderMeta())}
    {@const Logo =
      providerDef && "logo" in providerDef && providerDef.logo ? providerDef.logo : GenericAIIcon}
    {@const purposes = usedBy(index.id)}
    <SettingItem
      name={index.model}
      desc={[
        `${index.documentCount} notes`,
        storageSizes[index.id] !== undefined ? formatSize(storageSizes[index.id]) : null,
        formatDate(index.lastBuiltAt),
        purposes.length > 0 ? `Used by: ${purposes.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <div class="flex items-center gap-1.5 text-xs text-[--text-muted]">
        <Logo width={14} height={14} />
        <span>{providerDef?.displayName ?? index.provider}</span>
      </div>
    </SettingItem>
  {/each}
{/if}
