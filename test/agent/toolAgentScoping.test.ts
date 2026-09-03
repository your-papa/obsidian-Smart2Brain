import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => {
	const actual = await import("../__mocks__/obsidian");
	return { ...actual, getAllTags: (cache: { tags?: string[] }) => cache.tags ?? null };
});

const mockShouldBlockFile = vi.fn().mockReturnValue(false);
vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
	getPendingChangesStore: () => ({
		shouldBlockFile: (...args: unknown[]) => mockShouldBlockFile(...args),
	}),
}));

/**
 * Two agents on different providers. `trusted-agent` is the *globally selected*
 * one; `untrusted-agent` is the one actually running (as a subagent, or as the
 * agent a background chat tab captured at open time).
 */
const AGENTS: Record<string, { id: string; chatModel: { provider: string } | null; toolsConfig: object }> = {
	"trusted-agent": { id: "trusted-agent", chatModel: { provider: "trusted-local" }, toolsConfig: {} },
	"untrusted-agent": { id: "untrusted-agent", chatModel: { provider: "untrusted-cloud" }, toolsConfig: {} },
};

vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => ({
		getAgent: (id: string) => AGENTS[id],
		getSelectedAgent: () => AGENTS["trusted-agent"],
	}),
}));

vi.mock("../../src/utils/fileFiltering", () => ({
	isAgentFilePath: () => false,
}));

import type { App } from "obsidian";
import { createGetAllTagsTool } from "../../src/agent/tools/getAllTags";
import { createGetPropertiesTool } from "../../src/agent/tools/getProperties";
import { resolveToolAgent, resolveToolProvider } from "../../src/agent/tools/toolAgentContext";

function makeApp(): App {
	const files = [
		{ path: "public/notes.md", basename: "notes" },
		{ path: "private/diary.md", basename: "diary" },
	];
	return {
		vault: { getMarkdownFiles: () => files },
		metadataCache: {
			getFileCache: (file: { path: string }) =>
				file.path === "private/diary.md"
					? { tags: ["#therapy"], frontmatter: { therapist: "x", position: {} } }
					: { tags: ["#recipes"], frontmatter: { author: "y", position: {} } },
		},
	} as unknown as App;
}

beforeEach(() => {
	mockShouldBlockFile.mockReset().mockReturnValue(false);
});

describe("resolveToolAgent / resolveToolProvider", () => {
	it("resolves the run's own agent, not the global selection", () => {
		expect(resolveToolAgent("untrusted-agent").id).toBe("untrusted-agent");
		expect(resolveToolProvider("untrusted-agent")).toBe("untrusted-cloud");
	});

	it("falls back to the selected agent when no id is threaded through (public api path)", () => {
		expect(resolveToolAgent("").id).toBe("trusted-agent");
		expect(resolveToolProvider("")).toBe("trusted-local");
	});

	it("falls back to the selected agent for a stale/deleted agent id", () => {
		expect(resolveToolAgent("deleted-agent").id).toBe("trusted-agent");
	});
});

describe("get_all_tags — privacy", () => {
	it("filters tags from private notes instead of returning the whole vocabulary", async () => {
		// Every note is private for this provider (private-by-default + untrusted).
		mockShouldBlockFile.mockImplementation((_path: string, provider: string) => provider === "untrusted-cloud");

		const tool = createGetAllTagsTool(makeApp(), "untrusted-agent");
		const result = (await tool.invoke({})) as string;

		expect(result).not.toContain("#therapy");
		expect(result).not.toContain("#recipes");
		expect(result).toContain("2 note(s) were skipped");
	});

	it("evaluates trust against the RUNNING agent, not the globally selected one", async () => {
		mockShouldBlockFile.mockImplementation((_path: string, provider: string) => provider === "untrusted-cloud");

		const result = (await createGetAllTagsTool(makeApp(), "untrusted-agent").invoke({})) as string;

		// Regression: before the fix this read getSelectedAgent() -> "trusted-local",
		// so nothing was blocked and every tag reached the untrusted provider.
		expect(mockShouldBlockFile).toHaveBeenCalledWith(expect.any(String), "untrusted-cloud");
		expect(mockShouldBlockFile).not.toHaveBeenCalledWith(expect.any(String), "trusted-local");
		expect(result).not.toContain("#therapy");
	});

	it("returns tags normally when the provider is trusted", async () => {
		const result = (await createGetAllTagsTool(makeApp(), "trusted-agent").invoke({})) as string;
		expect(result).toContain("#therapy");
		expect(result).toContain("#recipes");
		expect(result).not.toContain("skipped");
	});
});

describe("get_properties — privacy", () => {
	it("filters property keys from private notes", async () => {
		mockShouldBlockFile.mockImplementation((_path: string, provider: string) => provider === "untrusted-cloud");

		const result = (await createGetPropertiesTool(makeApp(), "untrusted-agent").invoke({})) as string;

		expect(result).not.toContain("therapist");
		expect(result).toContain("2 note(s) were skipped");
	});

	it("uses the running agent's provider for the single-note check", async () => {
		mockShouldBlockFile.mockImplementation((_path: string, provider: string) => provider === "untrusted-cloud");

		const result = (await createGetPropertiesTool(makeApp(), "untrusted-agent").invoke({
			note_name: "diary",
		})) as string;

		expect(result).toContain("private for the current provider");
		expect(mockShouldBlockFile).toHaveBeenCalledWith("private/diary.md", "untrusted-cloud");
	});

	it("returns property keys normally when the provider is trusted", async () => {
		const result = (await createGetPropertiesTool(makeApp(), "trusted-agent").invoke({})) as string;
		expect(result).toContain("therapist");
		expect(result).toContain("author");
	});
});
