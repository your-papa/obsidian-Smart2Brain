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

/**
 * Which job a case does.
 *
 * `core` cases are the regression guard: strong models score ~1.0 on all of them, so
 * any drop is a ranking defect. They carry the ratchet.
 *
 * `hard` cases exist to *discriminate between embedding models*. They are expected to
 * score below 1.0 even on a strong model — a case with no headroom cannot show that
 * one model is better than another. Averaging the two tiers together would destroy
 * both jobs at once: it would drag the regression baseline down to where it no longer
 * catches regressions, and hide model differences inside a mean dominated by
 * saturated cases. So they are reported and gated separately.
 *
 * `recency` cases re-run a `core` query with a *wrong* note marked recently-opened,
 * asserting that the recency lift cannot hijack the result (the recent note is always
 * graded 0). They are a separate tier because each one duplicates a `core` query
 * verbatim — same text, same grades — so folding them into the core mean silently
 * double-weights those four queries, making a single failure look like two. Keeping
 * them apart also means only this tier pays the recency-fixture setup cost.
 */
export type JudgmentTier = "core" | "hard" | "recency";

/** The difficulty axis a `hard` case probes; used to group benchmark output. */
export type HardAxis = "multi-hop" | "cross-lingual" | "long-context" | "dilution";

export interface RelevanceJudgment {
	/** The query as a user would type it. */
	query: string;
	/** Defaults to `core` when omitted, so existing cases keep their meaning. */
	tier?: JudgmentTier;
	/** Required for `hard` cases — which weakness this one exposes. */
	axis?: HardAxis;
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
		probes: "near-synonym bridging (query 'solar panel' vs note 'photovoltaic array') against two lexical distractors that own the words 'solar'/'panel'/'photovoltaic' without answering the wear/output-loss question",
		grades: {
			[`${C}/Marine Biology/photovoltaic-array-degradation.md`]: 2,
			[`${C}/Typography/solar-panel-metaphors-in-design.md`]: 0,
			// General PV overview; contains "solar" and "photovoltaic" but never
			// discusses degradation, wear, or output loss over time -- graded 0
			// explicitly so a lexical-title match on this note is scored as the
			// distractor it is, not an unrewarded correct answer.
			"Topics/Renewable Energy/Solar Photovoltaics.md": 0,
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
	//
	// Each one restates a `core` query with the adversarial condition switched on, so
	// the pair reads as an A/B: the core case measures the ranking, this one measures
	// whether recency can break it. The recent note is always graded 0 — a passing
	// score here means recency did NOT hijack the result, not that it helped.

	{
		query: "can an octopus learn to open a sealed jar",
		tier: "recency",
		probes: "recency vs relevance: the WRONG note (a recipe) is the most recently opened. It must not overtake the correct answer — the failure that motivated capping the recency lift.",
		recentNotes: [`${C}/Fermentation/octopus-recipes.md`],
		grades: {
			[`${C}/Marine Biology/cephalopod-problem-solving.md`]: 2,
			[`${C}/Fermentation/octopus-recipes.md`]: 0,
		},
	},
	{
		query: "what makes very small text readable",
		tier: "recency",
		probes: "the same conflict with a distractor that is a much weaker match, so the relative-relevance gate suppresses its recency lift entirely",
		recentNotes: [`${C}/Fermentation/small-sizes-of-fermentation-vessels.md`],
		grades: {
			[`${C}/Typography/legibility-at-small-sizes.md`]: 2,
			[`${C}/Fermentation/small-sizes-of-fermentation-vessels.md`]: 0,
		},
	},
	{
		query: "how long does a wet sourdough starter take to double",
		tier: "recency",
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
		tier: "recency",
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

	// ════════════════════════════════════════════════════════════════════════
	// HARD TIER — model discrimination, not regression guarding.
	//
	// Added to answer a specific question: is a small local embedding model
	// (bge-micro-v2, 22M params, 384 dims, English-distilled, 512-token window)
	// good enough to ship as a zero-setup default, and how much is given up
	// versus a 0.6B multilingual model?
	//
	// The core tier above cannot answer that — every strong model scores ~1.0
	// on it, so it has no resolving power between candidates. These cases are
	// built to have headroom along the four axes where a small distilled
	// encoder is expected to lose ground. Sub-1.0 scores here are the normal,
	// intended state, NOT failures to fix.
	// ════════════════════════════════════════════════════════════════════════

	// ── multi-hop ───────────────────────────────────────────────────────────
	// The query describes a situation; answering means joining two facts held in
	// different sections (so no single chunk contains both).

	{
		query: "why would a vent community die off when the plumbing shifts",
		tier: "hard",
		axis: "multi-hop",
		probes: "two-fact join: energy source (sulfide, not surface fall) + flow reroute drops sulfide. Neither section alone answers it; sibling vent notes discuss vents generally.",
		grades: {
			[`${C}/Marine Biology/vent-chemosynthesis-energy-budget.md`]: 2,
			[`${C}/Marine Biology/deep-sea-hydrothermal-vents.md`]: 0,
			[`${C}/Marine Biology/deep-sea-hydrothermal-vents-2.md`]: 0,
		},
	},
	{
		query: "what makes overnight funding costs spike suddenly",
		tier: "hard",
		axis: "multi-hop",
		probes: "two-fact join: reserves below intraday need + settlement clustering in the last hour. 'repo market' filler siblings share the vocabulary without the causal chain.",
		grades: {
			[`${C}/Monetary Policy/reserve-scarcity-and-repo-spikes.md`]: 2,
			[`${C}/Monetary Policy/reserve-requirements.md`]: 0,
			[`${C}/Monetary Policy/open-market-operations.md`]: 0,
		},
	},

	// ── cross-lingual ───────────────────────────────────────────────────────
	// The axis most likely to disqualify an English-distilled model outright.
	// The notes are monolingual German (filler vocabulary included), so there is
	// no English text in them to match on.

	{
		query: "how does heavy rainfall runoff affect how far larvae drift",
		tier: "hard",
		axis: "cross-lingual",
		probes: "English query → monolingual German note. An English-only encoder has nothing to match; a multilingual one should place this at rank 1.",
		grades: {
			[`${C}/Marine Biology/salzgehalt-und-larvenwanderung.md`]: 2,
		},
	},
	{
		query: "keeping a sourdough starter active in a cold kitchen",
		tier: "hard",
		axis: "cross-lingual",
		probes: "English query → German note, competing against ~8 English sourdough-maintenance siblings that are lexically closer to the query.",
		grades: {
			[`${C}/Fermentation/sauerteig-fuehrung-im-winter.md`]: 2,
			[`${C}/Fermentation/sourdough-starter-maintenance.md`]: 0,
			[`${C}/Fermentation/sourdough-starter-maintenance-2.md`]: 0,
		},
	},
	{
		query: "wie werden Achsen in variablen Schriften genormt",
		tier: "hard",
		axis: "cross-lingual",
		probes: "reverse direction: German query → English note. Catches a model that handles German input but cannot align it to English content.",
		grades: {
			[`${C}/Typography/variable-font-axis-registration.md`]: 2,
			[`${C}/Typography/variable-font-axes.md`]: 1,
		},
	},

	// ── long-context ────────────────────────────────────────────────────────
	// The answer sits ~900-1100 words into a single heading-free section. The
	// chunker splits on every heading level H1-H6, so only unstructured prose
	// produces a chunk large enough to exceed a 512-token window. A model with a
	// short ceiling sees a truncated chunk that omits the answer entirely.

	{
		query: "why steam rice instead of boiling it for koji",
		tier: "hard",
		axis: "long-context",
		probes: "answer buried ~918 words into one unbroken section — past a 512-token window. Directly probes truncation on small encoders.",
		grades: {
			[`${C}/Fermentation/koji-substrate-preparation.md`]: 2,
			[`${C}/Fermentation/koji-cultivation.md`]: 1,
		},
	},
	{
		query: "when does an inverted curve stop predicting a downturn",
		tier: "hard",
		axis: "long-context",
		probes: "answer buried ~1107 words deep; sibling 'Yield Curve Inversion' notes are on-topic but do not contain the qualifier about negative term premia.",
		grades: {
			[`${C}/Monetary Policy/yield-curve-signal-decay.md`]: 2,
			[`${C}/Monetary Policy/yield-curve-inversion.md`]: 1,
		},
	},

	// ── dilution ────────────────────────────────────────────────────────────
	// Reproduces the measured multi-topic signal collapse: the note-level
	// embedding averages over six unrelated admin topics plus one real answer,
	// so the answer's contribution to the note vector is heavily attenuated.

	{
		query: "does survey timing change the herbivore counts",
		tier: "hard",
		axis: "dilution",
		probes: "answer is one section inside a six-topic logistics note (permits, boats, cameras, training...). Note-level similarity is diluted; only chunk-level retrieval recovers it.",
		grades: {
			[`${C}/Marine Biology/reef-survey-field-notes.md`]: 2,
		},
	},
	{
		query: "can hinting be shared between a regular and a condensed cut",
		tier: "hard",
		axis: "dilution",
		probes: "same shape in another domain, competing against dedicated 'Hinting and Rasterization' notes that are topically closer but do not answer the reuse question.",
		grades: {
			[`${C}/Typography/foundry-operations-log.md`]: 2,
			[`${C}/Typography/hinting-and-rasterization.md`]: 1,
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
