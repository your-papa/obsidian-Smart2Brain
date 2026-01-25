import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
	isAIMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StreamEvent } from "@langchain/core/tracers/log_stream";
import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { type ReactAgent, createAgent } from "langchain";
import { Notice } from "obsidian";

import { ProviderEndpointError, ProviderNotFoundError } from "../providers/errors";
import type { ChatModelConfig } from "../providers/index";
import type { ProviderRegistry } from "../providers/registry";
import { getData } from "../stores/dataStore.svelte";
import type { ThreadError } from "../types/shared";
import Logger from "../utils/logging";
import { type ThreadSnapshot, type ThreadStore, createSnapshot } from "./memory/ThreadStore";
import type { Telemetry } from "./telemetry/Telemetry";

export interface ChooseModelParams {
	provider: string;
	chatModel: string;
	options?: Partial<ChatModelConfig>;
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
	messages: BaseMessage[];
	response?: unknown;
	raw: unknown;
}

export interface ThreadHistory extends ThreadSnapshot {
	messages: BaseMessage[];
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
			type: "reasoning_token";
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
			message: BaseMessage;
			runId: string;
			threadId: string;
	  };

interface SelectedModel {
	provider: string;
	name: string;
	instance: BaseChatModel;
	options?: Partial<ChatModelConfig>;
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

		// Create a LangChain instance for this provider + model
		let instance: BaseChatModel;
		try {
			instance = this.registry.createChatInstance(provider, chatModel, options);
		} catch (error) {
			if (error instanceof ProviderNotFoundError) {
				getData().setDefaultChatModel(null);
				new Notice(`Provider "${provider}" is no longer available. Please select a new model.`);
				throw error;
			}
			throw error;
		}

		this.selectedModel = {
			provider,
			name: chatModel,
			instance,
			options,
		};
		Logger.debug("agent.chooseModel", { provider, chatModel, options });
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

				// Handle reasoning token streaming (thinking/reasoning content)
				const reasoningToken = this.extractReasoningFromEvent(event);
				if (reasoningToken) {
					yield {
						type: "reasoning_token",
						token: reasoningToken,
						runId,
						threadId,
					};
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

	private extractMessagesFromResult(result: unknown): BaseMessage[] {
		if (!result || typeof result !== "object" || !("messages" in result)) {
			return [];
		}
		const messages = (result as { messages?: unknown }).messages;
		if (!Array.isArray(messages)) {
			return [];
		}
		// Messages from agent.invoke() should be BaseMessage instances, but normalize just in case
		return this.normalizeMessages(messages);
	}

	private extractMessagesFromCheckpoint(tuple: CheckpointTuple): BaseMessage[] {
		const channelValues = tuple.checkpoint?.channel_values as Record<string, unknown> | undefined;
		if (!channelValues) {
			return [];
		}
		const messages = channelValues.messages;
		if (!Array.isArray(messages)) {
			return [];
		}
		// Convert serialized messages to BaseMessage instances
		return this.normalizeMessages(messages);
	}

	/**
	 * Converts various message formats to proper BaseMessage instances.
	 * Handles:
	 * - Already instantiated BaseMessage objects (have _getType method)
	 * - Serialized LangChain format: { id: [...], kwargs: {...} }
	 * - StoredMessage format: { type: string, data: {...} }
	 * - Plain objects with type field: { type: "human" | "ai" | ... }
	 */
	private normalizeMessages(messages: unknown[]): BaseMessage[] {
		const result: BaseMessage[] = [];

		for (const msg of messages) {
			if (!msg || typeof msg !== "object") continue;

			const normalized = this.normalizeMessage(msg as Record<string, unknown>);
			if (normalized) {
				result.push(normalized);
			}
		}

		return result;
	}

	private normalizeMessage(msg: Record<string, unknown>): BaseMessage | undefined {
		// Check if it's already a BaseMessage instance (has _getType method)
		if (typeof (msg as { _getType?: unknown })._getType === "function") {
			return msg as unknown as BaseMessage;
		}

		// Handle serialized LangChain format: { id: [...], kwargs: {...} }
		if ("kwargs" in msg && typeof msg.kwargs === "object" && msg.kwargs !== null) {
			return this.convertSerializedLangChainMessage(msg);
		}

		// Handle StoredMessage format: { type: string, data: { content: string, ... } }
		if (typeof msg.type === "string" && msg.data && typeof msg.data === "object") {
			const data = msg.data as Record<string, unknown>;
			return this.convertPlainMessage(msg.type as string, {
				...data,
				type: msg.type,
			});
		}

		// Handle plain object with type field (human, ai, system, tool)
		if (typeof msg.type === "string") {
			return this.convertPlainMessage(msg.type, msg);
		}

		return undefined;
	}

	private convertSerializedLangChainMessage(msg: Record<string, unknown>): BaseMessage | undefined {
		const kwargs = msg.kwargs as Record<string, unknown>;
		const content = this.extractContent(kwargs);
		const id = typeof kwargs.id === "string" ? kwargs.id : undefined;

		// Determine type from class name in id array
		const className = this.readLangChainClassName(msg.id);

		switch (className) {
			case "HumanMessage":
			case "HumanMessageChunk":
				return new HumanMessage({ content, id });
			case "AIMessage":
			case "AIMessageChunk": {
				const toolCalls = this.extractToolCalls(kwargs);
				return new AIMessage({ content, id, tool_calls: toolCalls });
			}
			case "SystemMessage":
				return new SystemMessage({ content, id });
			case "ToolMessage": {
				const toolCallId = typeof kwargs.tool_call_id === "string" ? kwargs.tool_call_id : "";
				return new ToolMessage({ content, tool_call_id: toolCallId, id });
			}
			default:
				// Default to AIMessage for unknown types
				return new AIMessage({ content, id });
		}
	}

	private convertPlainMessage(type: string, msg: Record<string, unknown>): BaseMessage | undefined {
		const content = this.extractContent(msg);
		const id = typeof msg.id === "string" ? msg.id : undefined;

		switch (type.toLowerCase()) {
			case "human":
			case "humanmessage":
				return new HumanMessage({ content, id });
			case "ai":
			case "aimessage": {
				const toolCalls = this.extractToolCalls(msg);
				return new AIMessage({ content, id, tool_calls: toolCalls });
			}
			case "system":
			case "systemmessage":
				return new SystemMessage({ content, id });
			case "tool":
			case "toolmessage": {
				const toolCallId = typeof msg.tool_call_id === "string" ? msg.tool_call_id : "";
				return new ToolMessage({ content, tool_call_id: toolCallId, id });
			}
			default:
				return undefined;
		}
	}

	private extractContent(obj: Record<string, unknown>): string {
		const content = obj.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.map((c) => {
					if (typeof c === "string") return c;
					if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
						return (c as { text: string }).text;
					}
					return "";
				})
				.join("");
		}
		return "";
	}

	private extractToolCalls(
		obj: Record<string, unknown>,
	): { id: string; name: string; args: Record<string, unknown> }[] | undefined {
		return this.parseToolCalls(obj.tool_calls);
	}

	private parseToolCalls(
		toolCalls: unknown,
	): { id: string; name: string; args: Record<string, unknown> }[] | undefined {
		if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;

		return toolCalls
			.filter((tc): tc is Record<string, unknown> => tc && typeof tc === "object")
			.map((tc) => ({
				id: typeof tc.id === "string" ? tc.id : "",
				name: typeof tc.name === "string" ? tc.name : "",
				args: this.parseToolArgs(tc.args ?? tc.arguments),
			}));
	}

	private parseToolArgs(args: unknown): Record<string, unknown> {
		if (typeof args === "string") {
			try {
				return JSON.parse(args) as Record<string, unknown>;
			} catch {
				return {};
			}
		}
		if (args && typeof args === "object" && !Array.isArray(args)) {
			return args as Record<string, unknown>;
		}
		return {};
	}

	private readLangChainClassName(identifier: unknown): string | undefined {
		if (typeof identifier === "string") {
			return identifier.split(":").pop();
		}
		if (Array.isArray(identifier) && typeof identifier[identifier.length - 1] === "string") {
			return identifier[identifier.length - 1] as string;
		}
		return undefined;
	}

	private extractOutputFromEvent(event: StreamEvent): unknown | undefined {
		const output = event?.data?.output;
		if (this.isAgentOutputCandidate(output)) {
			return output;
		}
		return undefined;
	}

	private extractMessagesFromEvent(event: StreamEvent): BaseMessage[] {
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
				return messages.filter((msg): msg is BaseMessage => msg && typeof msg === "object");
			}
		}

		// Check chunk data for messages
		const chunk = event?.data?.chunk;
		if (!chunk || typeof chunk !== "object") {
			return [];
		}

		// Check if chunk itself is an array of messages
		if (Array.isArray(chunk)) {
			return chunk.filter((msg): msg is BaseMessage => msg && typeof msg === "object");
		}

		// Check if chunk contains a messages array
		if ("messages" in chunk) {
			const messages = (chunk as { messages?: unknown }).messages;
			if (Array.isArray(messages)) {
				return messages.filter((msg): msg is BaseMessage => msg && typeof msg === "object");
			}
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

	/**
	 * Extracts reasoning/thinking tokens from a streaming event.
	 *
	 * Follows LangChain's native pattern as documented at:
	 * https://docs.langchain.com/oss/javascript/langchain/models#reasoning
	 *
	 * Native pattern:
	 * ```typescript
	 * for await (const chunk of stream) {
	 *   for (const block of chunk.contentBlocks) {
	 *     if (block.type === "reasoning") {
	 *       console.log(`Reasoning: ${block.reasoning}`);
	 *     }
	 *   }
	 * }
	 * ```
	 *
	 * Note: Some providers (e.g., DeepSeek R1 via OpenRouter) may not yet normalize
	 * reasoning into contentBlocks. Fallbacks are provided for these cases.
	 */
	private extractReasoningFromEvent(event: StreamEvent): string | undefined {
		if (!event.event.endsWith("_stream")) {
			return undefined;
		}
		const chunk = event.data?.chunk;
		if (typeof chunk === "undefined" || chunk === null) {
			return undefined;
		}

		const chunkObj = chunk as Record<string, unknown>;

		// LangChain native way: Access contentBlocks property directly
		// Reference: https://docs.langchain.com/oss/javascript/langchain/models#reasoning
		// The chunk should be an AIMessageChunk with contentBlocks property
		const contentBlocks = chunkObj.contentBlocks ?? chunkObj.content_blocks;

		// LangChain native pattern: Filter contentBlocks for reasoning type
		// This is the standard way per LangChain docs
		if (Array.isArray(contentBlocks)) {
			const reasoningParts: string[] = [];
			for (const block of contentBlocks) {
				// Native LangChain format: { type: "reasoning", reasoning: "..." }
				const reasoning = this.extractReasoningFromContentBlock(block);
				if (reasoning) {
					reasoningParts.push(reasoning);
				}
			}
			if (reasoningParts.length > 0) {
				return reasoningParts.join("");
			}
		}

		// =====================================================================
		// Fallbacks for providers that don't yet normalize reasoning into contentBlocks
		// These are temporary until LangChain fully supports all providers
		// =====================================================================

		// Fallback 1: Check raw content array for reasoning blocks
		// Some providers may put reasoning blocks directly in content array
		if (Array.isArray(chunkObj.content)) {
			const reasoningParts: string[] = [];
			for (const block of chunkObj.content) {
				const reasoning = this.extractReasoningFromContentBlock(block);
				if (reasoning) {
					reasoningParts.push(reasoning);
				}
			}
			if (reasoningParts.length > 0) {
				return reasoningParts.join("");
			}
		}

		// Check response_metadata for reasoning (OpenRouter/DeepSeek might put it here)
		const responseMetadata = chunkObj.response_metadata as Record<string, unknown> | undefined;
		if (responseMetadata?.reasoning || responseMetadata?.reasoning_content) {
			const reasoning = (responseMetadata.reasoning || responseMetadata.reasoning_content) as string;
			if (reasoning) {
				return reasoning;
			}
		}

		// Check lc_kwargs for reasoning (LangChain internal structure)
		const lcKwargs = chunkObj.lc_kwargs as Record<string, unknown> | undefined;
		if (lcKwargs) {
			// Check for reasoning_content in lc_kwargs
			if (lcKwargs.reasoning_content) {
				const reasoning = lcKwargs.reasoning_content as string;
				if (reasoning) {
					return reasoning;
				}
			}

			// Check additional_kwargs inside lc_kwargs
			const additionalKwargsInLc = lcKwargs.additional_kwargs as Record<string, unknown> | undefined;
			if (additionalKwargsInLc?.reasoning_content) {
				const reasoning = additionalKwargsInLc.reasoning_content as string;
				if (reasoning) {
					return reasoning;
				}
			}
		}

		// Fallback 2: Check additional_kwargs.reasoning_content
		// DeepSeek R1 and OpenAI o1 may put reasoning here before LangChain normalizes it
		// TODO: Remove this fallback once LangChain normalizes these providers
		const additionalKwargs = chunkObj.additional_kwargs as Record<string, unknown> | undefined;
		if (additionalKwargs?.reasoning_content && typeof additionalKwargs.reasoning_content === "string") {
			return additionalKwargs.reasoning_content as string;
		}

		// Also check direct reasoning_content on chunk (some providers)
		if (chunkObj.reasoning_content && typeof chunkObj.reasoning_content === "string") {
			return chunkObj.reasoning_content as string;
		}

		return undefined;
	}

	/**
	 * Extracts reasoning from a LangChain content block.
	 *
	 * Follows LangChain's native format as documented:
	 * https://docs.langchain.com/oss/javascript/langchain/models#reasoning
	 *
	 * Native format: { type: "reasoning", reasoning: "..." }
	 *
	 * Also handles provider-specific formats (e.g., Anthropic's "thinking") for backward compatibility.
	 */
	private extractReasoningFromContentBlock(block: unknown): string | undefined {
		if (!block || typeof block !== "object") {
			return undefined;
		}

		const b = block as Record<string, unknown>;
		const blockType = b.type;

		// LangChain native format: { type: "reasoning", reasoning: "..." }
		// This is the standard format per LangChain documentation
		if (blockType === "reasoning" && typeof b.reasoning === "string") {
			return b.reasoning;
		}

		// Provider-specific format: Anthropic uses { type: "thinking", thinking: "..." }
		// This is a temporary compatibility layer until all providers use the native format
		if (blockType === "thinking" && typeof b.thinking === "string") {
			return b.thinking;
		}

		return undefined;
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

	private extractResponse(messages: BaseMessage[]): unknown {
		if (messages.length === 0) {
			return undefined;
		}
		const last = messages[messages.length - 1];
		// Use BaseMessage.text getter to extract text content
		return last.text || last.content;
	}

	private async persistThreadMetadata(threadId: string, runId: string, messages: BaseMessage[]): Promise<void> {
		if (!this.threadStore) {
			return;
		}
		const existing = await this.threadStore.read(threadId);
		const metadata: Record<string, unknown> = { ...(existing?.metadata ?? {}) };
		metadata.lastRunId = runId;
		metadata.model = this.selectedModel?.name;
		const lastMessage = messages[messages.length - 1];
		// Use BaseMessage.text getter to extract text content
		const preview = lastMessage?.text;
		if (preview) {
			metadata.lastMessagePreview = preview.slice(0, 200);
		}
		// Map LangChain type to role for metadata
		if (lastMessage?.getType) {
			const lcType = lastMessage.getType();
			const role = lcType === "human" ? "user" : lcType === "ai" ? "assistant" : lcType;
			metadata.lastMessageRole = role;
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
	private async getLastAssistantMessageFromCheckpoint(threadId: string): Promise<BaseMessage | undefined> {
		const tuple = await this.safeGetCheckpointTuple(threadId);
		if (!tuple) {
			return undefined;
		}

		const messages = this.extractMessagesFromCheckpoint(tuple);
		if (messages.length === 0) {
			return undefined;
		}

		// Find the last AI message (assistant)
		for (let i = messages.length - 1; i >= 0; i--) {
			if (isAIMessage(messages[i])) {
				return messages[i];
			}
		}

		return undefined;
	}
}
