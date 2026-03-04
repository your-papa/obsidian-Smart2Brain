import {
	type AIMessage,
	type BaseMessage,
	HumanMessage,
	type ToolMessage,
	isAIMessage,
	isHumanMessage,
	isToolMessage,
} from "@langchain/core/messages";
import { normalizePath, type TFile } from "obsidian";
import type { AgentStreamChunk, CheckpointHistoryItem, ThreadHistory } from "../agent/Agent";
import type { AgentManager } from "../agent/AgentManager";
import type { ChatModelConfig } from "../providers/index";
import type { ChatAttachment, ThreadError } from "../types/shared";
import { NEW_CHAT_NAME } from "../utils/threadId";
import { type UUIDv7, dateFromUUIDv7, genUUIDv7 } from "../utils/uuid7Validator";
import { getData } from "./dataStore.svelte";
import { getPlugin } from "./state.svelte";
import { Logger } from "../utils/logging";

// Re-export for backward compatibility
export type { ThreadError };

const CHECKPOINT_DEBUG = false;

function checkpointDebug(event: string, details: Record<string, unknown>): void {
	if (!CHECKPOINT_DEBUG) return;
	Logger.log(`[chatStore.checkpoint] ${event}`, details);
}

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
	preamble?: string;
}

export interface UserMessage {
	content: string;
	attachments?: ChatAttachment[];
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
	 * Checkpoint ID where the PREVIOUS AI message is the last message.
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
 * Canonical Checkpoint Graph Model
 * ---------------------------------------------------------------------------*/

export interface CheckpointNode {
	checkpointId: string;
	parentCheckpointId?: string;
	step: number;
	messages: BaseMessage[];
	children: string[];
	ts?: string;
}

export interface CheckpointGraphState {
	nodes: Map<string, CheckpointNode>;
	rootCheckpointId?: string;
	activeCheckpointId?: string;
	lastPersistedActiveCheckpointId?: string;
}

interface ActiveCheckpointResolution {
	checkpointId?: string;
	source: "session" | "persisted" | "explicit" | "fallback" | "none";
}

interface PostRunResolution {
	newIds: string[];
	parentCheckpointId?: string;
	newActiveCheckpointId?: string;
}

interface CheckpointSortShape {
	checkpointId: string;
	step: number;
	ts?: string;
}

function parseCheckpointTs(ts?: string): number {
	if (!ts) return 0;
	const value = Date.parse(ts);
	return Number.isFinite(value) ? value : 0;
}

function comparePathOrder(a: CheckpointSortShape, b: CheckpointSortShape): number {
	if (a.step !== b.step) return a.step - b.step;
	const tsA = parseCheckpointTs(a.ts);
	const tsB = parseCheckpointTs(b.ts);
	if (tsA !== tsB) return tsA - tsB;
	return a.checkpointId.localeCompare(b.checkpointId);
}

function compareNewest(a: CheckpointSortShape, b: CheckpointSortShape): number {
	const tsA = parseCheckpointTs(a.ts);
	const tsB = parseCheckpointTs(b.ts);
	if (tsA !== tsB) return tsB - tsA;
	if (a.step !== b.step) return b.step - a.step;
	return a.checkpointId.localeCompare(b.checkpointId);
}

function getPathToRoot(graph: CheckpointGraphState, checkpointId: string): string[] {
	const path: string[] = [];
	const visited = new Set<string>();
	let current: string | undefined = checkpointId;

	while (current && !visited.has(current)) {
		path.push(current);
		visited.add(current);
		current = graph.nodes.get(current)?.parentCheckpointId;
	}

	return path.reverse();
}

function isCheckpointValid(graph: CheckpointGraphState, checkpointId?: string): checkpointId is string {
	return !!checkpointId && graph.nodes.has(checkpointId);
}

function getCheckpointDepth(graph: CheckpointGraphState, checkpointId: string): number {
	let depth = 0;
	let current: string | undefined = checkpointId;
	const visited = new Set<string>();

	while (current && !visited.has(current)) {
		visited.add(current);
		current = graph.nodes.get(current)?.parentCheckpointId;
		if (current) depth += 1;
	}

	return depth;
}

function isDescendantOf(graph: CheckpointGraphState, checkpointId: string, ancestorId: string): boolean {
	let current: string | undefined = checkpointId;
	const visited = new Set<string>();

	while (current && !visited.has(current)) {
		if (current === ancestorId) return true;
		visited.add(current);
		current = graph.nodes.get(current)?.parentCheckpointId;
	}

	return false;
}

function getAllDescendants(graph: CheckpointGraphState, startId: string): string[] {
	const result: string[] = [];
	const queue: string[] = [startId];
	const visited = new Set<string>();

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current)) continue;
		visited.add(current);
		result.push(current);
		const node = graph.nodes.get(current);
		if (!node) continue;
		queue.push(...node.children);
	}

	return result;
}

function findFirstHumanInBranch(graph: CheckpointGraphState, startId: string): string | undefined {
	const queue: string[] = [startId];
	const visited = new Set<string>();

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current)) continue;
		visited.add(current);

		const node = graph.nodes.get(current);
		if (!node) continue;
		const lastMessage = node.messages.at(-1);
		if (lastMessage && isHumanMessage(lastMessage)) {
			return current;
		}

		const sortedChildren = [...node.children].sort((a, b) => a.localeCompare(b));
		queue.push(...sortedChildren);
	}

	return undefined;
}

function findDeterministicTipFrom(graph: CheckpointGraphState, startId: string): string {
	let current = startId;
	const visited = new Set<string>();

	while (true) {
		if (visited.has(current)) {
			checkpointDebug("cycle.detected.tip_traversal", { checkpointId: current, startId });
			return current;
		}
		visited.add(current);

		const node = graph.nodes.get(current);
		if (!node || node.children.length === 0) {
			return current;
		}

		const bestChild = [...node.children]
			.filter((id) => !visited.has(id))
			.map((id) => graph.nodes.get(id))
			.filter((child): child is CheckpointNode => !!child)
			.sort(compareNewest)
			.at(0);

		if (!bestChild) {
			return current;
		}

		current = bestChild.checkpointId;
	}
}

export function buildCheckpointGraph(checkpoints: CheckpointHistoryItem[]): CheckpointGraphState {
	const nodes = new Map<string, CheckpointNode>();

	for (const checkpoint of checkpoints) {
		nodes.set(checkpoint.checkpointId, {
			checkpointId: checkpoint.checkpointId,
			parentCheckpointId: checkpoint.parentCheckpointId,
			step: checkpoint.step,
			messages: checkpoint.messages,
			children: [],
			ts: checkpoint.ts,
		});
	}

	// Some stored histories can contain multiple first-turn checkpoints with no parent.
	// Treat them as siblings branching from a single canonical root to keep lineage connected.
	const detachedRoots = [...nodes.values()].filter((node) => !node.parentCheckpointId);
	const canonicalRoot = [...detachedRoots].sort(comparePathOrder)[0];
	if (canonicalRoot && detachedRoots.length > 1) {
		for (const node of detachedRoots) {
			if (node.checkpointId === canonicalRoot.checkpointId) continue;
			node.parentCheckpointId = canonicalRoot.checkpointId;
		}
	}

	for (const node of nodes.values()) {
		const parentId = node.parentCheckpointId;
		if (!parentId) continue;
		const parent = nodes.get(parentId);
		if (!parent) continue;
		parent.children.push(node.checkpointId);
	}

	for (const node of nodes.values()) {
		node.children.sort((a, b) => a.localeCompare(b));
	}

	let rootCheckpointId: string | undefined;
	const rootCandidates = [...nodes.values()].filter(
		(node) => !node.parentCheckpointId || !nodes.has(node.parentCheckpointId),
	);

	if (rootCandidates.length > 0) {
		rootCheckpointId = [...rootCandidates].sort(comparePathOrder)[0]?.checkpointId;
	} else if (nodes.size > 0) {
		rootCheckpointId = [...nodes.values()].sort(comparePathOrder)[0]?.checkpointId;
	}

	return {
		nodes,
		rootCheckpointId,
	};
}

function resolveFallbackCheckpoint(graph: CheckpointGraphState, fromCheckpointId?: string): string | undefined {
	if (graph.nodes.size === 0) return undefined;

	if (fromCheckpointId && graph.nodes.has(fromCheckpointId)) {
		return findDeterministicTipFrom(graph, fromCheckpointId);
	}

	if (graph.rootCheckpointId && graph.nodes.has(graph.rootCheckpointId)) {
		return findDeterministicTipFrom(graph, graph.rootCheckpointId);
	}

	const first = [...graph.nodes.values()].sort(comparePathOrder)[0];
	return first?.checkpointId;
}

function resolveActiveCheckpointId(
	graph: CheckpointGraphState,
	options: {
		sessionActiveCheckpointId?: string;
		persistedCheckpointId?: string;
		explicitTargetCheckpointId?: string;
	},
): ActiveCheckpointResolution {
	if (graph.nodes.size === 0) {
		return { source: "none" };
	}

	const { sessionActiveCheckpointId, persistedCheckpointId, explicitTargetCheckpointId } = options;

	if (isCheckpointValid(graph, sessionActiveCheckpointId)) {
		return { checkpointId: sessionActiveCheckpointId, source: "session" };
	}

	if (isCheckpointValid(graph, persistedCheckpointId)) {
		return { checkpointId: persistedCheckpointId, source: "persisted" };
	}

	if (isCheckpointValid(graph, explicitTargetCheckpointId)) {
		return { checkpointId: explicitTargetCheckpointId, source: "explicit" };
	}

	const fallbackSeed = sessionActiveCheckpointId ?? persistedCheckpointId ?? explicitTargetCheckpointId;
	const fallbackCheckpointId = resolveFallbackCheckpoint(graph, fallbackSeed);
	return {
		checkpointId: fallbackCheckpointId,
		source: fallbackCheckpointId ? "fallback" : "none",
	};
}

function resolvePostRunCheckpointSelection(
	graph: CheckpointGraphState,
	beforeSet: Set<string>,
	parentCheckpointId?: string,
): PostRunResolution {
	const newIds = [...graph.nodes.keys()].filter((id) => !beforeSet.has(id));

	const eligible =
		parentCheckpointId && graph.nodes.has(parentCheckpointId)
			? newIds.filter((id) => isDescendantOf(graph, id, parentCheckpointId))
			: newIds;

	if (eligible.length === 0) {
		return {
			newIds,
			parentCheckpointId,
		};
	}

	const sorted = [...eligible]
		.map((id) => graph.nodes.get(id))
		.filter((node): node is CheckpointNode => !!node)
		.sort((a, b) => {
			const depthDiff = getCheckpointDepth(graph, b.checkpointId) - getCheckpointDepth(graph, a.checkpointId);
			if (depthDiff !== 0) return depthDiff;
			const tsDiff = parseCheckpointTs(b.ts) - parseCheckpointTs(a.ts);
			if (tsDiff !== 0) return tsDiff;
			return a.checkpointId.localeCompare(b.checkpointId);
		});

	return {
		newIds,
		parentCheckpointId,
		newActiveCheckpointId: sorted[0]?.checkpointId,
	};
}

/* -----------------------------------------------------------------------------
 * Checkpoint Mapping for Branching (Derived Utility)
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

function buildDerivedBranchInfo(graph: CheckpointGraphState): {
	branchInfoMap: Map<string, BranchInfo>;
	editForkEntryCheckpoints: Set<string>;
} {
	const branchInfoMap = new Map<string, BranchInfo>();
	const editForkEntryCheckpoints = new Set<string>();

	const forkPoints = [...graph.nodes.values()].filter((node) => node.children.length > 1).sort(comparePathOrder);

	for (const forkPoint of forkPoints) {
		const sortedChildren = [...forkPoint.children].sort((a, b) => a.localeCompare(b));
		const branchTips = sortedChildren.map((childId) => findDeterministicTipFrom(graph, childId));
		const forkLastMessage = forkPoint.messages.at(-1);
		const isEditFork = !forkLastMessage || !isHumanMessage(forkLastMessage);

		for (let index = 0; index < sortedChildren.length; index++) {
			const childId = sortedChildren[index];
			const branchInfo: BranchInfo = {
				currentIndex: index + 1,
				totalBranches: sortedChildren.length,
				siblingCheckpointIds: branchTips,
				forkPointId: forkPoint.checkpointId,
				forkChildId: childId,
			};

			if (isEditFork) {
				const firstHumanCheckpointId = findFirstHumanInBranch(graph, childId);
				if (firstHumanCheckpointId) {
					editForkEntryCheckpoints.add(firstHumanCheckpointId);
				}
			}

			const descendants = getAllDescendants(graph, childId);
			for (const checkpointId of descendants) {
				branchInfoMap.set(checkpointId, branchInfo);
			}
		}
	}

	return { branchInfoMap, editForkEntryCheckpoints };
}

function buildCheckpointMessageMappingFromGraph(
	graph: CheckpointGraphState,
	activeCheckpointId?: string,
): CheckpointMessageMapping {
	const humanLastCheckpoints = new Map<string, string>();
	const aiBeforeHumanCheckpoints = new Map<string, string>();
	const aiAfterHumanCheckpoints = new Map<string, string>();

	const { branchInfoMap, editForkEntryCheckpoints } = buildDerivedBranchInfo(graph);

	if (!activeCheckpointId || !graph.nodes.has(activeCheckpointId)) {
		return {
			humanLastCheckpoints,
			aiBeforeHumanCheckpoints,
			aiAfterHumanCheckpoints,
			branchInfoMap,
			editForkEntryCheckpoints,
			rootCheckpointId: graph.rootCheckpointId,
		};
	}

	const activePath = getPathToRoot(graph, activeCheckpointId)
		.map((checkpointId) => graph.nodes.get(checkpointId))
		.filter((node): node is CheckpointNode => !!node)
		.sort(comparePathOrder);

	let lastAiCheckpointId: string | undefined;
	let pendingHumanMessageId: string | undefined;

	for (const node of activePath) {
		const lastMessage = node.messages.at(-1);

		if (!lastMessage || isAIMessage(lastMessage)) {
			lastAiCheckpointId = node.checkpointId;

			if (pendingHumanMessageId && lastMessage && isAIMessage(lastMessage)) {
				aiAfterHumanCheckpoints.set(pendingHumanMessageId, node.checkpointId);
				pendingHumanMessageId = undefined;
			}
			continue;
		}

		if (!isHumanMessage(lastMessage)) {
			continue;
		}

		const humanMessageId = lastMessage.id;
		if (!humanMessageId) {
			continue;
		}

		humanLastCheckpoints.set(humanMessageId, node.checkpointId);
		if (lastAiCheckpointId) {
			aiBeforeHumanCheckpoints.set(humanMessageId, lastAiCheckpointId);
		}
		pendingHumanMessageId = humanMessageId;
	}

	return {
		humanLastCheckpoints,
		aiBeforeHumanCheckpoints,
		aiAfterHumanCheckpoints,
		branchInfoMap,
		editForkEntryCheckpoints,
		rootCheckpointId: graph.rootCheckpointId,
	};
}

export function deriveMessagePairsFromActiveCheckpoint(
	graph: CheckpointGraphState,
	activeCheckpointId: string | undefined,
	errorCount = 0,
	bootstrapMessages: BaseMessage[] = [],
): MessagePair[] {
	if (!activeCheckpointId || !graph.nodes.has(activeCheckpointId)) {
		return baseMessagesToMessagePairs(bootstrapMessages, errorCount);
	}

	const activeNode = graph.nodes.get(activeCheckpointId);
	if (!activeNode) {
		return baseMessagesToMessagePairs(bootstrapMessages, errorCount);
	}

	const checkpointMapping = buildCheckpointMessageMappingFromGraph(graph, activeCheckpointId);
	return baseMessagesToMessagePairs(activeNode.messages, errorCount, checkpointMapping);
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

function attachPreambleToFirstToolCall(toolCalls: ToolCallState[] | undefined, preamble: string): void {
	if (!toolCalls || toolCalls.length === 0) return;
	const trimmed = preamble.trim();
	if (!trimmed) return;

	const firstTool = toolCalls[0];
	firstTool.preamble = firstTool.preamble
		? `${firstTool.preamble.trimEnd()}\n\n${trimmed}`
		: trimmed;
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

	// Merge multiple assistant messages
	let finalContent = "";
	const allToolCalls: ToolCallState[] = [];

	for (const msg of assistantMessages) {
		const converted = baseMessageToAssistantMessage(msg, toolOutputs);

		if (converted.toolCalls?.length && converted.content.trim()) {
			attachPreambleToFirstToolCall(converted.toolCalls, converted.content);
			converted.content = "";
		}

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
			const attachments = (msg.additional_kwargs?.attachments as ChatAttachment[] | undefined) ?? undefined;
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
					editFromCheckpointId = checkpointMapping.rootCheckpointId;
				}
			}

			messagePairs.push({
				id: pairId,
				userMessage: { content: userContent, attachments },
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
 * ChatSession
 *  - Canonical source: checkpoint graph + one active checkpoint ID
 *  - MessagePair[] is always derived from the active checkpoint branch
 * ---------------------------------------------------------------------------*/

interface ChatSessionOptions {
	graphState: CheckpointGraphState;
	errorCount: number;
	bootstrapMessages?: BaseMessage[];
	onNeedReload?: () => Promise<void>;
}

export class ChatSession {
	id: string;
	messages: MessagePair[] = $state<MessagePair[]>([]);

	// Streaming / lifecycle
	private abortController: AbortController | null = null;
	private cancelled = false;

	// Reactive UI state
	messageState = $state<MessageState>(MessageState.idle);

	private graphState: CheckpointGraphState;
	private errorCount: number;
	private bootstrapMessages: BaseMessage[];
	private onNeedReload: (() => Promise<void>) | undefined;

	constructor(id: string, options: ChatSessionOptions) {
		this.id = id;
		this.graphState = options.graphState;
		this.errorCount = options.errorCount;
		this.bootstrapMessages = options.bootstrapMessages ?? [];
		this.onNeedReload = options.onNeedReload;
		this.rebuildMessagePairs();
	}

	/** Public snapshot (immutable-ish) */
	get snapshot(): ChatRecord {
		return {
			id: this.id,
			messages: this.messages.slice(),
		};
	}

	getActiveCheckpointId(): string | undefined {
		return this.graphState.activeCheckpointId;
	}

	setLastPersistedActiveCheckpointId(checkpointId?: string): void {
		this.graphState.lastPersistedActiveCheckpointId = checkpointId;
	}

	applyGraphState(graphState: CheckpointGraphState, errorCount: number, bootstrapMessages?: BaseMessage[]): void {
		this.graphState = graphState;
		this.errorCount = errorCount;
		if (bootstrapMessages) {
			this.bootstrapMessages = bootstrapMessages;
		}
		this.rebuildMessagePairs();
	}

	private rebuildMessagePairs(): void {
		this.messages = deriveMessagePairsFromActiveCheckpoint(
			this.graphState,
			this.graphState.activeCheckpointId,
			this.errorCount,
			this.bootstrapMessages,
		);
	}

	/** Find a message pair by id */
	private findPair(id: UUIDv7): MessagePair | undefined {
		return this.messages.find((m) => m.id === id);
	}

	private cloneGraphState(): CheckpointGraphState {
		const nodes = new Map<string, CheckpointNode>();
		for (const [checkpointId, node] of this.graphState.nodes.entries()) {
			nodes.set(checkpointId, {
				...node,
				children: [...node.children],
				messages: [...node.messages],
			});
		}
		return {
			nodes,
			rootCheckpointId: this.graphState.rootCheckpointId,
			activeCheckpointId: this.graphState.activeCheckpointId,
			lastPersistedActiveCheckpointId: this.graphState.lastPersistedActiveCheckpointId,
		};
	}

	private applyOptimisticFork(parentCheckpointId: string, messages: BaseMessage[]): MessagePair {
		const parentNode = this.graphState.nodes.get(parentCheckpointId);
		if (!parentNode) {
			throw new Error("Cannot create optimistic fork: parent checkpoint not found");
		}

		const optimisticCheckpointId = `optimistic-${genUUIDv7()}`;
		const nextGraph = this.cloneGraphState();

		const optimisticNode: CheckpointNode = {
			checkpointId: optimisticCheckpointId,
			parentCheckpointId,
			step: parentNode.step + 1,
			messages,
			children: [],
			ts: new Date().toISOString(),
		};

		nextGraph.nodes.set(optimisticCheckpointId, optimisticNode);
		const nextParent = nextGraph.nodes.get(parentCheckpointId);
		if (nextParent && !nextParent.children.includes(optimisticCheckpointId)) {
			nextParent.children.push(optimisticCheckpointId);
			nextParent.children.sort((a, b) => a.localeCompare(b));
		}
		nextGraph.activeCheckpointId = optimisticCheckpointId;

		this.applyGraphState(nextGraph, this.errorCount);
		const optimisticPair = this.messages.at(-1);
		if (!optimisticPair) {
			throw new Error("Optimistic fork failed: no message pair derived");
		}
		return optimisticPair;
	}

	/**
	 * Send a user message:
	 *  - Create MessagePair with idle assistant
	 *  - Kick off streaming process
	 */
	async sendMessage(content: string, attachments?: ChatAttachment[]): Promise<UUIDv7> {
		const defaultChatName = NEW_CHAT_NAME;
		if (this.messages.length === 0 && this.id === defaultChatName) {
			const promotedThreadId = await getPlugin().agentManager.promoteDraftThread(this.id);
			if (promotedThreadId) {
				this.id = promotedThreadId;
			}
		}
		const pairId = genUUIDv7();

		// Relocate any attachments saved under the temporary _pending directory
		// to the real thread-specific directory now that we have a session ID.
		if (attachments?.length) {
			await this.relocatePendingAttachments(attachments);
		}

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

		// Stream assistant reply (pass attachments so they reach the agent)
		void this.processAssistantReply(pairId, content, attachments);

		return pairId;
	}

	/**
	 * Moves attachments from the temporary `_pending` directory to the real
	 * thread-specific directory. Mutates the attachment objects in place so
	 * that their vaultPath references stay correct for the rest of the pipeline.
	 */
	private async relocatePendingAttachments(attachments: ChatAttachment[]): Promise<void> {
		const chatFolder = getData().targetFolder;
		const pendingPrefix = normalizePath(`${chatFolder}/attachments/_pending/`);
		const defaultChatName = NEW_CHAT_NAME;
		const legacyDraftPrefix = normalizePath(`${chatFolder}/attachments/${defaultChatName}/`);
		const pending = attachments.filter(
			(a) => a.vaultPath.startsWith(pendingPrefix) || a.vaultPath.startsWith(legacyDraftPrefix),
		);
		if (pending.length === 0) return;

		const adapter = getPlugin().app.vault.adapter;
		let destDir = normalizePath(`${chatFolder}/attachments/${this.id}`);
		try {
			destDir = normalizePath(await getPlugin().agentManager.getAttachmentDirectory(this.id));
		} catch (e) {
			Logger.warn("Failed to resolve title-based attachment directory, falling back to thread id directory", e);
		}

		try {
			if (!(await adapter.exists(destDir))) {
				await adapter.mkdir(destDir);
			}
		} catch (e) {
			Logger.warn("Failed to create attachment destination directory, proceeding with _pending paths", e);
		}

		for (const att of pending) {
			try {
				const fileName = att.vaultPath.split("/").pop();
				if (!fileName) continue;
				const newPath = normalizePath(`${destDir}/${fileName}`);
				const data = await adapter.readBinary(att.vaultPath);
				await adapter.writeBinary(newPath, data);
				await adapter.remove(att.vaultPath).catch(() => { });
				att.vaultPath = newPath;
			} catch (e) {
				Logger.warn(`Failed to relocate attachment ${att.name}`, e);
			}
		}

		// Best-effort cleanup of temporary draft directories
		const pendingDir = normalizePath(`${chatFolder}/attachments/_pending`);
		adapter.rmdir(pendingDir, false).catch(() => { });
		const legacyDraftDir = normalizePath(`${chatFolder}/attachments/${defaultChatName}`);
		if (legacyDraftDir !== pendingDir) {
			adapter.rmdir(legacyDraftDir, false).catch(() => { });
		}
	}

	/** Abort current streaming (if any) */
	stopStreaming(): void {
		if (!this.abortController) {
			throw new Error("No active stream to abort");
		}
		this.cancelled = true;
		this.abortController.abort();
	}

	private resolveEditAttachments(pair: MessagePair): ChatAttachment[] | undefined {
		if (pair.userMessage.attachments?.length) {
			return pair.userMessage.attachments;
		}

		const checkpointId = pair.regenerateFromCheckpointId;
		if (!checkpointId) {
			return undefined;
		}

		const node = this.graphState.nodes.get(checkpointId);
		const lastMessage = node?.messages.at(-1);
		if (!lastMessage || !isHumanMessage(lastMessage)) {
			return undefined;
		}

		const recovered = (lastMessage.additional_kwargs?.attachments as ChatAttachment[] | undefined)?.filter(
			(att) => Boolean(att?.name && att?.mimeType && att?.vaultPath),
		);

		return recovered?.length ? recovered : undefined;
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

		const attachments = this.resolveEditAttachments(pair);

		// Get the checkpoint to fork from for editing
		const checkpointId = pair.editFromCheckpointId;
		if (!checkpointId) {
			throw new Error(
				"Cannot edit: no checkpoint available for this message. Checkpoint graph may not be loaded.",
			);
		}

		const parentMessages = this.graphState.nodes.get(checkpointId)?.messages ?? [];
		const optimisticMessages = [
			...parentMessages,
			new HumanMessage({
				content: newContent,
				id: genUUIDv7(),
				additional_kwargs: attachments?.length ? { attachments } : undefined,
			}),
		];
		const optimisticPair = this.applyOptimisticFork(checkpointId, optimisticMessages);
		optimisticPair.userMessage.content = newContent;
		optimisticPair.userMessage.attachments = attachments;
		optimisticPair.assistantMessage.state = AssistantState.idle;
		optimisticPair.assistantMessage.content = "";
		optimisticPair.assistantMessage.toolCalls = undefined;
		optimisticPair.userBranchInfo = undefined;
		optimisticPair.assistantBranchInfo = undefined;
		optimisticPair.regenerateFromCheckpointId = undefined;

		// Stream the edited response
		await this.processEditReply(optimisticPair.id, newContent, checkpointId, attachments);
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
		if (!checkpointId) {
			throw new Error(
				"Cannot regenerate: no checkpoint available for this message. Checkpoint graph may not be loaded.",
			);
		}

		const parentMessages = this.graphState.nodes.get(checkpointId)?.messages ?? [];
		const optimisticPair = this.applyOptimisticFork(checkpointId, [...parentMessages]);
		optimisticPair.assistantMessage.state = AssistantState.idle;
		optimisticPair.assistantMessage.content = "";
		optimisticPair.assistantMessage.toolCalls = undefined;
		optimisticPair.assistantBranchInfo = undefined;

		// Stream the regenerated response
		await this.processRegenerateReply(optimisticPair.id, checkpointId);
	}

	/* -----------------------------------------------------------------------
	 * Streaming logic
	 * ---------------------------------------------------------------------*/

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

	private async persistLastViewedCheckpoint(checkpointId?: string): Promise<void> {
		if (!checkpointId) return;
		await getPlugin().agentManager.setLastViewedCheckpoint(this.id, checkpointId);
		this.graphState.lastPersistedActiveCheckpointId = checkpointId;
	}

	private async syncGraphAfterRun(parentCheckpointId: string | undefined, beforeSet: Set<string>): Promise<void> {
		const agentManager = getPlugin().agentManager;
		const checkpointHistory = await agentManager.getCheckpointHistory(this.id);
		const nextGraph = buildCheckpointGraph(checkpointHistory);
		nextGraph.lastPersistedActiveCheckpointId = this.graphState.lastPersistedActiveCheckpointId;

		const postRunResolution = resolvePostRunCheckpointSelection(nextGraph, beforeSet, parentCheckpointId);
		let resolvedActiveCheckpointId = postRunResolution.newActiveCheckpointId;

		if (!resolvedActiveCheckpointId) {
			const fallbackResolution = resolveActiveCheckpointId(nextGraph, {
				sessionActiveCheckpointId: this.graphState.activeCheckpointId,
				persistedCheckpointId: this.graphState.lastPersistedActiveCheckpointId,
			});
			resolvedActiveCheckpointId = fallbackResolution.checkpointId;
		}

		nextGraph.activeCheckpointId = resolvedActiveCheckpointId;

		checkpointDebug("post_run_selection", {
			parentCheckpointId,
			beforeCount: beforeSet.size,
			newIds: postRunResolution.newIds,
			newActiveCheckpointId: postRunResolution.newActiveCheckpointId,
			resolvedActiveCheckpointId,
		});

		this.applyGraphState(nextGraph, this.errorCount);
		await this.persistLastViewedCheckpoint(resolvedActiveCheckpointId);
	}

	/**
	 * Core streaming handler - processes any stream and updates the message pair.
	 */
	private async runStream(
		pairId: UUIDv7,
		getStream: (signal: AbortSignal) => AsyncIterable<AgentStreamChunk>,
		options: {
			generateTitle?: string;
			reloadAfter?: boolean;
			parentCheckpointId?: string;
			beforeCheckpointIds: Set<string>;
		},
	) {
		const pair = this.findPair(pairId);
		if (!pair) return;

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		try {
			this.messageState = MessageState.answering;
			pair.assistantMessage.state = AssistantState.streaming;

			// Generate chat title in parallel for the first user message
			if (options.generateTitle && this.messages.length === 1) {
				const plugin = getPlugin();
				plugin.agentManager
					.generateThreadTitleFromUserMessage(String(this.id), options.generateTitle)
					.catch((err) => {
						Logger.warn("[ChatSession] Failed to generate chat title:", err);
					});
			}

			await this.consumeStream(pair.assistantMessage, getStream(signal));
			pair.assistantMessage.state = AssistantState.success;

			await this.syncGraphAfterRun(options.parentCheckpointId, options.beforeCheckpointIds);

			if (options.reloadAfter && this.onNeedReload) {
				await this.onNeedReload();
			}
		} catch (_err) {
			pair.assistantMessage.state = this.cancelled ? AssistantState.cancelled : AssistantState.error;
		} finally {
			this.abortController = null;
			this.cancelled = false;
			this.messageState = MessageState.idle;
		}
	}

	/** Process assistant reply for a normal query (new message in thread). */
	private async processAssistantReply(pairId: UUIDv7, userContent: string, attachments?: ChatAttachment[]) {
		const plugin = getPlugin();
		const beforeCheckpointIds = new Set(this.graphState.nodes.keys());
		const parentCheckpointId = this.graphState.activeCheckpointId ?? this.graphState.rootCheckpointId;

		checkpointDebug("send.parent", {
			threadId: this.id,
			parentCheckpointId,
			activeCheckpointId: this.graphState.activeCheckpointId,
		});

		await this.runStream(
			pairId,
			(signal) =>
				plugin.agentManager.streamQuery(
					userContent,
					String(this.id),
					this.graphState.activeCheckpointId,
					signal,
					attachments,
				) as AsyncIterable<AgentStreamChunk>,
			{ generateTitle: userContent, reloadAfter: true, parentCheckpointId, beforeCheckpointIds },
		);
	}

	/** Process assistant reply for an edit (forks from checkpoint with new user message). */
	private async processEditReply(
		pairId: UUIDv7,
		userContent: string,
		checkpointId: string,
		attachments?: ChatAttachment[],
	) {
		const plugin = getPlugin();
		const beforeCheckpointIds = new Set(this.graphState.nodes.keys());

		checkpointDebug("edit.parent", {
			threadId: this.id,
			parentCheckpointId: checkpointId,
		});

		await this.runStream(
			pairId,
			(signal) =>
				plugin.agentManager.editFromCheckpoint(
					userContent,
					String(this.id),
					checkpointId,
					signal,
					attachments,
				) as AsyncIterable<AgentStreamChunk>,
			{ reloadAfter: true, parentCheckpointId: checkpointId, beforeCheckpointIds },
		);
	}

	/** Process assistant reply for regeneration (no new user message, continues from checkpoint). */
	private async processRegenerateReply(pairId: UUIDv7, checkpointId: string) {
		const plugin = getPlugin();
		const beforeCheckpointIds = new Set(this.graphState.nodes.keys());

		checkpointDebug("regenerate.parent", {
			threadId: this.id,
			parentCheckpointId: checkpointId,
		});

		await this.runStream(
			pairId,
			(signal) =>
				plugin.agentManager.regenerateFromCheckpoint(
					String(this.id),
					checkpointId,
					signal,
				) as AsyncIterable<AgentStreamChunk>,
			{ reloadAfter: true, parentCheckpointId: checkpointId, beforeCheckpointIds },
		);
	}

	/**
	 * Shared stream consumption logic for both normal queries and regeneration.
	 */
	private async consumeStream(assistantMsg: AssistantMessage, stream: AsyncIterable<AgentStreamChunk>) {
		let tokenBuffer = "";
		let hasSeenToolCall = false;

		for await (const chunk of stream) {
			if (chunk.type === "token") {
				if (!chunk.token) continue;
				tokenBuffer += chunk.token;
				assistantMsg.content = hasSeenToolCall ? tokenBuffer.trimStart() : tokenBuffer;
				continue;
			}

			if (chunk.type === "tool_start") {
				hasSeenToolCall = true;
				const preamble = tokenBuffer;
				tokenBuffer = "";
				assistantMsg.content = "";

				if (!assistantMsg.toolCalls) assistantMsg.toolCalls = [];
				assistantMsg.toolCalls.push({
					id: chunk.toolCallId,
					name: chunk.toolName,
					input: this.normalizeToolInput(chunk.input),
					status: "running",
					preamble: preamble.trim() || undefined,
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
				assistantMsg.content = hasSeenToolCall ? tokenBuffer.trim() : tokenBuffer;
				continue;
			}

			if (chunk.type === "checkpoint_message") {
				const checkpointAssistant = baseMessageToAssistantMessage(chunk.message);
				if (checkpointAssistant.toolCalls?.length && checkpointAssistant.content.trim()) {
					attachPreambleToFirstToolCall(checkpointAssistant.toolCalls, checkpointAssistant.content);
					checkpointAssistant.content = "";
				}
				assistantMsg.content = checkpointAssistant.content;
				assistantMsg.toolCalls = checkpointAssistant.toolCalls;
				break;
			}
		}

		if (!assistantMsg.content) {
			assistantMsg.content = hasSeenToolCall ? tokenBuffer.trim() : tokenBuffer;
		}
	}
}

/* -----------------------------------------------------------------------------
 * Messenger
 *  - Orchestrates sessions
 *  - Uses graph-first checkpoint loading/reloading/navigation
 * ---------------------------------------------------------------------------*/
export class Messenger {
	session: ChatSession | null = $state(null);
	#agentManager: AgentManager;

	constructor(agentManager: AgentManager) {
		this.#agentManager = agentManager;
	}

	private async deriveThreadId(file: TFile): Promise<string | null> {
		const defaultChatName = NEW_CHAT_NAME;
		if (file.basename === defaultChatName) {
			return defaultChatName;
		}

		try {
			const content = await getPlugin().app.vault.read(file);
			const parsed = JSON.parse(content) as { threadId?: unknown };
			if (typeof parsed.threadId === "string" && parsed.threadId.trim().length > 0) {
				return parsed.threadId;
			}
		} catch {
			// Fall back to legacy filename-based derivation below.
		}

		let threadId = file.basename;
		if (threadId.includes(" - ")) {
			const parts = threadId.split(" - ");
			const dateTimePart = parts[parts.length - 1];
			threadId = `Chat ${dateTimePart}`;
		}
		if (!threadId || threadId === NEW_CHAT_NAME) return null;
		return threadId;
	}

	private getLastViewedCheckpointId(history: ThreadHistory | null): string | undefined {
		const candidate = history?.metadata?.lastViewedCheckpointId;
		return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
	}

	private async persistLastViewedCheckpoint(threadId: string, checkpointId?: string): Promise<void> {
		if (!checkpointId) return;
		await this.#agentManager.setLastViewedCheckpoint(threadId, checkpointId);
		this.session?.setLastPersistedActiveCheckpointId(checkpointId);
	}

	/* ---------------- Chat Creation / Metadata ---------------- */

	async loadSession(file: TFile, targetCheckpointId?: string) {
		const id = await this.deriveThreadId(file);
		if (!id) throw new Error("Invalid thread ID");

		const [history, checkpointHistory] = await Promise.all([
			this.#agentManager.getThreadHistory(id),
			this.#agentManager.getCheckpointHistory(id),
		]);

		const savedCheckpointId = this.getLastViewedCheckpointId(history);
		const graph = buildCheckpointGraph(checkpointHistory);
		const resolution = resolveActiveCheckpointId(graph, {
			persistedCheckpointId: savedCheckpointId,
			explicitTargetCheckpointId: targetCheckpointId,
		});

		graph.activeCheckpointId = resolution.checkpointId;
		graph.lastPersistedActiveCheckpointId = savedCheckpointId;

		checkpointDebug("load.resolve", {
			threadId: id,
			source: resolution.source,
			resolvedCheckpointId: resolution.checkpointId,
			sessionCheckpointId: undefined,
			savedCheckpointId,
			targetCheckpointId,
		});

		const historyWithError = history as (ThreadHistory & { lastError?: ThreadError; errorCount?: number }) | null;
		const bootstrapMessages = historyWithError?.messages || [];

		this.session = new ChatSession(id, {
			graphState: graph,
			errorCount: historyWithError?.errorCount || 0,
			bootstrapMessages,
			onNeedReload: async () => this.reloadSession(),
		});

		await this.persistLastViewedCheckpoint(id, resolution.checkpointId);
	}

	/** Reload the current session while preserving valid in-memory active checkpoint precedence. */
	async reloadSession(targetCheckpointId?: string): Promise<void> {
		if (!this.session) {
			throw new Error("No active session to reload");
		}

		const id = this.session.id;
		const sessionCheckpointId = this.session.getActiveCheckpointId();

		const [history, checkpointHistory] = await Promise.all([
			this.#agentManager.getThreadHistory(id),
			this.#agentManager.getCheckpointHistory(id),
		]);

		const savedCheckpointId = this.getLastViewedCheckpointId(history);
		const graph = buildCheckpointGraph(checkpointHistory);
		const resolution = resolveActiveCheckpointId(graph, {
			sessionActiveCheckpointId: sessionCheckpointId,
			persistedCheckpointId: savedCheckpointId,
			explicitTargetCheckpointId: targetCheckpointId,
		});

		graph.activeCheckpointId = resolution.checkpointId;
		graph.lastPersistedActiveCheckpointId = savedCheckpointId;

		checkpointDebug("reload.resolve", {
			threadId: id,
			source: resolution.source,
			resolvedCheckpointId: resolution.checkpointId,
			sessionCheckpointId,
			savedCheckpointId,
			targetCheckpointId,
		});

		const historyWithError = history as (ThreadHistory & { lastError?: ThreadError; errorCount?: number }) | null;
		this.session.applyGraphState(graph, historyWithError?.errorCount || 0, historyWithError?.messages || []);

		await this.persistLastViewedCheckpoint(id, resolution.checkpointId);
	}

	/** Switch to a different branch by activating a specific checkpoint directly. */
	async switchToBranch(checkpointId: string): Promise<void> {
		if (!this.session) {
			throw new Error("No active session");
		}

		const threadId = this.session.id;
		const [history, checkpointHistory] = await Promise.all([
			this.#agentManager.getThreadHistory(threadId),
			this.#agentManager.getCheckpointHistory(threadId),
		]);

		const graph = buildCheckpointGraph(checkpointHistory);
		if (!graph.nodes.has(checkpointId)) {
			throw new Error("Cannot switch branch: checkpoint does not exist");
		}

		graph.activeCheckpointId = checkpointId;
		graph.lastPersistedActiveCheckpointId = this.getLastViewedCheckpointId(history);

		const historyWithError = history as (ThreadHistory & { lastError?: ThreadError; errorCount?: number }) | null;
		this.session.applyGraphState(graph, historyWithError?.errorCount || 0, historyWithError?.messages || []);

		await this.persistLastViewedCheckpoint(threadId, checkpointId);
	}

	/* ---------------- Sending Messages ---------------- */

	async sendMessage(content: string, attachments?: ChatAttachment[]): Promise<string> {
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
