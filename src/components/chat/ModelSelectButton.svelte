<script lang="ts">
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { type ChatModel, getSessionRegistry } from "../../stores/chatStore.svelte";
import { ModelSelectionModal } from "../modal/ModelSelectionModal";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import Button from "../ui/Button.svelte";

const data = getData();
const plugin = getPlugin();
const models = useAvailableModels();

interface Props {
	threadPath?: string | null;
}
const { threadPath = null }: Props = $props();

// The agent this TAB runs (per-session selection, falling back to the global).
// The model pill and the modal's current selection both read from this agent so
// they reflect what the tab will actually use, not the global selection.
const session = $derived(getSessionRegistry()?.sessionFor(threadPath));
const selectedAgent = $derived(
	(session?.selectedAgentId ? data.getAgent(session.selectedAgentId) : undefined) ?? data.getSelectedAgent(),
);

function getModelDisplayName(provider: string, model: string): string {
	const hydrated = models.hydratedChatModelsByKey.get(`${provider}:${model}`);
	if (hydrated?.displayName) {
		return hydrated.displayName;
	}
	return model;
}

function buildPersistedChatModel(provider: string, model: string, existing?: ChatModel | null): ChatModel {
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
		const agentId = session?.selectedAgentId || data.selectedAgentId;
		data.updateAgent(agentId, {
			chatModel: buildPersistedChatModel(selected.provider, selected.model, selectedAgent?.chatModel),
		});
	}).open();
}
</script>

<Button
  styles="clickable-icon model-select-btn"
  tooltip="Select model"
  dataTestId="model-select-button"
  onClick={openModelSelectionModal}
>
  {#if selectedAgent?.chatModel}
    <span class="model-name" data-testid="model-pill">
      {getModelDisplayName(selectedAgent.chatModel.provider, selectedAgent.chatModel.model)}
    </span>
  {:else}
    <span class="model-name no-model">Select model</span>
  {/if}
</Button>

<style>
  :global(.model-select-btn) {
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
