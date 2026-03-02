<script lang="ts">
  import { Popover } from "bits-ui";
  import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
  import { getProviderDefinition } from "../../providers/index";
  import type { ChatModel } from "../../stores/chatStore.svelte";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { Logger } from "../../utils/logging";
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

  const data = getData();
  const plugin = getPlugin();
  const models = useAvailableModels();

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
  function extractVendor(model: ChatModel): string | null {
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

  // Get the selected agent reactively
  const selectedAgent = $derived(data.getSelectedAgent());

  // Derive the effective selected model from the selected agent
  const selectedModel = $derived.by(() => {
    const list = models.availableModels;
    const agentModel = selectedAgent?.chatModel;

    if (agentModel && list.length > 0) {
      const found = list.find(
        (m: ChatModel) => m.provider === agentModel.provider && m.model === agentModel.model,
      );
      if (found) return found;
    }

    return list.length > 0 ? list[0] : null;
  });

  // Update the agent's model when user selects a different one
  function selectModel(model: ChatModel) {
    const agentId = data.selectedAgentId;
    data.updateAgent(agentId, { chatModel: model });
    plugin.agentManager?.reinitialize().catch((error) => {
      Logger.error("Failed to update agent model:", error);
    });
  }

  let isOpen = $state(false);
  let searchQuery = $state("");
  let selectedVendor = $state<string | null>(null);
  let showFavorites = $state(false);
  let customAnchor: HTMLElement | undefined = $state();
  let searchInputEl: HTMLInputElement | undefined = $state();
  let vendorSidebarEl: HTMLDivElement | undefined = $state();
  let canScrollDown = $state(false);

  // Check if vendor sidebar can scroll down
  function updateScrollIndicator() {
    if (vendorSidebarEl) {
      const { scrollTop, scrollHeight, clientHeight } = vendorSidebarEl;
      canScrollDown = scrollHeight > clientHeight && scrollTop + clientHeight < scrollHeight - 5;
    }
  }

  // Reset search and filter when popover opens
  $effect(() => {
    if (isOpen) {
      searchQuery = "";
      selectedVendor = null;
      showFavorites = false;
      // Focus search input after popover fully renders (needs delay for bits-ui)
      setTimeout(() => {
        searchInputEl?.focus();
        updateScrollIndicator();
      }, 50);
    }
  });

  // Get available vendors based on current models
  const availableVendors = $derived.by(() => {
    const vendorSet = new Set<string>();
    for (const model of models.availableModels) {
      const vendor = extractVendor(model);
      if (vendor) vendorSet.add(vendor);
    }
    return AI_VENDORS.filter((v) => vendorSet.has(v.id));
  });

  // Group models by provider
  const modelsByProvider = $derived.by(() => {
    const grouped = new Map<string, ChatModel[]>();

    for (const model of models.availableModels) {
      const existing = grouped.get(model.provider) ?? [];
      existing.push(model);
      grouped.set(model.provider, existing);
    }

    return Array.from(grouped.entries()).map(([provider, providerModels]) => ({
      provider,
      models: providerModels,
    }));
  });

  // Filter models by search query, vendor, and favorites
  const filteredModelsByProvider = $derived.by(() => {
    let result = modelsByProvider;

    // Filter by favorites if selected
    if (showFavorites) {
      result = result
        .map(({ provider, models: providerModels }) => ({
          provider,
          models: providerModels.filter((m) => data.isFavoriteModel(m.provider, m.model)),
        }))
        .filter(({ models: providerModels }) => providerModels.length > 0);
    }

    // Filter by vendor if one is selected
    if (selectedVendor) {
      result = result
        .map(({ provider, models: providerModels }) => ({
          provider,
          models: providerModels.filter((m) => extractVendor(m) === selectedVendor),
        }))
        .filter(({ models: providerModels }) => providerModels.length > 0);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result
        .map(({ provider, models: providerModels }) => ({
          provider,
          models: providerModels.filter(
            (m) =>
              m.model.toLowerCase().includes(query) ||
              provider.toLowerCase().includes(query) ||
              getProviderDisplayName(provider).toLowerCase().includes(query),
          ),
        }))
        .filter(({ models: providerModels }) => providerModels.length > 0);
    }

    return result;
  });

  // Get provider info
  function getProviderDisplayName(providerId: string): string {
    const provider = getProviderDefinition(providerId, data.getAllCustomProviderMeta());
    return provider?.displayName ?? providerId;
  }

  function getProviderLogo(providerId: string) {
    const provider = getProviderDefinition(providerId, data.getAllCustomProviderMeta());
    if (provider && "logo" in provider && provider.logo) {
      return provider.logo;
    }
    return GenericAIIcon;
  }

  // Check if model is currently selected
  function isSelected(model: ChatModel): boolean {
    return selectedModel?.provider === model.provider && selectedModel?.model === model.model;
  }

  // Get display name for model - strip vendor prefix when a vendor is selected
  function getModelDisplayName(modelId: string): string {
    if (selectedVendor && modelId.includes("/")) {
      return modelId.split("/").slice(1).join("/");
    }
    return modelId;
  }

  // Handle model selection
  function handleSelect(model: ChatModel) {
    isOpen = false;
    selectModel(model);
  }
</script>

{#if !models.hasProviders || !models.hasModels}
  <!-- No providers or no models configured - show settings button -->
  <button onclick={models.openSettings} class="clickable-icon flex flex-row items-center gap-1">
    <Icon name="settings" size="xs" />
    <div class="text-[--text-muted] text-xs">
      {#if !models.hasProviders}
        Configure Provider
      {:else}
        Configure Models
      {/if}
    </div>
  </button>
{:else}
  <button
    bind:this={customAnchor}
    onclick={() => (isOpen = !isOpen)}
    class="clickable-icon flex items-center gap-1"
  >
    {#if selectedModel}
      {@const Logo = getProviderLogo(selectedModel.provider)}
      <Logo width={14} height={14} />
    {/if}
    <div class="text-[--text-normal] self-center text-sm">
      {selectedModel?.model ?? "Select model"}
    </div>
    {#if isOpen}
      <Icon name="chevron-up" size="xs" />
    {:else}
      <Icon name="chevron-down" size="xs" />
    {/if}
  </button>

  <Popover.Root bind:open={isOpen}>
    <Popover.Portal>
      <Popover.Content
        class="model-popover-content bg-[--background-primary] rounded-lg border border-solid border-[--background-modifier-border] shadow-lg z-[var(--layer-popover)] max-h-[400px] flex"
        {customAnchor}
        sideOffset={8}
        side="top"
        align="start"
      >
        <!-- Vendor filter sidebar -->
        {#if availableVendors.length > 0}
          <div class="relative flex flex-col">
            <div
              bind:this={vendorSidebarEl}
              onscroll={updateScrollIndicator}
              class="flex flex-col gap-1 p-2 border-r border-solid border-[--background-modifier-border] bg-[--background-secondary] overflow-y-auto scrollbar-hide"
            >
              <!-- Favorites button -->
              <button
                type="button"
                class="flex items-center justify-center w-12 h-12 rounded-md border-none cursor-pointer transition-colors hover:bg-[--background-modifier-hover] shrink-0"
                style:background={showFavorites ? "var(--interactive-accent)" : "transparent"}
                style:color={showFavorites ? "var(--text-on-accent)" : "var(--text-muted)"}
                onclick={() => {
                  showFavorites = !showFavorites;
                  if (showFavorites) selectedVendor = null;
                }}
                title="Favorites"
                aria-label="Favorites"
              >
                <Icon name="star" size="md" />
              </button>

              <div class="w-full h-px bg-[--background-modifier-border] my-1 shrink-0"></div>

              <!-- Vendor icons -->
              {#each availableVendors as vendor (vendor.id)}
                {@const VendorLogo = vendor.logo}
                <button
                  type="button"
                  class="flex items-center justify-center w-12 h-12 rounded-md border-none cursor-pointer transition-colors hover:bg-[--background-modifier-hover] shrink-0"
                  style:background={selectedVendor === vendor.id
                    ? "var(--interactive-accent)"
                    : "transparent"}
                  style:color={selectedVendor === vendor.id
                    ? "var(--text-on-accent)"
                    : "var(--text-muted)"}
                  onclick={() => {
                    showFavorites = false;
                    selectedVendor = selectedVendor === vendor.id ? null : vendor.id;
                  }}
                  title={vendor.name}
                  aria-label={vendor.name}
                >
                  <VendorLogo width={38} height={38} />
                </button>
              {/each}
            </div>

            <!-- Scroll indicator -->
            {#if canScrollDown}
              <div
                class="absolute bottom-0 left-0 right-0 flex justify-center pb-1 pt-2 bg-gradient-to-t from-[--background-secondary] to-transparent pointer-events-none"
              >
                <div class="animate-bounce text-[--text-muted]">
                  <Icon name="chevron-down" size="xs" />
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Main content -->
        <div class="flex flex-col flex-1 w-[280px] overflow-hidden">
          <!-- Search -->
          <div
            class="flex items-center gap-2 px-3 py-2 border-b border-solid border-[--background-modifier-border]"
          >
            <Icon name="search" size="xs" />
            <input
              bind:this={searchInputEl}
              type="text"
              placeholder="Search models..."
              bind:value={searchQuery}
              class="flex-1 bg-transparent border-none outline-none text-[--text-normal] text-sm placeholder:text-[--text-muted]"
            />
            {#if searchQuery}
              <button
                type="button"
                class="p-1 rounded hover:bg-[--background-modifier-hover] border-none bg-transparent cursor-pointer text-[--text-muted]"
                onclick={() => (searchQuery = "")}
              >
                <Icon name="x" size="xs" />
              </button>
            {/if}
          </div>

          <!-- Models list -->
          <div class="flex-1 overflow-y-auto p-2">
            {#each filteredModelsByProvider as { provider, models: providerModels } (provider)}
              {@const Logo = getProviderLogo(provider)}
              <div class="mb-3 last:mb-0">
                <!-- Provider header -->
                <div
                  class="flex items-center gap-2 px-2 py-1 text-xs font-medium text-[--text-muted] uppercase tracking-wide"
                >
                  <Logo width={12} height={12} />
                  <span>{getProviderDisplayName(provider)}</span>
                </div>

                <!-- Provider models -->
                <div class="flex flex-col gap-0.5">
                  {#each providerModels as model (`${model.provider}::${model.model}`)}
                    {@const isFavorite = data.isFavoriteModel(model.provider, model.model)}
                    <div class="flex items-center gap-1">
                      <button
                        class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-[--background-modifier-hover] border-none bg-transparent text-left cursor-pointer text-[--text-normal] text-sm flex-1 min-w-0"
                        class:bg-[--background-modifier-hover]={isSelected(model)}
                        onclick={() => handleSelect(model)}
                      >
                        <span class="truncate">{getModelDisplayName(model.model)}</span>
                        {#if isSelected(model)}
                          <Icon name="check" size="xs" />
                        {/if}
                      </button>
                      <button
                        type="button"
                        class="flex items-center justify-center w-7 h-7 rounded-md border-none cursor-pointer transition-colors hover:bg-[--background-modifier-hover] shrink-0"
                        style:color={isFavorite ? "var(--text-accent)" : "var(--text-faint)"}
                        onclick={(e) => {
                          e.stopPropagation();
                          data.toggleFavoriteModel(model.provider, model.model);
                        }}
                        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                      >
                        <Icon name="star" size="xs" />
                      </button>
                    </div>
                  {/each}
                </div>
              </div>
            {:else}
              <div class="flex items-center justify-center py-4 text-[--text-muted] text-sm">
                {#if showFavorites}
                  No favorite models yet
                {:else if searchQuery || selectedVendor}
                  No models match your filters
                {:else}
                  No models available
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}
