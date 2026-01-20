<script lang="ts">
import { Notice } from "obsidian";
import { onDestroy, onMount } from "svelte";
import { EmbeddableMarkdownEditor } from "../../editor/EmbeddableMarkdownEditor";
import { MessageState, type Messenger } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";
import ModelPopover from "../bitui/ModelPopover.svelte";

interface Props {
	messenger: Messenger;
	onFocusChange?: (focused: boolean) => void;
	onMessageSent?: () => void;
}

const baseOptions = ".txt, .json";

const { messenger, onFocusChange, onMessageSent }: Props = $props();

// biome-ignore lint/style/useConst: Svelte bind:this requires let
let editorContainer: HTMLDivElement | undefined = $state();
let markdownEditor: EmbeddableMarkdownEditor | undefined = $state();
let inputValue = $state("");

let files: File[] = $state([]);

onMount(() => {
	// Initialize the markdown editor once the container is ready
	if (editorContainer) {
		initializeEditor();
	}
});

onDestroy(() => {
	markdownEditor?.destroy();
});

function initializeEditor() {
	if (!editorContainer) return;

	const plugin = getPlugin();

	markdownEditor = new EmbeddableMarkdownEditor(plugin.app, editorContainer, {
		value: inputValue,
		placeholder: "Type a message...",
		cls: "chat-markdown-editor",
		onChange: (value) => {
			inputValue = value;
		},
		onEnter: (_editor, _mod, shift) => {
			// Shift+Enter: allow newline (return false to use default behavior)
			if (shift) {
				return false;
			}

			// Regular Enter: send message
			if (inputValue.trim().length !== 0) {
				sendMessage();
			} else {
				new Notice("Your second brain does not understand empty messages");
			}
			return true;
		},
		onSubmit: () => {
			// Mod+Enter: send message
			if (inputValue.trim().length !== 0) {
				sendMessage();
			}
		},
		onFocus: () => {
			onFocusChange?.(true);
		},
		onBlur: () => {
			onFocusChange?.(false);
		},
	});

	// Focus the editor after initialization
	setTimeout(() => {
		markdownEditor?.focus();
	}, 100);
}

function sendMessage() {
	messenger.sendMessage(inputValue, files);
	files = [];
	inputValue = "";
	markdownEditor?.clear();
	onMessageSent?.();
}

function onFileAttachment(event: Event) {
	const input = event.target as HTMLInputElement;
	const fileList = input.files;
	if (fileList) {
		for (const file of fileList) {
			files.push(file);
		}
		new Notice("New files attached");
	}
}

function removeAttachedFile(file: File) {
	files.remove(file);
}
</script>

<div
    class="chat-input-container w-full max-w-[--file-line-width] mx-auto bg-background-primary flex flex-col relative isolate gap-1"
>
    <button
        class="clickable-icon flex flex-row items-center gap-1 ml-auto"
        onclick={async () => await getPlugin().agentManager.createNewChat()}
    >
        <div
            class="h-icon-xs"
            use:icon={"plus"}
            style="--icon-size: var(--icon-xs)"
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
                            style="--icon-size: var(--icon-xs)"
                        ></div>
                    {:else if file.type === "application/json"}
                        <div
                            class="p-0 flex items-center"
                            use:icon={"file-json"}
                            style="--icon-size: var(--icon-xs)"
                        ></div>
                    {/if}
                    <div class="text-xs">
                        {file.name}
                    </div>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        use:icon={"x"}
                        style="--icon-size: 10px"
                        onclick={() => removeAttachedFile(file)}
                        class="hover:bg-[buttonface] flex items-center justify-center h-4 w-4 bg-white rounded-sm mr-1 my-1"
                    ></div>
                </div>
            {/each}
        </div>

        <!-- Markdown Editor Container -->
        <div
            bind:this={editorContainer}
            class="markdown-editor-container w-full min-h-[40px] max-h-[200px] overflow-y-auto"
            id="chat-view-user-input-element"
        ></div>

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
                        aria-label="send message"
                        title="Send message"
                        onclick={sendMessage}
                        class="h-7 w-7 p-1 rounded-md !bg-text-accent border-none cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        use:icon={"send-horizontal"}
                    ></button>
                {:else if messenger.session.messageState === MessageState.answering}
                    <button
                        aria-label="stop streaming"
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

    /* Markdown editor styling */
    .markdown-editor-container {
        /* Reset some CM6 styles for chat input look */
        :global(.cm-editor) {
            background: transparent !important;
            font-family: inherit;
            font-size: 0.95rem;
        }

        :global(.cm-editor.cm-focused) {
            outline: none !important;
        }

        :global(.cm-scroller) {
            overflow-x: hidden;
        }

        :global(.cm-content) {
            padding: 0 !important;
            caret-color: var(--text-normal);
        }

        :global(.cm-line) {
            padding: 0 !important;
            line-height: 1.5;
        }

        :global(.cm-placeholder) {
            color: var(--text-muted);
            font-style: normal;
        }
    }
</style>
