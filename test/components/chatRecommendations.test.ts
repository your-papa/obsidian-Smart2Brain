import { describe, expect, it } from "vitest";
import {
	DISMISS_ALL_ID,
	filterPluginNudges,
	filterSuggestions,
	filterUpdateNotices,
	type PluginNudge,
	pluginNudgeId,
	type RecommendationContext,
	type StaleGuidanceLike,
	type SuggestedQuery,
	SUGGESTED_QUERIES,
	updateNoticeId,
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

describe("filterSuggestions — feature gating", () => {
	it("keeps ungated suggestions regardless of context", () => {
		expect(ids(filterSuggestions(NONE, [], CATALOG))).toContain("always");
	});

	it("hides gated suggestions when the feature is unavailable", () => {
		const visible = ids(filterSuggestions(NONE, [], CATALOG));
		expect(visible).toEqual(["always"]);
	});

	it("shows gated suggestions when the feature is available", () => {
		expect(ids(filterSuggestions(ALL, [], CATALOG))).toEqual(["always", "chat", "search", "graph"]);
	});

	it("gates each feature independently", () => {
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

describe("plugin nudges", () => {
	const nudge = (pluginId: string): PluginNudge => ({
		id: pluginNudgeId(pluginId),
		pluginId,
		displayName: pluginId,
		icon: "puzzle",
	});

	it("builds a `plugin:<id>` dismissal key", () => {
		expect(pluginNudgeId("dataview")).toBe("plugin:dataview");
	});

	it("keeps candidates that are not dismissed", () => {
		const nudges = [nudge("dataview"), nudge("tasknotes")];
		expect(filterPluginNudges(nudges, []).map((n) => n.pluginId)).toEqual(["dataview", "tasknotes"]);
	});

	it("drops a nudge whose id is dismissed", () => {
		const nudges = [nudge("dataview"), nudge("tasknotes")];
		const visible = filterPluginNudges(nudges, [pluginNudgeId("dataview")]);
		expect(visible.map((n) => n.pluginId)).toEqual(["tasknotes"]);
	});

	it("returns nothing when the whole block is dismissed", () => {
		expect(filterPluginNudges([nudge("dataview")], [DISMISS_ALL_ID])).toEqual([]);
	});
});

describe("update notices", () => {
	const sys: StaleGuidanceLike = {
		agentId: "a1",
		agentName: "Default",
		kind: "system-prompt",
		label: "system prompt",
	};
	const sys2: StaleGuidanceLike = {
		agentId: "a2",
		agentName: "Researcher",
		kind: "system-prompt",
		label: "system prompt",
	};

	it("builds `update:<agentId>:<kind>` for system-prompt", () => {
		expect(updateNoticeId("a1", "system-prompt")).toBe("update:a1:system-prompt");
	});

	it("uses the `global` segment when there is no agentId", () => {
		expect(updateNoticeId(undefined, "system-prompt")).toBe("update:global:system-prompt");
	});

	it("maps records to notices with matching ids", () => {
		const notices = filterUpdateNotices([sys, sys2], []);
		expect(notices.map((n) => n.id)).toEqual(["update:a1:system-prompt", "update:a2:system-prompt"]);
	});

	it("drops a notice whose id is dismissed", () => {
		const visible = filterUpdateNotices([sys, sys2], [updateNoticeId("a2", "system-prompt")]);
		expect(visible.map((n) => n.id)).toEqual(["update:a1:system-prompt"]);
	});

	it("returns nothing when the whole block is dismissed", () => {
		expect(filterUpdateNotices([sys, sys2], [DISMISS_ALL_ID])).toEqual([]);
	});

	it("carries agentName/label through to the notice", () => {
		const [notice] = filterUpdateNotices([sys], []);
		expect(notice).toMatchObject({ agentId: "a1", agentName: "Default", label: "system prompt" });
	});
});
