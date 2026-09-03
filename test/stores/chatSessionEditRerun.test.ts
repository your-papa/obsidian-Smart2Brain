import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { ChatSession } from "../../src/stores/chatStore.svelte";
import { buildCheckpointGraph, type CheckpointGraphState } from "../../src/stores/chatTimeline";
import { PendingChangesStore, initPendingChangesStore } from "../../src/stores/pendingChangesStore.svelte";
import type { ChatAttachment } from "../../src/types/shared";
import type { CheckpointHistoryItem } from "../../src/agent/Agent";

/* --------------------------------------------------------------------------
 * ChatSession × pendingChangesStore — edit/regenerate withdraws the replaced
 * response's pending proposals, and edits carry explicit attachments.
 *
 * The streaming methods are stubbed out (no live agent in unit tests); what is
 * exercised is everything editMessage/regenerateResponse does BEFORE streaming:
 * the pending-change withdrawal and the optimistic fork's message content.
 * ------------------------------------------------------------------------*/

const THREAD_ID = "Chats/Session Test.chat";

function humanMsg(content: string, id: string, attachments?: ChatAttachment[]) {
	return new HumanMessage({
		content,
		id,
		additional_kwargs: attachments ? { attachments } : undefined,
	});
}

function aiToolMsg(id: string, toolCallId: string) {
	return new AIMessage({ content: "", id, tool_calls: [{ id: toolCallId, name: "manage_notes", args: {} }] });
}

function toolMsg(toolCallId: string) {
	return new ToolMessage({ content: "staged", tool_call_id: toolCallId });
}

function checkpoint(
	checkpointId: string,
	step: number,
	messages: BaseMessage[],
	parentCheckpointId?: string,
): CheckpointHistoryItem {
	return { checkpointId, step, messages, parentCheckpointId, ts: new Date(2026, 0, 1, 0, step + 2).toISOString() };
}

const ATTACHMENT: ChatAttachment = { name: "Doc.md", mimeType: "text/markdown", vaultPath: "Doc.md" };

/**
 * Two full turns:
 *   turn 1 (h1) → ai1 stages via tc-1 → answer ai2
 *   turn 2 (h2, carries an attachment) → ai3 stages via tc-2 → answer ai4
 */
function buildTwoTurnGraph(): CheckpointGraphState {
	const h1 = humanMsg("turn one", "h1");
	const ai1 = aiToolMsg("ai1", "tc-1");
	const t1 = toolMsg("tc-1");
	const ai2 = new AIMessage({ content: "answer 1", id: "ai2" });
	const h2 = humanMsg("turn two", "h2", [ATTACHMENT]);
	const ai3 = aiToolMsg("ai3", "tc-2");
	const t2 = toolMsg("tc-2");
	const ai4 = new AIMessage({ content: "answer 2", id: "ai4" });

	const graph = buildCheckpointGraph([
		checkpoint("r", -1, []),
		checkpoint("a", 0, [h1], "r"),
		checkpoint("b", 1, [h1, ai1, t1, ai2], "a"),
		checkpoint("c", 2, [h1, ai1, t1, ai2, h2], "b"),
		checkpoint("d", 3, [h1, ai1, t1, ai2, h2, ai3, t2, ai4], "c"),
	]);
	graph.activeCheckpointId = "d";
	return graph;
}

function makeSession(): ChatSession {
	const session = new ChatSession(THREAD_ID, {
		graphState: buildTwoTurnGraph(),
		errorCount: 0,
		selectedAgentId: "",
	});
	// Stub the streaming tail — these tests end at the optimistic fork.
	const internals = session as unknown as {
		processEditReply: (...args: unknown[]) => Promise<void>;
		processRegenerateReply: (...args: unknown[]) => Promise<void>;
	};
	internals.processEditReply = vi.fn().mockResolvedValue(undefined);
	internals.processRegenerateReply = vi.fn().mockResolvedValue(undefined);
	return session;
}

function makeStore(): PendingChangesStore {
	const plugin = {
		manifest: { dir: "test-plugin" },
		app: {
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(false),
					mkdir: vi.fn().mockResolvedValue(undefined),
					write: vi.fn().mockResolvedValue(undefined),
				},
				on: vi.fn(),
			},
		},
		registerEvent: vi.fn(),
	} as unknown as ConstructorParameters<typeof PendingChangesStore>[0];
	return new PendingChangesStore(plugin);
}

describe("ChatSession edit/regenerate × pending changes", () => {
	let session: ChatSession;
	let store: PendingChangesStore;

	beforeEach(() => {
		store = makeStore();
		initPendingChangesStore(store);
		store.addChanges([{ type: "create", path: "turn-one.md", content: "1" }], "tc-1", THREAD_ID);
		store.addChanges([{ type: "create", path: "turn-two.md", content: "2" }], "tc-2", THREAD_ID);
		session = makeSession();
	});

	afterEach(() => {
		store.cleanup();
	});

	it("regenerating a turn withdraws the proposals its response staged, keeping earlier turns'", async () => {
		const pair2 = session.messages.at(-1)!;
		expect(pair2.regenerateFromCheckpointId).toBe("c");

		await session.regenerateResponse(pair2.id);

		const [e1] = store.getEntriesByToolCallId("tc-1");
		const [e2] = store.getEntriesByToolCallId("tc-2");
		expect(e1.status).toBe("pending");
		expect(e2.status).toBe("rejected");
		expect(e2.reportedToModel).toBe(true);
	});

	it("editing an earlier message withdraws every abandoned turn's proposals", async () => {
		const pair1 = session.messages[0];
		expect(pair1.editFromCheckpointId).toBe("r");

		await session.editMessage(pair1.id, "turn one, edited");

		const [e1] = store.getEntriesByToolCallId("tc-1");
		const [e2] = store.getEntriesByToolCallId("tc-2");
		expect(e1.status).toBe("rejected");
		expect(e2.status).toBe("rejected");
	});

	it("refuses to fork while a run is in flight, leaving proposals untouched", async () => {
		const pair2 = session.messages.at(-1)!;
		const internals = session as unknown as { abortController: AbortController | null; running: boolean };
		internals.abortController = new AbortController();
		internals.running = true;

		await expect(session.regenerateResponse(pair2.id)).rejects.toThrow(/already in progress/);
		await expect(session.editMessage(pair2.id, "edited")).rejects.toThrow(/already in progress/);

		expect(store.getEntriesByToolCallId("tc-1")[0].status).toBe("pending");
		expect(store.getEntriesByToolCallId("tc-2")[0].status).toBe("pending");
	});

	it("editing the last message keeps the shared prefix's proposals", async () => {
		const pair2 = session.messages.at(-1)!;
		expect(pair2.editFromCheckpointId).toBe("b");

		await session.editMessage(pair2.id, "turn two, edited");

		expect(store.getEntriesByToolCallId("tc-1")[0].status).toBe("pending");
		expect(store.getEntriesByToolCallId("tc-2")[0].status).toBe("rejected");
	});
});

describe("ChatSession edit × attachments", () => {
	let session: ChatSession;
	let store: PendingChangesStore;

	beforeEach(() => {
		store = makeStore();
		initPendingChangesStore(store);
		session = makeSession();
	});

	afterEach(() => {
		store.cleanup();
	});

	function lastOptimisticHuman(): HumanMessage {
		const last = session.getActiveCheckpointMessages().at(-1);
		expect(last).toBeInstanceOf(HumanMessage);
		return last as HumanMessage;
	}

	it("getEditAttachments returns the edited message's attachments", () => {
		const pair2 = session.messages.at(-1)!;
		expect(session.getEditAttachments(pair2.id)).toEqual([ATTACHMENT]);
		expect(session.getEditAttachments(session.messages[0].id)).toEqual([]);
	});

	it("getEditAttachments falls back to the checkpoint when the pair lost them", () => {
		const pair2 = session.messages.at(-1)!;
		pair2.userMessage.attachments = undefined;
		expect(session.getEditAttachments(pair2.id)).toEqual([ATTACHMENT]);
	});

	it("an explicit attachment list is what the edited message carries", async () => {
		const pair2 = session.messages.at(-1)!;
		const replacement: ChatAttachment = { name: "Other.md", mimeType: "text/markdown", vaultPath: "Other.md" };

		await session.editMessage(pair2.id, "edited", [replacement]);

		expect(lastOptimisticHuman().additional_kwargs?.attachments).toEqual([replacement]);
	});

	it("an explicit empty list removes the attachments from the edited message", async () => {
		const pair2 = session.messages.at(-1)!;

		await session.editMessage(pair2.id, "edited", []);

		expect(lastOptimisticHuman().additional_kwargs?.attachments).toBeUndefined();
		expect(session.messages.at(-1)?.userMessage.attachments).toBeUndefined();
	});

	it("omitting the list restores the original message's attachments (legacy callers)", async () => {
		const pair2 = session.messages.at(-1)!;

		await session.editMessage(pair2.id, "edited");

		expect(lastOptimisticHuman().additional_kwargs?.attachments).toEqual([ATTACHMENT]);
		expect(session.messages.at(-1)?.userMessage.attachments).toEqual([ATTACHMENT]);
	});
});
