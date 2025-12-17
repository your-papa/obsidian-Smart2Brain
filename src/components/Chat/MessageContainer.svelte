<script lang="ts">
    import { icon } from "../../utils/utils";
    import { createMarkdownRenderer } from "../../utils/markdownHelper";
    import { getPlugin } from "../../stores/state.svelte";
    import {
        AssistantState,
        type AssistantMessage,
        type ChatModel,
        type CurrentSession,
        type Messenger,
    } from "../../stores/chatStore.svelte";
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

    const markdownRenderer = (node: HTMLElement, content: string) => {
        const plugin = getPlugin();
        const renderer = createMarkdownRenderer({
            app: plugin.app,
            container: node,
            sourcePath: plugin.app.workspace.getActiveFile()?.path ?? "",
            component: plugin,
            content,
        });

        return {
            update(value: string) {
                renderer.update(value);
            },
            destroy() {
                renderer.destroy();
            },
        };
    };

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

    function formatToolInput(
        input: Record<string, unknown> | null | undefined,
    ): { key: string; value: string }[] {
        if (!input) return [];
        return Object.entries(input).map(([key, value]) => ({
            key,
            value:
                typeof value === "string"
                    ? value
                    : value === null || value === undefined
                      ? ""
                      : JSON.stringify(value),
        }));
    }
</script>

<div class="flex-1 gap-1 mb-2">
    {#each messages!! as messagePair}
        <div class="group mr-2 flex flex-col items-end gap-2 mb-2">
            <div
                class="max-w-[80%] rounded-t-lg rounded-bl-lg bg-[--text-selection] px-4 py-2 [&>p]:m-0"
                use:markdownRenderer={messagePair.userMessage.content}
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
                    use:markdownRenderer={renderAssitantAnswer(
                        messagePair.assistantMessage,
                    )}
                ></div>
            {/if}

            {#if messagePair.assistantMessage.toolCalls?.length}
                <div
                    class="flex flex-col gap-2 rounded border border-[var(--background-modifier-border)] bg-[var(--background-secondary)] p-2"
                >
                    <div class="text-xs font-semibold text-[var(--text-muted)]">
                        Tools
                    </div>
                    {#each messagePair.assistantMessage.toolCalls as toolCall (toolCall.id)}
                        <div
                            class="rounded border border-[var(--background-modifier-border-hover)] bg-[var(--background-primary)] p-2 text-xs space-y-1"
                        >
                            <div class="flex items-center gap-2">
                                <span class="font-semibold"
                                    >{toolCall.name}</span
                                >
                                <span
                                    class="uppercase tracking-wide text-[10px]"
                                >
                                    {toolCall.status}
                                </span>
                                {#if toolCall.id}
                                    <span
                                        class="text-[10px] opacity-60 truncate"
                                    >
                                        {toolCall.id}
                                    </span>
                                {/if}
                            </div>

                            {#if formatToolInput(toolCall.input).length > 0}
                                <div class="space-y-0.5">
                                    <div class="font-semibold">Input</div>
                                    {#each formatToolInput(toolCall.input) as item (item.key)}
                                        <div class="flex gap-2">
                                            <span
                                                class="text-[10px] uppercase tracking-wide"
                                            >
                                                {item.key}
                                            </span>
                                            <span class="break-words"
                                                >{item.value}</span
                                            >
                                        </div>
                                    {/each}
                                </div>
                            {/if}

                            {#if toolCall.output !== undefined}
                                <div class="space-y-0.5">
                                    <div class="font-semibold">Output</div>
                                    <pre
                                        class="whitespace-pre-wrap break-words text-[11px]">
{JSON.stringify(toolCall.output, null, 2)}
                                    </pre>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
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
