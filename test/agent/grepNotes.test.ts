import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

vi.mock("../../src/utils/logging", () => ({
	Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
}));

const mockShouldBlockFile = vi.fn().mockReturnValue(false);
vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
	getPendingChangesStore: () => ({ shouldBlockFile: mockShouldBlockFile }),
}));

const mockGetData = vi.fn();
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => mockGetData(),
	DEFAULT_TOOLS_CONFIG: { grep_notes: { name: "grep_notes", description: "grep" } },
}));

const mockGetIndexableVaultFiles = vi.fn().mockReturnValue([]);
vi.mock("../../src/utils/fileFiltering", () => ({
	getIndexableVaultFiles: (...args: unknown[]) => mockGetIndexableVaultFiles(...args),
	isTextIndexableFile: (file: { extension: string }) =>
		["md", "txt", "csv", "json", "yaml", "yml", "canvas", "chat"].includes(file.extension.toLowerCase()),
	shouldProcessVaultPath: (filePath: string, prefix: string) => filePath.startsWith(prefix),
}));

const mockResolveFileReferenceDetailed = vi.fn();
vi.mock("../../src/utils/pathResolution", () => ({
	resolveFileReferenceDetailed: (...args: unknown[]) => mockResolveFileReferenceDetailed(...args),
}));

import type { App } from "obsidian";
import { createGrepNotesTool } from "../../src/agent/tools/grepNotes";

function makeFile(path: string, ext = "md") {
	return { path, name: path.split("/").pop()!, extension: ext };
}

function createMockApp(readImpl: (f: { path: string }) => string) {
	return {
		vault: {
			cachedRead: vi.fn().mockImplementation(async (f: { path: string }) => readImpl(f)),
		},
	} as unknown as App;
}

describe("grep_notes tool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockShouldBlockFile.mockReturnValue(false);
		mockGetIndexableVaultFiles.mockReturnValue([]);
		mockGetData.mockReturnValue({
			getSelectedAgent: () => ({
				chatModel: { provider: "test-provider" },
				toolsConfig: { grep_notes: { name: "grep_notes", description: "grep", settings: { contextLines: 1 } } },
			}),
		});
	});

	it("finds a literal match across the vault with line numbers and context", async () => {
		const a = makeFile("a.md");
		const b = makeFile("b.md");
		mockGetIndexableVaultFiles.mockReturnValue([a, b]);
		const app = createMockApp((f) => (f.path === "a.md" ? "line one\nhas TODO(fix) here\nline three" : "nothing"));
		const tool = createGrepNotesTool(app);

		const raw = await tool.invoke({ pattern: "TODO(fix)" });
		const payload = JSON.parse(raw as string);

		expect(payload.scope).toBe("vault");
		expect(payload.total_matches).toBe(1);
		expect(payload.results).toHaveLength(1);
		expect(payload.results[0].path).toBe("a.md");
		expect(payload.results[0].matches[0].line_number).toBe(2);
		expect(payload.results[0].matches[0].context).toContain("> 2 | has TODO(fix) here");
		expect(payload.results[0].matches[0].context).toContain("  1 | line one");
	});

	it("scopes to a single note via path", async () => {
		const file = makeFile("Notes/target.md");
		mockResolveFileReferenceDetailed.mockReturnValue({ status: "found", file });
		const app = createMockApp(() => "alpha\nbeta\nalpha again");
		const tool = createGrepNotesTool(app);

		const payload = JSON.parse((await tool.invoke({ pattern: "alpha", path: "Notes/target.md" })) as string);

		expect(payload.scope).toBe("note");
		expect(payload.total_matches).toBe(2);
		expect(mockGetIndexableVaultFiles).not.toHaveBeenCalled();
	});

	it("pages results with offset/limit and reports next_offset", async () => {
		const file = makeFile("big.md");
		mockGetIndexableVaultFiles.mockReturnValue([file]);
		const app = createMockApp(() => Array.from({ length: 5 }, () => "match").join("\n"));
		const tool = createGrepNotesTool(app);

		const page1 = JSON.parse((await tool.invoke({ pattern: "match", limit: 2 })) as string);
		expect(page1.total_matches).toBe(5);
		expect(page1.returned).toBe(2);
		expect(page1.has_more).toBe(true);
		expect(page1.next_offset).toBe(2);

		const page2 = JSON.parse((await tool.invoke({ pattern: "match", limit: 2, offset: 2 })) as string);
		expect(page2.returned).toBe(2);
		expect(page2.has_more).toBe(true);
		expect(page2.next_offset).toBe(4);
	});

	it("matches with regex when is_regex is true", async () => {
		const file = makeFile("tags.md");
		mockGetIndexableVaultFiles.mockReturnValue([file]);
		const app = createMockApp(() => "#foo/bar nested\n#plain single");
		const tool = createGrepNotesTool(app);

		const payload = JSON.parse((await tool.invoke({ pattern: "#\\w+/\\w+", is_regex: true })) as string);
		expect(payload.total_matches).toBe(1);
		expect(payload.results[0].matches[0].line_number).toBe(1);
	});

	it("returns an error for an invalid regex", async () => {
		const app = createMockApp(() => "");
		const tool = createGrepNotesTool(app);
		const result = (await tool.invoke({ pattern: "(unclosed", is_regex: true })) as string;
		expect(result).toContain("Invalid regular expression");
	});

	it("reports zero matches with a message", async () => {
		const file = makeFile("x.md");
		mockGetIndexableVaultFiles.mockReturnValue([file]);
		const app = createMockApp(() => "nothing here");
		const tool = createGrepNotesTool(app);

		const payload = JSON.parse((await tool.invoke({ pattern: "absent" })) as string);
		expect(payload.total_matches).toBe(0);
		expect(payload.message).toContain("No matches");
	});

	it("skips files blocked by privacy for the current provider", async () => {
		const a = makeFile("public.md");
		const b = makeFile("private.md");
		mockGetIndexableVaultFiles.mockReturnValue([a, b]);
		mockShouldBlockFile.mockImplementation((path: string) => path === "private.md");
		const app = createMockApp(() => "secret token");
		const tool = createGrepNotesTool(app);

		const payload = JSON.parse((await tool.invoke({ pattern: "token" })) as string);
		expect(payload.files_searched).toBe(1);
		expect(payload.total_matches).toBe(1);
		expect(payload.results[0].path).toBe("public.md");
	});

	it("errors when a scoped path is not a text note", async () => {
		mockResolveFileReferenceDetailed.mockReturnValue({ status: "found", file: makeFile("doc.pdf", "pdf") });
		const app = createMockApp(() => "");
		const tool = createGrepNotesTool(app);

		const result = (await tool.invoke({ pattern: "x", path: "doc.pdf" })) as string;
		expect(result).toContain("read_content");
	});
});
