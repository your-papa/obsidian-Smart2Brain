import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

const mockIsPathAllowed = vi.fn().mockReturnValue(true);
const mockShouldBlockFile = vi.fn().mockReturnValue(false);

vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
    getPendingChangesStore: () => ({
        isPathAllowed: mockIsPathAllowed,
        shouldBlockFile: mockShouldBlockFile,
    }),
}));

const mockGetData = vi.fn();
vi.mock("../../src/stores/dataStore.svelte", () => ({
    getData: () => mockGetData(),
    DEFAULT_TOOLS_CONFIG: {
        list_directory: {
            name: "list_directory",
            description: "List directories and files in the vault.",
        },
    },
}));

import type { App } from "obsidian";
import { createListDirectoryTool } from "../../src/agent/tools/listDirectory";

function createFile(path: string, size = 100) {
    const name = path.split("/").pop() ?? path;
    const dot = name.lastIndexOf(".");
    return {
        path,
        name,
        extension: dot >= 0 ? name.slice(dot + 1) : "",
        stat: { size },
    };
}

function createMockApp(files: Array<ReturnType<typeof createFile>>): App {
    return {
        vault: {
            getFiles: vi.fn().mockReturnValue(files),
            getAbstractFileByPath: vi.fn().mockReturnValue(null),
        },
    } as unknown as App;
}

describe("listDirectory tool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsPathAllowed.mockReturnValue(true);
        mockShouldBlockFile.mockReturnValue(false);
        mockGetData.mockReturnValue({
            getSelectedAgent: () => ({
                chatModel: { provider: "openai" },
                toolsConfig: {
                    list_directory: {
                        name: "list_directory",
                        description: "List directories and files in the vault.",
                    },
                },
            }),
        });
    });

    it("lists top-level folders and files by default", async () => {
        const app = createMockApp([
            createFile("Inbox/today.md"),
            createFile("Projects/Roadmap.md"),
            createFile("root.md"),
        ]);
        const tool = createListDirectoryTool(app);

        const result = await tool.invoke({});
        const parsed = JSON.parse(result as string) as {
            folders: string[];
            files: Array<{ path: string }>;
            totalFolders: number;
            totalFiles: number;
        };

        expect(parsed.folders).toEqual(["Inbox", "Projects"]);
        expect(parsed.files.map((file) => file.path)).toEqual(["root.md"]);
        expect(parsed.totalFolders).toBe(2);
        expect(parsed.totalFiles).toBe(1);
    });

    it("supports recursive listing with depth limits", async () => {
        const app = createMockApp([
            createFile("Projects/2026/Plan.md"),
            createFile("Projects/2026/Q1/Goals.md"),
        ]);
        const tool = createListDirectoryTool(app);

        const result = await tool.invoke({ path: "Projects", recursive: true, maxDepth: 2 });
        const parsed = JSON.parse(result as string) as {
            folders: string[];
            files: Array<{ path: string }>;
        };

        expect(parsed.folders).toEqual(["2026", "2026/Q1"]);
        expect(parsed.files.map((file) => file.path)).toEqual(["2026/Plan.md", "2026/Q1/Goals.md"]);
    });

    it("filters private files for the current provider", async () => {
        mockShouldBlockFile.mockImplementation((path: string) => path === "Secret/plan.md");
        const app = createMockApp([createFile("Secret/plan.md"), createFile("Public/plan.md")]);
        const tool = createListDirectoryTool(app);

        const result = await tool.invoke({ recursive: true });
        const parsed = JSON.parse(result as string) as {
            skippedPrivateFiles: number;
            files: Array<{ path: string }>;
        };

        expect(parsed.skippedPrivateFiles).toBe(1);
        expect(parsed.files.map((file) => file.path)).toEqual(["Public/plan.md"]);
    });
});
