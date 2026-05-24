import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

const mockAddChanges = vi.fn().mockReturnValue(["mock-id"]);
const mockIsPathAllowed = vi.fn().mockReturnValue(true);

vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
	getPendingChangesStore: () => ({
		addChanges: mockAddChanges,
		isPathAllowed: mockIsPathAllowed,
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

vi.mock("../../src/agent/tools/runContext", () => ({
	getCurrentThreadId: () => "test-thread-id",
}));

vi.mock("../../src/agent/tools/spaceScope", () => ({
	resolveCurrentSpaceScope: () => ({
		searchFilter: undefined,
		isPathAllowed: () => true,
		isWritePathAllowed: () => true,
		label: "entire vault",
	}),
}));

const mockResolveVaultFileDetailed = vi.fn();
vi.mock("../../src/utils/attachments", () => ({
	resolveVaultFileDetailed: (...args: unknown[]) => mockResolveVaultFileDetailed(...args),
}));

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

		const result = await tool.invoke({
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
		});

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

		const result = await tool.invoke({
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
		});

		expect(result).toContain("Error in operation 1, edit 1");
		expect(mockAddChanges).not.toHaveBeenCalled();
	});

	it("handles wiki-link paths for updates", async () => {
		const file = makeFile("Notes/My Note.md");
		mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
		vi.mocked(app.vault.read).mockResolvedValue("content here");

		await tool.invoke({
			operations: [
				{
					type: "update",
					path: "[[My Note]]",
					edits: [{ oldText: "content here", newText: "updated content" }],
				},
			],
		});

		expect(mockResolveVaultFileDetailed).toHaveBeenCalledWith(app, "My Note");
	});

	it("rejects duplicate targets in the same batch", async () => {
		const file = makeFile("Notes/test.md");
		mockResolveVaultFileDetailed
			.mockReturnValueOnce({ status: "found", file })
			.mockReturnValueOnce({ status: "found", file });
		vi.mocked(app.vault.read).mockResolvedValueOnce("AAA").mockResolvedValueOnce("AAA");

		const result = await tool.invoke({
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
		});

		expect(result).toContain("targeted more than once in this batch");
		expect(mockAddChanges).not.toHaveBeenCalled();
	});

	it("respects per-operation permissions from manage_notes settings", async () => {
		setManageNotesPermissions({ allowCreate: true, allowUpdate: true, allowDelete: false });

		const result = await tool.invoke({
			operations: [
				{
					type: "delete",
					path: "Notes/test.md",
				},
			],
		});

		expect(result).toContain("Delete operations are disabled");
		expect(mockAddChanges).not.toHaveBeenCalled();
	});

	it("applies update edits sequentially within a single operation", async () => {
		const file = makeFile("Notes/test.md");
		mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
		vi.mocked(app.vault.read).mockResolvedValue("start AAA middle BBB end");

		await tool.invoke({
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
		});

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

		const result = await tool.invoke({
			operations: [
				{
					type: "move",
					path: "Notes/source.md",
					newPath: "Archive/source.md",
				},
			],
		});

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

		const result = await tool.invoke({
			operations: [
				{
					type: "move",
					path: "Notes/source.md",
					newPath: "Archive/source.md",
				},
			],
		});

		expect(result).toContain("Move operations are disabled");
		expect(mockAddChanges).not.toHaveBeenCalled();
	});
});
