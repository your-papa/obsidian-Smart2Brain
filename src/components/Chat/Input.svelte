<script lang="ts">
    import { icon } from "../../utils/utils";
    import { onMount } from "svelte";
    import { getPlugin } from "../../lib/state.svelte";
    import { Messenger, type ChatModel } from "./chatState.svelte";
    import Dropdown from "../base/Dropdown.svelte";
    import { getData } from "../../lib/data.svelte";
    import { createQuery } from "@tanstack/svelte-query";
    import Icon from "../icons/Icon.svelte";
    import Button from "../base/Button.svelte";

    interface Props {
        chatId: string;
        messengner: Messenger;
    }

    const baseOptions = ".txt, .json";

    const test = "";

    const { chatId, messengner }: Props = $props();

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

    const availModelsQuery = createQuery(() => ({
        queryKey: ["chatModels", providers],
        enabled: allModelsLoaded,
        queryFn: async () => {
            const availableModels = [];
            for (const provider of providers) {
                const models: string[] | undefined =
                    plugin.queryClient.getQueryData(["models", provider]);
                if (!models) continue;
                const confModels = data.getGenModels(provider);
                for (const [modelName, modelConfig] of confModels.entries()) {
                    if (models.includes(modelName)) {
                        availableModels.push({
                            model: modelName,
                            provider,
                            modelConfig,
                        });
                    }
                }
            }
            return availableModels;
        },
    }));

    function refetch() {
        plugin.queryClient.invalidateQueries({
            queryKey: ["chatModels", providers],
        });
    }

    let files: File[] = $state([]);

    function sendMessage() {
        messengner.sendMessage(chatId, inputValue, chatModel!!, files);
        files = [];
        inputValue = "";
    }

    const handeEnter = (event: KeyboardEvent) => {
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

<div class="w-full px-2">
    <div
        class="mx-auto border-reflect my-0 rounded-t-lg bg-[--text-accent-lighter] p-1 pb-0 backdrop-blur-lg max-w-[500px]"
        style="
  --gradientBorder-gradient: linear-gradient(180deg, var(--min), var(--max), var(--min)), linear-gradient(15deg, var(--min) 50%, var(--max));
  --start: #000000e0;
  --opacity: 1;
  --text-accent-lighter: hsl(var(--accent-h), var(--accent-s), calc(var(--accent-l) + 25%));
"
    >
        <div
            class="flex w-full flex-col rounded-t-md p-2 pb-1 bg-[--background-primary]"
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
                class="resize-none border-0 !shadow-none p-1"
                placeholder={"Your text here"}
                oninput={updateHeight}
            ></textarea>

            <div class="flex w-full items-center">
                <div class="flex flex-row flex-1 gap-2">
                    <Dropdown
                        type="options"
                        dropdown={availModelsQuery.data?.map((model) => ({
                            display: model.model,
                            value: model,
                        })) ?? []}
                        selected={chatModel}
                        onSelect={(model) => (chatModel = model)}
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
</div>
