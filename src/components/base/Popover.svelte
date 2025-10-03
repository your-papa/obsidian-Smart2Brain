<script lang="ts">
    import { Popover, Portal, Separator, Toggle } from "bits-ui";
    import { icon } from "../../utils/utils";
    import {
        AnthropicLogo,
        OllamaLogo,
        OpenAILogo,
    } from "@selemondev/svgl-svelte";
    import type { ChatModel } from "../Chat/chatState.svelte";
    interface props {
        model: ChatModel;
        models: ChatModel[];
        setModel: (model: ChatModel) => void;
        refetch: () => void;
    }
    const { model, models, refetch, setModel }: props = $props();
    let isOpen = $state(false);
    let customAnchor = $state<HTMLElement>(null!);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={customAnchor}
    onclick={() => (isOpen = !isOpen)}
    class="flex flex-row hover:bg-[--background-modifier-hover] p-1 pl-2 rounded-md gap-1"
>
    <div class="text-[--text-accent] self-center">{model?.model}</div>
    <div
        class="text-[--text-accent] flex items-center"
        use:icon={"chevron-down"}
    ></div>
</div>

<Popover.Root bind:open={isOpen}>
    <Popover.Portal>
        <Popover.Content
            class="bg-white rounded-md border-[--background-modifier-border] border-solid shadow-md"
            {customAnchor}
            sideOffset={8}
            side="top"
            align="start"
        >
            <div class="flex flex-col mx-2 my-4">
                {#each models as model}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="flex flex-row items-center gap-2 p-2 rounded-lg hover:bg-[--background-modifier-hover]"
                        onclick={() => {
                            setModel(model);
                            isOpen = false;
                        }}
                    >
                        {#if model.provider === "OpenAI"}
                            <OpenAILogo height={16} width={16} />
                        {:else if model.provider === "Anthropic"}
                            <AnthropicLogo height={16} width={16} />
                        {:else if model.provider === "Ollama"}
                            <OllamaLogo height={16} width={16} />
                        {:else}
                            <div use:icon={"sparkles"}></div>
                        {/if}

                        <div>{model.model}</div>
                    </div>
                {/each}
            </div>
            <Separator.Root
                class="bg-black shrink-0 my-1 w-full data-[orientation=horizontal]:h-px"
            />

            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="clickable-icon w-8 ml-auto mr-1 my-1"
                use:icon={"refresh-cw"}
                onclick={refetch}
            ></div>
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>
