<script lang="ts">
import SettingContainer from "../../components/Settings/SettingContainer.svelte";
import Button from "../../components/base/Button.svelte";
import ProviderIcon from "../../components/icons/ProviderIcon.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import type {
	EmbedModelConfig,
	EmbedProviders,
	GenModelConfig,
	GenProviders,
	RegisteredProvider,
} from "../../types/providers";
import { ChatModelManagementModal } from "../../views/ChatModelManagement/ChatModelManagement";
import { EmbedModelManagementModal } from "../../views/EmbedModelManagement/EmbedModelManagement";

const data = getData();
const plugin = getPlugin();

let configuredProviders = $derived(data.getConfiguredProviders());

// Helper to check if provider supports generation
function isGenProvider(provider: RegisteredProvider): provider is GenProviders {
	const genProviders: RegisteredProvider[] = ["OpenAI", "CustomOpenAI", "Ollama", "Anthropic"];
	return genProviders.includes(provider);
}

// Helper to check if provider supports embedding
function isEmbedProvider(provider: RegisteredProvider): provider is EmbedProviders {
	const embedProviders: RegisteredProvider[] = ["OpenAI", "CustomOpenAI", "Ollama"];
	return embedProviders.includes(provider);
}

// Get all chat models grouped by provider
let chatModelsByProvider = $derived.by(() => {
	const result: { provider: GenProviders; models: Map<string, GenModelConfig> }[] = [];
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
	const result: { provider: EmbedProviders; models: Map<string, EmbedModelConfig> }[] = [];
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

// Check if any models are configured
let hasAnyModels = $derived(chatModelsByProvider.length > 0 || embedModelsByProvider.length > 0);
</script>

<!-- Chat Models Section -->
<SettingContainer isHeading={true} name="Chat Models" />

{#if chatModelsByProvider.length === 0}
	<div class="setting-item">
		<div class="setting-item-description">
			No chat models configured. Configure a provider first, then add chat models.
		</div>
	</div>
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

<!-- Embed Models Section -->
<SettingContainer isHeading={true} name="Embedding Models" />

{#if embedModelsByProvider.length === 0}
	<div class="setting-item">
		<div class="setting-item-description">
			No embedding models configured. Configure a provider first, then add embedding models.
		</div>
	</div>
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

<!-- Quick Actions -->
{#if configuredProviders.length > 0}
	<SettingContainer isHeading={true} name="Quick Actions" />
	<SettingContainer name="Add Models" desc="Quickly add models to configured providers">
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
	</SettingContainer>
{/if}
