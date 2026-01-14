<script lang="ts">
    import { Popover, Portal, Separator, Toggle } from "bits-ui";
    import { icon } from "../../utils/utils";
    import {
        AnthropicLogo,
        OllamaLogo,
        OpenAILogo,
    } from "@selemondev/svgl-svelte";
    import type { ChatModel } from "../../stores/chatStore.svelte";
    import { getData } from "../../stores/dataStore.svelte";
    import { getPlugin } from "../../stores/state.svelte";
    import { createModelListQuery } from "../../utils/query";

    const data = getData();
    const plugin = getPlugin();

    const providers = data.getConfiguredProviders();

    const modelQueries = providers.map((provider) =>
        createModelListQuery(() => provider),
    );

    const availableModels = $derived.by(() => {
        const out: ChatModel[] = [];
        providers.forEach((provider, idx) => {
            const models: string[] = modelQueries[idx].data ?? [];
            const confModels = data.getGenModels(provider);
            for (const [modelName, modelConfig] of confModels.entries()) {
                if (models.includes(modelName)) {
                    out.push({ model: modelName, provider, modelConfig });
                }
            }
        });
        return out;
    });

    let _chatModelInitialized = $state(false);

    $effect(() => {
        if (_chatModelInitialized) return;
        const list = availableModels;
        if (!list || !list.length) return;

        const sel = data.getDefaultChatModel();
        if (sel) {
            const found = list.find(
                (m: ChatModel) =>
                    m.provider === sel.provider && m.model === sel.model,
            );
            if (found) {
                _chatModelInitialized = true;
                return;
            }
        }
        data.setDefaultChatModel(list[0]);
        _chatModelInitialized = true;
    });

    function refetch() {
        plugin.queryClient.invalidateQueries({ queryKey: ["models"] });
    }

    const isOpen = $state(false);
    const customAnchor = $state<HTMLElement>(null!);
</script>

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
        {data.getDefaultChatModel()?.model}
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
                {#each availableModels as model}
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
                onclick={refetch}
                aria-label="refetch available models"
                class="flex flex-row w-fit m-1 ml-auto py-1 px-2 rounded-md gap-1 hover:bg-[--background-modifier-hover]"
            >
                <div class="self-center">Refetch</div>
                <div class="flex items-center" use:icon={"refresh-cw"}></div>
            </div>
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>
