<script lang="ts">
    import { icon } from "../../utils/utils";
    import { onMount } from "svelte";
    import { getPlugin } from "../../lib/state.svelte";
    import {
        CurrentSession,
        Messenger,
        type ChatModel,
    } from "./chatState.svelte";
    import Dropdown from "../base/Dropdown.svelte";
    import { getData } from "../../lib/data.svelte";
    import { createQuery } from "@tanstack/svelte-query";

    interface Props {
        messengner: Messenger;
        currentSession: CurrentSession;
    }

    const baseOptions = ".txt, .json";

    const { messengner, currentSession }: Props = $props();

    let textarea: HTMLTextAreaElement;
    let inputValue = $state("");

    const maxLines = 4;

    let chatModel: ChatModel | undefined = $state(undefined);

    onMount(() => {
        // Set initial height
        resetHeight();

        // Adjust height when the textarea's width changes
        const resizeObserver = new ResizeObserver(() => {
            updateHeight();
        });
        resizeObserver.observe(textarea);

        return () => {
            resizeObserver.disconnect();
        };
    });

    function resetHeight() {
        if (!textarea) return;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.max(textarea.scrollHeight, 20)}px`;
    }

    function updateHeight() {
        if (!textarea) return;

        // Reset to auto to get accurate scrollHeight
        textarea.style.height = "auto";

        const scrollHeight = textarea.scrollHeight;
        const lineHeight = 20; // Approximate line height in pixels
        const maxHeight = lineHeight * maxLines;

        if (scrollHeight <= maxHeight) {
            textarea.style.height = `${scrollHeight}px`;
            textarea.style.overflowY = "hidden";
        } else {
            textarea.style.height = `${maxHeight}px`;
            textarea.style.overflowY = "auto";
        }
    }

    const data = getData();
    const plugin = getPlugin();
    const providers = data.getConfiguredProviders();

    const modelQueries = providers.map((provider) =>
        createQuery(() => ({
            queryKey: ["models", provider],
            queryFn: async () =>
                await plugin.papa.providerRegistry
                    .getProvider(provider)
                    .getModels(),
        })),
    );

    const allModelsLoaded = $derived(modelQueries.every((q) => q.isSuccess));

    function mapAvailableModels(): ChatModel[] {
        const available: ChatModel[] = [];
        for (const provider of providers) {
            const models: string[] | undefined =
                plugin.queryClient.getQueryData(["models", provider]);
            if (!models) continue;
            const confModels = data.getGenModels(provider);
            for (const [modelName, modelConfig] of confModels.entries()) {
                if (models.includes(modelName)) {
                    available.push({
                        model: modelName,
                        provider,
                        modelConfig,
                    });
                }
            }
        }
        return available;
    }

    const availModelsQuery = createQuery(() => ({
        queryKey: ["chatModels", providers],
        enabled: allModelsLoaded,
        queryFn: async () => {
            const list = mapAvailableModels();
            return list;
        },
    }));

    let _chatModelInitialized = $state(false);
    $effect(() => {
        if (_chatModelInitialized) return;
        const list = availModelsQuery.data;
        if (!list || !list.length) return;

        const sel = data.getSelGenModel();
        if (sel) {
            const found = list.find(
                (m) => m.provider === sel.provider && m.model === sel.model,
            );
            if (found) {
                chatModel = found;
                _chatModelInitialized = true;
                return;
            }
        }
        chatModel = list[0];
        data.selectGenModel(list[0].provider, list[0].model);
        _chatModelInitialized = true;
    });

    function refetch() {
        plugin.queryClient.invalidateQueries({
            queryKey: ["chatModels", providers],
        });
    }

    let files: File[] = $state([]);

    function sendMessage() {
        messengner.sendMessage(currentSession, inputValue, chatModel!!, files);
        files = [];
        inputValue = "";
    }

    const handeEnter = (event: KeyboardEvent) => {
        if (event.shiftKey && event.key === "Enter") {
            return;
        }
        if (event.key === "Enter" && inputValue.length !== 0) {
            event.preventDefault();
            sendMessage();
        }
    };

    function onFileAttachment(event: Event) {
        const input = event.target as HTMLInputElement;
        const fileList = input.files;
        if (fileList) {
            for (const file of fileList) {
                files.push(file);
            }
            console.log("Files:", files);
        }
    }

    function removeAttachedFile(file: File) {
        files.remove(file);
    }
</script>

<div class="w-full px-2 sticky bottom-0">
    <div
        class="mx-auto my-0 p-2 trans-border trans-bg backdrop-blur-lg rounded-t-lg max-w-[500px]"
    >
        <div class="flex flex-row flex-wrap gap-2">
            {#each files as file}
                <div
                    class="flex flex-row gap-0.5 items-center bg-[buttonface] rounded-md"
                >
                    {#if file.type === "text/plain"}
                        <div
                            class="p-0 flex items-center"
                            use:icon={"file-text"}
                            style={"--icon-size: var(--icon-xs)"}
                        ></div>
                    {:else if file.type === "application/json"}
                        <div
                            class="p-0 flex items-center"
                            use:icon={"file-json"}
                            style={"--icon-size: var(--icon-xs)"}
                        ></div>
                    {/if}
                    <div class="text-xs">
                        {file.name}
                    </div>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        use:icon={"x"}
                        style={"--icon-size: 10px"}
                        onclick={() => removeAttachedFile(file)}
                        class="hover:bg-[buttonface] flex items-center justify-center h-4 w-4 bg-white rounded-sm mr-1 my-1"
                    ></div>
                </div>
            {/each}
        </div>
        <textarea
            bind:this={textarea}
            bind:value={inputValue}
            onkeypress={(event) => handeEnter(event)}
            id="chat-view-user-input-element"
            class="resize-none border-0 !shadow-none p-1 w-full"
            placeholder={"Your text here"}
            oninput={updateHeight}
        ></textarea>

        <div class="flex w-full items-center">
            <div class="flex flex-row flex-1 gap-2">
                <Dropdown
                    type="options"
                    dropdown={availModelsQuery.data
                        ? availModelsQuery.data.map((model) => ({
                              display: model.model,
                              value: model,
                          }))
                        : []}
                    selected={chatModel}
                    onSelect={(model) => {
                        if (!model) return;
                        chatModel = model;
                        data.selectGenModel(model.provider, model.model);
                    }}
                />
                <input
                    type="file"
                    multiple={true}
                    id="attachment"
                    accept={baseOptions}
                    style="display:none;"
                    oninput={(event) => onFileAttachment(event)}
                />
                <label
                    class="clickable-icon"
                    use:icon={"paperclip"}
                    for="attachment"
                ></label>
            </div>
            <button
                disabled={inputValue.length === 0}
                aria-label={"send message"}
                onclick={sendMessage}
                class="h-7 w-7 p-1 rounded-r-md transition duration-300 ease-in-out !bg-[--text-accent-lighter] color-[--background-primary]"
                use:icon={"arrow-up"}
            ></button>
        </div>
    </div>
</div>

<style>
    .trans-bg {
        background-color: color-mix(
            in oklab,
            var(--background-primary) 4.5%,
            transparent
        );
    }

    .trans-border {
        outline: 4px solid
            color-mix(in oklab, var(--text-accent) 70%, transparent);
    }
</style>
