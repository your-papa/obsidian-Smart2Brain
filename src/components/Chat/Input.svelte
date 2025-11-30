<script lang="ts">
    import { icon } from "../../utils/utils";
    import { onMount } from "svelte";
    import { getPlugin, modelQuery } from "../../stores/state.svelte";
    import {
        CurrentSession,
        MessageState,
        Messenger,
        type ChatModel,
    } from "../../stores/chatStore.svelte";
    import { Notice, TFile } from "obsidian";
    import ModelPopover from "../bitui/ModelPopover.svelte";
    import FilePopover from "../base/FilePopover.svelte";
    import { getWikiLinkAtCursor } from "../../utils/wikiLinkExtraction";

    interface Props {
        messengner: Messenger;
        currentSession: CurrentSession;
    }

    const baseOptions = ".txt, .json";

    const { messengner, currentSession }: Props = $props();

    let textarea = $state<HTMLTextAreaElement | null>(null);
    let inputValue = $state("");
    let isFilePopoverOpen = $state(false);
    let markdownFiles: TFile[] = $state([]);

    // New: hidden combobox input ref & selected file value
    let comboInputRef: HTMLInputElement | null = $state(null);
    let fileSearchQuery = $state("");
    let isFocused = $state(false);

    const maxLines = 4;

    let chatModel: ChatModel | null = $state(null);

    onMount(() => {
        const plugin = getPlugin();
        markdownFiles = plugin.app.vault.getMarkdownFiles();
        resetHeight();
        const resizeObserver = new ResizeObserver(() => {
            updateHeight();
        });
        if (textarea) resizeObserver.observe(textarea);
        return () => resizeObserver.disconnect();
    });

    function resetHeight() {
        if (!textarea) return;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.max(textarea.scrollHeight, 20)}px`;
    }

    function updateHeight() {
        if (!textarea) return;
        textarea.style.height = "auto";
        const scrollHeight = textarea.scrollHeight;
        const lineHeight = 20;
        const maxHeight = lineHeight * maxLines;
        if (scrollHeight <= maxHeight) {
            textarea.style.height = `${scrollHeight}px`;
            textarea.style.overflowY = "hidden";
        } else {
            textarea.style.height = `${maxHeight}px`;
            textarea.style.overflowY = "auto";
        }
    }

    let files: File[] = $state([]);

    function sendMessage() {
        if (!chatModel) return;
        messengner.sendMessage(currentSession, inputValue, chatModel, files);
        files = [];
        inputValue = "";
    }

    const handleEnter = (event: KeyboardEvent) => {
        if (event.shiftKey && event.key === "Enter") {
            return;
        }
        event.preventDefault();

        if (inputValue.trim().length !== 0) {
            sendMessage();
        } else {
            new Notice("Your second brain does not understand empty messages");
        }
    };

    function autoCloseBracket(textarea: HTMLTextAreaElement) {
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? start;
        const value = textarea.value;
        const before = value.slice(0, start);
        const selected = value.slice(start, end);
        const after = value.slice(end);
        const insertion = selected.length ? `[${selected}]` : `[]`;
        textarea.value = before + insertion + after;
        const caretPos = start + 1;
        const newSelectionEnd = selected.length
            ? caretPos + selected.length
            : caretPos;
        textarea.setSelectionRange(caretPos, newSelectionEnd);
        return [start, end];
    }

    function handleBracket(
        event: KeyboardEvent,
        textarea: HTMLTextAreaElement,
    ) {
        event.preventDefault();
        const [start, end] = autoCloseBracket(textarea);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Insert selected filename into the current [] region
    const onFileSelect = (name: string) => {
        if (!textarea || !name) return;
        const value = textarea.value;
        const cursor = textarea.selectionStart ?? 0;

        const ctx = getWikiLinkAtCursor(value, cursor);
        if (!ctx) return; // per your assumption this shouldn't happen

        // Replace the inner range [innerStart, innerEnd)
        textarea.setRangeText(name, ctx.innerStart, ctx.innerEnd, "preserve");

        // Compute new fullEnd after replacement and place caret just after ]]
        const delta = name.length - (ctx.innerEnd - ctx.innerStart);
        const newFullEnd = ctx.fullEnd + delta;
        textarea.setSelectionRange(newFullEnd, newFullEnd);

        // Notify any bindings/framework
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const handleKeydown = (event: KeyboardEvent) => {
        if (isFilePopoverOpen) {
            const keys = ["ArrowDown", "ArrowUp", "Enter", "Escape"];
            if (keys.includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                comboInputRef?.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: event.key,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
                // Do not fall through to Enter handling here;
                // Combobox will handle selection/close, effect will insert.
                return;
            }
        }

        if (event.key === "Enter") handleEnter(event);
        if (event.key === "[")
            handleBracket(event, event.target as HTMLTextAreaElement);
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
    const handleKeyup = (event: KeyboardEvent) => {
        const textarea = event.target as HTMLTextAreaElement;
        const wikiLink = getWikiLinkAtCursor(
            textarea.value,
            textarea.selectionStart,
        );
        if (wikiLink) {
            isFilePopoverOpen = true;
            fileSearchQuery = wikiLink.filePart;
        } else {
            if (isFilePopoverOpen) isFilePopoverOpen = false;
        }
    };
</script>

<div class="w-full sticky bottom-1">
    <div
        class="mx-auto my-0 p-1 border-standard trans-bg backdrop-blur-lg rounded-lg max-w-[500px]"
        class:trans-border={isFocused}
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
            onkeyup={handleKeyup}
            onkeydown={(event) => handleKeydown(event)}
            id="chat-view-user-input-element"
            class="resize-none text-[length:--font-text-size] border-0 !shadow-none p-1 w-full !bg-transparent"
            placeholder={"Type your message here..."}
            oninput={updateHeight}
            onfocus={() => (isFocused = true)}
            onblur={() => (isFocused = false)}
        ></textarea>

        <FilePopover
            customAnchor={textarea}
            files={markdownFiles}
            bind:isOpen={isFilePopoverOpen}
            bind:comboInputRef
            searchQuery={fileSearchQuery}
            {onFileSelect}
        />

        <div class="flex w-full items-center">
            <div class="flex flex-row flex-1 gap-1">
                <ModelPopover model={chatModel} {setModel} />
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
                    disabled={inputValue.trim().length === 0}
                    aria-label={"send message"}
                    onclick={sendMessage}
                    class="h-7 w-7 p-1 rounded-r-md transition duration-300 ease-in-out !bg-[--text-accent] !text-[--background-primary]"
                    use:icon={"send-horizontal"}
                ></button>
            {:else if currentSession.session.messageState === MessageState.answering}
                <button
                    aria-label={"stop streaming"}
                    onclick={stopMessage}
                    class="h-7 w-7 p-1 rounded-r-md transition duration-300 ease-in-out !bg-[--text-accent] !text-[--background-primary]"
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

    .border-standard {
        outline: 2px solid var(--background-modifier-border-hover);
    }

    .trans-border {
        outline: 4px solid
            color-mix(in oklab, var(--text-accent) 70%, transparent);
    }
</style>
