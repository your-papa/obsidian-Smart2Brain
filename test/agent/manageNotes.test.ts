import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

const mockAddChanges = vi.fn().mockReturnValue(["mock-id"]);
const mockIsPathAllowed = vi.fn().mockReturnValue(true);
const mockCountOtherThreads = vi.fn().mockReturnValue(0);

vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
	getPendingChangesStore: () => ({
		addChanges: mockAddChanges,
		isPathAllowed: mockIsPathAllowed,
		countOtherThreadsPendingUpdate: mockCountOtherThreads,
	}),
}));

const mockGetData = vi.fn();
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => mockGetData(),
	DEFAULT_TOOLS_CONFIG: {
		manage_notes: {
			name: "manage_notes",
			description:
				"Create, update, delete, or move markdown notes in one staged batch. Use targeted search-and-replace edits for updates and batch related note operations together.",
		},
	},
}));

const mockResolveVaultFileDetailed = vi.fn();
vi.mock("../../src/utils/attachments", () => ({
	resolveVaultFileDetailed: (...args: unknown[]) => mockResolveVaultFileDetailed(...args),
}));

// The tool reads its thread id from the run config's `configurable.thread_id`
// (set by Agent.buildRunnableConfig in production). Pass it on every invoke.
const THREAD_CONFIG = { configurable: { thread_id: "test-thread-id" } };

import type { App } from "obsidian";
import { createManageNotesTool } from "../../src/agent/tools/manageNotes";

function makeFile(path: string, ext = "md") {
	return { path, name: path.split("/").pop()!, extension: ext };
}

function createMockApp() {
	return {
		vault: {
			read: vi.fn().mockResolvedValue(""),
			getAbstractFileByPath: vi.fn(),
		},
	} as unknown as App;
}

function setManageNotesPermissions(permissions?: {
	allowCreate?: boolean;
	allowUpdate?: boolean;
	allowDelete?: boolean;
	allowMove?: boolean;
}) {
	mockGetData.mockReturnValue({
		getAgent: () => undefined,
		getSelectedAgent: () => ({
			toolsConfig: {
				manage_notes: {
					settings: {
						allowCreate: permissions?.allowCreate ?? true,
						allowUpdate: permissions?.allowUpdate ?? true,
						allowDelete: permissions?.allowDelete ?? true,
						allowMove: permissions?.allowMove ?? true,
					},
				},
			},
		}),
	});
}

describe("manageNotes tool", () => {
	let app: App;
	let tool: ReturnType<typeof createManageNotesTool>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockIsPathAllowed.mockReturnValue(true);
		mockCountOtherThreads.mockReturnValue(0);
		setManageNotesPermissions();
		app = createMockApp();
		tool = createManageNotesTool(app);
	});

	it("stages mixed create, update, and delete operations in one batch", async () => {
		const updateFile = makeFile("Notes/existing.md");
		const deleteFile = makeFile("Archive/old.md");
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(null);
		mockResolveVaultFileDetailed
			.mockReturnValueOnce({ status: "found", file: updateFile })
			.mockReturnValueOnce({ status: "found", file: deleteFile });
		vi.mocked(app.vault.read)
			.mockResolvedValueOnce("Hello world\nThis is a test\nGoodbye")
			.mockResolvedValueOnce("Delete me");

		const result = await tool.invoke(
			{
				operations: [
					{
						type: "create",
						path: "Notes/new-note.md",
						content: "# New note\n",
					},
					{
						type: "update",
						path: "Notes/existing.md",
						edits: [{ oldText: "This is a test", newText: "This is updated" }],
					},
					{
						type: "delete",
						path: "Archive/old.md",
					},
				],
			},
			THREAD_CONFIG,
		);

		expect(result).toContain("Proposed 3 note operation(s)");
		expect(result).toContain("1 create, 1 update, 1 delete");
		expect(mockAddChanges).toHaveBeenCalledWith(
			[
				{
					type: "create",
					path: "Notes/new-note.md",
					content: "# New note\n",
				},
				{
					type: "update",
					path: "Notes/existing.md",
					originalContent: "Hello world\nThis is a test\nGoodbye",
					newContent: "Hello world\nThis is updated\nGoodbye",
				},
				{
					type: "delete",
					path: "Archive/old.md",
					originalContent: "Delete me",
				},
			],
			expect.any(String),
			"test-thread-id",
		);
	});

	it("keeps the batch atomic when one update edit fails", async () => {
		const file = makeFile("Notes/test.md");
		mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
		vi.mocked(app.vault.read).mockResolvedValue("Hello world");

		const result = await tool.invoke(
			{
				operations: [
					{
						type: "update",
						path: "Notes/test.md",
						edits: [{ oldText: "missing", newText: "replacement" }],
					},
					{
						type: "create",
						path: "Notes/another.md",
						content: "# Another",
					},
				],
			},
			THREAD_CONFIG,
		);

		expect(result).toContain("Error in operation 1, edit 1");
		expect(mockAddChanges).not.toHaveBeenCalled();
	});

	it("handles wiki-link paths for updates", async () => {
		const file = makeFile("Notes/My Note.md");
		mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
		vi.mocked(app.vault.read).mockResolvedValue("content here");

		await tool.invoke(
			{
				operations: [
					{
						type: "update",
						path: "[[My Note]]",
						edits: [{ oldText: "content here", newText: "updated content" }],
					},
				],
			},
			THREAD_CONFIG,
		);

		expect(mockResolveVaultFileDetailed).toHaveBeenCalledWith(app, "My Note");
	});

	it("rejects duplicate targets in the same batch", async () => {
		const file = makeFile("Notes/test.md");
		mockResolveVaultFileDetailed
			.mockReturnValueOnce({ status: "found", file })
			.mockReturnValueOnce({ status: "found", file });
		vi.mocked(app.vault.read).mockResolvedValueOnce("AAA").mockResolvedValueOnce("AAA");

		const result = await tool.invoke(
			{
				operations: [
					{
						type: "update",
						path: "Notes/test.md",
						edits: [{ oldText: "AAA", newText: "BBB" }],
					},
					{
						type: "delete",
						path: "Notes/test.md",
					},
				],
			},
			THREAD_CONFIG,
		);

		expect(result).toContain("targeted more than once in this batch");
		expect(mockAddChanges).not.toHaveBeenCalled();
	});

	it("respects per-operation permissions from manage_notes settings", async () => {
		setManageNotesPermissions({ allowCreate: true, allowUpdate: true, allowDelete: false });

		const result = await tool.invoke(
			{
				operations: [
					{
						type: "delete",
						path: "Notes/test.md",
					},
				],
			},
			THREAD_CONFIG,
		);

		expect(result).toContain("Delete operations are disabled");
		expect(mockAddChanges).not.toHaveBeenCalled();
	});

	it("applies update edits sequentially within a single operation", async () => {
		const file = makeFile("Notes/test.md");
		mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
		vi.mocked(app.vault.read).mockResolvedValue("start AAA middle BBB end");

		await tool.invoke(
			{
				operations: [
					{
						type: "update",
						path: "Notes/test.md",
						edits: [
							{ oldText: "AAA", newText: "XXX" },
							{ oldText: "XXX middle", newText: "YYY between" },
						],
					},
				],
			},
			THREAD_CONFIG,
		);

		expect(mockAddChanges).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "update",
					newContent: "start YYY between BBB end",
				}),
			],
			expect.any(String),
			"test-thread-id",
		);
	});

	it("stages move operations as first-class changes", async () => {
		const file = makeFile("Notes/source.md");
		mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(null);

		const result = await tool.invoke(
			{
				operations: [
					{
						type: "move",
						path: "Notes/source.md",
						newPath: "Archive/source.md",
					},
				],
			},
			THREAD_CONFIG,
		);

		expect(result).toContain("1 move");
		expect(mockAddChanges).toHaveBeenCalledWith(
			[
				{
					type: "move",
					path: "Notes/source.md",
					newPath: "Archive/source.md",
				},
			],
			expect.any(String),
			"test-thread-id",
		);
	});

	it("respects move permissions from manage_notes settings", async () => {
		setManageNotesPermissions({ allowCreate: true, allowUpdate: true, allowDelete: true, allowMove: false });

		const result = await tool.invoke(
			{
				operations: [
					{
						type: "move",
						path: "Notes/source.md",
						newPath: "Archive/source.md",
					},
				],
			},
			THREAD_CONFIG,
		);

		expect(result).toContain("Move operations are disabled");
		expect(mockAddChanges).not.toHaveBeenCalled();
	});

	it("warns when another chat has a pending update to the same file", async () => {
		const file = makeFile("Notes/shared.md");
		mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
		vi.mocked(app.vault.read).mockResolvedValue("Hello world");
		// Another thread already has a pending update to this path.
		mockCountOtherThreads.mockReturnValue(1);

		const result = await tool.invoke(
			{
				operations: [
					{
						type: "update",
						path: "Notes/shared.md",
						edits: [{ oldText: "Hello world", newText: "Hi world" }],
					},
				],
			},
			THREAD_CONFIG,
		);

		// The change is still staged...
		expect(mockAddChanges).toHaveBeenCalled();
		// ...but the result flags the cross-thread collision.
		expect(mockCountOtherThreads).toHaveBeenCalledWith("Notes/shared.md", "test-thread-id");
		expect(result).toContain("another chat already has a pending update");
		expect(result).toContain('"Notes/shared.md"');
	});

	it("does not warn when no other chat is editing the file", async () => {
		const file = makeFile("Notes/solo.md");
		mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
		vi.mocked(app.vault.read).mockResolvedValue("Hello world");
		mockCountOtherThreads.mockReturnValue(0);

		const result = await tool.invoke(
			{
				operations: [
					{
						type: "update",
						path: "Notes/solo.md",
						edits: [{ oldText: "Hello world", newText: "Hi world" }],
					},
				],
			},
			THREAD_CONFIG,
		);

		expect(mockAddChanges).toHaveBeenCalled();
		expect(result).not.toContain("another chat");
	});
});
