import { describe, expect, it } from "vitest";
import {
	DISMISS_ALL_ID,
	filterPluginNudges,
	filterSuggestions,
	filterUpdateNotices,
	PLUGIN_NUDGE_COLLAPSE_THRESHOLD_DESKTOP,
	PLUGIN_NUDGE_COLLAPSE_THRESHOLD_MOBILE,
	type PluginNudge,
	pluginNudgeId,
	shouldCollapsePluginNudges,
	type RecommendationContext,
	type StaleGuidanceLike,
	type SuggestedQuery,
	SUGGESTED_QUERIES,
	updateNoticeId,
} from "../../src/components/chat/chatRecommendations";

const ALL: RecommendationContext = { hasChat: true, hasSearch: true };
const NONE: RecommendationContext = { hasChat: false, hasSearch: false };

const CATALOG: SuggestedQuery[] = [
	{ id: "always", icon: "sparkles", label: "Always" },
	{ id: "chat", icon: "lightbulb", label: "Chat", requires: "chat" },
	{ id: "search", icon: "search", label: "Search", requires: "search" },
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
		expect(ids(filterSuggestions(ALL, [], CATALOG))).toEqual(["always", "chat", "search"]);
	});

	it("gates each feature independently", () => {
		const searchOnly: RecommendationContext = { hasChat: false, hasSearch: true };
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
		const searchOnly: RecommendationContext = { hasChat: false, hasSearch: true };
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

	/*
	 * The catalog is deliberately short — an earlier version shipped six entries, three of
	 * which were the same broad-retrieval-and-synthesize request in different words. This
	 * is a soft ceiling, not a magic number: adding a genuinely distinct suggestion is fine,
	 * but crossing it should be a conscious decision rather than incremental drift.
	 */
	it("stays small enough to read as a menu rather than padding", () => {
		expect(SUGGESTED_QUERIES.length).toBeLessThanOrEqual(4);
	});

	/*
	 * Regression guard for the real bug behind the trim: "What are the main themes in my
	 * vault?" and "Connect ideas across my notes" carried NO `requires` gate, so they
	 * rendered on an empty vault with no populated index and could only disappoint.
	 * Anything that reads the vault must declare `requires: "search"`.
	 */
	it("gates every retrieval-backed suggestion on search", () => {
		const READS_THE_VAULT = /\b(notes?|vault|themes?|ideas)\b/i;
		const ungatedVaultQueries = SUGGESTED_QUERIES.filter(
			(s) => s.requires !== "search" && READS_THE_VAULT.test(s.query ?? s.label),
		);
		expect(ungatedVaultQueries.map((s) => s.id)).toEqual([]);
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

	/*
	 * Ranking survives the removal of the display cap: curated integrations lead the list
	 * and therefore supply the collapsed summary row's leading icons.
	 */
	describe("ranking", () => {
		const skillBacked = (pluginId: string): PluginNudge => ({ ...nudge(pluginId), skillId: pluginId });

		it("returns every eligible candidate — nothing is capped", () => {
			const nudges = [nudge("a"), nudge("b"), nudge("c"), nudge("d"), nudge("e")];
			expect(filterPluginNudges(nudges, [])).toHaveLength(5);
		});

		/*
		 * A skillId means we ship a SKILL.md documenting that plugin's api, so enabling it
		 * yields a genuinely more capable agent. An auto-discovered plugin with no bundled
		 * skill is the weakest thing on this surface and sorts last.
		 */
		it("ranks skill-backed candidates ahead of auto-discovered ones", () => {
			const nudges = [nudge("auto-1"), skillBacked("dataview"), nudge("auto-2"), skillBacked("tasks")];
			expect(filterPluginNudges(nudges, []).map((n) => n.pluginId)).toEqual([
				"dataview",
				"tasks",
				"auto-1",
				"auto-2",
			]);
		});

		it("keeps auto-discovered candidates in order when there are no skill-backed ones", () => {
			const nudges = [nudge("auto-1"), nudge("auto-2")];
			expect(filterPluginNudges(nudges, []).map((n) => n.pluginId)).toEqual(["auto-1", "auto-2"]);
		});

		it("preserves relative order within a group so rows do not shuffle", () => {
			const nudges = [skillBacked("dataview"), skillBacked("tasks"), skillBacked("tasknotes")];
			expect(filterPluginNudges(nudges, []).map((n) => n.pluginId)).toEqual([
				"dataview",
				"tasks",
				"tasknotes",
			]);
		});

		it("does not mutate the caller's candidate array while sorting", () => {
			const nudges = [nudge("auto"), skillBacked("dataview")];
			const order = nudges.map((n) => n.pluginId);
			filterPluginNudges(nudges, []);
			expect(nudges.map((n) => n.pluginId)).toEqual(order);
		});
	});

	/*
	 * The footer collapses instead of capping. An earlier version capped the list at 3
	 * desktop / 1 mobile, which silently withheld integrations — a user with four eligible
	 * plugins saw three and had no way to learn a fourth existed. Collapsing bounds the
	 * height while keeping the full set one click away.
	 */
	describe("collapse threshold", () => {
		const onDesktop = (count: number) => shouldCollapsePluginNudges(count, false);
		const onMobile = (count: number) => shouldCollapsePluginNudges(count, true);

		it("never summarises a lone nudge on either platform", () => {
			expect(onDesktop(1)).toBe(false);
			expect(onMobile(1)).toBe(false);
		});

		it("does not collapse an empty footer", () => {
			expect(onDesktop(0)).toBe(false);
			expect(onMobile(0)).toBe(false);
		});

		/* Desktop has room for a run of rows beneath the three suggestions, so collapsing
		   earlier would add a click for no gain. Four stay expanded; five collapse. */
		it("keeps up to four rows expanded on desktop", () => {
			expect(onDesktop(2)).toBe(false);
			expect(onDesktop(4)).toBe(false);
			expect(onDesktop(5)).toBe(true);
			expect(onDesktop(9)).toBe(true);
		});

		/* On mobile the composer and keyboard already claim most of the viewport, so a run
		   of rows crowds out the suggestions above them. */
		it("collapses from two rows on mobile", () => {
			expect(onMobile(2)).toBe(true);
			expect(onMobile(5)).toBe(true);
		});

		it("defaults to the desktop threshold when the platform is omitted", () => {
			expect(shouldCollapsePluginNudges(4)).toBe(false);
			expect(shouldCollapsePluginNudges(5)).toBe(true);
		});

		it("matches the exported thresholds", () => {
			expect(onDesktop(PLUGIN_NUDGE_COLLAPSE_THRESHOLD_DESKTOP)).toBe(true);
			expect(onDesktop(PLUGIN_NUDGE_COLLAPSE_THRESHOLD_DESKTOP - 1)).toBe(false);
			expect(onMobile(PLUGIN_NUDGE_COLLAPSE_THRESHOLD_MOBILE)).toBe(true);
			expect(onMobile(PLUGIN_NUDGE_COLLAPSE_THRESHOLD_MOBILE - 1)).toBe(false);
		});

		it("collapses no later on mobile than on desktop", () => {
			expect(PLUGIN_NUDGE_COLLAPSE_THRESHOLD_MOBILE).toBeLessThanOrEqual(
				PLUGIN_NUDGE_COLLAPSE_THRESHOLD_DESKTOP,
			);
		});
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

	it("stamps the current shipped version into the id", () => {
		expect(updateNoticeId("a1", "system-prompt", undefined, 2)).toBe("update:a1:system-prompt@2");
		expect(updateNoticeId(undefined, "skill", "explore-vault", "1.1")).toBe(
			"update:global:skill:explore-vault@1.1",
		);
	});

	/*
	 * Dismissals persist forever in plugin data, so the version must be part of the key: a
	 * user who dismissed the v2 notice has not opted out of hearing about v3. Without the
	 * stamp, one dismissal would swallow every future update notice for that surface.
	 */
	it("re-surfaces a notice when the default bumps again after a dismissal", () => {
		const v2: StaleGuidanceLike = { ...sys, currentVersion: 2 };
		const v3: StaleGuidanceLike = { ...sys, currentVersion: 3 };
		const dismissedV2 = [updateNoticeId("a1", "system-prompt", undefined, 2)];

		expect(filterUpdateNotices([v2], dismissedV2)).toEqual([]);
		expect(filterUpdateNotices([v3], dismissedV2).map((n) => n.id)).toEqual(["update:a1:system-prompt@3"]);
	});

	it("carries the customized flag through so the wording can tell the two cases apart", () => {
		const kept: StaleGuidanceLike = { ...sys, customized: true };
		const failedUpdate: StaleGuidanceLike = { ...sys, customized: false };

		expect(filterUpdateNotices([kept], [])[0].customized).toBe(true);
		expect(filterUpdateNotices([failedUpdate], [])[0].customized).toBe(false);
	});

	it("returns nothing when the whole block is dismissed", () => {
		expect(filterUpdateNotices([sys, sys2], [DISMISS_ALL_ID])).toEqual([]);
	});

	it("carries agentName/label through to the notice", () => {
		const [notice] = filterUpdateNotices([sys], []);
		expect(notice).toMatchObject({ agentId: "a1", agentName: "Default", label: "system prompt" });
	});
});
