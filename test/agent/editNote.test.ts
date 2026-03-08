import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// Mock pendingChangesStore
const mockAddChange = vi.fn().mockReturnValue("mock-id");
const mockIsPathAllowed = vi.fn().mockReturnValue(true);
vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
    getPendingChangesStore: () => ({
        addChange: mockAddChange,
        isPathAllowed: mockIsPathAllowed,
    }),
}));

// Mock runContext
vi.mock("../../src/agent/tools/runContext", () => ({
    getCurrentThreadId: () => "test-thread-id",
}));

// Mock attachments
const mockResolveVaultFileDetailed = vi.fn();
vi.mock("../../src/utils/attachments", () => ({
    resolveVaultFileDetailed: (...args: unknown[]) => mockResolveVaultFileDetailed(...args),
}));

import type { App } from "obsidian";
import { createEditNoteTool } from "../../src/agent/tools/editNote";

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

describe("editNote tool", () => {
    let app: App;
    let tool: ReturnType<typeof createEditNoteTool>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockIsPathAllowed.mockReturnValue(true);
        app = createMockApp();
        tool = createEditNoteTool(app);
    });

    it("should apply a single search-and-replace edit", async () => {
        const file = makeFile("Notes/test.md");
        mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
        vi.mocked(app.vault.read).mockResolvedValue("Hello world\nThis is a test\nGoodbye");

        const result = await tool.invoke({
            path: "Notes/test.md",
            edits: [{ oldText: "This is a test", newText: "This is updated" }],
        });

        expect(result).toContain("Proposed 1 edit(s)");
        expect(mockAddChange).toHaveBeenCalledWith(
            {
                type: "update",
                path: "Notes/test.md",
                originalContent: "Hello world\nThis is a test\nGoodbye",
                newContent: "Hello world\nThis is updated\nGoodbye",
            },
            expect.any(String),
            "test-thread-id",
        );
    });

    it("should apply multiple sequential edits", async () => {
        const file = makeFile("Notes/test.md");
        mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
        vi.mocked(app.vault.read).mockResolvedValue("AAA\nBBB\nCCC");

        const result = await tool.invoke({
            path: "Notes/test.md",
            edits: [
                { oldText: "AAA", newText: "111" },
                { oldText: "CCC", newText: "333" },
            ],
        });

        expect(result).toContain("Proposed 2 edit(s)");
        expect(mockAddChange).toHaveBeenCalledWith(
            expect.objectContaining({
                newContent: "111\nBBB\n333",
            }),
            expect.any(String),
            "test-thread-id",
        );
    });

    it("should return error when oldText is not found", async () => {
        const file = makeFile("Notes/test.md");
        mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
        vi.mocked(app.vault.read).mockResolvedValue("Hello world");

        const result = await tool.invoke({
            path: "Notes/test.md",
            edits: [{ oldText: "nonexistent text", newText: "replacement" }],
        });

        expect(result).toContain("Error in edit 1");
        expect(result).toContain("Could not find");
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it("should return error when oldText matches multiple times", async () => {
        const file = makeFile("Notes/test.md");
        mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
        vi.mocked(app.vault.read).mockResolvedValue("foo bar foo");

        const result = await tool.invoke({
            path: "Notes/test.md",
            edits: [{ oldText: "foo", newText: "baz" }],
        });

        expect(result).toContain("Error in edit 1");
        expect(result).toContain("appears multiple times");
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it("should return error for non-markdown files", async () => {
        const file = makeFile("Notes/image.png", "png");
        mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });

        const result = await tool.invoke({
            path: "Notes/image.png",
            edits: [{ oldText: "a", newText: "b" }],
        });

        expect(result).toContain("Only markdown files");
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it("should return error when file is not found", async () => {
        mockResolveVaultFileDetailed.mockReturnValue({ status: "not_found" });

        const result = await tool.invoke({
            path: "nonexistent.md",
            edits: [{ oldText: "a", newText: "b" }],
        });

        expect(result).toContain("File not found");
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it("should return error for ambiguous path", async () => {
        mockResolveVaultFileDetailed.mockReturnValue({
            status: "ambiguous",
            candidates: ["Notes/test.md", "Archive/test.md"],
        });

        const result = await tool.invoke({
            path: "test.md",
            edits: [{ oldText: "a", newText: "b" }],
        });

        expect(result).toContain("Multiple files match");
        expect(result).toContain("Notes/test.md");
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it("should return error when path is excluded by filter", async () => {
        const file = makeFile("Excluded/test.md");
        mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
        mockIsPathAllowed.mockReturnValue(false);

        const result = await tool.invoke({
            path: "Excluded/test.md",
            edits: [{ oldText: "a", newText: "b" }],
        });

        expect(result).toContain("excluded by the vault's file filter");
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it("should handle wiki-link syntax in path", async () => {
        const file = makeFile("Notes/My Note.md");
        mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
        vi.mocked(app.vault.read).mockResolvedValue("content here");

        await tool.invoke({
            path: "[[My Note]]",
            edits: [{ oldText: "content here", newText: "updated content" }],
        });

        expect(mockResolveVaultFileDetailed).toHaveBeenCalledWith(app, "My Note");
    });

    it("should apply edits sequentially so later edits see prior changes", async () => {
        const file = makeFile("Notes/test.md");
        mockResolveVaultFileDetailed.mockReturnValue({ status: "found", file });
        vi.mocked(app.vault.read).mockResolvedValue("start AAA middle BBB end");

        // First edit changes AAA to XXX, second edit targets a string that includes XXX
        await tool.invoke({
            path: "Notes/test.md",
            edits: [
                { oldText: "AAA", newText: "XXX" },
                { oldText: "XXX middle", newText: "YYY between" },
            ],
        });

        expect(mockAddChange).toHaveBeenCalledWith(
            expect.objectContaining({
                newContent: "start YYY between BBB end",
            }),
            expect.any(String),
            "test-thread-id",
        );
    });
});
