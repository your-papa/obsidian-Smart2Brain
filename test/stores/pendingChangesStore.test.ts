import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// Mock dataStore.svelte to provide getData()
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: vi.fn(() => ({
		targetFolder: "Chats",
		privacyList: [] as string[],
		privacyIsExcluding: true,
		isProviderTrusted: vi.fn(() => false),
	})),
}));

// We test only the pure utility functions and public API.
// shouldIncludePart & buildPartialContent are module-private, so we test
// them indirectly through rejectChangeGroup (which does not touch the vault).

import { PendingChangesStore } from "../../src/stores/pendingChangesStore.svelte";
import { getData } from "../../src/stores/dataStore.svelte";
import { TFile } from "obsidian";

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------*/

/** Create a TFile instance with the given path (uses the mocked TFile class). */
function makeTFile(path: string) {
	const f = new TFile();
	f.path = path;
	f.name = path.split("/").pop()!;
	return f;
}

function createMockPlugin() {
	return {
		manifest: { dir: "test-plugin" },
		app: {
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(false),
					read: vi.fn().mockResolvedValue(""),
					write: vi.fn().mockResolvedValue(undefined),
					mkdir: vi.fn().mockResolvedValue(undefined),
				},
				getAbstractFileByPath: vi.fn(),
				read: vi.fn().mockResolvedValue(""),
				modify: vi.fn().mockResolvedValue(undefined),
				create: vi.fn().mockResolvedValue(makeTFile("created.md")),
				createFolder: vi.fn().mockResolvedValue(undefined),
				trash: vi.fn().mockResolvedValue(undefined),
				on: vi.fn().mockReturnValue({ id: "ref" }),
			},
			fileManager: {
				renameFile: vi.fn().mockResolvedValue(undefined),
			},
		},
		registerEvent: vi.fn(),
		saveData: vi.fn().mockResolvedValue(undefined),
	} as ConstructorParameters<typeof PendingChangesStore>[0];
}

/* --------------------------------------------------------------------------
 * PendingChangesStore – addChanges / getters
 * ------------------------------------------------------------------------*/

describe("PendingChangesStore", () => {
	let store: PendingChangesStore;
	let plugin: ReturnType<typeof createMockPlugin>;

	beforeEach(() => {
		plugin = createMockPlugin();
		store = new PendingChangesStore(plugin);
	});

	describe("addChanges & getters", () => {
		it("should add a single create change", () => {
			const ids = store.addChanges(
				[{ type: "create", path: "new.md", content: "Hello world" }],
				"tc-1",
				"thread-1",
			);

			expect(ids).toHaveLength(1);
			expect(store.getPendingCount("thread-1")).toBe(1);

			const entry = store.getEntry(ids[0]);
			expect(entry).toBeDefined();
			expect(entry?.change.type).toBe("create");
			expect(entry?.status).toBe("pending");
			expect(entry?.toolCallId).toBe("tc-1");
			expect(entry?.threadId).toBe("thread-1");
		});

		it("should add multiple changes at once", () => {
			const changes = [
				{ type: "create" as const, path: "a.md", content: "A" },
				{ type: "create" as const, path: "b.md", content: "B" },
				{ type: "create" as const, path: "c.md", content: "C" },
			];

			const ids = store.addChanges(changes, "tc-2", "thread-1");
			expect(ids).toHaveLength(3);
			expect(store.getPendingCount("thread-1")).toBe(3);
		});

		it("should auto-reject older pending updates for the same path and thread", () => {
			store.addChanges(
				[{ type: "update", path: "note.md", originalContent: "old", newContent: "new1" }],
				"tc-1",
				"thread-1",
			);

			const [id2] = store.addChanges(
				[{ type: "update", path: "note.md", originalContent: "old", newContent: "new2" }],
				"tc-2",
				"thread-1",
			);

			// Only the latest should be pending
			expect(store.getPendingCount("thread-1")).toBe(1);
			const entry = store.getEntry(id2);
			expect(entry?.status).toBe("pending");
		});

		it("should not auto-reject updates from different threads", () => {
			store.addChanges(
				[{ type: "update", path: "note.md", originalContent: "old", newContent: "new1" }],
				"tc-1",
				"thread-1",
			);

			store.addChanges(
				[{ type: "update", path: "note.md", originalContent: "old", newContent: "new2" }],
				"tc-2",
				"thread-2",
			);

			expect(store.getPendingCount("thread-1")).toBe(1);
			expect(store.getPendingCount("thread-2")).toBe(1);
		});

		it("should retrieve entries by thread", () => {
			store.addChanges([{ type: "create", path: "a.md", content: "A" }], "tc-1", "thread-1");
			store.addChanges([{ type: "create", path: "b.md", content: "B" }], "tc-2", "thread-2");

			expect(store.getEntriesForThread("thread-1")).toHaveLength(1);
			expect(store.getEntriesForThread("thread-2")).toHaveLength(1);
			expect(store.getEntriesForThread("thread-3")).toHaveLength(0);
		});

		it("should retrieve entries by tool call ID", () => {
			store.addChanges([{ type: "create", path: "a.md", content: "A" }], "tc-unique", "thread-1");

			const entry = store.getEntryByToolCallId("tc-unique");
			expect(entry).toBeDefined();
			expect(entry?.toolCallId).toBe("tc-unique");
		});

		it("should return pending updates for a specific path", () => {
			store.addChanges(
				[{ type: "update", path: "target.md", originalContent: "old", newContent: "new" }],
				"tc-1",
				"thread-1",
			);
			store.addChanges([{ type: "create", path: "other.md", content: "X" }], "tc-2", "thread-1");

			const updates = store.getPendingUpdatesForPath("target.md");
			expect(updates).toHaveLength(1);
			expect(updates[0].change.path).toBe("target.md");
		});
	});

	/* --------------------------------------------------------------------------
	 * rejectChange
	 * ------------------------------------------------------------------------*/

	describe("rejectChange", () => {
		it("should reject a pending change", () => {
			const [id] = store.addChanges(
				[{ type: "create", path: "a.md", content: "A" }],
				"tc-1",
				"thread-1",
			);

			store.rejectChange(id);

			expect(store.getEntry(id)?.status).toBe("rejected");
			expect(store.getPendingCount("thread-1")).toBe(0);
		});

		it("should be a no-op for already-rejected changes", () => {
			const [id] = store.addChanges(
				[{ type: "create", path: "a.md", content: "A" }],
				"tc-1",
				"thread-1",
			);

			store.rejectChange(id);
			store.rejectChange(id); // should not throw

			expect(store.getEntry(id)?.status).toBe("rejected");
		});
	});

	/* --------------------------------------------------------------------------
	 * acceptChange
	 * ------------------------------------------------------------------------*/

	describe("acceptChange", () => {
		it("should accept and apply a create change", async () => {
			const [id] = store.addChanges(
				[{ type: "create", path: "notes/new.md", content: "Hello" }],
				"tc-1",
				"thread-1",
			);

			await store.acceptChange(id);

			expect(store.getEntry(id)?.status).toBe("accepted");
			expect(plugin.app.vault.create).toHaveBeenCalledWith("notes/new.md", "Hello");
		});

		it("should accept and apply an update change", async () => {
			const file = makeTFile("note.md");
			(plugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(file);
			(plugin.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue("original content");

			const [id] = store.addChanges(
				[{
					type: "update",
					path: "note.md",
					originalContent: "original content",
					newContent: "updated content",
				}],
				"tc-1",
				"thread-1",
			);

			await store.acceptChange(id);

			expect(store.getEntry(id)?.status).toBe("accepted");
			expect(plugin.app.vault.modify).toHaveBeenCalledWith(file, "updated content");
		});

		it("should detect conflict when file was modified externally", async () => {
			const file = makeTFile("note.md");
			(plugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(file);
			// File content has changed since the change was proposed
			(plugin.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue("externally modified");

			const [id] = store.addChanges(
				[{
					type: "update",
					path: "note.md",
					originalContent: "original content",
					newContent: "new content",
				}],
				"tc-1",
				"thread-1",
			);

			await expect(store.acceptChange(id)).rejects.toThrow("was modified after the change was proposed");
			expect(store.getEntry(id)?.status).toBe("pending"); // Should remain pending
		});

		it("should accept and apply a delete change", async () => {
			const file = makeTFile("delete-me.md");
			(plugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(file);

			const [id] = store.addChanges(
				[{ type: "delete", path: "delete-me.md", originalContent: "content" }],
				"tc-1",
				"thread-1",
			);

			await store.acceptChange(id);

			expect(store.getEntry(id)?.status).toBe("accepted");
			expect(plugin.app.vault.trash).toHaveBeenCalledWith(file, true);
		});

		it("should accept and apply a move change", async () => {
			const file = makeTFile("old-path.md");
			(plugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>)
				.mockReturnValueOnce(file) // source exists
				.mockReturnValueOnce(null); // destination doesn't exist

			const [id] = store.addChanges(
				[{ type: "move", path: "old-path.md", newPath: "new-path.md" }],
				"tc-1",
				"thread-1",
			);

			await store.acceptChange(id);

			expect(store.getEntry(id)?.status).toBe("accepted");
			expect(plugin.app.fileManager.renameFile).toHaveBeenCalledWith(file, "new-path.md");
		});
	});

	/* --------------------------------------------------------------------------
	 * rejectChangeGroup (tests buildPartialContent indirectly)
	 * ------------------------------------------------------------------------*/

	describe("rejectChangeGroup", () => {
		it("should reject a specific diff group from an update", () => {
			const original = "line1\nline2\nline3\n";
			const updated = "line1\nmodified2\nline3\nadded4\n";

			const [id] = store.addChanges(
				[{ type: "update", path: "note.md", originalContent: original, newContent: updated }],
				"tc-1",
				"thread-1",
			);

			// Reject group 0 (line2 → modified2 change)
			store.rejectChangeGroup(id, 0);

			const entry = store.getEntry(id);
			expect(entry).toBeDefined();
			if (!entry) throw new Error("Expected pending change entry");
			expect(entry.status).toBe("pending");
			// After rejecting the first group, the newContent should revert group 0
			// but keep group 1 (the added4 line)
			const change = entry.change as { type: "update"; newContent: string; originalContent: string };
			expect(change.newContent).toContain("line2");
			expect(change.newContent).toContain("added4");
		});

		it("should auto-reject entry when all groups are rejected", () => {
			const original = "line1\nline2\n";
			const updated = "line1\nchanged\n";

			const [id] = store.addChanges(
				[{ type: "update", path: "note.md", originalContent: original, newContent: updated }],
				"tc-1",
				"thread-1",
			);

			// Only one diff group, rejecting it should make newContent == originalContent
			store.rejectChangeGroup(id, 0);

			const entry = store.getEntry(id);
			expect(entry).toBeDefined();
			if (!entry) throw new Error("Expected pending change entry");
			expect(entry.status).toBe("rejected");
		});

		it("should be a no-op for non-update changes", () => {
			const [id] = store.addChanges(
				[{ type: "create", path: "a.md", content: "A" }],
				"tc-1",
				"thread-1",
			);

			store.rejectChangeGroup(id, 0);
			expect(store.getEntry(id)?.status).toBe("pending");
		});
	});

	/* --------------------------------------------------------------------------
	 * Batch operations: acceptAll / rejectAll
	 * ------------------------------------------------------------------------*/

	describe("batch operations", () => {
		it("rejectAll should reject all pending changes for a thread", async () => {
			const ids = store.addChanges(
				[
					{ type: "create", path: "a.md", content: "A" },
					{ type: "create", path: "b.md", content: "B" },
				],
				"tc-1",
				"thread-1",
			);

			await store.rejectAll("thread-1");

			expect(store.getEntry(ids[0])?.status).toBe("rejected");
			expect(store.getEntry(ids[1])?.status).toBe("rejected");
			expect(store.getPendingCount("thread-1")).toBe(0);
		});

		it("rejectAll should not affect a different thread", async () => {
			store.addChanges([{ type: "create", path: "a.md", content: "A" }], "tc-1", "thread-1");
			const [id2] = store.addChanges([{ type: "create", path: "b.md", content: "B" }], "tc-2", "thread-2");

			await store.rejectAll("thread-1");

			expect(store.getEntry(id2)?.status).toBe("pending");
		});
	});

	/* --------------------------------------------------------------------------
	 * hasConflict
	 * ------------------------------------------------------------------------*/

	describe("hasConflict", () => {
		it("should return false for create changes", async () => {
			const [id] = store.addChanges(
				[{ type: "create", path: "new.md", content: "Hello" }],
				"tc-1",
				"thread-1",
			);

			expect(await store.hasConflict(id)).toBe(false);
		});

		it("should return true when file content has changed", async () => {
			const file = makeTFile("note.md");
			(plugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(file);
			(plugin.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue("externally modified");

			const [id] = store.addChanges(
				[{
					type: "update",
					path: "note.md",
					originalContent: "original",
					newContent: "new",
				}],
				"tc-1",
				"thread-1",
			);

			expect(await store.hasConflict(id)).toBe(true);
		});

		it("should return false when file content matches", async () => {
			const file = makeTFile("note.md");
			(plugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(file);
			(plugin.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue("original");

			const [id] = store.addChanges(
				[{
					type: "update",
					path: "note.md",
					originalContent: "original",
					newContent: "new",
				}],
				"tc-1",
				"thread-1",
			);

			expect(await store.hasConflict(id)).toBe(false);
		});

		it("should return true when file was deleted externally", async () => {
			(plugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(null);

			const [id] = store.addChanges(
				[{ type: "delete", path: "deleted.md", originalContent: "content" }],
				"tc-1",
				"thread-1",
			);

			expect(await store.hasConflict(id)).toBe(true);
		});
	});

	/* --------------------------------------------------------------------------
	 * cleanupResolved / removeThread
	 * ------------------------------------------------------------------------*/

	describe("cleanup", () => {
		it("cleanupResolved should remove accepted/rejected but keep pending", () => {
			const [id1] = store.addChanges(
				[{ type: "create", path: "a.md", content: "A" }],
				"tc-1",
				"thread-1",
			);
			const [id2] = store.addChanges(
				[{ type: "create", path: "b.md", content: "B" }],
				"tc-2",
				"thread-1",
			);

			store.rejectChange(id1);

			store.cleanupResolved("thread-1");

			expect(store.getEntry(id1)).toBeUndefined();
			expect(store.getEntry(id2)).toBeDefined();
			expect(store.getEntry(id2)?.status).toBe("pending");
		});

		it("removeThread should remove all entries for a thread", () => {
			store.addChanges([{ type: "create", path: "a.md", content: "A" }], "tc-1", "thread-1");
			store.addChanges([{ type: "create", path: "b.md", content: "B" }], "tc-2", "thread-1");
			store.addChanges([{ type: "create", path: "c.md", content: "C" }], "tc-3", "thread-2");

			store.removeThread("thread-1");

			expect(store.getEntriesForThread("thread-1")).toHaveLength(0);
			expect(store.getEntriesForThread("thread-2")).toHaveLength(1);
		});
	});

	/* --------------------------------------------------------------------------
	 * isPathAllowed / isFilePrivate / shouldBlockFile
	 * ------------------------------------------------------------------------*/

	describe("path filtering", () => {
		it("isPathAllowed should allow normal vault files", () => {
			expect(store.isPathAllowed("any/path.md")).toBe(true);
		});

		it("isPathAllowed should exclude internal chat files", () => {
			const mockGetData = getData as ReturnType<typeof vi.fn>;
			mockGetData.mockReturnValue({
				targetFolder: "Chats",
				privacyList: [],
				privacyIsExcluding: true,
				isProviderTrusted: vi.fn(() => false),
			});

			expect(store.isPathAllowed("Chats/test.md")).toBe(false);
			expect(store.isPathAllowed("Notes/test.md")).toBe(true);
		});

		it("isPathAllowed should exclude Excalidraw files", () => {
			expect(store.isPathAllowed("Canvas/diagram.excalidraw.md")).toBe(false);
		});

		it("isFilePrivate should mark matching files as private when privacyIsExcluding", () => {
			const mockGetData = getData as ReturnType<typeof vi.fn>;
			mockGetData.mockReturnValue({
				targetFolder: "Chats",
				privacyList: ["secret"],
				privacyIsExcluding: true,
				isProviderTrusted: vi.fn(() => false),
			});

			expect(store.isFilePrivate("secret/diary.md")).toBe(true);
			expect(store.isFilePrivate("public/note.md")).toBe(false);
		});

		it("shouldBlockFile should block private files for untrusted providers", () => {
			const mockGetData = getData as ReturnType<typeof vi.fn>;
			mockGetData.mockReturnValue({
				targetFolder: "Chats",
				privacyList: ["secret"],
				privacyIsExcluding: true,
				isProviderTrusted: vi.fn(() => false),
			});

			expect(store.shouldBlockFile("secret/diary.md", "openai")).toBe(true);
			expect(store.shouldBlockFile("public/note.md", "openai")).toBe(false);
		});

		it("shouldBlockFile should allow private files for trusted providers", () => {
			const mockGetData = getData as ReturnType<typeof vi.fn>;
			mockGetData.mockReturnValue({
				targetFolder: "Chats",
				privacyList: ["secret"],
				privacyIsExcluding: true,
				isProviderTrusted: vi.fn(() => true),
			});

			expect(store.shouldBlockFile("secret/diary.md", "ollama")).toBe(false);
		});

		it("isFilePrivate should support filetype privacy patterns", () => {
			const mockGetData = getData as ReturnType<typeof vi.fn>;
			mockGetData.mockReturnValue({
				targetFolder: "Chats",
				privacyList: ["*.pdf"],
				privacyIsExcluding: true,
				isProviderTrusted: vi.fn(() => false),
			});

			expect(store.isFilePrivate("Docs/spec.pdf")).toBe(true);
			expect(store.isFilePrivate("Docs/spec.md")).toBe(false);
		});
	});
});
