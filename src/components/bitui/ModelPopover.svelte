<script lang="ts">
import { Popover, Portal, Separator, Toggle } from "bits-ui";
import { icon } from "../../utils/utils";
import { AnthropicLogo, OllamaLogo, OpenAILogo } from "@selemondev/svgl-svelte";
import type { ChatModel } from "../../stores/chatStore.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { useAvailableModels } from "../../composables/useAvailableModels.svelte";

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
let customAnchor = $state<HTMLElement>(null!);
</script>

{#if !models.hasProviders || !models.hasModels}
    <!-- No providers or no models configured - show settings button -->
    <button
        onclick={models.openSettings}
        class="clickable-icon flex flex-row items-center gap-1"
    >
        <div
            class="flex items-center"
            use:icon={"settings"}
            style="--icon-size: var(--icon-xs)"
        ></div>
        <div class="text-[--text-muted] text-xs">
            {#if !models.hasProviders}
                Configure Provider
            {:else}
                Configure Models
            {/if}
        </div>
    </button>
{:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        bind:this={customAnchor}
        onclick={() => (isOpen = !isOpen)}
        class="clickable-icon"
    >
        <div class="text-[--text-normal] self-center">
            {selectedModel?.model ?? "Select model"}
        </div>
        {#if isOpen}
            <div class="flex items-center" use:icon={"chevron-up"}></div>
        {:else}
            <div class=" flex items-center" use:icon={"chevron-down"}></div>
        {/if}
    </div>

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
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class="flex flex-row items-center gap-2 p-2 rounded-lg hover:bg-[--background-modifier-hover]"
                            onclick={() => {
                                isOpen = false;
                                data.setDefaultChatModel(model);
                            }}
                        >
                            {#if model.provider === "OpenAI"}
                                <OpenAILogo
                                    style={"fill: var(--text-normal)"}
                                    height={16}
                                    width={16}
                                />
                            {:else if model.provider === "Anthropic"}
                                <AnthropicLogo
                                    style={"fill: var(--text-normal)"}
                                    height={16}
                                    width={16}
                                />
                            {:else if model.provider === "Ollama"}
                                <OllamaLogo
                                    style={"fill: var(--text-normal)"}
                                    height={16}
                                    width={16}
                                />
                            {:else}
                                <div use:icon={"sparkles"}></div>
                            {/if}

                            <div>{model.model}</div>
                        </div>
                    {/each}
                </div>
                <Separator.Root
                    class="bg-[--background-modifier-border]  shrink-0 my-1 w-full data-[orientation=horizontal]:h-px"
                />

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    onclick={models.refetchModels}
                    aria-label="refetch available models"
                    class="flex flex-row w-fit m-1 ml-auto py-1 px-2 rounded-md gap-1 hover:bg-[--background-modifier-hover]"
                >
                    <div class="self-center">Refetch</div>
                    <div class="flex items-center" use:icon={"refresh-cw"}></div>
                </div>
            </Popover.Content>
        </Popover.Portal>
    </Popover.Root>
{/if}
