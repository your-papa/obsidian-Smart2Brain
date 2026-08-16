/**
 * Graded relevance judgments for the search ranking benchmark.
 *
 * Each entry pairs a natural-language query with graded expectations over the
 * generated corpus (`scripts/generate-search-corpus.ts`). Grades follow the usual
 * nDCG convention:
 *
 *   2 = highly relevant — this note answers the query
 *   1 = relevant        — related and reasonable to surface
 *   0 = irrelevant      — listed explicitly when it is a *distractor* we expect the
 *                         ranker to be tempted by, so a regression is legible
 *
 * The queries deliberately avoid the target note's own phrasing: the corpus states
 * each answer using a near-synonym, so term overlap alone cannot find it. Any note
 * not listed is treated as grade 0.
 */

export interface RelevanceJudgment {
	/** The query as a user would type it. */
	query: string;
	/** Vault-relative paths → grade. */
	grades: Record<string, 0 | 1 | 2>;
	/** What ranking behaviour this case is probing (shown in benchmark output). */
	probes: string;
	/**
	 * Notes to mark as recently opened before running this query, most-recent first.
	 *
	 * Recency is a real ranking input (`getRecentNotes` → `buildRecentBoostMap` →
	 * `rankSearchResults`), and it is the single largest source of untested behaviour:
	 * a recently-opened note receives a multiplicative lift of up to 1.6x. Cases that
	 * set this deliberately put recency *in conflict* with relevance.
	 *
	 * The harness clears the recent list before every query, so a case without this
	 * field runs with no recency signal at all.
	 */
	recentNotes?: string[];
	/**
	 * Set when the current ranker is known to fail this case.
	 *
	 * These are the cases that justify the ranking rework: they are measured, not
	 * hypothetical. The benchmark reports them separately rather than failing the
	 * suite, so the file records "what is still wrong" instead of going red on a
	 * known-open issue.
	 */
	knownFailure?: string;
}

const C = "Corpus";

export const RELEVANCE_JUDGMENTS: readonly RelevanceJudgment[] = [
	{
		query: "how much output do solar panels lose to wear at sea",
		probes: "near-synonym bridging (query 'solar panel' vs note 'photovoltaic array') against a lexical distractor that owns the words 'solar panel'",
		grades: {
			[`${C}/Marine Biology/photovoltaic-array-degradation.md`]: 2,
			[`${C}/Typography/solar-panel-metaphors-in-design.md`]: 0,
		},
	},
	{
		query: "can an octopus learn to open a sealed jar",
		probes: "distractor with identical query-term overlap ('octopus', 'open'); only meaning separates them",
		grades: {
			[`${C}/Marine Biology/cephalopod-problem-solving.md`]: 2,
			[`${C}/Fermentation/octopus-recipes.md`]: 0,
		},
	},
	{
		query: "how long before a rate change reaches borrowers",
		probes: "long multi-chunk target (~2400 words) vs a distractor using 'rate' and 'interest' in a non-monetary sense",
		grades: {
			[`${C}/Monetary Policy/policy-rate-transmission-lag.md`]: 2,
			[`${C}/Typography/interest-in-typography-history.md`]: 0,
		},
	},
	{
		query: "what makes very small text readable",
		probes: "zero lexical overlap with the target — semantic-only retrieval; distractor shares the phrase 'small sizes'",
		grades: {
			[`${C}/Typography/legibility-at-small-sizes.md`]: 2,
			[`${C}/Fermentation/small-sizes-of-fermentation-vessels.md`]: 0,
		},
	},
	{
		query: "when do prices rise so fast people stop using the local currency",
		probes: "very short note (~45 words) as the correct answer — length normalization must not bury it under long notes",
		grades: {
			[`${C}/Monetary Policy/hyperinflation-episodes.md`]: 2,
		},
	},
	{
		query: "how long does a wet sourdough starter take to double",
		probes: "multi-chunk target where the answer is repeated late in the note — aggregate vs best-chunk scoring",
		grades: {
			[`${C}/Fermentation/starter-hydration-and-rise.md`]: 2,
		},
	},
	{
		query: "Octopus Intelligence",
		probes: "alias match: the title does not contain these words, only the frontmatter alias does",
		grades: {
			[`${C}/Marine Biology/cephalopod-problem-solving.md`]: 2,
		},
	},
	{
		query: "Levain Timing",
		probes: "alias match on a long note, competing against its own domain's filler",
		grades: {
			[`${C}/Fermentation/starter-hydration-and-rise.md`]: 2,
		},
	},

	// ── recency vs relevance ────────────────────────────────────────────────
	// These cases drove the ranking rework. Recency used to be a multiplicative
	// lift gated by a hard top-10 *rank* cutoff, so whether a recently-opened note
	// could hijack a query depended on which side of an arbitrary line it landed.
	// It is now gated by *relative relevance*, capped, and attenuated when several
	// results are equally recent — keep these cases as the regression guard.

	{
		query: "can an octopus learn to open a sealed jar",
		probes: "recency vs relevance: the WRONG note (a recipe) is the most recently opened. It must not overtake the correct answer — the failure that motivated capping the recency lift.",
		recentNotes: [`${C}/Fermentation/octopus-recipes.md`],
		grades: {
			[`${C}/Marine Biology/cephalopod-problem-solving.md`]: 2,
			[`${C}/Fermentation/octopus-recipes.md`]: 0,
		},
	},
	{
		query: "what makes very small text readable",
		probes: "the same conflict with a distractor that is a much weaker match, so the relative-relevance gate suppresses its recency lift entirely",
		recentNotes: [`${C}/Fermentation/small-sizes-of-fermentation-vessels.md`],
		grades: {
			[`${C}/Typography/legibility-at-small-sizes.md`]: 2,
			[`${C}/Fermentation/small-sizes-of-fermentation-vessels.md`]: 0,
		},
	},
	{
		query: "how long does a wet sourdough starter take to double",
		probes: "recency piled onto near-duplicates: three sibling filler notes that already crowd this query are marked recent, testing whether the true answer survives a coordinated lift",
		recentNotes: [
			`${C}/Fermentation/sourdough-starter-maintenance-4.md`,
			`${C}/Fermentation/sourdough-starter-maintenance-3.md`,
			`${C}/Fermentation/sourdough-starter-maintenance-8.md`,
		],
		grades: {
			[`${C}/Fermentation/starter-hydration-and-rise.md`]: 2,
			// Graded explicitly so the recency lift they receive is actually scored:
			// these are generic maintenance notes, not the hydration/timing answer.
			[`${C}/Fermentation/sourdough-starter-maintenance-4.md`]: 0,
			[`${C}/Fermentation/sourdough-starter-maintenance-3.md`]: 0,
			[`${C}/Fermentation/sourdough-starter-maintenance-8.md`]: 0,
		},
	},
	{
		query: "Octopus Intelligence",
		probes: "recency must not override an exact alias match — the strongest possible identity signal",
		recentNotes: [`${C}/Fermentation/octopus-recipes.md`],
		grades: {
			[`${C}/Marine Biology/cephalopod-problem-solving.md`]: 2,
			[`${C}/Fermentation/octopus-recipes.md`]: 0,
		},
	},

	// ── multi-target queries ────────────────────────────────────────────────
	// Every case above has exactly one right answer, so nDCG only ever measures
	// "is the winner on top". These grade a whole result *set*, which is what
	// catches a ranker that finds the best note but orders the rest badly.

	{
		query: "smart city sensors and data platforms",
		probes: "multi-target: two notes are directly on point, several siblings are related. Measures the ordering of the whole set, not just rank 1.",
		grades: {
			"Topics/Smart Cities/IoT Sensors.md": 2,
			"Topics/Smart Cities/Urban Data Platforms.md": 2,
			"Topics/Smart Cities/Digital Twins.md": 1,
			"Topics/Smart Cities/Smart City Overview.md": 1,
			"Topics/Smart Cities/Smart Street Lighting.md": 1,
		},
	},
	{
		query: "how do cities cut energy use in buildings and street lighting",
		probes: "multi-target spanning two folders (Smart Cities + Renewable Energy) — a query no single note fully answers",
		grades: {
			"Topics/Smart Cities/Smart Buildings.md": 2,
			"Topics/Smart Cities/Smart Street Lighting.md": 2,
			"Topics/Renewable Energy/Energy Storage.md": 1,
			"Topics/Smart Cities/Smart City Overview.md": 1,
		},
	},

	// ── near-duplicate discrimination ───────────────────────────────────────
	// The corpus contains ~8 near-identical filler notes per subject. A ranker
	// that cannot tell the specific answer from its siblings still scores well on
	// single-target queries as long as the right note edges ahead; these make the
	// siblings explicitly wrong so crowding is penalised.

	{
		query: "what hydration level makes a starter rise fastest",
		probes: "the answer must beat ~8 sibling 'sourdough starter maintenance' notes that share nearly all vocabulary; siblings graded 0 so crowding costs score",
		grades: {
			[`${C}/Fermentation/starter-hydration-and-rise.md`]: 2,
			[`${C}/Fermentation/sourdough-starter-maintenance.md`]: 0,
			[`${C}/Fermentation/sourdough-starter-maintenance-2.md`]: 0,
			[`${C}/Fermentation/sourdough-starter-maintenance-3.md`]: 0,
			[`${C}/Fermentation/sourdough-starter-maintenance-4.md`]: 0,
		},
	},
	// ── length bias ─────────────────────────────────────────────────────────
	// Long notes are split into many chunks (a 66KB note yields ~33 vs ~3 for a
	// short one), so they get systematically more chances to appear in the
	// candidate set. Chunk-support aggregation must not turn that into score: a
	// long note whose sections are all mediocre should lose to a short note that
	// actually answers the query. Without a converging support term the 33-chunk
	// note was inflated from a 0.662 best chunk to 0.909 and won on length alone.

	{
		query: "at what monthly inflation rate do people switch to foreign currency",
		probes: "short single-chunk note (513 bytes) as the answer, against 66KB many-chunk notes that share economic vocabulary — pure length-bias probe",
		grades: {
			[`${C}/Monetary Policy/hyperinflation-episodes.md`]: 2,
			"Large Notes/Distributed Systems Deep Dive.md": 0,
			"Large Notes/Storage Engines and Indexing.md": 0,
		},
	},
	{
		query: "which borrowers feel a policy rate change first",
		probes: "the many-chunk note (17KB, ~20 chunks) is genuinely correct here — guards against over-correcting the length-bias fix into a penalty on long notes",
		grades: {
			[`${C}/Monetary Policy/policy-rate-transmission-lag.md`]: 2,
		},
	},
	{
		query: "why do offshore panels lose efficiency over the years",
		probes: "restates the solar case with no shared content words at all ('offshore panels' vs 'photovoltaic arrays', 'lose efficiency' vs 'lose rated output')",
		grades: {
			[`${C}/Marine Biology/photovoltaic-array-degradation.md`]: 2,
			[`${C}/Typography/solar-panel-metaphors-in-design.md`]: 0,
		},
	},
];

// ── metrics ──────────────────────────────────────────────────────────────────

/** Discounted cumulative gain over the ranked paths. */
function dcg(gains: number[]): number {
	return gains.reduce((sum, gain, i) => sum + (2 ** gain - 1) / Math.log2(i + 2), 0);
}

/**
 * nDCG@k for one query. Ideal ordering is the judged grades sorted descending,
 * so a query whose target the ranker misses entirely scores 0.
 */
export function ndcgAt(rankedPaths: string[], grades: Record<string, number>, k: number): number {
	const actual = rankedPaths.slice(0, k).map((p) => grades[p] ?? 0);
	const ideal = Object.values(grades)
		.filter((g) => g > 0)
		.sort((a, b) => b - a)
		.slice(0, k);
	const idealDcg = dcg(ideal);
	return idealDcg === 0 ? 0 : dcg(actual) / idealDcg;
}

/** Reciprocal rank of the first highly-relevant (grade 2) result; 0 if absent. */
export function reciprocalRank(rankedPaths: string[], grades: Record<string, number>): number {
	for (const [i, path] of rankedPaths.entries()) {
		if ((grades[path] ?? 0) === 2) return 1 / (i + 1);
	}
	return 0;
}
