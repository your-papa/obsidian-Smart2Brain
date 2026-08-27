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

/**
 * A starter query demonstrating what an *enabled* plugin integration can do.
 *
 * The exact counterpart of a {@link PluginNudge}: a nudge asks the user to switch an
 * integration on and vanishes once they do, at which point the agent is more capable but
 * the empty state says nothing about it. These fill that gap — they appear only once the
 * integration is usable, and they persist.
 */
export interface IntegrationSuggestion extends SuggestedQuery {
	/** Obsidian plugin id whose integration must be usable for this to show. */
	pluginId: string;
}

/**
 * Starter queries for the community integrations S2B ships a `SKILL.md` for.
 *
 * Hardcoded rather than read from skill frontmatter, deliberately. The frontmatter
 * `description` is model-facing prose ("…Use when the user asks about their tasks, todos,
 * due dates…") and would read wrong on a chip; and neither frontmatter parser
 * (`src/skills/defaults/index.ts`, `src/skills/SkillsService.ts`) can express a list —
 * both are line-based `key: value` scanners over a `Record<string, string>` metadata type.
 * Hand-written copy is also simply better copy, which is the whole point of this surface.
 *
 * Core-plugin skills (canvas, bases) are deliberately absent: they are enabled by default
 * whenever their core plugin is on, so they would claim slots the user never opted into.
 *
 * `obsidian-charts` is absent too despite shipping a SKILL.md — it has no entry in
 * `CURATED_PLUGIN_INTEGRATIONS` and renders through dataviewjs codeblocks rather than a
 * public scripting `api`, so it never gains an `exec_` tool and a suggestion for it could
 * never satisfy the usability gate. The catalog test enforces this.
 *
 * Icons reuse the ids in `PLUGIN_ICON_BY_ID` so a suggestion wears the same glyph as the
 * nudge it replaces.
 */
export const INTEGRATION_SUGGESTIONS: IntegrationSuggestion[] = [
	{
		id: "int-tasknotes",
		pluginId: "tasknotes",
		icon: "check-square",
		label: "What tasks are due this week?",
	},
	{
		id: "int-tasks",
		pluginId: "obsidian-tasks-plugin",
		icon: "check-square",
		label: "What tasks are overdue?",
	},
	{
		id: "int-dataview",
		pluginId: "dataview",
		icon: "code",
		label: "Show a table of my notes by tag",
	},
];

/**
 * Ceiling on the combined suggestion list. The generic catalog was deliberately trimmed to
 * three; without a ceiling a vault with four integrations enabled would push the list back
 * to seven and undo that.
 */
export const MAX_TOTAL_SUGGESTIONS = 5;

/**
 * Filters integration suggestions to those whose integration is usable and that the user
 * hasn't dismissed. `isUsable` is supplied by the caller (it reads live `app.plugins` and
 * agent state), keeping this module free of Svelte/Obsidian imports.
 *
 * Respects {@link DISMISS_ALL_ID} so "Dismiss all" hides these too — the generic catalog
 * gets that from {@link filterSuggestions}, and these would otherwise survive it.
 */
export function filterIntegrationSuggestions(
	catalog: readonly IntegrationSuggestion[],
	dismissed: readonly string[],
	isUsable: (pluginId: string) => boolean,
): IntegrationSuggestion[] {
	if (dismissed.includes(DISMISS_ALL_ID)) return [];
	return catalog.filter((s) => isUsable(s.pluginId) && !dismissed.includes(s.id));
}

/**
 * Combines the generic starters with the integration ones, generic first, capped.
 *
 * Generic lead so the top of the list is stable and familiar regardless of which plugins
 * happen to be installed; integration suggestions fill whatever room is left. With the
 * default cap that means a user running several integrations sees the three generic
 * starters plus two integration ones.
 */
export function mergeSuggestions(
	generic: readonly SuggestedQuery[],
	integration: readonly SuggestedQuery[],
	limit: number = MAX_TOTAL_SUGGESTIONS,
): SuggestedQuery[] {
	return [...generic, ...integration].slice(0, Math.max(0, limit));
}

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
 * At this many nudges or more, the footer collapses into a single summary row that
 * expands on click instead of rendering one row per integration.
 *
 * Not a cap — nothing is hidden or dropped. An earlier version DID cap the list
 * (3 desktop / 1 mobile), but that silently withheld integrations: a user with four
 * eligible plugins saw three and had no way to know a fourth existed. Collapsing
 * keeps the whole set reachable while bounding the footer's height, so it never
 * out-grows the suggestion list it sits beneath.
 *
 * The threshold is platform-dependent because the available vertical space is.
 * Desktop comfortably shows four rows beneath three suggestions, so collapsing
 * earlier would just add a click for no gain; on mobile the composer and keyboard
 * already claim most of the viewport, so a run of rows crowds out the suggestions.
 *
 * Below the threshold every nudge renders directly — in particular a lone nudge is
 * never summarised, since "1 plugin integration available" behind a click is
 * strictly more work than simply showing the row.
 */
export const PLUGIN_NUDGE_COLLAPSE_THRESHOLD_DESKTOP = 5;
export const PLUGIN_NUDGE_COLLAPSE_THRESHOLD_MOBILE = 2;

/**
 * Whether the nudge footer should render collapsed as a summary row.
 *
 * @param count How many nudges are pending.
 * @param onMobile Selects the threshold — see the two threshold constants.
 */
export function shouldCollapsePluginNudges(count: number, onMobile = false): boolean {
	return count >= (onMobile ? PLUGIN_NUDGE_COLLAPSE_THRESHOLD_MOBILE : PLUGIN_NUDGE_COLLAPSE_THRESHOLD_DESKTOP);
}

/**
 * Filters plugin nudges down to those the user hasn't dismissed and ranks the ones
 * backed by a preshipped S2B skill first.
 *
 * The candidate list is expected to already be narrowed to installed-but-not-enabled
 * integrations by the caller (which reads live `app.plugins` / agent state).
 * Respects {@link DISMISS_ALL_ID} so "Dismiss all" hides plugin nudges too.
 *
 * Ranking matters even without a cap: a `skillId` means we ship a SKILL.md documenting
 * that plugin's api, so enabling it yields a genuinely more capable agent. Curated
 * integrations lead the list (and supply the summary row's leading icons); an
 * auto-discovered plugin with no bundled skill is the weakest thing here and sorts last.
 *
 * The sort is stable within each group (`Array.prototype.sort` is stable per spec), so
 * rows don't shuffle between renders as unrelated candidates come and go. It also does
 * not mutate `candidates` — `filter` has already produced a fresh array by then.
 */
export function filterPluginNudges(candidates: readonly PluginNudge[], dismissed: readonly string[]): PluginNudge[] {
	if (dismissed.includes(DISMISS_ALL_ID)) return [];
	return candidates
		.filter((n) => !dismissed.includes(n.id))
		.sort((a, b) => Number(Boolean(b.skillId)) - Number(Boolean(a.skillId)));
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
