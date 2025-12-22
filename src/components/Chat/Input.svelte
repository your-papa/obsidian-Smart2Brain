<script lang="ts">
import { icon } from "../../utils/utils";
import { onMount } from "svelte";
import { getPlugin } from "../../stores/state.svelte";
import { MessageState, Messenger } from "../../stores/chatStore.svelte";
import { Notice, TFile } from "obsidian";
import ModelPopover from "../bitui/ModelPopover.svelte";
import FilePopover from "../base/FilePopover.svelte";
import { getWikiLinkAtCursor } from "../../utils/wikiLinkExtraction";

interface Props {
	messenger: Messenger;
	onFocusChange?: (focused: boolean) => void;
	onMessageSent?: () => void;
}

const baseOptions = ".txt, .json";

const { messenger, onFocusChange, onMessageSent }: Props = $props();

let textarea = $state<HTMLTextAreaElement | null>(null);
let inputValue = $state("");
let isFilePopoverOpen = $state(false);
let markdownFiles: TFile[] = $state([]);

// New: hidden combobox input ref & selected file value
let comboInputRef: HTMLInputElement | null = $state(null);
let fileSearchQuery = $state("");

const maxLines = 4;

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
	messenger.sendMessage(inputValue, files);
	files = [];
	inputValue = "";
	onMessageSent?.();
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
	const newSelectionEnd = selected.length ? caretPos + selected.length : caretPos;
	textarea.setSelectionRange(caretPos, newSelectionEnd);
	return [start, end];
}

function handleBracket(event: KeyboardEvent, textarea: HTMLTextAreaElement) {
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
	if (event.key === "[") handleBracket(event, event.target as HTMLTextAreaElement);
};

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

const handleKeyup = (event: KeyboardEvent) => {
	const textarea = event.target as HTMLTextAreaElement;
	const wikiLink = getWikiLinkAtCursor(textarea.value, textarea.selectionStart);
	if (wikiLink) {
		isFilePopoverOpen = true;
		fileSearchQuery = wikiLink.filePart;
	} else {
		if (isFilePopoverOpen) isFilePopoverOpen = false;
	}
};
</script>

<div
    class="chat-input-container w-full max-w-[--file-line-width] mx-auto bg-background-primary flex flex-col relative isolate gap-1"
    onfocusin={() => onFocusChange?.(true)}
    onfocusout={() => onFocusChange?.(false)}
>
    <button
        class="clickable-icon flex flex-row items-center gap-1 ml-auto"
        onclick={async () => await getPlugin().agentManager.createNewChat()}
    >
        <div
            class="h-icon-xs"
            use:icon={"plus"}
            style={"--icon-size: var(--icon-xs)"}
        ></div>
        <div class="text-xs">New Chat</div>
    </button>
    <!-- Input wrapper with glow effect -->
    <div
        class="chat-input-wrapper flex flex-col gap-3 bg-background-secondary border border-solid border-bg-modifier-border rounded-[14px] pb-2 px-3 transition-all duration-200 ease-in-out relative isolate"
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
            class="w-full px-0 pt-0 pb-[0.1rem] rounded-none !bg-transparent text-text-normal font-[inherit] text-[0.95rem] resize-none max-h-[200px] min-h-[40px] leading-[1.5] !outline-none !border-none !shadow-none"
            bind:this={textarea}
            bind:value={inputValue}
            onkeyup={handleKeyup}
            onkeydown={(event) => handleKeydown(event)}
            id="chat-view-user-input-element"
            placeholder={"Type a message..."}
            rows="1"
            oninput={updateHeight}
        ></textarea>

        <FilePopover
            customAnchor={textarea}
            files={markdownFiles}
            bind:isOpen={isFilePopoverOpen}
            bind:comboInputRef
            searchQuery={fileSearchQuery}
            {onFileSelect}
        />

        <!-- Actions row: model, attachment, send -->
        <div class="flex items-center">
            <ModelPopover />
            <input
                type="file"
                multiple={true}
                id="attachment"
                accept={baseOptions}
                style="display:none;"
                oninput={(event) => onFileAttachment(event)}
            />
            <label class="clickable-icon items-center gap-0.5" for="attachment">
                <div
                    class="w-[--icon-s] h-[--icon-s]"
                    style="--icon-size: var(--icon-xs)"
                    use:icon={"paperclip"}
                ></div>
                <div class="text-xs">Attach</div>
            </label>
            <div class="ml-auto">
                {#if !messenger.session || messenger.session.messageState === MessageState.idle}
                    <button
                        disabled={inputValue.trim().length === 0}
                        aria-label={"send message"}
                        title="Send message"
                        onclick={sendMessage}
                        class="h-7 w-7 p-1 rounded-md !bg-text-accent border-none cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        use:icon={"send-horizontal"}
                    ></button>
                {:else if messenger.session.messageState === MessageState.answering}
                    <button
                        aria-label={"stop streaming"}
                        title="Stop streaming"
                        onclick={() => messenger.session?.stopStreaming()}
                        class="h-7 w-7 p-1 rounded-md bg-interactive-accent text-text-on-accent border-none cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 hover:bg-interactive-accent-hover"
                        use:icon={"square"}
                    ></button>
                {/if}
            </div>
        </div>
    </div>

    <!-- Footer -->
    <div
        class="flex items-center justify-center text-[0.7rem] text-text-muted opacity-70"
    >
        <span>AI can make mistakes. Please check important information.</span>
    </div>
</div>

<style>
    /* Gradient fade above input - requires pseudo-element */
    .chat-input-container::before {
        content: "";
        position: absolute;
        top: -20px;
        left: 0;
        right: 0;
        height: 20px;
        background: linear-gradient(
            to bottom,
            transparent,
            color-mix(in srgb, var(--background-primary) 80%, transparent)
        );
        pointer-events: none;
    }

    /* Complex box-shadow with color-mix - requires CSS */
    .chat-input-wrapper {
        box-shadow:
            0 4px 16px rgba(0, 0, 0, 0.18),
            0 0 8px 0
                color-mix(in srgb, var(--interactive-accent) 10%, transparent);
    }

    /* Radial gradient glow effect behind input - requires pseudo-element */
    .chat-input-wrapper::before {
        content: "";
        position: absolute;
        inset: -10px;
        border-radius: inherit;
        background: radial-gradient(
            circle at 50% 35%,
            color-mix(in srgb, var(--interactive-accent) 35%, transparent),
            transparent 60%
        );
        opacity: 0.12;
        filter: blur(10px);
        z-index: -1;
        transition:
            opacity 0.25s ease,
            filter 0.25s ease;
        pointer-events: none;
    }

    .chat-input-wrapper:focus-within {
        border-color: var(--interactive-accent);
        box-shadow:
            0 6px 20px rgba(0, 0, 0, 0.24),
            0 0 14px 0
                color-mix(in srgb, var(--interactive-accent) 25%, transparent);
    }

    .chat-input-wrapper:focus-within::before {
        opacity: 0.22;
        filter: blur(9px);
    }
</style>
