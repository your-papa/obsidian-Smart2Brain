import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const mockIsPathAllowed = vi.fn().mockReturnValue(true);
const mockShouldBlockFile = vi.fn().mockReturnValue(false);
const mockAddChanges = vi.fn().mockReturnValue(["mock-id"]);

vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
    getPendingChangesStore: () => ({
        isPathAllowed: mockIsPathAllowed,
        shouldBlockFile: mockShouldBlockFile,
        addChanges: mockAddChanges,
    }),
}));

vi.mock("../../src/agent/tools/runContext", () => ({
    getCurrentThreadId: () => "test-thread-id",
    getCurrentSpaces: vi.fn(),
    setCurrentSpaces: vi.fn(),
}));

const mockResolveCurrentSpaceScope = vi.fn();
vi.mock("../../src/agent/tools/spaceScope", () => ({
    resolveCurrentSpaceScope: (...args: unknown[]) => mockResolveCurrentSpaceScope(...args),
}));

const mockGetData = vi.fn();
vi.mock("../../src/stores/dataStore.svelte", () => ({
    getData: () => mockGetData(),
    DEFAULT_TOOLS_CONFIG: {
        list_directory: {
            name: "list_directory",
            description: "List directories and files in the vault.",
        },
        read_content: {
            name: "read_content",
            description: "Read content of vault files.",
        },
        manage_notes: {
            name: "manage_notes",
            description: "Create, update, delete, or move markdown notes.",
        },
        get_all_tags: {
            name: "get_all_tags",
            description: "Retrieve tags.",
        },
        get_properties: {
            name: "get_properties",
            description: "Retrieve properties.",
        },
    },
    READ_CONTENT_DESC_DEFAULTS: new Set(["Read content of vault files."]),
    READ_CONTENT_GUIDANCE_DEFAULTS: {
        none: "",
        image: "",
        pdf: "",
        both: "",
    },
    READ_CONTENT_DESC_NONE: "Read content of vault files.",
    READ_CONTENT_GUIDANCE_NONE: "",
    getReadContentDescription: () => "Read content of vault files.",
    getReadContentGuidance: () => "",
}));

const mockResolveVaultFileDetailed = vi.fn();
vi.mock("../../src/utils/attachments", () => ({
    resolveVaultFileDetailed: (...args: unknown[]) => mockResolveVaultFileDetailed(...args),
    isImageExtension: () => false,
    isPdfExtension: () => false,
    isTextExtension: () => true,
    mimeFromExtension: () => "text/plain",
    toBase64: vi.fn(),
    toBase64DataUri: vi.fn(),
}));

vi.mock("../../src/utils/pathResolution", () => ({
    extractReferenceInfo: (path: string) => ({ path, subpath: "" }),
    resolveFileReferenceDetailed: (app: unknown, path: string) => {
        return mockResolveVaultFileDetailed(path);
    },
    normalizeReferencePath: (path: string) => path,
}));

vi.mock("../../src/utils/logging", () => ({
    Logger: {
        warn: vi.fn(),
        debug: vi.fn(),
        log: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

import type { App } from "obsidian";
import { createListDirectoryTool } from "../../src/agent/tools/listDirectory";
import { createReadContentTool } from "../../src/agent/tools/readContent";
import { createManageNotesTool } from "../../src/agent/tools/manageNotes";
import { createGetAllTagsTool } from "../../src/agent/tools/getAllTags";
import { createGetPropertiesTool } from "../../src/agent/tools/getProperties";
import type { SpaceScope } from "../../src/agent/tools/spaceScope";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unrestrictedScope(): SpaceScope {
    return {
        searchFilter: undefined,
        isPathAllowed: () => true,
        label: "entire vault",
    };
}

function spaceScopedTo(...prefixes: string[]): SpaceScope {
    return {
        searchFilter: { pathPrefixes: prefixes },
        isPathAllowed: (path: string) => prefixes.some((p) => path === p || path.startsWith(`${p}/`)),
        label: prefixes.join(", "),
    };
}

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

function createMockListApp(files: Array<ReturnType<typeof createFile>>): App {
    return {
        vault: {
            getFiles: vi.fn().mockReturnValue(files),
            getAbstractFileByPath: vi.fn().mockReturnValue(null),
        },
    } as unknown as App;
}

function setupDataStore(overrides?: Record<string, unknown>) {
    mockGetData.mockReturnValue({
        getSelectedAgent: () => ({
            chatModel: { provider: "openai" },
            toolsConfig: {
                list_directory: { name: "list_directory", description: "List" },
                read_content: { name: "read_content", description: "Read", settings: { maxContentLength: 0 } },
                manage_notes: {
                    name: "manage_notes",
                    description: "Manage",
                    settings: { allowCreate: true, allowUpdate: true, allowDelete: true, allowMove: true },
                },
                get_all_tags: { name: "get_all_tags", description: "Tags" },
                get_properties: { name: "get_properties", description: "Properties" },
            },
        }),
        ...overrides,
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Space scoping across agent tools", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsPathAllowed.mockReturnValue(true);
        mockShouldBlockFile.mockReturnValue(false);
        setupDataStore();
    });

    // -----------------------------------------------------------------------
    // list_directory
    // -----------------------------------------------------------------------
    describe("list_directory", () => {
        it("shows all files when no space is active", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(unrestrictedScope());
            const app = createMockListApp([
                createFile("Work/report.md"),
                createFile("Personal/diary.md"),
            ]);
            const tool = createListDirectoryTool(app);
            const result = JSON.parse(String(await tool.invoke({ recursive: true })));

            expect(result.totalFiles).toBe(2);
        });

        it("filters files outside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            const app = createMockListApp([
                createFile("Work/report.md"),
                createFile("Personal/diary.md"),
            ]);
            const tool = createListDirectoryTool(app);
            const result = JSON.parse(String(await tool.invoke({ recursive: true })));

            expect(result.totalFiles).toBe(1);
            expect(JSON.stringify(result.tree)).toContain("report.md");
            expect(JSON.stringify(result.tree)).not.toContain("diary.md");
        });

        it("filters files with multiple space prefixes (union)", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work", "Projects"));
            const app = createMockListApp([
                createFile("Work/report.md"),
                createFile("Projects/plan.md"),
                createFile("Personal/diary.md"),
            ]);
            const tool = createListDirectoryTool(app);
            const result = JSON.parse(String(await tool.invoke({ recursive: true })));

            expect(result.totalFiles).toBe(2);
            expect(JSON.stringify(result.tree)).not.toContain("diary.md");
        });

        it("returns error when path is outside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            const app = createMockListApp([
                createFile("Work/report.md"),
                createFile("Personal/diary.md"),
            ]);
            const tool = createListDirectoryTool(app);
            const result = String(await tool.invoke({ path: "Personal" }));

            expect(result).toContain("outside the active Space");
            expect(result).toContain("Work");
        });

        it("returns error when folder does not exist", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(unrestrictedScope());
            const app = createMockListApp([
                createFile("Work/report.md"),
            ]);
            const tool = createListDirectoryTool(app);
            const result = String(await tool.invoke({ path: "NonExistent" }));

            expect(result).toContain("does not exist");
        });
    });

    // -----------------------------------------------------------------------
    // read_content
    // -----------------------------------------------------------------------
    describe("read_content", () => {
        it("allows reading files inside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            mockResolveVaultFileDetailed.mockReturnValue({
                status: "found",
                file: { path: "Work/report.md", name: "report.md", extension: "md" },
            });
            setupDataStore();
            const app = {
                vault: {
                    read: vi.fn().mockResolvedValue("# Report\nContent here"),
                },
                metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
            } as unknown as App;

            const tool = createReadContentTool(app);
            const result = String(await tool.invoke({ path: "Work/report.md" }));

            expect(result).not.toContain("outside the active space");
            expect(result).toContain("Report");
        });

        it("blocks reading files outside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            mockResolveVaultFileDetailed.mockReturnValue({
                status: "found",
                file: { path: "Personal/diary.md", name: "diary.md", extension: "md" },
            });
            setupDataStore();
            const app = { vault: { read: vi.fn() } } as unknown as App;

            const tool = createReadContentTool(app);
            const result = String(await tool.invoke({ path: "Personal/diary.md" }));

            expect(result).toContain("outside the active space");
            expect(result).toContain("Work");
        });
    });

    // -----------------------------------------------------------------------
    // manage_notes
    // -----------------------------------------------------------------------
    describe("manage_notes", () => {
        it("allows creating files inside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            setupDataStore();
            const app = {
                vault: {
                    getAbstractFileByPath: vi.fn().mockReturnValue(null),
                    read: vi.fn(),
                },
            } as unknown as App;

            const tool = createManageNotesTool(app);
            const result = String(
                await tool.invoke({
                    operations: [{ type: "create", path: "Work/new-note.md", content: "Hello" }],
                }),
            );

            expect(result).toContain("Proposed");
            expect(result).not.toContain("outside the active space");
        });

        it("blocks creating files outside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            setupDataStore();
            const app = {
                vault: {
                    getAbstractFileByPath: vi.fn().mockReturnValue(null),
                    read: vi.fn(),
                },
            } as unknown as App;

            const tool = createManageNotesTool(app);
            const result = String(
                await tool.invoke({
                    operations: [{ type: "create", path: "Personal/new-note.md", content: "Hello" }],
                }),
            );

            expect(result).toContain("outside the active space");
            expect(result).toContain("Work");
        });

        it("blocks updating files outside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            mockResolveVaultFileDetailed.mockReturnValue({
                status: "found",
                file: { path: "Personal/diary.md", name: "diary.md", extension: "md" },
            });
            setupDataStore();
            const app = {
                vault: { read: vi.fn().mockResolvedValue("old text") },
            } as unknown as App;

            const tool = createManageNotesTool(app);
            const result = String(
                await tool.invoke({
                    operations: [
                        {
                            type: "update",
                            path: "Personal/diary.md",
                            edits: [{ oldText: "old", newText: "new" }],
                        },
                    ],
                }),
            );

            expect(result).toContain("outside the active space");
        });

        it("blocks deleting files outside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            mockResolveVaultFileDetailed.mockReturnValue({
                status: "found",
                file: { path: "Personal/diary.md", name: "diary.md", extension: "md" },
            });
            setupDataStore();
            const app = {
                vault: { read: vi.fn().mockResolvedValue("content") },
            } as unknown as App;

            const tool = createManageNotesTool(app);
            const result = String(
                await tool.invoke({
                    operations: [{ type: "delete", path: "Personal/diary.md" }],
                }),
            );

            expect(result).toContain("outside the active space");
        });

        it("blocks moving files to destinations outside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            mockResolveVaultFileDetailed.mockReturnValue({
                status: "found",
                file: { path: "Work/report.md", name: "report.md", extension: "md" },
            });
            setupDataStore();
            const app = {
                vault: {
                    getAbstractFileByPath: vi.fn().mockReturnValue(null),
                    read: vi.fn(),
                },
            } as unknown as App;

            const tool = createManageNotesTool(app);
            const result = String(
                await tool.invoke({
                    operations: [{ type: "move", path: "Work/report.md", newPath: "Personal/report.md" }],
                }),
            );

            expect(result).toContain("outside the active space");
            expect(result).toContain("Personal/report.md");
        });

        it("allows all operations when no space is active", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(unrestrictedScope());
            setupDataStore();
            const app = {
                vault: {
                    getAbstractFileByPath: vi.fn().mockReturnValue(null),
                    read: vi.fn(),
                },
            } as unknown as App;

            const tool = createManageNotesTool(app);
            const result = String(
                await tool.invoke({
                    operations: [{ type: "create", path: "Anywhere/note.md", content: "Hello" }],
                }),
            );

            expect(result).toContain("Proposed");
            expect(result).not.toContain("outside the active space");
        });
    });

    // -----------------------------------------------------------------------
    // get_all_tags
    // -----------------------------------------------------------------------
    describe("get_all_tags", () => {
        function createMockTagsApp(files: Array<{ path: string; basename: string; tags: string[] }>): App {
            return {
                vault: {
                    getMarkdownFiles: vi.fn().mockReturnValue(files),
                },
                metadataCache: {
                    getFileCache: vi.fn((file: { path: string }) => {
                        const entry = files.find((f) => f.path === file.path);
                        if (!entry || entry.tags.length === 0) return null;
                        return { tags: entry.tags.map((t) => ({ tag: t })) };
                    }),
                },
            } as unknown as App;
        }

        it("returns only tags from files within the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            setupDataStore();
            const app = createMockTagsApp([
                { path: "Work/report.md", basename: "report", tags: ["#work", "#important"] },
                { path: "Personal/diary.md", basename: "diary", tags: ["#personal", "#daily"] },
            ]);

            const tool = createGetAllTagsTool(app);
            const result = String(await tool.invoke({}));

            expect(result).toContain("#work");
            expect(result).toContain("#important");
            expect(result).not.toContain("#personal");
            expect(result).not.toContain("#daily");
        });

        it("returns all tags when no space is active", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(unrestrictedScope());
            setupDataStore();
            const app = createMockTagsApp([
                { path: "Work/report.md", basename: "report", tags: ["#work"] },
                { path: "Personal/diary.md", basename: "diary", tags: ["#personal"] },
            ]);

            const tool = createGetAllTagsTool(app);
            const result = String(await tool.invoke({}));

            expect(result).toContain("#work");
            expect(result).toContain("#personal");
        });
    });

    // -----------------------------------------------------------------------
    // get_properties
    // -----------------------------------------------------------------------
    describe("get_properties", () => {
        function createMockPropertiesApp(
            files: Array<{ path: string; basename: string; frontmatter: Record<string, unknown> | null }>,
        ): App {
            return {
                vault: {
                    getMarkdownFiles: vi.fn().mockReturnValue(files),
                },
                metadataCache: {
                    getFileCache: vi.fn((file: { path: string }) => {
                        const entry = files.find((f) => f.path === file.path);
                        if (!entry?.frontmatter) return null;
                        return { frontmatter: { ...entry.frontmatter, position: {} } };
                    }),
                },
            } as unknown as App;
        }

        it("returns only property keys from files within the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            setupDataStore();
            const app = createMockPropertiesApp([
                { path: "Work/report.md", basename: "report", frontmatter: { status: "done", priority: "high" } },
                { path: "Personal/diary.md", basename: "diary", frontmatter: { mood: "happy", weather: "sunny" } },
            ]);

            const tool = createGetPropertiesTool(app);
            const result = String(await tool.invoke({}));

            expect(result).toContain("status");
            expect(result).toContain("priority");
            expect(result).not.toContain("mood");
            expect(result).not.toContain("weather");
        });

        it("blocks reading properties of a note outside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            setupDataStore();
            const app = createMockPropertiesApp([
                { path: "Personal/diary.md", basename: "diary", frontmatter: { mood: "happy" } },
            ]);

            const tool = createGetPropertiesTool(app);
            const result = String(await tool.invoke({ note_name: "diary" }));

            expect(result).toContain("outside the active space");
        });

        it("allows reading properties of a note inside the active space", async () => {
            mockResolveCurrentSpaceScope.mockReturnValue(spaceScopedTo("Work"));
            setupDataStore();
            const app = createMockPropertiesApp([
                { path: "Work/report.md", basename: "report", frontmatter: { status: "done" } },
            ]);

            const tool = createGetPropertiesTool(app);
            const result = String(await tool.invoke({ note_name: "report" }));

            expect(result).toContain("status");
            expect(result).toContain("done");
            expect(result).not.toContain("outside the active space");
        });
    });
});
