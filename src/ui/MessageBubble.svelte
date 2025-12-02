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
		const toolCall = message.toolCalls?.find(tc => tc.id === toolCallId);
		if (toolCall && toolCall.output && toolCall.status === "completed") {
			renderToolOutput(toolCallId, toolCall.output, node);
		}
		
		return {
			update(newToolCallId: string) {
				if (newToolCallId !== toolCallId) {
					toolOutputContainers.delete(toolCallId);
					toolOutputContainers.set(newToolCallId, node);
					const toolCall = message.toolCalls?.find(tc => tc.id === newToolCallId);
					if (toolCall && toolCall.output && toolCall.status === "completed") {
						renderToolOutput(newToolCallId, toolCall.output, node);
					}
				}
			},
			destroy() {
				toolOutputContainers.delete(toolCallId);
			}
		};
	}
	
	// Render tool output as markdown
	async function renderToolOutput(toolCallId: string, output: any, container: HTMLElement) {
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
			toolComponent
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

	$: toolStatus = message.toolCalls?.some(t => t.status === "running") ? "running" : "completed";
	$: toolCount = message.toolCalls?.length || 0;
	$: summaryText = toolStatus === "running" 
		? "Running tools..." 
		: `Used ${toolCount} tool${toolCount === 1 ? "" : "s"}`;

	$: if (content && content.length > 0 && !hasAutoCollapsed && message.toolCalls && message.toolCalls.length > 0) {
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
	$: toolCallsWithOutputs = message.toolCalls?.map(tc => ({
		id: tc.id,
		output: tc.output,
		status: tc.status
	}));
	
	$: if (toolCallsWithOutputs && plugin && messageContainer) {
		// Use setTimeout to ensure DOM is ready
		setTimeout(() => {
			for (const toolCall of message.toolCalls || []) {
				if (toolCall.output && toolCall.status === "completed") {
					const container = toolOutputContainers.get(toolCall.id);
					if (container) {
						renderToolOutput(toolCall.id, toolCall.output, container);
					}
				}
			}
		}, 0);
	}

	let lastRenderedContent = "";
	let renderTimeout: any;
	let isWaitingForDataview = false;
	let messageCleanup: (() => void) | null = null;

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

		// For assistant messages (streaming), debounce the rendering to avoid flickering
		// and performance issues. For user messages, render immediately.
		if (!immediate && message.role === "assistant") {
			if (renderTimeout) clearTimeout(renderTimeout);
			renderTimeout = setTimeout(async () => {
				await doRender();
			}, 50); // 50ms debounce
		} else {
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
			component
		);
		
		messageCleanup = cleanup;
	}
</script>

<div class="message {message.role}">
	<div class="message-content">
		{#if message.toolCalls && message.toolCalls.length > 0}
			<div class="tool-calls-container">
				<details bind:open={areToolsOpen} class="tool-calls-wrapper">
					<summary class="tool-calls-summary">
						<span class="summary-icon">{toolStatus === "running" ? "⏳" : "🛠️"}</span>
						<span class="summary-text">{summaryText}</span>
					</summary>
					<div class="tool-calls">
						{#each message.toolCalls as toolCall (toolCall.id)}
							<div class="tool-call {toolCall.status}">
								<details>
									<summary>
										<span class="status-icon">
											{#if toolCall.status === "running"}
												⏳
											{:else if toolCall.status === "completed"}
												✅
											{:else}
												❌
											{/if}
										</span>
										<span class="tool-name"
											>{formatToolName(toolCall.name)}</span
										>
									</summary>
									<div class="tool-details">
										<div class="tool-input">
											<strong>Input:</strong>
											{#if formatToolInput(toolCall.input).length > 0}
												<div class="tool-input-kv">
													{#each formatToolInput(toolCall.input) as { key, value } (key)}
														<div class="tool-input-row">
															<span class="tool-input-key"
																>{key}:</span
															>
															<span
																class="tool-input-value"
																>{formatValue(
																	value,
																)}</span
															>
														</div>
													{/each}
												</div>
											{:else}
												<span class="tool-input-empty"
													>(empty)</span
												>
											{/if}
										</div>
										{#if toolCall.output}
											<div class="tool-output">
												<strong>Output:</strong>
												<div
													class="tool-output-content markdown-preview-view"
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
			class="message-text markdown-preview-view"
			bind:this={messageContainer}
		>
			<!-- Content rendered by Obsidian's MarkdownRenderer -->
		</div>
		{#if isWaitingForDataview && message.role === "assistant"}
			<div class="dataview-loading">
				<span class="loading-spinner"></span>
				<span class="loading-text">Rendering query...</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.message {
		display: flex;
		margin-bottom: 0.25rem;
	}

	.message.user {
		justify-content: flex-end;
	}

	.message.assistant {
		justify-content: flex-start;
		width: 100%;
	}

	.message-content {
		word-wrap: break-word;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Reduce gap between tool calls and message text for assistant messages */
	.message.assistant .message-content {
		gap: 0.75rem;
		width: 100%;
		max-width: 100%;
	}

	.message.assistant .tool-calls-container + .message-text {
		margin-top: 0.25rem;
	}

	.message.user .message-content {
		max-width: 75%;
		padding: 0.5rem 0.8rem;
		border-radius: 12px;
		border-bottom-right-radius: 4px;
		background: color-mix(in srgb, var(--interactive-accent) 15%, transparent);
		color: var(--text-normal);
		border: 1px solid color-mix(in srgb, var(--interactive-accent) 30%, transparent);
	}

	.message.assistant .message-content {
		max-width: 100%;
		padding: 0.5rem 0;
		background: transparent;
		color: var(--text-normal);
		border: none;
	}

	.tool-calls-wrapper {
		width: 100%;
	}

	.tool-calls-wrapper > summary {
		list-style: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		color: var(--text-muted);
		font-size: 0.85rem;
		border-radius: 6px;
		transition: background-color 0.15s ease;
		user-select: none;
	}

	.tool-calls-wrapper > summary:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.tool-calls-wrapper > summary::-webkit-details-marker {
		display: none;
	}

	/* Add arrow indicator */
	.tool-calls-wrapper > summary::before {
		content: "▶";
		font-size: 0.7em;
		display: inline-block;
		transition: transform 0.2s ease;
		margin-right: 0.25rem;
		opacity: 0.7;
	}

	.tool-calls-wrapper[open] > summary::before {
		transform: rotate(90deg);
	}

	.summary-icon {
		font-size: 1.1em;
	}

	.tool-calls {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.5rem;
		padding-left: 0.5rem;
		border-left: 2px solid var(--background-modifier-border);
	}

	.tool-call {
		background: transparent;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		transition:
			box-shadow 0.2s ease,
			background-color 0.2s ease;
		margin-bottom: 0;
	}

	.tool-call:hover {
		background: var(--background-secondary);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
	}

	.tool-call summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.875rem;
		cursor: pointer;
		user-select: none;
		list-style: none;
		transition: background-color 0.15s ease;
	}

	.tool-call summary::-webkit-details-marker {
		display: none;
	}

	.tool-call summary:hover {
		background: var(--background-modifier-hover);
	}

	.tool-call summary::after {
		content: "▼";
		margin-left: auto;
		font-size: 0.7em;
		opacity: 0.5;
		transition:
			transform 0.2s ease,
			opacity 0.2s ease;
	}

	.tool-call details[open] summary::after {
		transform: rotate(180deg);
	}

	.status-icon {
		font-size: 1.1em;
		min-width: 1.3em;
		text-align: center;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.tool-name {
		font-weight: 600;
		font-family: var(--font-text);
		color: var(--text-normal);
		font-size: 0.9rem;
		letter-spacing: 0.01em;
	}

	.tool-details {
		padding: 0.875rem;
		background: var(--background-primary);
		border-top: 1px solid var(--background-modifier-border);
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.tool-input,
	.tool-output {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tool-input strong,
	.tool-output strong {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin-bottom: 0.25rem;
	}

	.tool-input-kv {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.tool-input-row {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		background: var(--code-background);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		transition: background-color 0.15s ease;
	}

	.tool-input-row:hover {
		background: var(--background-modifier-hover);
	}

	.tool-input-key {
		font-weight: 600;
		color: var(--text-accent);
		font-family: var(--font-monospace);
		font-size: 0.85rem;
		min-width: fit-content;
		flex-shrink: 0;
	}

	.tool-input-value {
		flex: 1;
		color: var(--text-normal);
		font-family: var(--font-monospace);
		font-size: 0.85rem;
		line-height: 1.5;
		word-break: break-word;
		white-space: pre-wrap;
	}

	.tool-input-empty {
		color: var(--text-muted);
		font-style: italic;
		font-size: 0.85rem;
		margin-top: 0.5rem;
		display: block;
	}
	
	.tool-output-content {
		margin: 0;
		padding: 0.875rem 1rem;
		background: var(--code-background);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		overflow-x: auto;
		font-size: 0.85rem;
		line-height: 1.6;
		color: var(--text-normal);
		word-wrap: break-word;
	}
	
	.tool-output-content :global(p) {
		margin: 0.5rem 0;
	}
	
	.tool-output-content :global(p:first-child) {
		margin-top: 0;
	}
	
	.tool-output-content :global(p:last-child) {
		margin-bottom: 0;
	}
	
	.tool-output-content :global(code) {
		background: var(--background-primary);
		padding: 0.2rem 0.4rem;
		border-radius: 3px;
		font-family: var(--font-monospace);
		font-size: 0.9em;
	}
	
	.tool-output-content :global(pre) {
		background: var(--background-primary);
		padding: 0.75rem;
		border-radius: 4px;
		overflow-x: auto;
		margin: 0.5rem 0;
	}
	
	.tool-output-content :global(pre code) {
		background: transparent;
		padding: 0;
	}
	
	.tool-output-content :global(ul),
	.tool-output-content :global(ol) {
		margin: 0.5rem 0;
		padding-left: 1.5rem;
	}
	
	.tool-output-content :global(blockquote) {
		border-left: 3px solid var(--background-modifier-border);
		padding-left: 1rem;
		margin: 0.5rem 0;
		color: var(--text-muted);
	}
	
	.tool-output-content :global(table) {
		border-collapse: collapse;
		margin: 0.5rem 0;
		width: 100%;
	}
	
	.tool-output-content :global(th),
	.tool-output-content :global(td) {
		border: 1px solid var(--background-modifier-border);
		padding: 0.5rem;
	}
	
	.tool-output-content :global(th) {
		background: var(--background-secondary);
		font-weight: 600;
	}

	.message-header {
		display: none;
	}

	.message-text {
		line-height: 1.5;
		padding: 0 !important;
	}

	.message-text :global(p) {
		margin: 0.5rem 0;
	}

	.message-text :global(p:first-child) {
		margin-top: 0;
	}

	.message-text :global(p:last-child) {
		margin-bottom: 0;
	}

	.message-text :global(strong) {
		font-weight: 600;
	}

	.message-text :global(code) {
		background: var(--code-background);
		padding: 0.2rem 0.4rem;
		border-radius: 3px;
		font-family: var(--font-monospace);
		font-size: 0.9em;
	}

	.message.user .message-text :global(code) {
		background: var(--code-background);
	}

	/* Markdown overrides for user messages */
	.message.user .message-text {
		font-family: inherit;
	}

	.message.user .message-text :global(*) {
		border-color: currentColor;
	}

	.message.user .message-text :global(a) {
		color: var(--text-accent);
		text-decoration: underline;
	}

	/* Override Obsidian's Readable Line Length behavior inside bubbles */
	:global(.message-text.markdown-preview-view) {
		width: 100% !important;
		max-width: 100% !important;
		padding: 0 !important;
		margin: 0 !important;
	}

	.dataview-loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		margin-top: 0.5rem;
		color: var(--text-muted);
		font-size: 0.85rem;
		font-style: italic;
	}

	.loading-spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid var(--background-modifier-border);
		border-top-color: var(--text-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading-text {
		color: var(--text-muted);
	}
</style>
