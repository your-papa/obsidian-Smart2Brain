<script lang="ts">
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import { extractVendor, logUnclassifiedModelsInfo } from "../../lib/modelVendorClassification";
import type { HydratedChatModelMetadata, HydratedEmbeddingModelMetadata } from "../../types/modelMetadata";
import { getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
import AnthropicLogo from "../ui/logos/AnthropicLogo.svelte";
import OpenAILogo from "../ui/logos/OpenAILogo.svelte";
import GoogleLogo from "../ui/logos/GoogleLogo.svelte";
import MicrosoftLogo from "../ui/logos/MicrosoftLogo.svelte";
import MetaLogo from "../ui/logos/MetaLogo.svelte";
import DeepSeekLogo from "../ui/logos/DeepSeekLogo.svelte";
import MistralLogo from "../ui/logos/MistralLogo.svelte";
import QwenLogo from "../ui/logos/QwenLogo.svelte";
import XAILogo from "../ui/logos/XAILogo.svelte";
import Icon from "../ui/Icon.svelte";
import type { ModelSelectionModal, ModelType, SelectedModel } from "./ModelSelectionModal";

// AI vendor definitions for filtering (excludes routing/local providers like Ollama, OpenRouter)
const AI_VENDORS = [
	{ id: "openai", name: "OpenAI", logo: OpenAILogo },
	{ id: "anthropic", name: "Anthropic", logo: AnthropicLogo },
	{ id: "google", name: "Google", logo: GoogleLogo },
	{ id: "microsoft", name: "Microsoft", logo: MicrosoftLogo },
	{ id: "meta-llama", name: "Meta", logo: MetaLogo },
	{ id: "deepseek", name: "DeepSeek", logo: DeepSeekLogo },
	{ id: "x-ai", name: "xAI", logo: XAILogo },
	{ id: "mistralai", name: "Mistral", logo: MistralLogo },
	{ id: "qwen", name: "Qwen", logo: QwenLogo },
] as const;

interface Props {
	modal: ModelSelectionModal;
	modelType: ModelType;
	currentSelection: SelectedModel | null;
	onSelect: (model: SelectedModel | null) => void;
}

const { modal, modelType, currentSelection, onSelect }: Props = $props();

const pluginData = getData();
const availableModels = useAvailableModels();
const openRouterModels = $derived(availableModels.openRouterModels);

let searchQuery = $state("");
let selectedVendor = $state<string | null>(null);
let showFavorites = $state(false);
let searchInputEl: HTMLInputElement | undefined = $state();

type HydratedModel = HydratedChatModelMetadata | HydratedEmbeddingModelMetadata;

// Get hydrated models based on type
const models = $derived(
	modelType === "chat" ? availableModels.hydratedChatModels : availableModels.hydratedEmbeddingModels,
);

function toClassifiableModel(model: HydratedModel): {
	provider: string;
	model: string;
	family?: string;
	families?: string[];
} {
	if (model.provider !== "ollama") {
		return { provider: model.provider, model: model.variantKey };
	}
	const families = availableModels.getOllamaModelFamilies(model.variantKey);
	return {
		provider: model.provider,
		model: model.variantKey,
		family: families[0],
		families,
	};
}

const classifiableModels = $derived(models.map((model) => toClassifiableModel(model)));

$effect(() => {
	logUnclassifiedModelsInfo("model-selection-modal", classifiableModels, openRouterModels);
});

$effect(() => {
	searchInputEl?.focus();
});

// Group models by provider
const modelsByProvider = $derived.by(() => {
	const grouped = new Map<string, HydratedModel[]>();

	for (const model of models) {
		const existing = grouped.get(model.provider) ?? [];
		existing.push(model);
		grouped.set(model.provider, existing);
	}

	return Array.from(grouped.entries()).map(([provider, models]) => ({
		provider,
		models,
	}));
});

// Get available vendors based on current models
const availableVendors = $derived.by(() => {
	const vendorSet = new Set<string>();
	for (const model of models) {
		const vendor = extractVendor(toClassifiableModel(model), openRouterModels);
		if (vendor) vendorSet.add(vendor);
	}
	return AI_VENDORS.filter((v) => vendorSet.has(v.id));
});

// Filter models by search query, vendor, and favorites
const filteredModelsByProvider = $derived.by(() => {
	let result = modelsByProvider;

	// Filter by favorites if selected
	if (showFavorites) {
		result = result
			.map(({ provider, models }) => ({
				provider,
				models: models.filter((m) => pluginData.isFavoriteModel(m.provider, m.variantKey)),
			}))
			.filter(({ models }) => models.length > 0);
	}

	// Filter by vendor if one is selected
	if (selectedVendor) {
		result = result
			.map(({ provider, models }) => ({
				provider,
				models: models.filter(
					(m) => extractVendor(toClassifiableModel(m), openRouterModels) === selectedVendor,
				),
			}))
			.filter(({ models }) => models.length > 0);
	}

	// Filter by search query
	if (searchQuery.trim()) {
		const query = searchQuery.toLowerCase();
		result = result
			.map(({ provider, models }) => ({
				provider,
				models: models.filter(
					(m) =>
						m.displayName.toLowerCase().includes(query) ||
						m.variantKey.toLowerCase().includes(query) ||
						provider.toLowerCase().includes(query) ||
						getProviderDisplayName(provider).toLowerCase().includes(query),
				),
			}))
			.filter(({ models }) => models.length > 0);
	}

	return result;
});

// Get provider info
function getProviderDisplayName(providerId: string): string {
	const provider = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta());
	return provider?.displayName ?? providerId;
}

function getProviderLogo(providerId: string) {
	const provider = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta());
	if (provider && "logo" in provider && provider.logo) {
		return provider.logo;
	}
	return GenericAIIcon;
}

// Format cost (per 1M tokens)
function formatCost(costPer1M?: number): string {
	if (costPer1M === undefined) return "—";
	if (costPer1M === 0) return "Free";
	if (costPer1M < 0.01) return `$${costPer1M.toFixed(4)}`;
	if (costPer1M < 1) return `$${costPer1M.toFixed(2)}`;
	return `$${costPer1M.toFixed(2)}`;
}

function formatTokenLimit(tokens?: number): string {
	if (!tokens) return "—";
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		return `${Math.round(tokens / 1_000)}K`;
	}
	return tokens.toString();
}

function getVariantKeyDisplay(model: HydratedModel): string {
	if (model.provider === "ollama") {
		return model.variantKey.replace(/:latest$/i, "");
	}
	return model.variantKey;
}

// Check if model is currently selected
function isSelected(provider: string, variantKey: string): boolean {
	return currentSelection?.provider === provider && currentSelection?.model === variantKey;
}

// Handle model selection
function handleSelect(provider: string, variantKey: string) {
	onSelect({ provider, model: variantKey });
}
</script>

<div class="model-selection-container">
  <div class="model-selection-layout">
    <!-- Vendor filter sidebar -->
    {#if availableVendors.length > 0}
      <div class="vendor-sidebar">
        <!-- Favorites button -->
        <button
          type="button"
          class="vendor-btn"
          class:active={showFavorites}
          onclick={() => {
            showFavorites = !showFavorites;
            if (showFavorites) selectedVendor = null;
          }}
          title="Favorites"
        >
          <Icon name="star" size="md" />
        </button>

        <div class="vendor-divider"></div>

        <!-- Vendor icons -->
        {#each availableVendors as vendor (vendor.id)}
          {@const VendorLogo = vendor.logo}
          <button
            type="button"
            class="vendor-btn"
            class:active={selectedVendor === vendor.id}
            onclick={() => {
              showFavorites = false;
              selectedVendor = selectedVendor === vendor.id ? null : vendor.id;
            }}
            title={vendor.name}
          >
            <VendorLogo width={38} height={38} />
          </button>
        {/each}
      </div>
    {/if}

    <!-- Main content -->
    <div class="model-selection-main">
      <!-- Search -->
      <div class="model-search">
        <Icon name="search" size="sm" />
        <input
          bind:this={searchInputEl}
          type="text"
          placeholder={modelType === "chat"
            ? "Search chat models..."
            : "Search embedding models..."}
          bind:value={searchQuery}
          class="search-input"
        />
        {#if searchQuery}
          <button type="button" class="clear-search" onclick={() => (searchQuery = "")}>
            <Icon name="x" size="xs" />
          </button>
        {/if}
      </div>

      <!-- Models list -->
      <div class="models-list">
        {#each filteredModelsByProvider as { provider, models } (provider)}
          {@const Logo = getProviderLogo(provider)}
          <div class="provider-group">
            <div class="provider-header">
              <Logo width={16} height={16} />
              <span>{getProviderDisplayName(provider)}</span>
            </div>

            <div class="provider-models">
              {#each models as model (`${model.provider}::${model.variantKey}`)}
                {@const isFavorite = pluginData.isFavoriteModel(model.provider, model.variantKey)}
                <div
                  role="button"
                  tabindex="0"
                  class="model-card"
                  class:selected={isSelected(model.provider, model.variantKey)}
                  onclick={() => handleSelect(model.provider, model.variantKey)}
                  onkeydown={(e) => e.key === "Enter" && handleSelect(model.provider, model.variantKey)}
                >
                  <div class="model-main">
                    <div class="model-info">
                      <div class="model-name">{model.displayName}</div>
                      {#if model.displayName !== getVariantKeyDisplay(model)}
                        <div class="model-description">{getVariantKeyDisplay(model)}</div>
                      {/if}
                    </div>
                    <div class="model-actions">
                      <button
                        type="button"
                        class="favorite-btn"
                        class:is-favorite={isFavorite}
                        onclick={(e) => {
                          e.stopPropagation();
                          pluginData.toggleFavoriteModel(model.provider, model.variantKey);
                        }}
                        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                      >
                        <Icon name="star" size="sm" />
                      </button>
                      {#if isSelected(model.provider, model.variantKey)}
                        <span class="check-icon">✓</span>
                      {/if}
                    </div>
                  </div>

                  <!-- Metadata row -->
                  <div class="model-meta">
                    {#if model.kind === "chat"}
                      <span class="meta-tag" title="Context window">
                        {formatTokenLimit(model.contextWindow)} ctx
                      </span>
                    {:else}
                      <span class="meta-tag" title="Max input tokens">
                        {formatTokenLimit(model.maxInputTokens)} max input
                      </span>
                    {/if}

                    {#if model.paramSize}
                      <span class="meta-tag" title="Parameter size">
                        {model.paramSize}
                      </span>
                    {/if}
                    {#if model.quantization}
                      <span class="meta-tag" title="Quantization level">
                        {model.quantization}
                      </span>
                    {/if}

                    {#if model.kind === "chat" && (model.pricing?.inputUsdPer1M !== undefined || model.pricing?.outputUsdPer1M !== undefined)}
                      <span class="meta-tag" title="Cost per 1M tokens (in/out)">
                        {formatCost(model.pricing?.inputUsdPer1M)}/{formatCost(model.pricing?.outputUsdPer1M)}
                      </span>
                    {/if}

                    {#if model.kind === "embedding" && model.pricing?.inputUsdPer1M !== undefined}
                      <span class="meta-tag" title="Cost per 1M input tokens">
                        {formatCost(model.pricing.inputUsdPer1M)}
                      </span>
                    {/if}

                    {#if model.kind === "chat" && model.capabilities.toolCalls}
                      <span class="meta-tag capability" title="Tool calling">Tools</span>
                    {/if}
                    {#if model.kind === "chat" && model.capabilities.reasoning}
                      <span class="meta-tag capability" title="Reasoning">Reasoning</span>
                    {/if}
                    {#if model.kind === "chat" && model.capabilities.vision}
                      <span class="meta-tag capability" title="Vision/Attachments">Vision</span>
                    {/if}
                    {#if model.kind === "chat" && model.capabilities.structuredOutput}
                      <span class="meta-tag capability" title="Structured output">JSON</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <div class="no-models">
            {#if showFavorites}
              No favorite models yet. Click the star on any model to add it.
            {:else if searchQuery || selectedVendor}
              No models match your filters
            {:else if modelType === "embedding"}
              No embedding models available. Configure a provider that supports embeddings.
            {:else}
              No models available. Configure a provider first.
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .model-selection-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    box-sizing: border-box;
  }

  .model-selection-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .vendor-sidebar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 8px;
    border-right: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    overflow-y: auto;
  }

  .vendor-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    background: transparent;
    color: var(--text-muted);
  }

  .vendor-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .vendor-btn.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .vendor-divider {
    width: 100%;
    height: 1px;
    background: var(--background-modifier-border);
    margin: 4px 0;
  }

  .model-selection-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 12px;
    padding: 16px;
    overflow: hidden;
  }

  .model-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--background-secondary);
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
  }

  .model-search:focus-within {
    border-color: var(--interactive-accent);
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-normal);
    font-size: 14px;
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .clear-search {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .clear-search:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .models-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 8px;
  }

  .provider-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .provider-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 0 4px;
  }

  .provider-models {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .model-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    margin: 0;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
  }

  .model-card:hover {
    background: var(--background-modifier-hover);
    border-color: var(--interactive-accent-hover);
  }

  .model-card.selected {
    background: color-mix(in srgb, var(--interactive-accent) 15%, transparent);
    border-color: var(--interactive-accent);
  }

  .model-main {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    width: 100%;
    height: auto;
  }

  .model-info {
    flex: 1;
    min-width: 0;
    height: auto;
  }

  .model-name {
    font-weight: 500;
    font-size: 14px;
    color: var(--text-normal);
  }

  .model-description {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .model-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--background-modifier-border);
    height: auto;
  }

  .meta-tag {
    display: inline-block;
    padding: 3px 8px;
    font-size: 11px;
    line-height: 1.2;
    background: var(--background-primary);
    border-radius: 4px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .meta-tag.capability {
    background: color-mix(in srgb, var(--interactive-accent) 15%, transparent);
    color: var(--text-accent);
  }

  .check-icon {
    color: var(--text-accent);
    font-weight: bold;
  }

  .model-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .favorite-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .favorite-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-muted);
  }

  .favorite-btn.is-favorite {
    color: var(--text-accent);
  }

  .favorite-btn.is-favorite:hover {
    color: var(--text-accent);
  }

  .no-models {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: var(--text-muted);
    font-style: italic;
  }
</style>
