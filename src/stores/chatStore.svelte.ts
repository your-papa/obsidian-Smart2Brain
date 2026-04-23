import {
	type AIMessage,
	type BaseMessage,
	HumanMessage,
	type ToolMessage,
	isAIMessage,
	isHumanMessage,
	isToolMessage,
} from "@langchain/core/messages";
import { type TFile } from "obsidian";
import type { AgentStreamChunk, CheckpointHistoryItem, ThreadHistory } from "../agent/Agent";
import type { AgentManager } from "../agent/AgentManager";
import type { ChatModelConfig } from "../providers/index";
import type { ChatAttachment, ThreadError } from "../types/shared";
import type { AgentConfig } from "../types/plugin";
import { getPendingChangesStore } from "./pendingChangesStore.svelte";
import { isDraftChatName } from "../utils/threadId";
import { formatVisibleNotesContext, type VisibleNoteRef } from "../hooks/useVisibleNotes.svelte";
import { formatSelectionContext, type SelectionRef } from "../hooks/useSelection.svelte";
import { type UUIDv7, genUUIDv7 } from "../utils/uuid7Validator";
import { DEFAULT_AGENT_ID, getData } from "./dataStore.svelte";
import { getPlugin } from "./state.svelte";
import { Logger } from "../utils/logging";
import { shouldSummarizeForEstimatedTokens } from "../agent/summarization";
import { estimateConversationBaseTokens, estimateLiveDraftTokens } from "../utils/tokenEstimator";
import { gunzipSync } from "node:zlib";

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

const HIDDEN_HUMAN_MESSAGE_SOURCES = new Set(["summarization", "manual_summarization"]);
type HiddenHumanSource = "summarization" | "manual_summarization";
const MANUAL_SUMMARIZATION_PROMPT =
	"Summarize older conversation history now to reduce context usage while preserving important facts, decisions, and user preferences. Do not call tools. Reply with exactly: Context compacted.";

function isHiddenHumanSource(source: unknown): source is HiddenHumanSource {
	return typeof source === "string" && HIDDEN_HUMAN_MESSAGE_SOURCES.has(source);
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

export type AssistantTimelineEventType = "preamble" | "tool_start" | "tool_end";

export interface AssistantTimelineEvent {
	id: string;
	type: AssistantTimelineEventType;
	toolCallId?: string;
	toolName?: string;
	content?: string;
	input?: Record<string, unknown>;
	output?: unknown;
	status?: ToolCallStatus;
	/** The id of the AI message that produced this event. Groups events from the same AI message. */
	aiMessageId?: string;
}

export interface UserMessage {
	content: string;
	attachments?: ChatAttachment[];
	visibleNotes?: VisibleNoteRef[];
	selection?: SelectionRef;
	graphNotes?: GraphNoteRef[];
	spaces?: string[];
}

/** Serializable reference to a note selected from the Smart Graph. */
export interface GraphNoteRef {
	path: string;
	basename: string;
}

export interface AssistantMessage {
	state: AssistantState;
	content: string;
	toolCalls?: ToolCallState[];
	assistantTimeline?: AssistantTimelineEvent[];
	nerd_stats?: {
		tokensPerSecond: number;
		retrievedDocsNum: number;
		chatModelConfig: ChatModelConfig;
	};
	errorCode?: string;
}

export interface TranscriptEvent {
	type: "summarization_marker";
	label: string;
	source: "summarization" | "manual_summarization";
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
	transcriptEvent?: TranscriptEvent;
	/** Epoch ms when this message pair was created (persisted via checkpoint ts) */
	createdAt?: number;
	/** The model used to generate the assistant response */
	model?: ChatModel;
	/** Generation metadata persisted with the assistant message */
	generation?: MessageGeneration;

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

export interface MessageGeneration {
	agentId?: string;
	agentName?: string;
	provider?: string;
	model?: string;
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

	/**
	 * LangChain HumanMessage ID -> checkpoint timestamp (ISO string).
	 * Used to derive a stable createdAt for each MessagePair.
	 */
	humanTimestamps: Map<string, string>;
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
	const humanTimestamps = new Map<string, string>();

	const { branchInfoMap, editForkEntryCheckpoints } = buildDerivedBranchInfo(graph);

	if (!activeCheckpointId || !graph.nodes.has(activeCheckpointId)) {
		return {
			humanLastCheckpoints,
			aiBeforeHumanCheckpoints,
			aiAfterHumanCheckpoints,
			branchInfoMap,
			editForkEntryCheckpoints,
			rootCheckpointId: graph.rootCheckpointId,
			humanTimestamps,
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
		if (node.ts) {
			humanTimestamps.set(humanMessageId, node.ts);
		}
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
		humanTimestamps,
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

/** Formats graph-selected notes into a context block for the agent. */
export function formatGraphNotesContext(notes: GraphNoteRef[]): string {
	if (notes.length === 0) return "";
	const links = notes.map((n) => `- [[${n.path.replace(/\.md$/, "")}]]`);
	return `[Graph-selected notes]\n${links.join("\n")}`;
}

/** Formats active space labels into a context block for the agent. */
export function formatSpaceContext(spaces: string[]): string {
	if (spaces.length === 0) return "";
	return `[Active spaces: ${spaces.join(", ")}]`;
}

/**
 * Strips the augmented context suffix (visible notes + selection + graph notes) from a message.
 * Reconstructs the exact suffix that was appended by augmentWithVisibleNotes()
 * and removes it by exact string match from the end. This is safe even when user
 * content or selected text contains bracket patterns like "[Selected text from".
 */
function stripAugmentedSuffix(
	content: string,
	visibleNotes?: VisibleNoteRef[],
	selection?: SelectionRef,
	graphNotes?: GraphNoteRef[],
	spaces?: string[],
): string {
	// Reconstruct the exact suffix in the same order it was appended
	let suffix = "";
	if (visibleNotes?.length) {
		const ctx = formatVisibleNotesContext(visibleNotes);
		if (ctx) suffix += `\n\n${ctx}`;
	}
	if (selection) {
		suffix += `\n\n${formatSelectionContext(selection)}`;
	}
	if (graphNotes?.length) {
		const ctx = formatGraphNotesContext(graphNotes);
		if (ctx) suffix += `\n\n${ctx}`;
	}
	if (spaces?.length) {
		const ctx = formatSpaceContext(spaces);
		if (ctx) suffix += `\n\n${ctx}`;
	}
	if (suffix && content.endsWith(suffix)) {
		return content.slice(0, -suffix.length);
	}
	return content;
}

/**
 * Parses tool call arguments into a normalized object format.
 * NOTE: LangChain envelope unwrapping (e.g. single-key `{ input: … }`) is handled
 * upstream by Agent.normalizeStreamToolInput — this function only coerces types.
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

function readGenerationField(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractGenerationFromMetadata(rawMetadata: unknown): MessageGeneration | undefined {
	if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) {
		return undefined;
	}
	const metadata = rawMetadata as Record<string, unknown>;
	const generation: MessageGeneration = {
		agentId: readGenerationField(metadata, "agent_id"),
		agentName: readGenerationField(metadata, "agent_name"),
		provider: readGenerationField(metadata, "model_provider"),
		model: readGenerationField(metadata, "model"),
	};
	if (!generation.agentId && !generation.agentName && !generation.provider && !generation.model) {
		return undefined;
	}
	return generation;
}

function extractGenerationFromAssistantMessage(msg: BaseMessage): MessageGeneration | undefined {
	if (!isAIMessage(msg)) return undefined;
	const aiMessage = msg as AIMessage & { response_metadata?: unknown };
	return extractGenerationFromMetadata(aiMessage.response_metadata);
}

function mergeGeneration(
	current: MessageGeneration | undefined,
	next: MessageGeneration | undefined,
): MessageGeneration | undefined {
	if (!current) return next;
	if (!next) return current;
	return {
		agentId: next.agentId ?? current.agentId,
		agentName: next.agentName ?? current.agentName,
		provider: next.provider ?? current.provider,
		model: next.model ?? current.model,
	};
}

function deriveGenerationFromAssistantMessages(messages: BaseMessage[]): MessageGeneration | undefined {
	let generation: MessageGeneration | undefined;
	for (const msg of messages) {
		generation = mergeGeneration(generation, extractGenerationFromAssistantMessage(msg));
	}
	return generation;
}

function buildTimelineFromToolCalls(
	toolCalls: ToolCallState[] | undefined,
	aiMessageId?: string,
): AssistantTimelineEvent[] | undefined {
	if (!toolCalls || toolCalls.length === 0) return undefined;

	const events: AssistantTimelineEvent[] = [];
	for (const toolCall of toolCalls) {
		if (toolCall.preamble?.trim()) {
			events.push({
				id: `preamble-${toolCall.id}`,
				type: "preamble",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: toolCall.preamble.trim(),
				aiMessageId,
			});
		}

		events.push({
			id: `start-${toolCall.id}`,
			type: "tool_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			input: toolCall.input,
			status: "running",
			aiMessageId,
		});

		events.push({
			id: `end-${toolCall.id}`,
			type: "tool_end",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			output: toolCall.output,
			status: toolCall.status,
			aiMessageId,
		});
	}

	return events.length > 0 ? events : undefined;
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
		assistantTimeline: buildTimelineFromToolCalls(toolCalls, msg.id),
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

	// Merge multiple assistant messages — each AI message identified by its native id
	let finalContent = "";
	const allToolCalls: ToolCallState[] = [];
	const allTimelineEvents: AssistantTimelineEvent[] = [];

	for (const msg of assistantMessages) {
		const converted = baseMessageToAssistantMessage(msg, toolOutputs);

		// Use the last non-empty content
		if (converted.content.trim()) {
			finalContent = converted.content;
		}

		// Collect all tool calls and build timeline with the AI message's native id
		if (converted.toolCalls) {
			allToolCalls.push(...converted.toolCalls);
			const events = buildTimelineFromToolCalls(converted.toolCalls, msg.id);
			if (events) allTimelineEvents.push(...events);
		}
	}

	return {
		state: stateOverride ?? AssistantState.success,
		content: finalContent,
		toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
		assistantTimeline: allTimelineEvents.length > 0 ? allTimelineEvents : undefined,
	};
}

function createSummarizationMarker(source: HiddenHumanSource): MessagePair {
	return {
		id: genUUIDv7(),
		userMessage: { content: "" },
		assistantMessage: { state: AssistantState.success, content: "" },
		transcriptEvent: {
			type: "summarization_marker",
			label:
				source === "manual_summarization"
					? "Conversation compacted here"
					: "Earlier messages were summarized here",
			source,
		},
	};
}

function updateSummarizationMarker(pair: MessagePair, source: HiddenHumanSource): void {
	if (!pair.transcriptEvent || pair.transcriptEvent.type !== "summarization_marker") {
		return;
	}

	pair.transcriptEvent.source = source;
	pair.transcriptEvent.label =
		source === "manual_summarization" ? "Conversation compacted here" : "Earlier messages were summarized here";
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
			const lcSource = msg.additional_kwargs?.lc_source;
			if (isHiddenHumanSource(lcSource)) {
				const lastPair = messagePairs.at(-1);
				if (lastPair?.transcriptEvent?.type === "summarization_marker") {
					updateSummarizationMarker(lastPair, lcSource);
				} else {
					messagePairs.push(createSummarizationMarker(lcSource));
				}
				let j = i + 1;
				while (j < conversationMessages.length && isAIMessage(conversationMessages[j])) {
					j++;
				}
				i = j;
				continue;
			}

			// Start a new pair with user message
			let userContent = extractTextContent(msg);
			const humanMessageId = msg.id;
			const attachments = (msg.additional_kwargs?.attachments as ChatAttachment[] | undefined) ?? undefined;
			const visibleNotes = (msg.additional_kwargs?.visibleNotes as VisibleNoteRef[] | undefined) ?? undefined;
			const selection = (msg.additional_kwargs?.selection as SelectionRef | undefined) ?? undefined;
			const graphNotes = (msg.additional_kwargs?.graphNotes as GraphNoteRef[] | undefined) ?? undefined;
			const spaces = (msg.additional_kwargs?.spaces as string[] | undefined) ?? undefined;

			// Strip the augmented context blocks by reconstructing the exact suffix
			// that was appended, then removing it from the end. This is safe even when
			// user content or selected text contains bracket patterns like "[Selected text from".
			userContent = stripAugmentedSuffix(userContent, visibleNotes, selection, graphNotes, spaces);

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

			// Derive createdAt from the checkpoint timestamp for this human message
			let createdAt: number | undefined;
			if (humanMessageId && checkpointMapping?.humanTimestamps) {
				const ts = checkpointMapping.humanTimestamps.get(humanMessageId);
				if (ts) {
					const parsed = Date.parse(ts);
					if (Number.isFinite(parsed)) createdAt = parsed;
				}
			}

			messagePairs.push({
				id: pairId,
				userMessage: { content: userContent, attachments, visibleNotes, selection, graphNotes, spaces },
				assistantMessage: mergeAssistantMessages(assistantMessages, toolOutputs, state),
				generation: deriveGenerationFromAssistantMessages(assistantMessages),
				createdAt,
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
				generation: extractGenerationFromAssistantMessage(msg),
			});
			i++;
		}
	}

	return messagePairs;
}

/**
 * Get the timestamp for when this message pair was created.
 * Returns the stable createdAt (derived from checkpoint ts), or null if unavailable.
 */
export function getMessagePairTimestamp(pair: MessagePair): Date | null {
	if (pair.createdAt != null) {
		return new Date(pair.createdAt);
	}
	return null;
}

/**
 * Detect whether the chat history contains references to private notes.
 * Scans tool call inputs/outputs and user attachments for file paths
 * that match the privacy list.
 */
export function chatHistoryContainsPrivateNotes(messages: MessagePair[]): boolean {
	const store = getPendingChangesStore();
	const FILE_TOOLS = new Set(["read_content", "manage_notes", "get_properties"]);

	for (const pair of messages) {
		// Check user attachments
		if (pair.userMessage.attachments) {
			for (const attachment of pair.userMessage.attachments) {
				if (store.isFilePrivate(attachment.vaultPath)) return true;
			}
		}

		// Check tool calls in assistant messages
		if (pair.assistantMessage.toolCalls) {
			for (const tc of pair.assistantMessage.toolCalls) {
				if (!FILE_TOOLS.has(tc.name)) continue;

				// Check input paths
				const inputPath = tc.input?.path ?? tc.input?.note_name;
				if (typeof inputPath === "string" && store.isFilePrivate(inputPath)) return true;

				// Check output for file paths referenced in tool results
				if (typeof tc.output === "string") {
					// Match paths like 'Content of "folder/note.md"' in tool output
					const pathMatch = tc.output.match(/Content of "([^"]+)"/);
					if (pathMatch?.[1] && store.isFilePrivate(pathMatch[1])) return true;
				}
			}
		}
	}
	return false;
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
	id = $state<string>("");
	messages: MessagePair[] = $state<MessagePair[]>([]);

	// Streaming / lifecycle
	private abortController: AbortController | null = null;
	private cancelled = false;

	// Reactive UI state
	messageState = $state<MessageState>(MessageState.idle);
	summarizingHistory = $state(false);

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

	getActiveCheckpointMessages(): BaseMessage[] {
		const activeCheckpointId = this.graphState.activeCheckpointId;
		if (activeCheckpointId && this.graphState.nodes.has(activeCheckpointId)) {
			return this.graphState.nodes.get(activeCheckpointId)?.messages ?? this.bootstrapMessages;
		}
		return this.bootstrapMessages;
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
	async sendMessage(
		content: string,
		attachments?: ChatAttachment[],
		visibleNotes?: VisibleNoteRef[],
		selection?: SelectionRef,
		graphNotes?: GraphNoteRef[],
		spaces?: string[],
	): Promise<UUIDv7> {
		if (this.messages.length === 0 && isDraftChatName(this.id)) {
			const promotedThreadId = await getPlugin().agentManager.promoteDraftThread(this.id);
			if (promotedThreadId) {
				this.id = promotedThreadId;
			}
		}
		const pairId = genUUIDv7();

		// Capture the current model at send time
		const selectedAgent = getData().getSelectedAgent();
		const currentModel = selectedAgent.chatModel ?? undefined;

		const pair: MessagePair = {
			id: pairId,
			userMessage: { content, attachments, visibleNotes, selection, graphNotes, spaces },
			assistantMessage: { state: AssistantState.idle, content: "" },
			createdAt: Date.now(),
			model: currentModel,
			generation: {
				agentId: selectedAgent.id,
				agentName: selectedAgent.name,
				provider: currentModel?.provider,
				model: currentModel?.model,
			},
		};

		this.messages.push(pair);

		// Stream assistant reply (pass attachments and visible notes so they reach the agent)
		void this.processAssistantReply(pairId, content, attachments, visibleNotes, selection, graphNotes, spaces);

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

		const recovered = (lastMessage.additional_kwargs?.attachments as ChatAttachment[] | undefined)?.filter((att) =>
			Boolean(att?.name && att?.mimeType && att?.vaultPath),
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
		return normalizeToolInput(raw);
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
			predictedSummarization?: boolean;
		},
	) {
		const pair = this.findPair(pairId);
		if (!pair) return;

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		try {
			this.messageState = MessageState.answering;
			this.summarizingHistory = options.predictedSummarization ?? false;
			pair.assistantMessage.state = AssistantState.streaming;

			const streamPromise = this.consumeStream(pair.assistantMessage, getStream(signal));

			// Generate chat title in parallel for the first user message.
			// Start stream consumption first so non-parallel local providers (e.g., Ollama)
			// prioritize the assistant response before title generation.
			if (options.generateTitle && this.messages.length === 1) {
				const plugin = getPlugin();
				plugin.agentManager
					.generateThreadTitleFromUserMessage(String(this.id), options.generateTitle)
					.catch((err) => {
						Logger.warn("[ChatSession] Failed to generate chat title:", err);
					});
			}

			await streamPromise;
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
			this.summarizingHistory = false;
			this.messageState = MessageState.idle;
		}
	}

	private async shouldPredictSummarization(
		inputValue: string,
		options: {
			attachmentsCount?: number;
			visibleNotesCount?: number;
			hasSelection?: boolean;
			graphNotesCount?: number;
		} = {},
	): Promise<boolean> {
		const selectedAgent = getData().getSelectedAgent();
		const contextWindow = selectedAgent.chatModel?.modelConfig?.contextWindow;
		let systemPrompt = selectedAgent.systemPrompt;
		try {
			systemPrompt = await getPlugin().agentManager.assembleSystemPrompt();
		} catch {
			// Fall back to the base prompt if prompt assembly fails.
		}
		const estimatedTokens =
			estimateConversationBaseTokens(this.getActiveCheckpointMessages(), {
				systemPrompt,
			}) +
			estimateLiveDraftTokens(inputValue, {
				pendingAttachmentsCount: options.attachmentsCount,
				pendingVisibleNotesCount: options.visibleNotesCount,
				hasPendingSelection: options.hasSelection,
				pendingGraphNotesCount: options.graphNotesCount,
			});

		return shouldSummarizeForEstimatedTokens(estimatedTokens, contextWindow);
	}

	/** Augments the user query with visible notes context from the provided refs. */
	private augmentWithVisibleNotes(
		userContent: string,
		visibleNotes?: VisibleNoteRef[],
		selection?: SelectionRef,
		graphNotes?: GraphNoteRef[],
		spaces?: string[],
	): string {
		let result = userContent;
		if (visibleNotes?.length) {
			const ctx = formatVisibleNotesContext(visibleNotes);
			if (ctx) result = `${result}\n\n${ctx}`;
		}
		if (selection) {
			result = `${result}\n\n${formatSelectionContext(selection)}`;
		}
		if (graphNotes?.length) {
			const ctx = formatGraphNotesContext(graphNotes);
			if (ctx) result = `${result}\n\n${ctx}`;
		}
		if (spaces?.length) {
			const ctx = formatSpaceContext(spaces);
			if (ctx) result = `${result}\n\n${ctx}`;
		}
		return result;
	}

	/** Process assistant reply for a normal query (new message in thread). */
	private async processAssistantReply(
		pairId: UUIDv7,
		userContent: string,
		attachments?: ChatAttachment[],
		visibleNotes?: VisibleNoteRef[],
		selection?: SelectionRef,
		graphNotes?: GraphNoteRef[],
		spaces?: string[],
	) {
		const plugin = getPlugin();
		const beforeCheckpointIds = new Set(this.graphState.nodes.keys());
		const parentCheckpointId = this.graphState.activeCheckpointId ?? this.graphState.rootCheckpointId;
		const augmented = this.augmentWithVisibleNotes(userContent, visibleNotes, selection, graphNotes, spaces);

		checkpointDebug("send.parent", {
			threadId: this.id,
			parentCheckpointId,
			activeCheckpointId: this.graphState.activeCheckpointId,
		});

		await this.runStream(
			pairId,
			(signal) =>
				plugin.agentManager.streamQuery(
					augmented,
					String(this.id),
					this.graphState.activeCheckpointId,
					signal,
					attachments,
					visibleNotes,
					selection,
					graphNotes,
					undefined,
					spaces,
				) as AsyncIterable<AgentStreamChunk>,
			{
				generateTitle: userContent,
				reloadAfter: true,
				parentCheckpointId,
				beforeCheckpointIds,
				predictedSummarization: await this.shouldPredictSummarization(userContent, {
					attachmentsCount: attachments?.length,
					visibleNotesCount: visibleNotes?.length,
					hasSelection: Boolean(selection),
					graphNotesCount: graphNotes?.length,
				}),
			},
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
		const augmented = this.augmentWithVisibleNotes(userContent);

		checkpointDebug("edit.parent", {
			threadId: this.id,
			parentCheckpointId: checkpointId,
		});

		await this.runStream(
			pairId,
			(signal) =>
				plugin.agentManager.editFromCheckpoint(
					augmented,
					String(this.id),
					checkpointId,
					signal,
					attachments,
				) as AsyncIterable<AgentStreamChunk>,
			{
				reloadAfter: true,
				parentCheckpointId: checkpointId,
				beforeCheckpointIds,
				predictedSummarization: await this.shouldPredictSummarization(userContent, {
					attachmentsCount: attachments?.length,
				}),
			},
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
			{
				reloadAfter: true,
				parentCheckpointId: checkpointId,
				beforeCheckpointIds,
				predictedSummarization: await this.shouldPredictSummarization(""),
			},
		);
	}

	/**
	 * Shared stream consumption logic for both normal queries and regeneration.
	 */
	private async consumeStream(assistantMsg: AssistantMessage, stream: AsyncIterable<AgentStreamChunk>) {
		let tokenBuffer = "";
		let hasSeenToolCall = false;

		if (!assistantMsg.assistantTimeline) assistantMsg.assistantTimeline = [];

		for await (const chunk of stream) {
			if (chunk.type === "token") {
				this.summarizingHistory = false;
				if (!chunk.token) continue;
				tokenBuffer += chunk.token;
				assistantMsg.content = hasSeenToolCall ? tokenBuffer.trimStart() : tokenBuffer;
				continue;
			}

			if (chunk.type === "tool_start") {
				this.summarizingHistory = false;
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

				if (preamble.trim()) {
					assistantMsg.assistantTimeline.push({
						id: `preamble-${chunk.toolCallId}-${assistantMsg.assistantTimeline.length}`,
						type: "preamble",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						content: preamble.trim(),
						aiMessageId: chunk.aiMessageId,
					});
				}

				assistantMsg.assistantTimeline.push({
					id: `start-${chunk.toolCallId}-${assistantMsg.assistantTimeline.length}`,
					type: "tool_start",
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					input: this.normalizeToolInput(chunk.input),
					status: "running",
					aiMessageId: chunk.aiMessageId,
				});
				continue;
			}

			if (chunk.type === "tool_end") {
				this.summarizingHistory = false;
				// Determine tool completion status up-front so both ToolCallState
				// and the timeline event use the same value.  During streaming the
				// on_tool_end event does not carry a status flag, so we default to
				// "completed".  The checkpoint_message handler below reconciles the
				// final status from ToolMessage.status (which does distinguish errors).
				const resolvedStatus: ToolCallStatus = "completed";

				if (assistantMsg.toolCalls) {
					const tc = assistantMsg.toolCalls.find((t) => t.id === chunk.toolCallId);
					if (tc) {
						tc.status = resolvedStatus;
						tc.output = chunk.output;
					} else {
						assistantMsg.toolCalls.push({
							id: chunk.toolCallId,
							name: chunk.toolName,
							input: {},
							status: resolvedStatus,
							output: chunk.output,
						});
					}
				} else {
					assistantMsg.toolCalls = [
						{
							id: chunk.toolCallId,
							name: chunk.toolName,
							input: {},
							status: resolvedStatus,
							output: chunk.output,
						},
					];
				}

				assistantMsg.assistantTimeline.push({
					id: `end-${chunk.toolCallId}-${assistantMsg.assistantTimeline.length}`,
					type: "tool_end",
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					output: chunk.output,
					status: resolvedStatus,
					aiMessageId: chunk.aiMessageId,
				});
				continue;
			}

			if (chunk.type === "result") {
				this.summarizingHistory = false;
				assistantMsg.content = hasSeenToolCall ? tokenBuffer.trim() : tokenBuffer;
				continue;
			}

			if (chunk.type === "checkpoint_message") {
				this.summarizingHistory = false;
				const checkpointAssistant = baseMessageToAssistantMessage(chunk.message);
				assistantMsg.content = checkpointAssistant.content;
				assistantMsg.toolCalls = checkpointAssistant.toolCalls;
				assistantMsg.assistantTimeline = checkpointAssistant.assistantTimeline;
				break;
			}
		}

		if (!assistantMsg.content) {
			assistantMsg.content = hasSeenToolCall ? tokenBuffer.trim() : tokenBuffer;
		}

		if (!assistantMsg.assistantTimeline?.length) {
			assistantMsg.assistantTimeline = buildTimelineFromToolCalls(assistantMsg.toolCalls);
		}
	}

	async summarizeHistoryNow(): Promise<void> {
		if (this.messageState !== MessageState.idle) {
			throw new Error("Cannot summarize while another response is in progress.");
		}

		const plugin = getPlugin();
		const beforeCheckpointIds = new Set(this.graphState.nodes.keys());
		const parentCheckpointId = this.graphState.activeCheckpointId ?? this.graphState.rootCheckpointId;
		const assistantMessage: AssistantMessage = { state: AssistantState.streaming, content: "" };

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		try {
			this.messageState = MessageState.answering;
			this.summarizingHistory = true;

			await this.consumeStream(
				assistantMessage,
				plugin.agentManager.streamQuery(
					MANUAL_SUMMARIZATION_PROMPT,
					String(this.id),
					this.graphState.activeCheckpointId,
					signal,
					undefined,
					undefined,
					undefined,
					undefined,
					"manual_summarization",
				) as AsyncIterable<AgentStreamChunk>,
			);

			await this.syncGraphAfterRun(parentCheckpointId, beforeCheckpointIds);

			if (this.onNeedReload) {
				await this.onNeedReload();
			}
		} finally {
			this.abortController = null;
			this.cancelled = false;
			this.summarizingHistory = false;
			this.messageState = MessageState.idle;
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
	isLoadingSession: boolean = $state(false);
	pendingInput: string | null = $state(null);
	pendingGraphNotes: string[] | null = $state(null);
	pendingAttachmentPaths: string[] | null = $state(null);
	#agentManager: AgentManager;

	constructor(agentManager: AgentManager) {
		this.#agentManager = agentManager;
	}

	private async deriveThreadId(file: TFile): Promise<string | null> {
		if (isDraftChatName(file.basename)) {
			return file.basename;
		}

		let lastError: Error | undefined;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				const raw = await getPlugin().app.vault.adapter.readBinary(file.path);
				if (!raw || raw.byteLength === 0) break;

				const buffer = Buffer.from(raw);
				let data: unknown;
				try {
					const decompressed = gunzipSync(buffer);
					data = JSON.parse(decompressed.toString("utf8"));
				} catch {
					// Fallback to plain JSON
					const text = buffer.toString("utf8");
					data = JSON.parse(text);
				}

				if (data && typeof data === "object" && "threadId" in data && typeof data.threadId === "string") {
					return data.threadId.trim() || null;
				}
				break; // File is readable but doesn't have threadId in expected place
			} catch (err) {
				lastError = err as Error;
			}
			
			if (attempt < 3) {
				await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
			}
		}

		// Fallback: If we can't read the threadId from the file, use the basename as the ID.
		// This ensures the chat can still be opened even if the content is temporarily unreadable.
		Logger.debug(`deriveThreadId: Falling back to basename for ${file.path} after failing to read content.`, lastError);
		return file.basename;
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

	private getDefaultAgentForFallback() {
		const data = getData();
		const defaultAgentId = data.defaultAgentId ?? DEFAULT_AGENT_ID;
		return data.getAgent(defaultAgentId) ?? data.getAgent(DEFAULT_AGENT_ID) ?? data.getSelectedAgent();
	}

	private getModelConfigForSelection(
		agentChatModel: ChatModel | null,
		provider: string,
		model: string,
	): Partial<ChatModelConfig> {
		if (agentChatModel && agentChatModel.provider === provider && agentChatModel.model === model) {
			return agentChatModel.modelConfig;
		}
		return agentChatModel?.modelConfig ?? { contextWindow: 128000 };
	}

	private resolveAgentFromGeneration(
		generation: MessageGeneration,
		fallbackAgent: AgentConfig,
	): { agentId: string; model: ChatModel | null } {
		const data = getData();
		const provider = generation.provider!;
		const model = generation.model!;

		// Try to find the agent by ID first
		let generatedAgent = generation.agentId ? data.getAgent(generation.agentId) : undefined;

		// Fall back to matching by provider+model
		if (!generatedAgent) {
			const candidates = Object.values(data.agents).filter(
				(agent) => agent.chatModel?.provider === provider && agent.chatModel?.model === model,
			);
			if (candidates.length === 1) {
				generatedAgent = candidates[0];
			} else if (candidates.length > 1) {
				generatedAgent = candidates.find((agent) => agent.id === data.defaultAgentId) ?? candidates[0];
			}
		}

		// When an agent is found, return its stored chatModel rather than
		// constructing one from the generation's provider/model fields.
		// The generation metadata comes from LLM response_metadata which can
		// contain incorrect values (e.g. @langchain/openai hardcodes
		// model_provider: "openai" even when used with OpenRouter).
		if (generatedAgent) {
			return {
				agentId: generatedAgent.id,
				model: generatedAgent.chatModel ?? null,
			};
		}

		// No agent matched — check if the generation's provider is still configured.
		// Only apply the generation's model if the provider is actually available,
		// otherwise fall back to the agent's stored model to avoid overwriting
		// with an unconfigured provider (e.g. "openai" from response_metadata
		// when the actual provider is "openrouter").
		if (data.getConfiguredProviders().includes(provider)) {
			return {
				agentId: fallbackAgent.id,
				model: {
					provider,
					model,
					modelConfig: this.getModelConfigForSelection(fallbackAgent.chatModel, provider, model),
				},
			};
		}

		return { agentId: fallbackAgent.id, model: fallbackAgent.chatModel ?? null };
	}

	private async restoreSelectionFromLoadedMessages(
		graph: CheckpointGraphState,
		activeCheckpointId: string | undefined,
		errorCount: number,
		bootstrapMessages: BaseMessage[],
	): Promise<void> {
		const data = getData();
		const messagePairs = deriveMessagePairsFromActiveCheckpoint(
			graph,
			activeCheckpointId,
			errorCount,
			bootstrapMessages,
		);
		const lastPair = messagePairs.at(-1);
		const generation = lastPair?.generation;

		const fallbackAgent = this.getDefaultAgentForFallback();
		let nextAgentId = fallbackAgent.id;
		let nextModel: ChatModel | null = fallbackAgent.chatModel ?? null;

		if (generation?.provider && generation?.model) {
			const resolved = this.resolveAgentFromGeneration(generation, fallbackAgent);
			nextAgentId = resolved.agentId;
			nextModel = resolved.model;
		}

		let changed = false;
		if (data.selectedAgentId !== nextAgentId) {
			data.selectedAgentId = nextAgentId;
			changed = true;
		}

		const selectedAgent = data.getAgent(nextAgentId);
		if (selectedAgent) {
			const currentModel = selectedAgent.chatModel;
			const modelChanged =
				(currentModel?.provider ?? null) !== (nextModel?.provider ?? null) ||
				(currentModel?.model ?? null) !== (nextModel?.model ?? null);

			if (modelChanged) {
				data.updateAgent(nextAgentId, { chatModel: nextModel });
				changed = true;
			}
		}

		if (changed) {
			await this.#agentManager.reinitialize();
		}
	}

	/* ---------------- Chat Creation / Metadata ---------------- */

	async loadSession(file: TFile, targetCheckpointId?: string) {
		this.isLoadingSession = true;
		try {
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
		const errorCount = historyWithError?.errorCount || 0;

		await this.restoreSelectionFromLoadedMessages(graph, resolution.checkpointId, errorCount, bootstrapMessages);

		this.session = new ChatSession(id, {
			graphState: graph,
			errorCount,
			bootstrapMessages,
			onNeedReload: async () => this.reloadSession(),
		});

		await this.persistLastViewedCheckpoint(id, resolution.checkpointId);
		} finally {
			this.isLoadingSession = false;
		}
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

	async sendMessage(
		content: string,
		attachments?: ChatAttachment[],
		visibleNotes?: VisibleNoteRef[],
		selection?: SelectionRef,
		graphNotes?: GraphNoteRef[],
		spaces?: string[],
	): Promise<string> {
		if (!this.session) {
			throw new Error("No active session");
		}
		return this.session.sendMessage(content, attachments, visibleNotes, selection, graphNotes, spaces);
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
