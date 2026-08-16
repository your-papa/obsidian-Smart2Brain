import { calculateAliasBoost, calculateTitleBoost, getAliasMatchKind, type AliasMatchKind } from "./searchRanking";
import { createQueryPlan } from "./queryPlan";
import { getRecentRerankScore, type RecentBoostInfo } from "./recentNotes";
import type { SearchMatchBadge, SearchRankingDebug, SearchResult } from "../vectorstore/types";

/*
 * Hybrid fusion ranking.
 *
 * Design rule: every signal is normalized *within the current result set*. No
 * constant is ever compared against a raw BM25 magnitude or a raw cosine, and
 * there are no hard rank cutoffs — so the algorithm behaves the same shape on a
 * 40-note vault as on a 40,000-note one, and across embedding models whose score
 * distributions differ wildly.
 *
 * This replaced a stack of hand-calibrated constants tuned against a small
 * fixture vault. Two gaps that rework fixed, both measured on the graded
 * relevance benchmark (`integration/search-relevance-benchmark.test.ts`):
 *
 *   1. Recency eligibility was a hard *rank* cutoff (top 10), so a strong match
 *      at rank 11 was gated while a weak one at rank 10 was not — whether a
 *      recently-opened note could hijack a query depended on which side of an
 *      arbitrary line it fell. It is now a *relative score* threshold.
 *   2. The semantic magnitude contribution was a fixed share bolted onto RRF.
 *      Score magnitude is now a first-class fusion input via per-source
 *      normalization, with RRF retained only as a rank-stability term.
 */

/**
 * RRF damping constant. Retained as a *stability* term: rank-based scoring is
 * robust when one source's magnitudes are degenerate (e.g. every BM25 hit tied),
 * which pure score normalization handles badly.
 */
const FUSION_RRF_K = 60;

/**
 * Split between normalized-score fusion and rank-based RRF. Score carries the
 * relevance signal; rank guards against degenerate score distributions.
 */
const SCORE_FUSION_WEIGHT = 0.7;
const RANK_FUSION_WEIGHT = 1 - SCORE_FUSION_WEIGHT;

/**
 * Relative weight of the semantic vs lexical source once both are normalized to
 * 0-1. Semantic leads because it is the only source that can bridge vocabulary
 * gaps; lexical remains a strong tiebreaker and the sole signal for exact terms.
 */
const SEMANTIC_SOURCE_WEIGHT = 0.6;
const LEXICAL_SOURCE_WEIGHT = 1 - SEMANTIC_SOURCE_WEIGHT;

/** Identity boosts, as a fraction of the (0-1) fused score. */
const FUSION_TITLE_BOOST_MAX = 0.18;
const FUSION_ALIAS_BOOST_MAX = 0.17;
const SEMANTIC_ONLY_TITLE_BOOST_MAX = 0.3;
const SEMANTIC_ONLY_ALIAS_BOOST_MAX = 0.3;
const RECENT_ALIAS_SCORE_WEIGHT = 1.2;
const MAX_RECENT_ALIAS_SCORE_SHARE = 0.15;

/**
 * A note only receives the recency boost when it is already a genuine match —
 * its fused relevance must be within this fraction of the best result in the
 * set. Replaces the old top-10 rank cutoff, which produced an arbitrary cliff:
 * relevance, not position, now decides eligibility, and the test scales with
 * vault size and embedding model because it is purely relative.
 *
 * Measured motivation: with the rank gate, opening a *recipe* note made it
 * outrank the correct answer for "can an octopus learn to open a sealed jar",
 * because the correct note led by only 2.8% while recency multiplied by up to
 * 1.6x. Notes below the threshold keep their "recent" badge but gain no score.
 */
const RECENT_RELATIVE_ELIGIBILITY = 0.8;

/**
 * How much recency may lift a note, expressed as a multiple of the *typical gap
 * between adjacent results in this query's own result set*.
 *
 * Recency is a tiebreaker among comparably relevant notes, not a way to overturn
 * relevance. "Comparable" only means something relative to how tightly the set is
 * packed: in a dense semantic result set, adjacent notes sit ~1% apart and a 12%
 * deficit is a chasm; in a sparse two-result lexical set, adjacent notes sit ~10%
 * apart and the same 12% is a near-tie. A fixed percentage cannot express that —
 * it is the reason the previous constant (0.15) was tuned to one embedding model
 * and broke on another.
 *
 * Measured typical gaps: harrier-oss semantic 0.7%, qwen3-8b semantic 0.9%,
 * two-result lexical 10-16%. Required outcomes are satisfied for any multiplier
 * from 1.5 to 3.0; 2 sits in the middle of that window.
 *
 * This is the ceiling for a *lone* recent note; when several eligible results are
 * recent, `recentCrowdingFactor` attenuates it further.
 */
const RECENT_LIFT_GAP_MULTIPLIER = 2;

/**
 * Absolute floor and ceiling on the adaptive cap, guarding the degenerate ends.
 *
 * A result set with identical scores has a typical gap of zero, which would
 * disable recency entirely; a set with one huge outlier could otherwise licence a
 * lift big enough to overturn genuine relevance.
 */
const MIN_RECENT_LIFT = 0.02;
const MAX_RECENT_LIFT = 0.3;

/**
 * How much of the weakest score to subtract when normalizing a source onto 0-1.
 *
 * 0 = divide-by-max: preserves ratios exactly, so a 10-vs-9 near-tie stays a
 * near-tie (1.0 vs 0.9) and identity/recency terms can still reorder it. Its
 * weakness is narrow bands — cosines clustered in 0.40-0.55 all land near 1.0.
 * 1 = full min-max: maximum contrast, but stretches *any* spread to fill 0-1, so
 * on small sets a trivial gap becomes a blowout that no bounded term can close.
 *
 * Kept low deliberately: preserving true proportions is what lets the identity
 * and recency signals do their job, and the rank-fusion term (RRF) already
 * supplies contrast when magnitudes are bunched. A high share re-introduces the
 * failure this rework exists to remove — scores that look decisive because of
 * how few results there were, not because of how different they are.
 */
const NORMALIZATION_FLOOR_SHARE = 0.15;

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
	// Identity boosts apply to any keyword query, including lexical-only ones.
	// They used to require a semantic source, which left an exact alias match on a
	// lexical-only query with no credit at all — the old code papered over that
	// with an outsized recency-alias bonus, coupling two unrelated signals. Title
	// and alias matches are evidence of relevance regardless of which retriever
	// found the note.
	const shouldApplyQueryRescue = Boolean(queryPlan);
	const titleRescueMax = hasHybridSources
		? FUSION_TITLE_BOOST_MAX
		: hasSemanticSource
			? SEMANTIC_ONLY_TITLE_BOOST_MAX
			: FUSION_TITLE_BOOST_MAX;
	const aliasRescueMax = hasHybridSources
		? FUSION_ALIAS_BOOST_MAX
		: hasSemanticSource
			? SEMANTIC_ONLY_ALIAS_BOOST_MAX
			: FUSION_ALIAS_BOOST_MAX;
	const totalResults = Math.max(lexicalResults.length, semanticResults.length);

	// Per-source normalization onto 0-1 *within this result set*. This is what
	// makes BM25 magnitudes and cosines comparable without any per-model constant.
	//
	// Deliberately NOT min-max. Min-max maps the worst result to 0 and the best to
	// 1 regardless of how close they actually are, so a set of two near-identical
	// scores (BM25 10 vs 9) is stretched into a total blowout — the tail's score
	// becomes absorbing, and every proportional term downstream (identity boosts,
	// the recency cap) multiplies to nothing against it.
	//
	// Instead the floor is pulled toward zero by NORMALIZATION_FLOOR_SHARE, so the
	// mapping preserves *relative* differences: scores 10 and 9 stay close (1.0 vs
	// ~0.93), while a genuine gap (0.9 vs 0.1) stays wide. Divide-by-max alone
	// would be the degenerate case of this (share = 1) and compresses narrow cosine
	// bands too much; a partial share keeps ranking signal in both regimes.
	const normalizer = (results: SearchResult[]) => {
		const scores = results.map((r) => r.score ?? 0);
		const max = scores.length > 0 ? Math.max(...scores) : 0;
		const min = scores.length > 0 ? Math.min(...scores) : 0;
		const floor = Math.max(0, min) * NORMALIZATION_FLOOR_SHARE;
		const range = max - floor;
		return (score: number | undefined): number => {
			if (score === undefined) return 0;
			// All scores identical (or a single result): magnitude carries no
			// information, so treat every hit as a full match and let rank decide.
			if (range <= 0) return max > 0 ? 1 : 0;
			return Math.min(1, Math.max(0, (score - floor) / range));
		};
	};
	const normalizeLexical = normalizer(lexicalResults);
	const normalizeSemantic = normalizer(semanticResults);

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

	// Pass 1: relevance only. Recency is deliberately excluded here so the
	// eligibility threshold below is measured against pure relevance — otherwise a
	// cluster of recent notes would raise the bar they are themselves judged by.
	const scored = Array.from(entries.values()).map((entry) => {
		const normalizedLexical = normalizeLexical(entry.lexicalScore);
		const normalizedSemantic = normalizeSemantic(entry.semanticScore);

		const lexicalRrfScore = hasHybridSources ? getRankScore(entry.lexicalRank) : 0;
		const semanticRrfScore = hasHybridSources ? getRankScore(entry.semanticRank) : 0;

		let sourceScore: number;
		if (hasHybridSources) {
			// Weighted normalized scores, plus a rank term for stability. Both parts
			// are already 0-1, so the fused score is 0-1 and the identity boosts
			// below are meaningful fractions rather than magnitude-specific nudges.
			const scorePart = SEMANTIC_SOURCE_WEIGHT * normalizedSemantic + LEXICAL_SOURCE_WEIGHT * normalizedLexical;
			// Normalize the RRF sum by its own maximum (both sources at rank 1) so it
			// too lands on 0-1 and the split below is a true proportion.
			const rankPart = (lexicalRrfScore + semanticRrfScore) / (2 / (FUSION_RRF_K + 1));
			sourceScore = SCORE_FUSION_WEIGHT * scorePart + RANK_FUSION_WEIGHT * Math.min(1, rankPart);
		} else if (hasSemanticSource || hasLexicalSource) {
			// Single source: its normalized score already spans 0-1.
			sourceScore = hasSemanticSource ? normalizedSemantic : normalizedLexical;
		} else {
			sourceScore = getFallbackScore(
				entry.semanticScore ?? entry.lexicalScore,
				entry.semanticRank ?? entry.lexicalRank,
				totalResults,
			);
		}

		const finalTitleBoost =
			shouldApplyQueryRescue && queryPlan ? calculateTitleBoost(queryPlan, entry.result.name, titleRescueMax) : 0;
		const finalAliasBoost =
			shouldApplyQueryRescue && queryPlan
				? calculateAliasBoost(queryPlan, entry.result.frontmatter, aliasRescueMax)
				: 0;

		const baseScore = sourceScore + finalTitleBoost + finalAliasBoost;

		return {
			...entry,
			baseScore,
			normalizedLexical,
			normalizedSemantic,
			lexicalRrfScore,
			semanticRrfScore,
			finalTitleBoost,
			finalAliasBoost,
			originalRank: entry.lexicalRank ?? entry.semanticRank,
		};
	});

	// Relative-score recency gate: eligibility is "is this note nearly as relevant
	// as the best answer", not "did it land in the top N".
	//
	// The ratio is taken on each source's *raw* scale, not the normalized one.
	// Normalization is a within-set rescaling tuned for fusion, and on small result
	// sets it deliberately stretches whatever spread exists to fill 0-1 — so two
	// nearly-tied BM25 hits (308 vs 260, a genuine 84% near-tie) would look like a
	// blowout and be gated apart. Raw ratios answer the question the gate actually
	// asks: is this note about as good a match as the winner?
	const bestRawSemantic = semanticResults.reduce((max, r) => Math.max(max, r.score ?? 0), 0);
	const bestRawLexical = lexicalResults.reduce((max, r) => Math.max(max, r.score ?? 0), 0);

	// Recency is a signal for distinguishing a note from its *non-recent* rivals.
	// When several eligible results are all recently opened, recency says nothing
	// about which of them the user wants — it is common to all of them — so
	// applying it just amplifies whatever noise separates them, and a cluster of
	// recently-opened near-duplicates can march past a better answer. (Measured:
	// three recent siblings pushed the correct note from rank 1 to rank 4.)
	//
	// Adaptive lift ceiling: scale recency to how tightly *this* result set is
	// packed. The median adjacent gap is used rather than the mean so a single
	// outlier (one very strong match, or a long tail of near-zeroes) cannot skew
	// the scale. Measured on base scores, which are already normalized to 0-1.
	const orderedBaseScores = scored.map((entry) => entry.baseScore).sort((a, b) => b - a);
	const adjacentGaps: number[] = [];
	const topBaseScore = orderedBaseScores[0] ?? 0;
	if (topBaseScore > 0) {
		for (let i = 1; i < orderedBaseScores.length; i++) {
			adjacentGaps.push((orderedBaseScores[i - 1] - orderedBaseScores[i]) / topBaseScore);
		}
	}
	const typicalGap =
		adjacentGaps.length > 0 ? adjacentGaps.sort((a, b) => a - b)[Math.floor(adjacentGaps.length / 2)] : 0;
	const adaptiveRecentLift = Math.min(
		MAX_RECENT_LIFT,
		Math.max(MIN_RECENT_LIFT, RECENT_LIFT_GAP_MULTIPLIER * typicalGap),
	);
	const rawRelativeRelevance = (entry: (typeof scored)[number]): number => {
		// Prefer the semantic view when available: it is the source that actually
		// measures meaning. Fall back to lexical for lexical-only queries.
		if (hasSemanticSource && entry.semanticScore !== undefined && bestRawSemantic > 0) {
			return Math.max(0, entry.semanticScore) / bestRawSemantic;
		}
		if (entry.lexicalScore !== undefined && bestRawLexical > 0) {
			return Math.max(0, entry.lexicalScore) / bestRawLexical;
		}
		// Present in neither source's score list (rank-only entry): not a strong
		// enough match to earn a recency lift.
		return 0;
	};

	// Attenuate quadratically in the number of recent contenders: each rival both
	// dilutes the signal (1/n, it no longer identifies a single note) and raises
	// the bar for acting on it (1/n again, since promoting one of n interchangeable
	// notes is n times more likely to be wrong). A lone recent note in a field of
	// stale ones keeps full strength.
	//
	// Only *eligible* notes count. A recently-opened note that failed the relevance
	// gate receives no lift at all, so it is not competing for the tiebreaker and
	// must not dilute it — otherwise opening a few irrelevant notes would silently
	// suppress recency for the one note it should actually help.
	const recentContenders = scored.filter(
		(entry) =>
			(recentBoostByPath.get(entry.result.path)?.boost ?? 0) > 0 &&
			rawRelativeRelevance(entry) >= RECENT_RELATIVE_ELIGIBILITY,
	).length;
	const recentCrowdingFactor = recentContenders > 0 ? 1 / recentContenders ** 2 : 1;

	return scored
		.map((entry) => {
			const recentInfo = recentBoostByPath.get(entry.result.path);
			const recentBoost = recentInfo?.boost ?? 0;
			const relativeRelevance = rawRelativeRelevance(entry);
			const recentEligible = relativeRelevance >= RECENT_RELATIVE_ELIGIBILITY;
			const effectiveRecentBoost = recentEligible ? recentBoost : 0;
			const recentStrength = effectiveRecentBoost > 0 ? effectiveRecentBoost / 4.5 : 0;

			const aliasMatchKind = queryPlan ? getAliasMatchKind(queryPlan, entry.result.frontmatter) : undefined;
			const recentAliasBonusWeight = getRecentAliasBonusWeight(aliasMatchKind);
			const recentAliasBonus =
				effectiveRecentBoost > 0 && recentAliasBonusWeight > 0
					? Math.min(
							entry.baseScore * recentStrength * RECENT_ALIAS_SCORE_WEIGHT * recentAliasBonusWeight,
							entry.baseScore * MAX_RECENT_ALIAS_SCORE_SHARE * recentAliasBonusWeight,
						)
					: 0;

			// Cap the total recency contribution, then attenuate for crowding. Without
			// the cap, three recently-opened near-duplicates displaced the correct
			// answer from rank 1 to rank 4: recency was multiplicative and effectively
			// unbounded relative to the gaps it competed against.
			const uncappedLift =
				getRecentRerankScore(entry.baseScore, effectiveRecentBoost) - entry.baseScore + recentAliasBonus;
			const recentLift = Math.min(uncappedLift, entry.baseScore * adaptiveRecentLift) * recentCrowdingFactor;
			const finalScore = entry.baseScore + recentLift;

			return {
				...entry,
				finalScore,
				recentBoost,
				recentRank: recentInfo?.recentRank,
				recentAliasBonus,
				relativeRelevance,
				recentGated: recentBoost > 0 && !recentEligible,
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
					normalizedLexical,
					normalizedSemantic,
					originalRank,
					recentAliasBonus,
					recentBoost,
					recentGated,
					recentRank,
					relativeRelevance,
					result,
					semanticRrfScore,
					...entry
				},
				index,
			) => {
				// Identity boosts now apply to lexical-only queries too, so debug must
				// be emitted for them — otherwise a boost that changed the ordering
				// would be invisible to the search-debug UI and to tests.
				const hasUnifiedDebug =
					Boolean(result.rankingDebug) ||
					hasSemanticSource ||
					recentBoost > 0 ||
					finalTitleBoost > 0 ||
					finalAliasBoost > 0;

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
								recentGated: recentGated ? true : undefined,
								adaptiveRecentLift,
								relativeRelevance,
								lexicalRank: entry.lexicalRank,
								semanticRank: entry.semanticRank,
								semanticScore: entry.semanticScore,
								normalizedLexical: normalizedLexical > 0 ? normalizedLexical : undefined,
								normalizedSemantic: normalizedSemantic > 0 ? normalizedSemantic : undefined,
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
