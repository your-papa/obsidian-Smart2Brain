import type { AssistantTimelineEvent, ToolCallState, ToolCallStatus } from "../../stores/chatStore.svelte";

/**
 * A single tool call in the rendered timeline. When a tool ran inside a
 * subagent (via the `task` tool), `subAgentName` names that subagent and
 * `parentToolCallId` points at the `task` call it is nested under. `children`
 * is populated by {@link foldSubAgentChildren} on `task` calls.
 */
export interface UnifiedToolCall {
	id: string;
	name: string;
	/** Reasoning text the model emitted immediately before this tool call. */
	preamble?: string;
	input?: Record<string, unknown>;
	output?: unknown;
	status: ToolCallStatus;
	/** Name of the subagent this tool ran inside, if any. */
	subAgentName?: string;
	/** The id of the parent `task` tool call this is nested under, if any. */
	parentToolCallId?: string;
	/** Subagent tool calls nested under this `task` call (folded post-build). */
	children?: UnifiedToolCall[];
}

export interface TimelineStep {
	id: string;
	tools: UnifiedToolCall[];
}

function toUnifiedFromEvent(event: AssistantTimelineEvent): UnifiedToolCall {
	return {
		id: event.toolCallId ?? "",
		name: event.toolName ?? "Unknown",
		input: event.input,
		status: "running",
		subAgentName: event.subAgentName,
		parentToolCallId: event.parentToolCallId,
	};
}

/**
 * Builds timeline steps from the raw assistant timeline events. Groups events
 * into steps by `aiMessageId` when available, otherwise falls back to a single
 * step. Nesting of subagent children under their `task` call is applied
 * separately via {@link foldSubAgentChildren}.
 */
export function buildStepsFromEvents(rawEvents: AssistantTimelineEvent[]): TimelineStep[] {
	const steps: TimelineStep[] = [];
	const stepByGroup = new Map<string, TimelineStep>();
	// toolCallId → preamble text: set when a preamble event arrives, consumed when
	// the matching tool_start event arrives so the preamble attaches to the tool.
	const pendingPreambles = new Map<string, string>();

	// If events have aiMessageId, group by it; otherwise fall back to single-step heuristic
	const hasGroupIds = rawEvents.some((e) => e.aiMessageId !== undefined);

	if (hasGroupIds) {
		for (const event of rawEvents) {
			// tool_end events never create a new step — they only update an existing tool
			// across all steps (the aiMessageId on tool_end may differ from tool_start when
			// the first tool call in a stream has no preamble and lastAiMessageId was still
			// undefined at tool_start time). Creating a step here would leave empty steps.
			if (event.type === "tool_end") {
				for (const s of steps) {
					const tool = s.tools.find((t) => t.id === event.toolCallId);
					if (tool) {
						tool.status = event.status ?? "completed";
						tool.output = event.output;
						break;
					}
				}
				continue;
			}

			const groupId = event.aiMessageId ?? "unknown";

			if (!stepByGroup.has(groupId)) {
				const step: TimelineStep = {
					id: `step-${groupId}`,
					tools: [],
				};
				stepByGroup.set(groupId, step);
				steps.push(step);
			}
			const step = stepByGroup.get(groupId)!;

			if (event.type === "preamble" && event.content?.trim() && event.toolCallId) {
				pendingPreambles.set(event.toolCallId, event.content.trim());
			} else if (event.type === "tool_start") {
				const tc = toUnifiedFromEvent(event);
				const p = pendingPreambles.get(tc.id);
				if (p) {
					tc.preamble = p;
					pendingPreambles.delete(tc.id);
				}
				step.tools.push(tc);
			}
		}
	} else {
		// Fallback: all events belong to one step (no boundary info available)
		const step: TimelineStep = { id: "step-0", tools: [] };
		for (const event of rawEvents) {
			if (event.type === "preamble" && event.content?.trim() && event.toolCallId) {
				pendingPreambles.set(event.toolCallId, event.content.trim());
			} else if (event.type === "tool_start") {
				const tc = toUnifiedFromEvent(event);
				const p = pendingPreambles.get(tc.id);
				if (p) {
					tc.preamble = p;
					pendingPreambles.delete(tc.id);
				}
				step.tools.push(tc);
			} else if (event.type === "tool_end") {
				const tool = step.tools.find((t) => t.id === event.toolCallId);
				if (tool) {
					tool.status = event.status ?? "completed";
					tool.output = event.output;
				}
			}
		}
		if (step.tools.length > 0) steps.push(step);
	}

	return foldSubAgentChildren(steps);
}

export function buildStepsFromToolCalls(calls: ToolCallState[] | undefined): TimelineStep[] {
	if (!calls || calls.length === 0) return [];
	const step: TimelineStep = { id: "step-0", tools: [] };
	// Deduplicate identical preamble texts: when checkpoint replay assigns the
	// same flat-string content to all tool calls in a message, only the first
	// tool in that group keeps the preamble so it isn't shown N times.
	const seenPreambles = new Set<string>();
	for (const tc of calls) {
		const preambleText = tc.preamble?.trim() || undefined;
		const preamble = preambleText && !seenPreambles.has(preambleText) ? preambleText : undefined;
		if (preamble) seenPreambles.add(preamble);
		step.tools.push({
			id: tc.id,
			name: tc.name,
			preamble,
			input: tc.input,
			output: tc.output,
			status: tc.status,
			subAgentName: tc.subAgentName,
			parentToolCallId: tc.parentToolCallId,
		});
	}
	return foldSubAgentChildren([step]);
}

/**
 * Folds subagent tool calls under their parent `task` call, matching parents
 * **globally across all steps** (not just within a step). During streaming a
 * subagent's child tool calls and its parent `task` call can land in different
 * steps (the child events inherit the subagent's timeline group unless corrected
 * upstream), so folding must look across step boundaries. Each tool with a
 * `parentToolCallId` matching a `task` call anywhere is moved into that call's
 * `children` array and removed from its own step; a step left empty by this is
 * dropped so no phantom timeline node remains. Children whose parent is not found
 * anywhere are left flat (rendered with a `via <name>` chip), so nothing silently
 * disappears.
 */
export function foldSubAgentChildren(steps: TimelineStep[]): TimelineStep[] {
	// Index every tool by id across all steps so a child can find its parent
	// regardless of which step the parent landed in.
	const byId = new Map<string, UnifiedToolCall>();
	for (const step of steps) {
		for (const tool of step.tools) byId.set(tool.id, tool);
	}

	const nested = new Set<string>();
	for (const step of steps) {
		for (const tool of step.tools) {
			if (!tool.parentToolCallId) continue;
			const parent = byId.get(tool.parentToolCallId);
			if (!parent) continue; // orphan → leave flat
			(parent.children ??= []).push(tool);
			nested.add(tool.id);
		}
	}

	if (nested.size === 0) return steps;

	// Remove folded children from their steps and drop any step that becomes empty.
	// Preambles now live on the tool itself so they travel with the fold automatically.
	const result: TimelineStep[] = [];
	for (const step of steps) {
		const tools = step.tools.filter((t) => !nested.has(t.id));
		if (tools.length === 0) continue;
		result.push({ ...step, tools });
	}
	return result;
}

/**
 * Display label for a tool card. A `task` call that delegated to a subagent shows
 * the subagent's name; everything else uses the raw tool name. The subagent name is
 * shown verbatim — do NOT strip a trailing " (isolated)", because that can be part of
 * a real, user-configured agent name (e.g. an agent literally named "Foo (isolated)"),
 * and stripping it mislabels the card as a different agent.
 */
export function toolDisplayName(tool: UnifiedToolCall): string {
	if (tool.name === "task" && tool.subAgentName) {
		return tool.subAgentName;
	}
	return tool.name;
}
