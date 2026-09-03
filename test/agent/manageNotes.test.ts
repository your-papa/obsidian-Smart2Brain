import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

const mockAddChanges = vi.fn().mockReturnValue(["mock-id"]);
const mockIsPathAllowed = vi.fn().mockReturnValue(true);
const mockCountOtherThreads = vi.fn().mockReturnValue(0);
const mockShouldBlockFile = vi.fn().mockReturnValue(false);
const mockGetPendingUpdatesForPath = vi.fn().mockReturnValue([]);
const mockDiscardPendingById = vi.fn().mockReturnValue("not_found");
const mockGetPendingByShortId = vi.fn().mockReturnValue(undefined);
const mockGetEntry = vi.fn().mockReturnValue(undefined);

vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
	getPendingChangesStore: () => ({
		addChanges: mockAddChanges,
		isPathAllowed: mockIsPathAllowed,
		countOtherThreadsPendingUpdate: mockCountOtherThreads,
		shouldBlockFile: (...args: unknown[]) => mockShouldBlockFile(...args),
		getPendingUpdatesForPath: (...args: unknown[]) => mockGetPendingUpdatesForPath(...args),
		discardPendingById: (...args: unknown[]) => mockDiscardPendingById(...args),
		getPendingByShortId: (...args: unknown[]) => mockGetPendingByShortId(...args),
		getEntry: (...args: unknown[]) => mockGetEntry(...args),
	}),
}));

const mockGetData = vi.fn();
vi.mock("../../src/agent/tools/builtInToolDefaults", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/agent/tools/builtInToolDefaults")>()),
	DEFAULT_TOOLS_CONFIG: {
		manage_notes: {
			name: "manage_notes",
			description:
				"Create, update, delete, or move markdown notes in one staged batch. Use targeted search-and-replace edits for updates and batch related note operations together.",
		},
	},
}));
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => mockGetData(),
}));

const mockResolveVaultFileDetailed = vi.fn();
vi.mock("../../src/utils/pathResolution", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/utils/pathResolution")>()),
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

function setMockAgentData() {
	mockGetData.mockReturnValue({
		getAgent: () => undefined,
		getSelectedAgent: () => ({
			// A provider must be present for the privacy check to run at all —
			// `shouldBlockFile` is only consulted when one is resolved.
			chatModel: { provider: "test-provider" },
			toolsConfig: {
				manage_notes: {},
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
		mockShouldBlockFile.mockReturnValue(false);
		mockGetPendingUpdatesForPath.mockReturnValue([]);
		mockDiscardPendingById.mockReturnValue("not_found");
		mockGetPendingByShortId.mockReturnValue(undefined);
		mockGetEntry.mockReturnValue(undefined);
		mockAddChanges.mockReturnValue(["mock-id"]);
		mockGetIndexableVaultFiles.mockReturnValue([]);
		setMockAgentData();
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

	describe("privacy filter", () => {
		// The privacy filter is an exfiltration control: it exists to stop vault
		// content reaching an untrusted provider. So it gates the operations that
		// READ a note into the model's context (update, delete) and not the ones
		// that only write or rename (create, move).

		it("blocks an update whose target is private for the current provider", async () => {
			const file = makeFile("Private/secrets.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			mockShouldBlockFile.mockReturnValue(true);

			const result = await tool.invoke(
				{
					operations: [
						{ type: "update", path: "Private/secrets.md", edits: [{ oldText: "a", newText: "b" }] },
					],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("private for the current provider");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});

		it("blocks a delete whose target is private for the current provider", async () => {
			const file = makeFile("Private/secrets.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			mockShouldBlockFile.mockReturnValue(true);

			const result = await tool.invoke(
				{ operations: [{ type: "delete", path: "Private/secrets.md" }] },
				THREAD_CONFIG,
			);

			expect(result).toContain("private for the current provider");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});

		it("stages a create into a private location — content flows to the vault, not the provider", async () => {
			vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(null);
			mockShouldBlockFile.mockReturnValue(true);

			const result = await tool.invoke(
				{ operations: [{ type: "create", path: "Private/new.md", content: "hello" }] },
				THREAD_CONFIG,
			);

			expect(result).not.toContain("private for the current provider");
			expect(mockAddChanges).toHaveBeenCalledWith(
				[{ type: "create", path: "Private/new.md", content: "hello" }],
				expect.any(String),
				"test-thread-id",
			);
		});

		it("stages a move even when both source and destination are private — a move never reads content", async () => {
			const file = makeFile("Private/source.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(null);
			mockShouldBlockFile.mockReturnValue(true);

			const result = await tool.invoke(
				{ operations: [{ type: "move", path: "Private/source.md", newPath: "Private/moved.md" }] },
				THREAD_CONFIG,
			);

			expect(result).not.toContain("private for the current provider");
			expect(mockAddChanges).toHaveBeenCalledWith(
				[{ type: "move", path: "Private/source.md", newPath: "Private/moved.md" }],
				expect.any(String),
				"test-thread-id",
			);
		});

		it("never consults the privacy filter for create or move", async () => {
			const file = makeFile("Private/source.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(null);

			await tool.invoke(
				{
					operations: [
						{ type: "create", path: "Private/new.md", content: "hello" },
						{ type: "move", path: "Private/source.md", newPath: "Public/moved.md" },
					],
				},
				THREAD_CONFIG,
			);

			expect(mockShouldBlockFile).not.toHaveBeenCalled();
		});
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

		it("refuses a zero-width regex edit that would insert at every boundary", async () => {
			const file = makeFile("Notes/zw.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			// `\b` matches zero-width at word boundaries — replacing it would scatter
			// the replacement across the note rather than substitute text.
			vi.mocked(app.vault.read).mockResolvedValue("hello world");

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/zw.md",
							edits: [{ oldText: "\\b", newText: "X", is_regex: true, replace_all: true }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("zero-width");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});
	});

	describe("same-thread re-staging rebases onto pending content", () => {
		const DISK = "line one\nline two\nline three\n";
		const PROPOSED = "line one\nline two edited\nline three\n";

		function pendingEntry(threadId: string, originalContent = DISK) {
			return {
				id: "prior-id",
				status: "pending",
				toolCallId: "tc-prior",
				threadId,
				createdAt: 1,
				change: { type: "update", path: "Notes/doc.md", originalContent, newContent: PROPOSED },
			};
		}

		beforeEach(() => {
			const file = makeFile("Notes/doc.md");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
			vi.mocked(app.vault.read).mockResolvedValue(DISK);
		});

		it("applies edits against this thread's pending newContent and says so", async () => {
			mockGetPendingUpdatesForPath.mockReturnValue([pendingEntry("test-thread-id")]);

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							// Matches only the PENDING proposal's text, not disk.
							edits: [{ oldText: "line two edited", newText: "line two edited twice" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("contains BOTH");
			const staged = mockAddChanges.mock.calls[0][0][0];
			// Conflict baseline stays disk; the proposal carries both rounds of edits.
			expect(staged.originalContent).toBe(DISK);
			expect(staged.newContent).toBe("line one\nline two edited twice\nline three\n");
		});

		/**
		 * Regression (PR #426 review): the read tools are unaware of staged
		 * changes, so a model that re-reads the note holds DISK text. Rebasing
		 * unconditionally onto the pending proposal made those edits miss and
		 * aborted the whole batch instead of staging a reviewable proposal.
		 */
		it("falls back to disk when the edits match disk, not the pending proposal", async () => {
			// The pending proposal REPLACED "line two" with "changed line", so the
			// disk text no longer exists in it — the two bases are unambiguous.
			mockGetPendingUpdatesForPath.mockReturnValue([
				{
					...pendingEntry("test-thread-id"),
					change: {
						type: "update",
						path: "Notes/doc.md",
						originalContent: DISK,
						newContent: "line one\nchanged line\nline three\n",
					},
				},
			]);

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							// Matches DISK content — what read_content would have returned.
							edits: [{ oldText: "line two", newText: "line two rewritten" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("Proposed");
			expect(result).not.toContain("contains BOTH");
			const staged = mockAddChanges.mock.calls[0][0][0];
			expect(staged.originalContent).toBe(DISK);
			expect(staged.newContent).toBe("line one\nline two rewritten\nline three\n");
		});

		/**
		 * Pending-first precedence, pinned (PR #426 review, second pass).
		 *
		 * When the model's edit CONFLICTS with the pending one (both touch the same
		 * text), the pending base simply fails to match and the loop falls through
		 * to disk — so the model's disk-derived intent wins on its own.
		 *
		 * When both bases match, the edits are necessarily orthogonal (the target
		 * text survived the pending edit), and pending-first is what preserves BOTH
		 * rounds. Disk-first would silently drop the earlier unreviewed edit, which
		 * is the data loss this whole rebase exists to prevent.
		 */
		it("keeps both rounds when the follow-up edit is orthogonal to the pending one", async () => {
			mockGetPendingUpdatesForPath.mockReturnValue([
				{
					...pendingEntry("test-thread-id"),
					change: {
						type: "update",
						path: "Notes/doc.md",
						originalContent: DISK,
						// Pending touched line ONE; the follow-up below touches line three.
						newContent: "line one edited\nline two\nline three\n",
					},
				},
			]);

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							edits: [{ oldText: "line three", newText: "line three edited" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("contains BOTH");
			const staged = mockAddChanges.mock.calls[0][0][0];
			// Both edits present — disk-first would have lost "line one edited".
			expect(staged.newContent).toBe("line one edited\nline two\nline three edited\n");
		});

		it("lets a conflicting disk-derived edit win over the pending base", async () => {
			mockGetPendingUpdatesForPath.mockReturnValue([
				{
					...pendingEntry("test-thread-id"),
					change: {
						type: "update",
						path: "Notes/doc.md",
						originalContent: DISK,
						// Pending rewrote the very line the follow-up targets.
						newContent: "line one\nPENDING VERSION\nline three\n",
					},
				},
			]);

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							// Written against disk; no longer present in the pending base.
							edits: [{ oldText: "line two", newText: "MODEL VERSION" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			// Pending base can't match, so disk wins and the model's intent stands.
			expect(result).not.toContain("contains BOTH");
			const staged = mockAddChanges.mock.calls[0][0][0];
			expect(staged.newContent).toBe("line one\nMODEL VERSION\nline three\n");
		});

		it("reports the disk-base error when the edits match neither base", async () => {
			mockGetPendingUpdatesForPath.mockReturnValue([pendingEntry("test-thread-id")]);

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							edits: [{ oldText: "nowhere at all", newText: "x" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("Could not find the specified text");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});

		it("falls back to disk when the pending proposal is stale against disk", async () => {
			mockGetPendingUpdatesForPath.mockReturnValue([pendingEntry("test-thread-id", "some older disk content\n")]);

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							edits: [{ oldText: "line two edited", newText: "x" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			// The edit targeted the pending proposal's text, which is not the base here.
			expect(result).toContain("Could not find the specified text");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});

		it("ignores pending updates from other threads", async () => {
			mockGetPendingUpdatesForPath.mockReturnValue([pendingEntry("some-other-thread")]);

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							edits: [{ oldText: "line two", newText: "line 2" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).not.toContain("contains BOTH");
			const staged = mockAddChanges.mock.calls[0][0][0];
			expect(staged.newContent).toBe("line one\nline 2\nline three\n");
		});

		it("rebases a vault-wide replace the same way", async () => {
			const file = makeFile("Notes/doc.md");
			mockGetIndexableVaultFiles.mockReturnValue([file]);
			mockGetPendingUpdatesForPath.mockReturnValue([pendingEntry("test-thread-id")]);

			const result = await tool.invoke(
				{
					operations: [{ type: "replace", find: "edited", replace: "changed" }],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("contains BOTH");
			const staged = mockAddChanges.mock.calls[0][0][0];
			expect(staged.originalContent).toBe(DISK);
			expect(staged.newContent).toBe("line one\nline two changed\nline three\n");
		});

		it("replaces against disk when the pattern only occurs there", async () => {
			const file = makeFile("Notes/doc.md");
			mockGetIndexableVaultFiles.mockReturnValue([file]);
			// Pending proposal replaced "three" with "3", so "three" now exists
			// only on disk — the replace must target the text the model can see.
			mockGetPendingUpdatesForPath.mockReturnValue([
				{
					...pendingEntry("test-thread-id"),
					change: {
						type: "update",
						path: "Notes/doc.md",
						originalContent: DISK,
						newContent: "line one\nline two\nline 3\n",
					},
				},
			]);

			const result = await tool.invoke(
				{
					operations: [{ type: "replace", find: "three", replace: "THREE" }],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("Proposed");
			const staged = mockAddChanges.mock.calls[0][0][0];
			expect(staged.newContent).toBe("line one\nline two\nline THREE\n");
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

		it("refuses a zero-width regex in a vault-wide replace", async () => {
			const a = makeFile("Notes/a.md");
			mockGetIndexableVaultFiles.mockReturnValue([a]);
			vi.mocked(app.vault.read).mockResolvedValue("hello world");

			const result = await tool.invoke(
				{
					operations: [{ type: "replace", find: "\\b", replace: "X", is_regex: true }],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("zero-width");
			expect(mockAddChanges).not.toHaveBeenCalled();
		});

		it("refuses a structurally empty-matchable regex upfront in a vault-wide replace", async () => {
			const a = makeFile("Notes/a.md");
			mockGetIndexableVaultFiles.mockReturnValue([a]);
			vi.mocked(app.vault.read).mockResolvedValue("anything");

			const result = await tool.invoke(
				{
					operations: [{ type: "replace", find: "x*", replace: "Y", is_regex: true }],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("zero-width");
			expect(mockAddChanges).not.toHaveBeenCalled();
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
	});

	/**
	 * The agent's retraction path. Before this, `manage_notes` could only stage,
	 * so an agent correcting itself ("i meant at the bottom") could do nothing but
	 * stage a second proposal — which the rebase then merged with the first,
	 * leaving BOTH edits in the review queue while the agent told the user the
	 * earlier one had been superseded.
	 *
	 * Keyed by id, not path. Resolving a proposal from a path went through four
	 * rounds of tie-breaking and still had a case where every choice was wrong: a
	 * path moves with a rename, can be reused by another note, and can name two
	 * live proposals at once. An id has none of that.
	 */
	describe("discard withdraws a pending proposal by id", () => {
		it("withdraws the proposal with that id and stages nothing", async () => {
			mockGetPendingByShortId.mockReturnValue({ change: { path: "Notes/doc.md" } });
			mockDiscardPendingById.mockReturnValue("discarded");

			const result = await tool.invoke({ operations: [{ type: "discard", id: "4f2a9c" }] }, THREAD_CONFIG);

			expect(mockDiscardPendingById).toHaveBeenCalledWith("4f2a9c", "test-thread-id");
			expect(result).toContain("Withdrew 1 pending proposal(s)");
			// Reported by path — that is what the user sees in the review bar.
			expect(result).toContain("Notes/doc.md");
			// A discard proposes nothing, so it must not inflate the operation tally.
			expect(result).not.toContain("Proposed");
			expect(mockAddChanges).toHaveBeenCalledWith([], expect.anything(), "test-thread-id");
		});

		it("is a neutral report rather than an error for an unknown id", async () => {
			mockDiscardPendingById.mockReturnValue("not_found");

			const result = await tool.invoke({ operations: [{ type: "discard", id: "nosuch" }] }, THREAD_CONFIG);

			expect(result).not.toContain("Error");
			expect(result).toContain("No pending proposal in this chat with id");
			expect(result).toContain("nosuch");
			// The model must not claim a retraction that never happened.
			expect(result).toContain("do not tell the user you took anything back");
		});

		it("refuses a proposal the user has already partly applied", async () => {
			mockGetPendingByShortId.mockReturnValue({ change: { path: "Notes/doc.md" } });
			mockDiscardPendingById.mockReturnValue("partially_applied");

			const result = await tool.invoke({ operations: [{ type: "discard", id: "4f2a9c" }] }, THREAD_CONFIG);

			expect(result).toContain("Could not withdraw 1 proposal(s)");
			expect(result).toContain("Leave it to them to undo");
		});

		it("allows discard and update for the same note in one batch", async () => {
			// The batch's one-target-per-path guard keys on paths; a discard names
			// an id, so this correction idiom must not trip it.
			mockGetPendingByShortId.mockReturnValue({ change: { path: "Notes/doc.md" } });
			mockDiscardPendingById.mockReturnValue("discarded");
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file: makeFile("Notes/doc.md") });
			vi.mocked(app.vault.read).mockResolvedValue("line one\nline two\n");

			const result = await tool.invoke(
				{
					operations: [
						{ type: "discard", id: "4f2a9c" },
						{
							type: "update",
							path: "Notes/doc.md",
							edits: [{ oldText: "line two", newText: "line two edited" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).not.toContain("targeted more than once");
			expect(result).toContain("Withdrew 1 pending proposal(s)");
			const staged = mockAddChanges.mock.calls[0][0][0];
			expect(staged.newContent).toBe("line one\nline two edited\n");
		});

		it("is scoped to this thread", async () => {
			// The store does the scoping; assert the tool passes the thread through
			// rather than letting one chat withdraw another's proposal.
			mockDiscardPendingById.mockReturnValue("not_found");

			await tool.invoke({ operations: [{ type: "discard", id: "4f2a9c" }] }, THREAD_CONFIG);

			expect(mockDiscardPendingById).toHaveBeenCalledWith("4f2a9c", "test-thread-id");
		});
	});

	/**
	 * The ids are the whole retraction mechanism: `discard` takes one, and the
	 * model has no other way to name a proposal. If staging stops reporting them
	 * the feature is unreachable, so this is pinned separately.
	 */
	describe("staged proposals are reported with their ids", () => {
		it("lists each pending proposal's path and id", async () => {
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file: makeFile("Notes/doc.md") });
			vi.mocked(app.vault.read).mockResolvedValue("line one\n");
			mockAddChanges.mockReturnValue(["uuid-1"]);
			mockGetEntry.mockReturnValue({
				status: "pending",
				shortId: "4f2a9c",
				change: { path: "Notes/doc.md" },
			});

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							edits: [{ oldText: "line one", newText: "line one edited" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain('"Notes/doc.md" (id: 4f2a9c)');
			expect(result).toContain("discard");
		});

		it("omits ids for changes that were auto-applied rather than staged", async () => {
			// A memory write applies immediately, so it is never awaiting review and
			// has no id to withdraw — listing one would invite a discard that fails.
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file: makeFile("Notes/doc.md") });
			vi.mocked(app.vault.read).mockResolvedValue("line one\n");
			mockAddChanges.mockReturnValue(["uuid-1"]);
			mockGetEntry.mockReturnValue({
				status: "accepted",
				shortId: "4f2a9c",
				change: { path: "Notes/doc.md" },
			});

			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							edits: [{ oldText: "line one", newText: "line one edited" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).not.toContain("(id: 4f2a9c)");
		});
	});

	describe("replace_pending opts out of the rebase", () => {
		const DISK = "line one\nline two\nline three\n";

		beforeEach(() => {
			mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file: makeFile("Notes/doc.md") });
			vi.mocked(app.vault.read).mockResolvedValue(DISK);
			// A pending proposal that the default rebase WOULD have merged with:
			// its edit is orthogonal, so both bases match.
			mockGetPendingUpdatesForPath.mockReturnValue([
				{
					id: "prior-id",
					status: "pending",
					toolCallId: "tc-prior",
					threadId: "test-thread-id",
					createdAt: 1,
					change: {
						type: "update",
						path: "Notes/doc.md",
						originalContent: DISK,
						newContent: "line one edited\nline two\nline three\n",
					},
				},
			]);
		});

		it("stages an update against disk and drops the earlier proposal", async () => {
			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							replace_pending: true,
							edits: [{ oldText: "line three", newText: "line three edited" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			// No merge note: this REPLACES the earlier proposal rather than adding to it.
			expect(result).not.toContain("contains BOTH");
			const staged = mockAddChanges.mock.calls[0][0][0];
			// "line one edited" is absent — the earlier round was deliberately dropped.
			expect(staged.newContent).toBe("line one\nline two\nline three edited\n");
		});

		it("merges instead when the flag is omitted", async () => {
			const result = await tool.invoke(
				{
					operations: [
						{
							type: "update",
							path: "Notes/doc.md",
							edits: [{ oldText: "line three", newText: "line three edited" }],
						},
					],
				},
				THREAD_CONFIG,
			);

			expect(result).toContain("contains BOTH");
			const staged = mockAddChanges.mock.calls[0][0][0];
			expect(staged.newContent).toBe("line one edited\nline two\nline three edited\n");
		});

		it("applies to a vault-wide replace too", async () => {
			mockGetIndexableVaultFiles.mockReturnValue([makeFile("Notes/doc.md")]);

			const result = await tool.invoke(
				{
					operations: [{ type: "replace", find: "line two", replace: "LINE 2", replace_pending: true }],
				},
				THREAD_CONFIG,
			);

			expect(result).not.toContain("contains BOTH");
			const staged = mockAddChanges.mock.calls[0][0][0];
			expect(staged.newContent).toBe("line one\nLINE 2\nline three\n");
		});
	});
});
