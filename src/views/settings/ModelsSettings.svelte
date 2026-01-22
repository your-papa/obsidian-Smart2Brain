<script lang="ts">
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import ProviderIcon from "../../components/ui/logos/ProviderIcon.svelte";
import type { ChatModelConfig, EmbedModelConfig } from "../../providers/types";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { ChatModelManagementModal } from "../../views/chat-model-management/ChatModelManagement";
import { EmbedModelManagementModal } from "../../views/embed-model-management/EmbedModelManagement";

const data = getData();
const plugin = getPlugin();

let configuredProviders = $derived(data.getConfiguredProviders());

// Helper to check if provider supports generation
function isGenProvider(provider: string): boolean {
	const genProviders: string[] = ["openai", "ollama", "anthropic", "sap-ai-core"];
	return genProviders.includes(provider);
}

// Helper to check if provider supports embedding
function isEmbedProvider(provider: string): boolean {
	const embedProviders: string[] = ["openai", "ollama"];
	return embedProviders.includes(provider);
}

// Get all chat models grouped by provider
let chatModelsByProvider = $derived.by(() => {
	const result: { provider: string; models: Map<string, ChatModelConfig> }[] = [];
	for (const provider of configuredProviders) {
		if (isGenProvider(provider)) {
			const models = data.getGenModels(provider);
			if (models.size > 0) {
				result.push({ provider, models });
			}
		}
	}
	return result;
});

// Get all embed models grouped by provider
let embedModelsByProvider = $derived.by(() => {
	const result: { provider: string; models: Map<string, EmbedModelConfig> }[] = [];
	for (const provider of configuredProviders) {
		if (isEmbedProvider(provider)) {
			const models = data.getEmbedModels(provider);
			if (models.size > 0) {
				result.push({ provider, models });
			}
		}
	}
	return result;
});
</script>

<!-- Chat Models Section -->
<SettingGroup heading="Chat Models">
	{#if chatModelsByProvider.length === 0}
		<SettingItem name="" desc="No chat models configured. Configure a provider first, then add chat models." />
	{:else}
		{#each chatModelsByProvider as { provider, models }}
			<div class="setting-item mod-toggle flex-col items-start gap-2">
				<div class="flex items-center gap-2 w-full">
					<ProviderIcon providerName={provider} size={{ width: 16, height: 16 }} />
					<span class="font-medium">{provider}</span>
					<div class="ml-auto">
						<Button
							buttonText="Manage"
							onClick={() => new ChatModelManagementModal(plugin, provider).open()}
						/>
					</div>
				</div>
				<div class="flex flex-wrap gap-2 w-full">
					{#each models as [modelName, config]}
						<div
							class="px-2 py-1 rounded text-xs bg-[--background-secondary] border border-[--background-modifier-border]"
						>
							<span>{modelName}</span>
							<span class="text-[--text-muted] ml-2">ctx: {config.contextWindow}</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</SettingGroup>

<!-- Embed Models Section -->
<SettingGroup heading="Embedding Models">
	{#if embedModelsByProvider.length === 0}
		<SettingItem
			name=""
			desc="No embedding models configured. Configure a provider first, then add embedding models."
		/>
	{:else}
		{#each embedModelsByProvider as { provider, models }}
			<div class="setting-item mod-toggle flex-col items-start gap-2">
				<div class="flex items-center gap-2 w-full">
					<ProviderIcon providerName={provider} size={{ width: 16, height: 16 }} />
					<span class="font-medium">{provider}</span>
					<div class="ml-auto">
						<Button
							buttonText="Manage"
							onClick={() => new EmbedModelManagementModal(plugin, provider).open()}
						/>
					</div>
				</div>
				<div class="flex flex-wrap gap-2 w-full">
					{#each models as [modelName, config]}
						<div
							class="px-2 py-1 rounded text-xs bg-[--background-secondary] border border-[--background-modifier-border]"
						>
							<span>{modelName}</span>
							<span class="text-[--text-muted] ml-2">threshold: {config.similarityThreshold}</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</SettingGroup>

<!-- Quick Actions -->
{#if configuredProviders.length > 0}
	<SettingGroup heading="Quick Actions">
		<SettingItem name="Add Models" desc="Quickly add models to configured providers">
			<div class="flex gap-2 flex-wrap">
				{#each configuredProviders as provider}
					{#if isGenProvider(provider)}
						<Button
							buttonText={`+ ${provider} Chat`}
							onClick={() => new ChatModelManagementModal(plugin, provider).open()}
						/>
					{/if}
				{/each}
			</div>
		</SettingItem>
	</SettingGroup>
{/if}
