<script lang="ts">
    import { render } from "svelte/server";
    import { icon, renderMarkdown } from "../../utils/utils";
    import {
        AssistantState,
        type AssistantMessage,
        type ChatModel,
        type CurrentSession,
        type Messenger,
    } from "./chatState.svelte";
    import Dots from "../../utils/Dots.svelte";
    import { Notice } from "obsidian";
    import type { UUIDv7 } from "../../utils/uuid7Validator";

    interface Props {
        messenger: Messenger;
        currentSession: CurrentSession;
    }

    const { messenger, currentSession }: Props = $props();

    const messages = $derived.by(() => {
        const session = currentSession.session;
        const getMessagesFunction = session?.getMessages();
        return getMessagesFunction;
    });

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
        currentSession.session?.resendMessage(messageId, model);
    }

    async function branchOff(messageId: UUIDv7) {
        if (currentSession.session) {
            const id = await messenger.branchOffFromMessage(
                currentSession.session.chatId,
                messageId,
            );
            console.log(id);
        }
    }
</script>

<div class="flex-1 gap-1 mb-2">
    {#each messages!! as messagePair}
        <div class="group mr-2 flex flex-col items-end gap-2 mb-2">
            <div
                class="max-w-[80%] rounded-t-lg rounded-bl-lg bg-[--text-selection] px-4 py-2 [&>p]:m-0"
                use:renderMarkdown={messagePair.userMessage.content}
            ></div>

            <div
                class="flex flex-row gap-2 transform opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto transition-all duration-200 ease-out"
            >
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    use:icon={"refresh-cw"}
                    class="trash-icon hover:text-[--text-accent] items-center justify-center"
                    onclick={async () =>
                        redoMessage(messagePair.id, messagePair.model)}
                ></div>

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    use:icon={"split"}
                    class="trash-icon hover:text-[--text-accent] items-center justify-center"
                    onclick={() => console.log("split")}
                ></div>

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    use:icon={"edit"}
                    class="trash-icon hover:text-[--text-accent] items-center justify-center"
                    onclick={async () => console.log("edit")}
                ></div>

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    use:icon={"copy"}
                    class="trash-icon hover:text-[--text-accent] items-center justify-center"
                    onclick={async () =>
                        copyToClipboard(messagePair.userMessage.content)}
                ></div>
            </div>
        </div>

        <div class="group flex flex-col px-2 gap-2 mb-2">
            {#if !messagePair.assistantMessage.content}
                <Dots size={"50"} color={"var(--text-accent)"} />
            {:else}
                <div
                    class="[&>p]:m-0"
                    use:renderMarkdown={renderAssitantAnswer(
                        messagePair.assistantMessage,
                    )}
                ></div>
            {/if}
            {#if !(messagePair.assistantMessage.state === AssistantState.streaming)}
                <div
                    class="flex flex-row gap-2 transform opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto transition-all duration-200 ease-out"
                >
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        use:icon={"copy"}
                        class="trash-icon hover:text-[--text-accent] items-center justify-center"
                        onclick={async () =>
                            copyToClipboard(
                                messagePair.assistantMessage.content,
                            )}
                    ></div>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        use:icon={"split"}
                        class="trash-icon hover:text-[--text-accent] items-center justify-center"
                        onclick={() => branchOff(messagePair.id)}
                    >
                        >
                    </div>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        use:icon={"refresh-cw"}
                        class="trash-icon hover:text-[--text-accent] items-center justify-center"
                        onclick={async () =>
                            redoMessage(messagePair.id, messagePair.model)}
                    ></div>
                </div>
            {/if}
        </div>
    {/each}
</div>
