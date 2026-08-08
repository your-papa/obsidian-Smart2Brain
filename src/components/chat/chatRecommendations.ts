/**
 * Static catalog of new-chat recommendations and the pure gating logic used to
 * decide which ones to show. Kept free of Svelte/Obsidian imports so it can be
 * unit-tested in isolation and reused by future recommendation types
 * (plugin-skill nudges, updated-prompt notices — see issue #334).
 */

/** Feature a suggestion depends on. `undefined` ⇒ always available. */
export type SuggestionRequirement = "chat" | "search" | "graph";

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
	hasGraph: boolean;
}

/**
 * Curated first-query suggestions. `requires` gates each on a feature so we
 * never suggest something the user can't run (e.g. a vault-search prompt with
 * no populated index).
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
	{
		id: "vault-themes",
		icon: "git-fork",
		label: "What are the main themes in my vault?",
		requires: "graph",
	},
	{
		id: "connect-ideas",
		icon: "network",
		label: "Connect ideas across my notes",
		requires: "graph",
	},
	{
		id: "brainstorm",
		icon: "lightbulb",
		label: "Help me brainstorm ideas",
		requires: "chat",
	},
];

function requirementMet(requires: SuggestionRequirement | undefined, ctx: RecommendationContext): boolean {
	switch (requires) {
		case "chat":
			return ctx.hasChat;
		case "search":
			return ctx.hasSearch;
		case "graph":
			return ctx.hasGraph;
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
 * Filters plugin nudges down to those the user hasn't dismissed. The candidate
 * list is expected to already be narrowed to installed-but-not-enabled
 * integrations by the caller (which reads live `app.plugins` / agent state).
 * Respects {@link DISMISS_ALL_ID} so "Dismiss all" hides plugin nudges too.
 */
export function filterPluginNudges(candidates: readonly PluginNudge[], dismissed: readonly string[]): PluginNudge[] {
	if (dismissed.includes(DISMISS_ALL_ID)) return [];
	return candidates.filter((n) => !dismissed.includes(n.id));
}

/**
 * The kind of guidance surface a stale-guidance notice refers to. Mirrors
 * `StaleGuidance.kind` from types/plugin — duplicated here to keep this module
 * free of the plugin-types import (it stays pure/unit-testable). Only the per-agent
 * base system prompt is tracked now — skill/tool guidance moved into skill bodies.
 */
export type UpdateNoticeKind = "system-prompt";

/**
 * A notice that the base system prompt default changed upstream while the user had a
 * customization of it, so it couldn't be auto-updated (issue #356). Sourced from the
 * store's `staleGuidance` records.
 */
export interface UpdateNotice {
	/** Dismissal key, of the form `update:<agentId|global>:<kind>`. */
	id: string;
	/** Owning agent for the base system prompt. */
	agentId?: string;
	agentName?: string;
	kind: UpdateNoticeKind;
	/** Human label for the surface, e.g. "system prompt". */
	label: string;
}

/** Minimal shape of a store `StaleGuidance` record consumed by {@link toUpdateNotice}. */
export interface StaleGuidanceLike {
	agentId?: string;
	agentName?: string;
	kind: UpdateNoticeKind;
	label: string;
}

/**
 * Dismissal key for an update notice. Global surfaces (no agentId) use the literal
 * `global` segment so their key is stable and distinct from any per-agent key.
 */
export const updateNoticeId = (agentId: string | undefined, kind: UpdateNoticeKind): string =>
	`update:${agentId ?? "global"}:${kind}`;

/** Maps a store stale-guidance record to a dismissable notice. */
export function toUpdateNotice(record: StaleGuidanceLike): UpdateNotice {
	return {
		id: updateNoticeId(record.agentId, record.kind),
		agentId: record.agentId,
		agentName: record.agentName,
		kind: record.kind,
		label: record.label,
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
