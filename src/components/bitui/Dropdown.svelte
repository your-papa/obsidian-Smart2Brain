<script lang="ts">
import { Select } from "bits-ui";
import Icon from "../base/Icon.svelte";
import { AnthropicLogo, OllamaLogo, OpenAILogo } from "@selemondev/svgl-svelte";
import { getData } from "../../stores/dataStore.svelte";
import type { ChatModel } from "../../stores/chatStore.svelte";
import { useAvailableModels } from "../../composables/useAvailableModels.svelte";

const data = getData();

// Don't destructure - access properties directly to maintain reactivity
const models = useAvailableModels();

let value = $state<string>("");
const selectedLabel = $derived(
	value ? (models.modelOptions.find((o) => o.value === value)?.label ?? "Select a model") : "Select a model",
);

// Initialize from stored default chat model or first available
let _initialized = $state(false);
$effect(() => {
	if (_initialized) return;
	const opts = models.modelOptions;
	if (!opts.length) return;

	const sel = data.getDefaultChatModel();
	if (sel) {
		const key = `${sel.provider}:${sel.model}`;
		if (opts.some((o) => o.value === key)) {
			value = key;
			_initialized = true;
			return;
		}
	}
	value = opts[0].value;
	data.setDefaultChatModel(opts[0].chatModel as ChatModel);
	_initialized = true;
});

function onValueChange(v: string) {
	value = v;
	const opt = models.modelOptions.find((o) => o.value === v);
	if (opt) data.setDefaultChatModel(opt.chatModel as ChatModel);
}
</script>

{#if !models.hasProviders || !models.hasModels}
    <!-- No providers or no models configured - show settings button -->
    <button
        onclick={models.openSettings}
        class="flex flex-row items-center gap-2 px-3 py-2 rounded-md border border-solid border-[--background-modifier-border] hover:bg-[--background-modifier-hover]"
    >
        <Icon name="settings" size="14px" />
        <span class="text-[--text-muted] text-sm">
            {#if !models.hasProviders}
                Configure Provider
            {:else}
                Configure Models
            {/if}
        </span>
    </button>
{:else}
    <Select.Root type="single" items={models.modelOptions} {onValueChange}>
        <Select.Trigger class="!pr-[6px] !pl-3 items-center h-30">
            <div class="flex h-4">{selectedLabel}</div>
            <div class="flex items-center h-4 pl-2 ml-auto">
                <Icon name="chevrons-up-down" size="14px" class="text-gray-400" />
            </div>
        </Select.Trigger>
        <Select.Portal>
            <Select.Content
                class="bg-[--background-secondary] select-none max-h-[--popover-height] z-[--layer-menu] rounded-xl border border-solid border-[--background-secondary-alt]"
                sideOffset={10}
            >
                <Select.ScrollUpButton
                    class="flex w-full items-center justify-center"
                >
                    <Icon name="chevron-up" />
                </Select.ScrollUpButton>
                <Select.Viewport class="p-1">
                    {#each models.modelOptions as opt, i (i + opt.value)}
                        <Select.Item
                            class="rounded-button data-highlighted:bg-muted outline-hidden flex h-10 w-full select-none items-center py-3 pl-5 pr-1.5 text-sm"
                            value={opt.value}
                            label={opt.label}
                        >
                            {#snippet children({ selected })}
                                {#if opt.chatModel.provider === "OpenAI"}
                                    <OpenAILogo
                                        style={"fill: var(--text-normal)"}
                                        height={16}
                                        width={16}
                                    />
                                {:else if opt.chatModel.provider === "Anthropic"}
                                    <AnthropicLogo
                                        style={"fill: var(--text-normal)"}
                                        height={16}
                                        width={16}
                                    />
                                {:else if opt.chatModel.provider === "Ollama"}
                                    <OllamaLogo
                                        style={"fill: var(--text-normal)"}
                                        height={16}
                                        width={16}
                                    />
                                {:else}
                                    <Icon name="sparkles" size="16px" />
                                {/if}
                                <span class="ml-2">{opt.label}</span>
                            {/snippet}
                        </Select.Item>
                    {/each}
                </Select.Viewport>
                <Select.ScrollDownButton
                    class="flex w-full items-center justify-center"
                >
                    <Icon name="chevron-down" />
                </Select.ScrollDownButton>
            </Select.Content>
        </Select.Portal>
    </Select.Root>
{/if}
