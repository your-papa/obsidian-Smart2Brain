<script lang="ts">
import { Popover } from "bits-ui";
import { type AgentConfig, resolveAgentColorCSS } from "../../types/plugin";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { Logger } from "../../utils/logging";
import Icon from "../ui/Icon.svelte";
import { chatHistoryContainsPrivateNotes, getMessenger } from "../../stores/chatStore.svelte";
import { PrivacyWarningModal } from "../modal/PrivacyWarningModal";
import { AgentEditorModal } from "../modal/AgentEditorModal";

const data = getData();
const plugin = getPlugin();

// Get all agents reactively
const agents = $derived(Object.values(data.agents));

// Get currently selected agent
const selectedAgent = $derived(data.getSelectedAgent());

// Check if agent selection actually makes a difference (more than one agent)
const hasMultipleAgents = $derived(agents.length > 1);

let isOpen = $state(false);
let customAnchor: HTMLElement | undefined = $state();

async function selectAgent(agent: AgentConfig) {
	// Check if the agent's provider is non-trusted and chat has private notes
	const newProvider = agent.chatModel?.provider;
	if (newProvider && !data.isProviderTrusted(newProvider)) {
		const messages = getMessenger()?.session?.messages;
		if (messages && chatHistoryContainsPrivateNotes(messages)) {
			const confirmed = await new PrivacyWarningModal(plugin.app).prompt();
			if (!confirmed) return;
		}
	}
	data.selectedAgentId = agent.id;
	isOpen = false;
	// Reinitialize the agent with the new config
	plugin.agentManager?.reinitialize().catch((error) => {
		Logger.error("Failed to switch agent:", error);
	});
}

function openAgentEditor(agentId: string) {
	isOpen = false;
	new AgentEditorModal(plugin, agentId).open();
}
</script>

{#if agents.length === 0}
  <!-- No agents configured (shouldn't happen, but handle gracefully) -->
  <button
    onclick={() => openAgentEditor("default-agent")}
    class="clickable-icon flex flex-row items-center gap-1"
  >
    <div class="text-[--text-muted] text-xs">Configure Agent</div>
  </button>
{:else}
  <button
    bind:this={customAnchor}
    onclick={() => (hasMultipleAgents ? (isOpen = !isOpen) : openAgentEditor(selectedAgent.id))}
    class="clickable-icon flex items-center gap-1 min-w-0"
    title={hasMultipleAgents ? "Select agent" : "Edit agent"}
    data-testid="agent-select-button"
  >
    <span
      class="agent-pill"
      class:has-color={!!selectedAgent?.color}
      style={selectedAgent?.color
        ? `--pill-color: ${resolveAgentColorCSS(selectedAgent.color)}`
        : ""}
      data-testid="agent-pill"
    >
      {selectedAgent?.name ?? "Default Agent"}
    </span>
    {#if hasMultipleAgents}
      {#if isOpen}
        <Icon name="chevron-up" size="xs" />
      {:else}
        <Icon name="chevron-down" size="xs" />
      {/if}
    {/if}
  </button>

  <Popover.Root bind:open={isOpen}>
    <Popover.Portal>
      <Popover.Content
        class="bg-[--background-primary] rounded-lg border border-solid border-[--background-modifier-border] shadow-lg z-[var(--layer-popover)] overflow-hidden"
        {customAnchor}
        sideOffset={8}
        side="top"
        align="start"
      >
        <div class="flex flex-col py-1.5 min-w-[220px] max-w-[320px]">
          <!-- Agent list -->
          {#if hasMultipleAgents}
            <div
              class="text-[0.65rem] text-[--text-faint] px-3 pb-1 uppercase font-medium tracking-wider"
            >
              Agent
            </div>
          {/if}
          {#each agents as agent (agent.id)}
            {@const isSelected = agent.id === selectedAgent?.id}
            {@const isDefault = agent.id === data.defaultAgentId}
            {#if hasMultipleAgents}
              <div
                class="agent-row"
                class:agent-row-selected={isSelected}
                role="button"
                tabindex="0"
                onclick={() => selectAgent(agent)}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") selectAgent(agent);
                }}
              >
                <span
                  class="agent-name-pill flex-1 min-w-0"
                  class:has-color={!!agent.color}
                  style={agent.color ? `--pill-color: ${resolveAgentColorCSS(agent.color)}` : ""}
                >
                  {agent.name}
                </span>
                {#if isDefault}
                  <span class="text-[0.6rem] text-[--text-faint] shrink-0">default</span>
                {/if}
                {#if isSelected}
                  <Icon name="check" size="xs" class="text-[--text-accent] shrink-0" />
                {/if}
                <button
                  type="button"
                  class="agent-settings-btn"
                  title="Edit agent"
                  onclick={(e) => {
                    e.stopPropagation();
                    openAgentEditor(agent.id);
                  }}
                >
                  <Icon name="settings" size="xs" class="text-[--text-faint]" />
                </button>
              </div>
            {/if}
          {/each}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  .agent-pill {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8rem;
    color: var(--text-normal);
  }

  .agent-pill.has-color {
    background-color: color-mix(in srgb, var(--pill-color) 25%, transparent);
    color: var(--pill-color);
    padding: 1px 8px;
    border-radius: 10px;
    font-weight: 500;
  }

  .agent-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    margin: 0 0.25rem;
    border-radius: 0.375rem;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    box-shadow: none;
    color: var(--text-normal);
    font-size: inherit;
  }

  .agent-row:hover {
    background: var(--background-modifier-hover);
  }

  .agent-row-selected {
    background: var(--background-modifier-active-hover);
  }

  .agent-name-pill {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
  }

  .agent-name-pill.has-color {
    background-color: color-mix(in srgb, var(--pill-color) 25%, transparent);
    color: var(--pill-color);
    padding: 1px 8px;
    border-radius: 10px;
    font-weight: 500;
  }

  .agent-settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.15rem;
    border: none;
    background: transparent;
    border-radius: 0.25rem;
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .agent-settings-btn:hover {
    opacity: 1;
    background: var(--background-modifier-hover);
  }
</style>
