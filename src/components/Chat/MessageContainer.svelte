<script lang="ts">
import { icon } from "../../utils/utils";
import MarkdownRenderer from "../base/MarkdownRenderer.svelte";
import { AssistantState, type AssistantMessage, type ChatModel, type Messenger } from "../../stores/chatStore.svelte";
import Dots from "../../utils/Dots.svelte";
import ToolCallsSection from "./ToolCallsSection.svelte";
import { Notice } from "obsidian";
import type { UUIDv7 } from "../../utils/uuid7Validator";
import Logo from "../Logos/Logo.svelte";
import { tick } from "svelte";

interface Props {
	messenger: Messenger;
	isInputFocused?: boolean;
}

const { messenger, isInputFocused = false }: Props = $props();

const messages = $derived.by(() => {
	return messenger.session?.messages;
});

const scrollContainer: HTMLDivElement | undefined = $state();
const messageRefs = new Map<string, HTMLDivElement>();

export async function scrollToLatestMessage() {
	await tick();
	if (messages && messages.length > 0 && scrollContainer) {
		const latestPair = messages[messages.length - 1];
		const messageElement = messageRefs.get(`${latestPair.id}-user`);

		if (messageElement && scrollContainer) {
			const containerTop = scrollContainer.getBoundingClientRect().top;
			const messageTop = messageElement.getBoundingClientRect().top;
			const currentScroll = scrollContainer.scrollTop;

			// Calculate scroll position to place message at top of container
			const targetScroll = currentScroll + (messageTop - containerTop);

			scrollContainer.scrollTo({
				top: targetScroll,
				behavior: "smooth",
			});
		}
	}
}

// Svelte action to register message refs
function registerMessageRef(node: HTMLDivElement, id: string) {
	messageRefs.set(id, node);
	return {
		destroy() {
			messageRefs.delete(id);
		},
	};
}

function renderAssitantAnswer(assistantAnswer: AssistantMessage) {
	if (assistantAnswer.state === AssistantState.cancelled) {
		return "> [!Warning] stopped by user";
	}
	if (assistantAnswer.state === AssistantState.error) {
		return "> [!Error] an error occured";
	}
	return assistantAnswer.content;
}

async function copyToClipboard(content: string) {
	await navigator.clipboard.writeText(content);
	new Notice("Copied to Clipboard");
}

async function redoMessage(messageId: UUIDv7, model: ChatModel) {
	console.log("todo resend");
}

async function branchOff(messageId: UUIDv7) {
	console.log("todo branch off");
}

// Track which message pairs have their tools open
const toolsOpenState: Record<string, boolean> = $state({});

function getToolsOpen(messageId: string, assistantMessage: AssistantMessage): boolean {
	// Default: open if no content yet, closed if content exists
	if (toolsOpenState[messageId] === undefined) {
		return !assistantMessage.content || assistantMessage.content.length === 0;
	}
	return toolsOpenState[messageId];
}

function setToolsOpen(messageId: string, open: boolean) {
	toolsOpenState[messageId] = open;
}
</script>

<div class="relative flex-1 min-h-0 z-20">
    <!-- Scrollable messages area -->
    <div bind:this={scrollContainer} class="scroll-container h-full overflow-y-auto px-2 py-4">
        <div class="w-full max-w-[--file-line-width] mx-auto h-full">
            {#if !messages || messages.length === 0}
                <!-- Empty state with logo -->
                <div class="flex flex-col items-center justify-center h-full">
                    <div
                        class="logo-container h-[80px] w-[80px] items-center justify-center transition-transform duration-150 ease-out"
                        class:input-focused={isInputFocused}
                    >
                        <Logo />
                    </div>
                    <p class="text-lg mb-1">Start a new conversation</p>
                    <p class="text-sm opacity-70">
                        Ask me anything about your notes.
                    </p>
                </div>
            {:else}
                {#each messages as messagePair, index}
                    <div
                        use:registerMessageRef={messagePair.id + "-user"}
                        class="group mr-2 flex flex-col items-end gap-2 mb-2"
                    >
                        <MarkdownRenderer
                            content={messagePair.userMessage.content}
                            class="max-w-[80%] rounded-t-lg rounded-bl-lg bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] border border-solid border-1 border-[--color-accent] px-4 py-2 [&>p]:m-0"
                        />

                        <div
                            class="flex flex-row gap-2 transform opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto transition-all duration-200 ease-out"
                        >
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                use:icon={"refresh-cw"}
                                class="trash-icon hover:text-[--text-accent] items-center justify-center"
                                onclick={async () =>
                                    console.log("redo Message")}
                            ></div>

                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                use:icon={"split"}
                                class="trash-icon hover:text-[--text-accent] items-center justify-center"
                                onclick={() => console.log("split")}
                            ></div>

                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                use:icon={"edit"}
                                class="trash-icon hover:text-[--text-accent] items-center justify-center"
                                onclick={async () => console.log("edit")}
                            ></div>

                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                use:icon={"copy"}
                                class="trash-icon hover:text-[--text-accent] items-center justify-center"
                                onclick={async () =>
                                    copyToClipboard(
                                        messagePair.userMessage.content,
                                    )}
                            ></div>
                        </div>
                    </div>
                    <div class:min-h-[95%]={index === messages.length - 1}>
                        <div class="group flex flex-col px-2 gap-3 mb-2 w-full">
                            <!-- Tools Section (collapsible) -->
                            {#if messagePair.assistantMessage.toolCalls?.length}
                                <ToolCallsSection
                                    toolCalls={messagePair.assistantMessage
                                        .toolCalls}
                                    isOpen={getToolsOpen(
                                        messagePair.id,
                                        messagePair.assistantMessage,
                                    )}
                                    onToggle={(open) =>
                                        setToolsOpen(messagePair.id, open)}
                                />
                            {/if}

                            <!-- Content Section -->
                            {#if messagePair.assistantMessage.state === AssistantState.streaming && !messagePair.assistantMessage.content}
                                <Dots
                                    size={"35"}
                                    color={"var(--text-accent)"}
                                />
                            {:else if messagePair.assistantMessage.content || messagePair.assistantMessage.state === AssistantState.cancelled || messagePair.assistantMessage.state === AssistantState.error}
                                <MarkdownRenderer
                                    content={renderAssitantAnswer(messagePair.assistantMessage)}
                                    class="message-text markdown-preview-view leading-[1.5] !p-0 !w-full !max-w-full !m-0 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_code]:bg-code-background [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.9em]"
                                />
                            {:else if messagePair.assistantMessage.state === AssistantState.idle || messagePair.assistantMessage.state === AssistantState.streaming}
                                <!-- Show loading dots only if streaming and no content yet (and no tool calls) -->
                                {#if !messagePair.assistantMessage.toolCalls?.length}
                                    <Dots
                                        size={"50"}
                                        color={"var(--text-accent)"}
                                    />
                                {/if}
                            {/if}

                            {#if !(messagePair.assistantMessage.state === AssistantState.streaming)}
                                <div
                                    class="flex flex-row gap-2 transform opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto transition-all duration-200 ease-out"
                                >
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        use:icon={"copy"}
                                        class="trash-icon hover:text-[--text-accent] items-center justify-center"
                                        onclick={async () =>
                                            copyToClipboard(
                                                messagePair.assistantMessage
                                                    .content,
                                            )}
                                    ></div>
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        use:icon={"split"}
                                        class="trash-icon hover:text-[--text-accent] items-center justify-center"
                                        onclick={() =>
                                            branchOff(messagePair.id)}
                                    >
                                        >
                                    </div>
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        use:icon={"refresh-cw"}
                                        class="trash-icon hover:text-[--text-accent] items-center justify-center"
                                        onclick={async () =>
                                            console.log("redo Message")}
                                    ></div>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
</div>

<style>
    .scroll-container {
        /* Enable native elastic/rubber-band scrolling on macOS/iOS */
        -webkit-overflow-scrolling: touch;
        /* Allow the container to have its own scroll bounce */
        overscroll-behavior: contain;
    }

    .logo-container :global(svg) {
        width: 100%;
        height: 100%;
        fill: var(--text-faint);
        stroke: var(--text-faint);
        transition:
            fill 0.15s ease-out,
            stroke 0.15s ease-out,
            filter 0.15s ease-out;
    }

    .logo-container.input-focused {
        transform: translateY(-2px) scale(1.02);
    }

    .logo-container.input-focused :global(svg) {
        fill: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
        stroke: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
        filter: drop-shadow(
                0 0 8px
                    color-mix(
                        in srgb,
                        var(--interactive-accent) 30%,
                        transparent
                    )
            )
            drop-shadow(
                0 4px 10px
                    color-mix(
                        in srgb,
                        var(--interactive-accent) 18%,
                        transparent
                    )
            );
    }
</style>
