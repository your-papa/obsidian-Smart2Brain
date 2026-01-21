import { createAgent, type ReactAgent } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StreamEvent } from "@langchain/core/tracers/log_stream";
import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { Notice } from "obsidian";

import type { ProviderRegistry } from "./providers/ProviderRegistry";
import { ProviderEndpointError, ProviderNotFoundError } from "./providers/errors";
import type { ModelOptions } from "./providers/types";
import type { Telemetry } from "./telemetry/Telemetry";
import { createSnapshot, type ThreadSnapshot, type ThreadStore } from "./memory/ThreadStore";
import { getMessageText, normalizeThreadMessages, type ThreadMessage } from "./messages/ThreadMessage";
import { getData } from "../stores/dataStore.svelte";
import Logger from "../logging";

export interface ChooseModelParams {
	provider: string;
	chatModel?: string;
	options?: ModelOptions;
}

export interface AgentRunOptions {
	query: string;
	threadId?: string;
	metadata?: Record<string, unknown>;
	configurable?: Record<string, unknown>;
	signal?: AbortSignal;
}

export interface AgentResult {
	runId: string;
	threadId: string;
	durationMs: number;
	messages: ThreadMessage[];
	response?: unknown;
	raw: unknown;
}

export interface ThreadError {
	message: string;
	name?: string;
}

export interface ThreadHistory extends ThreadSnapshot {
	messages: ThreadMessage[];
	/** If the last run errored, this will contain the error details */
	lastError?: ThreadError;
	/** Count of errors in the thread (for detecting multiple errored messages) */
	errorCount?: number;
}

export interface AgentOptions {
	registry: ProviderRegistry;
	telemetry?: Telemetry;
	threadStore?: ThreadStore;
	checkpointer?: BaseCheckpointSaver;
	defaultPrompt?: string;
}

type AgentRunnable = ReactAgent; // invoke(), stream(), etc.

export type AgentStreamOptions = AgentRunOptions;

export type AgentStreamChunk =
	| {
			type: "token";
			token: string;
			runId: string;
			threadId: string;
	  }
	| {
			type: "tool_start";
			toolCallId: string;
			toolName: string;
			input: unknown;
			runId: string;
			threadId: string;
	  }
	| {
			type: "tool_end";
			toolCallId: string;
			toolName: string;
			output: unknown;
			runId: string;
			threadId: string;
	  }
	| {
			type: "result";
			result: AgentResult;
			runId: string;
			threadId: string;
	  }
	| {
			type: "checkpoint_message";
			message: ThreadMessage;
			runId: string;
			threadId: string;
	  };

interface SelectedModel {
	provider: string;
	name: string;
	instance: BaseChatModel;
	options?: ModelOptions;
}

export class Agent {
	private prompt: string;
	private tools: readonly unknown[] = [];
	private selectedModel?: SelectedModel;
	private agentRunnable?: AgentRunnable;
	private readonly checkpointer: BaseCheckpointSaver;
	private readonly telemetry?: Telemetry;
	private readonly threadStore?: ThreadStore;
	private readonly registry: ProviderRegistry;
	private dirty = true;

	constructor(options: AgentOptions) {
		this.registry = options.registry;
		this.telemetry = options.telemetry;
		this.threadStore = options.threadStore;
		this.checkpointer = options.checkpointer ?? new MemorySaver();
		this.prompt = options.defaultPrompt ?? "You are a privacy-focused assistant.";
		Logger.debug("agent.init", {
			hasTelemetry: Boolean(this.telemetry),
			hasThreadStore: Boolean(this.threadStore),
			checkpointer: this.checkpointer.constructor?.name ?? "unknown",
		});
	}

	setPrompt(prompt: string): void {
		this.prompt = prompt;
		this.dirty = true;
	}

	bindTools(tools: readonly unknown[]): void {
		this.tools = tools;
		this.dirty = true;
	}

	async chooseModel(params: ChooseModelParams): Promise<void> {
		const { provider, chatModel, options } = params;
		let instance: BaseChatModel;
		try {
			instance = await this.registry.getChatModel(provider, chatModel, options);
		} catch (error) {
			if (error instanceof ProviderNotFoundError) {
				getData().setDefaultChatModel(null);
				new Notice(`Provider "${provider}" is no longer available. Please select a new model.`);
				throw error;
			}
			throw error;
		}
		const modelName = chatModel ?? this.registry.listChatModels(provider)[0];
		if (!modelName) {
			throw new Error(`No chat models registered for provider "${provider}".`);
		}
		this.selectedModel = {
			provider,
			name: modelName,
			instance,
			options,
		};
		Logger.debug("agent.chooseModel", { provider, modelName, options });
		this.dirty = true;
	}

	async run(options: AgentRunOptions): Promise<AgentResult> {
		const { query } = options;
		if (!this.selectedModel) {
			throw new Error("No model selected. Call chooseModel() before run().");
		}

		if (!query || query.trim().length === 0) {
			throw new Error("Query must be a non-empty string.");
		}

		const agent = await this.ensureAgent();
		const runId = this.generateId();
		const threadId = options.threadId ?? runId;
		const startedAt = new Date();
		Logger.debug("agent.run.start", {
			runId,
			threadId,
			provider: this.selectedModel.provider,
			model: this.selectedModel.name,
			queryPreview: query.slice(0, 200),
		});

		const invokeConfig = this.buildRunnableConfig(options, threadId);

		const rawResult = await agent.invoke(
			{
				messages: [
					{
						role: "user",
						content: query,
					},
				],
			},
			invokeConfig,
		);

		const finishedAt = new Date();
		const messages = this.extractMessagesFromResult(rawResult);
		await this.persistThreadMetadata(threadId, runId, messages);

		const result: AgentResult = {
			runId,
			threadId,
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			messages,
			response: this.extractResponse(messages),
			raw: rawResult,
		};

		await this.telemetry?.onRunComplete?.(result);
		Logger.debug("agent.run.complete", {
			runId,
			durationMs: result.durationMs,
			responsePreview:
				typeof result.response === "string" ? (result.response as string).slice(0, 200) : undefined,
		});

		return result;
	}

	async *streamTokens(options: AgentStreamOptions): AsyncGenerator<AgentStreamChunk> {
		const { query } = options;
		if (!this.selectedModel) {
			throw new Error("No model selected. Call chooseModel() before streamTokens().");
		}

		if (!query || query.trim().length === 0) {
			throw new Error("Query must be a non-empty string.");
		}

		const agent = await this.ensureAgent();
		const runId = this.generateId();
		const threadId = options.threadId ?? runId;
		const startedAt = new Date();
		Logger.debug("agent.streamTokens.start", {
			runId,
			threadId,
			provider: this.selectedModel.provider,
			model: this.selectedModel.name,
			queryPreview: query.slice(0, 200),
		});

		type StreamEventsConfig = Parameters<AgentRunnable["streamEvents"]>[1];
		const streamConfig = {
			...this.buildRunnableConfig(options, threadId),
			version: "v2" as const,
		} as StreamEventsConfig;

		const stream = agent.streamEvents(
			{
				messages: [
					{
						role: "user",
						content: query,
					},
				],
			},
			streamConfig,
		);

		let rawResult: unknown;
		// Track tool calls in progress to correlate start/end events
		const pendingToolCalls = new Map<string, { name: string; input: unknown }>();

		try {
			for await (const event of stream) {
				// Check if aborted before processing
				if (options.signal?.aborted) {
					Logger.debug("agent.streamTokens.aborted", { runId, threadId });
					break;
				}

				// Handle tool start events - emit tool_start chunk
				if (event.event === "on_tool_start") {
					const toolCallId = event.run_id;
					const toolName = event.name ?? "unknown_tool";
					const input = event.data?.input ?? {};

					pendingToolCalls.set(toolCallId, { name: toolName, input });
					Logger.debug("agent.streamTokens.tool_start", { runId, toolCallId, toolName });

					yield {
						type: "tool_start",
						toolCallId,
						toolName,
						input,
						runId,
						threadId,
					};
					continue;
				}

				// Handle tool end events - emit tool_end chunk
				if (event.event === "on_tool_end") {
					const toolCallId = event.run_id;
					const pending = pendingToolCalls.get(toolCallId);
					const toolName = pending?.name ?? event.name ?? "unknown_tool";
					const output = event.data?.output ?? {};

					pendingToolCalls.delete(toolCallId);
					Logger.debug("agent.streamTokens.tool_end", { runId, toolCallId, toolName });

					yield {
						type: "tool_end",
						toolCallId,
						toolName,
						output,
						runId,
						threadId,
					};
					continue;
				}

				// Handle token streaming
				const token = this.extractTokenFromEvent(event);
				if (token) {
					yield {
						type: "token",
						token,
						runId,
						threadId,
					};
				}

				// Capture final output for result
				const output = this.extractOutputFromEvent(event);
				if (output) {
					rawResult = output;
				}
			}
		} catch (error) {
			// Don't log or rethrow abort errors - they're expected during cancellation
			if (error instanceof Error && error.name === "AbortError") {
				Logger.debug("agent.streamTokens.aborted", { runId, threadId });
				return;
			}

			// Wrap connection errors in ProviderEndpointError for consistent handling
			if (error instanceof TypeError && error.message.includes("fetch")) {
				const provider = this.selectedModel?.provider ?? "unknown";
				Logger.debug("agent.streamTokens.error", { runId, message: `Connection failed to ${provider}` });
				throw new ProviderEndpointError(provider, "Connection refused - service may not be running");
			}

			Logger.debug("agent.streamTokens.error", {
				runId,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			Logger.debug("agent.streamTokens.cleanup", { runId, threadId });
		}

		// If aborted, don't process final result
		if (options.signal?.aborted) {
			return;
		}

		if (!rawResult) {
			throw new Error("Agent streaming completed without producing a final output.");
		}

		const finishedAt = new Date();
		const messages = this.extractMessagesFromResult(rawResult);
		await this.persistThreadMetadata(threadId, runId, messages);

		const result: AgentResult = {
			runId,
			threadId,
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			messages,
			response: this.extractResponse(messages),
			raw: rawResult,
		};

		await this.telemetry?.onRunComplete?.(result);
		Logger.debug("agent.streamTokens.complete", {
			runId,
			durationMs: result.durationMs,
			responsePreview:
				typeof result.response === "string" ? (result.response as string).slice(0, 200) : undefined,
		});

		yield {
			type: "result",
			result,
			runId,
			threadId,
		};

		// Read the latest checkpoint to get the final assistant message as persisted
		// This ensures UI stays in sync with the database
		const checkpointMessage = await this.getLastAssistantMessageFromCheckpoint(threadId);
		if (checkpointMessage) {
			Logger.debug("agent.streamTokens.checkpoint_message", {
				runId,
				threadId,
				messageId: checkpointMessage.id,
			});
			yield {
				type: "checkpoint_message",
				message: checkpointMessage,
				runId,
				threadId,
			};
		}
	}

	async getThreadHistory(threadId: string): Promise<ThreadHistory | undefined> {
		const [metadata, tuple] = await Promise.all([
			this.threadStore?.read(threadId),
			this.safeGetCheckpointTuple(threadId),
		]);

		if (!metadata && !tuple) {
			return undefined;
		}

		const checkpointTimestamp = tuple ? Date.parse(tuple.checkpoint.ts) || Date.now() : Date.now();
		const baseSnapshot = metadata
			? { ...metadata }
			: createSnapshot({
					threadId,
					updatedAt: checkpointTimestamp,
					createdAt: checkpointTimestamp,
				});
		const messages = tuple ? this.extractMessagesFromCheckpoint(tuple) : [];
		const { lastError, errorCount } = tuple
			? this.extractErrorsFromCheckpoint(tuple)
			: { lastError: undefined, errorCount: 0 };

		return {
			...baseSnapshot,
			updatedAt: metadata?.updatedAt ?? checkpointTimestamp,
			messages,
			lastError,
			errorCount,
		};
	}

	/**
	 * Extracts error information from checkpoint's pendingWrites.
	 * Errors are stored with channel "__error__".
	 * Returns both the last error and total error count.
	 */
	private extractErrorsFromCheckpoint(tuple: CheckpointTuple): { lastError?: ThreadError; errorCount: number } {
		const pendingWrites = tuple.pendingWrites;
		Logger.debug("extractErrorsFromCheckpoint - pendingWrites:", pendingWrites);

		if (!Array.isArray(pendingWrites)) {
			Logger.debug("extractErrorsFromCheckpoint - pendingWrites is not an array");
			return { lastError: undefined, errorCount: 0 };
		}

		Logger.debug("extractErrorsFromCheckpoint - pendingWrites length:", pendingWrites.length);

		let lastError: ThreadError | undefined;
		let errorCount = 0;

		// pendingWrites can be either:
		// - [taskId, channel, value] tuples (3 elements) - standard LangGraph format
		// - [channel, value] tuples (2 elements) - some checkpoint implementations
		for (const write of pendingWrites) {
			Logger.debug("extractErrorsFromCheckpoint - checking write:", write);
			if (!Array.isArray(write)) continue;
			const writeLen = write.length as number;
			if (writeLen < 2) continue;

			let channel: unknown;
			let value: unknown;

			if (writeLen === 2) {
				// Format: [channel, value]
				[channel, value] = write;
			} else {
				// Format: [taskId, channel, value]
				[, channel, value] = write;
			}

			Logger.debug("extractErrorsFromCheckpoint - channel:", channel, "value:", value);
			if (channel === "__error__") {
				errorCount++;
				// Error value typically has { message: string, name?: string }
				if (value && typeof value === "object") {
					const errorObj = value as Record<string, unknown>;
					lastError = {
						message: String(errorObj.message ?? "Unknown error"),
						name: errorObj.name ? String(errorObj.name) : undefined,
					};
					Logger.debug(`extractErrorsFromCheckpoint - FOUND ERROR #${errorCount}:`, lastError);
				}
			}
		}

		Logger.debug("extractErrorsFromCheckpoint - total errors found:", errorCount);
		return { lastError, errorCount };
	}

	private buildRunnableConfig(options: AgentRunOptions, threadId: string): RunnableConfig {
		const callbacks = this.telemetry?.getCallbacks?.();
		return {
			configurable: {
				thread_id: threadId,
				...(options.configurable ?? {}),
			},
			metadata: options.metadata,
			callbacks: callbacks ?? undefined,
			signal: options.signal,
		} as RunnableConfig;
	}

	private async ensureAgent(): Promise<AgentRunnable> {
		if (!this.selectedModel) {
			throw new Error("No model selected.");
		}

		if (this.agentRunnable && !this.dirty) {
			return this.agentRunnable;
		}

		this.agentRunnable = createAgent({
			model: this.selectedModel.instance,
			tools: Array.isArray(this.tools) ? [...this.tools] : [],
			systemPrompt: this.prompt,
			checkpointer: this.checkpointer,
		});
		this.dirty = false;
		return this.agentRunnable;
	}

	private extractMessagesFromResult(result: unknown): ThreadMessage[] {
		if (!result || typeof result !== "object" || !("messages" in result)) {
			return [];
		}
		const messages = (result as { messages?: unknown }).messages;
		if (!Array.isArray(messages)) {
			return [];
		}
		return normalizeThreadMessages(messages);
	}

	private extractMessagesFromCheckpoint(tuple: CheckpointTuple): ThreadMessage[] {
		const channelValues = tuple.checkpoint?.channel_values as Record<string, unknown> | undefined;
		if (!channelValues) {
			return [];
		}
		const messages = channelValues.messages;
		if (!Array.isArray(messages)) {
			return [];
		}
		return normalizeThreadMessages(messages);
	}

	private extractOutputFromEvent(event: StreamEvent): unknown | undefined {
		const output = event?.data?.output;
		if (this.isAgentOutputCandidate(output)) {
			return output;
		}
		return undefined;
	}

	private extractMessagesFromEvent(event: StreamEvent): ThreadMessage[] {
		// Check final output first (most complete state, includes tool calls)
		const output = this.extractOutputFromEvent(event);
		if (output) {
			return this.extractMessagesFromResult(output);
		}

		// Check if event.data.output exists but wasn't recognized as agent output
		// This can happen with intermediate chain outputs that contain messages
		const dataOutput = event?.data?.output;
		if (dataOutput && typeof dataOutput === "object" && "messages" in dataOutput) {
			const messages = (dataOutput as { messages?: unknown }).messages;
			if (Array.isArray(messages)) {
				return normalizeThreadMessages(messages);
			}
		}

		// Check chunk data for messages
		const chunk = event?.data?.chunk;
		if (!chunk || typeof chunk !== "object") {
			return [];
		}

		// Check if chunk itself is an array of messages
		if (Array.isArray(chunk)) {
			return normalizeThreadMessages(chunk);
		}

		// Check if chunk contains a messages array
		if ("messages" in chunk) {
			const messages = (chunk as { messages?: unknown }).messages;
			if (Array.isArray(messages)) {
				return normalizeThreadMessages(messages);
			}
		}

		// Check if chunk is a single message object (common during token streaming)
		if ("content" in chunk || "role" in chunk || "lc" in chunk || "kwargs" in chunk) {
			return normalizeThreadMessages([chunk]);
		}

		return [];
	}

	private extractTokenFromEvent(event: StreamEvent): string | undefined {
		if (!event.event.endsWith("_stream")) {
			return undefined;
		}
		const chunk = event.data?.chunk;
		if (typeof chunk === "undefined" || chunk === null) {
			return undefined;
		}
		const token = this.normalizeContentToString(chunk);
		return token && token.length > 0 ? token : undefined;
	}

	private normalizeContentToString(value: unknown): string | undefined {
		if (typeof value === "string") {
			return value;
		}
		if (Array.isArray(value)) {
			const combined = value
				.map((entry) => {
					if (typeof entry === "string") {
						return entry;
					}
					if (entry && typeof entry === "object") {
						if (typeof (entry as { text?: unknown }).text === "string") {
							return (entry as { text: string }).text;
						}
						if (typeof (entry as { content?: unknown }).content === "string") {
							return (entry as { content: string }).content;
						}
					}
					return "";
				})
				.join("");
			return combined.length > 0 ? combined : undefined;
		}
		if (value && typeof value === "object") {
			const textField = (value as { text?: unknown }).text;
			if (typeof textField === "string") {
				return textField;
			}
			const contentField = (value as { content?: unknown }).content;
			const contentText = this.normalizeContentToString(contentField);
			if (contentText) {
				return contentText;
			}
			const messageField = (value as { message?: { content?: unknown } }).message;
			if (messageField) {
				const messageText = this.normalizeContentToString(messageField.content);
				if (messageText) {
					return messageText;
				}
			}
			const deltaField = (value as { delta?: unknown }).delta;
			if (deltaField) {
				const deltaText = this.normalizeContentToString(deltaField);
				if (deltaText) {
					return deltaText;
				}
			}
		}
		return undefined;
	}

	private isAgentOutputCandidate(value: unknown): value is { messages: unknown[] } {
		return Boolean(
			value &&
				typeof value === "object" &&
				"messages" in (value as Record<string, unknown>) &&
				Array.isArray((value as { messages?: unknown }).messages),
		);
	}

	private extractResponse(messages: ThreadMessage[]): unknown {
		if (messages.length === 0) {
			return undefined;
		}
		const last = messages[messages.length - 1];
		return getMessageText(last) ?? last.content;
	}

	private async persistThreadMetadata(threadId: string, runId: string, messages: ThreadMessage[]): Promise<void> {
		if (!this.threadStore) {
			return;
		}
		const existing = await this.threadStore.read(threadId);
		const metadata: Record<string, unknown> = { ...(existing?.metadata ?? {}) };
		metadata.lastRunId = runId;
		metadata.model = this.selectedModel?.name;
		const lastMessage = messages[messages.length - 1];
		const preview = getMessageText(lastMessage);
		if (preview) {
			metadata.lastMessagePreview = preview.slice(0, 200);
		}
		if (lastMessage?.role) {
			metadata.lastMessageRole = lastMessage.role;
		}
		await this.threadStore.write(
			createSnapshot({
				threadId,
				title: existing?.title,
				metadata,
				createdAt: existing?.createdAt,
			}),
		);
		Logger.debug("agent.threadStore.write", { threadId, lastRunId: runId });
	}

	async generateTitle(userMessage: string): Promise<string | undefined> {
		if (!this.selectedModel) {
			throw new Error("No model selected. Call chooseModel() before generateTitle().");
		}

		const prompt = `Generate a short, concise title (max 5 words) for the following user question. Do not use quotes or markdown.

User question:
${userMessage}`;

		const response = await this.selectedModel.instance.invoke([{ role: "user", content: prompt }]);

		const content = response.content;
		let title = "";
		if (typeof content === "string") {
			title = content;
		} else if (Array.isArray(content)) {
			title = content.map((c) => (typeof c === "string" ? c : ((c as { text?: string }).text ?? ""))).join("");
		}

		return title.replace(/^["']|["']$/g, "").trim();
	}

	private async safeGetCheckpointTuple(threadId: string): Promise<CheckpointTuple | undefined> {
		try {
			return await this.checkpointer.getTuple({
				configurable: { thread_id: threadId },
			});
		} catch (error) {
			Logger.debug("agent.checkpointer.getTuple.error", {
				threadId,
				message: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
	}

	private generateId(): string {
		if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
			return globalThis.crypto.randomUUID();
		}
		return `run_${Math.random().toString(36).slice(2, 10)}`;
	}

	/**
	 * Reads the latest checkpoint and extracts the last assistant message.
	 * Used to ensure UI stays in sync with persisted state after streaming.
	 */
	private async getLastAssistantMessageFromCheckpoint(threadId: string): Promise<ThreadMessage | undefined> {
		const tuple = await this.safeGetCheckpointTuple(threadId);
		if (!tuple) {
			return undefined;
		}

		const messages = this.extractMessagesFromCheckpoint(tuple);
		if (messages.length === 0) {
			return undefined;
		}

		// Find the last assistant message
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "assistant") {
				return messages[i];
			}
		}

		return undefined;
	}
}
