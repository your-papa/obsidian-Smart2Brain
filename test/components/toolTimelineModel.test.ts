import { describe, expect, it } from "vitest";
import type { AssistantTimelineEvent } from "../../src/stores/chatStore.svelte";
import {
	buildStepsFromEvents,
	foldSubAgentChildren,
	groupStepTools,
	toolDisplayName,
	type TimelineStep,
	type UnifiedToolCall,
} from "../../src/components/chat/toolTimelineModel";

/** Convenience builder for timeline events with a shared aiMessageId group. */
function events(...evts: Partial<AssistantTimelineEvent>[]): AssistantTimelineEvent[] {
	return evts.map(
		(e, i) => ({ id: `e-${i}`, type: "tool_start", aiMessageId: "m1", ...e }) as AssistantTimelineEvent,
	);
}

describe("toolTimelineModel — subagent nesting", () => {
	it("folds subagent tool calls under their parent task call", () => {
		const timeline = events(
			{
				type: "tool_start",
				toolCallId: "task-1",
				toolName: "task",
				input: { subagent_type: "Web Search" },
				subAgentName: "Web Search",
			},
			{
				type: "tool_start",
				toolCallId: "child-a",
				toolName: "search_notes",
				subAgentName: "Web Search",
				parentToolCallId: "task-1",
			},
			{
				type: "tool_start",
				toolCallId: "child-b",
				toolName: "fetch_url",
				subAgentName: "Web Search",
				parentToolCallId: "task-1",
			},
			{ type: "tool_end", toolCallId: "child-a", toolName: "search_notes", output: "ok", status: "completed" },
			{ type: "tool_end", toolCallId: "child-b", toolName: "fetch_url", output: "ok", status: "completed" },
			{ type: "tool_end", toolCallId: "task-1", toolName: "task", output: "summary", status: "completed" },
		);

		const steps = buildStepsFromEvents(timeline);
		expect(steps).toHaveLength(1);

		// Only the task parent remains at the top level; children are folded in.
		const top = steps[0].tools;
		expect(top).toHaveLength(1);
		expect(top[0].id).toBe("task-1");
		expect(top[0].children?.map((c) => c.id)).toEqual(["child-a", "child-b"]);
		// Child statuses/outputs still reconcile from tool_end.
		expect(top[0].children?.every((c) => c.status === "completed")).toBe(true);
	});

	it("keeps main-agent tool calls flat and unattributed", () => {
		const timeline = events(
			{ type: "tool_start", toolCallId: "t1", toolName: "search_notes" },
			{ type: "tool_start", toolCallId: "t2", toolName: "read_content" },
		);
		const steps = buildStepsFromEvents(timeline);
		expect(steps[0].tools.map((t) => t.id)).toEqual(["t1", "t2"]);
		expect(steps[0].tools.every((t) => !t.subAgentName && !t.children)).toBe(true);
	});

	it("leaves orphaned children flat when their parent is missing", () => {
		// Child references a task call that isn't in this step (edge case).
		const step: TimelineStep = {
			id: "s0",
			tools: [
				{
					id: "orphan",
					name: "fetch_url",
					status: "completed",
					subAgentName: "Web Search",
					parentToolCallId: "missing-task",
				} as UnifiedToolCall,
			],
		};
		const folded = foldSubAgentChildren([step]);
		expect(folded[0].tools).toHaveLength(1);
		expect(folded[0].tools[0].id).toBe("orphan");
		expect(folded[0].tools[0].children).toBeUndefined();
	});

	it("folds subagent children under a parent in a DIFFERENT step and drops the emptied step", () => {
		// Streaming reality: the parent `task` call is stamped with the parent
		// model's aiMessageId ("A"), but a subagent's children can arrive stamped
		// with the subagent's aiMessageId ("B") → different steps. Global folding
		// must still nest them and remove the now-empty step B.
		const timeline: AssistantTimelineEvent[] = [
			{
				id: "e0",
				type: "tool_start",
				aiMessageId: "A",
				toolCallId: "task-1",
				toolName: "task",
				input: { subagent_type: "Web Search" },
				subAgentName: "Web Search",
			},
			{
				id: "e1",
				type: "tool_start",
				aiMessageId: "B",
				toolCallId: "child-a",
				toolName: "search_notes",
				subAgentName: "Web Search",
				parentToolCallId: "task-1",
			},
			{
				id: "e2",
				type: "tool_end",
				aiMessageId: "B",
				toolCallId: "child-a",
				toolName: "search_notes",
				output: "ok",
				status: "completed",
			},
			{
				id: "e3",
				type: "tool_end",
				aiMessageId: "A",
				toolCallId: "task-1",
				toolName: "task",
				output: "summary",
				status: "completed",
			},
		];

		const steps = buildStepsFromEvents(timeline);
		// Step B held only the child, which was folded away → step B is dropped.
		expect(steps).toHaveLength(1);
		expect(steps[0].id).toBe("step-A");
		expect(steps[0].tools).toHaveLength(1);
		expect(steps[0].tools[0].id).toBe("task-1");
		expect(steps[0].tools[0].children?.map((c) => c.id)).toEqual(["child-a"]);
		expect(steps[0].tools[0].children?.[0].status).toBe("completed");
	});

	it("labels task calls with their subagent name verbatim", () => {
		const parent: UnifiedToolCall = {
			id: "task-1",
			name: "task",
			status: "completed",
			subAgentName: "Note Scraper (isolated)",
		};
		// The subagent name is shown as-is — a trailing "(isolated)" may be part of a
		// real, user-configured agent name and must not be stripped.
		expect(toolDisplayName(parent)).toBe("Note Scraper (isolated)");
		// Non-task tools keep their raw name.
		expect(toolDisplayName({ id: "x", name: "search_notes", status: "completed" })).toBe("search_notes");
		// A task without a resolved subagent name falls back to the raw name.
		expect(toolDisplayName({ id: "y", name: "task", status: "completed" })).toBe("task");
	});

	it("attaches preamble to the tool it precedes (parallel tool calls each get same text)", () => {
		// Two tool calls in the same AIMessage, both preceded by the same preamble.
		const timeline = events(
			{ type: "preamble", toolCallId: "tc-1", content: "I'll search your notes.", aiMessageId: "m1" },
			{ type: "tool_start", toolCallId: "tc-1", toolName: "search_notes", aiMessageId: "m1" },
			{ type: "preamble", toolCallId: "tc-2", content: "I'll search your notes.", aiMessageId: "m1" },
			{ type: "tool_start", toolCallId: "tc-2", toolName: "search_notes", aiMessageId: "m1" },
		);
		const steps = buildStepsFromEvents(timeline);
		expect(steps).toHaveLength(1);
		expect(steps[0].tools).toHaveLength(2);
		expect(steps[0].tools[0].preamble).toBe("I'll search your notes.");
		expect(steps[0].tools[1].preamble).toBe("I'll search your notes.");
	});

	it("attaches distinct preambles to their respective tools", () => {
		const timeline = events(
			{ type: "preamble", toolCallId: "tc-1", content: "First thought.", aiMessageId: "m1" },
			{ type: "tool_start", toolCallId: "tc-1", toolName: "search_notes", aiMessageId: "m1" },
			{ type: "preamble", toolCallId: "tc-2", content: "Second thought.", aiMessageId: "m2" },
			{ type: "tool_start", toolCallId: "tc-2", toolName: "read_note", aiMessageId: "m2" },
		);
		const steps = buildStepsFromEvents(timeline);
		expect(steps).toHaveLength(2);
		expect(steps[0].tools[0].preamble).toBe("First thought.");
		expect(steps[1].tools[0].preamble).toBe("Second thought.");
		// Each step carries the aiMessageId it was grouped under — the UI uses this to
		// fold the current run once live content belongs to a newer message.
		expect(steps[0].aiMessageId).toBe("m1");
		expect(steps[1].aiMessageId).toBe("m2");
	});
});

describe("groupStepTools — merging consecutive same-tool calls", () => {
	const call = (id: string, name: string, extra: Partial<UnifiedToolCall> = {}): UnifiedToolCall => ({
		id,
		name,
		status: "completed",
		...extra,
	});

	it("merges consecutive same-tool calls into one group", () => {
		const groups = groupStepTools([call("1", "grep_notes"), call("2", "grep_notes"), call("3", "grep_notes")]);
		expect(groups).toHaveLength(1);
		expect(groups[0].merged).toBe(true);
		expect(groups[0].calls).toHaveLength(3);
		expect(groups[0].id).toBe("1");
		expect(groups[0].name).toBe("grep_notes");
	});

	it("keeps different tools in separate groups", () => {
		const groups = groupStepTools([call("1", "grep_notes"), call("2", "read_content")]);
		expect(groups).toHaveLength(2);
		expect(groups.every((g) => !g.merged)).toBe(true);
	});

	it("only merges adjacent runs (A A B A → three groups)", () => {
		const groups = groupStepTools([
			call("1", "search_notes"),
			call("2", "search_notes"),
			call("3", "read_content"),
			call("4", "search_notes"),
		]);
		expect(groups.map((g) => g.calls.length)).toEqual([2, 1, 1]);
		expect(groups.map((g) => g.merged)).toEqual([true, false, false]);
	});

	it("never merges task (subagent) calls", () => {
		const groups = groupStepTools([
			call("1", "task", { subAgentName: "Researcher" }),
			call("2", "task", { subAgentName: "Writer" }),
		]);
		expect(groups).toHaveLength(2);
		expect(groups.every((g) => !g.merged)).toBe(true);
	});

	it("never merges calls that carry subagent children", () => {
		const groups = groupStepTools([
			call("1", "search_notes", { children: [call("c1", "read_content")] }),
			call("2", "search_notes", { children: [call("c2", "read_content")] }),
		]);
		expect(groups).toHaveLength(2);
	});

	it("wraps a single call as an unmerged group of one", () => {
		const groups = groupStepTools([call("1", "read_content")]);
		expect(groups).toHaveLength(1);
		expect(groups[0].merged).toBe(false);
		expect(groups[0].calls).toHaveLength(1);
	});
});
