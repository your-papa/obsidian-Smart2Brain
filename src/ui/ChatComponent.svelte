<script lang="ts">
	import { onMount, onDestroy, tick } from "svelte";
	import MessageBubble from "./MessageBubble.svelte";
	import type SmartSecondBrainPlugin from "../main";

	import type { ThreadMessage, ThreadMessageToolCall } from "papa-ts";

	export let plugin: SmartSecondBrainPlugin;

	interface ToolCallState {
		id: string;
		name: string;
		input: any;
		status: "running" | "completed" | "failed";
		output?: any;
	}

	interface UIMessage extends Omit<ThreadMessage, "toolCalls"> {
		toolCalls?: ToolCallState[];
	}

	export let currentThreadId: string = "default-thread";
	let messages: UIMessage[] = [];
	let input: string = "";
	let isLoading: boolean = false;
	let chatContainer: HTMLElement;
	let messagesContent: HTMLElement;
	let resizeObserver: ResizeObserver;
	let isPinnedToBottom = true;
	let isRestoring = false;

	// Use plugin setting for readable line length
	let readableLineLength: boolean = false;

	// Reactive statement that updates when settings change
	$: {
		readableLineLength = plugin.settings.readableLineLength ?? false;
	}

	onMount(async () => {
		// If currentThreadId was passed in props (or set externally via component.$set),
		// we load it. Otherwise we default to latest thread.
		if (currentThreadId === "default-thread") {
			currentThreadId = crypto.randomUUID();
		}

		if (messagesContent) {
			resizeObserver = new ResizeObserver(() => {
				if (isPinnedToBottom && chatContainer) {
					chatContainer.scrollTop = chatContainer.scrollHeight;
				}
			});
			resizeObserver.observe(messagesContent);
		}

		await loadMessages();
		scrollToBottom();
	});

	onDestroy(() => {
		if (resizeObserver) {
			resizeObserver.disconnect();
		}
	});

	function handleScroll() {
		if (!chatContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = chatContainer;
		const distanceToBottom = scrollHeight - scrollTop - clientHeight;
		// If user scrolls up (distance > 50px), unpin.
		// If user scrolls to bottom (distance < 20px), pin.
		if (distanceToBottom > 50) {
			isPinnedToBottom = false;
		} else if (distanceToBottom < 20) {
			isPinnedToBottom = true;
		}
	}

	// Watch for external ID changes (e.g. from ChatView when opening a file)
	let previousThreadId = "";
	$: if (currentThreadId && currentThreadId !== previousThreadId) {
		previousThreadId = currentThreadId;
		messages = [];
		isLoading = true;
		isPinnedToBottom = true; // Reset pin on thread switch
		isRestoring = true; // Hide content during load to prevent jumping
		(async () => {
			await loadMessages();
			isLoading = false;
			// Ensure we stay pinned after loading finishes and final renders happen
			await tick();
			// Small delay to ensure markdown rendering is complete before showing
			setTimeout(() => {
				scrollToBottom();
				isRestoring = false;
			}, 150);
		})();
	}

	async function loadMessages() {
		try {
			const storedMessages =
				await plugin.agentManager.getThreadMessages(currentThreadId);

			if (storedMessages && storedMessages.length > 0) {
				// ... processing logic ...
				// (Reconstruction of uiMessages and toolCalls)
				// ...

				// First pass: map to basic UI messages
				const uiMessages: UIMessage[] = storedMessages.map(
					(msg: any) => ({
						...msg,
						id: msg.id || crypto.randomUUID(),
						timestamp: msg.timestamp || Date.now(),
						// Don't overwrite toolCalls yet, we need to read them!
						// But ensure we have a property for Svelte to track if it doesn't exist
						_uiToolCalls: [],
					}),
				);

				// Second pass: Link tool outputs back to assistant messages
				const toolOutputs = new Map<string, any>(); // tool_call_id -> output message

				for (const msg of uiMessages) {
					// Check both camelCase and snake_case
					const toolCallId =
						(msg as any).tool_call_id || (msg as any).toolCallId;
					if (msg.role === "tool" && toolCallId) {
						toolOutputs.set(toolCallId, msg);
					}
				}

				for (const msg of uiMessages) {
					// Read from the message properties (preserved from spread)
					const rawToolCalls =
						(msg as any).tool_calls || (msg as any).toolCalls;

					if (
						msg.role === "assistant" &&
						rawToolCalls &&
						rawToolCalls.length > 0
					) {
						if (Array.isArray(rawToolCalls)) {
							// We write to the property that the UI uses.
							// Note: MessageBubble uses 'toolCalls' property.
							// If 'toolCalls' already exists (from papa-ts), we are replacing it with our enriched ToolCallState version.
							// This is fine, as long as we read 'rawToolCalls' correctly first.
							// BUT since we just spread '...msg', msg.toolCalls IS rawToolCalls.

							msg.toolCalls = rawToolCalls.map(
								(tc: ThreadMessageToolCall) => {
									const id = tc.id;
									const name = tc.name;
									const args = tc.arguments;

									const outputMsg = toolOutputs.get(id);

									// Handle different input formats (same logic as streaming)
									let parsedArgs = args;
									if (args === undefined || args === null) {
										parsedArgs = {};
									} else if (typeof args === "string") {
										// Try to parse as JSON
										try {
											const parsed = JSON.parse(args);
											// Ensure it's an object (not array or primitive)
											parsedArgs =
												typeof parsed === "object" &&
												!Array.isArray(parsed)
													? parsed
													: { value: parsed };
										} catch {
											// If parsing fails, treat as a single string value
											parsedArgs = { input: args };
										}
									} else if (Array.isArray(args)) {
										// If it's an array, wrap it
										parsedArgs = { value: args };
									} else if (typeof args !== "object") {
										// If it's a primitive, wrap it
										parsedArgs = { value: args };
									}
									// If it's already an object, use it as-is

									return {
										id: id,
										name: name,
										input: parsedArgs,
										// Determine status based on presence of output message
										status: outputMsg
											? outputMsg.status === "error"
												? "failed"
												: "completed"
											: "running",
										output: outputMsg
											? outputMsg.content
											: undefined,
									};
								},
							);
						}
					}
				}

				// Filter out tool messages as they are now embedded in assistant messages
				let filteredMessages = uiMessages.filter(
					(msg) => msg.role !== "tool",
				);

				// Merge consecutive assistant messages (tool calls + final response)
				messages = mergeConsecutiveAssistantMessages(filteredMessages);

				// Scroll immediately after setting messages, without animation
				if (chatContainer) {
					requestAnimationFrame(() => {
						chatContainer.scrollTop = chatContainer.scrollHeight;
					});
				}
			} else {
				messages = [];
			}
		} catch (error) {
			console.error("Error loading messages:", error);
			messages = [];
		}
	}

	// Reactive statement to scroll when messages change
	$: if (messages.length > 0) {
		scrollToBottom();
	}

	function scrollToBottom() {
		if (chatContainer) {
			isPinnedToBottom = true;
			setTimeout(() => {
				if (chatContainer) {
					chatContainer.scrollTop = chatContainer.scrollHeight;
				}
			}, 100);
		}
	}

	function adjustTextareaHeight(node: HTMLTextAreaElement) {
		const resize = () => {
			node.style.height = "auto";
			node.style.height = Math.min(node.scrollHeight, 200) + "px";
		};
		node.addEventListener("input", resize);
		// Initial resize
		resize();

		return {
			destroy() {
				node.removeEventListener("input", resize);
			},
		};
	}

	async function sendMessage() {
		if (!input.trim() || isLoading) return;

		// Reset height
		const textarea = document.querySelector(
			".chat-input",
		) as HTMLTextAreaElement;
		if (textarea) textarea.style.height = "auto";

		isPinnedToBottom = true;

		const userMessage: UIMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [{ type: "text", text: input.trim() }],
			timestamp: Date.now(),
		};

		messages = [...messages, userMessage];
		const currentInput = input;
		input = "";
		isLoading = true;
		scrollToBottom();

		// Create assistant message immediately for streaming
		const assistantMessage: UIMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			content: [{ type: "text", text: "" }],
			timestamp: Date.now(),
			toolCalls: [],
		};
		messages = [...messages, assistantMessage];
		const messageIndex = messages.length - 1;

		// Track if this is a new thread so we can refresh the list
		// const isNewThread = !threads.some(t => t.threadId === currentThreadId);

		try {
			// Use streaming instead of runQuery
			for await (const chunk of plugin.agentManager.streamQuery(
				currentInput,
				currentThreadId,
			)) {
				const currentMsg = messages[messageIndex];
				if (!currentMsg.toolCalls) currentMsg.toolCalls = [];

				// Use normalized messages from chunk (papa-ts v2.7.0+)
				// This is the only way to handle tool calls and outputs - raw events are no longer available
				if (chunk.messages && Array.isArray(chunk.messages)) {
					// Process all messages to find tool calls and tool outputs
					for (const msg of chunk.messages) {
						// Handle assistant messages with tool calls
						if (
							msg.role === "assistant" &&
							msg.toolCalls &&
							msg.toolCalls.length > 0
						) {
							for (const tc of msg.toolCalls as ThreadMessageToolCall[]) {
								const toolCallId = tc.id;
								const existingIndex =
									currentMsg.toolCalls.findIndex(
										(t) => t.id === toolCallId,
									);

								// Get input arguments from ThreadMessageToolCall
								let input = tc.arguments;

								// Handle different input formats
								if (input === undefined || input === null) {
									input = {};
								} else if (typeof input === "string") {
									// Try to parse as JSON
									try {
										const parsed = JSON.parse(input);
										// Ensure it's an object (not array or primitive)
										input =
											typeof parsed === "object" &&
											!Array.isArray(parsed)
												? parsed
												: { value: parsed };
									} catch {
										// If parsing fails, treat as a single string value
										input = { input: input };
									}
								} else if (Array.isArray(input)) {
									// If it's an array, wrap it
									input = { value: input };
								} else if (typeof input !== "object") {
									// If it's a primitive, wrap it
									input = { value: input };
								}
								// If it's already an object, use it as-is

								const toolCallState: ToolCallState = {
									id: toolCallId,
									name: tc.name,
									input: input,
									status: "running",
									output: undefined,
								};

								if (existingIndex !== -1) {
									// Update existing, preserve output if already set
									currentMsg.toolCalls[existingIndex] = {
										...toolCallState,
										output: currentMsg.toolCalls[
											existingIndex
										].output,
									};
								} else {
									currentMsg.toolCalls.push(toolCallState);
								}
							}
						}

						// Handle tool messages (outputs)
						if (msg.role === "tool") {
							const toolCallId =
								(msg as any).tool_call_id ||
								(msg as any).toolCallId;
							if (toolCallId) {
								const toolIndex =
									currentMsg.toolCalls.findIndex(
										(t) => t.id === toolCallId,
									);
								if (toolIndex !== -1) {
									// Update tool call with output from normalized message
									currentMsg.toolCalls[toolIndex] = {
										...currentMsg.toolCalls[toolIndex],
										status: "completed",
										output: msg.content, // This is already in ThreadMessage format
									};
								} else {
									// Tool output arrived before tool call, create it
									currentMsg.toolCalls.push({
										id: toolCallId,
										name: (msg as any).name || "unknown",
										input: {},
										status: "completed",
										output: msg.content,
									});
								}
							}
						}
					}
				}

				// Handle token chunks (always process these for streaming text)
				if (chunk.type === "token" && chunk.token) {
					// Append token to the message content
					const currentContent = messages[messageIndex].content[0];
					if (currentContent.type === "text") {
						currentContent.text += chunk.token;
					}
				} else if (chunk.type === "result") {
					// Final result received
					if (chunk.result?.messages) {
						const lastMsg =
							chunk.result.messages[
								chunk.result.messages.length - 1
							];
						if (lastMsg && lastMsg.role === "assistant") {
							messages[messageIndex] = {
								...lastMsg,
								toolCalls: messages[messageIndex].toolCalls,
							};
						}
					}
				}

				// Trigger reactivity after processing any chunk
				messages = messages;
				scrollToBottom();
			}
		} catch (error) {
			// Update the message with error
			messages[messageIndex] = {
				...messages[messageIndex],
				content: [
					{
						type: "text",
						text: `Error: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
			messages = messages;
		} finally {
			isLoading = false;
			scrollToBottom();
		}
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}

	async function startNewChat() {
		await plugin.createNewChat();
	}

	function openSettings() {
		(plugin.app as any).setting.open();
		(plugin.app as any).setting.openTabById(plugin.manifest.id);
	}

	function shouldShowTypingIndicator(msg: UIMessage): boolean {
		if (msg.role !== "assistant") return false;
		const content = msg.content?.[0];
		const hasContent =
			content &&
			(content as any).type === "text" &&
			(content as any).text;
		const hasTools = msg.toolCalls && msg.toolCalls.length > 0;
		return !hasContent && !hasTools;
	}

	// Merge consecutive assistant messages into one
	function mergeConsecutiveAssistantMessages(msgs: UIMessage[]): UIMessage[] {
		const merged: UIMessage[] = [];
		let i = 0;

		while (i < msgs.length) {
			const current = msgs[i];

			// If it's not an assistant message, just add it
			if (current.role !== "assistant") {
				merged.push(current);
				i++;
				continue;
			}

			// Collect consecutive assistant messages
			const assistantGroup: UIMessage[] = [current];
			i++;

			while (i < msgs.length && msgs[i].role === "assistant") {
				assistantGroup.push(msgs[i]);
				i++;
			}

			// Merge the group into one message
			if (assistantGroup.length === 1) {
				merged.push(assistantGroup[0]);
			} else {
				// Combine all tool calls
				const allToolCalls: ToolCallState[] = [];
				let finalContent: any = null;
				let finalId = assistantGroup[0].id;
				let finalTimestamp = assistantGroup[0].timestamp || Date.now();

				for (const msg of assistantGroup) {
					if (msg.toolCalls && msg.toolCalls.length > 0) {
						allToolCalls.push(...msg.toolCalls);
					}
					// Find the message with actual text content (final response)
					const content = msg.content?.[0];
					if (
						content &&
						(content as any).type === "text" &&
						(content as any).text &&
						(content as any).text.trim()
					) {
						finalContent = msg.content;
						finalId = msg.id;
						finalTimestamp = msg.timestamp || finalTimestamp;
					}
				}

				// Create merged message
				merged.push({
					...assistantGroup[assistantGroup.length - 1], // Use last message as base
					id: finalId,
					timestamp: finalTimestamp,
					toolCalls:
						allToolCalls.length > 0 ? allToolCalls : undefined,
					content: finalContent || assistantGroup[0].content,
				});
			}
		}

		return merged;
	}
</script>

<div class="app-container">
	<!-- Sidebar removed, use Obsidian File Explorer -->

	<div class="chat-wrapper" class:readable-line-length={readableLineLength}>
		<div
			class="chat-messages"
			bind:this={chatContainer}
			on:scroll={handleScroll}
		>
			<div class="messages-content" bind:this={messagesContent}>
				{#if (isLoading && messages.length === 0) || isRestoring}
					<div class="loading-container overlay">
						<div class="typing-indicator">
							<span></span>
							<span></span>
							<span></span>
						</div>
					</div>
				{/if}

				{#if messages.length === 0 && !isLoading && !isRestoring}
					<div class="welcome-message">
						<p>Start a new conversation</p>
						<p>Ask me anything about your notes.</p>
					</div>
				{:else}
					<div class="message-list" class:invisible={isRestoring}>
						{#each messages as message (message.id)}
							<MessageBubble {message} {plugin} />
						{/each}
					</div>
				{/if}

				{#if isLoading && messages.length > 0 && !isRestoring}
					{#if shouldShowTypingIndicator(messages[messages.length - 1])}
						<div class="message assistant">
							<div class="message-content">
								<div class="typing-indicator">
									<span></span>
									<span></span>
									<span></span>
								</div>
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<div class="chat-input-container">
			<div class="chat-input-wrapper">
				<textarea
					class="chat-input"
					placeholder="Type a message..."
					bind:value={input}
					on:keydown={handleKeyPress}
					use:adjustTextareaHeight
					disabled={isLoading}
					rows="1"
				></textarea>

				<div class="input-actions-row">
					<button
						class="input-action-btn"
						on:click={startNewChat}
						title="New Chat"
						disabled={isLoading}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><line x1="12" y1="5" x2="12" y2="19"></line><line
								x1="5"
								y1="12"
								x2="19"
								y2="12"
							></line></svg
						>
					</button>

					<button
						class="send-button-icon"
						on:click={sendMessage}
						disabled={isLoading || !input.trim()}
						title="Send message"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path d="m5 12 7-7 7 7" /><path
								d="M12 19V5"
							/></svg
						>
					</button>
				</div>
			</div>
			<div class="input-footer">
				<span
					>AI can make mistakes. Please check important information.</span
				>
				<button
					class="footer-settings-btn"
					on:click={openSettings}
					title="Settings"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><circle cx="12" cy="12" r="3"></circle><path
							d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
						></path></svg
					>
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.app-container {
		display: flex;
		height: 100%;
		width: 100%;
		overflow: hidden;
		background: var(--background-primary);
		box-sizing: border-box;
	}

	.chat-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
		margin: 0 auto;
		min-width: 0; /* Prevent flex overflow */
		box-sizing: border-box;
	}

	.chat-wrapper.readable-line-length {
		max-width: 75ch;
	}

	.chat-wrapper:not(.readable-line-length) {
		max-width: none;
	}

	/* Existing Chat Styles (Adjusted context) */

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		scrollbar-gutter: stable;
		padding: 1rem;
		position: relative;
	}

	.messages-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-height: 100%;
		padding-bottom: 1rem;
	}

	.message-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: opacity 0.1s ease;
	}

	.invisible {
		opacity: 0;
	}

	.loading-container.overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		z-index: 10;
		background: var(--background-primary);
	}

	.welcome-message {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
		margin: auto;
	}

	.loading-container {
		display: flex;
		justify-content: center;
		align-items: center;
		flex: 1;
		height: 100%;
	}

	.chat-input-container {
		padding: 1rem;
		background: var(--background-primary);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.chat-input-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 12px;
		padding: 0.75rem;
		transition: all 0.2s ease;
	}

	.chat-input-wrapper:focus-within {
		border-color: var(--interactive-accent);
		box-shadow: 0 0 0 1px var(--interactive-accent);
	}

	.input-actions-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.input-action-btn {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.4rem;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
	}

	.input-action-btn:hover:not(:disabled) {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.chat-input {
		width: 100%;
		padding: 0;
		border: none;
		border-radius: 0;
		background: transparent;
		color: var(--text-normal);
		font-family: inherit;
		font-size: 0.95rem;
		resize: none;
		max-height: 200px;
		min-height: 40px;
		line-height: 1.5;
		outline: none;
	}

	.chat-input:focus {
		outline: none;
		border: none;
		box-shadow: none;
	}

	.send-button-icon {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: all 0.2s ease;
	}

	.send-button-icon:hover:not(:disabled) {
		background: var(--interactive-accent-hover);
		transform: scale(1.05);
	}

	.send-button-icon:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: var(--background-modifier-border);
	}

	.input-footer {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
		color: var(--text-muted);
		opacity: 0.7;
	}

	.footer-settings-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25rem;
		border-radius: 4px;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
		opacity: 0.7;
	}

	.footer-settings-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		opacity: 1;
	}

	.typing-indicator {
		display: flex;
		gap: 4px;
		padding: 0.5rem;
	}

	.typing-indicator span {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
		animation: typing 1.4s infinite;
	}

	.typing-indicator span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.typing-indicator span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes typing {
		0%,
		60%,
		100% {
			opacity: 0.3;
			transform: translateY(0);
		}
		30% {
			opacity: 1;
			transform: translateY(-10px);
		}
	}
</style>
