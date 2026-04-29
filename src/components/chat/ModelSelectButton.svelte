<script lang="ts">
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { Logger } from "../../utils/logging";
  import { type ChatModel } from "../../stores/chatStore.svelte";
  import { ModelSelectionModal } from "../modal/ModelSelectionModal";
  import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";

  const data = getData();
  const plugin = getPlugin();
  const models = useAvailableModels();

  const selectedAgent = $derived(data.getSelectedAgent());

  function getModelDisplayName(provider: string, model: string): string {
    const hydrated = models.hydratedChatModelsByKey.get(`${provider}:${model}`);
    if (hydrated?.displayName) {
      return hydrated.displayName;
    }
    return model;
  }

  function buildPersistedChatModel(
    provider: string,
    model: string,
    existing?: ChatModel | null,
  ): ChatModel {
    const hydrated = models.hydratedChatModelsByKey.get(`${provider}:${model}`);
    return {
      provider,
      model,
      modelConfig: {
        contextWindow: hydrated?.contextWindow ?? existing?.modelConfig?.contextWindow ?? 128000,
        supportsVision: hydrated?.capabilities.vision ?? existing?.modelConfig?.supportsVision,
        temperature: existing?.modelConfig?.temperature,
      },
    };
  }

  function openModelSelectionModal() {
    const currentSelection = selectedAgent?.chatModel
      ? { provider: selectedAgent.chatModel.provider, model: selectedAgent.chatModel.model }
      : null;
    new ModelSelectionModal(plugin, "chat", currentSelection, (selected) => {
      if (!selected) return;
      data.updateAgent(data.selectedAgentId, {
        chatModel: buildPersistedChatModel(
          selected.provider,
          selected.model,
          selectedAgent?.chatModel,
        ),
      });
      plugin.agentManager?.reinitialize().catch((error) => {
        Logger.error("Failed to update agent model:", error);
      });
    }).open();
  }
</script>

<button
  class="clickable-icon model-select-btn"
  title="Select model"
  data-testid="model-select-button"
  onclick={openModelSelectionModal}
>
  {#if selectedAgent?.chatModel}
    <span class="model-name" data-testid="model-pill">
      {getModelDisplayName(selectedAgent.chatModel.provider, selectedAgent.chatModel.model)}
    </span>
  {:else}
    <span class="model-name no-model">Select model</span>
  {/if}
</button>

<style>
  .model-select-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }

  .model-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .model-name.no-model {
    color: var(--text-faint);
    font-style: italic;
  }
</style>
