<script lang="ts">
import { Popover, Separator } from "bits-ui";
import type { AgentConfig } from "../../main";
import { DEFAULT_AGENT_ID, getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import Icon from "../ui/Icon.svelte";

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

function selectAgent(agent: AgentConfig) {
	data.selectedAgentId = agent.id;
	isOpen = false;
	// Reinitialize the agent with the new config
	plugin.agentManager?.reinitialize().catch((error) => {
		console.error("Failed to switch agent:", error);
	});
}

function openAgentSettings() {
	// Open settings to the Agents tab
	const app = plugin.app as unknown as {
		setting?: { open: () => void; openTabById: (id: string) => void };
	};
	app.setting?.open();
	app.setting?.openTabById("smart-second-brain");
	isOpen = false;
}
</script>

{#if agents.length === 0}
	<!-- No agents configured (shouldn't happen, but handle gracefully) -->
	<button onclick={openAgentSettings} class="clickable-icon flex flex-row items-center gap-1">
		<Icon name="bot" size="xs" />
		<div class="text-[--text-muted] text-xs">Configure Agent</div>
	</button>
{:else}
	<button
		bind:this={customAnchor}
		onclick={() => (isOpen = !isOpen)}
		class="clickable-icon flex items-center gap-1"
		title="Select agent"
	>
		<Icon name="bot" size="xs" />
		<span
			class="agent-pill"
			class:has-color={!!selectedAgent?.color}
			style={selectedAgent?.color ? `--pill-color: var(--color-${selectedAgent.color})` : ""}
		>
			{selectedAgent?.name ?? "Default Agent"}
		</span>
		{#if hasMultipleAgents}
			{#if isOpen}
				<Icon name="chevron-up" size="s" />
			{:else}
				<Icon name="chevron-down" size="s" />
			{/if}
		{/if}
	</button>

	{#if hasMultipleAgents}
		<Popover.Root bind:open={isOpen}>
			<Popover.Portal>
				<Popover.Content
					class="bg-[--background-primary] rounded-md border-[--background-modifier-border] border-solid shadow-md min-w-[180px] max-w-[280px]"
					{customAnchor}
					sideOffset={8}
					side="top"
					align="start"
				>
					<div class="flex flex-col mx-2 my-2">
						<div class="text-xs text-[--text-muted] px-2 py-1 uppercase font-medium">
							Select Agent
						</div>
						{#each agents as agent (agent.id)}
							{@const isSelected = agent.id === selectedAgent?.id}
							{@const isDefault = agent.id === data.defaultAgentId}
							<button
								class="!flex !flex-row !items-center !gap-2 !p-2 !rounded-lg hover:!bg-[--background-modifier-hover] !border-none !bg-transparent !text-left !cursor-pointer !shadow-none !text-[--text-normal]"
								class:!bg-[--background-modifier-active-hover]={isSelected}
								onclick={() => selectAgent(agent)}
							>
								<Icon name="bot" size="s" class={isSelected ? "text-[--text-accent]" : ""} />
								<div class="flex-1 min-w-0 flex items-center gap-1.5">
									<span
										class="agent-name-pill"
										class:has-color={!!agent.color}
										style={agent.color ? `--pill-color: var(--color-${agent.color})` : ""}
									>
										{agent.name}
									</span>
									{#if isDefault}
										<span class="text-[0.6rem] px-1 py-0.5 rounded bg-[--background-modifier-success] text-[--text-success] uppercase font-medium">
											Default
										</span>
									{/if}
								</div>
								{#if isSelected}
									<Icon name="check" size="s" class="text-[--text-accent]" />
								{/if}
							</button>
						{/each}
					</div>

					<Separator.Root
						class="bg-[--background-modifier-border] shrink-0 my-1 w-full data-[orientation=horizontal]:h-px"
					/>

					<button
						onclick={openAgentSettings}
						aria-label="Open agent settings"
						class="!flex !flex-row !w-full !m-0 !py-2 !px-4 !rounded-none !gap-2 hover:!bg-[--background-modifier-hover] !border-none !bg-transparent !cursor-pointer !shadow-none !text-[--text-muted] !text-sm"
					>
						<Icon name="settings" size="s" />
						<span>Manage Agents</span>
					</button>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	{/if}
{/if}

<style>
	.agent-pill {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.875rem;
		color: var(--text-normal);
	}

	.agent-pill.has-color {
		background-color: color-mix(in srgb, var(--pill-color) 25%, transparent);
		color: var(--pill-color);
		padding: 1px 8px;
		border-radius: 10px;
		font-weight: 500;
	}

	.agent-name-pill {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.agent-name-pill.has-color {
		background-color: color-mix(in srgb, var(--pill-color) 25%, transparent);
		color: var(--pill-color);
		padding: 1px 8px;
		border-radius: 10px;
		font-weight: 500;
	}
</style>
