import {
	type AIMessage,
	type BaseMessage,
	type ToolMessage,
	isAIMessage,
	isHumanMessage,
	isToolMessage,
} from "@langchain/core/messages";
import { Notice, type TFile } from "obsidian";
import type { AgentStreamChunk, ThreadHistory } from "../agent/Agent";
import type { AgentManager } from "../agent/AgentManager";
import type { ChatModelConfig } from "../providers/index";
import type { ThreadError } from "../types/shared";
import { type UUIDv7, dateFromUUIDv7, genUUIDv7 } from "../utils/uuid7Validator";
import { getData } from "./dataStore.svelte";
import { getPlugin } from "./state.svelte";

// Re-export for backward compatibility
export type { ThreadError };

/* -----------------------------------------------------------------------------
 * Shared Types
 * ---------------------------------------------------------------------------*/

export enum AssistantState {
	idle = 0,
	streaming = 1,
	success = 2,
	error = 3,
	cancelled = 4,
}

export enum MessageState {
	idle = 0,
	answering = 1,
	editing = 2,
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
		genModelConfig: ChatModelConfig;
	};
	errorCode?: string;
}

/**
 * Information about branches at a given checkpoint.
 * Used for navigating between alternative conversation paths.
 */
export interface BranchInfo {
	/** 1-based index of the current branch */
	currentIndex: number;
	/** Total number of sibling branches at this fork point */
	totalBranches: number;
	/** Ordered list of sibling checkpoint IDs (the leaf/tip of each branch to navigate to) */
	siblingCheckpointIds: string[];
	/** The checkpoint ID where the fork occurred */
	forkPointId: string;
	/** The immediate child checkpoint of the fork point (first checkpoint in this branch after fork) */
	forkChildId: string;
}

export interface MessagePair {
	id: UUIDv7;
	userMessage: UserMessage;
	assistantMessage: AssistantMessage;
	/** The model used to generate the assistant response */
	model?: ChatModel;

	/**
	 * Checkpoint ID where this HumanMessage is the last message.
	 * Fork from here to REGENERATE the AI response.
	 */
	regenerateFromCheckpointId?: string;

	/**
	 * Checkpoint ID where the PREVIOUS AIMessage is the last message.
	 * Fork from here to EDIT the user message.
	 * Undefined for the first message pair (no ancestor).
	 */
	editFromCheckpointId?: string;

	/**
	 * Branch info for the human message (edit branches).
	 * Shows how many times this user turn was edited.
	 */
	userBranchInfo?: BranchInfo;

	/**
	 * Branch info for the AI response (regenerate branches).
	 * Shows how many times this response was regenerated.
	 */
	assistantBranchInfo?: BranchInfo;
}

export interface ChatPreview {
	id: UUIDv7;
	title: string;
	lastAccessed: Date;
}

export interface ChatModel {
	model: string;
	provider: string;
	modelConfig: Partial<ChatModelConfig>;
}

/**
 * In-memory representation of a chat with messages.
 */
export interface ChatRecord {
	id: string;
	messages: MessagePair[];
}

/* -----------------------------------------------------------------------------
 * Checkpoint Mapping for Branching
 * ---------------------------------------------------------------------------*/

export interface CheckpointMessageMapping {
	/**
	 * LangChain HumanMessage ID -> checkpoint where this human message is LAST
	 * Used for: REGENERATE
	 */
	humanLastCheckpoints: Map<string, string>;

	/**
	 * LangChain HumanMessage ID -> checkpoint where the PREVIOUS AI message is LAST
	 * Used for: EDIT
	 */
	aiBeforeHumanCheckpoints: Map<string, string>;

	/**
	 * LangChain HumanMessage ID -> checkpoint where the AI response to this human message is LAST
	 * Used for: Looking up branch info for regenerate branches
	 */
	aiAfterHumanCheckpoints: Map<string, string>;

	/**
	 * Checkpoint ID -> BranchInfo for navigation between sibling branches
	 */
	branchInfoMap: Map<string, BranchInfo>;

	/**
	 * Set of checkpoint IDs that are the first human message in a branch (edit fork entry points).
	 * Only these checkpoints should show user branch navigation.
	 */
	editForkEntryCheckpoints: Set<string>;

	/**
	 * The root/initial checkpoint ID (step -1 or earliest checkpoint)
	 * Used for editing the first message
	 */
	rootCheckpointId?: string;
}

/**
 * Builds checkpoint mapping from checkpoint history for branching operations.
 */
export function buildCheckpointMessageMapping(
	checkpoints: Array<{
		checkpointId: string;
		messages: BaseMessage[];
		step: number;
		parentCheckpointId?: string;
	}>,
	targetCheckpointId?: string,
): CheckpointMessageMapping {
	const humanLastCheckpoints = new Map<string, string>();
	const aiBeforeHumanCheckpoints = new Map<string, string>();
	const aiAfterHumanCheckpoints = new Map<string, string>();
	const branchInfoMap = new Map<string, BranchInfo>();

	// Find the root checkpoint (earliest step, typically step -1)
	let rootCheckpointId: string | undefined;
	let minStep = Number.POSITIVE_INFINITY;
	for (const { checkpointId, step } of checkpoints) {
		if (step < minStep) {
			minStep = step;
			rootCheckpointId = checkpointId;
		}
	}

	// Build parent -> children map for branch calculation
	const childrenByParent = new Map<string, string[]>();
	const checkpointChildren = new Map<string, string[]>();
	for (const { checkpointId, parentCheckpointId } of checkpoints) {
		if (parentCheckpointId) {
			const siblings = childrenByParent.get(parentCheckpointId) || [];
			siblings.push(checkpointId);
			childrenByParent.set(parentCheckpointId, siblings);

			const children = checkpointChildren.get(parentCheckpointId) || [];
			children.push(checkpointId);
			checkpointChildren.set(parentCheckpointId, children);
		}
	}

	// Find the tip (leaf) checkpoint for a given checkpoint by following the latest child
	function findBranchTip(startCheckpointId: string): string {
		let current = startCheckpointId;
		let children = checkpointChildren.get(current);
		while (children && children.length > 0) {
			const sorted = [...children].sort();
			current = sorted[sorted.length - 1];
			children = checkpointChildren.get(current);
		}
		return current;
	}

	// Get all descendants of a checkpoint
	function getAllDescendants(startId: string): string[] {
		const descendants: string[] = [];
		const queue = [startId];
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) continue;
			descendants.push(current);
			const children = checkpointChildren.get(current) || [];
			queue.push(...children);
		}
		return descendants;
	}

	// Build checkpoint ID -> messages lookup for finding first human message in branch
	const checkpointMessagesMap = new Map<string, BaseMessage[]>();
	for (const { checkpointId, messages } of checkpoints) {
		checkpointMessagesMap.set(checkpointId, messages);
	}

	// Find the first human message checkpoint in a branch starting from forkChildId
	function findFirstHumanInBranch(startId: string): string | null {
		const queue = [startId];
		const visited = new Set<string>();
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current || visited.has(current)) continue;
			visited.add(current);

			const msgs = checkpointMessagesMap.get(current);
			const lastMsg = msgs?.at(-1);
			if (lastMsg && isHumanMessage(lastMsg)) {
				return current;
			}

			// Follow children (sorted by checkpoint ID for determinism)
			const children = checkpointChildren.get(current) || [];
			queue.push(...[...children].sort());
		}
		return null;
	}

	console.log("[buildCheckpointMessageMapping] childrenByParent:", [...childrenByParent.entries()]);

	// Track which checkpoints are the entry point for edit forks (first human message in branch)
	const editForkEntryCheckpoints = new Set<string>();

	// Build checkpoint -> depth map for sorting forks
	const checkpointDepth = new Map<string, number>();
	const checkpointParent = new Map<string, string | undefined>();
	const visitingDepth = new Set<string>();
	for (const { checkpointId, parentCheckpointId } of checkpoints) {
		checkpointParent.set(checkpointId, parentCheckpointId);
	}
	function getDepth(cpId: string): number {
		const cached = checkpointDepth.get(cpId);
		if (cached !== undefined) return cached;
		if (visitingDepth.has(cpId)) {
			console.warn("[buildCheckpointMessageMapping] cycle detected in checkpoint parent chain", { checkpointId: cpId });
			return 0;
		}
		visitingDepth.add(cpId);
		let depth = 0;
		try {
			const parent = checkpointParent.get(cpId);
			depth = parent ? getDepth(parent) + 1 : 0;
		} finally {
			visitingDepth.delete(cpId);
		}
		checkpointDepth.set(cpId, depth);
		return depth;
	}
	for (const { checkpointId } of checkpoints) {
		getDepth(checkpointId);
	}

	// Get fork points (parents with multiple children) sorted by depth descending
	// This ensures deeper forks are processed last, so their branchInfo wins
	const forkPoints = [...childrenByParent.entries()]
		.filter(([_, children]) => children.length > 1)
		.sort((a, b) => getDepth(a[0]) - getDepth(b[0])); // ascending = shallower first

	// Calculate branch info for each fork point and propagate to descendants
	// Forks are processed from shallowest to deepest, so deeper forks overwrite and win
	for (const [forkPointId, children] of forkPoints) {
		console.log(
			"[buildCheckpointMessageMapping] FORK found at:",
			forkPointId,
			"depth:",
			getDepth(forkPointId),
			"children:",
			children,
		);
		const sortedChildren = [...children].sort();
		const branchTips = sortedChildren.map((childId) => findBranchTip(childId));

		// Determine if this is an "edit fork" (fork from AI/root) or "regenerate fork" (fork from human)
		// Edit forks: fork point has AI message as last (or no messages for root)
		// Regenerate forks: fork point has human message as last
		const forkPointMessages = checkpointMessagesMap.get(forkPointId);
		const forkPointLastMessage = forkPointMessages?.at(-1);
		const isEditFork = !forkPointLastMessage || !isHumanMessage(forkPointLastMessage);

		for (let i = 0; i < sortedChildren.length; i++) {
			const childId = sortedChildren[i];
			const branchInfo: BranchInfo = {
				currentIndex: i + 1,
				totalBranches: sortedChildren.length,
				siblingCheckpointIds: branchTips,
				forkPointId: forkPointId,
				forkChildId: childId, // The immediate child of the fork point
			};

			// Only mark edit entry points for edit forks (not regenerate forks)
			if (isEditFork) {
				const firstHumanCheckpoint = findFirstHumanInBranch(childId);
				if (firstHumanCheckpoint) {
					editForkEntryCheckpoints.add(firstHumanCheckpoint);
				}
			}

			// Assign branch info to all descendants of this branch
			const allInBranch = getAllDescendants(childId);
			for (const cpId of allInBranch) {
				branchInfoMap.set(cpId, branchInfo);
			}
		}
	}

	console.log("[buildCheckpointMessageMapping] branchInfoMap size:", branchInfoMap.size);

	// Build the set of checkpoints in target branch path if specified
	const targetBranchPath = targetCheckpointId ? buildBranchPath(checkpoints, targetCheckpointId) : null;

	// Sort by step and filter to relevant branch
	const sorted = [...checkpoints].sort((a, b) => a.step - b.step);
	const filtered = targetBranchPath
		? sorted.filter((cp) => targetBranchPath.has(cp.checkpointId))
		: filterToLatestBranch(sorted, childrenByParent);

	let lastAiCheckpointId: string | undefined;
	let lastHumanMessageId: string | undefined;

	console.log("[buildCheckpointMessageMapping] filtered checkpoints:", filtered.length);

	for (const { checkpointId, messages } of filtered) {
		const lastMessage = messages.at(-1);
		console.log(
			"[buildCheckpointMessageMapping] checkpoint:",
			checkpointId,
			"lastMessage type:",
			lastMessage?.constructor?.name,
			"lastMessage.id:",
			lastMessage?.id,
		);

		if (!lastMessage || isAIMessage(lastMessage)) {
			lastAiCheckpointId = checkpointId;

			// If we have a pending human message, this AI checkpoint is its response
			if (lastHumanMessageId && lastMessage && isAIMessage(lastMessage)) {
				aiAfterHumanCheckpoints.set(lastHumanMessageId, checkpointId);
				lastHumanMessageId = undefined;
			}
		} else if (isHumanMessage(lastMessage)) {
			const humanMessageId = lastMessage.id;
			console.log("[buildCheckpointMessageMapping] found HumanMessage with id:", humanMessageId);
			if (humanMessageId) {
				humanLastCheckpoints.set(humanMessageId, checkpointId);

				if (lastAiCheckpointId) {
					aiBeforeHumanCheckpoints.set(humanMessageId, lastAiCheckpointId);
				}

				lastHumanMessageId = humanMessageId;
			}
		}
	}

	console.log(
		"[buildCheckpointMessageMapping] result - humanLastCheckpoints:",
		[...humanLastCheckpoints.entries()],
		"rootCheckpointId:",
		rootCheckpointId,
	);

	console.log("[buildCheckpointMessageMapping] editForkEntryCheckpoints:", [...editForkEntryCheckpoints]);

	return {
		humanLastCheckpoints,
		aiBeforeHumanCheckpoints,
		aiAfterHumanCheckpoints,
		branchInfoMap,
		editForkEntryCheckpoints,
		rootCheckpointId,
	};
}

function buildBranchPath(
	checkpoints: Array<{ checkpointId: string; parentCheckpointId?: string }>,
	targetCheckpointId: string,
): Set<string> {
	const checkpointMap = new Map<string, string | undefined>();
	for (const { checkpointId, parentCheckpointId } of checkpoints) {
		checkpointMap.set(checkpointId, parentCheckpointId);
	}

	const path = new Set<string>();
	let current: string | undefined = targetCheckpointId;

	while (current) {
		path.add(current);
		current = checkpointMap.get(current);
	}

	return path;
}

function filterToLatestBranch(
	sortedCheckpoints: Array<{
		checkpointId: string;
		messages: BaseMessage[];
		step: number;
		parentCheckpointId?: string;
	}>,
	childrenByParent: Map<string, string[]>,
): typeof sortedCheckpoints {
	const latestAtFork = new Set<string>();

	for (const [_parent, children] of childrenByParent) {
		const sorted = [...children].sort();
		const latest = sorted[sorted.length - 1];
		if (latest) {
			latestAtFork.add(latest);
		}
	}

	return sortedCheckpoints.filter((cp) => {
		const siblings = childrenByParent.get(cp.parentCheckpointId || "");
		if (!siblings || siblings.length <= 1) {
			return true;
		}
		return latestAtFork.has(cp.checkpointId);
	});
}

/* -----------------------------------------------------------------------------
 * BaseMessage to MessagePair conversion
 * ---------------------------------------------------------------------------*/

/**
 * Extracts text content from a BaseMessage.
 * Uses the .text getter which handles string and ContentBlock[] formats.
 */
function extractTextContent(message: BaseMessage): string {
	return message.text || "";
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
 * Builds a map of tool outputs from tool messages.
 */
function buildToolOutputsMap(messages: BaseMessage[]): Map<string, { content: unknown; status: ToolCallStatus }> {
	const toolOutputs = new Map<string, { content: unknown; status: ToolCallStatus }>();
	for (const msg of messages) {
		if (isToolMessage(msg)) {
			const toolMsg = msg as ToolMessage;
			const toolCallId = toolMsg.tool_call_id;
			if (toolCallId) {
				toolOutputs.set(toolCallId, {
					content: toolMsg.content,
					status: toolMsg.status === "error" ? "failed" : "completed",
				});
			}
		}
	}
	return toolOutputs;
}

/**
 * Converts a single AI BaseMessage to an AssistantMessage.
 * Used to sync UI with checkpoint state after streaming, and reused in batch conversion.
 */
export function baseMessageToAssistantMessage(
	msg: BaseMessage,
	toolOutputs?: Map<string, { content: unknown; status: ToolCallStatus }>,
	stateOverride?: AssistantState,
): AssistantMessage {
	const textContent = extractTextContent(msg);

	// Extract tool calls if present (only on AIMessage)
	let toolCalls: ToolCallState[] | undefined;

	if (isAIMessage(msg)) {
		const aiMsg = msg as AIMessage;
		const rawToolCalls = aiMsg.tool_calls;

		if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
			toolCalls = rawToolCalls.map((tc) => {
				const toolOutput = toolOutputs?.get(tc.id || "");
				return {
					id: tc.id || "",
					name: tc.name,
					input: normalizeToolInput(tc.args),
					status: toolOutput?.status ?? "completed",
					output: toolOutput?.content,
				};
			});
		}
	}

	return {
		state: stateOverride ?? AssistantState.success,
		content: textContent,
		toolCalls,
	};
}

/**
 * Merges multiple AI BaseMessages into a single AssistantMessage.
 * Combines tool calls from all messages and uses the last non-empty text content.
 */
function mergeAssistantMessages(
	assistantMessages: BaseMessage[],
	toolOutputs: Map<string, { content: unknown; status: ToolCallStatus }>,
	stateOverride?: AssistantState,
): AssistantMessage {
	if (assistantMessages.length === 0) {
		return {
			state: stateOverride ?? AssistantState.success,
			content: "",
		};
	}

	if (assistantMessages.length === 1) {
		return baseMessageToAssistantMessage(assistantMessages[0], toolOutputs, stateOverride);
	}

	// Merge multiple assistant messages
	let finalContent = "";
	const allToolCalls: ToolCallState[] = [];

	for (const msg of assistantMessages) {
		const converted = baseMessageToAssistantMessage(msg, toolOutputs);

		// Use the last non-empty content
		if (converted.content.trim()) {
			finalContent = converted.content;
		}

		// Collect all tool calls
		if (converted.toolCalls) {
			allToolCalls.push(...converted.toolCalls);
		}
	}

	return {
		state: stateOverride ?? AssistantState.success,
		content: finalContent,
		toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
	};
}

/**
 * Converts an array of BaseMessage (from LangGraph) into MessagePair[] for UI rendering.
 *
 * This function:
 * 1. Pairs user messages with their corresponding assistant responses
 * 2. Attaches tool outputs to their parent assistant message's tool calls
 * 3. Merges consecutive assistant messages (tool calls + final response)
 * 4. Uses UUIDv7 for message pair IDs (with timestamp extraction capability)
 * 5. Uses errorCount to distinguish error state from cancelled state
 * 6. Populates branching checkpoint IDs and branch info when checkpointMapping is provided
 */
export function baseMessagesToMessagePairs(
	messages: BaseMessage[],
	errorCount = 0,
	checkpointMapping?: CheckpointMessageMapping,
): MessagePair[] {
	if (!messages || messages.length === 0) return [];

	const messagePairs: MessagePair[] = [];
	const toolOutputs = buildToolOutputsMap(messages);

	// Filter to just user (human) and assistant (ai) messages
	const conversationMessages = messages.filter((msg) => isHumanMessage(msg) || isAIMessage(msg));

	// Track remaining errors locally to avoid reassigning parameter
	let remainingErrors = errorCount;

	let i = 0;
	while (i < conversationMessages.length) {
		const msg = conversationMessages[i];

		if (isHumanMessage(msg)) {
			// Start a new pair with user message
			const userContent = extractTextContent(msg);
			const humanMessageId = msg.id;
			console.log(
				"[baseMessagesToMessagePairs] humanMessageId:",
				humanMessageId,
				"hasMapping:",
				!!checkpointMapping,
			);
			// Generate fresh UUIDv7 for the pair
			const pairId = genUUIDv7();

			// Look ahead for assistant response(s)
			const assistantMessages: BaseMessage[] = [];
			let j = i + 1;
			while (j < conversationMessages.length && isAIMessage(conversationMessages[j])) {
				assistantMessages.push(conversationMessages[j]);
				j++;
			}

			// Determine state for the message pair
			const hasNoResponse = assistantMessages.length === 0;
			let state: AssistantState;

			if (hasNoResponse && remainingErrors > 0) {
				state = AssistantState.error;
				remainingErrors--;
			} else if (hasNoResponse) {
				state = AssistantState.cancelled;
			} else {
				state = AssistantState.success;
			}

			// Build checkpoint IDs and branch info from mapping
			let regenerateFromCheckpointId: string | undefined;
			let editFromCheckpointId: string | undefined;
			let userBranchInfo: BranchInfo | undefined;
			let assistantBranchInfo: BranchInfo | undefined;

			if (checkpointMapping) {
				if (humanMessageId) {
					// Checkpoint where this human message is last -> fork from here to REGENERATE
					regenerateFromCheckpointId = checkpointMapping.humanLastCheckpoints.get(humanMessageId);

					// Checkpoint where previous AI message is last -> fork from here to EDIT
					// For first message, use rootCheckpointId since there's no previous AI
					editFromCheckpointId =
						checkpointMapping.aiBeforeHumanCheckpoints.get(humanMessageId) ??
						checkpointMapping.rootCheckpointId;

					// Branch info for user message (edit branches)
					// Only show on the FIRST human message in a branch (the one right after the fork)
					if (
						regenerateFromCheckpointId &&
						checkpointMapping.editForkEntryCheckpoints.has(regenerateFromCheckpointId)
					) {
						const humanBranchInfo = checkpointMapping.branchInfoMap.get(regenerateFromCheckpointId);
						if (humanBranchInfo) {
							// Update editFromCheckpointId to the actual fork point
							editFromCheckpointId = humanBranchInfo.forkPointId;
							userBranchInfo = humanBranchInfo;
						}
					}

					// Branch info for AI response (regenerate branches)
					// Show only if the AI checkpoint is in a branch that forked from regenerateFromCheckpointId
					const aiCheckpointId = checkpointMapping.aiAfterHumanCheckpoints.get(humanMessageId);
					if (aiCheckpointId && regenerateFromCheckpointId) {
						const aiBranchInfo = checkpointMapping.branchInfoMap.get(aiCheckpointId);
						// Only show if the fork happened at the human message checkpoint (regenerate fork)
						if (aiBranchInfo && aiBranchInfo.forkPointId === regenerateFromCheckpointId) {
							assistantBranchInfo = aiBranchInfo;
						}
					}
				} else {
					// No humanMessageId - this is the first message, use rootCheckpointId for edit
					console.log(
						"[baseMessagesToMessagePairs] No humanMessageId, using rootCheckpointId:",
						checkpointMapping.rootCheckpointId,
					);
					editFromCheckpointId = checkpointMapping.rootCheckpointId;
				}
			}

			messagePairs.push({
				id: pairId,
				userMessage: { content: userContent },
				assistantMessage: mergeAssistantMessages(assistantMessages, toolOutputs, state),
				regenerateFromCheckpointId,
				editFromCheckpointId,
				userBranchInfo,
				assistantBranchInfo,
			});

			i = j;
		} else {
			// Orphaned assistant message (no preceding user message)
			const pairId = genUUIDv7();

			messagePairs.push({
				id: pairId,
				userMessage: { content: "" },
				assistantMessage: baseMessageToAssistantMessage(msg, toolOutputs),
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

// Use AgentStreamChunk from Agent.ts - no need to duplicate the type

/* -----------------------------------------------------------------------------
 * ChatSession
 *  - Ephemeral per-chat runtime state (streaming, abort, reactive messages)
 *  - Converts BaseMessages to MessagePairs on load, then works with MessagePairs only
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

	// Branching support
	private checkpointMapping: CheckpointMessageMapping | undefined;
	private onNeedReload: (() => Promise<void>) | undefined;

	constructor(
		id: string,
		langchainMessages: BaseMessage[],
		errorCount = 0,
		checkpointMapping?: CheckpointMessageMapping,
		onNeedReload?: () => Promise<void>,
	) {
		this.id = id;
		this.checkpointMapping = checkpointMapping;
		this.onNeedReload = onNeedReload;
		// Convert once on load, then drop the raw BaseMessages
		this.messages = baseMessagesToMessagePairs(langchainMessages, errorCount, checkpointMapping);
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
		const selectedAgent = getData().getSelectedAgent();
		const currentModel = selectedAgent?.chatModel ?? getData().getDefaultChatModel() ?? undefined;

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

	/**
	 * Edit a user message and get a new AI response.
	 * This creates a new branch from the checkpoint before the original message.
	 */
	async editMessage(pairId: UUIDv7, newContent: string): Promise<void> {
		const pair = this.findPair(pairId);
		if (!pair) {
			throw new Error("Message pair not found");
		}

		// Get the checkpoint to fork from for editing
		const checkpointId = pair.editFromCheckpointId;
		console.log("[ChatSession.editMessage] pairId:", pairId, "checkpointId:", checkpointId, "pair:", pair);
		if (!checkpointId) {
			throw new Error(
				"Cannot edit: no checkpoint available for this message. Checkpoint mapping may not be loaded.",
			);
		}

		// Update the user message content in the UI
		pair.userMessage.content = newContent;
		pair.userMessage.attachments = undefined; // Clear attachments on edit

		// Reset assistant state for the new response
		pair.assistantMessage.state = AssistantState.idle;
		pair.assistantMessage.content = "";
		pair.assistantMessage.toolCalls = undefined;

		// Stream the edited response
		await this.processEditReply(pairId, newContent, checkpointId);
	}

	/**
	 * Regenerate the AI response for a message without re-sending the user message.
	 * This creates a new branch from the checkpoint after the user message.
	 */
	async regenerateResponse(pairId: UUIDv7): Promise<void> {
		const pair = this.findPair(pairId);
		if (!pair) {
			throw new Error("Message pair not found");
		}

		// Get the checkpoint to fork from for regeneration
		const checkpointId = pair.regenerateFromCheckpointId;
		console.log("[ChatSession.regenerateResponse] pairId:", pairId, "checkpointId:", checkpointId, "pair:", pair);
		if (!checkpointId) {
			throw new Error(
				"Cannot regenerate: no checkpoint available for this message. Checkpoint mapping may not be loaded.",
			);
		}

		// Reset assistant state for the new response
		pair.assistantMessage.state = AssistantState.idle;
		pair.assistantMessage.content = "";
		pair.assistantMessage.toolCalls = undefined;

		// Stream the regenerated response
		await this.processRegenerateReply(pairId, checkpointId);
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

	/**
	 * Core streaming handler - processes any stream and updates the message pair.
	 */
	private async runStream(
		pairId: UUIDv7,
		getStream: (signal: AbortSignal) => AsyncIterable<AgentStreamChunk>,
		options?: { generateTitle?: string; reloadAfter?: boolean },
	) {
		const pair = this.findPair(pairId);
		if (!pair) return;

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		try {
			this.messageState = MessageState.answering;
			pair.assistantMessage.state = AssistantState.streaming;

			// Generate chat title in parallel if requested
			if (options?.generateTitle && this.messages.length === 1 && getData().isGeneratingChatTitle) {
				const plugin = getPlugin();
				plugin.agentManager
					.generateThreadTitleFromUserMessage(String(this.id), options.generateTitle)
					.catch((err) => {
						console.warn("[ChatSession] Failed to generate chat title:", err);
					});
			}

			await this.consumeStream(pair.assistantMessage, getStream(signal));
			pair.assistantMessage.state = AssistantState.success;

			if (options?.reloadAfter && this.onNeedReload) {
				await this.onNeedReload();
			}
		} catch (err) {
			pair.assistantMessage.state = this.cancelled ? AssistantState.cancelled : AssistantState.error;
		} finally {
			this.abortController = null;
			this.cancelled = false;
			this.messageState = MessageState.idle;
		}
	}

	/** Process assistant reply for a normal query (new message in thread). */
	private async processAssistantReply(pairId: UUIDv7, userContent: string) {
		const plugin = getPlugin();
		await this.runStream(
			pairId,
			(signal) =>
				plugin.agentManager.streamQuery(
					userContent,
					String(this.id),
					signal,
				) as AsyncIterable<AgentStreamChunk>,
			{ generateTitle: userContent, reloadAfter: true },
		);
	}

	/** Process assistant reply for an edit (forks from checkpoint with new user message). */
	private async processEditReply(pairId: UUIDv7, userContent: string, checkpointId: string) {
		const plugin = getPlugin();
		await this.runStream(
			pairId,
			(signal) =>
				plugin.agentManager.editFromCheckpoint(
					userContent,
					String(this.id),
					checkpointId,
					signal,
				) as AsyncIterable<AgentStreamChunk>,
			{ reloadAfter: true },
		);
	}

	/** Process assistant reply for regeneration (no new user message, continues from checkpoint). */
	private async processRegenerateReply(pairId: UUIDv7, checkpointId: string) {
		const plugin = getPlugin();
		await this.runStream(
			pairId,
			(signal) =>
				plugin.agentManager.regenerateFromCheckpoint(
					String(this.id),
					checkpointId,
					signal,
				) as AsyncIterable<AgentStreamChunk>,
			{ reloadAfter: true },
		);
	}

	/**
	 * Shared stream consumption logic for both normal queries and regeneration.
	 */
	private async consumeStream(assistantMsg: AssistantMessage, stream: AsyncIterable<AgentStreamChunk>) {
		for await (const chunk of stream) {
			if (chunk.type === "token") {
				this.appendToken(assistantMsg, chunk.token);
				continue;
			}

			if (chunk.type === "tool_start") {
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
				if (assistantMsg.toolCalls) {
					const tc = assistantMsg.toolCalls.find((t) => t.id === chunk.toolCallId);
					if (tc) {
						tc.status = "completed";
						tc.output = chunk.output;
					} else {
						assistantMsg.toolCalls.push({
							id: chunk.toolCallId,
							name: chunk.toolName,
							input: {},
							status: "completed",
							output: chunk.output,
						});
					}
				} else {
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

			if (chunk.type === "result") {
				continue;
			}

			if (chunk.type === "checkpoint_message") {
				const checkpointAssistant = baseMessageToAssistantMessage(chunk.message);
				assistantMsg.content = checkpointAssistant.content;
				assistantMsg.toolCalls = checkpointAssistant.toolCalls;
				break;
			}
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

	async loadSession(file: TFile, targetCheckpointId?: string) {
		const id = this.deriveThreadId(file);
		if (!id) throw new Error("Invalid thread ID");

		// Get thread history and checkpoint data
		const history = await this.#agentManager.getThreadHistory(id);
		const checkpointHistory = await this.#agentManager.getCheckpointHistory(id);

		console.log("[Messenger.loadSession] threadId:", id, "checkpointHistory.length:", checkpointHistory.length);

		// Build checkpoint mapping for branching support
		const checkpointMapping =
			checkpointHistory.length > 0
				? buildCheckpointMessageMapping(checkpointHistory, targetCheckpointId)
				: undefined;

		console.log("[Messenger.loadSession] checkpointMapping:", checkpointMapping);

		// Create reload callback for this file
		const onNeedReload = async () => {
			await this.reloadSession();
		};

		// Cast to access lastError and errorCount properties
		const historyWithError = history as (ThreadHistory & { lastError?: ThreadError; errorCount?: number }) | null;

		this.session = new ChatSession(
			id,
			historyWithError?.messages || [],
			historyWithError?.errorCount || 0,
			checkpointMapping,
			onNeedReload,
		);
	}

	/** Reload the current session to update branch info after edit/regenerate */
	async reloadSession(): Promise<void> {
		if (!this.session) {
			throw new Error("No active session to reload");
		}

		const id = this.session.id;
		const history = await this.#agentManager.getThreadHistory(id);
		const checkpointHistory = await this.#agentManager.getCheckpointHistory(id);

		const checkpointMapping =
			checkpointHistory.length > 0 ? buildCheckpointMessageMapping(checkpointHistory) : undefined;

		const historyWithError = history as (ThreadHistory & { lastError?: ThreadError; errorCount?: number }) | null;

		// Replace the session with updated data
		this.session = new ChatSession(
			id,
			historyWithError?.messages || [],
			historyWithError?.errorCount || 0,
			checkpointMapping,
			async () => this.reloadSession(),
		);
	}

	/** Switch to a different branch by loading from a specific checkpoint */
	async switchToBranch(checkpointId: string): Promise<void> {
		// Need to get the thread ID and file from current session
		if (!this.session) {
			throw new Error("No active session");
		}

		const threadId = this.session.id;
		const messages = await this.#agentManager.getCheckpointMessages(threadId, checkpointId);
		const checkpointHistory = await this.#agentManager.getCheckpointHistory(threadId);

		const checkpointMapping =
			checkpointHistory.length > 0 ? buildCheckpointMessageMapping(checkpointHistory, checkpointId) : undefined;

		this.session = new ChatSession(
			threadId,
			messages,
			0, // Reset error count when switching branches
			checkpointMapping,
			async () => this.reloadSession(),
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
