import { describe, expect, it } from "vitest";
import {
	DISMISS_ALL_ID,
	filterSuggestions,
	type RecommendationContext,
	type SuggestedQuery,
	SUGGESTED_QUERIES,
} from "../../src/components/chat/chatRecommendations";

const ALL: RecommendationContext = { hasChat: true, hasSearch: true, hasGraph: true };
const NONE: RecommendationContext = { hasChat: false, hasSearch: false, hasGraph: false };

const CATALOG: SuggestedQuery[] = [
	{ id: "always", icon: "sparkles", label: "Always" },
	{ id: "chat", icon: "lightbulb", label: "Chat", requires: "chat" },
	{ id: "search", icon: "search", label: "Search", requires: "search" },
	{ id: "graph", icon: "network", label: "Graph", requires: "graph" },
];

const ids = (list: SuggestedQuery[]) => list.map((s) => s.id);

describe("filterSuggestions — capability gating", () => {
	it("keeps ungated suggestions regardless of context", () => {
		expect(ids(filterSuggestions(NONE, [], CATALOG))).toContain("always");
	});

	it("hides gated suggestions when the capability is unavailable", () => {
		const visible = ids(filterSuggestions(NONE, [], CATALOG));
		expect(visible).toEqual(["always"]);
	});

	it("shows gated suggestions when the capability is available", () => {
		expect(ids(filterSuggestions(ALL, [], CATALOG))).toEqual(["always", "chat", "search", "graph"]);
	});

	it("gates each capability independently", () => {
		const searchOnly: RecommendationContext = { hasChat: false, hasSearch: true, hasGraph: false };
		expect(ids(filterSuggestions(searchOnly, [], CATALOG))).toEqual(["always", "search"]);
	});
});

describe("filterSuggestions — dismissal", () => {
	it("excludes a dismissed suggestion by id", () => {
		expect(ids(filterSuggestions(ALL, ["search"], CATALOG))).not.toContain("search");
	});

	it("returns nothing when the whole block is dismissed", () => {
		expect(filterSuggestions(ALL, [DISMISS_ALL_ID], CATALOG)).toEqual([]);
	});

	it("combines gating and per-item dismissal", () => {
		const searchOnly: RecommendationContext = { hasChat: false, hasSearch: true, hasGraph: false };
		expect(ids(filterSuggestions(searchOnly, ["always"], CATALOG))).toEqual(["search"]);
	});
});

describe("SUGGESTED_QUERIES catalog", () => {
	it("has unique ids", () => {
		const seen = new Set(SUGGESTED_QUERIES.map((s) => s.id));
		expect(seen.size).toBe(SUGGESTED_QUERIES.length);
	});

	it("does not reuse the whole-block dismissal id for any suggestion", () => {
		expect(SUGGESTED_QUERIES.some((s) => s.id === DISMISS_ALL_ID)).toBe(false);
	});
});
