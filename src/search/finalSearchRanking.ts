import { calculateAliasBoost, calculateTitleBoost, getAliasMatchKind, type AliasMatchKind } from "./searchRanking";
import { createQueryPlan } from "./queryPlan";
import { getRecentRerankScore, type RecentBoostInfo } from "./recentNotes";
import type { SearchMatchBadge, SearchRankingDebug, SearchResult } from "../vectorstore/types";

/*
 * ROBUSTNESS DEBT (tracked in GitHub issue): this file is a stack of ~9
 * hand-calibrated constants (FUSION_RRF_K, the FUSION_*_BOOST_MAX /
 * SEMANTIC_ONLY_*_BOOST_MAX pairs, RECENT_ALIAS_SCORE_WEIGHT,
 * MAX_RECENT_ALIAS_SCORE_SHARE, RECENT_BOOST_ELIGIBLE_RANK,
 * SEMANTIC_SCORE_BLEND_WEIGHT) that interact multiplicatively and were tuned
 * against a small fixture vault (~88 docs, one embedding model). Two known
 * generalization gaps:
 *   1. RECENT_BOOST_ELIGIBLE_RANK is a hard *rank* cutoff, not a relative
 *      *score* cliff — a strong match at rank 11 is gated while a weak match
 *      at rank 10 is not. A relative-score threshold (cosine >= fraction of
 *      the top match) would scale better across vault sizes / models.
 *   2. SEMANTIC_SCORE_BLEND_WEIGHT (0.3) is a fixed share, not adaptive to the
 *      cosine distribution of the result set.
 * The current values fix an observed bug and regress nothing; treat them as a
 * tuned heuristic, not a general algorithm. Re-validate before scaling to
 * large vaults or new embedding models.
 */

const FUSION_RRF_K = 60;
const FUSION_TITLE_BOOST_MAX = 0.03;
const FUSION_ALIAS_BOOST_MAX = 0.028;
const SEMANTIC_ONLY_TITLE_BOOST_MAX = 0.12;
const SEMANTIC_ONLY_ALIAS_BOOST_MAX = 0.12;
const RECENT_ALIAS_SCORE_WEIGHT = 1.2;
const MAX_RECENT_ALIAS_SCORE_SHARE = 0.15;

/**
 * A note only receives the recency boost when it is already a genuine match.
 * When semantic results exist, that means a top-N *semantic* rank (a weak
 * lexical hit on common query words is not relevance); for lexical-only queries
 * it means a top-N lexical rank. This stops a merely-recently-opened note from
 * being lifted over the best-matching result. Recent notes below this rank keep
 * their "recent" badge but contribute no recency score.
 */
const RECENT_BOOST_ELIGIBLE_RANK = 10;

/**
 * Share of the hybrid base score derived from the *magnitude* of the semantic
 * cosine (relative to the best match in the set), with the remainder from
 * rank-based RRF. RRF alone discards score magnitude, so a strong semantic
 * match barely outranks a weak one at a nearby rank; this term restores that
 * signal while keeping RRF as the backbone (so the tuned title/alias boosts
 * stay calibrated).
 */
const SEMANTIC_SCORE_BLEND_WEIGHT = 0.3;

/**
 * Scales the normalized-semantic blend term onto the same magnitude as the RRF
 * sum, whose max is `2 / (K + 1)` (both sources at rank 1). Keeps the blend
 * comparable to the fusion boosts rather than swamping them.
 */
const RRF_MAX_SUM = 2 / (FUSION_RRF_K + 1);

interface RankSearchResultsOptions {
	query?: string;
	lexicalResults?: SearchResult[];
	semanticResults?: SearchResult[];
	recentBoostByPath?: Map<string, RecentBoostInfo>;
}

interface RankedEntry {
	result: SearchResult;
	lexicalRank?: number;
	semanticRank?: number;
	lexicalScore?: number;
	semanticScore?: number;
}

function mergeBadges(...badgeSets: Array<SearchMatchBadge[] | undefined>): SearchMatchBadge[] | undefined {
	const merged = Array.from(new Set(badgeSets.flatMap((badges) => badges ?? [])));
	return merged.length > 0 ? merged : undefined;
}

function mergeRankingDebug(
	existing: SearchRankingDebug | undefined,
	incoming: SearchRankingDebug | undefined,
): SearchRankingDebug | undefined {
	if (!existing) {
		return incoming;
	}

	if (!incoming) {
		return existing;
	}

	return {
		...existing,
		...incoming,
		lexicalFeatures: incoming.lexicalFeatures ?? existing.lexicalFeatures,
	};
}

function mergeSearchResult(base: SearchResult, incoming: SearchResult, preferIncoming: boolean): SearchResult {
	return {
		...base,
		...incoming,
		frontmatter: preferIncoming
			? (incoming.frontmatter ?? base.frontmatter)
			: (base.frontmatter ?? incoming.frontmatter),
		tags: preferIncoming ? (incoming.tags ?? base.tags) : (base.tags ?? incoming.tags),
		matchExplanation: preferIncoming
			? (incoming.matchExplanation ?? base.matchExplanation)
			: (base.matchExplanation ?? incoming.matchExplanation),
		matchBadges: mergeBadges(base.matchBadges, incoming.matchBadges),
		rankingDebug: mergeRankingDebug(base.rankingDebug, incoming.rankingDebug),
		score: incoming.score ?? base.score,
	};
}

function getRankScore(rank: number | undefined): number {
	if (rank === undefined) {
		return 0;
	}

	return 1 / (FUSION_RRF_K + rank);
}

function getFallbackScore(score: number | undefined, rank: number | undefined, totalResults: number): number {
	if (score !== undefined) {
		return score;
	}

	if (rank !== undefined) {
		return Math.max(totalResults - rank + 1, 1);
	}

	return 0;
}

function getRecentAliasBonusWeight(matchKind: AliasMatchKind | undefined): number {
	switch (matchKind) {
		case "exact":
			return 1;
		case "token":
			return 1;
		case "prefix":
			return 0.75;
		default:
			return 0;
	}
}

export function rankSearchResults({
	query,
	lexicalResults = [],
	semanticResults = [],
	recentBoostByPath = new Map<string, RecentBoostInfo>(),
}: RankSearchResultsOptions): SearchResult[] {
	const entries = new Map<string, RankedEntry>();
	const queryPlan = query?.trim() ? createQueryPlan(query) : null;
	const hasLexicalSource = lexicalResults.length > 0;
	const hasSemanticSource = semanticResults.length > 0;
	const hasHybridSources = hasLexicalSource && hasSemanticSource;
	const shouldApplyQueryRescue = Boolean(queryPlan) && hasSemanticSource;
	const titleRescueMax = hasHybridSources
		? FUSION_TITLE_BOOST_MAX
		: shouldApplyQueryRescue
			? SEMANTIC_ONLY_TITLE_BOOST_MAX
			: 0;
	const aliasRescueMax = hasHybridSources
		? FUSION_ALIAS_BOOST_MAX
		: shouldApplyQueryRescue
			? SEMANTIC_ONLY_ALIAS_BOOST_MAX
			: 0;
	const totalResults = Math.max(lexicalResults.length, semanticResults.length);
	// Best semantic score in the set, for relative (per-query) normalization of
	// the magnitude blend — avoids any per-model absolute threshold.
	const maxSemanticScore = semanticResults.reduce((max, r) => Math.max(max, r.score ?? 0), 0);

	for (const [index, result] of semanticResults.entries()) {
		entries.set(result.path, {
			result: { ...result },
			semanticRank: index + 1,
			semanticScore: result.score,
		});
	}

	for (const [index, result] of lexicalResults.entries()) {
		const existing = entries.get(result.path);
		if (existing) {
			existing.result = mergeSearchResult(existing.result, result, true);
			existing.lexicalRank = index + 1;
			existing.lexicalScore = result.score;
			continue;
		}

		entries.set(result.path, {
			result: { ...result },
			lexicalRank: index + 1,
			lexicalScore: result.score,
		});
	}

	return Array.from(entries.values())
		.map((entry) => {
			const recentInfo = recentBoostByPath.get(entry.result.path);
			const recentBoost = recentInfo?.boost ?? 0;
			// Recency only contributes when the note is already a genuine match.
			// When semantic results exist they are the relevance signal (a weak
			// lexical hit on common query words is noise), so require top-N
			// semantic rank; fall back to lexical rank only for lexical-only
			// queries. Gated-out notes keep their "recent" badge but no score lift.
			const recentEligible = hasSemanticSource
				? entry.semanticRank !== undefined && entry.semanticRank <= RECENT_BOOST_ELIGIBLE_RANK
				: entry.lexicalRank !== undefined && entry.lexicalRank <= RECENT_BOOST_ELIGIBLE_RANK;
			const effectiveRecentBoost = recentEligible ? recentBoost : 0;
			const recentStrength = effectiveRecentBoost > 0 ? effectiveRecentBoost / 4.5 : 0;
			const lexicalRrfScore = hasHybridSources ? getRankScore(entry.lexicalRank) : 0;
			const semanticRrfScore = hasHybridSources ? getRankScore(entry.semanticRank) : 0;
			const finalTitleBoost =
				shouldApplyQueryRescue && queryPlan
					? calculateTitleBoost(queryPlan, entry.result.name, titleRescueMax)
					: 0;
			const finalAliasBoost =
				shouldApplyQueryRescue && queryPlan
					? calculateAliasBoost(queryPlan, entry.result.frontmatter, aliasRescueMax)
					: 0;
			// Magnitude blend: normalize this note's semantic cosine against the
			// best in the set, scaled onto RRF's magnitude. A rank-1 strong match
			// gets the full term; a weak match at a nearby rank gets little.
			const normalizedSemantic =
				maxSemanticScore > 0 ? Math.max(0, entry.semanticScore ?? 0) / maxSemanticScore : 0;
			const semanticBlend = SEMANTIC_SCORE_BLEND_WEIGHT * normalizedSemantic * RRF_MAX_SUM;
			const sourceScore = hasHybridSources
				? (1 - SEMANTIC_SCORE_BLEND_WEIGHT) * (lexicalRrfScore + semanticRrfScore) + semanticBlend
				: getFallbackScore(
						entry.semanticScore ?? entry.lexicalScore,
						entry.semanticRank ?? entry.lexicalRank,
						totalResults,
					);
			const baseScore = sourceScore + finalTitleBoost + finalAliasBoost;
			const aliasMatchKind = queryPlan ? getAliasMatchKind(queryPlan, entry.result.frontmatter) : undefined;
			const recentAliasBonusWeight = getRecentAliasBonusWeight(aliasMatchKind);
			const recentAliasBonus =
				effectiveRecentBoost > 0 && recentAliasBonusWeight > 0
					? Math.min(
							baseScore * recentStrength * RECENT_ALIAS_SCORE_WEIGHT * recentAliasBonusWeight,
							baseScore * MAX_RECENT_ALIAS_SCORE_SHARE * recentAliasBonusWeight,
						)
					: 0;
			const finalScore = getRecentRerankScore(baseScore, effectiveRecentBoost) + recentAliasBonus;
			const originalRank = entry.lexicalRank ?? entry.semanticRank;

			return {
				...entry,
				baseScore,
				finalScore,
				originalRank,
				recentBoost,
				recentRank: recentInfo?.recentRank,
				lexicalRrfScore,
				semanticRrfScore,
				finalTitleBoost,
				finalAliasBoost,
				recentAliasBonus,
			};
		})
		.sort(
			(left, right) =>
				right.finalScore - left.finalScore ||
				(left.originalRank ?? Number.MAX_SAFE_INTEGER) - (right.originalRank ?? Number.MAX_SAFE_INTEGER),
		)
		.map(
			(
				{
					baseScore,
					finalAliasBoost,
					finalScore,
					finalTitleBoost,
					lexicalRrfScore,
					originalRank,
					recentAliasBonus,
					recentBoost,
					recentRank,
					result,
					semanticRrfScore,
					...entry
				},
				index,
			) => {
				const hasUnifiedDebug = Boolean(result.rankingDebug) || hasSemanticSource || recentBoost > 0;

				return {
					...result,
					matchBadges: recentBoost > 0 ? mergeBadges(result.matchBadges, ["recent"]) : result.matchBadges,
					score: finalScore,
					rankingDebug: hasUnifiedDebug
						? mergeRankingDebug(result.rankingDebug, {
								baseScore,
								originalRank,
								finalRank: index + 1,
								rerankScore: finalScore,
								finalScore,
								recentBoost: recentBoost > 0 ? recentBoost : undefined,
								recentRank,
								lexicalRank: entry.lexicalRank,
								semanticRank: entry.semanticRank,
								semanticScore: entry.semanticScore,
								lexicalRrfScore: lexicalRrfScore > 0 ? lexicalRrfScore : undefined,
								semanticRrfScore: semanticRrfScore > 0 ? semanticRrfScore : undefined,
								finalTitleBoost: finalTitleBoost > 0 ? finalTitleBoost : undefined,
								finalAliasBoost: finalAliasBoost > 0 ? finalAliasBoost : undefined,
								recentAliasBonus: recentAliasBonus > 0 ? recentAliasBonus : undefined,
							})
						: result.rankingDebug,
				};
			},
		);
}
