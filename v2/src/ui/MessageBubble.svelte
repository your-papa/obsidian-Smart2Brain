<script lang="ts">
    import { Component } from "obsidian";
    import { onMount, onDestroy } from "svelte";
    import type SmartSecondBrainPlugin from "../main";
    import type { UIMessage, ToolCallState } from "./types";
    import {
        formatToolInput,
        formatValue,
        formatToolName,
        formatToolOutput,
        renderMarkdown,
    } from "./markdownHelper";

    export let message: UIMessage;
    export let plugin: SmartSecondBrainPlugin;

    let messageContainer: HTMLElement;
    const component = new Component();

    // Map to store tool output containers and their components
    const toolOutputContainers = new Map<string, HTMLElement>();
    const toolOutputComponents = new Map<string, Component>();
    const toolOutputCleanups = new Map<string, () => void>();

    // Helper to extract text content from ThreadMessage
    function getMessageContent(msg: UIMessage): string {
        if (!msg.content) return "";
        if (Array.isArray(msg.content)) {
            return msg.content
                .map((c: any) => {
                    if (c.type === "text") return c.text;
                    if (c.type === "json") return JSON.stringify(c.data);
                    return "";
                })
                .join("\n");
        }
        return typeof msg.content === "string"
            ? msg.content
            : String(msg.content);
    }

    // Svelte action to bind container and render tool output
    function bindToolOutputContainer(node: HTMLElement, toolCallId: string) {
        toolOutputContainers.set(toolCallId, node);

        // Find the tool call to get its output
        const toolCall = message.toolCalls?.find((tc) => tc.id === toolCallId);
        if (toolCall && toolCall.output && toolCall.status === "completed") {
            renderToolOutput(toolCallId, toolCall.output, node);
        }

        return {
            update(newToolCallId: string) {
                if (newToolCallId !== toolCallId) {
                    toolOutputContainers.delete(toolCallId);
                    toolOutputContainers.set(newToolCallId, node);
                    const toolCall = message.toolCalls?.find(
                        (tc) => tc.id === newToolCallId,
                    );
                    if (
                        toolCall &&
                        toolCall.output &&
                        toolCall.status === "completed"
                    ) {
                        renderToolOutput(newToolCallId, toolCall.output, node);
                    }
                }
            },
            destroy() {
                toolOutputContainers.delete(toolCallId);
            },
        };
    }

    // Render tool output as markdown
    async function renderToolOutput(
        toolCallId: string,
        output: any,
        container: HTMLElement,
    ) {
        if (!container || !plugin) return;

        const outputText = formatToolOutput(output);
        if (!outputText) return;

        container.empty();

        // Get the active file as source path for link resolution
        const activeFile = plugin.app.workspace.getActiveFile();
        const sourcePath = activeFile ? activeFile.path : "";

        // Create component for this tool output if it doesn't exist
        if (!toolOutputComponents.has(toolCallId)) {
            toolOutputComponents.set(toolCallId, new Component());
        }
        const toolComponent = toolOutputComponents.get(toolCallId)!;

        // Remove old event listeners if they exist
        const oldCleanup = toolOutputCleanups.get(toolCallId);
        if (oldCleanup) {
            oldCleanup();
        }

        const { cleanup } = await renderMarkdown(
            plugin.app,
            outputText,
            container,
            sourcePath,
            toolComponent,
        );

        toolOutputCleanups.set(toolCallId, cleanup);
    }

    // Helper to check if there are incomplete dataview/dataviewjs code blocks
    // Returns true if there's an opening dataview block without a matching closing ```
    function hasIncompleteDataviewBlocks(text: string): boolean {
        if (!text) return false;

        // Find the last occurrence of opening dataview or dataviewjs blocks
        const lastDataviewOpen = text.lastIndexOf("```dataview");
        const lastDataviewjsOpen = text.lastIndexOf("```dataviewjs");
        const lastOpen = Math.max(lastDataviewOpen, lastDataviewjsOpen);

        if (lastOpen === -1) {
            // No dataview blocks found
            return false;
        }

        // Check if there's a closing ``` after the last opening
        // We need to skip past the opening ``` (3 backticks) and the language identifier
        const afterLastOpen = text.substring(lastOpen);
        // Find the first closing ``` after skipping the opening backticks
        const closingAfter = afterLastOpen.indexOf("```", 3); // Skip the opening ```

        // If no closing found, the block is incomplete
        return closingAfter === -1;
    }

    // Derived content
    $: content = getMessageContent(message);

    // Tool collapse logic
    let areToolsOpen = true;
    let hasAutoCollapsed = false;

    $: toolStatus = message.toolCalls?.some((t) => t.status === "running")
        ? "running"
        : "completed";
    $: toolCount = message.toolCalls?.length || 0;
    $: summaryText =
        toolStatus === "running"
            ? "Running tools..."
            : `Used ${toolCount} tool${toolCount === 1 ? "" : "s"}`;

    $: if (
        content &&
        content.length > 0 &&
        !hasAutoCollapsed &&
        message.toolCalls &&
        message.toolCalls.length > 0
    ) {
        areToolsOpen = false;
        hasAutoCollapsed = true;
    }

    onMount(() => {
        if (content && content.length > 0) {
            areToolsOpen = false;
            hasAutoCollapsed = true;
        }
        renderContent(true);
    });

    onDestroy(() => {
        // Clean up main message component
        if (messageCleanup) {
            messageCleanup();
        }
        component.unload();

        // Clean up tool output containers
        toolOutputContainers.forEach((container, toolCallId) => {
            const cleanup = toolOutputCleanups.get(toolCallId);
            if (cleanup) {
                cleanup();
            }
            const toolComponent = toolOutputComponents.get(toolCallId);
            if (toolComponent) {
                toolComponent.unload();
            }
        });
        toolOutputContainers.clear();
        toolOutputComponents.clear();
        toolOutputCleanups.clear();
    });

    $: if (content && messageContainer && plugin) {
        // Update loading state based on content
        isWaitingForDataview =
            hasIncompleteDataviewBlocks(content) &&
            message.role === "assistant";
        renderContent();
    }

    // Reactive statement to render tool outputs when they change
    // Watch both the toolCalls array and individual outputs
    $: toolCallsWithOutputs = message.toolCalls?.map((tc) => ({
        id: tc.id,
        output: tc.output,
        status: tc.status,
    }));

    $: if (toolCallsWithOutputs && plugin && messageContainer) {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            for (const toolCall of message.toolCalls || []) {
                if (toolCall.output && toolCall.status === "completed") {
                    const container = toolOutputContainers.get(toolCall.id);
                    if (container) {
                        renderToolOutput(
                            toolCall.id,
                            toolCall.output,
                            container,
                        );
                    }
                }
            }
        }, 0);
    }

    let lastRenderedContent = "";
    let isWaitingForDataview = false;
    let messageCleanup: (() => void) | null = null;
    let isRenderPending = false;

    async function renderContent(immediate = false) {
        if (!messageContainer || !plugin || !content) return;

        // Avoid re-rendering identical content
        if (content === lastRenderedContent) return;

        // Check for incomplete dataview blocks - skip rendering if found
        // This prevents errors when the rendering engine tries to process incomplete queries
        // The loading indicator is handled by the reactive statement above
        if (hasIncompleteDataviewBlocks(content)) {
            // Don't update lastRenderedContent so we can retry when content changes
            return;
        }

        // For assistant messages (streaming), throttle the rendering to avoid flickering
        // and performance issues. For user messages, render immediately.
        if (!immediate && message.role === "assistant") {
            if (!isRenderPending) {
                isRenderPending = true;
                setTimeout(async () => {
                    await doRender();
                    isRenderPending = false;
                    // If content changed while we were rendering, trigger another check
                    if (content !== lastRenderedContent) {
                        renderContent();
                    }
                }, 33); // ~30fps throttling
            }
        } else {
            // If a throttled render is pending, cancel it since we're forcing an update
            // (Actually we can't easily cancel the promise inside setTimeout, but we can ignore it
            // or just let it happen. For simplicity, we just render immediately here.)
            await doRender();
        }
    }

    async function doRender() {
        if (!messageContainer) return;

        lastRenderedContent = content;
        messageContainer.empty();

        // Get the active file as source path for link resolution
        const activeFile = plugin.app.workspace.getActiveFile();
        const sourcePath = activeFile ? activeFile.path : "";

        // Remove old event listeners if they exist
        if (messageCleanup) {
            messageCleanup();
        }

        const { cleanup } = await renderMarkdown(
            plugin.app,
            content,
            messageContainer,
            sourcePath,
            component,
        );

        messageCleanup = cleanup;
    }
</script>

<div
    class={`flex mb-1 ${message.role === "user" ? "justify-end" : "justify-start w-full"}`}
>
    <div
        class={`break-words flex flex-col ${message.role === "assistant" ? "gap-3 w-full max-w-full pt-2 text-[var(--text-normal)]" : "gap-2 max-w-[75%] px-3.5 py-2 rounded-xl rounded-br-[4px] border border-[color-mix(in_srgb,var(--interactive-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--interactive-accent)_15%,transparent)] text-[var(--text-normal)]"}`}
    >
        {#if message.toolCalls && message.toolCalls.length > 0}
            <div class="w-full">
                <details bind:open={areToolsOpen} class="w-full">
                    <summary
                        class="flex items-center gap-2 p-2 text-[0.85rem] text-[var(--text-muted)] rounded-md transition-colors duration-150 select-none list-none hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
                    >
                        <span
                            class={`text-xs opacity-70 transition-transform duration-200 ${areToolsOpen ? "rotate-90" : ""}`}
                            >▶</span
                        >
                        <span class="text-[1.1em]"
                            >{toolStatus === "running" ? "⏳" : "🛠️"}</span
                        >
                        <span class="font-medium">{summaryText}</span>
                    </summary>
                    <div
                        class="flex flex-col gap-1.5 mt-2 pl-2 border-l-2 border-[var(--background-modifier-border)]"
                    >
                        {#each message.toolCalls as toolCall (toolCall.id)}
                            <div
                                class="bg-transparent border border-[var(--background-modifier-border)] rounded-lg overflow-hidden shadow-sm transition-[box-shadow,background-color] duration-200 hover:bg-[var(--background-secondary)] hover:shadow-md"
                            >
                                <details>
                                    <summary
                                        class="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer select-none list-none transition-colors duration-150 hover:bg-[var(--background-modifier-hover)]"
                                    >
                                        <span
                                            class="text-[1.1em] min-w-[1.3em] text-center flex items-center justify-center"
                                        >
                                            {#if toolCall.status === "running"}
                                                ⏳
                                            {:else if toolCall.status === "completed"}
                                                ✅
                                            {:else}
                                                ❌
                                            {/if}
                                        </span>
                                        <span
                                            class="font-semibold font-[var(--font-text)] text-[0.9rem] tracking-[0.01em] text-[var(--text-normal)]"
                                            >{formatToolName(
                                                toolCall.name,
                                            )}</span
                                        >
                                        <span class="ml-auto text-xs opacity-50"
                                            >▼</span
                                        >
                                    </summary>
                                    <div
                                        class="flex flex-col gap-3.5 px-3.5 py-3 bg-[var(--background-primary)] border-t border-[var(--background-modifier-border)]"
                                    >
                                        <div class="flex flex-col gap-2">
                                            <strong
                                                class="text-[0.75rem] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] mb-1"
                                                >Input:</strong
                                            >
                                            {#if formatToolInput(toolCall.input).length > 0}
                                                <div
                                                    class="flex flex-col gap-2 mt-2"
                                                >
                                                    {#each formatToolInput(toolCall.input) as { key, value } (key)}
                                                        <div
                                                            class="flex items-start gap-3 px-3 py-2.5 bg-[var(--code-background)] border border-[var(--background-modifier-border)] rounded-md transition-colors duration-150 hover:bg-[var(--background-modifier-hover)]"
                                                        >
                                                            <span
                                                                class="font-semibold text-[var(--text-accent)] font-mono text-[0.85rem] min-w-fit flex-shrink-0"
                                                                >{key}:</span
                                                            >
                                                            <span
                                                                class="flex-1 text-[var(--text-normal)] font-mono text-[0.85rem] leading-[1.5] break-words whitespace-pre-wrap"
                                                                >{formatValue(
                                                                    value,
                                                                )}</span
                                                            >
                                                        </div>
                                                    {/each}
                                                </div>
                                            {:else}
                                                <span
                                                    class="text-[var(--text-muted)] italic text-[0.85rem] mt-2 block"
                                                    >(empty)</span
                                                >
                                            {/if}
                                        </div>
                                        {#if toolCall.output}
                                            <div class="flex flex-col gap-2">
                                                <strong
                                                    class="text-[0.75rem] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] mb-1"
                                                    >Output:</strong
                                                >
                                                <div
                                                    class="tool-output-content markdown-preview-view m-0 px-4 py-3 bg-[var(--code-background)] border border-[var(--background-modifier-border)] rounded-md overflow-x-auto text-[0.85rem] leading-[1.6] text-[var(--text-normal)] break-words [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:bg-[var(--background-primary)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.9em] [&_pre]:bg-[var(--background-primary)] [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-2 [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:pl-6 [&_blockquote]:border-l-[3px] [&_blockquote]:border-[var(--background-modifier-border)] [&_blockquote]:pl-4 [&_blockquote]:my-2 [&_blockquote]:text-[var(--text-muted)] [&_table]:border-collapse [&_table]:my-2 [&_table]:w-full [&_th]:border [&_td]:border [&_th]:border-[var(--background-modifier-border)] [&_td]:border-[var(--background-modifier-border)] [&_th]:p-2 [&_td]:p-2 [&_th]:bg-[var(--background-secondary)] [&_th]:font-semibold"
                                                    use:bindToolOutputContainer={toolCall.id}
                                                ></div>
                                            </div>
                                        {/if}
                                    </div>
                                </details>
                            </div>
                        {/each}
                    </div>
                </details>
            </div>
        {/if}

        <div
            class="message-text markdown-preview-view leading-[1.5] !p-0 !w-full !max-w-full !m-0 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_code]:bg-[var(--code-background)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.9em]"
            bind:this={messageContainer}
        >
            <!-- Content rendered by Obsidian's MarkdownRenderer -->
        </div>
        {#if isWaitingForDataview && message.role === "assistant"}
            <div
                class="flex items-center gap-2 px-3 py-2 mt-2 text-[var(--text-muted)] text-[0.85rem] italic"
            >
                <span
                    class="inline-block w-[14px] h-[14px] border-2 border-[var(--background-modifier-border)] border-t-[var(--text-accent)] rounded-full animate-spin"
                ></span>
                <span class="text-[var(--text-muted)]">Rendering query...</span>
            </div>
        {/if}
    </div>
</div>
