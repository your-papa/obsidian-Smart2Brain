/**
 * Static catalog of new-chat recommendations and the pure gating logic used to
 * decide which ones to show. Kept free of Svelte/Obsidian imports so it can be
 * unit-tested in isolation and reused by future recommendation types
 * (plugin-capability nudges, updated-prompt notices — see issue #334).
 */

/** Capability a suggestion depends on. `undefined` ⇒ always available. */
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
	/** Capability gate; the suggestion is hidden unless the capability is available. */
	requires?: SuggestionRequirement;
}

/** Well-known id used to dismiss the entire recommendations block at once. */
export const DISMISS_ALL_ID = "suggested-queries";

/** Snapshot of which capabilities are currently available in the vault. */
export interface RecommendationContext {
	hasChat: boolean;
	hasSearch: boolean;
	hasGraph: boolean;
}

/**
 * Curated first-query suggestions. `requires` gates each on a capability so we
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
 * Returns the suggestions to display: those whose capability gate is met and
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
