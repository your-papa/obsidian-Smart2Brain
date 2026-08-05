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
	const cap: StaleGuidanceLike = {
		agentId: "a1",
		agentName: "Default",
		kind: "capability",
		targetId: "vault",
		label: "Vault guidance",
	};
	const tool: StaleGuidanceLike = {
		agentId: "a2",
		agentName: "Researcher",
		kind: "tool",
		targetId: "web_search",
		label: "web_search guidance",
	};

	it("builds `update:<agentId>:<kind>` for system-prompt (no targetId)", () => {
		expect(updateNoticeId("a1", "system-prompt")).toBe("update:a1:system-prompt");
	});

	it("builds `update:<agentId>:<kind>:<targetId>` when a targetId is present", () => {
		expect(updateNoticeId("a1", "capability", "vault")).toBe("update:a1:capability:vault");
	});

	it("maps records to notices with matching ids", () => {
		const notices = filterUpdateNotices([sys, cap, tool], []);
		expect(notices.map((n) => n.id)).toEqual([
			"update:a1:system-prompt",
			"update:a1:capability:vault",
			"update:a2:tool:web_search",
		]);
	});

	it("drops a notice whose id is dismissed", () => {
		const visible = filterUpdateNotices([sys, cap], [updateNoticeId("a1", "capability", "vault")]);
		expect(visible.map((n) => n.id)).toEqual(["update:a1:system-prompt"]);
	});

	it("returns nothing when the whole block is dismissed", () => {
		expect(filterUpdateNotices([sys, cap, tool], [DISMISS_ALL_ID])).toEqual([]);
	});

	it("carries agentName/label/targetId through to the notice", () => {
		const [notice] = filterUpdateNotices([cap], []);
		expect(notice).toMatchObject({ agentName: "Default", label: "Vault guidance", targetId: "vault" });
	});
});
