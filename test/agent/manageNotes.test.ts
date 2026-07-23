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

const mockGetIndexableVaultFiles = vi.fn().mockReturnValue([]);
vi.mock("../../src/utils/fileFiltering", () => ({
	getIndexableVaultFiles: (...args: unknown[]) => mockGetIndexableVaultFiles(...args),
	isTextIndexableFile: (file: { extension: string }) =>
		["md", "txt", "csv", "json", "yaml", "yml", "canvas", "chat"].includes(file.extension.toLowerCase()),
	shouldProcessVaultPath: (filePath: string, prefix: string) => filePath.startsWith(prefix),
}));

// The tool reads its thread id from the run config's `configurable.thread_id`
// (set by Agent.buildRunnableConfig in production). Pass it on every invoke.
const THREAD_CONFIG = { configurable: { thread_id: "test-thread-id" } };

import type { App } from "obsidian";
import { MAX_REGEX_INPUT_LENGTH } from "../../src/agent/tools/grepMatcher";
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
		mockGetIndexableVaultFiles.mockReturnValue([]);
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

	describe("update edit flags — is_regex / replace_all", () => {
		it("replaces every occurrence with replace_all", async () => {
			const file = makeFile("Notes/changelog.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			vi.mocked(app.vault.read).mockResolvedValue("v1 here, and v1 there, plus v1");

			await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/changelog.md",
							edits: [{ oldText: "v1", newText: "v2", replace_all: true }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(mockAddChanges).toHaveBeenCalledWith(
				[
					expect.objectContaining({
						type: "update",
						newContent: "v2 here, and v2 there, plus v2",
					}),
				],
				expect.anything(),
				expect.anything(),
			);
		});

		it("errors on a non-unique oldText without replace_all", async () => {
			const file = makeFile("Notes/dupes.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			vi.mocked(app.vault.read).mockResolvedValue("dup dup dup");

			const result = await tool.invoke(
				{
					operations: [{ type: "update", path: "Notes/dupes.md", edits: [{ oldText: "dup", newText: "x" }] }],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("appears multiple times");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});

		it("does not treat $ in newText as a back-reference for literal edits", async () => {
			const file = makeFile("Notes/price.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			vi.mocked(app.vault.read).mockResolvedValue("Cost: PLACEHOLDER");

			await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/price.md",
							edits: [{ oldText: "PLACEHOLDER", newText: "$5" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(mockAddChanges).toHaveBeenCalledWith(
				[expect.objectContaining({ newContent: "Cost: $5" })],
				expect.anything(),
				expect.anything(),
			);
		});

		it("applies a regex edit with back-references", async () => {
			const file = makeFile("Notes/dates.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			vi.mocked(app.vault.read).mockResolvedValue("Date 2026-07-22 end");

			await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/dates.md",
							edits: [{ oldText: "(\\d{4})-(\\d{2})-(\\d{2})", newText: "$3/$2/$1", is_regex: true }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(mockAddChanges).toHaveBeenCalledWith(
				[expect.objectContaining({ newContent: "Date 22/07/2026 end" })],
				expect.anything(),
				expect.anything(),
			);
		});

		it("refuses a regex edit on a note larger than the safe regex ceiling", async () => {
			const file = makeFile("Notes/huge.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			// A note past the ceiling: a screen-bypassing pattern could freeze the UI,
			// so the tool must refuse rather than run the regex.
			vi.mocked(app.vault.read).mockResolvedValue("x".repeat(MAX_REGEX_INPUT_LENGTH + 1));

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/huge.md",
							edits: [{ oldText: "x+", newText: "y", is_regex: true }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("too large to search safely with a regex");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});
	});

	describe("vault-wide replace operation", () => {
		it("stages one update per changed note across the vault", async () => {
			const a = makeFile("Projects/a.md");
			const b = makeFile("Projects/b.md");
			const c = makeFile("Other/c.md");
			mockGetIndexableVaultFiles.mockReturnValue([a, b, c]);
			vi.mocked(app.vault.read).mockImplementation(async (f: { path: string }) =>
				f.path === "Projects/a.md"
					? "has #todo here"
					: f.path === "Projects/b.md"
						? "no match here"
						: "another #todo",
			);

			const result = await tool.invoke(
				{
					operations: [{ type: "replace", find: "#todo", replace: "#task" }],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("Proposed");
			const staged = mockAddChanges.mock.calls[0][0];
			// Only the two files that actually contain #todo are staged.
			expect(staged).toHaveLength(2);
			expect(staged.map((c: { path: string }) => c.path).sort()).toEqual(["Other/c.md", "Projects/a.md"]);
			expect(staged.every((c: { type: string }) => c.type === "update")).toBe(true);
			expect(staged.find((c: { path: string }) => c.path === "Projects/a.md").newContent).toBe("has #task here");
		});

		it("scopes the replace to path_prefix", async () => {
			const a = makeFile("Projects/a.md");
			const c = makeFile("Other/c.md");
			mockGetIndexableVaultFiles.mockReturnValue([a, c]);
			vi.mocked(app.vault.read).mockResolvedValue("#todo everywhere");

			await tool.invoke(
				{
					operations: [{ type: "replace", find: "#todo", replace: "#task", path_prefix: "Projects" }],
				},
				THREAD_CONFIG,
			);

			const staged = mockAddChanges.mock.calls[0][0];
			expect(staged).toHaveLength(1);
			expect(staged[0].path).toBe("Projects/a.md");
		});

		it("surfaces files a later replace op skips because an earlier op changed them", async () => {
			// Two replace ops in one batch. Op A rewrites foo→bar in shared.md; op B
			// would rewrite baz→qux in the same file, but it is skipped to avoid
			// staging a conflicting second diff. The skip must be surfaced, not silent.
			const shared = makeFile("Notes/shared.md");
			mockGetIndexableVaultFiles.mockReturnValue([shared]);
			vi.mocked(app.vault.read).mockResolvedValue("foo and baz together");

			const result = await tool.invoke(
				{
					operations: [
						{ type: "replace", find: "foo", replace: "bar" },
						{ type: "replace", find: "baz", replace: "qux" },
					],
				},
				THREAD_CONFIG,
			);

			// Op A staged one change; op B's match in the same file was skipped and
			// the summary must say so rather than silently under-applying.
			const staged = mockAddChanges.mock.calls[0][0];
			expect(staged).toHaveLength(1);
			expect(staged[0].newContent).toBe("bar and baz together");
			expect(result).toMatch(/skipped because an earlier operation/);
		});

		it("skips oversized notes in a vault-wide regex replace and reports the skip", async () => {
			const small = makeFile("Notes/small.md");
			const huge = makeFile("Notes/huge.md");
			mockGetIndexableVaultFiles.mockReturnValue([small, huge]);
			vi.mocked(app.vault.read).mockImplementation(async (f: { path: string }) =>
				f.path === "Notes/small.md" ? "foo here" : "foo".repeat(MAX_REGEX_INPUT_LENGTH),
			);

			const result = await tool.invoke(
				{
					operations: [{ type: "replace", find: "foo", replace: "bar", is_regex: true }],
				},
				THREAD_CONFIG,
			);

			// The small note is staged; the huge note is skipped, not scanned, and
			// the skip is surfaced in the summary rather than silently dropped.
			const staged = mockAddChanges.mock.calls[0][0];
			expect(staged).toHaveLength(1);
			expect(staged[0].path).toBe("Notes/small.md");
			expect(result).toContain("skipped as too large");
		});

		it("returns an error and stages nothing when there are zero matches", async () => {
			const a = makeFile("Notes/a.md");
			mockGetIndexableVaultFiles.mockReturnValue([a]);
			vi.mocked(app.vault.read).mockResolvedValue("nothing relevant");

			const result = await tool.invoke(
				{
					operations: [{ type: "replace", find: "#todo", replace: "#task" }],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("No occurrences");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});

		it("requires update permission", async () => {
			setManageNotesPermissions({ allowCreate: true, allowUpdate: false, allowDelete: true, allowMove: true });
			tool = createManageNotesTool(app);
			const a = makeFile("Notes/a.md");
			mockGetIndexableVaultFiles.mockReturnValue([a]);
			vi.mocked(app.vault.read).mockResolvedValue("#todo");

			const result = await tool.invoke(
				{ operations: [{ type: "replace", find: "#todo", replace: "#task" }] },
				THREAD_CONFIG,
			);

			expect(result).toContain("update permission");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});
	});
});
