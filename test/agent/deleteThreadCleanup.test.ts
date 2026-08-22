import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Deleting a chat used to leave its staged changes behind forever.
 *
 * `AgentManager.deleteThread` removed the `.chat` file but nothing swept the
 * pending-changes store: main.ts's vault `delete` handler is gated on
 * `isAgentFilePath`, so a removed `.chat` never reaches it. The entries stayed in
 * pending-changes.json keyed to a thread that no longer existed, kept being
 * tracked by the rename handler, and were unreachable from any UI.
 *
 * The store-level `removeThread` behaviour is covered in
 * test/stores/pendingChangesStore.test.ts. What this file pins is the *wiring* —
 * without it, deleting the call from deleteThread fails nothing.
 */

vi.mock("obsidian", async () => {
	const actual = await import("../__mocks__/obsidian");
	// AgentManager transitively imports modal/view modules that subclass these.
	class Stub {}
	return { ...actual, SuggestModal: Stub, FuzzySuggestModal: Stub, Modal: Stub, ItemView: Stub, FileView: Stub };
});

const removeThread = vi.fn();
const getPendingChangesStoreMock = vi.fn(() => ({ removeThread }));
vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
	getPendingChangesStore: () => getPendingChangesStoreMock(),
}));

const chatManagerDelete = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/agent/ObsidianChatManager", () => ({
	ObsidianChatManager: class {
		delete = chatManagerDelete;
		load = vi.fn().mockResolvedValue(undefined);
		flush = vi.fn().mockResolvedValue(undefined);
		asThreadStore = vi.fn(() => ({}));
	},
}));

vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => ({ targetFolder: "Chats" }),
	DEFAULT_TOOLS_CONFIG: {},
}));

import { AgentManager } from "../../src/agent/AgentManager";

/** Only the plugin surface `deleteThread` reaches. */
function makePlugin() {
	return { app: {}, manifest: { id: "smart-second-brain" } } as never;
}

beforeEach(() => {
	removeThread.mockClear();
	chatManagerDelete.mockClear();
	getPendingChangesStoreMock.mockClear().mockReturnValue({ removeThread });
});

describe("AgentManager.deleteThread", () => {
	it("clears the deleted thread's pending changes", async () => {
		const manager = new AgentManager(makePlugin());

		await manager.deleteThread("Chats/gone.chat");

		expect(chatManagerDelete).toHaveBeenCalledWith("Chats/gone.chat");
		expect(removeThread).toHaveBeenCalledWith("Chats/gone.chat");
	});

	it("sweeps under the same normalized path the changes were staged with", async () => {
		const manager = new AgentManager(makePlugin());

		// Tools stage under the normalized thread id from the run config, so the
		// sweep has to use that same form or it would silently match nothing.
		await manager.deleteThread("My Chat");

		const deletedWith = chatManagerDelete.mock.calls[0][0];
		expect(removeThread).toHaveBeenCalledWith(deletedWith);
		expect(deletedWith).toMatch(/\.chat$/);
	});

	it("still deletes the thread when the store is unavailable", async () => {
		// getPendingChangesStore throws before init and after cleanup() nulls it.
		// Losing the sweep is a leak; failing the delete would be a broken action.
		getPendingChangesStoreMock.mockImplementation(() => {
			throw new Error("PendingChangesStore not initialized");
		});
		const manager = new AgentManager(makePlugin());

		await expect(manager.deleteThread("Chats/gone.chat")).resolves.toBeUndefined();
		expect(chatManagerDelete).toHaveBeenCalled();
	});
});
