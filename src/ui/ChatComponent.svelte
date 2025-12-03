<script lang="ts">
	import { onMount, tick } from "svelte";
	import MessageBubble from "./MessageBubble.svelte";
	import Logo from "./Logo.svelte";
	import FileSuggestionPopup from "./FileSuggestionPopup.svelte";
	import type SmartSecondBrainPlugin from "../main";
	import type { TFile } from "obsidian";

	import type { ThreadMessageToolCall } from "papa-ts";
	import type { UIMessage, ToolCallState } from "./types";
	import { createThreadId, processMessages } from "./chatLogic";

	export let plugin: SmartSecondBrainPlugin;

	export let currentThreadId: string = "default-thread";
	let messages: UIMessage[] = [];
	let input: string = "";
	let chatInput: HTMLTextAreaElement;
	let isLoading: boolean = false;
	let chatContainer: HTMLElement;
	let shouldScrollToLatest = false;
	let isRestoring = false;
	let isInputFocused = false;

	// Suggestion state
	let showSuggestions = false;
	let filteredFiles: TFile[] = [];
	let selectedSuggestionIndex = 0;
	let matchStart = -1;

	// Use plugin setting for readable line length
	let readableLineLength: boolean = false;

	// Reactive statement that updates when settings change
	$: {
		readableLineLength = plugin.settings.readableLineLength ?? false;
	}

	onMount(async () => {
		// If currentThreadId was passed in props (or set externally via component.$set),
		// we load it. Otherwise we create a new thread with date/time-based ID.
		if (currentThreadId === "default-thread") {
			currentThreadId = createThreadId();
		}

		await loadMessages();
		chatInput?.focus();
	});

	// Watch for external ID changes (e.g. from ChatView when opening a file)
	let previousThreadId = "";
	$: if (currentThreadId && currentThreadId !== previousThreadId) {
		previousThreadId = currentThreadId;
		messages = [];
		isLoading = true;
		isRestoring = true; // Hide content during load to prevent jumping
		(async () => {
			await loadMessages();
			isLoading = false;
			// Ensure we stay pinned after loading finishes and final renders happen
			await tick();
			// Small delay to ensure markdown rendering is complete before showing
			setTimeout(() => {
				isRestoring = false;
				chatInput?.focus();
			}, 150);
		})();
	}

	async function loadMessages() {
		try {
			const storedMessages =
				await plugin.agentManager.getThreadMessages(currentThreadId);

			if (storedMessages && storedMessages.length > 0) {
				messages = processMessages(storedMessages);
			} else {
				messages = [];
			}
		} catch (error) {
			console.error("Error loading messages:", error);
			messages = [];
		}
	}

	function handleInput(event: Event) {
		const textarea = event.target as HTMLTextAreaElement;
		const cursor = textarea.selectionStart;
		const text = textarea.value;

		// Look for [[ before cursor
		const lastOpenBracket = text.lastIndexOf("[[", cursor);
		if (lastOpenBracket !== -1) {
			// Check if there is a closing ]] before the cursor (which would mean we are outside)
			// or if there is a newline
			const textAfterBracket = text.slice(lastOpenBracket + 2, cursor);
			if (
				!textAfterBracket.includes("]]") &&
				!textAfterBracket.includes("\n")
			) {
				matchStart = lastOpenBracket;
				const query = textAfterBracket.toLowerCase();

				// Filter files
				const allFiles = plugin.app.vault.getFiles();
				filteredFiles = allFiles
					.filter(
						(file) =>
							file.basename.toLowerCase().includes(query) ||
							file.path.toLowerCase().includes(query),
					)
					.slice(0, 10); // Limit to 10 suggestions

				if (filteredFiles.length > 0) {
					showSuggestions = true;
					selectedSuggestionIndex = 0;
				} else {
					showSuggestions = false;
				}
			} else {
				showSuggestions = false;
			}
		} else {
			showSuggestions = false;
		}
	}

	function selectFile(file: TFile) {
		const cursor = chatInput.selectionStart;
		const text = input;
		const before = text.substring(0, matchStart);
		const after = text.substring(cursor);

		// Use Obsidian's link generator to respect user settings
		const activeFile = plugin.app.workspace.getActiveFile();
		const sourcePath = activeFile ? activeFile.path : "";
		const link = plugin.app.fileManager.generateMarkdownLink(
			file,
			sourcePath,
		);

		// Replace [[query with generated link
		input = `${before}${link}${after}`;

		showSuggestions = false;

		// Restore focus and set cursor position
		tick().then(() => {
			chatInput.focus();
			const newCursorPos = before.length + link.length;
			chatInput.setSelectionRange(newCursorPos, newCursorPos);
		});
	}

	function scrollToBottom() {
		if (chatContainer) {
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

		const textarea = document.querySelector(
			".chat-input",
		) as HTMLTextAreaElement;
		if (textarea) textarea.style.height = "auto";

		const trimmedInput = input.trim();
		const currentInput = trimmedInput;

		const userMessage: UIMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [{ type: "text", text: trimmedInput }],
			timestamp: Date.now(),
		};

		messages = [...messages, userMessage];
		input = "";
		isLoading = true;
		shouldScrollToLatest = true;

		const assistantMessage: UIMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			content: [{ type: "text", text: "" }],
			timestamp: Date.now(),
			toolCalls: [],
		};
		messages = [...messages, assistantMessage];
		const messageIndex = messages.length - 1;

		await tick();
		if (shouldScrollToLatest) {
			scrollToBottom();
			shouldScrollToLatest = false;
		}

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
					// Find the last user message to define the start of the current turn
					let startIndex = 0;
					for (let i = chunk.messages.length - 1; i >= 0; i--) {
						if (chunk.messages[i].role === "user") {
							startIndex = i + 1;
							break;
						}
					}

					// Process messages from the current turn only
					for (let i = startIndex; i < chunk.messages.length; i++) {
						const msg = chunk.messages[i];
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
				// No scrolling here!
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
			// No scroll at the end either

			// Generate thread title after conversation completes
			// Only generate if we have at least one user message and one assistant response
			const userMessages = messages.filter((m) => m.role === "user");
			const assistantMessages = messages.filter(
				(m) => m.role === "assistant",
			);
			if (userMessages.length > 0 && assistantMessages.length > 0) {
				// Generate title asynchronously without blocking
				plugin.agentManager
					.generateThreadTitle(currentThreadId)
					.catch((err) => {
						console.error("Failed to generate thread title:", err);
					});
			}
		}
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (showSuggestions) {
			if (event.key === "ArrowUp") {
				event.preventDefault();
				selectedSuggestionIndex =
					(selectedSuggestionIndex - 1 + filteredFiles.length) %
					filteredFiles.length;
			} else if (event.key === "ArrowDown") {
				event.preventDefault();
				selectedSuggestionIndex =
					(selectedSuggestionIndex + 1) % filteredFiles.length;
			} else if (event.key === "Enter") {
				event.preventDefault();
				selectFile(filteredFiles[selectedSuggestionIndex]);
			} else if (event.key === "Escape") {
				showSuggestions = false;
			}
			return;
		}

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
</script>

<div class="app-container">
	<!-- Sidebar removed, use Obsidian File Explorer -->

	<div class="chat-wrapper" class:readable-line-length={readableLineLength}>
		<div class="chat-messages" bind:this={chatContainer}>
			<div class="messages-content">
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
						<div
							class="logo-container"
							class:input-focused={isInputFocused}
						>
							<Logo class="chat-logo" />
						</div>
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
			<div
				class="chat-input-wrapper"
				on:focusin={() => (isInputFocused = true)}
				on:focusout={() => {
					isInputFocused = false;
					setTimeout(() => {
						showSuggestions = false;
					}, 100);
				}}
			>
				{#if showSuggestions}
					<FileSuggestionPopup
						suggestions={filteredFiles}
						selectedIndex={selectedSuggestionIndex}
						on:select={(e) => selectFile(e.detail)}
					/>
				{/if}
				<textarea
					class="chat-input"
					placeholder="Type a message..."
					bind:value={input}
					bind:this={chatInput}
					on:keydown={handleKeyPress}
					on:input={handleInput}
					use:adjustTextareaHeight
					disabled={isLoading}
					rows="1"
				></textarea>

				<div class="input-actions-row">
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

	.welcome-message .logo-container {
		margin-bottom: 1.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		border-radius: 999px;
		transition: transform 0.12s ease-out;
	}

	.welcome-message :global(.chat-logo) {
		height: 80px;
		width: 80px;
		fill: var(--text-faint);
		stroke: var(--text-faint);
		/* transition:
			fill 0.12s ease-out,
			stroke 0.12s ease-out,
			filter 0.12s ease-out; */
	}

	.welcome-message .logo-container.input-focused {
		transform: translateY(-2px) scale(1.01);
	}

	.welcome-message .logo-container.input-focused :global(.chat-logo) {
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

	.loading-container {
		display: flex;
		justify-content: center;
		align-items: center;
		flex: 1;
		height: 100%;
	}

	.chat-input-container {
		padding: 0 1.25rem 1.35rem;
		background: var(--background-primary);
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		position: relative;
		isolation: isolate;
	}

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

	.chat-input-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 14px;
		padding: 0.9rem 1rem;
		transition: all 0.2s ease;
		position: relative;
		isolation: isolate;
		box-shadow:
			0 4px 16px rgba(0, 0, 0, 0.18),
			0 0 8px 0
				color-mix(in srgb, var(--interactive-accent) 10%, transparent);
	}

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

	.input-actions-row {
		display: flex;
		justify-content: flex-end;
		align-items: center;
	}

	.chat-input {
		width: 100%;
		padding: 0 0 0.1rem;
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
