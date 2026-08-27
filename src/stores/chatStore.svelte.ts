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
import { SvelteMap } from "svelte/reactivity";
import type { AgentStreamChunk, CheckpointHistoryItem, ThreadHistory } from "../agent/Agent";
import type { AgentManager } from "../agent/AgentManager";
import { BASE_SYSTEM_PROMPT } from "../agent/prompts";
import type { ChatModelConfig } from "../providers/index";
import type { ChatAttachment, ReviewStatusRef, ThreadError } from "../types/shared";
import type { AgentConfig } from "../types/plugin";
import { getPendingChangesStore } from "./pendingChangesStore.svelte";
import { formatVisibleNotesContext, type VisibleNoteRef } from "../hooks/useVisibleNotes.svelte";
import { formatSelectionContext, type SelectionRef } from "../hooks/useSelection.svelte";
import { type UUIDv7, genUUIDv7 } from "../utils/uuid7Validator";
import { DEFAULT_AGENT_ID, getData } from "./dataStore.svelte";
import { getPlugin } from "./state.svelte";
import { Logger } from "../utils/logging";
import { shouldSummarizeForEstimatedTokens } from "../agent/summarization";
import { estimateConversationBaseTokens, estimateLiveDraftTokens } from "../utils/tokenEstimator";
import { extractErrorMessage } from "../utils/errorMessage";
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
}

const HIDDEN_HUMAN_MESSAGE_SOURCES = new Set(["summarization", "manual_summarization"]);
type HiddenHumanSource = "summarization" | "manual_summarization";
const MANUAL_SUMMARIZATION_PROMPT =
	"Summarize older conversation history now to reduce context usage while preserving important facts, decisions, and user preferences. Do not call tools. Reply with exactly: Context compacted.";

function isHiddenHumanSource(source: unknown): source is HiddenHumanSource {
	return typeof source === "string" && HIDDEN_HUMAN_MESSAGE_SOURCES.has(source);
}

/**
 * `pending` means the model is still streaming the call's arguments — the tool
 * has not started executing and its `input` is not yet known. Only reachable
 * live: a settled/checkpoint-replayed call is never pending.
 */
export type ToolCallStatus = "pending" | "running" | "completed" | "failed";

export interface ToolCallState {
	id: string;
	name: string;
	/** Absent while `status` is `pending` — the arguments are still streaming. */
	input?: Record<string, unknown>;
	status: ToolCallStatus;
	output?: unknown;
	preamble?: string;
	/** Name of the subagent this tool ran inside (via the `task` tool), if any. */
	subAgentName?: string;
	/** The id of the parent `task` tool call this is nested under, if any. */
	parentToolCallId?: string;
}

export type AssistantTimelineEventType = "preamble" | "tool_pending" | "tool_start" | "tool_end";

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
	/** Name of the subagent this tool ran inside (via the `task` tool), if any. */
	subAgentName?: string;
	/** The id of the parent `task` tool call this is nested under, if any. */
	parentToolCallId?: string;
}

export interface UserMessage {
	content: string;
	attachments?: ChatAttachment[];
	visibleNotes?: VisibleNoteRef[];
	selection?: SelectionRef;
	graphNotes?: GraphNoteRef[];
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
	// Wall-clock time the assistant spent producing this turn (thinking + tool
	// calls), in milliseconds. Stamped live in the store when the stream ends and
	// persisted onto the final AI message's response_metadata so the "Thought for
	// Ns" label survives reload. Absent for turns predating this / restored history
	// with no stored duration (the UI falls back to the step count).
	thinkingDurationMs?: number;
	// The aiMessageId of the text currently in `content` (streaming only). The UI uses
	// this to decide when the last tool step folds into the thinking process: the step
	// stays "current" (rendered below the label with its tools) until live content
	// carries a DIFFERENT aiMessageId — i.e. the model has begun the next AI message
	// (the "first token of the next message" fold trigger). Cleared whenever `content`
	// is cleared (tool_start / step boundary) so an empty spot never drives a fold.
	contentAiMessageId?: string;
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
	/**
	 * Stable identity for this turn that survives the settle rebuild. `id` is a
	 * fresh UUID on every `rebuildMessagePairs()` pass, so keying UI lists on it
	 * tears down and recreates every row when a stream settles (losing scroll
	 * position). This key is derived from the persisted human message id instead,
	 * so a turn keeps the same identity across rebuilds. Falls back to `id` for
	 * pairs with no human message (orphaned assistant, summary markers).
	 */
	stableKey?: string;
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

export function resolveActiveCheckpointId(
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
	lastErrorMessage?: string,
): MessagePair[] {
	if (!activeCheckpointId || !graph.nodes.has(activeCheckpointId)) {
		return baseMessagesToMessagePairs(bootstrapMessages, errorCount, undefined, lastErrorMessage);
	}

	const activeNode = graph.nodes.get(activeCheckpointId);
	if (!activeNode) {
		return baseMessagesToMessagePairs(bootstrapMessages, errorCount, undefined, lastErrorMessage);
	}

	const checkpointMapping = buildCheckpointMessageMappingFromGraph(graph, activeCheckpointId);
	return baseMessagesToMessagePairs(activeNode.messages, errorCount, checkpointMapping, lastErrorMessage);
}

/* -----------------------------------------------------------------------------
 * BaseMessage to MessagePair conversion
 * ---------------------------------------------------------------------------*/

/**
 * Extracts the user-facing query text from a BaseMessage.
 *
 * `Agent.buildMessageContent` inlines text/md/csv/json attachments (and non-native
 * PDFs) as text content blocks tagged with `s2b_attachment: true`, appended after
 * the untagged query block. That tag keeps the content array from being collapsed
 * to a string on read, so here we split structurally: join only the untagged text
 * blocks (the query) and drop the tagged attachment blocks. The attachments still
 * render separately as chips. A plain-string content (no attachments) is returned
 * as-is.
 */
function extractTextContent(message: BaseMessage): string {
	const content = message.content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(block): block is { type: "text"; text: string } =>
					typeof block === "object" &&
					block !== null &&
					(block as { type?: unknown }).type === "text" &&
					(block as { s2b_attachment?: unknown }).s2b_attachment !== true,
			)
			.map((block) => block.text)
			.join("");
	}
	return message.text || "";
}

/** Formats graph-selected notes into a context block for the agent. */
export function formatGraphNotesContext(notes: GraphNoteRef[]): string {
	if (notes.length === 0) return "";
	const links = notes.map((n) => `- [[${n.path.replace(/\.md$/, "")}]]`);
	return `[Graph-selected notes]\n${links.join("\n")}`;
}

/**
 * Formats staged-change review outcomes into a context block for the agent.
 * Without this the model never learns what the user decided: its tool result
 * said "will be reviewed", and every later turn it would keep assuming its
 * edits were (or will be) applied — including ones the user rejected.
 */
export function formatReviewOutcomesContext(status: ReviewStatusRef): string {
	const pendingProposals = status.pendingProposals ?? [];
	// Messages persisted before proposals carried ids kept only paths. Their block
	// is reconstructed here to be stripped by exact match, so it has to render the
	// way it originally did — hence reading the legacy field rather than migrating.
	const legacyPendingPaths = pendingProposals.length === 0 ? (status.pendingPaths ?? []) : [];
	if (status.outcomes.length === 0 && pendingProposals.length === 0 && legacyPendingPaths.length === 0) return "";
	const lines = ["[Status of your proposed note changes]"];
	for (const o of status.outcomes) {
		if (o.outcome === "accepted") {
			lines.push(`- "${o.path}": accepted by the user and applied.`);
		} else if (o.outcome === "rejected") {
			lines.push(`- "${o.path}": rejected by the user — NOT applied. Do not assume this edit exists.`);
		} else {
			lines.push(
				`- "${o.path}": partially applied — the user accepted some of the proposed changes and rejected the rest. Read the note if you need its exact current content.`,
			);
		}
	}
	if (pendingProposals.length > 0) {
		lines.push(
			"- Still awaiting the user's review (NOT applied yet). Use the id with a `discard` operation to withdraw one:",
		);
		for (const proposal of pendingProposals) {
			lines.push(`  - "${proposal.path}" (id: ${proposal.shortId})`);
		}
	} else if (legacyPendingPaths.length > 0) {
		lines.push(
			`- Still awaiting the user's review (NOT applied yet): ${legacyPendingPaths.map((p) => `"${p}"`).join(", ")}`,
		);
	}
	return lines.join("\n");
}

/** Strips the augmented context suffix (visible notes + selection + graph notes) from a message.
 * Reconstructs the exact suffix that was appended by augmentWithVisibleNotes()
 * and removes it by exact string match from the end. This is safe even when user
 * content or selected text contains bracket patterns like "[Selected text from".
 */
function stripAugmentedSuffix(
	content: string,
	visibleNotes?: VisibleNoteRef[],
	selection?: SelectionRef,
	graphNotes?: GraphNoteRef[],
	reviewStatus?: ReviewStatusRef,
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
	if (reviewStatus) {
		const ctx = formatReviewOutcomesContext(reviewStatus);
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

/**
 * Reads the persisted thinking duration (ms) off an AI message's response_metadata,
 * written by ObsidianChatManager on save (mirrors the generation-metadata pattern).
 * Returns undefined for non-AI messages or turns with no stored duration.
 */
function extractThinkingDurationFromMessage(msg: BaseMessage): number | undefined {
	if (!isAIMessage(msg)) return undefined;
	const meta = (msg as AIMessage & { response_metadata?: unknown }).response_metadata;
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
	const value = (meta as Record<string, unknown>).thinking_duration_ms;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
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

/**
 * Ids of tool calls that were announced but never started, and so must be removed
 * from the timeline.
 *
 * A `pending` entry comes from `tool_call_chunks` (the model naming a call before
 * its arguments finish streaming) and is resolved by `on_tool_start`. LangChain
 * validates arguments against the tool schema BEFORE firing that callback, so a
 * call whose arguments don't match throws `ToolInputParsingException` and fires
 * NEITHER tool callback — leaving the announcement with nothing to resolve it,
 * shimmering as "running" indefinitely.
 *
 * Such calls are dropped rather than marked failed: the rejected call produces no
 * ToolMessage and never reaches the checkpoint, the error is fed back to the model,
 * and the model normally retries successfully within the same turn (appearing as
 * its own card). A phantom "failed" row would report a failure the turn didn't
 * actually suffer.
 *
 * `beforeToolCallId` scopes the sweep to calls announced before that call, which is
 * what makes mid-stream cleanup sound: tool execution is ordered, so a call that has
 * just ended proves every earlier announcement without a `tool_start` is dead. Omit
 * it to sweep everything once the stream is over.
 */
export function selectUnresolvedPendingIds(calls: ToolCallState[], beforeToolCallId?: string): Set<string> {
	const cutoff = beforeToolCallId ? calls.findIndex((t) => t.id === beforeToolCallId) : calls.length;
	// findIndex returning -1 (unknown id) must not sweep the whole list, and a cutoff
	// of 0 means the ending call is first, so there is nothing earlier to sweep.
	if (cutoff <= 0) return new Set();
	return new Set(
		calls
			.slice(0, cutoff)
			.filter((t) => t.status === "pending")
			.map((t) => t.id),
	);
}

function buildTimelineFromToolCalls(
	toolCalls: ToolCallState[] | undefined,
	aiMessageId?: string,
): AssistantTimelineEvent[] | undefined {
	if (!toolCalls || toolCalls.length === 0) return undefined;

	const events: AssistantTimelineEvent[] = [];
	// Track preamble texts already emitted for this message so that when multiple
	// tool calls share the same flat-string preamble (checkpoint replay collapses
	// the content to a single string), the preamble event is only emitted once —
	// for the first tool call that carries it.
	const emittedPreambles = new Set<string>();
	for (const toolCall of toolCalls) {
		const preambleText = toolCall.preamble?.trim();
		if (preambleText && !emittedPreambles.has(preambleText)) {
			emittedPreambles.add(preambleText);
			events.push({
				id: `preamble-${toolCall.id}`,
				type: "preamble",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: preambleText,
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
			subAgentName: toolCall.subAgentName,
			parentToolCallId: toolCall.parentToolCallId,
		});

		events.push({
			id: `end-${toolCall.id}`,
			type: "tool_end",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			output: toolCall.output,
			status: toolCall.status,
			aiMessageId,
			subAgentName: toolCall.subAgentName,
			parentToolCallId: toolCall.parentToolCallId,
		});
	}

	return events.length > 0 ? events : undefined;
}

/**
 * Builds a map of AIMessage id → parent task call id for subagent AIMessages.
 *
 * deepagents injects subagent AIMessages into the parent thread's checkpoint.  These
 * appear after the ToolMessages that completed the parent's `task` calls — i.e. an
 * AIMessage with non-task tool calls that follows a ToolMessage closing a `task` call
 * is a subagent's internal turn.  Parent-agent AIMessages (those that have `task` calls
 * themselves) pass through without clearing the accumulated closed-task list, so
 * sequential task dispatch (one task at a time) is handled correctly alongside
 * parallel dispatch (multiple tasks per LLM turn).
 *
 * Each subagent AIMessage is attributed to the closed `task` call with the fewest
 * children assigned so far (FIFO round-robin — same heuristic as live streaming).
 */
function buildSubAgentParentMap(messages: BaseMessage[]): Map<string, string> {
	// messageId → parentTaskCallId
	const parentMap = new Map<string, string>();
	// task call IDs registered from AIMessages (name === "task")
	const registeredTaskCallIds = new Set<string>();
	// task call IDs closed by ToolMessages, available for attribution; grows across
	// multiple parent-agent turns within a single user turn (sequential task dispatch)
	const closedTaskCallIds: string[] = [];
	// How many subagent AIMessages have been assigned per closed task (round-robin counter)
	const taskChildCounts = new Map<string, number>();

	for (const msg of messages) {
		if (isHumanMessage(msg)) {
			registeredTaskCallIds.clear();
			closedTaskCallIds.length = 0;
			taskChildCounts.clear();
			continue;
		}

		if (isToolMessage(msg)) {
			const tcId = (msg as ToolMessage).tool_call_id;
			if (tcId && registeredTaskCallIds.has(tcId)) {
				closedTaskCallIds.push(tcId);
				taskChildCounts.set(tcId, 0);
			}
			continue;
		}

		if (isAIMessage(msg)) {
			const aiMsg = msg as AIMessage;
			const tc = aiMsg.tool_calls ?? [];
			const hasTaskCalls = tc.some((c) => c.name === "task");
			const hasAnyToolCalls = tc.length > 0;

			if (!hasTaskCalls && hasAnyToolCalls && closedTaskCallIds.length > 0) {
				// Subagent AIMessage: has tool calls, none are `task`, and task calls
				// have been closed upstream.  Assign to the closed task with the fewest
				// children (FIFO round-robin).
				let bestParent = closedTaskCallIds[0];
				let bestCount = taskChildCounts.get(bestParent) ?? 0;
				for (const tid of closedTaskCallIds) {
					const c = taskChildCounts.get(tid) ?? 0;
					if (c < bestCount) {
						bestCount = c;
						bestParent = tid;
					}
				}
				if (msg.id) parentMap.set(msg.id, bestParent);
				taskChildCounts.set(bestParent, bestCount + 1);
			}
			// Parent-agent turns (hasTaskCalls) and final-answer turns (no tool calls)
			// intentionally do NOT reset closedTaskCallIds — sequential task dispatch
			// interleaves parent turns between subagent turns within the same user turn.

			// Register new `task` tool calls for future ToolMessage matching
			for (const call of tc) {
				if (call.name === "task" && call.id) {
					registeredTaskCallIds.add(call.id);
				}
			}
		}
	}

	return parentMap;
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
			// Extract per-tool-call preamble text.
			// Live responses (Anthropic): content is an array of ordered blocks —
			// text blocks that precede a tool_use block are the preamble for that call.
			// Replayed checkpoints: LangGraph collapses AIMessageChunk content to a
			// flat string; that string is the preamble shared by all tool calls in
			// the message.
			const preambleByToolId = new Map<string, string>();
			if (Array.isArray(aiMsg.content)) {
				let pendingText = "";
				for (const block of aiMsg.content as Array<{ type: string; text?: string; id?: string }>) {
					if (block.type === "text") {
						pendingText += block.text ?? "";
					} else if (block.type === "tool_use" && block.id) {
						if (pendingText.trim()) preambleByToolId.set(block.id, pendingText.trim());
						pendingText = "";
					} else {
						pendingText = "";
					}
				}
			} else if (typeof aiMsg.content === "string" && aiMsg.content.trim()) {
				// Flat string from a replayed checkpoint — assign to all tool calls.
				const sharedPreamble = aiMsg.content.trim();
				for (const tc of rawToolCalls) {
					if (tc.id) preambleByToolId.set(tc.id, sharedPreamble);
				}
			}

			toolCalls = rawToolCalls.map((tc) => {
				const toolOutput = toolOutputs?.get(tc.id || "");
				const input = normalizeToolInput(tc.args);
				// On reload the subagent's own tool calls are not persisted (deepagents
				// returns only the `task` ToolMessage to the parent), so we cannot
				// reconstruct nested children. We can still label the `task` call with
				// the subagent it delegated to, recovered from its `subagent_type` arg.
				const subAgentName =
					tc.name === "task" && typeof input.subagent_type === "string"
						? (input.subagent_type as string)
						: undefined;
				return {
					id: tc.id || "",
					name: tc.name,
					input,
					status: toolOutput?.status ?? "completed",
					output: toolOutput?.content,
					preamble: preambleByToolId.get(tc.id || "") ?? undefined,
					subAgentName,
				};
			});
		}
	}

	return {
		state: stateOverride ?? AssistantState.success,
		content: textContent,
		toolCalls,
		assistantTimeline: buildTimelineFromToolCalls(toolCalls, msg.id),
		thinkingDurationMs: extractThinkingDurationFromMessage(msg),
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
	subAgentParentMap?: Map<string, string>,
): AssistantMessage {
	if (assistantMessages.length === 0) {
		return {
			state: stateOverride ?? AssistantState.success,
			content: "",
		};
	}

	// Merge multiple assistant messages — each AI message identified by its native id
	let finalContent = "";
	let finalDuration: number | undefined;
	const allToolCalls: ToolCallState[] = [];
	const allTimelineEvents: AssistantTimelineEvent[] = [];

	for (const msg of assistantMessages) {
		const converted = baseMessageToAssistantMessage(msg, toolOutputs);
		// If this AIMessage was produced by a subagent (deepagents injects its internal
		// turns into the parent checkpoint), patch its tool calls with parentToolCallId
		// so foldSubAgentChildren can nest them under the correct `task` step.
		const parentTaskCallId = msg.id ? subAgentParentMap?.get(msg.id) : undefined;
		if (parentTaskCallId && converted.toolCalls) {
			for (const tc of converted.toolCalls) {
				tc.parentToolCallId = parentTaskCallId;
			}
			if (converted.assistantTimeline) {
				for (const event of converted.assistantTimeline) {
					event.parentToolCallId = parentTaskCallId;
				}
			}
		}

		// Use the last non-empty content — but skip subagent messages entirely;
		// their text is intermediate subagent reasoning, not the parent answer.
		if (!parentTaskCallId && converted.content.trim()) {
			finalContent = converted.content;
			// The duration is written onto the same final answer message, so carry it
			// from whichever message supplies finalContent (last top-level non-empty).
			if (converted.thinkingDurationMs !== undefined) {
				finalDuration = converted.thinkingDurationMs;
			}
		}

		// Collect all tool calls and timeline events.
		// Use the converted.assistantTimeline directly (which already has parentToolCallId
		// patched in above and preambles extracted) rather than rebuilding from toolCalls,
		// so preamble events inherit the correct parentToolCallId for folding.
		if (converted.toolCalls) {
			allToolCalls.push(...converted.toolCalls);
			if (converted.assistantTimeline) {
				allTimelineEvents.push(...converted.assistantTimeline);
			}
		}
	}

	return {
		state: stateOverride ?? AssistantState.success,
		content: finalContent,
		toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
		assistantTimeline: allTimelineEvents.length > 0 ? allTimelineEvents : undefined,
		thinkingDurationMs: finalDuration,
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
	lastErrorMessage?: string,
): MessagePair[] {
	if (!messages || messages.length === 0) return [];

	const messagePairs: MessagePair[] = [];
	const toolOutputs = buildToolOutputsMap(messages);
	const subAgentParentMap = buildSubAgentParentMap(messages);

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
			const reviewStatus = (msg.additional_kwargs?.reviewStatus as ReviewStatusRef | undefined) ?? undefined;

			// Strip the augmented context blocks by reconstructing the exact suffix
			// that was appended, then removing it from the end. This is safe even when
			// user content or selected text contains bracket patterns like "[Selected text from".
			userContent = stripAugmentedSuffix(userContent, visibleNotes, selection, graphNotes, reviewStatus);

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

			const assistantMessage = mergeAssistantMessages(assistantMessages, toolOutputs, state, subAgentParentMap);

			messagePairs.push({
				id: pairId,
				stableKey: humanMessageId ?? pairId,
				userMessage: { content: userContent, attachments, visibleNotes, selection, graphNotes },
				assistantMessage,
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

	// Surface the recovered error message on the newest error pair. `errorCount`
	// is thread-wide (counts errors across all branches), so it can exceed the
	// number of error pairs on the active path — that's why we attach by finding
	// the last error pair here rather than during the count-down loop above.
	if (lastErrorMessage) {
		const lastErrorPair = messagePairs.findLast((pair) => pair.assistantMessage.state === AssistantState.error);
		if (lastErrorPair) {
			lastErrorPair.assistantMessage.errorCode = lastErrorMessage;
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
	lastErrorMessage?: string;
	bootstrapMessages?: BaseMessage[];
	/** Agent selected for this session's runs. Defaults to the global
	 * `selectedAgentId`; restored per-thread from generation metadata on load. */
	selectedAgentId?: string;
	onNeedReload?: () => Promise<void>;
	/** Fires when this.id changes (title rename). Used by SessionRegistry to rekey
	 * the session map so the new path stays addressable. */
	onThreadIdChange?: (oldPath: string, newPath: string) => void;
}

export class ChatSession {
	id = $state<string>("");
	messages: MessagePair[] = $state<MessagePair[]>([]);

	/** Agent whose model/prompt/tools this session's runs resolve against.
	 * Per-session so concurrent tabs can run different agents/models. */
	selectedAgentId = $state<string>("");

	// Streaming / lifecycle
	private abortController: AbortController | null = null;
	private cancelled = false;
	// Reactive mirror of "a stream is in flight". `abortController` is an
	// imperative handle (not $state), so UI that reacts to running state — the
	// status-bar RunningIndicator, input disable — reads THIS instead. Flip it
	// in lockstep wherever abortController is set/cleared.
	private running = $state(false);

	// Reactive UI state
	messageState = $state<MessageState>(MessageState.idle);
	summarizingHistory = $state(false);

	/** Id of the user message pair currently being edited in the composer, or
	 * null when not editing. Lives per-session (not on SessionRegistry) so one
	 * tab's edit can never leak into another. The composer (Input.svelte) is
	 * the only thing that holds the actual draft text, so it also owns
	 * stashing/restoring it around an edit — this is just the on/off switch
	 * and target id, shared with MessageContainer.svelte so both react to it. */
	editingPairId = $state<UUIDv7 | null>(null);

	private graphState: CheckpointGraphState;
	private errorCount: number;
	private lastErrorMessage: string | undefined;
	private bootstrapMessages: BaseMessage[];
	private onNeedReload: (() => Promise<void>) | undefined;
	private onThreadIdChange: ((oldPath: string, newPath: string) => void) | undefined;

	/** Wall-clock of the last time this session was surfaced or ran; used by the
	 * SessionRegistry to evict the least-recently-used parked idle sessions. */
	lastTouchedAt = Date.now();

	constructor(id: string, options: ChatSessionOptions) {
		this.id = id;
		this.selectedAgentId = options.selectedAgentId ?? getData().selectedAgentId;
		this.graphState = options.graphState;
		this.errorCount = options.errorCount;
		this.lastErrorMessage = options.lastErrorMessage;
		this.bootstrapMessages = options.bootstrapMessages ?? [];
		this.onNeedReload = options.onNeedReload;
		this.onThreadIdChange = options.onThreadIdChange;
		this.rebuildMessagePairs();
	}

	/** True while a stream (query/edit/regenerate/summarization) is in flight.
	 * Reads the reactive `running` flag so $derived consumers (RunningIndicator)
	 * update when a stream starts/stops. */
	get isRunning(): boolean {
		return this.running;
	}

	touch(): void {
		this.lastTouchedAt = Date.now();
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

	applyGraphState(
		graphState: CheckpointGraphState,
		errorCount: number,
		bootstrapMessages?: BaseMessage[],
		lastErrorMessage?: string,
	): void {
		this.graphState = graphState;
		this.errorCount = errorCount;
		this.lastErrorMessage = lastErrorMessage;
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
			this.lastErrorMessage,
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

		this.applyGraphState(nextGraph, this.errorCount, undefined, this.lastErrorMessage);
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
	): Promise<UUIDv7> {
		const pairId = genUUIDv7();

		// Capture the current model at send time
		const selectedAgent = getData().getSelectedAgent();
		const currentModel = selectedAgent.chatModel ?? undefined;

		const pair: MessagePair = {
			id: pairId,
			userMessage: { content, attachments, visibleNotes, selection, graphNotes },
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
		void this.processAssistantReply(pairId, content, attachments, visibleNotes, selection, graphNotes);

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

	/** Enter edit mode for a message pair. The composer reacts to
	 * `editingPairId` changing to stash its draft and seed the message's text. */
	beginEdit(pairId: UUIDv7): void {
		this.editingPairId = pairId;
	}

	/** Leave edit mode without submitting. The composer is responsible for
	 * restoring whatever draft it stashed when the edit began. */
	cancelEdit(): void {
		this.editingPairId = null;
	}

	/** The pair currently being edited, or undefined if edit state is stale
	 * (e.g. the pair was dropped by a branch switch mid-edit). */
	getEditingPair(): MessagePair | undefined {
		return this.editingPairId ? this.findPair(this.editingPairId) : undefined;
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

	/**
	 * Retry a failed turn: re-run the model for a user message whose response
	 * errored out. Unlike {@link regenerateResponse}, this tolerates a missing
	 * `regenerateFromCheckpointId` — immediately after a live error the graph is
	 * still stale (the failed run skips `syncGraphAfterRun`), so we reload the
	 * session from the persisted checkpoints first to recover the checkpoint that
	 * holds the failed user message, then regenerate from it.
	 */
	async retryLastError(pairId: UUIDv7): Promise<void> {
		const pair = this.findPair(pairId);
		if (!pair || pair.assistantMessage.state !== AssistantState.error) {
			throw new Error("Cannot retry: message pair is not in an error state.");
		}

		// Fast path: the checkpoint is already known (e.g. after a reload).
		if (pair.regenerateFromCheckpointId) {
			await this.regenerateResponse(pairId);
			return;
		}

		// Slow path: sync from persisted checkpoints so the failed user message's
		// checkpoint becomes addressable, then regenerate the now-resolved pair.
		if (!this.onNeedReload) {
			throw new Error("Cannot retry: no checkpoint available and session reload is unavailable.");
		}
		await this.onNeedReload();

		const reloadedPair = this.messages.findLast(
			(p) => p.assistantMessage.state === AssistantState.error && p.regenerateFromCheckpointId,
		);
		if (!reloadedPair?.regenerateFromCheckpointId) {
			throw new Error("Cannot retry: failed message could not be recovered from history.");
		}

		await this.regenerateResponse(reloadedPair.id);
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

		this.applyGraphState(nextGraph, this.errorCount, undefined, this.lastErrorMessage);
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

		if (this.abortController) {
			throw new Error("A response is already in progress for this chat.");
		}

		this.abortController = new AbortController();
		this.running = true;
		const signal = this.abortController.signal;
		this.touch();

		try {
			this.messageState = MessageState.answering;
			this.summarizingHistory = options.predictedSummarization ?? false;
			pair.assistantMessage.state = AssistantState.streaming;

			// Wall-clock start of the turn — used to compute the run duration stamped on
			// the message (live) and persisted onto the checkpoint below.
			const runStartedAtMs = Date.now();

			await this.consumeStream(pair.assistantMessage, getStream(signal));
			pair.assistantMessage.state = AssistantState.success;

			// Stamp the elapsed time so the "Thought for Ns" label shows immediately
			// (before any reload) and reads back from persistence later. This is the
			// FULL-run duration (turn start → stream end): the whole turn is the
			// "thinking process" — all streamed text renders under the header until the
			// stream ends, at which point the final answer drops into place below.
			const thinkingDurationMs = Date.now() - runStartedAtMs;
			pair.assistantMessage.thinkingDurationMs = thinkingDurationMs;

			// Generate chat title after stream completes for the first user message.
			// Must be sequential because rename changes this.id (the thread path).
			if (options.generateTitle && this.messages.length === 1) {
				try {
					const plugin = getPlugin();
					const newPath = await plugin.agentManager.generateThreadTitleFromUserMessage(
						String(this.id),
						this.selectedAgentId,
						options.generateTitle,
					);
					if (newPath) {
						const oldPath = String(this.id);
						this.id = newPath;
						this.onThreadIdChange?.(oldPath, newPath);
					}
				} catch (err) {
					Logger.warn("[ChatSession] Failed to generate chat title:", err);
				}
			}

			await this.syncGraphAfterRun(options.parentCheckpointId, options.beforeCheckpointIds);

			// syncGraphAfterRun rebuilds this.messages from the checkpoint graph, which
			// replaces the pair object we stamped above with a fresh one whose
			// thinkingDurationMs is read from response_metadata — not yet written (that
			// happens below). Without this re-stamp the label flips from "Thought for Ns"
			// back to the step-count fallback the instant the stream settles.
			const rebuiltPair = this.findPair(pairId);
			if (rebuiltPair) {
				rebuiltPair.assistantMessage.thinkingDurationMs = thinkingDurationMs;
			}

			// Persist the thinking duration onto the just-created checkpoint's final
			// AI message (response_metadata) so "Thought for Ns" survives reload. Done
			// after syncGraphAfterRun, when the active checkpoint id for this turn is
			// resolved. Best-effort: a failure here only loses the persisted label,
			// not the answer, so it must never break the run.
			const settledCheckpointId = this.graphState.activeCheckpointId;
			if (settledCheckpointId) {
				try {
					await getPlugin().agentManager.annotateThinkingDuration(
						String(this.id),
						settledCheckpointId,
						thinkingDurationMs,
					);
				} catch (err) {
					Logger.warn("[ChatSession] Failed to persist thinking duration:", err);
				}
			}

			if (options.reloadAfter && this.onNeedReload) {
				await this.onNeedReload();
			}
		} catch (_err) {
			if (this.cancelled) {
				pair.assistantMessage.state = AssistantState.cancelled;
			} else {
				pair.assistantMessage.state = AssistantState.error;
				pair.assistantMessage.errorCode = extractErrorMessage(_err);
				Logger.error("[ChatSession] Run failed:", _err);
			}
		} finally {
			this.abortController = null;
			this.running = false;
			this.cancelled = false;
			this.summarizingHistory = false;
			this.messageState = MessageState.idle;
			this.touch();
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
		let systemPrompt = BASE_SYSTEM_PROMPT;
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

	/** Augments the user query with visible notes context from the provided refs.
	 * Order must match stripAugmentedSuffix exactly — the UI strips by exact
	 * suffix reconstruction. */
	private augmentWithVisibleNotes(
		userContent: string,
		visibleNotes?: VisibleNoteRef[],
		selection?: SelectionRef,
		graphNotes?: GraphNoteRef[],
		reviewStatus?: ReviewStatusRef,
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
		if (reviewStatus) {
			const ctx = formatReviewOutcomesContext(reviewStatus);
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
	) {
		const plugin = getPlugin();
		const beforeCheckpointIds = new Set(this.graphState.nodes.keys());
		const parentCheckpointId = this.graphState.activeCheckpointId ?? this.graphState.rootCheckpointId;
		// Review outcomes for changes the model staged earlier in this thread —
		// collected at send time so the model stops assuming rejected edits exist.
		// `take` marks resolved entries reported; if this send then fails before
		// the checkpoint persists, those outcomes are lost to the model (it can
		// still read the notes) — accepted over re-reporting them forever.
		let reviewStatus: ReviewStatusRef | undefined;
		try {
			const { outcomes, pendingProposals } = getPendingChangesStore().takeReviewOutcomesForThread(
				String(this.id),
			);
			if (outcomes.length > 0 || pendingProposals.length > 0) reviewStatus = { outcomes, pendingProposals };
		} catch {
			// store not initialized — send without the block
		}
		const augmented = this.augmentWithVisibleNotes(userContent, visibleNotes, selection, graphNotes, reviewStatus);

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
					this.selectedAgentId,
					this.graphState.activeCheckpointId,
					signal,
					attachments,
					visibleNotes,
					selection,
					graphNotes,
					undefined,
					reviewStatus,
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
					this.selectedAgentId,
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
					this.selectedAgentId,
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
	private async consumeStream(
		assistantMsg: AssistantMessage,
		stream: AsyncIterable<AgentStreamChunk>,
	): Promise<void> {
		let tokenBuffer = "";
		let hasSeenToolCall = false;
		// Track preamble texts already emitted during streaming so that parallel tool
		// calls sharing the same preambleAccumulator text only get one preamble event.
		const emittedStreamPreambles = new Set<string>();
		let currentTokenAiMessageId: string | undefined;
		// True after a tool_end — signals that the next token starts a new LangGraph step.
		// We reset the display content then to avoid stacking inter-step AI texts.
		let pendingStepReset = false;

		if (!assistantMsg.assistantTimeline) assistantMsg.assistantTimeline = [];

		const dropUnresolvedPending = (beforeToolCallId?: string) => {
			const calls = assistantMsg.toolCalls;
			if (!calls?.length) return;
			const orphaned = selectUnresolvedPendingIds(calls, beforeToolCallId);
			if (orphaned.size === 0) return;
			Logger.debug("chatStore.consumeStream.dropped_unresolved_pending", {
				toolCallIds: [...orphaned],
			});
			assistantMsg.toolCalls = calls.filter((t) => !orphaned.has(t.id));
			if (assistantMsg.assistantTimeline) {
				assistantMsg.assistantTimeline = assistantMsg.assistantTimeline.filter(
					(e) => !(e.toolCallId && orphaned.has(e.toolCallId) && e.type !== "preamble"),
				);
			}
		};

		for await (const chunk of stream) {
			if (chunk.type === "token") {
				this.summarizingHistory = false;
				if (!chunk.token) continue;

				// Detect step boundary via aiMessageId change (preferred), or via
				// pendingStepReset (fallback when aiMessageId doesn't change between steps).
				const aiIdChanged =
					hasSeenToolCall && chunk.aiMessageId && chunk.aiMessageId !== currentTokenAiMessageId;
				if (aiIdChanged || pendingStepReset) {
					tokenBuffer = "";
					assistantMsg.content = "";
					assistantMsg.contentAiMessageId = undefined;
					pendingStepReset = false;
					emittedStreamPreambles.clear();
				}
				if (chunk.aiMessageId) currentTokenAiMessageId = chunk.aiMessageId;

				tokenBuffer += chunk.token;
				assistantMsg.content = hasSeenToolCall ? tokenBuffer.trimStart() : tokenBuffer;
				// Stamp the aiMessageId of the text now in `content` so the UI can tell
				// when the model has moved to a NEW message (fold trigger). See the field
				// docs on AssistantMessage.
				assistantMsg.contentAiMessageId = currentTokenAiMessageId;
				continue;
			}

			// The model has begun a tool call but is still streaming its arguments, so
			// the tool hasn't started and we have no input yet. Show the call now rather
			// than leaving the turn blank for however long the arguments take — for a
			// `manage_notes` edit the arguments ARE the note body, so that wait is
			// seconds. The matching `tool_start` upgrades this entry in place below.
			if (chunk.type === "tool_pending") {
				this.summarizingHistory = false;
				hasSeenToolCall = true;
				pendingStepReset = false;

				// Commit the preamble AS WE CLEAR the live answer spot. Clearing without
				// committing (leaving it for tool_start) blanked the text for the whole
				// argument-streaming window — seconds for a `manage_notes` edit — so the
				// user watched their preamble appear, vanish, then reappear. The two must
				// happen in the same step: the text moves, it never disappears.
				const pendingPreamble = (chunk.preamble ?? "").trim();
				const pendingHasNewPreamble = !!pendingPreamble && !emittedStreamPreambles.has(pendingPreamble);
				if (pendingHasNewPreamble) emittedStreamPreambles.add(pendingPreamble);
				tokenBuffer = "";
				assistantMsg.content = "";
				assistantMsg.contentAiMessageId = undefined;

				if (!assistantMsg.toolCalls) assistantMsg.toolCalls = [];
				if (!assistantMsg.toolCalls.some((t) => t.id === chunk.toolCallId)) {
					assistantMsg.toolCalls.push({
						id: chunk.toolCallId,
						name: chunk.toolName,
						status: "pending",
						preamble: pendingHasNewPreamble ? pendingPreamble : undefined,
						subAgentName: chunk.subAgentName,
						parentToolCallId: chunk.parentToolCallId,
					});
				}

				if (pendingHasNewPreamble) {
					assistantMsg.assistantTimeline.push({
						id: `preamble-${chunk.toolCallId}-${assistantMsg.assistantTimeline.length}`,
						type: "preamble",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						content: pendingPreamble,
						aiMessageId: chunk.aiMessageId,
					});
				}

				if (
					!assistantMsg.assistantTimeline.some(
						(e) => e.type !== "preamble" && e.toolCallId === chunk.toolCallId,
					)
				) {
					assistantMsg.assistantTimeline.push({
						id: `pending-${chunk.toolCallId}-${assistantMsg.assistantTimeline.length}`,
						type: "tool_pending",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						status: "pending",
						aiMessageId: chunk.aiMessageId,
						subAgentName: chunk.subAgentName,
						parentToolCallId: chunk.parentToolCallId,
					});
				}
				continue;
			}

			if (chunk.type === "tool_start") {
				this.summarizingHistory = false;
				hasSeenToolCall = true;
				pendingStepReset = false;
				// Use the preamble carried on the chunk (indexed by Agent.ts from the
				// messages stream before tool callbacks fire) rather than tokenBuffer.
				// tokenBuffer may contain text from earlier steps or be empty if messages
				// arrived out of order relative to tool callbacks.
				const preamble = chunk.preamble ?? "";
				const preambleTrimmed = preamble.trim();
				const isFirstWithPreamble = !!preambleTrimmed && !emittedStreamPreambles.has(preambleTrimmed);
				if (isFirstWithPreamble) emittedStreamPreambles.add(preambleTrimmed);
				tokenBuffer = "";
				assistantMsg.content = "";
				assistantMsg.contentAiMessageId = undefined;

				if (!assistantMsg.toolCalls) assistantMsg.toolCalls = [];
				// A `tool_pending` for this id already created the entry; upgrade it in
				// place so the card doesn't duplicate or jump position when execution
				// actually begins. Attribution stays as announced (tool_start's is
				// authoritative, but identical here); only input/status/preamble fill in.
				const announced = assistantMsg.toolCalls.find((t) => t.id === chunk.toolCallId);
				if (announced) {
					announced.name = chunk.toolName;
					announced.input = this.normalizeToolInput(chunk.input);
					announced.status = "running";
					if (isFirstWithPreamble) announced.preamble = preambleTrimmed;
					if (chunk.subAgentName) announced.subAgentName = chunk.subAgentName;
					if (chunk.parentToolCallId) announced.parentToolCallId = chunk.parentToolCallId;
				} else {
					assistantMsg.toolCalls.push({
						id: chunk.toolCallId,
						name: chunk.toolName,
						input: this.normalizeToolInput(chunk.input),
						status: "running",
						preamble: isFirstWithPreamble ? preambleTrimmed : undefined,
						subAgentName: chunk.subAgentName,
						parentToolCallId: chunk.parentToolCallId,
					});
				}

				// The announced `tool_pending` event is already positioned in the timeline,
				// so upgrade it in place. Pushing a second event would render the tool
				// twice; and the preamble must be INSERTED BEFORE it (not appended) so the
				// reasoning text still reads above the card it belongs to.
				const announcedEventIdx = assistantMsg.assistantTimeline.findIndex(
					(e) => e.type === "tool_pending" && e.toolCallId === chunk.toolCallId,
				);

				if (isFirstWithPreamble) {
					const preambleEvent: AssistantTimelineEvent = {
						id: `preamble-${chunk.toolCallId}-${assistantMsg.assistantTimeline.length}`,
						type: "preamble",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						content: preambleTrimmed,
						aiMessageId: chunk.aiMessageId,
					};
					if (announcedEventIdx >= 0) {
						assistantMsg.assistantTimeline.splice(announcedEventIdx, 0, preambleEvent);
					} else {
						assistantMsg.assistantTimeline.push(preambleEvent);
					}
				}

				const startedEvent = assistantMsg.assistantTimeline.find(
					(e) => e.type === "tool_pending" && e.toolCallId === chunk.toolCallId,
				);
				if (startedEvent) {
					startedEvent.type = "tool_start";
					startedEvent.toolName = chunk.toolName;
					startedEvent.input = this.normalizeToolInput(chunk.input);
					startedEvent.status = "running";
					if (chunk.aiMessageId) startedEvent.aiMessageId = chunk.aiMessageId;
					if (chunk.subAgentName) startedEvent.subAgentName = chunk.subAgentName;
					if (chunk.parentToolCallId) startedEvent.parentToolCallId = chunk.parentToolCallId;
				} else {
					assistantMsg.assistantTimeline.push({
						id: `start-${chunk.toolCallId}-${assistantMsg.assistantTimeline.length}`,
						type: "tool_start",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						input: this.normalizeToolInput(chunk.input),
						status: "running",
						aiMessageId: chunk.aiMessageId,
						subAgentName: chunk.subAgentName,
						parentToolCallId: chunk.parentToolCallId,
					});
				}
				continue;
			}

			if (chunk.type === "tool_end") {
				this.summarizingHistory = false;
				// A call that finished proves any call announced BEFORE it never started:
				// tool execution is ordered, so an earlier announcement that still has no
				// tool_start was rejected at schema validation. Clearing it here rather
				// than only at stream end matters — the turn can run for tens of seconds
				// afterwards, and the dead card would shimmer for all of it.
				dropUnresolvedPending(chunk.toolCallId);
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
						// Attribution (subagent name + parent task) is authoritative from the
						// tool_start event. Do NOT overwrite it here: the on_tool_end attribution
						// is recomputed by a FIFO round-robin that can pick a different open
						// `task` when several run in parallel, which would re-parent an already
						// nested child onto the wrong task card. Only fill gaps.
						if (chunk.subAgentName && !tc.subAgentName) tc.subAgentName = chunk.subAgentName;
						if (chunk.parentToolCallId && !tc.parentToolCallId)
							tc.parentToolCallId = chunk.parentToolCallId;
					} else {
						assistantMsg.toolCalls.push({
							id: chunk.toolCallId,
							name: chunk.toolName,
							input: {},
							status: resolvedStatus,
							output: chunk.output,
							subAgentName: chunk.subAgentName,
							parentToolCallId: chunk.parentToolCallId,
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
							subAgentName: chunk.subAgentName,
							parentToolCallId: chunk.parentToolCallId,
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
					subAgentName: chunk.subAgentName,
					parentToolCallId: chunk.parentToolCallId,
				});
				// Signal that the next token starts a new LangGraph step — we reset the
				// display buffer then so inter-step AI texts don't stack in the answer area.
				pendingStepReset = true;
				continue;
			}

			if (chunk.type === "result") {
				this.summarizingHistory = false;
				assistantMsg.content = hasSeenToolCall ? tokenBuffer.trim() : tokenBuffer;
				assistantMsg.contentAiMessageId = currentTokenAiMessageId;
				continue;
			}

			if (chunk.type === "checkpoint_message") {
				this.summarizingHistory = false;
				const checkpointAssistant = baseMessageToAssistantMessage(chunk.message);
				// Content and final tool statuses/outputs are authoritative from the
				// checkpoint. But the checkpoint never contains the subagent's own
				// tool calls (deepagents persists only the `task` ToolMessage), so if
				// we captured them live keep the richer streamed timeline and only
				// reconcile final statuses/outputs onto it — otherwise the nested
				// subagent branch would collapse the instant streaming ends.
				assistantMsg.content = checkpointAssistant.content;

				const streamedHasToolCalls = (assistantMsg.toolCalls?.length ?? 0) > 0;

				if (streamedHasToolCalls) {
					const finalById = new Map((checkpointAssistant.toolCalls ?? []).map((tc) => [tc.id, tc]));
					// Keep the streamed timeline (which has preamble text and subagent
					// children); only patch in authoritative final status/output from the
					// checkpoint, since streaming always defaults status to "completed"
					// and cannot observe error state.
					for (const event of assistantMsg.assistantTimeline ?? []) {
						if (event.type !== "tool_end") continue;
						const final = event.toolCallId ? finalById.get(event.toolCallId) : undefined;
						if (!final) continue;
						event.status = final.status;
						event.output = final.output;
					}
					for (const tc of assistantMsg.toolCalls ?? []) {
						const final = finalById.get(tc.id);
						if (!final) continue;
						tc.status = final.status;
						tc.output = final.output;
					}
				} else {
					assistantMsg.toolCalls = checkpointAssistant.toolCalls;
					assistantMsg.assistantTimeline = checkpointAssistant.assistantTimeline;
				}
				break;
			}
		}

		// Sweep any call still pending once the stream is over — the run may have ended
		// (or been aborted) before a superseding tool_end could clear it.
		dropUnresolvedPending();

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
		this.running = true;
		const signal = this.abortController.signal;
		this.touch();

		try {
			this.messageState = MessageState.answering;
			this.summarizingHistory = true;

			await this.consumeStream(
				assistantMessage,
				plugin.agentManager.streamQuery(
					MANUAL_SUMMARIZATION_PROMPT,
					String(this.id),
					this.selectedAgentId,
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
			this.running = false;
			this.cancelled = false;
			this.summarizingHistory = false;
			this.messageState = MessageState.idle;
			this.touch();
		}
	}
}

/* -----------------------------------------------------------------------------
 * SessionRegistry
 * ---------------------------------------------------------------------------*/

/** Maximum number of parked (non-active, non-running) idle sessions kept in memory. */
const MAX_PARKED_SESSIONS = 3;

/* -----------------------------------------------------------------------------
 * SessionRegistry
 *  - Owns the global set of live ChatSessions keyed by thread path.
 *  - Loads/reloads/rekeys/evicts sessions; derives the running set.
 *  - Does NOT hold a single "active" pointer: each view (ChatView) binds to its
 *    own thread path and reads its session via `sessionFor(threadPath)`. Actions
 *    (send/edit/regenerate/summarize/switchToBranch) are called directly on the
 *    ChatSession the view resolved, so an action from one tab can never leak into
 *    another. Running state is read per-session (`ChatSession.isRunning`).
 * ---------------------------------------------------------------------------*/
export class SessionRegistry {
	/** All live sessions keyed by thread path. A running session is parked here
	 * (not destroyed) when the user navigates away, so it can be reattached. */
	sessions = new SvelteMap<string, ChatSession>();
	isLoadingSession: boolean = $state(false);
	pendingInput: string | null = $state(null);
	pendingGraphNotes: string[] | null = $state(null);
	/** The live graph selection, shared across all chats. Unlike the one-shot
	 * `pendingGraphNotes` (which focuses a specific chat), this ambient state is
	 * read reactively by every open chat's context tray, so a graph selection
	 * shows up in whichever chat the user switches to while it stays selected.
	 * Per-chat exclusions are tracked locally in each ContextTray. */
	graphSelection: string[] = $state([]);
	pendingAttachmentPaths: string[] | null = $state(null);
	pendingAutoSubmit: boolean = $state(false);
	/** When set, only the Input bound to this thread path consumes the pending
	 * input/attachments/auto-submit above. Prevents a stale chat tab from eating a
	 * submission meant for a freshly opened chat (e.g. "Ask agent" from search). */
	pendingSubmitThreadPath: string | null = $state(null);
	#agentManager: AgentManager;

	/**
	 * Monotonically increasing token identifying the most recent `loadSession`
	 * call. Switching threads quickly fires overlapping async loads; without a
	 * guard, a slower earlier load can resolve last and clobber a session
	 * with the previous chat's checkpoints. Each load captures the token at
	 * start and only commits its result if it is still the latest.
	 */
	#loadToken = 0;

	constructor(agentManager: AgentManager) {
		this.#agentManager = agentManager;
	}

	/** The session for a specific thread path — the only session accessor.
	 * Each view passes its own pinned threadPath. */
	sessionFor(threadPath: string | null): ChatSession | null {
		return threadPath ? (this.sessions.get(threadPath) ?? null) : null;
	}

	/** All sessions currently streaming. Concurrency-ready: derived from each
	 * session's own `isRunning`, not a single shared slot. */
	get runningSessions(): ChatSession[] {
		return [...this.sessions.values()].filter((s) => s.isRunning);
	}

	/** Stop every running stream. */
	stopAll(): void {
		for (const s of this.runningSessions) s.stopStreaming();
	}

	/** Wires session callbacks: map rekeying on rename. Run-state is read
	 * per-session (no registry slot to push into). */
	private buildSessionOptions(
		id: string,
		base: Pick<
			ChatSessionOptions,
			"graphState" | "errorCount" | "lastErrorMessage" | "bootstrapMessages" | "onNeedReload" | "selectedAgentId"
		>,
	): ChatSessionOptions {
		return {
			...base,
			onThreadIdChange: (oldPath, newPath) => {
				this.rekeySession(oldPath, newPath);
				id = newPath; // keep closure in sync
			},
		};
	}

	/** Rekey a session in the map after its thread path changes (title rename).
	 * Views bind by their own threadPath (updated via ChatView's rename handling),
	 * so there is no registry-level active/running pointer to repoint here. */
	private rekeySession(oldPath: string, newPath: string): void {
		if (oldPath === newPath) return;
		const s = this.sessions.get(oldPath);
		if (!s) return;
		this.sessions.delete(oldPath);
		this.sessions.set(newPath, s);
	}

	/** Drop least-recently-used idle parked sessions, keeping at most
	 * MAX_PARKED_SESSIONS idle ones. Never evicts a running session (concurrency:
	 * protects ALL running sessions, not a single slot). Sessions currently
	 * mounted in a view stay in the MRU window because loading touches them. */
	private evictParkedSessions(): void {
		const parked = [...this.sessions.values()].filter((s) => !s.isRunning);
		if (parked.length <= MAX_PARKED_SESSIONS) return;
		parked.sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
		for (const s of parked.slice(MAX_PARKED_SESSIONS)) {
			this.sessions.delete(s.id);
		}
	}

	private deriveThreadId(file: TFile): string {
		return file.path;
	}

	private getLastViewedCheckpointId(history: ThreadHistory | null): string | undefined {
		const candidate = history?.metadata?.lastViewedCheckpointId;
		return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
	}

	private async persistLastViewedCheckpoint(
		threadId: string,
		checkpointId: string | undefined,
		session: ChatSession | null,
	): Promise<void> {
		if (!checkpointId) return;
		await this.#agentManager.setLastViewedCheckpoint(threadId, checkpointId);
		session?.setLastPersistedActiveCheckpointId(checkpointId);
	}

	private getDefaultAgentForFallback() {
		const data = getData();
		return data.getAgent(data.defaultAgentId) ?? data.getAgent(DEFAULT_AGENT_ID) ?? data.getSelectedAgent();
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

		if (generatedAgent) {
			return {
				agentId: generatedAgent.id,
				model: generatedAgent.chatModel ?? null,
			};
		}

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
	): Promise<string> {
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

		const selectedAgent = data.getAgent(nextAgentId);
		if (selectedAgent) {
			const currentModel = selectedAgent.chatModel;
			const modelChanged =
				(currentModel?.provider ?? null) !== (nextModel?.provider ?? null) ||
				(currentModel?.model ?? null) !== (nextModel?.model ?? null);

			if (modelChanged) {
				data.updateAgent(nextAgentId, { chatModel: nextModel });
				this.#agentManager.invalidateAgentRunnable(nextAgentId);
			}
		}

		return nextAgentId;
	}

	/* ---------------- Chat Creation / Metadata ---------------- */

	async loadSession(file: TFile, targetCheckpointId?: string) {
		// Claim the latest-load token synchronously, before any await, so
		// overlapping loads are ordered by call order rather than by whichever
		// async fetch happens to resolve last.
		const token = ++this.#loadToken;
		const isLatest = () => this.#loadToken === token;

		const id = this.deriveThreadId(file);
		if (!id) throw new Error("Invalid thread ID");

		// Reattach: if a live (running) session already exists for this thread,
		// re-surface it instead of rebuilding from checkpoints — rebuilding would
		// discard the in-flight streaming state (partial tokens, abortController).
		// The view is already pinned to this thread path, so no pointer to move.
		const existing = this.sessions.get(id);
		if (existing?.isRunning && !targetCheckpointId) {
			existing.touch();
			this.evictParkedSessions();
			return;
		}

		// Show the skeleton immediately, synchronously (before any await) so
		// Svelte paints it at least once even when the thread is already cached
		// and every fetch below resolves within the same microtask flush.
		this.isLoadingSession = true;

		// Skip the loading skeleton for brand-new, empty chats: there is no
		// history to fetch, so show the empty state + input immediately. Clear
		// the flag we just set before any meaningful history work happens.
		const isEmpty = await this.#agentManager.isThreadEmpty(id);
		if (!isLatest()) return; // A newer switch superseded this load.
		if (isEmpty) this.isLoadingSession = false;
		try {
			const [history, checkpointHistory] = await Promise.all([
				this.#agentManager.getThreadHistory(id),
				this.#agentManager.getCheckpointHistory(id),
			]);

			// A newer thread switch started while we were fetching — discard this
			// result so it can't overwrite the newer session's checkpoints.
			if (!isLatest()) return;

			// If the agent wasn't initialized yet, checkpoint history came back empty.
			// Schedule a reload for once the deferred init completes so the view
			// shows the real history without the user having to intervene.
			if (checkpointHistory.length === 0 && !isEmpty) {
				this.#agentManager.onNextInitialized(() => {
					// Only reload if this thread's session is still around (its view
					// may have closed and the session been evicted meanwhile).
					if (this.sessions.has(id)) void this.reloadSession(id);
				});
			}

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

			const historyWithError = history as
				| (ThreadHistory & { lastError?: ThreadError; errorCount?: number })
				| null;
			const bootstrapMessages = historyWithError?.messages || [];
			const errorCount = historyWithError?.errorCount || 0;
			const lastErrorMessage = historyWithError?.lastError?.message;

			const restoredAgentId = await this.restoreSelectionFromLoadedMessages(
				graph,
				resolution.checkpointId,
				errorCount,
				bootstrapMessages,
			);

			if (!isLatest()) return;

			const session = new ChatSession(
				id,
				this.buildSessionOptions(id, {
					graphState: graph,
					errorCount,
					lastErrorMessage,
					bootstrapMessages,
					selectedAgentId: restoredAgentId,
					// Reload against this specific session/thread, not whatever is
					// active when a backgrounded run finishes later.
					onNeedReload: async () => this.reloadSession(id),
				}),
			);
			this.sessions.set(id, session);

			await this.persistLastViewedCheckpoint(id, resolution.checkpointId, session);
			this.evictParkedSessions();
		} finally {
			// Only the latest load owns the loading flag; a superseded load must
			// not clear the skeleton out from under the newer one.
			if (isLatest()) this.isLoadingSession = false;
		}
	}

	/** Reload a specific session (by thread path) while preserving valid
	 * in-memory active checkpoint precedence. */
	async reloadSession(threadId: string, targetCheckpointId?: string): Promise<void> {
		const session = this.sessions.get(threadId) ?? null;
		if (!session) {
			throw new Error("No session to reload");
		}

		// Capture load token: a thread switch during the awaits below can replace
		// this session; applying stale history to a newer session would show
		// the wrong chat's checkpoints.
		const id = session.id;
		const loadToken = this.#loadToken;
		const sessionCheckpointId = session.getActiveCheckpointId();

		const [history, checkpointHistory] = await Promise.all([
			this.#agentManager.getThreadHistory(id),
			this.#agentManager.getCheckpointHistory(id),
		]);

		// Bail if a newer load started, OR if the session was evicted/replaced.
		if (this.sessions.get(id) !== session || this.#loadToken !== loadToken) return;

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
		session.applyGraphState(
			graph,
			historyWithError?.errorCount || 0,
			historyWithError?.messages || [],
			historyWithError?.lastError?.message,
		);

		await this.persistLastViewedCheckpoint(id, resolution.checkpointId, session);
	}

	/** Switch a specific thread to a different branch by activating a checkpoint.
	 * Read-only navigation — allowed even while a chat is streaming. Takes an
	 * explicit threadPath so the calling view targets its own session, never a
	 * global active pointer. */
	async switchToBranch(threadPath: string, checkpointId: string): Promise<void> {
		const session = this.sessions.get(threadPath) ?? null;
		if (!session) {
			throw new Error("No session for thread");
		}

		const threadId = session.id;
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
		session.applyGraphState(
			graph,
			historyWithError?.errorCount || 0,
			historyWithError?.messages || [],
			historyWithError?.lastError?.message,
		);

		await this.persistLastViewedCheckpoint(threadId, checkpointId, session);
	}
}

/* -----------------------------------------------------------------------------
 * Singleton helpers
 * ---------------------------------------------------------------------------*/
let sessionRegistrySingleton: SessionRegistry | null = null;

export function createSessionRegistry(agentManager?: AgentManager): SessionRegistry {
	if (!sessionRegistrySingleton) {
		if (!agentManager) {
			throw new Error("AgentManager is required for first SessionRegistry creation");
		}
		sessionRegistrySingleton = new SessionRegistry(agentManager);
	}
	return sessionRegistrySingleton;
}

export function getSessionRegistry(): SessionRegistry | null {
	return sessionRegistrySingleton;
}
