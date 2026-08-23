<script lang="ts">
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { getSessionRegistry } from "../../stores/chatStore.svelte";
import { buildPersistedChatModel } from "../../utils/persistedChatModel";
import { ModelSelectionModal } from "../modal/ModelSelectionModal";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import { stripVendorPrefix } from "../../lib/modelMetadataNormalizer";
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
		// The composer pill is the tightest model surface in the app, and the
		// agent pill right beside it already implies the vendor — so drop the
		// catalogue's "Lab: " prefix ("Qwen: Qwen3.8 Max" -> "Qwen3.8 Max") and
		// spend the width on the part that actually distinguishes the model.
		return stripVendorPrefix(hydrated.displayName);
	}
	return model;
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

  /* On mobile the row is just attach + (icon-only) agent pill + this + send, all
     at the 44px touch floor, so there's far more free width than the old fixed
     84px cap used. Measured on-device at a 402px viewport: row 23..379, label
     ending at 228 while the send button only starts at 330 — ~100px sitting
     unused while names like "Free Models Router" truncated.

     `45vw` tracks the viewport (≈181px there, landing just short of the send
     button with a small gutter) and the 190px ceiling stops it crowding the row
     on wider tablets. The button is `min-width: 0` inside a `flex-wrap` row, so
     it still shrinks rather than pushing send off-screen if a future control
     joins the row. */
  :global(.is-mobile) .model-name {
    max-width: min(45vw, 190px);
  }

  .model-name.no-model {
    color: var(--text-faint);
    font-style: italic;
  }
</style>
