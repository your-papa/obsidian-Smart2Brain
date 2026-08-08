import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// fileFiltering imports getData() at module load; isIndexableFile/isAgentFilePath resolve the
// agent folder through it. isAgentPath itself is pure (folder passed explicitly).
const mockGetData = vi.fn().mockReturnValue({ agentFolder: "Agents" });
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => mockGetData(),
}));

import { isAgentFilePath, isAgentPath, isIndexableFile } from "../../src/utils/fileFiltering";

describe("isAgentPath (pure)", () => {
	it("matches the folder itself and files inside it", () => {
		expect(isAgentPath("Agents", "Agents")).toBe(true);
		expect(isAgentPath("Agents/Skills/dataview/SKILL.md", "Agents")).toBe(true);
		expect(isAgentPath("Agents/Memories/notes.md", "Agents")).toBe(true);
		expect(isAgentPath("Agents/Base Prompts/default-agent.md", "Agents")).toBe(true);
	});

	it("does not match sibling folders or lookalike prefixes", () => {
		expect(isAgentPath("Notes/x.md", "Agents")).toBe(false);
		expect(isAgentPath("AgentsExtra/x.md", "Agents")).toBe(false);
		expect(isAgentPath("MyAgents/x.md", "Agents")).toBe(false);
	});

	it("respects a custom / nested agent folder and tolerates leading slashes", () => {
		expect(isAgentPath("Meta/Agents/Skills/x/SKILL.md", "Meta/Agents")).toBe(true);
		expect(isAgentPath("/Agents/Skills/x/SKILL.md", "Agents")).toBe(true);
		expect(isAgentPath("Agents/x.md", "Meta/Agents")).toBe(false);
	});

	it("never matches when the folder is empty", () => {
		expect(isAgentPath("anything.md", "")).toBe(false);
	});
});

describe("isAgentFilePath / isIndexableFile (folder from plugin data)", () => {
	it("isAgentFilePath reads the configured agent folder", () => {
		mockGetData.mockReturnValue({ agentFolder: "Agents" });
		expect(isAgentFilePath("Agents/Skills/foo/SKILL.md")).toBe(true);
		expect(isAgentFilePath("Agents/Memories/x.md")).toBe(true);
		expect(isAgentFilePath("Projects/foo.md")).toBe(false);
	});

	it("isIndexableFile excludes agent-folder files and includes normal notes", () => {
		mockGetData.mockReturnValue({ agentFolder: "Agents" });
		expect(isIndexableFile({ path: "Agents/Skills/foo/SKILL.md" } as never)).toBe(false);
		expect(isIndexableFile({ path: "Agents/Base Prompts/default-agent.md" } as never)).toBe(false);
		expect(isIndexableFile({ path: "Projects/note.md" } as never)).toBe(true);
	});

	it("tracks a custom folder", () => {
		mockGetData.mockReturnValue({ agentFolder: "Meta/Agents" });
		expect(isAgentFilePath("Meta/Agents/Skills/foo/SKILL.md")).toBe(true);
		expect(isAgentFilePath("Agents/Skills/foo/SKILL.md")).toBe(false);
	});

	it("fails open when the data store is uninitialized", () => {
		mockGetData.mockImplementation(() => {
			throw new Error("Plugin does not exist");
		});
		expect(isAgentFilePath("Agents/Skills/foo/SKILL.md")).toBe(false);
		mockGetData.mockReturnValue({ agentFolder: "Agents" });
	});
});
