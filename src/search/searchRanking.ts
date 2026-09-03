/**
 * Shared search ranking helpers.
 *
 * Provides title, alias, tag and path boosting functions used by both
 * MiniSearch lexical ranking and hybrid post-fusion ranking.
 *
 * Each function accepts a `scale` object (or a single `maxBoost` number)
 * so callers can supply values appropriate for their scoring domain
 * (e.g. raw BM25 absolute boosts vs. small RRF fraction boosts).
 */

import { isNumericSearchTerm, normalizeSearchText, tokenizeSearchText } from "./searchTermUtils";
import { createQueryPlan, type QueryPlan } from "./queryPlan";
import { isStopword } from "./stopwords";

export type TitleMatchKind =
	| "exact"
	| "leading-prefix-numeric"
	| "leading-prefix"
	| "starts-with"
	| "contains"
	| "all-terms";

export type AliasMatchKind = "exact" | "token" | "prefix" | "contains";

// ---------------------------------------------------------------------------
// Title boost
// ---------------------------------------------------------------------------

/** Scale factors for `calculateTitleBoost`. */
export interface TitleBoostScale {
	/** Boost for an exact title match. */
	exact: number;
	/** Boost when query tokens prefix-match the leading title tokens (numeric case). */
	leadingPrefixNumeric: number;
	/** Boost when query tokens prefix-match the leading title tokens (non-numeric). */
	leadingPrefix: number;
	/** Boost when the title starts with the query string. */
	startsWith: number;
	/** Boost when the title contains the full query string. */
	contains: number;
	/** Boost when query is a numeric leading term and all terms match. */
	numericAllTerms: number;
	/** Boost when query is a numeric leading term but not all terms match. */
	numericPartialTerms: number;
	/** Boost when every non-numeric query term matches the title. */
	allTerms: number;
	/** Multiplier per partial term ratio (result = ratio × partialTermFactor). */
	partialTermFactor: number;
}

/**
 * Create a `TitleBoostScale` from a single maximum value using the
 * proportions from the hybrid RRF post-fusion ranking.
 */
function titleBoostFromMax(maxBoost: number): TitleBoostScale {
	return {
		exact: maxBoost,
		leadingPrefixNumeric: maxBoost * 0.98,
		leadingPrefix: maxBoost * 0.85,
		startsWith: maxBoost * 0.8,
		contains: maxBoost * 0.8,
		numericAllTerms: maxBoost * 0.95,
		numericPartialTerms: maxBoost * 0.75,
		allTerms: maxBoost * 0.6,
		partialTermFactor: maxBoost * 0.6,
	};
}

/**
 * True when every query prefix token matches the leading title tokens.
 * Example: query "3 blind" → tokens ["3","blind"] matches title "3 Blind Mice".
 */
export function matchesLeadingTitlePrefix(queryTokens: string[], titleTokens: string[]): boolean {
	if (queryTokens.length === 0 || titleTokens.length < queryTokens.length) {
		return false;
	}

	return queryTokens.every((token, index) => titleTokens[index]?.startsWith(token));
}

function resolveQueryPlan(query: string | QueryPlan): QueryPlan {
	return typeof query === "string" ? createQueryPlan(query) : query;
}

function getAliasMatchKindRank(kind: AliasMatchKind | undefined): number {
	switch (kind) {
		case "exact":
			return 4;
		case "token":
			return 3;
		case "prefix":
			return 2;
		case "contains":
			return 1;
		default:
			return 0;
	}
}

export function getTitleMatchKind(query: string | QueryPlan, title: string): TitleMatchKind | undefined {
	const plan = resolveQueryPlan(query);
	const normalizedQuery = plan.normalizedQuery;
	const normalizedTitle = normalizeSearchText(title);
	const queryTerms = plan.searchTerms;
	const queryPrefixTokens = plan.normalizedTokens;
	const titleTerms = tokenizeSearchText(title);

	if (!normalizedQuery || !normalizedTitle) {
		return undefined;
	}

	if (normalizedTitle === normalizedQuery) {
		return "exact";
	}

	if (matchesLeadingTitlePrefix(queryPrefixTokens, titleTerms)) {
		const leadingQueryTerm = queryPrefixTokens[0];
		if (leadingQueryTerm && isNumericSearchTerm(leadingQueryTerm) && titleTerms[0] === leadingQueryTerm) {
			return "leading-prefix-numeric";
		}

		return "leading-prefix";
	}

	if (normalizedTitle.startsWith(normalizedQuery)) {
		return "starts-with";
	}

	if (normalizedTitle.includes(normalizedQuery)) {
		return "contains";
	}

	if (queryTerms.length > 0 && queryTerms.every((term) => normalizedTitle.includes(term))) {
		return "all-terms";
	}

	return undefined;
}

export function getAliasMatchKind(
	query: string | QueryPlan,
	aliases: string[] | Record<string, unknown> | undefined,
): AliasMatchKind | undefined {
	const plan = resolveQueryPlan(query);
	const normalizedQuery = plan.normalizedQuery;
	if (!normalizedQuery) {
		return undefined;
	}

	const list = Array.isArray(aliases) ? aliases : getFrontmatterAliases(aliases);
	if (list.length === 0) {
		return undefined;
	}

	let bestKind: AliasMatchKind | undefined;
	for (const alias of list) {
		const normalizedAlias = normalizeSearchText(alias);
		if (!normalizedAlias) {
			continue;
		}

		const aliasTokens = tokenizeSearchText(alias);
		let nextKind: AliasMatchKind | undefined;
		if (normalizedAlias === normalizedQuery) {
			nextKind = "exact";
		} else if (aliasTokens.includes(normalizedQuery)) {
			nextKind = "token";
		} else if (
			aliasTokens.some((token) => token.startsWith(normalizedQuery)) ||
			normalizedAlias.startsWith(normalizedQuery)
		) {
			nextKind = "prefix";
		} else if (normalizedAlias.includes(normalizedQuery)) {
			nextKind = "contains";
		}

		if (getAliasMatchKindRank(nextKind) > getAliasMatchKindRank(bestKind)) {
			bestKind = nextKind;
		}
	}

	return bestKind;
}

/**
 * Calculate a title boost based on how well `query` matches `title`.
 *
 * Pass a `TitleBoostScale` for full control over each tier's value,
 * or a plain number to use the default proportions via `titleBoostFromMax`.
 */
export function calculateTitleBoost(query: string | QueryPlan, title: string, scale: TitleBoostScale | number): number {
	const s = typeof scale === "number" ? titleBoostFromMax(scale) : scale;
	const plan = resolveQueryPlan(query);
	const normalizedTitle = normalizeSearchText(title);
	const queryTerms = plan.searchTerms;
	const queryPrefixTokens = plan.normalizedTokens;
	const titleTerms = tokenizeSearchText(title);
	const minimumMatchedTerms = plan.minimumMatchedTerms;
	const titleMatchKind = getTitleMatchKind(plan, title);

	if (!normalizedTitle || !titleMatchKind) return 0;

	switch (titleMatchKind) {
		case "exact":
			return s.exact;
		case "leading-prefix-numeric":
			return s.leadingPrefixNumeric;
		case "leading-prefix":
			return s.leadingPrefix;
		case "starts-with":
			return s.startsWith;
		case "contains":
			return s.contains;
		default:
			break;
	}

	if (queryTerms.length === 0) return 0;

	// Numeric leading term that matches title's leading token
	const leadingQueryTerm = queryPrefixTokens[0];
	if (leadingQueryTerm && isNumericSearchTerm(leadingQueryTerm) && titleTerms[0] === leadingQueryTerm) {
		if (queryTerms.every((term) => normalizedTitle.includes(term))) {
			return s.numericAllTerms;
		}

		return s.numericPartialTerms;
	}

	// Partial term overlap
	const matchingTerms = queryTerms.filter((term) => normalizedTitle.includes(term));
	if (matchingTerms.length === 0) return 0;
	if (matchingTerms.length < minimumMatchedTerms) return 0;

	const matchRatio = matchingTerms.length / queryTerms.length;

	if (matchingTerms.length === queryTerms.length) {
		return s.allTerms;
	}

	return matchRatio * s.partialTermFactor;
}

// ---------------------------------------------------------------------------
// Alias boost
// ---------------------------------------------------------------------------

/**
 * Extract aliases from frontmatter (handles both string and array forms).
 */
function getFrontmatterAliases(frontmatter: Record<string, unknown> | undefined): string[] {
	if (!frontmatter) {
		return [];
	}

	const rawAliases = frontmatter.aliases ?? frontmatter.alias;
	if (typeof rawAliases === "string") {
		return rawAliases
			.split(",")
			.map((alias) => alias.trim())
			.filter((alias) => alias.length > 0);
	}

	if (Array.isArray(rawAliases)) {
		return rawAliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0);
	}

	return [];
}

/**
 * Calculate an alias boost based on how well `query` matches aliases.
 *
 * Accepts either a frontmatter object (aliases are extracted automatically)
 * or a pre-parsed `string[]`.  Returns a value between 0 and `maxBoost`.
 */
export function calculateAliasBoost(
	query: string | QueryPlan,
	aliases: string[] | Record<string, unknown> | undefined,
	maxBoost: number,
): number {
	const matchKind = getAliasMatchKind(query, aliases);
	switch (matchKind) {
		case "exact":
			return maxBoost;
		case "token":
			return maxBoost * 0.92;
		case "prefix":
			return maxBoost * 0.88;
		case "contains":
			return maxBoost * 0.65;
		default:
			return 0;
	}
}

// ---------------------------------------------------------------------------
// Tag boost
// ---------------------------------------------------------------------------

/**
 * Fraction of `maxBoost` available to a *token-wise* match, as opposed to a
 * whole-query match.
 *
 * Whole-query matching ("the query IS this tag") is strong evidence and keeps the
 * full boost. A token-wise match is much weaker evidence — a conversational query
 * shares a token with a folder or tag all the time without being *about* it — so
 * it is capped well below the whole-query tiers, and scaled by coverage on top.
 *
 * This ceiling is what stops the token-wise path from re-creating the defect
 * documented in `integration/README.md`: the `Topics/Smart Cities/` folder was
 * worth ~0.10 nDCG on a single query purely because a directory happened to be
 * named after the query's subject. Coverage-scaled and capped, a one-token
 * incidental overlap can nudge a tie but cannot overturn a relevance gap.
 *
 * Applies to **paths only** — see `calculateTagBoost` for why tags are excluded.
 * Measured on the graded benchmark (`harrier-oss-v1-0.6b-MLX-8bit`, one index
 * build): path-only token-wise matching leaves every tier byte-identical to
 * baseline (core 0.9085, hard 0.7456, recency 0.8155), so the capability is free
 * on this corpus. 0.35 is kept rather than tuned down because nothing here
 * measures it — the corpus has one folder-shaped region and the graded queries do
 * not depend on folder names.
 */
const TOKENWISE_MATCH_SHARE = 0.35;

/**
 * Coverage-weighted token overlap between the query's significant terms and a
 * single target string (a tag or a path segment), in 0-1.
 *
 * Both directions matter and are deliberately combined multiplicatively-ish via
 * the *smaller* of the two ratios:
 *
 *  - query coverage — how much of what the user asked for this target accounts
 *    for. One token out of six is weak evidence.
 *  - target coverage — how much of the target the match accounts for. A query
 *    token matching the whole of a short tag (`#review`) is stronger evidence
 *    than matching one word of a long folder name.
 *
 * Taking the minimum means a match must be substantial from *both* sides. This is
 * what keeps "notes from the vendor call" from lighting up every folder that
 * contains the word "notes".
 */
function tokenOverlapRatio(queryTokens: string[], targetTokens: string[]): number {
	// Stopwords are excluded from *both* sides rather than merely down-weighted.
	// `extractSearchTerms` keeps them (only `getTermBoost` discounts them, at BM25
	// time), so without this a query like "notes from the vendor call" would count
	// `from` and `the` toward coverage — letting an incidental function-word hit on
	// a folder named "The Archive" register as a third of a match. Overlap here is
	// an evidence ratio, and a function word is not evidence.
	const query = queryTokens.filter((token) => !isStopword(token));
	const target = targetTokens.filter((token) => !isStopword(token));
	if (query.length === 0 || target.length === 0) {
		return 0;
	}

	const targetSet = new Set(target);
	const matched = query.filter((token) => targetSet.has(token));
	if (matched.length === 0) {
		return 0;
	}

	const queryCoverage = matched.length / query.length;
	const targetCoverage = new Set(matched).size / targetSet.size;
	return Math.min(queryCoverage, targetCoverage);
}

/**
 * Calculate a tag boost based on how well `query` matches the given tags.
 *
 * Whole-query only (equality, prefix, substring), so a conversational query
 * scores 0 here. That is deliberate, and it is the one asymmetry with
 * `calculatePathBoost`.
 *
 * **Token-wise tag matching was implemented and measured, and it is a net loss.**
 * On the graded benchmark (`harrier-oss-v1-0.6b-MLX-8bit`, single index build) it
 * took the hard tier 0.7456 → 0.7375, entirely from `polysemy` 0.7560 → 0.7154,
 * while improving nothing. The failing case is `the review is blocking me`, and it
 * is not a tuning problem:
 *
 *   | note                      | tags               | correct? |
 *   |---------------------------|--------------------|----------|
 *   | `Weekly Review 2026-03-14`| `zettel`, `review` | no       |
 *   | `PR Review Backlog`       | `zettel`, `platform`| **yes** |
 *
 * The wrong note is the one tagged `#review`; the right one is not tagged for the
 * word the user typed. Tags record what a note *is*, and a query naming a topic is
 * often looking for a note *about* that topic rather than one filed under it —
 * so on exactly the queries where senses collide, tag identity points the wrong
 * way. Halving the share (0.35 → 0.15) did not recover the case, because the boost
 * was widening a lead the wrong note already held rather than creating one.
 *
 * Paths do not have this problem: a folder is a *location*, and a note's location
 * is not a claim about which sense of a word it uses.
 *
 * Returns a value between 0 and `maxBoost`.
 */
export function calculateTagBoost(query: string | QueryPlan, tags: string[], maxBoost: number): number {
	const plan = resolveQueryPlan(query);
	const normalizedQuery = plan.normalizedQuery;
	if (!normalizedQuery || tags.length === 0) {
		return 0;
	}

	let bestBoost = 0;
	for (const tag of tags) {
		const normalizedTag = tag.replace(/^#/, "").trim().toLowerCase();
		if (!normalizedTag) continue;

		if (normalizedTag === normalizedQuery) {
			bestBoost = Math.max(bestBoost, maxBoost);
			continue;
		}

		if (normalizedTag.startsWith(normalizedQuery)) {
			bestBoost = Math.max(bestBoost, maxBoost * 0.4);
			continue;
		}

		// No token-wise fallback here, deliberately — see the docblock above.
		if (normalizedTag.includes(normalizedQuery)) {
			bestBoost = Math.max(bestBoost, maxBoost * 0.25);
		}
	}

	return bestBoost;
}

// ---------------------------------------------------------------------------
// Path segment boost
// ---------------------------------------------------------------------------

/**
 * Calculate a path-segment boost based on how well `query` matches
 * the folder segments of `pathSegments`.
 *
 * Matches whole-query first, then falls back to a capped token-wise overlap, on
 * the same terms as `calculateTagBoost` — see `TOKENWISE_MATCH_SHARE` for why the
 * token-wise tier is deliberately weak.
 *
 * Returns a value between 0 and `maxBoost`.
 */
export function calculatePathBoost(query: string | QueryPlan, pathSegments: string[], maxBoost: number): number {
	const plan = resolveQueryPlan(query);
	const normalizedQuery = plan.normalizedQuery;
	if (!normalizedQuery || pathSegments.length === 0) {
		return 0;
	}

	let bestBoost = 0;
	for (const segment of pathSegments) {
		const normalizedSegment = segment.trim().toLowerCase();
		if (!normalizedSegment) continue;

		if (normalizedSegment === normalizedQuery) {
			bestBoost = Math.max(bestBoost, maxBoost);
			continue;
		}

		if (normalizedSegment.startsWith(normalizedQuery)) {
			bestBoost = Math.max(bestBoost, maxBoost * 0.46);
			continue;
		}

		if (normalizedSegment.includes(normalizedQuery)) {
			bestBoost = Math.max(bestBoost, maxBoost * 0.26);
			continue;
		}

		const overlap = tokenOverlapRatio(plan.searchTerms, tokenizeSearchText(normalizedSegment));
		if (overlap > 0) {
			bestBoost = Math.max(bestBoost, maxBoost * TOKENWISE_MATCH_SHARE * overlap);
		}
	}

	return bestBoost;
}
