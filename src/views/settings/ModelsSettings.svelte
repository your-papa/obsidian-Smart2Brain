<script lang="ts">
import type { Component } from "svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import { getProviderDefinition, isEmbeddingProvider } from "../../providers/index";
import type { ChatModelConfig, EmbedModelConfig, LogoProps } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { ChatModelManagementModal } from "../../views/chat-model-management/ChatModelManagement";
import { EmbedModelManagementModal } from "../../views/embed-model-management/EmbedModelManagement";

const data = getData();
const plugin = getPlugin();

// Helper to get logo for a provider
function getProviderLogo(providerId: string): Component<LogoProps> {
	const provider = getProviderDefinition(providerId, data.getAllCustomProviderMeta());
	if (provider && "logo" in provider && provider.logo) {
		return provider.logo;
	}
	return GenericAIIcon;
}

// Helper to get display name for a provider
function getProviderDisplayName(providerId: string): string {
	const provider = getProviderDefinition(providerId, data.getAllCustomProviderMeta());
	return provider?.displayName ?? providerId;
}

let configuredProviders = $derived(data.getConfiguredProviders());

// Helper to check if provider supports generation (all providers support chat)
function isGenProvider(providerId: string): boolean {
	return getProviderDefinition(providerId, data.getAllCustomProviderMeta()) !== undefined;
}

// Helper to check if provider supports embedding
function isEmbedProvider(providerId: string): boolean {
	const provider = getProviderDefinition(providerId, data.getAllCustomProviderMeta());
	if (!provider) return false;
	return isEmbeddingProvider(provider);
}

// Get all chat models grouped by provider
let chatModelsByProvider = $derived.by(() => {
	const result: { provider: string; models: Record<string, ChatModelConfig> }[] = [];
	for (const provider of configuredProviders) {
		if (isGenProvider(provider)) {
			const models = data.getGenModels(provider);
			if (Object.keys(models).length > 0) {
				result.push({ provider, models });
			}
		}
	}
	return result;
});

// Get all embed models grouped by provider
let embedModelsByProvider = $derived.by(() => {
	const result: { provider: string; models: Record<string, EmbedModelConfig> }[] = [];
	for (const provider of configuredProviders) {
		if (isEmbedProvider(provider)) {
			const models = data.getEmbedModels(provider);
			if (Object.keys(models).length > 0) {
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
			{@const Logo = getProviderLogo(provider)}
			{@const displayName = getProviderDisplayName(provider)}
			<div class="setting-item mod-toggle flex-col items-start gap-2">
				<div class="flex items-center gap-2 w-full">
					<Logo width={16} height={16} />
					<span class="font-medium">{displayName}</span>
					<div class="ml-auto">
						<Button
							buttonText="Manage"
							onClick={() => new ChatModelManagementModal(plugin, provider).open()}
						/>
					</div>
				</div>
				<div class="flex flex-wrap gap-2 w-full">
					{#each Object.entries(models) as [modelName, config]}
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
			{@const Logo = getProviderLogo(provider)}
			{@const displayName = getProviderDisplayName(provider)}
			<div class="setting-item mod-toggle flex-col items-start gap-2">
				<div class="flex items-center gap-2 w-full">
					<Logo width={16} height={16} />
					<span class="font-medium">{displayName}</span>
					<div class="ml-auto">
						<Button
							buttonText="Manage"
							onClick={() => new EmbedModelManagementModal(plugin, provider).open()}
						/>
					</div>
				</div>
				<div class="flex flex-wrap gap-2 w-full">
					{#each Object.entries(models) as [modelName, config]}
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
							buttonText={`+ ${getProviderDisplayName(provider)} Chat`}
							onClick={() => new ChatModelManagementModal(plugin, provider).open()}
						/>
					{/if}
				{/each}
			</div>
		</SettingItem>
	</SettingGroup>
{/if}
