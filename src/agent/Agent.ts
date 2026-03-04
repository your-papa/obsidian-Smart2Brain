import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
	isAIMessage,
} from "@langchain/core/messages";
import type { MessageContentComplex } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StreamEvent } from "@langchain/core/tracers/log_stream";
import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { type ReactAgent, createAgent } from "langchain";
import { Notice, TFile } from "obsidian";

import { ProviderEndpointError, ProviderNotFoundError } from "../providers/errors";
import type { ChatModelConfig } from "../providers/index";
import type { ProviderRegistry } from "../providers/registry";
import { getData } from "../stores/dataStore.svelte";
import { getPlugin } from "../stores/state.svelte";
import type { ChatAttachment, ThreadError } from "../types/shared";
import { toBase64DataUri } from "../utils/attachments";
import { extractTextFromPdf } from "../utils/pdfExtractor";
import { Logger } from "../utils/logging";
import { type ThreadSnapshot, type ThreadStore, createSnapshot } from "./memory/ThreadStore";
import type { Telemetry } from "./telemetry/Telemetry";

const MAX_IMAGE_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 120_000;
const MAX_PDF_EXTRACT_CHARS = 180_000;

function truncateContent(content: string, maxChars: number): string {
	if (content.length <= maxChars) return content;
	return `${content.slice(0, maxChars)}\n\n[...truncated ${content.length - maxChars} characters to fit context limits...]`;
}

export interface ChooseModelParams {
	provider: string;
	chatModel: string;
	options?: Partial<ChatModelConfig>;
}

/** Options for a normal query (new message in thread) */
export interface AgentRunOptions {
	query: string;
	threadId?: string;
	metadata?: Record<string, unknown>;
	configurable?: Record<string, unknown>;
	signal?: AbortSignal;
	/** Optional attachments (images, PDFs) to include in the message */
	attachments?: ChatAttachment[];
}

/** Options for editing a message (forks from checkpoint with new user message) */
export interface AgentEditOptions {
	query: string;
	threadId: string;
	checkpointId: string;
	signal?: AbortSignal;
	attachments?: ChatAttachment[];
	metadata?: Record<string, unknown>;
	configurable?: Record<string, unknown>;
}

/** Options for regenerating a response from a checkpoint (no new user message) */
export interface AgentRegenerateOptions {
	threadId: string;
	checkpointId: string;
	signal?: AbortSignal;
	metadata?: Record<string, unknown>;
	configurable?: Record<string, unknown>;
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

export interface CheckpointHistoryItem {
	checkpointId: string;
	messages: BaseMessage[];
	step: number;
	/** Parent checkpoint ID for building branch trees */
	parentCheckpointId?: string;
	/** Optional checkpoint timestamp for deterministic ordering/tie-breaking */
	ts?: string;
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
		/** The id of the AI message that produced this tool call. */
		aiMessageId?: string;
		runId: string;
		threadId: string;
	}
	| {
		type: "tool_end";
		toolCallId: string;
		toolName: string;
		output: unknown;
		/** The id of the AI message that produced this tool call. */
		aiMessageId?: string;
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

	/**
	 * Returns whether the currently selected model supports vision/image input.
	 */
	get supportsVision(): boolean {
		return this.selectedModel?.options?.supportsVision ?? false;
	}

	/**
	 * Returns the current provider ID.
	 */
	get currentProvider(): string {
		return this.selectedModel?.provider ?? "";
	}

	/**
	 * Builds the message content for a HumanMessage, supporting multimodal attachments.
	 *
	 * - If no attachments: returns the plain query string
	 * - If attachments with vision support: returns an array of content blocks
	 *   (text + image_url for images, inline text for .md/.txt/.csv/.json)
	 * - PDFs via OpenRouter: sent as base64 data URL using `type: "file"` (native processing)
	 * - PDFs via other providers: text extracted locally via unpdf
	 * - Images without vision: throws an error
	 */
	private async buildMessageContent(
		query: string,
		attachments?: ChatAttachment[],
	): Promise<string | MessageContentComplex[]> {
		if (!attachments || attachments.length === 0) {
			return query;
		}

		const contentParts: MessageContentComplex[] = [{ type: "text", text: query }];
		const hasImages = attachments.some((a) => a.mimeType.startsWith("image/"));
		const skipImagesForNonVisionModel = hasImages && !this.supportsVision;
		let addedImageSkipNotice = false;

		// For non-vision models, skip image attachments but continue processing other supported files.

		const app = getPlugin().app;

		for (const attachment of attachments) {
			if (attachment.mimeType.startsWith("image/")) {
				if (skipImagesForNonVisionModel) {
					if (!addedImageSkipNotice) {
						contentParts.push({
							type: "text",
							text: "[Image attachments were skipped because the selected model does not support vision. Switch to a vision-capable model to analyze images.]",
						});
						addedImageSkipNotice = true;
					}
					continue;
				}

				// Read image from vault and encode as base64 data URI
				const file = app.vault.getAbstractFileByPath(attachment.vaultPath);
				if (!(file instanceof TFile)) {
					contentParts.push({
						type: "text",
						text: `[Image "${attachment.name}" not found at ${attachment.vaultPath}]`,
					});
					continue;
				}
				const buffer = await app.vault.readBinary(file);
				if (buffer.byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
					throw new Error(
						`Image attachment "${attachment.name}" exceeds the 15 MB size limit. Please attach a smaller image.`,
					);
				}
				const dataUri = toBase64DataUri(buffer, attachment.mimeType);
				contentParts.push({
					type: "image_url",
					image_url: { url: dataUri },
				});
			} else if (attachment.mimeType === "application/pdf") {
				const file = app.vault.getAbstractFileByPath(attachment.vaultPath);
				if (!(file instanceof TFile)) {
					contentParts.push({
						type: "text",
						text: `[PDF "${attachment.name}" not found at ${attachment.vaultPath}]`,
					});
					continue;
				}
				const buffer = await app.vault.readBinary(file);

				if (this.currentProvider === "openrouter") {
					// OpenRouter: send PDF as base64 data URL via native file content type.
					// OpenRouter processes it server-side (native model support or pdf-text fallback).
					const dataUri = toBase64DataUri(buffer, "application/pdf");
					contentParts.push({
						type: "file",
						file: {
							filename: attachment.name,
							file_data: dataUri,
						},
					} as unknown as MessageContentComplex);
				} else {
					// Other providers: extract text locally via unpdf
					const data = new Uint8Array(buffer);
					try {
						const { text, totalPages } = await extractTextFromPdf(data);
						if (text.trim()) {
							const truncated = truncateContent(text, MAX_PDF_EXTRACT_CHARS);
							contentParts.push({
								type: "text",
								text: `--- PDF: ${attachment.name} (${totalPages} pages) ---\n${truncated}\n--- End PDF ---`,
							});
						} else {
							contentParts.push({
								type: "text",
								text: `[PDF "${attachment.name}" contains ${totalPages} page(s) but no extractable text. It may contain only images/scans.]`,
							});
						}
					} catch (error) {
						contentParts.push({
							type: "text",
							text: `[Error extracting text from PDF "${attachment.name}": ${error instanceof Error ? error.message : String(error)}]`,
						});
					}
				}
			} else {
				// For text/json files, read as text
				const file = app.vault.getAbstractFileByPath(attachment.vaultPath);
				if (!(file instanceof TFile)) {
					contentParts.push({
						type: "text",
						text: `[File "${attachment.name}" not found at ${attachment.vaultPath}]`,
					});
					continue;
				}
				try {
					const content = await app.vault.read(file);
					const truncated = truncateContent(content, MAX_TEXT_ATTACHMENT_CHARS);
					contentParts.push({
						type: "text",
						text: `--- File: ${attachment.name} ---\n${truncated}\n--- End File ---`,
					});
				} catch (error) {
					contentParts.push({
						type: "text",
						text: `[Error reading "${attachment.name}": ${error instanceof Error ? error.message : String(error)}]`,
					});
				}
			}
		}

		return contentParts;
	}

	async chooseModel(params: ChooseModelParams): Promise<void> {
		const { provider, chatModel, options } = params;

		// Create a LangChain instance for this provider + model
		let instance: BaseChatModel;
		try {
			instance = this.registry.createChatInstance(provider, chatModel, options);
		} catch (error) {
			if (error instanceof ProviderNotFoundError) {
				const data = getData();
				const selectedAgent = data.getSelectedAgent();
				data.updateAgent(selectedAgent.id, { chatModel: null });
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

	/**
	 * Creates a HumanMessage with optional attachment metadata in additional_kwargs.
	 * Attachment metadata is stored so it can be reconstructed from checkpoints.
	 * Uses the object form so that multimodal content arrays (MessageContentComplex[])
	 * are correctly assigned to BaseMessage.content instead of being silently dropped.
	 */
	private createHumanMessage(
		content: string | MessageContentComplex[],
		attachments?: ChatAttachment[],
	): HumanMessage {
		const additional_kwargs = attachments?.length ? { attachments } : undefined;
		// Cast content — the HumanMessage constructor handles both string and
		// MessageContentComplex[] at runtime, but the TS types are overly strict.
		return new HumanMessage({ content: content as string, additional_kwargs });
	}

	async run(options: AgentRunOptions): Promise<AgentResult> {
		const { query } = options;
		const hasAttachments = Boolean(options.attachments?.length);
		if (!this.selectedModel) {
			throw new Error("No model selected. Call chooseModel() before run().");
		}

		if ((!query || query.trim().length === 0) && !hasAttachments) {
			throw new Error("Query must be a non-empty string when no attachments are provided.");
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

		const normalizedQuery = query.trim().length > 0 ? query : "Please analyze the attached files.";
		const messageContent = await this.buildMessageContent(normalizedQuery, options.attachments);
		const humanMessage = this.createHumanMessage(messageContent, options.attachments);

		const rawResult = await agent.invoke(
			{ messages: [humanMessage] },
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
		const hasAttachments = Boolean(options.attachments?.length);
		if (!this.selectedModel) {
			throw new Error("No model selected. Call chooseModel() before streamTokens().");
		}

		if ((!query || query.trim().length === 0) && !hasAttachments) {
			throw new Error("Query must be a non-empty string when no attachments are provided.");
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

		const normalizedQuery = query.trim().length > 0 ? query : "Please analyze the attached files.";
		const messageContent = await this.buildMessageContent(normalizedQuery, options.attachments);
		const humanMessage = this.createHumanMessage(messageContent, options.attachments);

		const stream = agent.streamEvents({ messages: [humanMessage] }, streamConfig);

		let rawResult: unknown;
		// Track tool calls in progress to correlate start/end events
		const pendingToolCalls = new Map<string, { name: string; input: unknown }>();
		// Track the current AI message id from chat model stream chunks
		let lastAiMessageId: string | undefined;

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
					const input = this.normalizeStreamToolInput(event.data?.input);

					pendingToolCalls.set(toolCallId, { name: toolName, input });
					Logger.debug("agent.streamTokens.tool_start", { runId, toolCallId, toolName });

					yield {
						type: "tool_start",
						toolCallId,
						toolName,
						input,
						aiMessageId: lastAiMessageId,
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
						aiMessageId: lastAiMessageId,
						runId,
						threadId,
					};
					continue;
				}

				// Handle token streaming — also capture AI message id from chunks
				const token = this.extractTokenFromEvent(event);
				if (token) {
					const chunkId = this.extractAiMessageIdFromEvent(event);
					if (chunkId) lastAiMessageId = chunkId;
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

	/**
	 * Edit a message by forking from a checkpoint with a new user message.
	 * This creates a new branch from the given checkpoint.
	 */
	async *editFromCheckpoint(options: AgentEditOptions): AsyncGenerator<AgentStreamChunk> {
		const { query, threadId, checkpointId } = options;
		if (!this.selectedModel) {
			throw new Error("No model selected. Call chooseModel() before editFromCheckpoint().");
		}

		if (!query || query.trim().length === 0) {
			throw new Error("Query must be a non-empty string.");
		}

		if (!checkpointId) {
			throw new Error("checkpointId is required for editing.");
		}

		const agent = await this.ensureAgent();
		const runId = this.generateId();
		const startedAt = new Date();
		Logger.debug("agent.editFromCheckpoint.start", {
			runId,
			threadId,
			checkpointId,
			provider: this.selectedModel.provider,
			model: this.selectedModel.name,
			queryPreview: query.slice(0, 200),
		});

		type StreamEventsConfig = Parameters<AgentRunnable["streamEvents"]>[1];
		const streamConfig = {
			...this.buildRunnableConfig(options, threadId, checkpointId),
			version: "v2" as const,
		} as StreamEventsConfig;

		const messageContent = await this.buildMessageContent(query, options.attachments);
		const humanMessage = this.createHumanMessage(messageContent, options.attachments);

		const input = {
			messages: [humanMessage],
		};

		const stream = agent.streamEvents(input, streamConfig);

		let rawResult: unknown;
		const pendingToolCalls = new Map<string, { name: string; input: unknown }>();
		let lastAiMessageId: string | undefined;

		try {
			for await (const event of stream) {
				if (options.signal?.aborted) {
					Logger.debug("agent.editFromCheckpoint.aborted", { runId, threadId });
					break;
				}

				if (event.event === "on_tool_start") {
					const toolCallId = event.run_id;
					const toolName = event.name ?? "unknown_tool";
					const toolInput = this.normalizeStreamToolInput(event.data?.input);

					pendingToolCalls.set(toolCallId, { name: toolName, input: toolInput });
					Logger.debug("agent.editFromCheckpoint.tool_start", { runId, toolCallId, toolName });

					yield {
						type: "tool_start",
						toolCallId,
						toolName,
						input: toolInput,
						aiMessageId: lastAiMessageId,
						runId,
						threadId,
					};
					continue;
				}

				if (event.event === "on_tool_end") {
					const toolCallId = event.run_id;
					const pending = pendingToolCalls.get(toolCallId);
					const toolName = pending?.name ?? event.name ?? "unknown_tool";
					const output = event.data?.output ?? {};

					pendingToolCalls.delete(toolCallId);
					Logger.debug("agent.editFromCheckpoint.tool_end", { runId, toolCallId, toolName });

					yield {
						type: "tool_end",
						toolCallId,
						toolName,
						output,
						aiMessageId: lastAiMessageId,
						runId,
						threadId,
					};
					continue;
				}

				const token = this.extractTokenFromEvent(event);
				if (token) {
					const chunkId = this.extractAiMessageIdFromEvent(event);
					if (chunkId) lastAiMessageId = chunkId;
					yield {
						type: "token",
						token,
						runId,
						threadId,
					};
				}

				const output = this.extractOutputFromEvent(event);
				if (output) {
					rawResult = output;
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				Logger.debug("agent.editFromCheckpoint.aborted", { runId, threadId });
				return;
			}

			if (error instanceof TypeError && error.message.includes("fetch")) {
				const provider = this.selectedModel?.provider ?? "unknown";
				Logger.debug("agent.editFromCheckpoint.error", { runId, message: `Connection failed to ${provider}` });
				throw new ProviderEndpointError(provider, "Connection refused - service may not be running");
			}

			Logger.debug("agent.editFromCheckpoint.error", {
				runId,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			Logger.debug("agent.editFromCheckpoint.cleanup", { runId, threadId });
		}

		if (options.signal?.aborted) {
			return;
		}

		if (!rawResult) {
			throw new Error("Agent edit completed without producing a final output.");
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
		Logger.debug("agent.editFromCheckpoint.complete", {
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

		const checkpointMessage = await this.getLastAssistantMessageFromCheckpoint(threadId);
		if (checkpointMessage) {
			Logger.debug("agent.editFromCheckpoint.checkpoint_message", {
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

	/**
	 * Regenerate an AI response from a checkpoint without adding a new user message.
	 * This forks from the given checkpoint and generates a new response.
	 */
	async *regenerateFromCheckpoint(options: AgentRegenerateOptions): AsyncGenerator<AgentStreamChunk> {
		const { threadId, checkpointId } = options;
		if (!this.selectedModel) {
			throw new Error("No model selected. Call chooseModel() before regenerateFromCheckpoint().");
		}

		if (!checkpointId) {
			throw new Error("checkpointId is required for regeneration.");
		}

		const agent = await this.ensureAgent();
		const runId = this.generateId();
		const startedAt = new Date();
		Logger.debug("agent.regenerateFromCheckpoint.start", {
			runId,
			threadId,
			checkpointId,
			provider: this.selectedModel.provider,
			model: this.selectedModel.name,
		});

		type StreamEventsConfig = Parameters<AgentRunnable["streamEvents"]>[1];
		const streamConfig = {
			...this.buildRunnableConfig(options, threadId, checkpointId),
			version: "v2" as const,
		} as StreamEventsConfig;

		// Pass null to continue from checkpoint without adding a new message
		const input = null;

		const stream = agent.streamEvents(input, streamConfig);

		let rawResult: unknown;
		const pendingToolCalls = new Map<string, { name: string; input: unknown }>();
		let lastAiMessageId: string | undefined;

		try {
			for await (const event of stream) {
				if (options.signal?.aborted) {
					Logger.debug("agent.regenerateFromCheckpoint.aborted", { runId, threadId });
					break;
				}

				if (event.event === "on_tool_start") {
					const toolCallId = event.run_id;
					const toolName = event.name ?? "unknown_tool";
					const toolInput = this.normalizeStreamToolInput(event.data?.input);

					pendingToolCalls.set(toolCallId, { name: toolName, input: toolInput });
					Logger.debug("agent.regenerateFromCheckpoint.tool_start", { runId, toolCallId, toolName });

					yield {
						type: "tool_start",
						toolCallId,
						toolName,
						input: toolInput,
						aiMessageId: lastAiMessageId,
						runId,
						threadId,
					};
					continue;
				}

				if (event.event === "on_tool_end") {
					const toolCallId = event.run_id;
					const pending = pendingToolCalls.get(toolCallId);
					const toolName = pending?.name ?? event.name ?? "unknown_tool";
					const output = event.data?.output ?? {};

					pendingToolCalls.delete(toolCallId);
					Logger.debug("agent.regenerateFromCheckpoint.tool_end", { runId, toolCallId, toolName });

					yield {
						type: "tool_end",
						toolCallId,
						toolName,
						output,
						aiMessageId: lastAiMessageId,
						runId,
						threadId,
					};
					continue;
				}

				const token = this.extractTokenFromEvent(event);
				if (token) {
					const chunkId = this.extractAiMessageIdFromEvent(event);
					if (chunkId) lastAiMessageId = chunkId;
					yield {
						type: "token",
						token,
						runId,
						threadId,
					};
				}

				const output = this.extractOutputFromEvent(event);
				if (output) {
					rawResult = output;
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				Logger.debug("agent.regenerateFromCheckpoint.aborted", { runId, threadId });
				return;
			}

			if (error instanceof TypeError && error.message.includes("fetch")) {
				const provider = this.selectedModel?.provider ?? "unknown";
				Logger.debug("agent.regenerateFromCheckpoint.error", {
					runId,
					message: `Connection failed to ${provider}`,
				});
				throw new ProviderEndpointError(provider, "Connection refused - service may not be running");
			}

			Logger.debug("agent.regenerateFromCheckpoint.error", {
				runId,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			Logger.debug("agent.regenerateFromCheckpoint.cleanup", { runId, threadId });
		}

		if (options.signal?.aborted) {
			return;
		}

		if (!rawResult) {
			throw new Error("Agent regeneration completed without producing a final output.");
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
		Logger.debug("agent.regenerateFromCheckpoint.complete", {
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

		const checkpointMessage = await this.getLastAssistantMessageFromCheckpoint(threadId);
		if (checkpointMessage) {
			Logger.debug("agent.regenerateFromCheckpoint.checkpoint_message", {
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
	 * Gets all checkpoints for a thread with their messages and step numbers.
	 * Used for building the checkpoint-to-message mapping for regenerate/edit operations.
	 */
	async getCheckpointHistory(threadId: string): Promise<CheckpointHistoryItem[]> {
		const results: CheckpointHistoryItem[] = [];

		const config = { configurable: { thread_id: threadId } };

		for await (const tuple of this.checkpointer.list(config)) {
			const checkpointId = tuple.config.configurable?.checkpoint_id as string | undefined;
			if (!checkpointId) continue;

			const messages = this.extractMessagesFromCheckpoint(tuple);
			const step = (tuple.metadata?.step as number) ?? 0;
			const parentCheckpointId = tuple.parentConfig?.configurable?.checkpoint_id as string | undefined;
			const ts = tuple.checkpoint?.ts as string | undefined;

			results.push({ checkpointId, messages, step, parentCheckpointId, ts });
		}

		return results;
	}

	/**
	 * Gets messages for a specific checkpoint.
	 * Used for switching to a different branch.
	 */
	async getCheckpointMessages(threadId: string, checkpointId: string): Promise<BaseMessage[]> {
		const config = { configurable: { thread_id: threadId, checkpoint_id: checkpointId } };
		const tuple = await this.checkpointer.getTuple(config);
		if (!tuple) return [];
		return this.extractMessagesFromCheckpoint(tuple);
	}

	/**
	 * Gets the latest checkpoint ID for a thread.
	 * Used by UI reloads to stay on the branch that just finished streaming.
	 */
	async getLatestCheckpointId(threadId: string): Promise<string | undefined> {
		try {
			const tuple = await this.checkpointer.getTuple({
				configurable: { thread_id: threadId },
			});
			return tuple?.config?.configurable?.checkpoint_id as string | undefined;
		} catch (error) {
			Logger.debug("agent.getLatestCheckpointId.error", {
				threadId,
				message: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
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

	private buildRunnableConfig(
		options: { signal?: AbortSignal; metadata?: Record<string, unknown>; configurable?: Record<string, unknown> },
		threadId: string,
		checkpointId?: string,
	): RunnableConfig {
		const callbacks = this.telemetry?.getCallbacks?.();
		return {
			configurable: {
				thread_id: threadId,
				// If checkpointId is provided, include it to fork from that checkpoint
				...(checkpointId ? { checkpoint_id: checkpointId } : {}),
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
		// ID can be a string or an array like ["langchain", "schema", "HumanMessage", "uuid"]
		let id: string | undefined;
		if (typeof kwargs.id === "string") {
			id = kwargs.id;
		} else if (Array.isArray(kwargs.id) && kwargs.id.length > 0) {
			// Take the last element which should be the UUID
			const lastElement = kwargs.id[kwargs.id.length - 1];
			if (typeof lastElement === "string") {
				id = lastElement;
			}
		}

		// Determine type from class name in id array
		const className = this.readLangChainClassName(msg.id);

		// Cast content — constructors handle both string and MessageContentComplex[] at runtime
		const c = content as string;

		switch (className) {
			case "HumanMessage":
			case "HumanMessageChunk": {
				const additional_kwargs = (kwargs.additional_kwargs as Record<string, unknown>) ?? undefined;
				return new HumanMessage({ content: c, id, additional_kwargs });
			}
			case "AIMessage":
			case "AIMessageChunk": {
				const toolCalls = this.extractToolCalls(kwargs);
				return new AIMessage({ content: c, id, tool_calls: toolCalls });
			}
			case "SystemMessage":
				return new SystemMessage({ content: c, id });
			case "ToolMessage": {
				const toolCallId = typeof kwargs.tool_call_id === "string" ? kwargs.tool_call_id : "";
				return new ToolMessage({ content: c, tool_call_id: toolCallId, id });
			}
			default:
				// Default to AIMessage for unknown types
				return new AIMessage({ content: c, id });
		}
	}

	private convertPlainMessage(type: string, msg: Record<string, unknown>): BaseMessage | undefined {
		const content = this.extractContent(msg);
		const id = typeof msg.id === "string" ? msg.id : undefined;

		// Cast content — constructors handle both string and MessageContentComplex[] at runtime
		const c = content as string;

		switch (type.toLowerCase()) {
			case "human":
			case "humanmessage": {
				const additional_kwargs = (msg.additional_kwargs as Record<string, unknown>) ?? undefined;
				return new HumanMessage({ content: c, id, additional_kwargs });
			}
			case "ai":
			case "aimessage": {
				const toolCalls = this.extractToolCalls(msg);
				return new AIMessage({ content: c, id, tool_calls: toolCalls });
			}
			case "system":
			case "systemmessage":
				return new SystemMessage({ content: c, id });
			case "tool":
			case "toolmessage": {
				const toolCallId = typeof msg.tool_call_id === "string" ? msg.tool_call_id : "";
				return new ToolMessage({ content: c, tool_call_id: toolCallId, id });
			}
			default:
				return undefined;
		}
	}

	private extractContent(obj: Record<string, unknown>): string | MessageContentComplex[] {
		const content = obj.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			// If content has non-text items (e.g. image_url), preserve the full array
			const hasNonTextItems = content.some(
				(c) => c && typeof c === "object" && (c as { type?: unknown }).type !== "text",
			);
			if (hasNonTextItems) {
				return content as MessageContentComplex[];
			}
			// Text-only arrays can be joined into a single string
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

	private normalizeStreamToolInput(rawInput: unknown): unknown {
		let input = rawInput;

		if (input && typeof input === "object" && !Array.isArray(input)) {
			const wrapper = input as Record<string, unknown>;
			const hasRunnableMetadata =
				"config" in wrapper ||
				"kwargs" in wrapper ||
				"metadata" in wrapper ||
				"callbacks" in wrapper ||
				"tags" in wrapper;

			if ("input" in wrapper && (hasRunnableMetadata || Object.keys(wrapper).length === 1)) {
				input = wrapper.input;
			} else if ("args" in wrapper && Object.keys(wrapper).length === 1) {
				input = wrapper.args;
			} else if ("arguments" in wrapper && Object.keys(wrapper).length === 1) {
				input = wrapper.arguments;
			}
		}

		if (typeof input === "string") {
			try {
				return JSON.parse(input);
			} catch {
				return input;
			}
		}

		return input ?? {};
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

	/**
	 * Extracts the AI message id from a chat model stream event.
	 * AIMessageChunk objects carry an `id` field set by the provider.
	 */
	private extractAiMessageIdFromEvent(event: StreamEvent): string | undefined {
		if (!event.event.endsWith("_stream")) return undefined;
		const chunk = event.data?.chunk;
		if (chunk && typeof chunk === "object" && typeof (chunk as { id?: unknown }).id === "string") {
			return (chunk as { id: string }).id;
		}
		return undefined;
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
