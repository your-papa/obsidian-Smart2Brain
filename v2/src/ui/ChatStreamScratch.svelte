<script lang="ts">
    /**
     * Scratchpad: streaming chat handler using agentManager.streamQuery
     * Svelte 5 runes + helpers for readability.
     *
     * This is intentionally self-contained and not wired to persistence or UI chrome.
     */

    import type { ThreadMessageToolCall } from "papa-ts";
    import { onMount } from "svelte";

    // ----- Props -----
    interface AgentManager {
        streamQuery(
            prompt: string,
            threadId: string,
        ): AsyncIterable<StreamChunk>;
    }

    interface PluginLike {
        agentManager: AgentManager;
    }

    interface Props {
        plugin: PluginLike;
        threadId?: string;
    }

    const { plugin, threadId }: Props = $props();

    // ----- Message + tool call types -----
    type Role = "user" | "assistant" | "tool";

    interface TextContent {
        type: "text";
        text: string;
    }

    interface ToolCallState {
        id: string;
        name: string;
        input: Record<string, unknown>;
        status: "running" | "completed";
        output?: unknown;
    }

    interface UIMessage {
        id: string;
        role: Role;
        content: TextContent[];
        toolCalls?: ToolCallState[];
        timestamp: number;
    }

    // ----- Stream chunk types (aligned to agentManager.streamQuery) -----
    interface NormalizedMessage {
        id?: string;
        role: Role;
        content?: unknown;
        toolCalls?: ThreadMessageToolCall[];
        // Optional legacy keys for tool outputs
        tool_call_id?: string;
        toolCallId?: string;
        name?: string;
    }

    type ChunkType = "token" | "result" | "message";

    interface TokenChunk {
        type: "token";
        token: string;
    }

    interface ResultChunk {
        type: "result";
        result?: { messages?: NormalizedMessage[] };
    }

    interface MessageChunk {
        type: "message";
        messages: NormalizedMessage[];
    }

    type StreamChunk = TokenChunk | ResultChunk | MessageChunk;

    // ----- State -----
    let currentThreadId = $state(threadId ?? crypto.randomUUID());
    let input = $state("");
    let isLoading = $state(false);
    let messages = $state<UIMessage[]>([]);

    // Derived: last assistant message (if any)
    const lastAssistant = $derived(
        messages.length
            ? messages[messages.length - 1]
            : null,
    );

    // ----- Helpers -----
    function now(): number {
        return Date.now();
    }

    function createUserMessage(text: string): UIMessage {
        return {
            id: crypto.randomUUID(),
            role: "user",
            content: [{ type: "text", text }],
            timestamp: now(),
        };
    }

    function createAssistantPlaceholder(): UIMessage {
        return {
            id: crypto.randomUUID(),
            role: "assistant",
            content: [{ type: "text", text: "" }],
            timestamp: now(),
            toolCalls: [],
        };
    }

    function normalizeToolInput(raw: unknown): Record<string, unknown> {
        if (raw === undefined || raw === null) return {};
        if (typeof raw === "string") {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    return parsed as Record<string, unknown>;
                }
                return { value: parsed };
            } catch {
                return { input: raw };
            }
        }
        if (Array.isArray(raw)) return { value: raw };
        if (typeof raw === "object") return raw as Record<string, unknown>;
        return { value: raw };
    }

    function upsertToolCall(
        msg: UIMessage,
        tc: ThreadMessageToolCall,
    ): ToolCallState {
        if (!msg.toolCalls) msg.toolCalls = [];
        const idx = msg.toolCalls.findIndex((t) => t.id === tc.id);
        const base: ToolCallState = {
            id: tc.id,
            name: tc.name,
            input: normalizeToolInput((tc as any).arguments),
            status: "running",
        };
        if (idx >= 0) {
            msg.toolCalls[idx] = { ...base, output: msg.toolCalls[idx].output };
            return msg.toolCalls[idx];
        }
        msg.toolCalls.push(base);
        return base;
    }

    function attachToolOutput(
        msg: UIMessage,
        toolCallId: string,
        output: unknown,
        name?: string,
    ) {
        if (!msg.toolCalls) msg.toolCalls = [];
        const idx = msg.toolCalls.findIndex((t) => t.id === toolCallId);
        if (idx >= 0) {
            msg.toolCalls[idx] = {
                ...msg.toolCalls[idx],
                status: "completed",
                output,
            };
            return;
        }
        msg.toolCalls.push({
            id: toolCallId,
            name: name ?? "tool",
            input: {},
            status: "completed",
            output,
        });
    }

    function appendToken(msg: UIMessage, token: string) {
        const first = msg.content[0];
        if (first?.type === "text") {
            first.text += token;
        } else {
            msg.content.unshift({ type: "text", text: token });
        }
    }

    // ----- Streaming pipeline -----
    async function sendMessage() {
        if (!input.trim() || isLoading) return;
        const userText = input.trim();
        input = "";

        const userMsg = createUserMessage(userText);
        const assistantMsg = createAssistantPlaceholder();
        const assistantIndex = messages.length + 1; // after push

        messages.push(userMsg);
        messages.push(assistantMsg);
        isLoading = true;

        try {
            for await (const chunk of plugin.agentManager.streamQuery(
                userText,
                currentThreadId,
            )) {
                const target = messages[assistantIndex];
                if (!target) continue;

                if (chunk.type === "token") {
                    appendToken(target, chunk.token);
                    messages = messages;
                    continue;
                }

                const normalizedMessages =
                    chunk.type === "message"
                        ? chunk.messages
                        : chunk.type === "result"
                          ? chunk.result?.messages ?? []
                          : [];

                if (normalizedMessages.length) {
                    // Find the current turn (after the last user in the chunk)
                    let start = 0;
                    for (let i = normalizedMessages.length - 1; i >= 0; i--) {
                        if (normalizedMessages[i].role === "user") {
                            start = i + 1;
                            break;
                        }
                    }

                    for (let i = start; i < normalizedMessages.length; i++) {
                        const msg = normalizedMessages[i];
                        if (msg.role === "assistant" && msg.toolCalls?.length) {
                            for (const tc of msg.toolCalls) {
                                upsertToolCall(target, tc);
                            }
                        }
                        if (msg.role === "tool") {
                            const toolCallId = (msg.tool_call_id || msg.toolCallId) as
                                | string
                                | undefined;
                            if (toolCallId) {
                                attachToolOutput(target, toolCallId, msg.content, msg.name);
                            }
                        }
                        if (msg.role === "assistant" && msg.content) {
                            // If final assistant content arrives in result chunk, replace text
                            target.content = [{ type: "text", text: String(msg.content) }];
                        }
                    }
                }

                // If a result chunk has final assistant, prefer it
                if (chunk.type === "result" && normalizedMessages.length) {
                    const lastMsg = normalizedMessages[normalizedMessages.length - 1];
                    if (lastMsg.role === "assistant") {
                        target.content = [
                            { type: "text", text: String(lastMsg.content ?? "") },
                        ];
                    }
                }

                messages = messages;
            }
        } catch (err) {
            const target = messages[assistantIndex];
            if (target) {
                target.content = [
                    {
                        type: "text",
                        text: `Error: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    },
                ];
                messages = messages;
            }
        } finally {
            isLoading = false;
        }
    }

    // Simple demo: auto-create a greeting on mount (optional)
    onMount(() => {
        if (!messages.length) {
            messages.push({
                id: crypto.randomUUID(),
                role: "assistant",
                content: [{ type: "text", text: "Hi! This is a scratchpad." }],
                timestamp: now(),
            });
        }
    });
</script>

<!-- Minimal UI for scratchpad/testing -->
<div class="p-4 space-y-3">
    <div class="space-y-2">
        {#each messages as msg (msg.id)}
            <div class="rounded border border-[var(--background-modifier-border)] p-2">
                <div class="text-xs text-[var(--text-faint)]">
                    {msg.role} • {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
                <div class="text-sm whitespace-pre-wrap">
                    {#each msg.content as c}
                        {c.type === "text" ? c.text : ""}
                    {/each}
                </div>
                {#if msg.toolCalls?.length}
                    <div class="mt-1 text-xs text-[var(--text-muted)] space-y-1">
                        {#each msg.toolCalls as tc (tc.id)}
                            <div class="flex items-start gap-2">
                                <span class="font-semibold">{tc.name}</span>
                                <span class="text-[10px] uppercase tracking-wide">
                                    {tc.status}
                                </span>
                                <span class="truncate">
                                    {tc.output ? JSON.stringify(tc.output) : ""}
                                </span>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}
    </div>

    <div class="flex gap-2 items-start">
        <textarea
            class="flex-1 rounded border border-[var(--background-modifier-border)] bg-[var(--background-secondary)] p-2 text-sm"
            rows="2"
            bind:value={input}
            placeholder="Type a prompt..."
        ></textarea>
        <button
            class="px-3 py-2 rounded bg-[var(--interactive-accent)] text-[var(--text-on-accent)] text-sm"
            disabled={isLoading || !input.trim()}
            onclick={sendMessage}
        >
            {isLoading ? "Streaming..." : "Send"}
        </button>
    </div>
</div>
