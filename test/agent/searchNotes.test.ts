import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWarn = vi.fn();
const mockLexicalSearch = vi.fn();
const mockBrowse = vi.fn();
const mockGetVectorStoreService = vi.fn();
const mockGetLexicalSearchService = vi.fn();
const mockWaitForLexicalSearch = vi.fn();
const mockWaitForVectorStore = vi.fn();
const mockShouldBlockFile = vi.fn();
const mockRecentNotes: Array<{ path: string; lastOpenedAt: number }> = [];
const mockToolSettings: {
	showPath?: boolean;
	showTags?: boolean;
	showMatchBadges?: boolean;
	showMatchContext?: boolean;
} = {};

vi.mock("../../src/vectorstore", () => ({
	getVectorStoreService: () => mockGetVectorStoreService(),
	waitForVectorStore: () => mockWaitForVectorStore(),
}));

vi.mock("../../src/search/LexicalSearchService", () => ({
	getLexicalSearchService: () => mockGetLexicalSearchService(),
	waitForLexicalSearch: () => mockWaitForLexicalSearch(),
}));

vi.mock("../../src/utils/logging", () => ({
	Logger: {
		warn: (...args: unknown[]) => mockWarn(...args),
		debug: vi.fn(),
		log: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => ({
		defaultEmbedModel: null,
		getEmbedModels: vi.fn().mockReturnValue({}),
		searchAlgorithm: "lexical",
		searchShowPath: true,
		searchShowTags: true,
		searchShowMatchBadges: true,
		searchShowMatchContext: true,
		recentNotes: mockRecentNotes,
		getSelectedAgent: () => ({
			chatModel: { provider: "openai" },
			toolsConfig: {
				search_notes: {
					name: "search_notes",
					description: "Search notes",
					settings: mockToolSettings,
				},
			},
		}),
	}),
}));

vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
	getPendingChangesStore: () => ({
		shouldBlockFile: mockShouldBlockFile,
	}),
}));

import type { App } from "obsidian";
import { createSearchNotesTool, performSearch } from "../../src/agent/tools/searchNotes";

interface SearchToolResultPayload {
	query: string;
	recentOnly: boolean;
	algorithm: string;
	maxResults: number;
	filter?: { pathPrefixes?: string[]; tags?: string[] };
	totalResults: number;
	returnedResults: number;
	results: Array<{
		rank: number;
		name: string;
		path?: string;
		score?: number;
		privacyRestricted: boolean;
		frontmatter?: Record<string, unknown>;
		tags?: string[];
		matchExplanation?: { source: string; text: string; heading?: string };
		matchBadges?: string[];
	}>;
	message?: string;
}

function createLexicalService() {
	return {
		search: mockLexicalSearch,
		browse: mockBrowse,
	};
}

describe("performSearch lexical startup behavior", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockToolSettings.showPath = undefined;
		mockToolSettings.showTags = undefined;
		mockToolSettings.showMatchBadges = undefined;
		mockToolSettings.showMatchContext = undefined;
		mockRecentNotes.length = 0;
		mockWaitForVectorStore.mockResolvedValue(false);
		mockWaitForLexicalSearch.mockResolvedValue(true);
		mockShouldBlockFile.mockReturnValue(false);
		mockLexicalSearch.mockResolvedValue([
			{
				path: "Notes/alpha.md",
				name: "alpha",
				tags: ["#alpha"],
				score: 12,
			},
		]);
		mockBrowse.mockResolvedValue([
			{
				path: "Notes/beta.md",
				name: "beta",
				tags: ["#beta"],
				score: 8,
			},
		]);
		mockGetLexicalSearchService.mockReturnValue(createLexicalService());
	});

	it("uses the standalone lexical index before full vector-store readiness", async () => {
		const results = await performSearch({} as App, "alpha", "lexical");

		expect(mockWaitForLexicalSearch).toHaveBeenCalledTimes(1);
		expect(mockGetLexicalSearchService).toHaveBeenCalledTimes(1);
		expect(mockLexicalSearch).toHaveBeenCalledWith("alpha", 100, undefined);
		expect(mockWaitForVectorStore).not.toHaveBeenCalled();
		expect(results).toEqual([
			{
				path: "Notes/alpha.md",
				name: "alpha",
				frontmatter: undefined,
				tags: ["#alpha"],
				matchExplanation: undefined,
				matchBadges: undefined,
				score: 12,
			},
		]);
	});

	it("keeps typed search ranking intact while adding a recent badge", async () => {
		mockRecentNotes.push(
			{ path: "Notes/recent.md", lastOpenedAt: 2_000 },
			{ path: "Notes/older.md", lastOpenedAt: 1_000 },
		);
		mockLexicalSearch.mockResolvedValue([
			{
				path: "Notes/older.md",
				name: "older",
				tags: ["#old"],
				matchBadges: ["title"],
				score: 10,
			},
			{
				path: "Notes/recent.md",
				name: "recent",
				tags: ["#fresh"],
				matchBadges: ["tag"],
				score: 9,
			},
		]);

		const tool = createSearchNotesTool({} as App);
		const result = await tool.invoke({ query: "note" });
		const parsed: SearchToolResultPayload = JSON.parse(String(result));

		expect(parsed.results[0]?.name).toBe("older");
		expect(parsed.results[0]?.matchBadges).toEqual(["title", "recent"]);
		expect(parsed.results[1]?.name).toBe("recent");
		expect(parsed.results[1]?.matchBadges).toEqual(["tag", "recent"]);
	});

	it("returns recently opened notes when recentOnly is true", async () => {
		mockRecentNotes.push(
			{ path: "Notes/recent-one.md", lastOpenedAt: 3_000 },
			{ path: "Notes/recent-two.md", lastOpenedAt: 2_000 },
		);
		const app = {
			vault: {
				getAbstractFileByPath(path: string) {
					const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
					return { path, extension: "md", basename };
				},
			},
			metadataCache: {
				getFileCache(file: { path: string }) {
					if (file.path === "Notes/recent-one.md") {
						return { frontmatter: { aliases: ["One"] }, tags: [{ tag: "#one" }] };
					}
					return { frontmatter: undefined, tags: [{ tag: "#two" }] };
				},
			},
		} as unknown as App;

		const tool = createSearchNotesTool(app);
		const result = await tool.invoke({ recentOnly: true });
		const parsed: SearchToolResultPayload = JSON.parse(String(result));

		expect(parsed.recentOnly).toBe(true);
		expect(parsed.query).toBe("");
		expect(parsed.totalResults).toBe(2);
		expect(parsed.results).toEqual([
			{
				rank: 1,
				name: "recent-one",
				path: "Notes/recent-one.md",
				score: 2.5,
				privacyRestricted: false,
				frontmatter: { aliases: ["One"] },
				tags: ["#one"],
				matchBadges: ["recent"],
			},
			{
				rank: 2,
				name: "recent-two",
				path: "Notes/recent-two.md",
				score: 1.25,
				privacyRestricted: false,
				tags: ["#two"],
				matchBadges: ["recent"],
			},
		]);
	});

	it("includes frontmatter tags on recent results", async () => {
		mockRecentNotes.push({ path: "Notes/frontmatter-tags.md", lastOpenedAt: 3_000 });
		const app = {
			vault: {
				getAbstractFileByPath(path: string) {
					const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
					return { path, extension: "md", basename };
				},
			},
			metadataCache: {
				getFileCache() {
					return {
						frontmatter: { tags: ["project", "active"] },
						tags: [{ tag: "#inline" }],
					};
				},
			},
		} as unknown as App;

		const tool = createSearchNotesTool(app);
		const result = await tool.invoke({ recentOnly: true });
		const parsed: SearchToolResultPayload = JSON.parse(String(result));

		expect(new Set(parsed.results[0]?.tags ?? [])).toEqual(new Set(["#project", "#active", "#inline"]));
	});

	it("includes recently created notes even if they were never opened", async () => {
		const app = {
			vault: {
				getAbstractFileByPath(path: string) {
					const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
					return {
						path,
						extension: "md",
						basename,
						stat: {
							ctime: path.includes("brand-new") ? 5_000 : 1_000,
							mtime: 5_000,
							size: 0,
						},
					};
				},
				getMarkdownFiles() {
					return [
						this.getAbstractFileByPath("Notes/older.md"),
						this.getAbstractFileByPath("Notes/brand-new.md"),
					];
				},
			},
			metadataCache: {
				getFileCache(file: { path: string }) {
					if (file.path === "Notes/brand-new.md") {
						return { frontmatter: { aliases: ["Fresh"] }, tags: [{ tag: "#new" }] };
					}
					return { frontmatter: undefined, tags: [{ tag: "#old" }] };
				},
			},
		} as unknown as App;

		const tool = createSearchNotesTool(app);
		const result = await tool.invoke({ recentOnly: true });
		const parsed: SearchToolResultPayload = JSON.parse(String(result));

		expect(parsed.results[0]?.name).toBe("brand-new");
		expect(parsed.results[0]?.tags).toEqual(["#new"]);
		expect(parsed.results[0]?.matchBadges).toEqual(["recent"]);
	});

	it("uses the standalone lexical index for filter-only browse queries", async () => {
		const results = await performSearch({} as App, "", "lexical", { tags: ["#beta"] });

		expect(mockWaitForLexicalSearch).toHaveBeenCalledTimes(1);
		expect(mockBrowse).toHaveBeenCalledWith(100, { tags: ["#beta"] });
		expect(results).toEqual([
			{
				path: "Notes/beta.md",
				name: "beta",
				frontmatter: undefined,
				tags: ["#beta"],
				matchExplanation: undefined,
				matchBadges: undefined,
				score: 8,
			},
		]);
	});

	it("returns no lexical results when the search service has not started", async () => {
		mockWaitForLexicalSearch.mockResolvedValue(false);

		const results = await performSearch({} as App, "alpha", "lexical");

		expect(results).toEqual([]);
		expect(mockWarn).toHaveBeenCalledWith(
			"Lexical search is unavailable because the lexical search service is not ready",
		);
		expect(mockLexicalSearch).not.toHaveBeenCalled();
	});

	it("prefers numeric-leading title matches in hybrid ranking", async () => {
		mockWaitForVectorStore.mockResolvedValue(true);
		mockGetVectorStoreService.mockReturnValue({
			semanticSearch: vi.fn().mockResolvedValue([
				{ path: "Notes/semester-steering.md", name: "Semester Steering", score: 0.9 },
				{ path: "Notes/9-semester.md", name: "9. Semester", score: 0.85 },
			]),
		});
		mockLexicalSearch.mockResolvedValue([
			{ path: "Notes/semester-steering.md", name: "Semester Steering", score: 14 },
			{ path: "Notes/9-semester.md", name: "9. Semester", score: 13 },
		]);

		const results = await performSearch({} as App, "9 seme", "hybrid");

		expect(results[0]?.name).toBe("9. Semester");
		expect(results[1]?.name).toBe("Semester Steering");
	});

	it("prefers exact alias matches in hybrid ranking", async () => {
		mockWaitForVectorStore.mockResolvedValue(true);
		mockGetVectorStoreService.mockReturnValue({
			semanticSearch: vi.fn().mockResolvedValue([
				{ path: "Notes/launch.md", name: "Launch Overview", score: 0.92 },
				{
					path: "Notes/alias-fixture.md",
					name: "Alias Fixture",
					frontmatter: { aliases: ["Rocket Science"] },
					score: 0.84,
				},
			]),
		});
		mockLexicalSearch.mockResolvedValue([
			{ path: "Notes/launch.md", name: "Launch Overview", score: 18, matchBadges: ["content"] },
			{
				path: "Notes/alias-fixture.md",
				name: "Alias Fixture",
				frontmatter: { aliases: ["Rocket Science"] },
				matchBadges: ["alias"],
				matchExplanation: { source: "alias", text: "Alias: Rocket Science" },
				score: 14,
			},
		]);

		const results = await performSearch({} as App, "Rocket Science", "hybrid");

		expect(results[0]?.name).toBe("Alias Fixture");
		expect(results[0]?.matchBadges).toContain("alias");
	});

	it("returns structured JSON with tags, match badges, and match snippets", async () => {
		mockLexicalSearch.mockResolvedValue([
			{
				path: "Notes/orbital-index.md",
				name: "orbital-index",
				frontmatter: { aliases: ["Rocket Science"] },
				tags: ["#space", "orbital-index"],
				matchBadges: ["tag", "content"],
				matchExplanation: {
					source: "content",
					heading: "Launch Checklist",
					text: "Propulsion systems need thermal checks before ignition.",
				},
				score: 12.345,
			},
		]);

		const tool = createSearchNotesTool({} as App);
		const result = await tool.invoke({ query: "propulsion" });
		const parsed: SearchToolResultPayload = JSON.parse(String(result));

		expect(parsed.query).toBe("propulsion");
		expect(parsed.recentOnly).toBe(false);
		expect(parsed.algorithm).toBe("lexical");
		expect(parsed.totalResults).toBe(1);
		expect(parsed.returnedResults).toBe(1);
		expect(parsed.results).toEqual([
			{
				rank: 1,
				name: "orbital-index",
				path: "Notes/orbital-index.md",
				score: 12.345,
				privacyRestricted: false,
				frontmatter: { aliases: ["Rocket Science"] },
				tags: ["#space", "#orbital-index"],
				matchBadges: ["tag", "content"],
				matchExplanation: {
					source: "content",
					heading: "Launch Checklist",
					text: "Propulsion systems need thermal checks before ignition.",
				},
			},
		]);
	});

	it("keeps privacy-restricted results visible while redacting content snippets", async () => {
		mockLexicalSearch.mockResolvedValue([
			{
				path: "Private/launch-plan.md",
				name: "launch-plan",
				frontmatter: { owner: "red-team" },
				tags: ["#secret"],
				matchBadges: ["title", "content", "semantic"],
				matchExplanation: {
					source: "content",
					text: "Highly sensitive launch timing details.",
				},
				score: 30,
			},
			{
				path: "Notes/public-plan.md",
				name: "public-plan",
				tags: ["#public"],
				score: 20,
			},
		]);
		mockShouldBlockFile.mockImplementation((path: string) => path.startsWith("Private/"));

		const tool = createSearchNotesTool({} as App);
		const result = await tool.invoke({ query: "plan" });
		const parsed: SearchToolResultPayload = JSON.parse(String(result));

		expect(parsed.totalResults).toBe(2);
		expect(parsed.returnedResults).toBe(2);
		expect(parsed.results).toEqual([
			{
				rank: 1,
				name: "launch-plan",
				path: "Private/launch-plan.md",
				score: 30,
				privacyRestricted: true,
				frontmatter: { owner: "red-team" },
				tags: ["#secret"],
				matchBadges: ["title"],
				matchExplanation: undefined,
			},
			{
				rank: 2,
				name: "public-plan",
				path: "Notes/public-plan.md",
				score: 20,
				privacyRestricted: false,
				frontmatter: undefined,
				tags: ["#public"],
				matchBadges: undefined,
				matchExplanation: undefined,
			},
		]);
	});

	it("honors per-tool visibility settings for optional search fields", async () => {
		mockToolSettings.showPath = false;
		mockToolSettings.showTags = false;
		mockToolSettings.showMatchBadges = false;
		mockToolSettings.showMatchContext = false;

		mockLexicalSearch.mockResolvedValue([
			{
				path: "Notes/orbital-index.md",
				name: "orbital-index",
				frontmatter: { aliases: ["Rocket Science"] },
				tags: ["#space"],
				matchBadges: ["tag", "content"],
				matchExplanation: {
					source: "content",
					heading: "Launch Checklist",
					text: "Propulsion systems need thermal checks before ignition.",
				},
				score: 12.345,
			},
		]);

		const tool = createSearchNotesTool({} as App);
		const result = await tool.invoke({ query: "propulsion" });
		const parsed: SearchToolResultPayload = JSON.parse(String(result));

		expect(parsed.results[0]).toEqual({
			rank: 1,
			name: "orbital-index",
			score: 12.345,
			privacyRestricted: false,
			frontmatter: { aliases: ["Rocket Science"] },
		});
	});
});
