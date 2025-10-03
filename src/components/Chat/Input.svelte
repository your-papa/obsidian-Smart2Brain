<script lang="ts">
    import { icon } from "../../utils/utils";
    import { onMount } from "svelte";
    import { getPlugin, modelQuery } from "../../lib/state.svelte";
    import {
        CurrentSession,
        MessageState,
        Messenger,
        type ChatModel,
    } from "./chatState.svelte";
    import { getData } from "../../lib/data.svelte";
    import { createQuery } from "@tanstack/svelte-query";
    import { Notice } from "obsidian";
    import Popover from "../base/Popover.svelte";

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

    // Use your shared modelQuery for each provider
    const modelQueries = providers.map((provider) =>
        modelQuery(provider, plugin),
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

        const sel = data.getSelGenModel();
        if (sel) {
            const found = list.find(
                (m: ChatModel) =>
                    m.provider === sel.provider && m.model === sel.model,
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

    // Refetch by invalidating the per-provider 'models' queries
    function refetch() {
        plugin.queryClient.invalidateQueries({ queryKey: ["models"] });
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

    function stopMessage() {
        currentSession.session?.stopStreaming();
    }

    function onFileAttachment(event: Event) {
        const input = event.target as HTMLInputElement;
        const fileList = input.files;
        if (fileList) {
            for (const file of fileList) {
                files.push(file);
            }
            new Notice(`New files attached`);
        }
    }

    function removeAttachedFile(file: File) {
        files.remove(file);
    }

    function setModel(model: ChatModel) {
        chatModel = model;
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
            <div class="flex flex-row flex-1 gap-1">
                <Popover
                    model={chatModel}
                    models={availableModels ?? []}
                    {refetch}
                    {setModel}
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
            {#if !currentSession.session || currentSession.session.messageState === MessageState.idle}
                <button
                    disabled={inputValue.length === 0}
                    aria-label={"send message"}
                    onclick={sendMessage}
                    class="h-7 w-7 p-1 rounded-r-md transition duration-300 ease-in-out !bg-[--text-accent-lighter] color-[--background-primary]"
                    use:icon={"arrow-up"}
                ></button>
            {:else if currentSession.session.messageState === MessageState.answering}
                <button
                    aria-label={"stop streaming"}
                    onclick={stopMessage}
                    class="h-7 w-7 p-1 rounded-r-md transition duration-300 ease-in-out !bg-[--text-accent-lighter] color-[--background-primary]"
                    use:icon={"square"}
                ></button>{/if}
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
