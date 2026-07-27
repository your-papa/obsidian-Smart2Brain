import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { type BaseMessage, HumanMessage, isAIMessage } from "@langchain/core/messages";
import type { MessageContentComplex } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { type ReactAgent, createAgent, summarizationMiddleware } from "langchain";
import { createSubAgentMiddleware } from "deepagents/browser";
import { TFile } from "obsidian";

import { ProviderEndpointError } from "../providers/errors";
import type { ChatModelConfig } from "../providers/index";
import type { ProviderRegistry } from "../providers/registry";
import { getPlugin } from "../stores/state.svelte";
import type { VisibleNoteRef } from "../hooks/useVisibleNotes.svelte";
import type { SelectionRef } from "../hooks/useSelection.svelte";
import type { GraphNoteRef } from "../stores/chatStore.svelte";
import type { ChatAttachment, ThreadError } from "../types/shared";
import {
	AiTransportDowngradeRequiredError,
	bindAsyncIterableToTransportContext,
	createAiTransportContext,
	findAiTransportDowngradeRequiredError,
	runWithAiTransportContext,
} from "../lib/aiTransport";
import { toBase64, toBase64DataUri } from "../utils/attachments";
import { extractTextFromPdf } from "../utils/pdfExtractor";
import { Logger } from "../utils/logging";
import { normalizeMessages } from "./messageNormalization";
import { type ThreadSnapshot, type ThreadStore, createSnapshot } from "./memory/ThreadStore";
import {
	getSummarizationTriggerTokens,
	getTrimTokensToSummarize,
	SUMMARY_KEEP_MESSAGE_COUNT,
	SUMMARY_PREFIX,
	SUMMARY_PROMPT,
} from "./summarization";
import type { Telemetry } from "./telemetry/Telemetry";

const MAX_IMAGE_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 120_000;
const MAX_PDF_EXTRACT_CHARS = 180_000;

/** Providers whose APIs accept native PDF file content blocks. */
export const NATIVE_PDF_PROVIDERS = new Set(["anthropic", "openai", "openrouter"]);

function truncateContent(content: string, maxChars: number): string {
	if (content.length <= maxChars) return content;
	return `${content.slice(0, maxChars)}\n\n[...truncated ${content.length - maxChars} characters to fit context limits...]`;
}

export interface ChooseModelParams {
	provider: string;
	chatModel: string;
	options?: Partial<ChatModelConfig>;
	summarizationModel?: {
		provider: string;
		chatModel: string;
		options?: Partial<ChatModelConfig>;
	} | null;
	titleModel?: {
		provider: string;
		chatModel: string;
		options?: Partial<ChatModelConfig>;
	} | null;
}

/** Options for a normal query (new message in thread) */
export interface AgentRunOptions {
	query: string;
	/** Fully-resolved model + runnable for this run (per-run, never instance state). */
	resolved: ResolvedRun;
	threadId?: string;
	metadata?: Record<string, unknown>;
	configurable?: Record<string, unknown>;
	lcSource?: string;
	signal?: AbortSignal;
	/** Optional attachments (images, PDFs) to include in the message */
	attachments?: ChatAttachment[];
	/** Visible notes refs to persist alongside the message */
	visibleNotes?: VisibleNoteRef[];
	/** Snapshot of user-selected text to persist alongside the message */
	selection?: SelectionRef;
	/** Notes selected from the Smart Graph */
	graphNotes?: GraphNoteRef[];
}

/** Options for editing a message (forks from checkpoint with new user message) */
export interface AgentEditOptions {
	query: string;
	resolved: ResolvedRun;
	threadId: string;
	checkpointId: string;
	lcSource?: string;
	signal?: AbortSignal;
	attachments?: ChatAttachment[];
	visibleNotes?: VisibleNoteRef[];
	metadata?: Record<string, unknown>;
	configurable?: Record<string, unknown>;
}

/** Options for regenerating a response from a checkpoint (no new user message) */
export interface AgentRegenerateOptions {
	resolved: ResolvedRun;
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

/**
 * A fully-resolved subagent, ready to hand to deepagents' subagent middleware.
 * Carries instances (not IDs): each subagent runs with its own model, tools,
 * and prompt — resolved by AgentManager from a referenced agent's config.
 */
export interface SubAgentSpec {
	/** Selector name shown to the parent model in the `task` tool. */
	name: string;
	/** Short blurb the parent model uses to decide whether to delegate. */
	description: string;
	/** The referenced agent's assembled system prompt. */
	systemPrompt: string;
	/** The referenced agent's own model instance (may differ from the parent). */
	model: BaseChatModel;
	/** The referenced agent's own resolved tool instances. */
	tools: readonly unknown[];
}

type AgentRunnable = ReactAgent; // invoke(), stream(), etc.

export type AgentStreamOptions = AgentRunOptions;

export type AgentStreamChunk =
	| {
			type: "token";
			token: string;
			/** The id of the AI message producing this token (step boundary discriminator). */
			aiMessageId?: string;
			runId: string;
			threadId: string;
	  }
	| {
			type: "tool_start";
			toolCallId: string;
			toolName: string;
			input: unknown;
			/** Preamble text the model emitted before this tool call in the same AI message. */
			preamble?: string;
			/** The id of the AI message that produced this tool call. */
			aiMessageId?: string;
			/** Name of the subagent this tool ran inside (via the `task` tool), if any. */
			subAgentName?: string;
			/** The id of the parent `task` tool call this is nested under, if any. */
			parentToolCallId?: string;
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
			/** Name of the subagent this tool ran inside (via the `task` tool), if any. */
			subAgentName?: string;
			/** The id of the parent `task` tool call this is nested under, if any. */
			parentToolCallId?: string;
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

export interface SelectedModel {
	provider: string;
	name: string;
	instance: BaseChatModel;
	options?: Partial<ChatModelConfig>;
}

/**
 * Parameters for resolving a run. Unlike the old `chooseModel`, this carries the
 * agent's prompt/tools/subagents explicitly (per-run, not instance state) plus a
 * `cacheKey` (built by AgentManager over the full agent config) so the runnable
 * can be memoized per agent-config without any shared mutable state.
 */
export interface ResolveRunParams extends ChooseModelParams {
	/** Signature over the full agent config (model + prompt + tools + subagents). */
	cacheKey: string;
	systemPrompt: string;
	tools: readonly unknown[];
	subAgents: readonly SubAgentSpec[];
}

/**
 * A fully-resolved run: an immutable bundle handed into each run method. Nothing
 * model-related lives on the Agent instance between runs, so concurrent runs with
 * different models can never clobber each other. Same-config runs share one
 * (thread-stateless) cached runnable.
 */
export interface ResolvedRun {
	runnable: AgentRunnable;
	selectedModel: SelectedModel;
	/** Undefined → summarization falls back to `selectedModel`. */
	summarizationModel?: SelectedModel;
	/** Undefined → title generation falls back to `selectedModel`. */
	titleModel?: SelectedModel;
	supportsVision: boolean;
	currentProvider: string;
}

export class Agent {
	private readonly checkpointer: BaseCheckpointSaver;
	private readonly telemetry?: Telemetry;
	private readonly threadStore?: ThreadStore;
	private readonly registry: ProviderRegistry;
	private readonly defaultPrompt: string;
	/** Runnables memoized by agent-config cacheKey (built by AgentManager). */
	private readonly runnableCache = new Map<string, AgentRunnable>();

	constructor(options: AgentOptions) {
		this.registry = options.registry;
		this.telemetry = options.telemetry;
		this.threadStore = options.threadStore;
		this.checkpointer = this.wrapCheckpointer(options.checkpointer ?? new MemorySaver());
		this.defaultPrompt = options.defaultPrompt ?? "You are a privacy-focused assistant.";
		Logger.debug("agent.init", {
			hasTelemetry: Boolean(this.telemetry),
			hasThreadStore: Boolean(this.threadStore),
			checkpointer: this.checkpointer.constructor?.name ?? "unknown",
		});
	}

	/**
	 * Drops any cached runnables built for the given agent config. Needed only for
	 * changes that the cacheKey can't see (async-loaded MCP tools); model/prompt/tool
	 * config changes are already covered by the key. Matches on the `agentId` field
	 * embedded in the JSON cacheKey.
	 */
	invalidateRunnable(agentId: string): void {
		const needle = `"agentId":${JSON.stringify(agentId)}`;
		for (const key of this.runnableCache.keys()) {
			if (key.includes(needle)) this.runnableCache.delete(key);
		}
	}

	/** Drops every cached runnable. Use when a global input to prompt assembly
	 *  (e.g. the set of loaded skills) changes and can affect any agent's prompt. */
	invalidateAllRunnables(): void {
		this.runnableCache.clear();
	}
	/**
	 * Builds the message content for a HumanMessage, supporting multimodal attachments.
	 *
	 * - If no attachments: returns the plain query string
	 * - If attachments with vision support: returns an array of content blocks
	 *   (text + image_url for images, inline text for .md/.txt/.csv/.json)
	 * - PDFs via native providers (Anthropic, OpenAI, OpenRouter): sent as standardized
	 *   Data.Base64ContentBlock which LangChain auto-converts to each provider's native format
	 * - PDFs via other providers (Ollama, custom): text extracted locally via Obsidian's pdfjs
	 * - Images without vision: skipped with notice
	 */
	private async buildMessageContent(
		query: string,
		supportsVision: boolean,
		currentProvider: string,
		attachments?: ChatAttachment[],
	): Promise<string | MessageContentComplex[]> {
		if (!attachments || attachments.length === 0) {
			return query;
		}

		const contentParts: MessageContentComplex[] = [{ type: "text", text: query }];
		const hasImages = attachments.some((a) => a.mimeType.startsWith("image/"));
		const skipImagesForNonVisionModel = hasImages && !supportsVision;
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
							s2b_attachment: true,
						} as unknown as MessageContentComplex);
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
						s2b_attachment: true,
					} as unknown as MessageContentComplex);
					continue;
				}
				const buffer = await app.vault.readBinary(file);

				if (NATIVE_PDF_PROVIDERS.has(currentProvider)) {
					// Native PDF: use LangChain's standardized file content block.
					// LangChain auto-converts to each provider's native format:
					//   Anthropic → type: "document" with source.type: "base64"
					//   OpenAI    → type: "file" with file.file_data data URI
					//   OpenRouter → type: "file" (same as OpenAI, uses ChatOpenAI)
					contentParts.push({
						type: "file",
						source_type: "base64",
						data: toBase64(buffer),
						mime_type: "application/pdf",
						metadata: { filename: attachment.name },
					} as unknown as MessageContentComplex);
				} else {
					// Providers without native PDF support: extract text locally
					const data = new Uint8Array(buffer);
					try {
						const { text, totalPages } = await extractTextFromPdf(data);
						if (text.trim()) {
							const truncated = truncateContent(text, MAX_PDF_EXTRACT_CHARS);
							contentParts.push({
								type: "text",
								text: `--- PDF: ${attachment.name} (${totalPages} pages) ---\n${truncated}\n--- End PDF ---`,
								s2b_attachment: true,
							} as unknown as MessageContentComplex);
						} else {
							contentParts.push({
								type: "text",
								text: `[PDF "${attachment.name}" contains ${totalPages} page(s) but no extractable text. It may contain only images/scans.]`,
								s2b_attachment: true,
							} as unknown as MessageContentComplex);
						}
					} catch (error) {
						contentParts.push({
							type: "text",
							text: `[Error extracting text from PDF "${attachment.name}": ${error instanceof Error ? error.message : String(error)}]`,
							s2b_attachment: true,
						} as unknown as MessageContentComplex);
					}
				}
			} else {
				// For text/json files, read as text
				const file = app.vault.getAbstractFileByPath(attachment.vaultPath);
				if (!(file instanceof TFile)) {
					contentParts.push({
						type: "text",
						text: `[File "${attachment.name}" not found at ${attachment.vaultPath}]`,
						s2b_attachment: true,
					} as unknown as MessageContentComplex);
					continue;
				}
				try {
					const content = await app.vault.read(file);
					const truncated = truncateContent(content, MAX_TEXT_ATTACHMENT_CHARS);
					contentParts.push({
						type: "text",
						text: `--- File: ${attachment.name} ---\n${truncated}\n--- End File ---`,
						s2b_attachment: true,
					} as unknown as MessageContentComplex);
				} catch (error) {
					contentParts.push({
						type: "text",
						text: `[Error reading "${attachment.name}": ${error instanceof Error ? error.message : String(error)}]`,
						s2b_attachment: true,
					} as unknown as MessageContentComplex);
				}
			}
		}

		return contentParts;
	}

	/**
	 * Pure resolver: builds the model instances and the (memoized) runnable for a
	 * run WITHOUT mutating any instance state. Returns an immutable {@link ResolvedRun}
	 * bundle the caller threads into the run method. Concurrent runs with different
	 * models each get their own bundle, so they can never clobber each other.
	 *
	 * On `ProviderNotFoundError` it simply rethrows — the caller (AgentManager) owns
	 * the config side effect of clearing the offending agent's model, since only it
	 * knows WHICH agent config this run used.
	 */
	async resolveRun(params: ResolveRunParams): Promise<ResolvedRun> {
		const {
			provider,
			chatModel,
			options,
			summarizationModel,
			titleModel,
			cacheKey,
			systemPrompt,
			tools,
			subAgents,
		} = params;

		const instance = this.registry.createChatInstance(provider, chatModel, options);
		const selectedModel: SelectedModel = { provider, name: chatModel, instance, options };

		const resolvedSummarization: SelectedModel | undefined = summarizationModel
			? {
					provider: summarizationModel.provider,
					name: summarizationModel.chatModel,
					instance: this.registry.createChatInstance(
						summarizationModel.provider,
						summarizationModel.chatModel,
						summarizationModel.options,
					),
					options: summarizationModel.options,
				}
			: undefined;

		const resolvedTitle: SelectedModel | undefined = titleModel
			? {
					provider: titleModel.provider,
					name: titleModel.chatModel,
					instance: this.registry.createChatInstance(
						titleModel.provider,
						titleModel.chatModel,
						titleModel.options,
					),
					options: titleModel.options,
				}
			: undefined;

		let runnable = this.runnableCache.get(cacheKey);
		if (!runnable) {
			runnable = createAgent({
				model: selectedModel.instance,
				tools: Array.isArray(tools) ? [...tools] : [],
				systemPrompt,
				checkpointer: this.checkpointer,
				middleware: [
					...this.buildSummarizationMiddleware(selectedModel, resolvedSummarization),
					...this.buildSubAgentMiddleware(selectedModel, subAgents, tools),
				] as never,
			});
			this.runnableCache.set(cacheKey, runnable);
			Logger.debug("agent.resolveRun.build", { provider, chatModel, cacheKey });
		}

		return {
			runnable,
			selectedModel,
			summarizationModel: resolvedSummarization,
			titleModel: resolvedTitle,
			supportsVision: options?.supportsVision ?? false,
			currentProvider: provider,
		};
	}

	private buildSummarizationMiddleware(selectedModel: SelectedModel, summarizationModel?: SelectedModel) {
		const model = summarizationModel?.instance ?? selectedModel.instance;
		const contextWindow = selectedModel.options?.contextWindow;
		const triggerTokens = getSummarizationTriggerTokens(contextWindow);
		if (!triggerTokens) {
			Logger.warn(
				`[Agent] Summarization disabled: model "${selectedModel.name}" has no contextWindow configured. Long threads will not be summarized and may hit provider context limits.`,
			);
			return [];
		}

		const trimTokensToSummarize = getTrimTokensToSummarize(triggerTokens);

		return [
			summarizationMiddleware({
				model,
				trigger: { tokens: triggerTokens, messages: SUMMARY_KEEP_MESSAGE_COUNT + 2 },
				keep: { messages: SUMMARY_KEEP_MESSAGE_COUNT },
				summaryPrefix: SUMMARY_PREFIX,
				summaryPrompt: SUMMARY_PROMPT,
				trimTokensToSummarize,
			}),
		] as const;
	}

	/**
	 * Builds deepagents' subagent middleware, which adds a `task` tool the model
	 * can call to delegate work to isolated-context subagents. Each subagent runs
	 * with its own model, tools, and prompt (resolved by AgentManager). Returns an
	 * empty array when no subagents are configured, so the `task` tool is only
	 * exposed when delegation is actually set up.
	 */
	private buildSubAgentMiddleware(
		selectedModel: SelectedModel,
		subAgents: readonly SubAgentSpec[],
		tools: readonly unknown[],
	) {
		if (subAgents.length === 0) {
			return [];
		}

		return [
			createSubAgentMiddleware({
				// Fallback only — every configured subagent overrides these.
				defaultModel: selectedModel.instance,
				defaultTools: [...tools] as never,
				// Expose only the explicitly-referenced subagents, not a generic one.
				generalPurposeAgent: false,
				subagents: subAgents.map((s) => {
					// Wrap the subagent's `invoke` so that every LangGraph-internal channel
					// that could reconnect it to the parent's checkpoint/history is stripped
					// before invocation. Without this the subagent inherits the parent's
					// checkpoint reader and reloads the parent's full message history (→
					// provider 400s from the dangling `task` tool-call assistant message).
					const subgraph = createAgent({
						model: s.model as never,
						systemPrompt: s.systemPrompt,
						tools: [...s.tools] as never,
						middleware: [] as never,
						name: s.name,
					});
					subgraph.invoke = (state: never, config?: never) => {
						const c = config as Record<string, unknown> | undefined;
						// Strip EVERY LangGraph-internal channel that could reconnect the
						// subgraph to the parent's checkpoint/history. Removing only
						// __pregel_read/__pregel_send/__pregel_scratchpad is not enough: the
						// parent also passes __pregel_checkpointer, __pregel_previous,
						// checkpoint_id, checkpoint_ns, checkpoint_map, __pregel_call,
						// __pregel_replay_state, __pregel_task_id and __pregel_abort_signals.
						// If any survive, the subgraph's model node reloads the parent's
						// messages (prepending the parent's user turn + the dangling `task`
						// tool-call assistant message), which Anthropic/LiteLLM reject with a
						// 400 "tool_use ids were found without tool_result blocks". Keep only
						// benign, non-pregel configurable keys.
						const cleanConfigurable = c?.configurable
							? Object.fromEntries(
									Object.entries(c.configurable as Record<string, unknown>).filter(
										([k]) => !k.startsWith("__pregel") && !k.startsWith("checkpoint"),
									),
								)
							: {};
						// Keep everything else on the config — crucially `callbacks`, which
						// carry the parent's streaming/tracing context. Nulling them would
						// stop the subagent's own tool events (search_notes, list_directory,
						// …) from bubbling into the parent stream, so the `task` card would
						// show no nested child branch. Only the checkpoint-read channels
						// above cause the message leak; callbacks are safe to keep.
						const cleanConfig = c
							? {
									...c,
									configurable: cleanConfigurable,
								}
							: {};
						// Call the compiled graph directly to bypass ReactAgent.invoke's
						// #initializeMiddlewareStates, which calls this.#graph.getState(config)
						// and would re-read the parent's checkpoint via __pregel_read.
						const compiledGraph = subgraph.graph as {
							invoke: (s: unknown, c: unknown) => Promise<unknown>;
						};
						// The parent graph node also sets an ambient AsyncLocalStorage config
						// that LangGraph's ensureLangGraphConfig merges back in via
						// getRunnableConfig() (re-injecting __pregel_read). runWithConfig
						// re-runs the subgraph in a fresh ALS context whose ambient config is
						// our clean config, so the parent's channels are no longer visible.
						return AsyncLocalStorageProviderSingleton.runWithConfig(cleanConfig as never, () =>
							compiledGraph.invoke(state, cleanConfig),
						) as Promise<never>;
					};
					return {
						name: s.name,
						description: s.description,
						runnable: subgraph,
					};
				}),
			}),
		];
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
		visibleNotes?: VisibleNoteRef[],
		selection?: SelectionRef,
		graphNotes?: GraphNoteRef[],
		lcSource?: string,
	): HumanMessage {
		const additional_kwargs: Record<string, unknown> = {};
		if (attachments?.length) additional_kwargs.attachments = attachments;
		if (visibleNotes?.length) additional_kwargs.visibleNotes = visibleNotes;
		if (selection) additional_kwargs.selection = selection;
		if (graphNotes?.length) additional_kwargs.graphNotes = graphNotes;
		if (lcSource) additional_kwargs.lc_source = lcSource;
		const hasKwargs = Object.keys(additional_kwargs).length > 0;
		// Cast content — the HumanMessage constructor handles both string and
		// MessageContentComplex[] at runtime, but the TS types are overly strict.
		return new HumanMessage({
			content: content as string,
			additional_kwargs: hasKwargs ? additional_kwargs : undefined,
		});
	}

	private async invokeBufferedFallback(
		agent: AgentRunnable,
		input: unknown,
		invokeConfig: RunnableConfig,
		runId: string,
		threadId: string,
		context: string,
		error: AiTransportDowngradeRequiredError,
	): Promise<unknown> {
		Logger.debug(`${context}.downgrade`, {
			runId,
			threadId,
			provider: error.providerId,
			url: error.url,
			message: error.cause instanceof Error ? error.cause.message : String(error.cause),
		});

		// Fresh buffered context scoped via run() — isolated from any other
		// concurrent stream's transport context.
		const bufferedContext = createAiTransportContext("buffered", `${context}:buffered:${runId}`);
		return runWithAiTransportContext(bufferedContext, async () => agent.invoke(input as never, invokeConfig));
	}

	async run(options: AgentRunOptions): Promise<AgentResult> {
		const { query, resolved } = options;
		const { runnable: agent, selectedModel } = resolved;
		const hasAttachments = Boolean(options.attachments?.length);

		if ((!query || query.trim().length === 0) && !hasAttachments) {
			throw new Error("Query must be a non-empty string when no attachments are provided.");
		}

		const runId = this.generateId();
		const threadId = options.threadId;
		if (!threadId) throw new Error("threadId is required");
		const startedAt = new Date();
		Logger.debug("agent.run.start", {
			runId,
			threadId,
			provider: selectedModel.provider,
			model: selectedModel.name,
			queryPreview: query.slice(0, 200),
		});

		const invokeConfig = this.buildRunnableConfig(options, threadId);

		const normalizedQuery = query.trim().length > 0 ? query : "Please analyze the attached files.";
		const messageContent = await this.buildMessageContent(
			normalizedQuery,
			resolved.supportsVision,
			resolved.currentProvider,
			options.attachments,
		);
		const humanMessage = this.createHumanMessage(
			messageContent,
			options.attachments,
			options.visibleNotes,
			options.selection,
			options.graphNotes,
			options.lcSource,
		);

		const transportContext = createAiTransportContext("default", `agent.run:${runId}`);
		const rawResult = await runWithAiTransportContext(transportContext, async () =>
			agent.invoke({ messages: [humanMessage] }, invokeConfig),
		);

		const finishedAt = new Date();
		const messages = this.extractMessagesFromResult(rawResult);
		await this.persistThreadMetadata(threadId, runId, messages, selectedModel.name);
		await this.flushThreadPersistence(threadId);

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
		const { query, resolved } = options;
		const { runnable: agent, selectedModel } = resolved;
		const hasAttachments = Boolean(options.attachments?.length);

		if ((!query || query.trim().length === 0) && !hasAttachments) {
			throw new Error("Query must be a non-empty string when no attachments are provided.");
		}

		const runId = this.generateId();
		const threadId = options.threadId;
		if (!threadId) throw new Error("threadId is required");
		const startedAt = new Date();
		Logger.debug("agent.streamTokens.start", {
			runId,
			threadId,
			provider: selectedModel.provider,
			model: selectedModel.name,
			queryPreview: query.slice(0, 200),
		});

		const invokeConfig = this.buildRunnableConfig(options, threadId);

		const normalizedQuery = query.trim().length > 0 ? query : "Please analyze the attached files.";
		const messageContent = await this.buildMessageContent(
			normalizedQuery,
			resolved.supportsVision,
			resolved.currentProvider,
			options.attachments,
		);
		const humanMessage = this.createHumanMessage(
			messageContent,
			options.attachments,
			options.visibleNotes,
			options.selection,
			options.graphNotes,
			options.lcSource,
		);

		const transportLabel = `agent.streamTokens:${runId}`;
		const transportContext = createAiTransportContext("default", transportLabel);

		const streamInput = { messages: [humanMessage] };
		// Bind the LangChain stream so each pull runs inside this run's transport
		// context (run()-scoped, concurrency-safe). Without this the fetch issued
		// deep inside the stream would read whichever context another concurrent
		// run last set.
		const stream = bindAsyncIterableToTransportContext(
			await agent.stream(streamInput, {
				...invokeConfig,
				streamMode: ["messages", "tools", "values"] as const,
			}),
			transportContext,
		);

		let rawResult: unknown;
		// Track tool calls in progress to correlate start/end events
		const pendingToolCalls = new Map<string, { name: string; input: unknown }>();
		// Stack of open `task` tool call ids, for nesting subagent tool calls
		const taskCallStack: string[] = [];
		// The aiMessageId each open `task` call was stamped with, so its subagent
		// children can inherit the same timeline group (see resolveToolAttribution).
		const taskAiMessageIds = new Map<string, string | undefined>();
		// The subagent name (from task input.subagent_type) for each open task call.
		const taskSubAgentNames = new Map<string, string | undefined>();
		// Children-claimed count per open task, for FIFO round-robin attribution fallback.
		const taskChildCounts = new Map<string, number>();
		// Track the current AI message id from chat model stream chunks
		let lastAiMessageId: string | undefined;
		// Map toolCallId → preamble text: populated when a messages-mode AIMessage chunk
		// arrives with tool_calls. The messages stream delivers individual streaming deltas —
		// early deltas carry text content, the final delta carries tool_calls with no text.
		// We accumulate text per-message-id and index it when the tool_calls delta arrives.
		const toolCallPreambles = new Map<string, string>();
		// Running text accumulator for the current AI message (reset on new aiMessageId).
		let preambleAccumulator = "";
		try {
			for await (const chunk of stream) {
				// Check if aborted before processing
				if (options.signal?.aborted) {
					Logger.debug("agent.streamTokens.aborted", { runId, threadId });
					break;
				}

				const [mode, payload] = chunk as ["messages" | "tools" | "values", unknown];

				if (mode === "tools") {
					const tp = payload as
						| { event: "on_tool_start"; toolCallId?: string; name: string; input: unknown }
						| { event: "on_tool_end"; toolCallId?: string; name: string; output: unknown }
						| { event: string; toolCallId?: string; name: string };

					if (tp.event === "on_tool_start") {
						const toolCallId = tp.toolCallId ?? "";
						const toolName = tp.name;
						const toolInput = (tp as { event: "on_tool_start"; input: unknown }).input;
						const input = this.normalizeStreamToolInput(toolInput);
						const attribution = this.resolveToolAttribution(
							"on_tool_start",
							input,
							toolName,
							toolCallId,
							taskCallStack,
							taskAiMessageIds,
							taskSubAgentNames,
							taskChildCounts,
							lastAiMessageId,
						);
						const preamble = toolCallPreambles.get(toolCallId);
						toolCallPreambles.delete(toolCallId);
						pendingToolCalls.set(toolCallId, { name: toolName, input });
						Logger.debug("agent.streamTokens.tool_start", { runId, toolCallId, toolName });
						yield {
							type: "tool_start",
							toolCallId,
							toolName,
							input,
							preamble,
							...attribution,
							runId,
							threadId,
						};
						continue;
					}

					if (tp.event === "on_tool_end") {
						const toolCallId = tp.toolCallId ?? "";
						const pending = pendingToolCalls.get(toolCallId);
						const toolName = pending?.name ?? tp.name;
						const output = this.normalizeStreamToolOutput(
							(tp as { event: "on_tool_end"; output: unknown }).output,
						);
						const attribution = this.resolveToolAttribution(
							"on_tool_end",
							undefined,
							toolName,
							toolCallId,
							taskCallStack,
							taskAiMessageIds,
							taskSubAgentNames,
							taskChildCounts,
							lastAiMessageId,
						);
						pendingToolCalls.delete(toolCallId);
						Logger.debug("agent.streamTokens.tool_end", { runId, toolCallId, toolName });
						yield {
							type: "tool_end",
							toolCallId,
							toolName,
							output,
							...attribution,
							runId,
							threadId,
						};
						continue;
					}

					continue; // on_tool_event, on_tool_error: ignore
				}

				if (mode === "messages") {
					const [message] = payload as [BaseMessage, Record<string, unknown>];
					if (message.getType() === "ai") {
						// Reset accumulator when a new AI message starts.
						if (message.id && message.id !== lastAiMessageId) {
							lastAiMessageId = message.id;
							preambleAccumulator = "";
						}
						const token = this.normalizeContentToString(message.content);
						if (token && token.length > 0) {
							preambleAccumulator += token;
							yield {
								type: "token",
								token,
								aiMessageId: lastAiMessageId,
								runId,
								threadId,
							};
						}
						// Index accumulated text as preamble when this delta carries tool_calls.
						// The messages stream delivers individual deltas: text arrives in earlier
						// chunks, tool_calls arrive in a final chunk with no text. We track the
						// running text and stamp it onto each tool call id when the call ids appear.
						const msgToolCalls = (message as { tool_calls?: { id?: string }[] }).tool_calls;
						if (Array.isArray(msgToolCalls) && msgToolCalls.length > 0 && preambleAccumulator) {
							for (const tc of msgToolCalls) {
								if (tc.id && !toolCallPreambles.has(tc.id)) {
									toolCallPreambles.set(tc.id, preambleAccumulator);
								}
							}
						}
					}
					continue;
				}

				if (mode === "values") {
					if (this.isAgentOutputCandidate(payload)) {
						rawResult = payload;
					}
				}
			}
		} catch (error) {
			// Don't log or rethrow abort errors - they're expected during cancellation
			if (error instanceof Error && error.name === "AbortError") {
				Logger.debug("agent.streamTokens.aborted", { runId, threadId });
				return;
			}

			const downgradeError = findAiTransportDowngradeRequiredError(error);
			if (downgradeError) {
				rawResult = await this.invokeBufferedFallback(
					agent,
					streamInput,
					invokeConfig,
					runId,
					threadId,
					"agent.streamTokens",
					downgradeError,
				);
			} else {
				// Wrap connection errors in ProviderEndpointError for consistent handling
				if (error instanceof TypeError && error.message.includes("fetch")) {
					const provider = selectedModel.provider;
					Logger.debug("agent.streamTokens.error", { runId, message: `Connection failed to ${provider}` });
					throw new ProviderEndpointError(provider, "Connection refused - service may not be running");
				}

				Logger.debug("agent.streamTokens.error", {
					runId,
					message: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
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
		await this.persistThreadMetadata(threadId, runId, messages, selectedModel.name);
		await this.flushThreadPersistence(threadId);

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
		const { query, threadId, checkpointId, resolved } = options;
		const { runnable: agent, selectedModel } = resolved;

		if (!query || query.trim().length === 0) {
			throw new Error("Query must be a non-empty string.");
		}

		if (!checkpointId) {
			throw new Error("checkpointId is required for editing.");
		}

		const runId = this.generateId();
		const startedAt = new Date();
		Logger.debug("agent.editFromCheckpoint.start", {
			runId,
			threadId,
			checkpointId,
			provider: selectedModel.provider,
			model: selectedModel.name,
			queryPreview: query.slice(0, 200),
		});

		const invokeConfig = this.buildRunnableConfig(options, threadId, checkpointId);

		const messageContent = await this.buildMessageContent(
			query,
			resolved.supportsVision,
			resolved.currentProvider,
			options.attachments,
		);
		const humanMessage = this.createHumanMessage(
			messageContent,
			options.attachments,
			options.visibleNotes,
			undefined,
			undefined,
			options.lcSource,
		);

		const input = {
			messages: [humanMessage],
		};

		const transportLabel = `agent.editFromCheckpoint:${runId}`;
		const transportContext = createAiTransportContext("default", transportLabel);

		const stream = bindAsyncIterableToTransportContext(
			await agent.stream(input, {
				...invokeConfig,
				streamMode: ["messages", "tools", "values"] as const,
			}),
			transportContext,
		);

		let rawResult: unknown;
		const pendingToolCalls = new Map<string, { name: string; input: unknown }>();
		const taskCallStack: string[] = [];
		const taskAiMessageIds = new Map<string, string | undefined>();
		const taskSubAgentNames = new Map<string, string | undefined>();
		const taskChildCounts = new Map<string, number>();
		let lastAiMessageId: string | undefined;
		const toolCallPreambles = new Map<string, string>();
		let preambleAccumulator = "";
		try {
			for await (const chunk of stream) {
				if (options.signal?.aborted) {
					Logger.debug("agent.editFromCheckpoint.aborted", { runId, threadId });
					break;
				}

				const [mode, payload] = chunk as ["messages" | "tools" | "values", unknown];

				if (mode === "tools") {
					const tp = payload as
						| { event: "on_tool_start"; toolCallId?: string; name: string; input: unknown }
						| { event: "on_tool_end"; toolCallId?: string; name: string; output: unknown }
						| { event: string; toolCallId?: string; name: string };

					if (tp.event === "on_tool_start") {
						const toolCallId = tp.toolCallId ?? "";
						const toolName = tp.name;
						const toolInput = (tp as { event: "on_tool_start"; input: unknown }).input;
						const toolInputNorm = this.normalizeStreamToolInput(toolInput);
						const attribution = this.resolveToolAttribution(
							"on_tool_start",
							toolInputNorm,
							toolName,
							toolCallId,
							taskCallStack,
							taskAiMessageIds,
							taskSubAgentNames,
							taskChildCounts,
							lastAiMessageId,
						);
						const preamble = toolCallPreambles.get(toolCallId);
						toolCallPreambles.delete(toolCallId);
						pendingToolCalls.set(toolCallId, { name: toolName, input: toolInputNorm });
						Logger.debug("agent.editFromCheckpoint.tool_start", { runId, toolCallId, toolName });
						yield {
							type: "tool_start",
							toolCallId,
							toolName,
							input: toolInputNorm,
							preamble,
							...attribution,
							runId,
							threadId,
						};
						continue;
					}

					if (tp.event === "on_tool_end") {
						const toolCallId = tp.toolCallId ?? "";
						const pending = pendingToolCalls.get(toolCallId);
						const toolName = pending?.name ?? tp.name;
						const output = this.normalizeStreamToolOutput(
							(tp as { event: "on_tool_end"; output: unknown }).output,
						);
						const attribution = this.resolveToolAttribution(
							"on_tool_end",
							undefined,
							toolName,
							toolCallId,
							taskCallStack,
							taskAiMessageIds,
							taskSubAgentNames,
							taskChildCounts,
							lastAiMessageId,
						);
						pendingToolCalls.delete(toolCallId);
						Logger.debug("agent.editFromCheckpoint.tool_end", { runId, toolCallId, toolName });
						yield {
							type: "tool_end",
							toolCallId,
							toolName,
							output,
							...attribution,
							runId,
							threadId,
						};
						continue;
					}

					continue;
				}

				if (mode === "messages") {
					const [message] = payload as [BaseMessage, Record<string, unknown>];
					if (message.getType() === "ai") {
						if (message.id && message.id !== lastAiMessageId) {
							lastAiMessageId = message.id;
							preambleAccumulator = "";
						}
						const token = this.normalizeContentToString(message.content);
						if (token && token.length > 0) {
							preambleAccumulator += token;
							yield {
								type: "token",
								token,
								aiMessageId: lastAiMessageId,
								runId,
								threadId,
							};
						}
						const msgToolCalls = (message as { tool_calls?: { id?: string }[] }).tool_calls;
						if (Array.isArray(msgToolCalls) && msgToolCalls.length > 0 && preambleAccumulator) {
							for (const tc of msgToolCalls) {
								if (tc.id && !toolCallPreambles.has(tc.id)) {
									toolCallPreambles.set(tc.id, preambleAccumulator);
								}
							}
						}
					}
					continue;
				}

				if (mode === "values") {
					if (this.isAgentOutputCandidate(payload)) {
						rawResult = payload;
					}
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				Logger.debug("agent.editFromCheckpoint.aborted", { runId, threadId });
				return;
			}

			const downgradeError = findAiTransportDowngradeRequiredError(error);
			if (downgradeError) {
				rawResult = await this.invokeBufferedFallback(
					agent,
					input,
					invokeConfig,
					runId,
					threadId,
					"agent.editFromCheckpoint",
					downgradeError,
				);
			} else {
				if (error instanceof TypeError && error.message.includes("fetch")) {
					const provider = selectedModel.provider;
					Logger.debug("agent.editFromCheckpoint.error", {
						runId,
						message: `Connection failed to ${provider}`,
					});
					throw new ProviderEndpointError(provider, "Connection refused - service may not be running");
				}

				Logger.debug("agent.editFromCheckpoint.error", {
					runId,
					message: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
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
		await this.persistThreadMetadata(threadId, runId, messages, selectedModel.name);
		await this.flushThreadPersistence(threadId);

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
		const { threadId, checkpointId, resolved } = options;
		const { runnable: agent, selectedModel } = resolved;

		if (!checkpointId) {
			throw new Error("checkpointId is required for regeneration.");
		}

		const runId = this.generateId();
		const startedAt = new Date();
		Logger.debug("agent.regenerateFromCheckpoint.start", {
			runId,
			threadId,
			checkpointId,
			provider: selectedModel.provider,
			model: selectedModel.name,
		});

		const invokeConfig = this.buildRunnableConfig(options, threadId, checkpointId);

		// Pass null to continue from checkpoint without adding a new message
		const input = null;

		const transportLabel = `agent.regenerateFromCheckpoint:${runId}`;
		const transportContext = createAiTransportContext("default", transportLabel);

		const stream = bindAsyncIterableToTransportContext(
			await agent.stream(input, {
				...invokeConfig,
				streamMode: ["messages", "tools", "values"] as const,
			}),
			transportContext,
		);

		let rawResult: unknown;
		const pendingToolCalls = new Map<string, { name: string; input: unknown }>();
		const taskCallStack: string[] = [];
		const taskAiMessageIds = new Map<string, string | undefined>();
		const taskSubAgentNames = new Map<string, string | undefined>();
		const taskChildCounts = new Map<string, number>();
		let lastAiMessageId: string | undefined;
		const toolCallPreambles = new Map<string, string>();
		let preambleAccumulator = "";
		try {
			for await (const chunk of stream) {
				if (options.signal?.aborted) {
					Logger.debug("agent.regenerateFromCheckpoint.aborted", { runId, threadId });
					break;
				}

				const [mode, payload] = chunk as ["messages" | "tools" | "values", unknown];

				if (mode === "tools") {
					const tp = payload as
						| { event: "on_tool_start"; toolCallId?: string; name: string; input: unknown }
						| { event: "on_tool_end"; toolCallId?: string; name: string; output: unknown }
						| { event: string; toolCallId?: string; name: string };

					if (tp.event === "on_tool_start") {
						const toolCallId = tp.toolCallId ?? "";
						const toolName = tp.name;
						const toolInput = (tp as { event: "on_tool_start"; input: unknown }).input;
						const toolInputNorm = this.normalizeStreamToolInput(toolInput);
						const attribution = this.resolveToolAttribution(
							"on_tool_start",
							toolInputNorm,
							toolName,
							toolCallId,
							taskCallStack,
							taskAiMessageIds,
							taskSubAgentNames,
							taskChildCounts,
							lastAiMessageId,
						);
						pendingToolCalls.set(toolCallId, { name: toolName, input: toolInputNorm });
						const preamble = toolCallPreambles.get(toolCallId);
						toolCallPreambles.delete(toolCallId);
						Logger.debug("agent.regenerateFromCheckpoint.tool_start", { runId, toolCallId, toolName });
						yield {
							type: "tool_start",
							toolCallId,
							toolName,
							input: toolInputNorm,
							preamble,
							...attribution,
							runId,
							threadId,
						};
						continue;
					}

					if (tp.event === "on_tool_end") {
						const toolCallId = tp.toolCallId ?? "";
						const pending = pendingToolCalls.get(toolCallId);
						const toolName = pending?.name ?? tp.name;
						const output = this.normalizeStreamToolOutput(
							(tp as { event: "on_tool_end"; output: unknown }).output,
						);
						const attribution = this.resolveToolAttribution(
							"on_tool_end",
							undefined,
							toolName,
							toolCallId,
							taskCallStack,
							taskAiMessageIds,
							taskSubAgentNames,
							taskChildCounts,
							lastAiMessageId,
						);
						pendingToolCalls.delete(toolCallId);
						Logger.debug("agent.regenerateFromCheckpoint.tool_end", { runId, toolCallId, toolName });
						yield {
							type: "tool_end",
							toolCallId,
							toolName,
							output,
							...attribution,
							runId,
							threadId,
						};
						continue;
					}

					continue;
				}

				if (mode === "messages") {
					const [message] = payload as [BaseMessage, Record<string, unknown>];
					if (message.getType() === "ai") {
						if (message.id && message.id !== lastAiMessageId) {
							lastAiMessageId = message.id;
							preambleAccumulator = "";
						}
						const token = this.normalizeContentToString(message.content);
						if (token && token.length > 0) {
							preambleAccumulator += token;
							yield {
								type: "token",
								token,
								aiMessageId: lastAiMessageId,
								runId,
								threadId,
							};
						}
						const msgToolCalls = (message as { tool_calls?: { id?: string }[] }).tool_calls;
						if (Array.isArray(msgToolCalls) && msgToolCalls.length > 0 && preambleAccumulator) {
							for (const tc of msgToolCalls) {
								if (tc.id && !toolCallPreambles.has(tc.id)) {
									toolCallPreambles.set(tc.id, preambleAccumulator);
								}
							}
						}
					}
					continue;
				}

				if (mode === "values") {
					if (this.isAgentOutputCandidate(payload)) {
						rawResult = payload;
					}
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				Logger.debug("agent.regenerateFromCheckpoint.aborted", { runId, threadId });
				return;
			}

			const downgradeError = findAiTransportDowngradeRequiredError(error);
			if (downgradeError) {
				rawResult = await this.invokeBufferedFallback(
					agent,
					input,
					invokeConfig,
					runId,
					threadId,
					"agent.regenerateFromCheckpoint",
					downgradeError,
				);
			} else {
				if (error instanceof TypeError && error.message.includes("fetch")) {
					const provider = selectedModel.provider;
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
			}
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
		await this.persistThreadMetadata(threadId, runId, messages, selectedModel.name);

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
			recursionLimit: 1000, // Effectively deactivated (default is 25)
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

	private wrapCheckpointer(checkpointer: BaseCheckpointSaver): BaseCheckpointSaver {
		const agent = this;
		return new Proxy(checkpointer, {
			get(target, prop, receiver) {
				if (prop === "getTuple") {
					return async (...args: unknown[]) => {
						const getTuple = Reflect.get(target, prop, receiver) as (
							...innerArgs: unknown[]
						) => Promise<CheckpointTuple | undefined>;
						const tuple = await getTuple.apply(target, args);
						return agent.normalizeCheckpointTuple(tuple);
					};
				}

				if (prop === "list") {
					return async function* (...args: unknown[]) {
						const list = Reflect.get(target, prop, receiver) as (
							...innerArgs: unknown[]
						) => AsyncIterable<CheckpointTuple>;
						for await (const tuple of list.apply(target, args)) {
							yield agent.normalizeCheckpointTuple(tuple) as CheckpointTuple;
						}
					};
				}

				const value = Reflect.get(target, prop, receiver);
				return typeof value === "function" ? value.bind(target) : value;
			},
		}) as BaseCheckpointSaver;
	}

	private normalizeCheckpointTuple(tuple: CheckpointTuple | undefined): CheckpointTuple | undefined {
		if (!tuple?.checkpoint?.channel_values) {
			return tuple;
		}

		const channelValues = tuple.checkpoint.channel_values as Record<string, unknown>;
		const rawMessages = channelValues.messages;
		if (!Array.isArray(rawMessages)) {
			return tuple;
		}

		const normalizedMessages = normalizeMessages(rawMessages);
		return {
			...tuple,
			checkpoint: {
				...tuple.checkpoint,
				channel_values: {
					...channelValues,
					messages: normalizedMessages,
				},
			},
		} as CheckpointTuple;
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
		return normalizeMessages(messages);
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
		return normalizeMessages(messages);
	}

	/**
	 * Resolves subagent nesting AND the timeline group (`aiMessageId`) for a tool
	 * event, using the per-stream `task` call stack. deepagents runs each subagent
	 * inside a `task` tool call, so any tool event while a `task` call is open may
	 * be a child of that call.
	 *
	 * Child attribution uses FIFO round-robin: each child is assigned to the open
	 * task with the fewest children so far, preferring the earliest-pushed task on
	 * ties. This matches deepagents' sequential execution order — children of task A
	 * arrive before children of task B even if both tasks' start events appear before
	 * any children. The `subagent_type` from each task's input (recorded on start) is
	 * used as the display name for attributed children.
	 *
	 * The `aiMessageId` normally follows `lastAiMessageId`. For children we force
	 * them to inherit the `aiMessageId` the parent `task` call was stamped with so
	 * parent and children land in the same timeline step.
	 */
	private resolveToolAttribution(
		eventType: "on_tool_start" | "on_tool_end" | "other",
		toolInput: unknown,
		toolName: string,
		toolCallId: string,
		taskCallStack: string[],
		taskAiMessageIds: Map<string, string | undefined>,
		taskSubAgentNames: Map<string, string | undefined>,
		taskChildCounts: Map<string, number>,
		lastAiMessageId: string | undefined,
	): { aiMessageId?: string; subAgentName?: string; parentToolCallId?: string } {
		const isTaskCall = toolName === "task";
		if (eventType === "on_tool_start" && isTaskCall) {
			taskCallStack.push(toolCallId);
			taskAiMessageIds.set(toolCallId, lastAiMessageId);
			taskChildCounts.set(toolCallId, 0);
			const input = toolInput as Record<string, unknown> | undefined;
			const subAgentName = typeof input?.subagent_type === "string" ? input.subagent_type : undefined;
			taskSubAgentNames.set(toolCallId, subAgentName);
			// Stamp the task call itself with its subagent name so the timeline card
			// shows the subagent label + badge during streaming (matching checkpoint
			// replay), not the bare "task" tool name.
			return { aiMessageId: lastAiMessageId, subAgentName };
		}
		if (eventType === "on_tool_end" && isTaskCall) {
			const groupId = taskAiMessageIds.has(toolCallId) ? taskAiMessageIds.get(toolCallId) : lastAiMessageId;
			const subAgentName = taskSubAgentNames.get(toolCallId);
			const idx = taskCallStack.lastIndexOf(toolCallId);
			if (idx !== -1) taskCallStack.splice(idx, 1);
			taskAiMessageIds.delete(toolCallId);
			taskSubAgentNames.delete(toolCallId);
			taskChildCounts.delete(toolCallId);
			return { aiMessageId: groupId, subAgentName };
		}
		// Assign each child to the open task with the fewest children (FIFO round-robin).
		// Only increment the child count on tool_start — tool_end events carry the same
		// parentToolCallId for correlation but should not count as a second child attribution.
		let parentToolCallId: string | undefined;
		if (taskCallStack.length > 0) {
			let bestParent: string | undefined;
			let bestCount = Number.MAX_SAFE_INTEGER;
			for (const taskId of taskCallStack) {
				const count = taskChildCounts.get(taskId) ?? 0;
				if (count < bestCount) {
					bestCount = count;
					bestParent = taskId;
				}
			}
			parentToolCallId = bestParent;
		}
		if (parentToolCallId) {
			if (eventType === "on_tool_start") {
				taskChildCounts.set(parentToolCallId, (taskChildCounts.get(parentToolCallId) ?? 0) + 1);
			}
			const resolvedSubAgentName = taskSubAgentNames.get(parentToolCallId);
			const parentAiMessageId = taskAiMessageIds.get(parentToolCallId) ?? lastAiMessageId;
			return { aiMessageId: parentAiMessageId, subAgentName: resolvedSubAgentName, parentToolCallId };
		}
		return { aiMessageId: lastAiMessageId };
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

	private normalizeStreamToolOutput(rawOutput: unknown): unknown {
		if (rawOutput === null || rawOutput === undefined) {
			return undefined;
		}

		if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
			const wrapper = rawOutput as Record<string, unknown>;

			// The `task` tool returns a LangGraph `Command` (returnCommandWithStateUpdate),
			// not a plain ToolMessage. Its `update.messages` array holds the ToolMessage
			// whose content is the subagent's final text. Unwrap it so the timeline shows
			// the subagent output during streaming (instead of dumping the raw Command's
			// lg_name/update/goto fields), matching checkpoint-replay rendering.
			if (wrapper.lg_name === "Command") {
				const update = wrapper.update as { messages?: unknown } | undefined;
				const messages = Array.isArray(update?.messages) ? (update?.messages as unknown[]) : undefined;
				const last = messages && messages.length > 0 ? messages[messages.length - 1] : undefined;
				return last && typeof last === "object" ? this.normalizeStreamToolOutput(last) : undefined;
			}

			// A live LangChain message instance (BaseMessage) — e.g. the ToolMessage the
			// `task` tool emits at on_tool_end during streaming. Its `content` holds the
			// text. Detect it by the `_getType` method (own-key checks are unreliable:
			// instances carry lc_* bookkeeping fields not in any fixed allowlist).
			if (typeof (wrapper as { _getType?: unknown })._getType === "function" && "content" in wrapper) {
				return wrapper.content;
			}

			const keys = Object.keys(wrapper);

			if (
				"content" in wrapper &&
				(keys.length === 1 ||
					keys.every((key) =>
						[
							"content",
							"artifact",
							"status",
							"tool_call_id",
							"name",
							"type",
							"id",
							"additional_kwargs",
							"response_metadata",
						].includes(key),
					))
			) {
				return wrapper.content;
			}

			if ("output" in wrapper && keys.length === 1) {
				return wrapper.output;
			}
		}

		return rawOutput;
	}

	private normalizeContentToString(value: unknown): string | undefined {
		if (typeof value === "string") {
			return value.length > 0 ? value : undefined;
		}
		if (Array.isArray(value)) {
			const combined = value
				.map((entry) => {
					if (typeof entry === "string") return entry;
					if (entry && typeof entry === "object" && typeof (entry as { text?: unknown }).text === "string") {
						return (entry as { text: string }).text;
					}
					return "";
				})
				.join("");
			return combined.length > 0 ? combined : undefined;
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

	private async persistThreadMetadata(
		threadId: string,
		runId: string,
		messages: BaseMessage[],
		modelName?: string,
	): Promise<void> {
		if (!this.threadStore) {
			return;
		}
		const existing = await this.threadStore.read(threadId);
		const metadata: Record<string, unknown> = { ...(existing?.metadata ?? {}) };
		metadata.lastRunId = runId;
		metadata.model = modelName;
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

	private async flushThreadPersistence(threadId: string): Promise<void> {
		if (!this.threadStore?.flush) {
			return;
		}
		await this.threadStore.flush(threadId);
	}

	async generateTitle(userMessage: string, resolved: ResolvedRun): Promise<string | undefined> {
		const model = resolved.titleModel?.instance ?? resolved.selectedModel.instance;

		const prompt = `Generate a short, concise title (max 5 words) for the following user message. 
Rules:
- Use the same language as the user message.
- Do not use quotes, markdown, or a period at the end.
- Capture the core topic or intent.

User message:
${userMessage}`;

		// Use buffered transport mode for this non-streaming invoke call.
		// Electron net.fetch can produce responses that some providers
		// (e.g. OpenRouter) fail to parse, while the buffered requestUrl
		// path always returns a well-formed JSON body. Scoped via run() so a
		// concurrent stream's transport context is never disturbed.
		const transportContext = createAiTransportContext("buffered", "generateTitle");

		try {
			Logger.log(`[Agent] Generating title for message: "${userMessage.slice(0, 50)}..."`);
			const response = await runWithAiTransportContext(transportContext, async () =>
				model.invoke([{ role: "user", content: prompt }]),
			);

			const content = response.content;
			Logger.debug("[Agent] Title generation raw response:", content);

			let title = "";
			if (typeof content === "string") {
				title = content;
			} else if (Array.isArray(content)) {
				title = content
					.map((c) => (typeof c === "string" ? c : ((c as { text?: string }).text ?? "")))
					.join("");
			}

			const finalTitle = title.replace(/^["'#*:\s]+|["'#*:\s]+$/g, "").trim();
			Logger.log(`[Agent] Generated title: "${finalTitle}"`);
			return finalTitle;
		} catch (error) {
			Logger.error("[Agent] Title generation failed:", error);
			return undefined;
		}
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
