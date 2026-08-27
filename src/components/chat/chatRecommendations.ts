/**
 * Static catalog of new-chat recommendations and the pure gating logic used to
 * decide which ones to show. Kept free of Svelte/Obsidian imports so it can be
 * unit-tested in isolation and reused by future recommendation types
 * (plugin-skill nudges, updated-prompt notices — see issue #334).
 */

/** Feature a suggestion depends on. `undefined` ⇒ always available. */
export type SuggestionRequirement = "chat" | "search";

export interface SuggestedQuery {
	/** Stable id, used as the dismissal key. */
	id: string;
	/** Lucide icon id rendered on the chip. */
	icon: string;
	/** Chip text; also the query prefilled into the input unless `query` is set. */
	label: string;
	/** Prefilled query text, when it should differ from the visible label. */
	query?: string;
	/** Feature gate; the suggestion is hidden unless the feature is available. */
	requires?: SuggestionRequirement;
}

/** Well-known id used to dismiss the entire recommendations block at once. */
export const DISMISS_ALL_ID = "suggested-queries";

/** Snapshot of which features are currently available in the vault. */
export interface RecommendationContext {
	hasChat: boolean;
	hasSearch: boolean;
}

/**
 * Curated first-query suggestions. `requires` gates each on a feature so we
 * never suggest something the user can't run (e.g. a vault-search prompt with
 * no populated index).
 *
 * Deliberately short. An earlier catalog carried six entries, three of which
 * ("Summarize my recent notes", "What are the main themes in my vault?",
 * "Connect ideas across my notes") were the same broad-retrieval-and-synthesize
 * request in different words, so the list read as padding rather than a menu.
 * Each survivor earns its slot by being structurally distinct:
 *   - `help-overview` is the only one whose answer depends on how THIS install
 *     is configured (which skills and tools the agent actually has), so it
 *     teaches the surface rather than demonstrating the model.
 *   - `find-notes` is the only one prefilling a PARTIAL query — a template the
 *     user completes, not a canned question.
 *   - `summarize-recent` is the only synthesis prompt with a concrete,
 *     verifiable scope ("recent") instead of a vague whole-vault sweep.
 *
 * Anything retrieval-backed MUST declare `requires: "search"`. The two removed
 * synthesis entries were ungated, so they rendered on an empty vault with no
 * populated index and could only disappoint — see the catalog test that guards
 * this.
 */
export const SUGGESTED_QUERIES: SuggestedQuery[] = [
	{
		id: "help-overview",
		icon: "sparkles",
		label: "What can you help me with?",
	},
	{
		id: "summarize-recent",
		icon: "clock",
		label: "Summarize my recent notes",
		requires: "search",
	},
	{
		id: "find-notes",
		icon: "search",
		label: "Find notes about a topic",
		query: "Find my notes about ",
		requires: "search",
	},
];

function requirementMet(requires: SuggestionRequirement | undefined, ctx: RecommendationContext): boolean {
	switch (requires) {
		case "chat":
			return ctx.hasChat;
		case "search":
			return ctx.hasSearch;
		default:
			return true;
	}
}

/**
 * Returns the suggestions to display: those whose feature gate is met and
 * that the user hasn't dismissed. If the whole block was dismissed
 * ({@link DISMISS_ALL_ID}) the result is empty.
 */
export function filterSuggestions(
	ctx: RecommendationContext,
	dismissed: readonly string[],
	catalog: readonly SuggestedQuery[] = SUGGESTED_QUERIES,
): SuggestedQuery[] {
	if (dismissed.includes(DISMISS_ALL_ID)) return [];
	return catalog.filter((s) => requirementMet(s.requires, ctx) && !dismissed.includes(s.id));
}

/**
 * A nudge to enable an S2B agent skill for an installed Obsidian plugin
 * whose integration isn't switched on for the selected agent yet (issue #355).
 */
export interface PluginNudge {
	/** Dismissal key, of the form `plugin:<pluginId>`. */
	id: string;
	pluginId: string;
	displayName: string;
	/** Lucide icon id (matching the plugin's own glyph where known). */
	icon: string;
	/** Bundled skill id documenting the plugin, when the integration has one. */
	skillId?: string;
}

/** Dismissal key for a plugin nudge. Keep in sync with {@link PluginNudge.id}. */
export const pluginNudgeId = (pluginId: string): string => `plugin:${pluginId}`;

/**
 * How many plugin nudges may render at once, by available vertical space.
 *
 * The candidate list is unbounded in principle: `AgentManager.resolvePluginIntegrations`
 * returns the curated integrations PLUS every enabled plugin exposing an object `api`,
 * so a plugin-heavy vault could otherwise stack more "Enable …" rows than the whole
 * suggestion list above it — making the empty state taller, which is the opposite of
 * what this surface is for.
 *
 * Mobile gets one row because the composer and keyboard already claim most of the
 * viewport there. These are display caps only: nothing is dropped from the candidate
 * set, so dismissing or enabling a visible nudge promotes the next one into view.
 */
export const MAX_PLUGIN_NUDGES_DESKTOP = 3;
export const MAX_PLUGIN_NUDGES_MOBILE = 1;

/**
 * Filters plugin nudges down to those the user hasn't dismissed, ranks the ones
 * backed by a preshipped S2B skill first, and (optionally) caps how many render.
 *
 * The candidate list is expected to already be narrowed to installed-but-not-enabled
 * integrations by the caller (which reads live `app.plugins` / agent state).
 * Respects {@link DISMISS_ALL_ID} so "Dismiss all" hides plugin nudges too.
 *
 * Ranking matters because the slots are scarce: a `skillId` means we ship a SKILL.md
 * documenting that plugin's api, so enabling it yields a genuinely more capable agent.
 * An auto-discovered plugin with no bundled skill is the weakest thing on this surface
 * and should never displace a curated one.
 *
 * The sort is stable within each group (`Array.prototype.sort` is stable per spec), so
 * the visible rows don't shuffle between renders as unrelated candidates come and go.
 *
 * @param limit Max nudges to return. Omit for no cap — see {@link MAX_PLUGIN_NUDGES_DESKTOP}.
 */
export function filterPluginNudges(
	candidates: readonly PluginNudge[],
	dismissed: readonly string[],
	limit?: number,
): PluginNudge[] {
	if (dismissed.includes(DISMISS_ALL_ID)) return [];
	const visible = candidates
		.filter((n) => !dismissed.includes(n.id))
		.sort((a, b) => Number(Boolean(b.skillId)) - Number(Boolean(a.skillId)));
	return limit === undefined ? visible : visible.slice(0, Math.max(0, limit));
}

/**
 * The kind of surface a stale-guidance notice refers to. Mirrors `StaleGuidance.kind`
 * from types/plugin — duplicated here to keep this module free of the plugin-types
 * import (it stays pure/unit-testable). Keep the two in sync.
 */
export type UpdateNoticeKind = "system-prompt" | "memory-prompt" | "skill";

/**
 * A notice that a shipped default changed upstream while the user had a customization of
 * it, so it couldn't be auto-updated (issue #356, extended to all surfaces in #401).
 * Sourced from the store's `staleGuidance` records.
 */
export interface UpdateNotice {
	/** Dismissal key, of the form `update:<agentId|global>:<kind>[:<skillName>][@<version>]`. */
	id: string;
	/** Owning agent for the per-agent prompt surfaces; absent for skills (global). */
	agentId?: string;
	agentName?: string;
	kind: UpdateNoticeKind;
	/** Human label for the surface, e.g. "system prompt". */
	label: string;
	/** For `kind: "skill"`, which skill — lets Review open the right note. */
	skillName?: string;
	/** True when the user's own edit was kept; false when an untouched old default couldn't be auto-updated. */
	customized?: boolean;
}

/** Minimal shape of a store `StaleGuidance` record consumed by {@link toUpdateNotice}. */
export interface StaleGuidanceLike {
	agentId?: string;
	agentName?: string;
	kind: UpdateNoticeKind;
	label: string;
	skillName?: string;
	currentVersion?: number | string;
	customized?: boolean;
}

/**
 * Dismissal key for an update notice. Global surfaces (no agentId) use the literal
 * `global` segment so their key is stable and distinct from any per-agent key.
 *
 * Skills are global but there can be several stale at once, so the skill name is appended —
 * otherwise dismissing one skill's notice would dismiss every skill's.
 *
 * The CURRENT shipped version is appended too. Dismissals persist forever
 * (`dismissedRecommendations` in plugin data), so a version-less key would mean dismissing
 * the v2 notice silently swallows the v3 notice years later — each default bump should
 * surface exactly once.
 */
export const updateNoticeId = (
	agentId: string | undefined,
	kind: UpdateNoticeKind,
	skillName?: string,
	currentVersion?: number | string,
): string =>
	`update:${agentId ?? "global"}:${kind}${skillName ? `:${skillName}` : ""}${
		currentVersion !== undefined ? `@${currentVersion}` : ""
	}`;

/** Maps a store stale-guidance record to a dismissable notice. */
export function toUpdateNotice(record: StaleGuidanceLike): UpdateNotice {
	return {
		id: updateNoticeId(record.agentId, record.kind, record.skillName, record.currentVersion),
		agentId: record.agentId,
		agentName: record.agentName,
		kind: record.kind,
		label: record.label,
		skillName: record.skillName,
		customized: record.customized,
	};
}

/**
 * Maps stale-guidance records to notices and drops the dismissed ones. Respects
 * {@link DISMISS_ALL_ID} so "Dismiss all" hides update notices too.
 */
export function filterUpdateNotices(
	records: readonly StaleGuidanceLike[],
	dismissed: readonly string[],
): UpdateNotice[] {
	if (dismissed.includes(DISMISS_ALL_ID)) return [];
	return records.map(toUpdateNotice).filter((n) => !dismissed.includes(n.id));
}
