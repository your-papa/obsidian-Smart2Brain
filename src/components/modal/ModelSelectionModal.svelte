<script lang="ts">
  import { onMount } from "svelte";
  import type SecondBrainPlugin from "../../main";
  import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
  import { getProviderDefinition } from "../../providers/index";
  import {
    fetchModelsDevData,
    lookupModelInfoSync,
    type ModelsDevModelInfo,
  } from "../../providers/modelsDevApi";
  import {
    fetchOpenRouterModels,
    lookupOpenRouterModelSync,
    formatCostPerMillion,
    type OpenRouterModelInfo,
  } from "../../providers/openrouterModels";
  import {
    getOllamaModelsCache,
    lookupOllamaModelSync,
    formatParameterSize,
    type OllamaModelInfo,
  } from "../../providers/ollamaModels";
  import { getData } from "../../stores/dataStore.svelte";
  import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
  import AnthropicLogo from "../ui/logos/AnthropicLogo.svelte";
  import OpenAILogo from "../ui/logos/OpenAILogo.svelte";
  import GoogleLogo from "../ui/logos/GoogleLogo.svelte";
  import MetaLogo from "../ui/logos/MetaLogo.svelte";
  import DeepSeekLogo from "../ui/logos/DeepSeekLogo.svelte";
  import MistralLogo from "../ui/logos/MistralLogo.svelte";
  import QwenLogo from "../ui/logos/QwenLogo.svelte";
  import XAILogo from "../ui/logos/XAILogo.svelte";
  import Icon from "../ui/Icon.svelte";
  import Text from "../ui/Text.svelte";
  import type { ModelSelectionModal, ModelType, SelectedModel } from "./ModelSelectionModal";

  // AI vendor definitions for filtering (excludes routing/local providers like Ollama, OpenRouter)
  const AI_VENDORS = [
    { id: "openai", name: "OpenAI", logo: OpenAILogo },
    { id: "anthropic", name: "Anthropic", logo: AnthropicLogo },
    { id: "google", name: "Google", logo: GoogleLogo },
    { id: "meta-llama", name: "Meta", logo: MetaLogo },
    { id: "deepseek", name: "DeepSeek", logo: DeepSeekLogo },
    { id: "x-ai", name: "xAI", logo: XAILogo },
    { id: "mistralai", name: "Mistral", logo: MistralLogo },
    { id: "qwen", name: "Qwen", logo: QwenLogo },
  ] as const;

  type SimpleModel = { provider: string; model: string };

  // Map Ollama model name patterns to vendors
  const OLLAMA_VENDOR_PATTERNS: [RegExp, string][] = [
    [/^llama/i, "meta-llama"],
    [/^codellama/i, "meta-llama"],
    [/^mistral/i, "mistralai"],
    [/^mixtral/i, "mistralai"],
    [/^codestral/i, "mistralai"],
    [/^gemma/i, "google"],
    [/^deepseek/i, "deepseek"],
    [/^qwen/i, "qwen"],
  ];

  // Extract the AI vendor from a model (for OpenRouter: "openai/gpt-4o" → "openai")
  function extractVendor(model: SimpleModel): string | null {
    // For OpenRouter models, extract from model ID prefix
    if (model.provider === "openrouter" && model.model.includes("/")) {
      return model.model.split("/")[0];
    }
    // For native providers, use the provider ID
    if (["openai", "anthropic"].includes(model.provider)) {
      return model.provider;
    }
    // For Ollama models, try to infer from model name
    if (model.provider === "ollama") {
      for (const [pattern, vendor] of OLLAMA_VENDOR_PATTERNS) {
        if (pattern.test(model.model)) {
          return vendor;
        }
      }
    }
    return null;
  }

  interface Props {
    modal: ModelSelectionModal;
    plugin: SecondBrainPlugin;
    modelType: ModelType;
    currentSelection: SelectedModel | null;
    onSelect: (model: SelectedModel | null) => void;
  }

  const { modal, plugin, modelType, currentSelection, onSelect }: Props = $props();

  const pluginData = getData();
  const availableModels = useAvailableModels();

  let searchQuery = $state("");
  let selectedVendor = $state<string | null>(null);
  let showFavorites = $state(false);
  let modelsDevData = $state<Awaited<ReturnType<typeof fetchModelsDevData>>>(null);
  let openRouterData = $state<Awaited<ReturnType<typeof fetchOpenRouterModels>>>(null);
  let ollamaData = $state<Map<string, OllamaModelInfo> | null>(null);
  let searchInputEl: HTMLInputElement | undefined = $state();

  // Fetch metadata on mount (in parallel)
  onMount(async () => {
    const [modelsDevResult, openRouterResult] = await Promise.all([
      fetchModelsDevData(),
      fetchOpenRouterModels(),
    ]);
    modelsDevData = modelsDevResult;
    openRouterData = openRouterResult;

    // Get Ollama cache (already populated during model discovery)
    const ollamaAuth = pluginData.getResolvedProviderAuth("ollama");
    if (ollamaAuth?.baseUrl) {
      ollamaData = getOllamaModelsCache(ollamaAuth.baseUrl);
    }

    // Focus search input
    searchInputEl?.focus();
  });

  // Get models based on type
  const models = $derived(
    modelType === "chat"
      ? availableModels.availableModels.map((m) => ({
          provider: m.provider,
          model: m.model,
        }))
      : availableModels.availableEmbedModels.map((m) => ({
          provider: m.provider,
          model: m.model,
        })),
  );

  // Group models by provider
  const modelsByProvider = $derived.by(() => {
    const grouped = new Map<string, { provider: string; model: string }[]>();

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
      const vendor = extractVendor(model);
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
          models: models.filter((m) => pluginData.isFavoriteModel(m.provider, m.model)),
        }))
        .filter(({ models }) => models.length > 0);
    }

    // Filter by vendor if one is selected
    if (selectedVendor) {
      result = result
        .map(({ provider, models }) => ({
          provider,
          models: models.filter((m) => extractVendor(m) === selectedVendor),
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
              m.model.toLowerCase().includes(query) ||
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

  // Get unified model metadata - OpenRouter API for OpenRouter, Ollama for Ollama, models.dev for others
  type UnifiedModelInfo = {
    name?: string;
    contextLength?: number;
    inputCost?: string;
    outputCost?: string;
    supportsToolCalls?: boolean;
    supportsVision?: boolean;
    supportsReasoning?: boolean;
    supportsStructuredOutput?: boolean;
    // Ollama-specific fields
    parameterSize?: string;
    quantization?: string;
  };

  function getModelInfo(providerId: string, modelId: string): UnifiedModelInfo | null {
    // For OpenRouter, use the native API data (more comprehensive)
    if (providerId === "openrouter" && openRouterData) {
      const orInfo = lookupOpenRouterModelSync(openRouterData, modelId);
      if (orInfo) {
        return {
          name: orInfo.name,
          contextLength: orInfo.context_length,
          inputCost: orInfo.pricing?.prompt,
          outputCost: orInfo.pricing?.completion,
          supportsToolCalls: orInfo.supports_tool_calls,
          supportsVision: orInfo.supports_vision,
          supportsReasoning: orInfo.supports_reasoning,
          supportsStructuredOutput: orInfo.supports_structured_output,
        };
      }
    }

    // For Ollama, use the local API data
    if (providerId === "ollama" && ollamaData) {
      const olInfo = lookupOllamaModelSync(ollamaData, modelId);
      if (olInfo) {
        return {
          name: olInfo.name,
          contextLength: olInfo.contextLength,
          supportsToolCalls: olInfo.supportsTools,
          supportsVision: olInfo.supportsVision,
          parameterSize: olInfo.parameterSize,
          quantization: olInfo.quantization,
        };
      }
    }

    // Fallback to models.dev for other providers
    if (!modelsDevData) return null;
    const mdInfo = lookupModelInfoSync(modelsDevData, providerId, modelId);
    if (mdInfo) {
      return {
        name: mdInfo.name,
        contextLength: mdInfo.limit?.context,
        // models.dev uses per-million pricing, convert back for consistency
        inputCost:
          mdInfo.cost?.input !== undefined ? String(mdInfo.cost.input / 1_000_000) : undefined,
        outputCost:
          mdInfo.cost?.output !== undefined ? String(mdInfo.cost.output / 1_000_000) : undefined,
        supportsToolCalls: mdInfo.tool_call,
        supportsVision: mdInfo.attachment,
        supportsReasoning: mdInfo.reasoning,
        supportsStructuredOutput: mdInfo.structured_output,
      };
    }
    return null;
  }

  // Format cost using OpenRouter's per-token format
  function formatCost(costPerToken?: string): string {
    return formatCostPerMillion(costPerToken);
  }

  // Format context window size
  function formatContextWindow(context?: number): string {
    if (!context) return "—";
    if (context >= 1_000_000) {
      return `${(context / 1_000_000).toFixed(1)}M`;
    }
    if (context >= 1_000) {
      return `${Math.round(context / 1_000)}K`;
    }
    return context.toString();
  }

  // Check if model is currently selected
  function isSelected(provider: string, model: string): boolean {
    return currentSelection?.provider === provider && currentSelection?.model === model;
  }

  // Handle model selection
  function handleSelect(provider: string, model: string) {
    onSelect({ provider, model });
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
              {#each models as { provider: p, model } (`${p}::${model}`)}
                {@const info = getModelInfo(p, model)}
                {@const isFavorite = pluginData.isFavoriteModel(p, model)}
                <div
                  role="button"
                  tabindex="0"
                  class="model-card"
                  class:selected={isSelected(p, model)}
                  onclick={() => handleSelect(p, model)}
                  onkeydown={(e) => e.key === "Enter" && handleSelect(p, model)}
                >
                  <div class="model-main">
                    <div class="model-info">
                      <div class="model-name">{model}</div>
                      {#if info?.name && info.name !== model}
                        <div class="model-description">{info.name}</div>
                      {/if}
                    </div>
                    <div class="model-actions">
                      <button
                        type="button"
                        class="favorite-btn"
                        class:is-favorite={isFavorite}
                        onclick={(e) => {
                          e.stopPropagation();
                          pluginData.toggleFavoriteModel(p, model);
                        }}
                        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                      >
                        <Icon name="star" size="sm" />
                      </button>
                      {#if isSelected(p, model)}
                        <span class="check-icon">✓</span>
                      {/if}
                    </div>
                  </div>

                  <!-- Metadata row -->
                  <div class="model-meta">
                    <!-- Context window -->
                    <span class="meta-tag" title="Context window">
                      {formatContextWindow(info?.contextLength)} ctx
                    </span>

                    <!-- Ollama-specific: Parameter size and quantization -->
                    {#if info?.parameterSize}
                      <span class="meta-tag" title="Parameter size">
                        {formatParameterSize(info.parameterSize)}
                      </span>
                    {/if}
                    {#if info?.quantization}
                      <span class="meta-tag" title="Quantization level">
                        {info.quantization}
                      </span>
                    {/if}

                    <!-- Cost (not applicable for local models) -->
                    {#if info?.inputCost !== undefined || info?.outputCost !== undefined}
                      <span class="meta-tag" title="Cost per 1M tokens (in/out)">
                        {formatCost(info?.inputCost)}/{formatCost(info?.outputCost)}
                      </span>
                    {/if}

                    <!-- Capabilities -->
                    {#if info?.supportsToolCalls}
                      <span class="meta-tag capability" title="Tool calling">Tools</span>
                    {/if}
                    {#if info?.supportsReasoning}
                      <span class="meta-tag capability" title="Reasoning">Reasoning</span>
                    {/if}
                    {#if info?.supportsVision}
                      <span class="meta-tag capability" title="Vision/Attachments">Vision</span>
                    {/if}
                    {#if info?.supportsStructuredOutput}
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
