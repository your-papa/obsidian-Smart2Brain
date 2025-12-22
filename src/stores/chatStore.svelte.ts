import { getPlugin } from "./state.svelte";
import { getData } from "./dataStore.svelte";
import { Notice, TFile } from "obsidian";
import {
	genUUIDv7,
	dateFromUUIDv7,
	type UUIDv7,
} from "../utils/uuid7Validator";
import type { AgentManager } from "../agent/AgentManager";
import type { ThreadMessage, ThreadHistory } from "papa-ts";

/** Error info from a failed thread run */
export interface ThreadError {
	message: string;
	name?: string;
}

/* -----------------------------------------------------------------------------
 * Shared Types
 * ---------------------------------------------------------------------------*/

export enum AssistantState {
	idle,
	streaming,
	success,
	error,
	cancelled,
}

export enum MessageState {
	idle,
	answering,
	editing,
}

export type ToolCallStatus = "running" | "completed" | "failed";

export interface ToolCallState {
	id: string;
	name: string;
	input: Record<string, unknown>;
	status: ToolCallStatus;
	output?: unknown;
}

export interface UserMessage {
	content: string;
	attachments?: File[];
}

export interface AssistantMessage {
	state: AssistantState;
	content: string;
	toolCalls?: ToolCallState[];
	nerd_stats?: {
		tokensPerSecond: number;
		retrievedDocsNum: number;
		genModelConfig: any;
	};
	errorCode?: string;
}

export interface MessagePair {
	id: UUIDv7;
	userMessage: UserMessage;
	assistantMessage: AssistantMessage;
	/** The model used to generate the assistant response */
	model?: ChatModel;
}

export interface ChatPreview {
	id: UUIDv7;
	title: string;
	lastAccessed: Date;
}

export interface ChatModel {
	model: string;
	provider: any;
	modelConfig: any;
}

/**
 * In-memory representation of a chat with messages.
 */
export interface ChatRecord {
	id: string;
	messages: MessagePair[];
}

/* -----------------------------------------------------------------------------
 * ThreadMessage to MessagePair conversion
 * ---------------------------------------------------------------------------*/

/**
 * Extracts text content from a ThreadMessage content field.
 * Handles both string content and array of content objects.
 */
function extractTextContent(content: ThreadMessage["content"]): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(c): c is { type: "text"; text: string } =>
					typeof c === "object" && c !== null && (c as any).type === "text",
			)
			.map((c) => c.text)
			.join("");
	}
	return "";
}

/**
 * Parses tool call arguments into a normalized object format.
 */
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

/**
 * Converts an array of ThreadMessage (from papa-ts/LangGraph) into MessagePair[] for UI rendering.
 *
 * This function:
 * 1. Pairs user messages with their corresponding assistant responses
 * 2. Attaches tool outputs to their parent assistant message's tool calls
 * 3. Merges consecutive assistant messages (tool calls + final response)
 * 4. Uses UUIDv7 for message pair IDs (with timestamp extraction capability)
 * 5. Uses errorCount to distinguish error state from cancelled state
 */
export function threadMessagesToMessagePairs(
	threadMessages: ThreadMessage[],
	errorCount: number = 0,
): MessagePair[] {
	if (!threadMessages || threadMessages.length === 0) return [];

	const messagePairs: MessagePair[] = [];

	// Build a map of tool outputs: tool_call_id -> { content, status }
	const toolOutputs = new Map<
		string,
		{ content: unknown; status: ToolCallStatus }
	>();
	for (const msg of threadMessages) {
		const toolCallId = (msg as any).tool_call_id || (msg as any).toolCallId;
		if (msg.role === "tool" && toolCallId) {
			toolOutputs.set(toolCallId, {
				content: msg.content,
				status: (msg as any).status === "error" ? "failed" : "completed",
			});
		}
	}

	// Filter to just user and assistant messages
	const conversationMessages = threadMessages.filter(
		(msg) => msg.role === "user" || msg.role === "assistant",
	);

	let i = 0;
	while (i < conversationMessages.length) {
		const msg = conversationMessages[i];

		if (msg.role === "user") {
			// Start a new pair with user message
			const userContent = extractTextContent(msg.content);
			// ThreadMessages from LangGraph use UUIDv4, not UUIDv7 - generate fresh UUIDv7
			const pairId = genUUIDv7();

			// Look ahead for assistant response(s)
			const assistantMessages: ThreadMessage[] = [];
			let j = i + 1;
			while (
				j < conversationMessages.length &&
				conversationMessages[j].role === "assistant"
			) {
				assistantMessages.push(conversationMessages[j]);
				j++;
			}

			// Merge assistant messages
			let assistantContent = "";
			const allToolCalls: ToolCallState[] = [];

			for (const assistantMsg of assistantMessages) {
				// Collect tool calls
				const rawToolCalls =
					(assistantMsg as any).tool_calls || (assistantMsg as any).toolCalls;
				if (Array.isArray(rawToolCalls)) {
					for (const tc of rawToolCalls) {
						const toolOutput = toolOutputs.get(tc.id);
						allToolCalls.push({
							id: tc.id,
							name: tc.name,
							input: normalizeToolInput(tc.arguments || tc.input),
							status: toolOutput?.status ?? "running",
							output: toolOutput?.content,
						});
					}
				}

				// Get text content (final response)
				const textContent = extractTextContent(assistantMsg.content);
				if (textContent.trim()) {
					assistantContent = textContent;
				}
			}

			// Determine state for the last message pair
			// If this is the last user message and there's no assistant response:
			// - If errorCount > 0, it was likely an error (errors prevent responses)
			// - Otherwise, it was cancelled by user
			const isLastUserMessage = j >= conversationMessages.length;
			const hasNoResponse = assistantMessages.length === 0;

			let state: AssistantState;

			if (hasNoResponse && errorCount > 0) {
				// If there are errors in the thread and this message has no response, it errored
				state = AssistantState.error;
				errorCount--; // Consume one error
			} else if (hasNoResponse) {
				state = AssistantState.cancelled;
			} else {
				state = AssistantState.success;
			}

			messagePairs.push({
				id: pairId,
				userMessage: { content: userContent },
				assistantMessage: {
					state,
					content: assistantContent,
					toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
				},
			});

			i = j; // Skip past all the assistant messages we consumed
		} else {
			// Orphaned assistant message (no preceding user message)
			// This shouldn't happen normally, but handle it gracefully
			const assistantContent = extractTextContent(msg.content);
			// ThreadMessages from LangGraph use UUIDv4, not UUIDv7 - generate fresh UUIDv7
			const pairId = genUUIDv7();

			messagePairs.push({
				id: pairId,
				userMessage: { content: "" },
				assistantMessage: {
					state: AssistantState.success,
					content: assistantContent,
				},
			});
			i++;
		}
	}

	return messagePairs;
}

/**
 * Get the timestamp from a MessagePair's UUIDv7 id.
 */
export function getMessagePairTimestamp(pair: MessagePair): Date {
	return dateFromUUIDv7(pair.id);
}

/* -----------------------------------------------------------------------------
 * Streaming Types
 * ---------------------------------------------------------------------------*/

type StreamChunk =
	| { type: "token"; token: string }
	| { type: "tool_start"; toolCallId: string; toolName: string; input: unknown }
	| { type: "tool_end"; toolCallId: string; toolName: string; output: unknown }
	| { type: "result"; result?: unknown };

/* -----------------------------------------------------------------------------
 * ChatSession
 *  - Ephemeral per-chat runtime state (streaming, abort, reactive messages)
 *  - Converts ThreadMessages to MessagePairs on load, then works with MessagePairs only
 * ---------------------------------------------------------------------------*/

export class ChatSession {
	readonly id: string;
	// In-memory MessagePairs for UI
	messages: MessagePair[] = $state<MessagePair[]>([]);

	// Streaming / lifecycle
	private abortController: AbortController | null = null;
	private cancelled = false;

	// Reactive UI state
	messageState = $state<MessageState>(MessageState.idle);

	constructor(
		id: string,
		threadMessages: ThreadMessage[],
		errorCount: number = 0,
	) {
		this.id = id;
		// Convert once on load, then drop the raw ThreadMessages
		this.messages = threadMessagesToMessagePairs(threadMessages, errorCount);
	}

	/** Public snapshot (immutable-ish) */
	get snapshot(): ChatRecord {
		return {
			id: this.id,
			messages: this.messages.slice(),
		};
	}

	/** Find a message pair by id */
	private findPair(id: UUIDv7): MessagePair | undefined {
		return this.messages.find((m) => m.id === id);
	}

	/**
	 * Send a user message:
	 *  - Create MessagePair with idle assistant
	 *  - Kick off streaming process
	 */
	async sendMessage(content: string, attachments?: File[]): Promise<UUIDv7> {
		const pairId = genUUIDv7();

		// Capture the current model at send time
		const currentModel = getData().getDefaultChatModel() ?? undefined;

		const pair: MessagePair = {
			id: pairId,
			userMessage: { content, attachments },
			assistantMessage: { state: AssistantState.idle, content: "" },
			model: currentModel,
		};

		this.messages.push(pair);

		// Stream assistant reply
		void this.processAssistantReply(pairId, content);

		return pairId;
	}

	/** Abort current streaming (if any) */
	stopStreaming(): void {
		if (!this.abortController) {
			throw new Error("No active stream to abort");
		}
		this.cancelled = true;
		this.abortController.abort();
	}

	/* -----------------------------------------------------------------------
	 * Streaming logic
	 * ---------------------------------------------------------------------*/

	private appendToken(message: AssistantMessage, token: string) {
		if (!token) return;
		message.content += token;
	}

	private normalizeToolInput(raw: unknown): Record<string, unknown> {
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

	private async processAssistantReply(pairId: UUIDv7, userContent: string) {
		const pair = this.findPair(pairId);
		if (!pair) return;

		// Create AbortController for this streaming session
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		try {
			this.messageState = MessageState.answering;

			// Mark streaming started
			pair.assistantMessage.state = AssistantState.streaming;

			const plugin = getPlugin();
			const stream = plugin.agentManager.streamQuery(
				userContent,
				String(this.id),
				signal,
			) as AsyncIterable<StreamChunk>;

			const assistantMsg = pair.assistantMessage;

			for await (const chunk of stream) {
				if (chunk.type === "token") {
					this.appendToken(assistantMsg, chunk.token);
					continue;
				}

				if (chunk.type === "tool_start") {
					// Add a new tool call in "running" state
					if (!assistantMsg.toolCalls) assistantMsg.toolCalls = [];
					assistantMsg.toolCalls.push({
						id: chunk.toolCallId,
						name: chunk.toolName,
						input: this.normalizeToolInput(chunk.input),
						status: "running",
					});
					continue;
				}

				if (chunk.type === "tool_end") {
					// Find the tool call and mark it completed with output
					if (assistantMsg.toolCalls) {
						const tc = assistantMsg.toolCalls.find(
							(t) => t.id === chunk.toolCallId,
						);
						if (tc) {
							tc.status = "completed";
							tc.output = chunk.output;
						} else {
							// Tool call wasn't found (shouldn't happen, but handle gracefully)
							assistantMsg.toolCalls.push({
								id: chunk.toolCallId,
								name: chunk.toolName,
								input: {},
								status: "completed",
								output: chunk.output,
							});
						}
					} else {
						// No tool calls array yet (shouldn't happen, but handle gracefully)
						assistantMsg.toolCalls = [
							{
								id: chunk.toolCallId,
								name: chunk.toolName,
								input: {},
								status: "completed",
								output: chunk.output,
							},
						];
					}
					continue;
				}

				// For result chunks, stream is complete
				if (chunk.type === "result") {
					break;
				}
			}

			pair.assistantMessage.state = AssistantState.success;
		} catch (err) {
			const failedState: AssistantState = this.cancelled
				? AssistantState.cancelled
				: AssistantState.error;
			pair.assistantMessage.state = failedState;
		} finally {
			this.abortController = null;
			this.cancelled = false;
			this.messageState = MessageState.idle;
		}
	}
}

/* -----------------------------------------------------------------------------
 * Messenger
 *  - Orchestrates sessions
 *  - Uses granular persistence APIs
 * ---------------------------------------------------------------------------*/
export class Messenger {
	session: ChatSession | null = $state(null);
	#agentManager: AgentManager;

	constructor(agentManager: AgentManager) {
		this.#agentManager = agentManager;
	}

	deriveThreadId = (file: TFile): string | null => {
		let threadId = file.basename;
		if (threadId.includes(" - ")) {
			const parts = threadId.split(" - ");
			const dateTimePart = parts[parts.length - 1];
			threadId = `Chat ${dateTimePart}`;
		}
		if (!threadId || threadId === "New Chat") return null;
		return threadId;
	};

	/* ---------------- Chat Creation / Metadata ---------------- */

	async loadSession(file: TFile) {
		const id = this.deriveThreadId(file);
		if (!id) throw new Error("Invalid thread ID");
		const history = await this.#agentManager.getThreadHistory(id);
		// Cast to access lastError and errorCount properties (available after papa-ts rebuild)
		const historyWithError = history as
			| (ThreadHistory & { lastError?: ThreadError; errorCount?: number })
			| null;
		this.session = new ChatSession(
			id,
			historyWithError?.messages || [],
			historyWithError?.errorCount || 0,
		);
	}

	/* ---------------- Sending Messages ---------------- */

	async sendMessage(content: string, attachments?: File[]): Promise<string> {
		if (!this.session) {
			throw new Error("No active session");
		}
		return this.session.sendMessage(content, attachments);
	}
}

/* -----------------------------------------------------------------------------
 * Singleton helpers (unchanged pattern)
 * ---------------------------------------------------------------------------*/
let messengerSingleton: Messenger | null = null;

export function createMessenger(agentManager?: AgentManager): Messenger {
	if (!messengerSingleton) {
		if (!agentManager) {
			throw new Error("AgentManager is required for first Messenger creation");
		}
		messengerSingleton = new Messenger(agentManager);
	}
	return messengerSingleton;
}

export function getMessenger(): Messenger | null {
	return messengerSingleton;
}
