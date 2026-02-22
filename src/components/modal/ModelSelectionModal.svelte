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
  import Icon from "../ui/Icon.svelte";
  import Text from "../ui/Text.svelte";
  import type { ModelSelectionModal, ModelType, SelectedModel } from "./ModelSelectionModal";

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

  // Filter models by search query
  const filteredModelsByProvider = $derived.by(() => {
    if (!searchQuery.trim()) {
      return modelsByProvider;
    }

    const query = searchQuery.toLowerCase();
    return modelsByProvider
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
  <!-- Search -->
  <div class="model-search">
    <Icon name="search" size="sm" />
    <input
      bind:this={searchInputEl}
      type="text"
      placeholder={modelType === "chat" ? "Search chat models..." : "Search embedding models..."}
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
                {#if isSelected(p, model)}
                  <span class="check-icon">✓</span>
                {/if}
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
        {#if searchQuery}
          No models match "{searchQuery}"
        {:else if modelType === "embedding"}
          No embedding models available. Configure a provider that supports embeddings.
        {:else}
          No models available. Configure a provider first.
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .model-selection-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 12px;
    padding: 16px;
    overflow: hidden;
    box-sizing: border-box;
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

  .no-models {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: var(--text-muted);
    font-style: italic;
  }
</style>
