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
		const parsed = JSON.parse(String(result)) as {
			tree: { folders: Record<string, unknown>; files: Array<{ name: string }> };
			totalFolders: number;
			totalFiles: number;
		};

		expect(Object.keys(parsed.tree.folders)).toEqual(["Inbox", "Projects"]);
		expect(parsed.tree.files.map((file) => file.name)).toEqual(["root.md"]);
		expect(String(result)).not.toContain('"files":[]');
		expect(String(result)).not.toContain('"folders":{}');
		expect(parsed.totalFolders).toBe(2);
		expect(parsed.totalFiles).toBe(1);
	});

	it("supports recursive listing with depth limits", async () => {
		const app = createMockApp([createFile("Projects/2026/Plan.md"), createFile("Projects/2026/Q1/Goals.md")]);
		const tool = createListDirectoryTool(app);

		const result = await tool.invoke({ path: "Projects", recursive: true, maxDepth: 2 });
		const parsed = JSON.parse(String(result)) as {
			tree: {
				folders: Record<
					string,
					{ folders: Record<string, { files: Array<{ name: string }> }>; files: Array<{ name: string }> }
				>;
			};
		};

		expect(Object.keys(parsed.tree.folders)).toEqual(["2026"]);
		expect(Object.keys(parsed.tree.folders["2026"]?.folders ?? {})).toEqual(["Q1"]);
		expect(parsed.tree.folders["2026"]?.files.map((file) => file.name)).toEqual(["Plan.md"]);
		expect(parsed.tree.folders["2026"]?.folders["Q1"]?.files.map((file) => file.name)).toEqual(["Goals.md"]);
	});

	it("treats maxDepth as enabling recursive listing automatically", async () => {
		const app = createMockApp([createFile("Projects/2026/Plan.md"), createFile("Projects/2026/Q1/Goals.md")]);
		const tool = createListDirectoryTool(app);

		const result = await tool.invoke({ path: "Projects", maxDepth: 2 });
		const parsed = JSON.parse(String(result)) as {
			recursive: boolean;
			maxDepth: number;
			tree: { folders: Record<string, { folders: Record<string, unknown> }> };
		};

		expect(parsed.recursive).toBe(true);
		expect(parsed.maxDepth).toBe(2);
		expect(Object.keys(parsed.tree.folders)).toEqual(["2026"]);
		expect(Object.keys(parsed.tree.folders["2026"]?.folders ?? {})).toEqual(["Q1"]);
	});

	it("filters private files for the current provider", async () => {
		mockShouldBlockFile.mockImplementation((path: string) => path === "Secret/plan.md");
		const app = createMockApp([createFile("Secret/plan.md"), createFile("Public/plan.md")]);
		const tool = createListDirectoryTool(app);

		const result = await tool.invoke({ recursive: true });
		const parsed = JSON.parse(String(result)) as {
			skippedPrivateFiles: number;
			tree: { folders: Record<string, { files: Array<{ name: string }> }> };
		};

		expect(parsed.skippedPrivateFiles).toBe(1);
		expect(Object.keys(parsed.tree.folders)).toEqual(["Public"]);
		expect(parsed.tree.folders.Public?.files.map((file) => file.name)).toEqual(["plan.md"]);
	});

	function mockDataWithAgentFolder(memoryEnabled: boolean) {
		mockGetData.mockReturnValue({
			agentFolder: "Agents",
			getSelectedAgent: () => ({
				chatModel: { provider: "openai" },
				memoryEnabled,
				toolsConfig: {
					list_directory: {
						name: "list_directory",
						description: "List directories and files in the vault.",
					},
				},
			}),
		});
	}

	const agentTreeFiles = () => [
		createFile("Agents/Memories/user-preferences.md"),
		createFile("Agents/Skills/web/SKILL.md"),
		createFile("Notes/todo.md"),
	];

	it("exposes the memory folder (and only it) from the agent tree when memory is enabled", async () => {
		mockDataWithAgentFolder(true);
		const tool = createListDirectoryTool(createMockApp(agentTreeFiles()));

		const result = await tool.invoke({ recursive: true, maxDepth: 4 });
		const parsed = JSON.parse(String(result)) as {
			tree: { folders: Record<string, { folders?: Record<string, { files?: Array<{ name: string }> }> }> };
		};

		// Memory notes are excluded from the search index, so this listing is the
		// agent's only way to discover them — the exemption is load-bearing.
		expect(parsed.tree.folders.Agents?.folders?.Memories?.files?.map((f) => f.name)).toEqual([
			"user-preferences.md",
		]);
		// The rest of the agent machinery stays hidden.
		expect(parsed.tree.folders.Agents?.folders?.Skills).toBeUndefined();
	});

	it("hides the whole agent tree, memory folder included, when memory is disabled", async () => {
		mockDataWithAgentFolder(false);
		const tool = createListDirectoryTool(createMockApp(agentTreeFiles()));

		const result = await tool.invoke({ recursive: true, maxDepth: 4 });
		const parsed = JSON.parse(String(result)) as { tree: { folders: Record<string, unknown> } };

		expect(Object.keys(parsed.tree.folders)).toEqual(["Notes"]);
	});
});
