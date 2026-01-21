<script lang="ts">
import { AnthropicLogo, OllamaLogo, OpenAILogo } from "@selemondev/svgl-svelte";
import { Popover, Separator } from "bits-ui";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import type { ChatModel } from "../../stores/chatStore.svelte";
import { getData } from "../../stores/dataStore.svelte";
import Icon from "../ui/Icon.svelte";
import IconButton from "../ui/IconButton.svelte";

const data = getData();

// Don't destructure - access properties directly to maintain reactivity
const models = useAvailableModels();

// Derive the effective selected model - uses default if valid, otherwise first available
const selectedModel = $derived.by(() => {
	const list = models.availableModels;
	const sel = data.getDefaultChatModel();

	if (sel && list.length > 0) {
		const found = list.find((m: ChatModel) => m.provider === sel.provider && m.model === sel.model);
		if (found) return found;
	}

	return list.length > 0 ? list[0] : null;
});

// Initialize default model on first load if not set
let _initialized = $state(false);
$effect(() => {
	if (_initialized) return;
	if (!models.availableModels.length) return;

	const sel = data.getDefaultChatModel();
	if (!sel) {
		data.setDefaultChatModel(models.availableModels[0]);
	}
	_initialized = true;
});

let isOpen = $state(false);
let customAnchor: HTMLElement | undefined = $state();
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
		<div class="text-[--text-normal] self-center">
			{selectedModel?.model ?? "Select model"}
		</div>
		{#if isOpen}
			<Icon name="chevron-up" size="s" />
		{:else}
			<Icon name="chevron-down" size="s" />
		{/if}
	</button>

	<Popover.Root bind:open={isOpen}>
		<Popover.Portal>
			<Popover.Content
				class="bg-[--background-primary] rounded-md border-[--background-modifier-border] border-solid shadow-md"
				{customAnchor}
				sideOffset={8}
				side="top"
				align="start"
			>
				<div class="flex flex-col mx-2 my-4">
					{#each models.availableModels as model}
						<button
							class="flex flex-row items-center gap-2 p-2 rounded-lg hover:bg-[--background-modifier-hover] border-none bg-transparent text-left cursor-pointer"
							onclick={() => {
								isOpen = false;
								data.setDefaultChatModel(model);
							}}
						>
							{#if model.provider === "OpenAI"}
								<OpenAILogo style="fill: var(--text-normal)" height={16} width={16} />
							{:else if model.provider === "Anthropic"}
								<AnthropicLogo style="fill: var(--text-normal)" height={16} width={16} />
							{:else if model.provider === "Ollama"}
								<OllamaLogo style="fill: var(--text-normal)" height={16} width={16} />
							{:else}
								<Icon name="sparkles" size="s" />
							{/if}

							<div>{model.model}</div>
						</button>
					{/each}
				</div>
				<Separator.Root
					class="bg-[--background-modifier-border] shrink-0 my-1 w-full data-[orientation=horizontal]:h-px"
				/>

				<button
					onclick={models.refetchModels}
					aria-label="refetch available models"
					class="flex flex-row w-fit m-1 ml-auto py-1 px-2 rounded-md gap-1 hover:bg-[--background-modifier-hover] border-none bg-transparent cursor-pointer"
				>
					<div class="self-center">Refetch</div>
					<Icon name="refresh-cw" size="s" />
				</button>
			</Popover.Content>
		</Popover.Portal>
	</Popover.Root>
{/if}
