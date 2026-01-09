<script lang="ts">
import type { ToolCallState } from "../../stores/chatStore.svelte";
import MarkdownRenderer from "../base/MarkdownRenderer.svelte";

interface Props {
	toolCalls: ToolCallState[];
	isOpen: boolean;
	onToggle: (open: boolean) => void;
}

const { toolCalls, isOpen, onToggle }: Props = $props();

function formatToolInput(input: Record<string, unknown> | null | undefined): { key: string; value: unknown }[] {
	if (!input || typeof input !== "object" || Array.isArray(input)) return [];
	return Object.entries(input).map(([key, value]) => ({
		key,
		value,
	}));
}

function formatToolName(name: string): string {
	if (!name) return "Unknown Tool";
	// Convert snake_case or camelCase to Title Case with spaces
	return name
		.replace(/_/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return value;
	if (typeof value === "object") return JSON.stringify(value, null, 2);
	return String(value);
}

function formatToolOutput(output: unknown): string {
	if (output === null || output === undefined) return "";
	if (typeof output === "string") return output;

	// If it's an array (ThreadMessage content format)
	if (Array.isArray(output)) {
		const textItems = output
			.map((item: unknown) => {
				if (item && typeof item === "object") {
					const obj = item as Record<string, unknown>;
					if (obj.type === "text" && obj.text !== undefined) {
						return String(obj.text);
					}
					if (obj.type === "json" && obj.data !== undefined) {
						return JSON.stringify(obj.data, null, 2);
					}
				}
				return "";
			})
			.filter((text: string) => text !== "")
			.join("\n");
		if (textItems) return textItems;
	}

	// If it's an object, check if it's a single content item
	if (typeof output === "object") {
		const obj = output as Record<string, unknown>;
		if (obj.type === "text" && obj.text !== undefined) {
			return String(obj.text);
		}
		// Check if it has a content field (nested structure)
		if (obj.content !== undefined) {
			return formatToolOutput(obj.content);
		}
	}

	return JSON.stringify(output, null, 2);
}

function getToolStatus(calls: ToolCallState[] | undefined): "running" | "completed" {
	if (!calls || calls.length === 0) return "completed";
	return calls.some((t) => t.status === "running") ? "running" : "completed";
}

function getToolSummaryText(calls: ToolCallState[] | undefined): string {
	if (!calls || calls.length === 0) return "";
	const count = calls.length;
	const status = getToolStatus(calls);
	if (status === "running") {
		return "Running tools...";
	}
	return `Used ${count} tool${count === 1 ? "" : "s"}`;
}

const toolStatus = $derived(getToolStatus(toolCalls));
const summaryText = $derived(getToolSummaryText(toolCalls));
</script>

<div class="w-full">
    <details
        open={isOpen}
        ontoggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}
        class="w-full"
    >
        <summary
            class="flex items-center gap-2 p-2 text-[0.85rem] text-text-muted rounded-md transition-colors duration-150 select-none list-none hover:bg-bg-modifier-hover hover:text-text-normal cursor-pointer"
        >
            <span
                class={`text-xs opacity-70 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                >▶</span
            >
            <span class="text-[1.1em]">
                {toolStatus === "running" ? "⏳" : "🛠️"}
            </span>
            <span class="font-medium">
                {summaryText}
            </span>
        </summary>
        <div
            class="flex flex-col gap-1.5 mt-2 pl-2 border-l-2 border-bg-modifier-border"
        >
            {#each toolCalls as toolCall (toolCall.id)}
                <div
                    class="bg-transparent border border-bg-modifier-border rounded-lg overflow-hidden shadow-sm transition-[box-shadow,background-color] duration-200 hover:bg-background-secondary hover:shadow-md"
                >
                    <details>
                        <summary
                            class="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer select-none list-none transition-colors duration-150 hover:bg-bg-modifier-hover"
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
                                class="font-semibold text-[0.9rem] tracking-[0.01em] text-text-normal"
                            >
                                {formatToolName(toolCall.name)}
                            </span>
                            <span class="ml-auto text-xs opacity-50">▼</span>
                        </summary>
                        <div
                            class="flex flex-col gap-3.5 px-3.5 py-3 bg-background-primary border-t border-bg-modifier-border"
                        >
                            <div class="flex flex-col gap-2">
                                <strong
                                    class="text-[0.75rem] font-semibold uppercase tracking-[0.05em] text-text-muted mb-1"
                                    >Input:</strong
                                >
                                {#if formatToolInput(toolCall.input).length > 0}
                                    <div class="flex flex-col gap-2 mt-2">
                                        {#each formatToolInput(toolCall.input) as { key, value } (key)}
                                            <div
                                                class="flex items-start gap-3 px-3 py-2.5 bg-code-background border border-bg-modifier-border rounded-md transition-colors duration-150 hover:bg-bg-modifier-hover"
                                            >
                                                <span
                                                    class="text-text-accent text-s"
                                                    >{key}:</span
                                                >
                                                <MarkdownRenderer
                                                    content={formatValue(value)}
                                                    class="flex-1 text-s [&_p]:m-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
                                                />
                                            </div>
                                        {/each}
                                    </div>
                                {:else}
                                    <span
                                        class="text-text-muted italic text-[0.85rem] mt-2 block"
                                        >(empty)</span
                                    >
                                {/if}
                            </div>
                            {#if toolCall.output !== undefined}
                                <div class="flex flex-col gap-2">
                                    <strong
                                        class="text-[0.75rem] font-semibold uppercase tracking-[0.05em] text-text-muted mb-1"
                                        >Output:</strong
                                    >
                                    <MarkdownRenderer
                                        content={formatToolOutput(toolCall.output)}
                                        class="tool-output-content markdown-preview-view m-0 px-4 py-3 bg-code-background border border-bg-modifier-border rounded-md overflow-x-auto text-[0.85rem] leading-[1.6] text-text-normal break-words [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:bg-background-primary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.9em] [&_pre]:bg-background-primary [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0"
                                    />
                                </div>
                            {/if}
                        </div>
                    </details>
                </div>
            {/each}
        </div>
    </details>
</div>
