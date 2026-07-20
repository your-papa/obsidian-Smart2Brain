import { describe, it, expect } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
	buildCheckpointGraph,
	deriveMessagePairsFromActiveCheckpoint,
	baseMessagesToMessagePairs,
	baseMessageToAssistantMessage,
	AssistantState,
	type CheckpointGraphState,
} from "../../src/stores/chatStore.svelte";
import type { CheckpointHistoryItem } from "../../src/agent/Agent";

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------*/

function humanMsg(content: string, id?: string) {
	return new HumanMessage({ content, id: id ?? `human-${Date.now()}-${Math.random()}` });
}

function aiMsg(content: string, id?: string) {
	return new AIMessage({ content, id: id ?? `ai-${Date.now()}-${Math.random()}` });
}

function aiMsgWithToolCalls(
	content: string,
	toolCalls: { id: string; name: string; args: Record<string, unknown> }[],
	id?: string,
) {
	return new AIMessage({
		content,
		id: id ?? `ai-${Date.now()}-${Math.random()}`,
		tool_calls: toolCalls,
	});
}

function toolMsg(content: string, toolCallId: string) {
	return new ToolMessage({ content, tool_call_id: toolCallId });
}

function makeCheckpoint(
	checkpointId: string,
	step: number,
	messages: ReturnType<typeof humanMsg>[],
	parentCheckpointId?: string,
	ts?: string,
): CheckpointHistoryItem {
	return {
		checkpointId,
		step,
		messages,
		parentCheckpointId,
		ts,
	};
}

/* --------------------------------------------------------------------------
 * buildCheckpointGraph
 * ------------------------------------------------------------------------*/

describe("buildCheckpointGraph", () => {
	it("should create an empty graph from no checkpoints", () => {
		const graph = buildCheckpointGraph([]);
		expect(graph.nodes.size).toBe(0);
		expect(graph.rootCheckpointId).toBeUndefined();
	});

	it("should create a single-node graph", () => {
		const graph = buildCheckpointGraph([makeCheckpoint("cp-1", 0, [])]);
		expect(graph.nodes.size).toBe(1);
		expect(graph.rootCheckpointId).toBe("cp-1");
		expect(graph.nodes.get("cp-1")?.children).toEqual([]);
	});

	it("should create a linear chain of checkpoints", () => {
		const graph = buildCheckpointGraph([
			makeCheckpoint("cp-1", 0, [], undefined, "2024-01-01T00:00:00Z"),
			makeCheckpoint("cp-2", 1, [], "cp-1", "2024-01-01T00:01:00Z"),
			makeCheckpoint("cp-3", 2, [], "cp-2", "2024-01-01T00:02:00Z"),
		]);

		expect(graph.nodes.size).toBe(3);
		expect(graph.rootCheckpointId).toBe("cp-1");
		expect(graph.nodes.get("cp-1")?.children).toEqual(["cp-2"]);
		expect(graph.nodes.get("cp-2")?.children).toEqual(["cp-3"]);
		expect(graph.nodes.get("cp-3")?.children).toEqual([]);
	});

	it("should handle a fork (branching) from a single parent", () => {
		const graph = buildCheckpointGraph([
			makeCheckpoint("root", -1, [], undefined, "2024-01-01T00:00:00Z"),
			makeCheckpoint("branch-a", 0, [], "root", "2024-01-01T00:01:00Z"),
			makeCheckpoint("branch-b", 0, [], "root", "2024-01-01T00:02:00Z"),
		]);

		expect(graph.rootCheckpointId).toBe("root");
		const rootNode = graph.nodes.get("root");
		expect(rootNode?.children).toHaveLength(2);
		expect(rootNode?.children).toContain("branch-a");
		expect(rootNode?.children).toContain("branch-b");
	});

	it("should sort children lexicographically", () => {
		const graph = buildCheckpointGraph([
			makeCheckpoint("root", -1, [], undefined, "2024-01-01T00:00:00Z"),
			makeCheckpoint("z-child", 0, [], "root"),
			makeCheckpoint("a-child", 0, [], "root"),
			makeCheckpoint("m-child", 0, [], "root"),
		]);

		const rootNode = graph.nodes.get("root");
		expect(rootNode?.children).toEqual(["a-child", "m-child", "z-child"]);
	});

	it("should handle multiple detached roots by linking them", () => {
		const graph = buildCheckpointGraph([
			makeCheckpoint("root-a", 0, [], undefined, "2024-01-01T00:00:00Z"),
			makeCheckpoint("root-b", 0, [], undefined, "2024-01-01T00:01:00Z"),
		]);

		// One should become the canonical root, the other should be its child
		expect(graph.rootCheckpointId).toBeDefined();
		const rootNode = graph.nodes.get(graph.rootCheckpointId!);
		expect(rootNode).toBeDefined();
		expect(rootNode!.children.length).toBeGreaterThanOrEqual(1);
	});
});

/* --------------------------------------------------------------------------
 * baseMessageToAssistantMessage
 * ------------------------------------------------------------------------*/

describe("baseMessageToAssistantMessage", () => {
	it("should convert a simple AI message to AssistantMessage", () => {
		const msg = aiMsg("Hello, how can I help?");
		const result = baseMessageToAssistantMessage(msg);

		expect(result.state).toBe(AssistantState.success);
		expect(result.content).toBe("Hello, how can I help?");
		expect(result.toolCalls).toBeUndefined();
	});

	it("should convert an AI message with tool calls", () => {
		const msg = aiMsgWithToolCalls("Let me search for that", [
			{ id: "tc-1", name: "search_notes", args: { query: "test" } },
		]);

		const result = baseMessageToAssistantMessage(msg);

		expect(result.content).toBe("Let me search for that");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls![0].name).toBe("search_notes");
		expect(result.toolCalls![0].input).toEqual({ query: "test" });
		expect(result.toolCalls![0].status).toBe("completed");
	});

	it("should apply tool outputs from tool messages", () => {
		const msg = aiMsgWithToolCalls("", [{ id: "tc-1", name: "search_notes", args: { query: "test" } }]);

		const toolOutputs = new Map([
			["tc-1", { content: "Found 3 results", status: "completed" as const }],
		]);

		const result = baseMessageToAssistantMessage(msg, toolOutputs);

		expect(result.toolCalls![0].output).toBe("Found 3 results");
		expect(result.toolCalls![0].status).toBe("completed");
	});

	it("should mark failed tool outputs", () => {
		const msg = aiMsgWithToolCalls("", [{ id: "tc-1", name: "read_content", args: { path: "missing.md" } }]);

		const toolOutputs = new Map([
			["tc-1", { content: "File not found", status: "failed" as const }],
		]);

		const result = baseMessageToAssistantMessage(msg, toolOutputs);

		expect(result.toolCalls![0].status).toBe("failed");
	});

	it("should respect state override", () => {
		const msg = aiMsg("test");
		const result = baseMessageToAssistantMessage(msg, undefined, AssistantState.error);

		expect(result.state).toBe(AssistantState.error);
	});

	it("should handle empty AI message content", () => {
		const msg = aiMsg("");
		const result = baseMessageToAssistantMessage(msg);

		expect(result.content).toBe("");
		expect(result.state).toBe(AssistantState.success);
	});

	it("labels a reconstructed task call with its subagent name", () => {
		const msg = aiMsgWithToolCalls("Delegating", [
			{ id: "task-1", name: "task", args: { subagent_type: "Web Search", description: "search" } },
		]);

		const result = baseMessageToAssistantMessage(msg);

		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls![0].name).toBe("task");
		expect(result.toolCalls![0].subAgentName).toBe("Web Search");
	});

	it("does not set subAgentName on ordinary (non-task) tool calls", () => {
		const msg = aiMsgWithToolCalls("", [{ id: "tc-1", name: "search_notes", args: { query: "x" } }]);
		const result = baseMessageToAssistantMessage(msg);
		expect(result.toolCalls![0].subAgentName).toBeUndefined();
	});
});

/* --------------------------------------------------------------------------
 * baseMessagesToMessagePairs
 * ------------------------------------------------------------------------*/

describe("baseMessagesToMessagePairs", () => {
	it("should return empty array for empty messages", () => {
		expect(baseMessagesToMessagePairs([])).toEqual([]);
		expect(baseMessagesToMessagePairs(null as unknown as [])).toEqual([]);
	});

	it("should pair a single human message with an empty assistant", () => {
		const msgs = [humanMsg("Hello")];
		const pairs = baseMessagesToMessagePairs(msgs);

		expect(pairs).toHaveLength(1);
		expect(pairs[0].userMessage.content).toBe("Hello");
		expect(pairs[0].assistantMessage.state).toBe(AssistantState.cancelled);
		expect(pairs[0].assistantMessage.content).toBe("");
	});

	it("should pair human and AI messages together", () => {
		const msgs = [humanMsg("What is AI?"), aiMsg("AI stands for Artificial Intelligence")];
		const pairs = baseMessagesToMessagePairs(msgs);

		expect(pairs).toHaveLength(1);
		expect(pairs[0].userMessage.content).toBe("What is AI?");
		expect(pairs[0].assistantMessage.content).toBe("AI stands for Artificial Intelligence");
		expect(pairs[0].assistantMessage.state).toBe(AssistantState.success);
	});

	it("should handle multi-turn conversation", () => {
		const msgs = [
			humanMsg("Hello"),
			aiMsg("Hi there!"),
			humanMsg("How are you?"),
			aiMsg("I'm doing well!"),
		];
		const pairs = baseMessagesToMessagePairs(msgs);

		expect(pairs).toHaveLength(2);
		expect(pairs[0].userMessage.content).toBe("Hello");
		expect(pairs[0].assistantMessage.content).toBe("Hi there!");
		expect(pairs[1].userMessage.content).toBe("How are you?");
		expect(pairs[1].assistantMessage.content).toBe("I'm doing well!");
	});

	it("should merge consecutive AI messages (tool call + final response)", () => {
		const msgs = [
			humanMsg("Search for notes about AI"),
			aiMsgWithToolCalls("Let me search", [
				{ id: "tc-1", name: "search_notes", args: { query: "AI" } },
			]),
			toolMsg("Found: AI.md, ML.md", "tc-1"),
			aiMsg("I found two relevant notes: AI.md and ML.md"),
		];
		const pairs = baseMessagesToMessagePairs(msgs);

		expect(pairs).toHaveLength(1);
		expect(pairs[0].assistantMessage.content).toBe("I found two relevant notes: AI.md and ML.md");
		expect(pairs[0].assistantMessage.toolCalls).toHaveLength(1);
		expect(pairs[0].assistantMessage.toolCalls![0].name).toBe("search_notes");
	});

	it("should mark last pair as error when errorCount > 0 and no assistant response", () => {
		const msgs = [humanMsg("Hello"), aiMsg("Hi"), humanMsg("Search")];
		const pairs = baseMessagesToMessagePairs(msgs, 1);

		expect(pairs).toHaveLength(2);
		expect(pairs[0].assistantMessage.state).toBe(AssistantState.success);
		expect(pairs[1].assistantMessage.state).toBe(AssistantState.error);
	});

	it("should attach lastErrorMessage to the most-recent error pair as errorCode", () => {
		const msgs = [humanMsg("Hello"), aiMsg("Hi"), humanMsg("Search")];
		const pairs = baseMessagesToMessagePairs(msgs, 1, undefined, "Model does not fit under the memory ceiling.");

		expect(pairs[1].assistantMessage.state).toBe(AssistantState.error);
		expect(pairs[1].assistantMessage.errorCode).toBe("Model does not fit under the memory ceiling.");
		// The earlier, successful pair carries no error code.
		expect(pairs[0].assistantMessage.errorCode).toBeUndefined();
	});

	it("should leave errorCode undefined for error pairs when no lastErrorMessage is provided", () => {
		const msgs = [humanMsg("Search")];
		const pairs = baseMessagesToMessagePairs(msgs, 1);

		expect(pairs[0].assistantMessage.state).toBe(AssistantState.error);
		expect(pairs[0].assistantMessage.errorCode).toBeUndefined();
	});

	it("attaches lastErrorMessage to the newest error pair even when errorCount overcounts", () => {
		// errorCount is thread-wide (all branches); the active path here has a
		// single trailing error turn. The message must still land on it rather
		// than being lost because the count-down never reached exactly zero.
		const msgs = [humanMsg("Hello"), aiMsg("Hi"), humanMsg("Search")];
		const pairs = baseMessagesToMessagePairs(msgs, 3, undefined, "boom");

		expect(pairs[1].assistantMessage.state).toBe(AssistantState.error);
		expect(pairs[1].assistantMessage.errorCode).toBe("boom");
	});

	it("should mark as cancelled when no response and errorCount is 0", () => {
		const msgs = [humanMsg("Hello")];
		const pairs = baseMessagesToMessagePairs(msgs, 0);

		expect(pairs[0].assistantMessage.state).toBe(AssistantState.cancelled);
	});

	it("should handle orphaned assistant message (no preceding user message)", () => {
		const msgs = [aiMsg("Orphaned response")];
		const pairs = baseMessagesToMessagePairs(msgs);

		expect(pairs).toHaveLength(1);
		expect(pairs[0].userMessage.content).toBe("");
		expect(pairs[0].assistantMessage.content).toBe("Orphaned response");
	});

	it("should preserve user message attachments", () => {
		const h = new HumanMessage({
			content: "Check this",
			id: "h-1",
			additional_kwargs: {
				attachments: [{ name: "test.pdf", mimeType: "application/pdf", vaultPath: "files/test.pdf" }],
			},
		});
		const pairs = baseMessagesToMessagePairs([h, aiMsg("Done")]);

		expect(pairs[0].userMessage.attachments).toHaveLength(1);
		expect(pairs[0].userMessage.attachments![0].name).toBe("test.pdf");
	});

	it("should hide synthetic summarization messages from the transcript", () => {
		const summary = new HumanMessage({
			content: "Previous conversation summary\n\nUser asked about project scope.",
			id: "summary-1",
			additional_kwargs: { lc_source: "summarization" },
		});
		const msgs = [summary, humanMsg("What did we decide?"), aiMsg("We decided to ship summarization.")];
		const pairs = baseMessagesToMessagePairs(msgs);

		expect(pairs).toHaveLength(2);
		expect(pairs[0].transcriptEvent?.type).toBe("summarization_marker");
		expect(pairs[0].transcriptEvent?.source).toBe("summarization");
		expect(pairs[1].userMessage.content).toBe("What did we decide?");
		expect(pairs[1].assistantMessage.content).toBe("We decided to ship summarization.");
	});

	it("should hide manual summarization maintenance turns from the transcript", () => {
		const maintenance = new HumanMessage({
			content: "Summarize older conversation history now.",
			id: "maintenance-1",
			additional_kwargs: { lc_source: "manual_summarization" },
		});
		const msgs = [humanMsg("Hello"), aiMsg("Hi"), maintenance, aiMsg("Context compacted."), humanMsg("Continue"), aiMsg("Done")];
		const pairs = baseMessagesToMessagePairs(msgs);

		expect(pairs).toHaveLength(3);
		expect(pairs[0].userMessage.content).toBe("Hello");
		expect(pairs[0].assistantMessage.content).toBe("Hi");
		expect(pairs[1].transcriptEvent?.type).toBe("summarization_marker");
		expect(pairs[1].transcriptEvent?.source).toBe("manual_summarization");
		expect(pairs[2].userMessage.content).toBe("Continue");
		expect(pairs[2].assistantMessage.content).toBe("Done");
	});

	it("should collapse adjacent summarization sources into a single transcript marker", () => {
		const autoSummary = new HumanMessage({
			content: "Previous conversation summary",
			id: "summary-1",
			additional_kwargs: { lc_source: "summarization" },
		});
		const manualSummary = new HumanMessage({
			content: "Context compacted",
			id: "summary-2",
			additional_kwargs: { lc_source: "manual_summarization" },
		});
		const msgs = [humanMsg("Hello"), aiMsg("Hi"), autoSummary, aiMsg("Summary A"), manualSummary, aiMsg("Summary B")];
		const pairs = baseMessagesToMessagePairs(msgs);

		expect(pairs).toHaveLength(2);
		expect(pairs[1].transcriptEvent?.type).toBe("summarization_marker");
		expect(pairs[1].transcriptEvent?.source).toBe("manual_summarization");
		expect(pairs[1].transcriptEvent?.label).toBe("Conversation compacted here");
	});

	it("should assign unique UUIDv7 IDs to each pair", () => {
		const msgs = [
			humanMsg("A"),
			aiMsg("B"),
			humanMsg("C"),
			aiMsg("D"),
		];
		const pairs = baseMessagesToMessagePairs(msgs);

		const ids = pairs.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

/* --------------------------------------------------------------------------
 * deriveMessagePairsFromActiveCheckpoint
 * ------------------------------------------------------------------------*/

describe("deriveMessagePairsFromActiveCheckpoint", () => {
	it("should return empty for undefined activeCheckpointId", () => {
		const graph: CheckpointGraphState = { nodes: new Map() };
		const pairs = deriveMessagePairsFromActiveCheckpoint(graph, undefined);
		expect(pairs).toEqual([]);
	});

	it("should return empty for non-existent activeCheckpointId", () => {
		const graph: CheckpointGraphState = { nodes: new Map() };
		const pairs = deriveMessagePairsFromActiveCheckpoint(graph, "nonexistent");
		expect(pairs).toEqual([]);
	});

	it("should derive message pairs from the active checkpoint's messages", () => {
		const h = humanMsg("Hello", "h-1");
		const a = aiMsg("Hi!", "a-1");

		const graph = buildCheckpointGraph([
			makeCheckpoint("cp-root", -1, []),
			makeCheckpoint("cp-1", 0, [h], "cp-root", "2024-01-01T00:01:00Z"),
			makeCheckpoint("cp-2", 1, [h, a], "cp-1", "2024-01-01T00:02:00Z"),
		]);
		graph.activeCheckpointId = "cp-2";

		const pairs = deriveMessagePairsFromActiveCheckpoint(graph, "cp-2");
		expect(pairs).toHaveLength(1);
		expect(pairs[0].userMessage.content).toBe("Hello");
		expect(pairs[0].assistantMessage.content).toBe("Hi!");
	});

	it("should use bootstrap messages as fallback when checkpoint is invalid", () => {
		const graph: CheckpointGraphState = { nodes: new Map() };
		const bootstrap = [humanMsg("Fallback"), aiMsg("Response")];
		const pairs = deriveMessagePairsFromActiveCheckpoint(graph, "missing", 0, bootstrap);

		expect(pairs).toHaveLength(1);
		expect(pairs[0].userMessage.content).toBe("Fallback");
	});

	it("should populate checkpoint IDs for branching operations", () => {
		const h = humanMsg("Hello", "h-1");
		const a = aiMsg("Hi!", "a-1");

		const graph = buildCheckpointGraph([
			makeCheckpoint("cp-root", -1, []),
			makeCheckpoint("cp-human", 0, [h], "cp-root", "2024-01-01T00:01:00Z"),
			makeCheckpoint("cp-ai", 1, [h, a], "cp-human", "2024-01-01T00:02:00Z"),
		]);
		graph.activeCheckpointId = "cp-ai";

		const pairs = deriveMessagePairsFromActiveCheckpoint(graph, "cp-ai");
		expect(pairs).toHaveLength(1);
		// regenerateFromCheckpointId should be the checkpoint where human message is last
		expect(pairs[0].regenerateFromCheckpointId).toBe("cp-human");
		// editFromCheckpointId should be the root (checkpoint before the human message)
		expect(pairs[0].editFromCheckpointId).toBe("cp-root");
	});
});

/* --------------------------------------------------------------------------
 * Branch info derivation
 * ------------------------------------------------------------------------*/

describe("branch info derivation", () => {
	it("should detect regenerate branches (multiple children after human checkpoint)", () => {
		const h = humanMsg("Hello", "h-1");
		const a1 = aiMsg("Response A", "a-1");
		const a2 = aiMsg("Response B", "a-2");

		const graph = buildCheckpointGraph([
			makeCheckpoint("cp-root", -1, []),
			makeCheckpoint("cp-human", 0, [h], "cp-root", "2024-01-01T00:01:00Z"),
			makeCheckpoint("cp-ai-1", 1, [h, a1], "cp-human", "2024-01-01T00:02:00Z"),
			makeCheckpoint("cp-ai-2", 1, [h, a2], "cp-human", "2024-01-01T00:03:00Z"),
		]);
		graph.activeCheckpointId = "cp-ai-1";

		const pairs = deriveMessagePairsFromActiveCheckpoint(graph, "cp-ai-1");
		expect(pairs).toHaveLength(1);
		// The assistant should have branch info since there are two responses
		expect(pairs[0].assistantBranchInfo).toBeDefined();
		expect(pairs[0].assistantBranchInfo!.totalBranches).toBe(2);
	});

	it("should detect edit branches (multiple children after AI checkpoint)", () => {
		const h1 = humanMsg("Original", "h-1");
		const a1 = aiMsg("Response to original", "a-1");
		const h2 = humanMsg("Edited", "h-2");
		const a2 = aiMsg("Response to edit", "a-2");

		const graph = buildCheckpointGraph([
			makeCheckpoint("cp-root", -1, [], undefined, "2024-01-01T00:00:00Z"),
			makeCheckpoint("cp-h1", 0, [h1], "cp-root", "2024-01-01T00:01:00Z"),
			makeCheckpoint("cp-a1", 1, [h1, a1], "cp-h1", "2024-01-01T00:02:00Z"),
			// Edit branch: fork from root with a different human message
			makeCheckpoint("cp-h2", 0, [h2], "cp-root", "2024-01-01T00:03:00Z"),
			makeCheckpoint("cp-a2", 1, [h2, a2], "cp-h2", "2024-01-01T00:04:00Z"),
		]);
		graph.activeCheckpointId = "cp-a2";

		const pairs = deriveMessagePairsFromActiveCheckpoint(graph, "cp-a2");
		expect(pairs).toHaveLength(1);
		expect(pairs[0].userMessage.content).toBe("Edited");
		// Should have user branch info since there are two edit branches
		expect(pairs[0].userBranchInfo).toBeDefined();
		expect(pairs[0].userBranchInfo!.totalBranches).toBe(2);
	});
});

/* --------------------------------------------------------------------------
 * chatHistoryContainsPrivateNotes — skipped (depends on pendingChangesStore singleton)
 * getMessagePairTimestamp
 * ------------------------------------------------------------------------*/

describe("AssistantState enum", () => {
	it("should define all expected states", () => {
		expect(AssistantState.idle).toBe(0);
		expect(AssistantState.streaming).toBe(1);
		expect(AssistantState.success).toBe(2);
		expect(AssistantState.error).toBe(3);
		expect(AssistantState.cancelled).toBe(4);
	});
});

/* --------------------------------------------------------------------------
 * baseMessagesToMessagePairs — subagent AIMessage attribution
 * ------------------------------------------------------------------------*/

describe("baseMessagesToMessagePairs — subagent AIMessage attribution", () => {
	it("folds subagent AIMessage tool calls under their parent task call", () => {
		// Reproduces the deepagents checkpoint pattern:
		//   HumanMessage
		//   AIMessage: task(A), task(B), task(C)
		//   ToolMessage(A) ToolMessage(B) ToolMessage(C)
		//   AIMessage (subagent 1): list_directory, search_notes  ← should get parentToolCallId=A
		//   ToolMessage(list_dir) ToolMessage(search_notes)
		//   AIMessage: final answer (no tool calls)
		const taskIdA = "task-A";
		const taskIdB = "task-B";
		const taskIdC = "task-C";

		const parentAI = new AIMessage({
			id: "parent-ai-1",
			content: "",
			tool_calls: [
				{ id: taskIdA, name: "task", args: { subagent_type: "researcher" } },
				{ id: taskIdB, name: "task", args: { subagent_type: "researcher" } },
				{ id: taskIdC, name: "task", args: { subagent_type: "researcher" } },
			],
		});
		const subAgentAI = new AIMessage({
			id: "subagent-ai-1",
			content: "",
			tool_calls: [
				{ id: "list-dir-1", name: "list_directory", args: {} },
				{ id: "search-1", name: "search_notes", args: { query: "test" } },
			],
		});
		const finalAI = new AIMessage({ id: "final-ai", content: "Here is my answer." });

		const messages = [
			new HumanMessage({ id: "human-1", content: "explore my notes" }),
			parentAI,
			new ToolMessage({ content: "task A result", tool_call_id: taskIdA }),
			new ToolMessage({ content: "task B result", tool_call_id: taskIdB }),
			new ToolMessage({ content: "task C result", tool_call_id: taskIdC }),
			subAgentAI,
			new ToolMessage({ content: "dir listing", tool_call_id: "list-dir-1" }),
			new ToolMessage({ content: "search results", tool_call_id: "search-1" }),
			finalAI,
		];

		const pairs = baseMessagesToMessagePairs(messages);
		expect(pairs).toHaveLength(1);

		const { toolCalls } = pairs[0].assistantMessage;
		expect(toolCalls).toBeDefined();

		// Parent's task calls should have no parentToolCallId
		const taskCalls = toolCalls!.filter((tc) => tc.name === "task");
		expect(taskCalls).toHaveLength(3);
		for (const tc of taskCalls) {
			expect(tc.parentToolCallId).toBeUndefined();
		}

		// Subagent's tool calls should have parentToolCallId = taskIdA (FIFO: A has fewest children)
		const subagentCalls = toolCalls!.filter((tc) => tc.name !== "task");
		expect(subagentCalls).toHaveLength(2);
		for (const tc of subagentCalls) {
			expect(tc.parentToolCallId).toBe(taskIdA);
		}

		// Final answer — content should be preserved
		expect(pairs[0].assistantMessage.content).toBe("Here is my answer.");
	});

	it("assigns multiple subagent AIMessages round-robin across tasks", () => {
		const taskIdD = "task-D";
		const taskIdE = "task-E";

		const parentAI = new AIMessage({
			id: "parent-ai-2",
			content: "",
			tool_calls: [
				{ id: taskIdD, name: "task", args: { subagent_type: "analyst" } },
				{ id: taskIdE, name: "task", args: { subagent_type: "analyst" } },
			],
		});
		const subAgentAI1 = new AIMessage({
			id: "sub-ai-1",
			content: "",
			tool_calls: [{ id: "search-D1", name: "search_notes", args: {} }],
		});
		const subAgentAI2 = new AIMessage({
			id: "sub-ai-2",
			content: "",
			tool_calls: [{ id: "search-E1", name: "search_notes", args: {} }],
		});
		const finalAI = new AIMessage({ id: "final-ai-2", content: "Done." });

		const messages = [
			new HumanMessage({ id: "h2", content: "analyze notes" }),
			parentAI,
			new ToolMessage({ content: "D result", tool_call_id: taskIdD }),
			new ToolMessage({ content: "E result", tool_call_id: taskIdE }),
			subAgentAI1,
			new ToolMessage({ content: "search result D", tool_call_id: "search-D1" }),
			subAgentAI2,
			new ToolMessage({ content: "search result E", tool_call_id: "search-E1" }),
			finalAI,
		];

		const pairs = baseMessagesToMessagePairs(messages);
		const { toolCalls } = pairs[0].assistantMessage;
		expect(toolCalls).toBeDefined();

		const sub1 = toolCalls!.find((tc) => tc.id === "search-D1");
		const sub2 = toolCalls!.find((tc) => tc.id === "search-E1");
		expect(sub1?.parentToolCallId).toBe(taskIdD);  // FIFO: D first
		expect(sub2?.parentToolCallId).toBe(taskIdE);  // FIFO: E second (D already has 1 child)
	});

	it("does not attribute final-answer AIMessage (no tool calls) as subagent", () => {
		const taskId = "task-X";
		const parentAI = new AIMessage({
			id: "parent-ai-x",
			content: "",
			tool_calls: [{ id: taskId, name: "task", args: {} }],
		});
		const finalAI = new AIMessage({ id: "final-x", content: "Final answer." });

		const messages = [
			new HumanMessage({ id: "hx", content: "do something" }),
			parentAI,
			new ToolMessage({ content: "task result", tool_call_id: taskId }),
			finalAI,
		];

		const pairs = baseMessagesToMessagePairs(messages);
		const { toolCalls, content } = pairs[0].assistantMessage;

		// Only the parent task call should appear — final AI produces no tool calls
		const allCalls = toolCalls ?? [];
		const withParent = allCalls.filter((tc) => tc.parentToolCallId !== undefined);
		expect(withParent).toHaveLength(0);
		expect(content).toBe("Final answer.");
	});

	it("handles sequential task dispatch: one task per parent turn", () => {
		// Reproduces the actual pattern observed in checkpoints:
		//   AI: task(A) → TOOL(A) → AI: task(B) → TOOL(B) → AI: task(C) → TOOL(C)
		//   AI (subagent 1): search_notes  ← from task A
		//   TOOL(search)
		//   AI (subagent 2): list_directory  ← from task B
		//   TOOL(list_dir)
		//   AI (subagent 3): search_notes  ← from task C
		//   TOOL(search2)
		//   AI: final answer
		const taskIdA = "seq-task-A";
		const taskIdB = "seq-task-B";
		const taskIdC = "seq-task-C";

		const messages = [
			new HumanMessage({ id: "seq-human", content: "use subagents" }),
			new AIMessage({ id: "seq-parent-1", content: "", tool_calls: [{ id: taskIdA, name: "task", args: {} }] }),
			new ToolMessage({ content: "A done", tool_call_id: taskIdA }),
			new AIMessage({ id: "seq-parent-2", content: "", tool_calls: [{ id: taskIdB, name: "task", args: {} }] }),
			new ToolMessage({ content: "B done", tool_call_id: taskIdB }),
			new AIMessage({ id: "seq-parent-3", content: "", tool_calls: [{ id: taskIdC, name: "task", args: {} }] }),
			new ToolMessage({ content: "C done", tool_call_id: taskIdC }),
			new AIMessage({ id: "sub-seq-1", content: "", tool_calls: [{ id: "search-seq-1", name: "search_notes", args: {} }] }),
			new ToolMessage({ content: "r1", tool_call_id: "search-seq-1" }),
			new AIMessage({ id: "sub-seq-2", content: "", tool_calls: [{ id: "list-seq-1", name: "list_directory", args: {} }] }),
			new ToolMessage({ content: "r2", tool_call_id: "list-seq-1" }),
			new AIMessage({ id: "sub-seq-3", content: "", tool_calls: [{ id: "search-seq-2", name: "search_notes", args: {} }] }),
			new ToolMessage({ content: "r3", tool_call_id: "search-seq-2" }),
			new AIMessage({ id: "seq-final", content: "Sequential done." }),
		];

		const pairs = baseMessagesToMessagePairs(messages);
		const { toolCalls } = pairs[0].assistantMessage;
		expect(toolCalls).toBeDefined();

		// Task calls have no parent
		const taskCalls = toolCalls!.filter((tc) => tc.name === "task");
		expect(taskCalls).toHaveLength(3);
		for (const tc of taskCalls) expect(tc.parentToolCallId).toBeUndefined();

		// Subagent calls attributed round-robin: A→search-seq-1, B→list-seq-1, C→search-seq-2
		const sub1 = toolCalls!.find((tc) => tc.id === "search-seq-1");
		const sub2 = toolCalls!.find((tc) => tc.id === "list-seq-1");
		const sub3 = toolCalls!.find((tc) => tc.id === "search-seq-2");
		expect(sub1?.parentToolCallId).toBe(taskIdA);
		expect(sub2?.parentToolCallId).toBe(taskIdB);
		expect(sub3?.parentToolCallId).toBe(taskIdC);

		expect(pairs[0].assistantMessage.content).toBe("Sequential done.");
	});
});

describe("baseMessageToAssistantMessage — preamble extraction from content blocks", () => {
	it("extracts preamble text preceding a tool_use block on replay", () => {
		const msg = new AIMessage({
			id: "ai-preamble-1",
			content: [
				{ type: "text", text: "Let me search for that." },
				{ type: "tool_use", id: "call-1", name: "search_notes", input: { query: "test" } },
			],
			tool_calls: [{ id: "call-1", name: "search_notes", args: { query: "test" } }],
		});

		const result = baseMessageToAssistantMessage(msg);
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls![0].preamble).toBe("Let me search for that.");
	});

	it("assigns empty preamble when no text precedes a tool_use block", () => {
		const msg = new AIMessage({
			id: "ai-preamble-2",
			content: [
				{ type: "tool_use", id: "call-2", name: "list_directory", input: {} },
			],
			tool_calls: [{ id: "call-2", name: "list_directory", args: {} }],
		});

		const result = baseMessageToAssistantMessage(msg);
		expect(result.toolCalls![0].preamble).toBeUndefined();
	});

	it("assigns distinct preambles when multiple tool calls each have preceding text", () => {
		const msg = new AIMessage({
			id: "ai-preamble-3",
			content: [
				{ type: "text", text: "First I'll search." },
				{ type: "tool_use", id: "call-a", name: "search_notes", input: {} },
				{ type: "text", text: "Then I'll list." },
				{ type: "tool_use", id: "call-b", name: "list_directory", input: {} },
			],
			tool_calls: [
				{ id: "call-a", name: "search_notes", args: {} },
				{ id: "call-b", name: "list_directory", args: {} },
			],
		});

		const result = baseMessageToAssistantMessage(msg);
		expect(result.toolCalls![0].preamble).toBe("First I'll search.");
		expect(result.toolCalls![1].preamble).toBe("Then I'll list.");
	});

	it("emits preamble timeline events when preamble is present", () => {
		const msg = new AIMessage({
			id: "ai-preamble-4",
			content: [
				{ type: "text", text: "Thinking out loud." },
				{ type: "tool_use", id: "call-x", name: "search_notes", input: {} },
			],
			tool_calls: [{ id: "call-x", name: "search_notes", args: {} }],
		});

		const result = baseMessageToAssistantMessage(msg);
		const preambleEvent = result.assistantTimeline?.find((e) => e.type === "preamble");
		expect(preambleEvent).toBeDefined();
		expect(preambleEvent?.content).toBe("Thinking out loud.");
		expect(preambleEvent?.toolCallId).toBe("call-x");
	});
});
