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
export type HardAxis =
	| "multi-hop"
	| "cross-lingual"
	| "long-context"
	| "dilution"
	| "size-bias"
	| "polysemy"
	| "intent-frame"
	| "provenance";

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
			[`${C}/Marine Biology/Photovoltaic Array Degradation Offshore.md`]: 2,
			[`${C}/Typography/Solar Panel Metaphors in Signage Design.md`]: 0,
			// General PV overview; contains "solar" and "photovoltaic" but never
			// discusses degradation, wear, or output loss over time -- graded 0
			// explicitly so a lexical-title match on this note is scored as the
			// distractor it is, not an unrewarded correct answer.
			"Zettel/Solar Photovoltaics.md": 0,
		},
	},
	{
		query: "can an octopus learn to open a sealed jar",
		probes: "distractor with identical query-term overlap ('octopus', 'open'); only meaning separates them",
		grades: {
			[`${C}/Marine Biology/Cephalopod Problem Solving.md`]: 2,
			[`${C}/Fermentation/Fermented Octopus Preparations.md`]: 0,
		},
	},
	{
		query: "how long before a rate change reaches borrowers",
		probes: "long multi-chunk target (~2400 words) vs a distractor using 'rate' and 'interest' in a non-monetary sense",
		grades: {
			[`${C}/Monetary Policy/Policy Rate Transmission Lag.md`]: 2,
			[`${C}/Typography/Interest and Rates of Change in Type History.md`]: 0,
		},
	},
	{
		query: "what makes very small text readable",
		probes: "zero lexical overlap with the target — semantic-only retrieval; distractor shares the phrase 'small sizes'",
		grades: {
			[`${C}/Typography/Legibility at Small Sizes.md`]: 2,
			[`${C}/Fermentation/Small Sizes of Fermentation Vessels.md`]: 0,
		},
	},
	{
		query: "when do prices rise so fast people stop using the local currency",
		probes: "very short note (~45 words) as the correct answer — length normalization must not bury it under long notes",
		grades: {
			[`${C}/Monetary Policy/Hyperinflation Episodes.md`]: 2,
		},
	},
	{
		query: "how long does a wet sourdough starter take to double",
		probes: "multi-chunk target where the answer is repeated late in the note — aggregate vs best-chunk scoring",
		grades: {
			[`${C}/Fermentation/Starter Hydration and Rise Time.md`]: 2,
		},
	},
	{
		query: "Octopus Intelligence",
		probes: "alias match: the title does not contain these words, only the frontmatter alias does",
		grades: {
			[`${C}/Marine Biology/Cephalopod Problem Solving.md`]: 2,
		},
	},
	{
		query: "Levain Timing",
		probes: "alias match on a long note, competing against its own domain's filler",
		grades: {
			[`${C}/Fermentation/Starter Hydration and Rise Time.md`]: 2,
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
		recentNotes: [`${C}/Fermentation/Fermented Octopus Preparations.md`],
		grades: {
			[`${C}/Marine Biology/Cephalopod Problem Solving.md`]: 2,
			[`${C}/Fermentation/Fermented Octopus Preparations.md`]: 0,
		},
	},
	{
		query: "what makes very small text readable",
		tier: "recency",
		probes: "the same conflict with a distractor that is a much weaker match, so the relative-relevance gate suppresses its recency lift entirely",
		recentNotes: [`${C}/Fermentation/Small Sizes of Fermentation Vessels.md`],
		grades: {
			[`${C}/Typography/Legibility at Small Sizes.md`]: 2,
			[`${C}/Fermentation/Small Sizes of Fermentation Vessels.md`]: 0,
		},
	},
	{
		query: "how long does a wet sourdough starter take to double",
		tier: "recency",
		probes: "recency piled onto near-duplicates: three sibling filler notes that already crowd this query are marked recent, testing whether the true answer survives a coordinated lift",
		recentNotes: [
			`${C}/Fermentation/Fridge Storage Between Bakes.md`,
			`${C}/Fermentation/Reviving a Neglected Culture.md`,
			`${C}/Fermentation/Travel and Long Dormancy Handling.md`,
		],
		grades: {
			[`${C}/Fermentation/Starter Hydration and Rise Time.md`]: 2,
			// Graded explicitly so the recency lift they receive is actually scored:
			// these are generic maintenance notes, not the hydration/timing answer.
			[`${C}/Fermentation/Fridge Storage Between Bakes.md`]: 0,
			[`${C}/Fermentation/Reviving a Neglected Culture.md`]: 0,
			[`${C}/Fermentation/Travel and Long Dormancy Handling.md`]: 0,
		},
	},
	{
		query: "Octopus Intelligence",
		tier: "recency",
		probes: "recency must not override an exact alias match — the strongest possible identity signal",
		recentNotes: [`${C}/Fermentation/Fermented Octopus Preparations.md`],
		grades: {
			[`${C}/Marine Biology/Cephalopod Problem Solving.md`]: 2,
			[`${C}/Fermentation/Fermented Octopus Preparations.md`]: 0,
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
			"Zettel/IoT Sensors.md": 2,
			"Zettel/Urban Data Platforms.md": 2,
			"Zettel/Digital Twins.md": 1,
			"Zettel/Smart City Overview.md": 1,
			"Zettel/Smart Street Lighting.md": 1,
		},
	},
	{
		query: "how do cities cut energy use in buildings and street lighting",
		probes: "multi-target spanning two folders (Smart Cities + Renewable Energy) — a query no single note fully answers",
		grades: {
			"Zettel/Smart Buildings.md": 2,
			"Zettel/Smart Street Lighting.md": 2,
			"Zettel/Energy Storage.md": 1,
			"Zettel/Smart City Overview.md": 1,
		},
	},

	// ── near-duplicate discrimination ───────────────────────────────────────
	// The corpus contains ~8 near-identical filler notes per subject. A ranker
	// that cannot tell the specific answer from its siblings still scores well on
	// single-target queries as long as the right note edges ahead; these make the
	// siblings explicitly wrong so crowding is penalised.

	{
		query: "what hydration level makes a starter rise fastest",
		probes: "the answer must beat ~8 starter-maintenance sibling notes that share nearly all vocabulary; siblings graded 0 so crowding costs score. Since the filler gained real titles ('Refresh Ratios for Daily Baking', 'Reviving a Neglected Culture'), the siblings no longer share a title stem — the crowding is now purely lexical overlap, which is the harder and more realistic version.",
		grades: {
			[`${C}/Fermentation/Starter Hydration and Rise Time.md`]: 2,
			[`${C}/Fermentation/Sourdough Starter Maintenance.md`]: 0,
			[`${C}/Fermentation/Refresh Ratios for Daily Baking.md`]: 0,
			[`${C}/Fermentation/Reviving a Neglected Culture.md`]: 0,
			[`${C}/Fermentation/Fridge Storage Between Bakes.md`]: 0,
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
			[`${C}/Monetary Policy/Hyperinflation Episodes.md`]: 2,
			"Zettel/Distributed Systems Deep Dive.md": 0,
			"Zettel/Storage Engines and Indexing.md": 0,
		},
	},
	{
		query: "which borrowers feel a policy rate change first",
		probes: "the many-chunk note (17KB, ~20 chunks) is genuinely correct here — guards against over-correcting the length-bias fix into a penalty on long notes",
		grades: {
			[`${C}/Monetary Policy/Policy Rate Transmission Lag.md`]: 2,
		},
	},
	{
		query: "why do offshore panels lose efficiency over the years",
		probes: "restates the solar case with no shared content words at all ('offshore panels' vs 'photovoltaic arrays', 'lose efficiency' vs 'lose rated output')",
		grades: {
			[`${C}/Marine Biology/Photovoltaic Array Degradation Offshore.md`]: 2,
			[`${C}/Typography/Solar Panel Metaphors in Signage Design.md`]: 0,
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
			[`${C}/Marine Biology/Vent Chemosynthesis Energy Budget.md`]: 2,
			[`${C}/Marine Biology/Deep Sea Hydrothermal Vents.md`]: 0,
			[`${C}/Marine Biology/Chimney Formation and Mineral Deposition.md`]: 0,
		},
	},
	{
		query: "what makes overnight funding costs spike suddenly",
		tier: "hard",
		axis: "multi-hop",
		probes: "two-fact join: reserves below intraday need + settlement clustering in the last hour. 'repo market' filler siblings share the vocabulary without the causal chain.",
		grades: {
			[`${C}/Monetary Policy/Reserve Scarcity and Repo Spikes.md`]: 2,
			[`${C}/Monetary Policy/Reserve Requirements.md`]: 0,
			[`${C}/Monetary Policy/Open Market Operations.md`]: 0,
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
			[`${C}/Marine Biology/Salzgehalt und Larvenwanderung.md`]: 2,
		},
	},
	{
		query: "keeping a sourdough starter active in a cold kitchen",
		tier: "hard",
		axis: "cross-lingual",
		probes: "English query → German note, competing against ~8 English sourdough-maintenance siblings that are lexically closer to the query.",
		grades: {
			[`${C}/Fermentation/Sauerteigführung im Winter.md`]: 2,
			[`${C}/Fermentation/Sourdough Starter Maintenance.md`]: 0,
			[`${C}/Fermentation/Refresh Ratios for Daily Baking.md`]: 0,
		},
	},
	{
		query: "wie werden Achsen in variablen Schriften genormt",
		tier: "hard",
		axis: "cross-lingual",
		probes: "reverse direction: German query → English note. Catches a model that handles German input but cannot align it to English content.",
		grades: {
			[`${C}/Typography/Variable Font Axis Registration.md`]: 2,
			[`${C}/Typography/Variable Font Axes.md`]: 1,
		},
	},
	{
		query: "griechischer salat",
		tier: "hard",
		axis: "cross-lingual",
		knownFailure:
			"German `salat` prefix-matches English `salt`, and the three winning notes carry 'Salt' in their TITLE, so they collect calculateTitleBoost on top of the term match. The right answer has no title match at all — 'Greek Salad (Horiatiki)' is an H2 inside the note — so it competes on content score alone and lands at rank 4. Measured hybrid: Salt Tolerance Across Species / Salt Type and Mineral Content / Salt Percentage and Aging Duration, then the recipe note. The English 'greek salad' returns it at rank 1, which isolates the cause to the false cognate rather than to retrieval.",
		probes: "false-cognate prefix match: a two-word German query whose second token is a prefix of an unrelated English word that several filler notes own in their titles. Prefix matching is deliberate here (`prefix: shouldContentPrefixMatch`, `weights.prefix = 0.3`), so this is not a switch to flip — it measures whether the semantic half can recover a query the lexical half actively misdirects.",
		grades: {
			"Zettel/Cooking Mediterranean Recipes.md": 2,
			// Honest fermentation notes about salt concentration. Nothing about salad,
			// and nothing in them declares that — the collision is purely orthographic.
			[`${C}/Fermentation/Salt Tolerance Across Species.md`]: 0,
			[`${C}/Fermentation/Salt Type and Mineral Content.md`]: 0,
			[`${C}/Fermentation/Salt Percentage and Aging Duration.md`]: 0,
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
			[`${C}/Fermentation/Koji Substrate Preparation.md`]: 2,
			[`${C}/Fermentation/Koji Cultivation.md`]: 1,
		},
	},
	{
		query: "when does an inverted curve stop predicting a downturn",
		tier: "hard",
		axis: "long-context",
		probes: "answer buried ~1107 words deep; sibling 'Yield Curve Inversion' notes are on-topic but do not contain the qualifier about negative term premia.",
		grades: {
			[`${C}/Monetary Policy/Yield Curve Signal Decay.md`]: 2,
			[`${C}/Monetary Policy/Yield Curve Inversion.md`]: 1,
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
			[`${C}/Marine Biology/Reef Survey Field Notes.md`]: 2,
		},
	},
	{
		query: "can hinting be shared between a regular and a condensed cut",
		tier: "hard",
		axis: "dilution",
		probes: "same shape in another domain, competing against dedicated 'Hinting and Rasterization' notes that are topically closer but do not answer the reuse question.",
		grades: {
			[`${C}/Typography/Foundry Operations Log.md`]: 2,
			[`${C}/Typography/Hinting and Rasterization.md`]: 1,
		},
	},

	// ── size-bias ───────────────────────────────────────────────────────────
	// The only axis where a many-chunk note is the WRONG answer.
	//
	// A note's semantic score is the max over its chunks, and the maximum of N
	// samples grows with N whether or not any chunk is relevant — a 28-section
	// note gets 28 draws at a high cosine where a 3-section note gets 3. Every
	// other case in this file either rewards length or is neutral to it (graded
	// targets skew long: median 8 sections against a corpus median of 4; ordinary
	// distractors are all under 700 words). That one-sidedness is not academic:
	// it made a measured chunk-count correction look purely negative, because the
	// suite could see the cost of a length penalty and never its benefit.
	//
	// Each case pairs a SHORT note that actually answers the query against a LONG
	// padded distractor that merely shares its vocabulary and out-chunks it. The
	// generator asserts the distractors stay bigger than their targets.
	//
	// Sub-1.0 is the intended state here, as everywhere in this tier.
	{
		query: "can an octopus learn to open a sealed jar",
		tier: "hard",
		axis: "size-bias",
		probes: "3-section answer note vs an 8-section husbandry log repeating 'octopus', 'sealed', 'jar', and 'lid' across every section. The distractor has ~2.7x the chunks and none of the answer.",
		grades: {
			[`${C}/Marine Biology/Cephalopod Problem Solving.md`]: 2,
			[`${C}/Marine Biology/Octopus Husbandry Program Notes.md`]: 0,
		},
	},
	{
		query: "what makes very small text readable",
		tier: "hard",
		axis: "size-bias",
		probes: "9-section answer note vs an 18-section print-production handbook saturated with 'small', 'text', 'readable', 'size'. Twice the chunks, no finding about legibility.",
		grades: {
			[`${C}/Typography/Legibility at Small Sizes.md`]: 2,
			[`${C}/Typography/Type Specimen Production Handbook.md`]: 0,
		},
	},
	{
		query: "how long before a rate change reaches borrowers",
		tier: "hard",
		axis: "size-bias",
		probes: "the hardest of the three: a 28-section press-office archive out-chunks the 25-section answer note while repeating 'rate', 'change', and 'borrowers' throughout. Length alone must not decide it.",
		grades: {
			[`${C}/Monetary Policy/Policy Rate Transmission Lag.md`]: 2,
			[`${C}/Monetary Policy/Central Bank Communications Archive.md`]: 0,
		},
	},

	// ════════════════════════════════════════════════════════════════════════
	// REALISTIC-USE TIER — polysemy, intent-frame, provenance.
	//
	// Added after a reported real-vault failure the whole suite above could not
	// reproduce: the query "feedback i received" returned notes about an LLM
	// feedback-scoring component in an automation pipeline instead of notes
	// recording feedback the user was given.
	//
	// Three properties of the `Corpus/` cases made that unreproducible:
	//
	//  1. Every distractor there *declares its own irrelevance* — `octopus-recipes`
	//     literally contains "not animal behaviour, learning, or any container-opening
	//     problem solving". An embedder reads that and correctly pushes the note away,
	//     which is why those cases saturate at ~1.0. Real polysemy has no such tell.
	//  2. The four domains are hermetic — no shared vocabulary, so confusion between
	//     them is trivially avoidable. Real vaults are one person's notes, where the
	//     colliding senses live side by side.
	//  3. Every query is a third-person factual lookup. None is *about the user*.
	//
	// These cases grade against `Zettel/` — a flat, single-directory layer with no
	// folder signal, hierarchy expressed only through frontmatter and wikilinks, both
	// of which are inert for ranking today (nothing in `src/search/` reads link
	// structure; `LexicalSearchService` reads only aliases and tags from frontmatter).
	//
	// Sub-1.0 is expected here, as everywhere in the hard tier.
	// ════════════════════════════════════════════════════════════════════════

	// ── polysemy ────────────────────────────────────────────────────────────
	// One word, two legitimate senses. Neither note is off-topic, and neither
	// declares itself wrong — the discrimination is purely semantic.

	{
		query: "feedback i received",
		tier: "hard",
		axis: "polysemy",
		probes: "the reported real-vault failure, reproduced. `i` is dropped at tokenization (single char, `isSignificantSearchTerm`), and the 1:1 note never says 'received' — it says 'Priya said' / 'told her' — so lexical is reduced to the single term 'feedback', which BOTH notes contain. The whole burden falls on the semantic half against a note that is honestly, fully about feedback in the LLM-scoring sense.",
		grades: {
			"Zettel/1-1 with Priya - March.md": 2,
			"Zettel/Feedback Scoring Service.md": 0,
			// Feedback the user *gave*, not received — the intent-frame sibling. Related
			// enough to be reasonable at rank 2, never the right answer.
			"Zettel/Notes Before Review Season.md": 1,
		},
	},
	{
		query: "the review is blocking me",
		tier: "hard",
		axis: "polysemy",
		probes: "'review' spans code review, performance review, and literature review inside one vault. Only the PR-backlog note is about something blocking the user; the Kahneman note reviews the forecasting literature and discusses review cycles, and 'blocking' appears in the PR note as ordinary prose.",
		grades: {
			"Zettel/PR Review Backlog.md": 2,
			"Zettel/Noise - Kahneman, Sibony, Sunstein.md": 0,
			"Zettel/Weekly Review 2026-03-14.md": 1,
		},
	},
	{
		query: "what's in the pipeline",
		tier: "hard",
		axis: "polysemy",
		probes: "'pipeline' as data-processing vs hiring funnel. Genuinely ambiguous without more context, so BOTH are graded 2 — this measures whether the ranker surfaces the sense pair at all rather than burying one. A ranker locked onto the engineering sense scores ~0.6.",
		grades: {
			"Zettel/Evaluation Pipeline.md": 2,
			"Zettel/Platform Hiring - Spring.md": 2,
			"Zettel/Feedback Scoring Service.md": 1,
		},
	},

	// ── intent-frame ────────────────────────────────────────────────────────
	// Same topic words, opposite relational role. This is the axis the reported
	// failure really sits on: not "which topic" but "which direction".
	//
	// The pair below is the strongest case in the file — two queries over the same
	// two notes with *opposite* correct answers. A ranker keying on topic alone
	// returns the same note for both, so at most one can be right. Neither target
	// repeats its query's verb, so a lexical shortcut cannot carry either one.

	{
		query: "feedback i gave someone",
		tier: "hard",
		axis: "intent-frame",
		probes: "the mirror of 'feedback i received' over the same two notes, with the answers swapped. The review-season note never uses the word 'gave' — it says 'I told him' / 'I said that plainly' — so the frame must be inferred, not matched. Compare this case's result against its sibling: identical rankings for both queries means the ranker is keying on topic and ignoring direction entirely.",
		grades: {
			"Zettel/Notes Before Review Season.md": 2,
			"Zettel/1-1 with Priya - March.md": 0,
			"Zettel/Feedback Scoring Service.md": 0,
		},
	},
	{
		query: "what did my manager say i should work on",
		tier: "hard",
		axis: "intent-frame",
		probes: "first-person + relational + possessive. 'my' is a stopword and 'manager' appears nowhere in the target — the note names Priya and never states her role — so every discriminating word is either dropped, down-weighted, or absent. Pure semantic inference of the reporting relationship.",
		grades: {
			"Zettel/1-1 with Priya - March.md": 2,
			"Zettel/Notes Before Review Season.md": 0,
			"Zettel/Weekly Review 2026-03-14.md": 1,
		},
	},
	{
		query: "things i said i would do and didn't",
		tier: "hard",
		axis: "intent-frame",
		probes: "the query describes a *relation between* commitments and outcomes, with no content word shared with the target's phrasing ('Did not ship:'). 'said' is a stopword; 'things', 'would', 'didn' carry nothing. Tests whether a first-person retrospective frame is recoverable at all.",
		grades: {
			"Zettel/Weekly Review 2026-03-14.md": 2,
			"Zettel/Migration Retro.md": 1,
		},
	},

	// ── provenance ──────────────────────────────────────────────────────────
	// Scoped by where a note came from rather than what it is about.
	//
	// Deliberately ONE case, not an axis. `calculatePathBoost` and
	// `calculateTagBoost` (`src/search/searchRanking.ts:306,345`) match the *whole
	// query string* against a path segment or tag — equality, prefix, or substring —
	// so a conversational query returns 0 from both. They only fire when the query is
	// essentially the bare folder or tag name. Every provenance case would therefore
	// score near zero on every model, which is no resolving power at all: a case that
	// every model fails cannot distinguish two models any more than one they all ace.
	//
	// So this records the defect rather than pretending to measure a model difference.
	// Remove the `knownFailure` if path/tag matching ever becomes token-wise.

	{
		query: "notes from the vendor call",
		tier: "hard",
		axis: "provenance",
		knownFailure:
			"Path and tag boosts match the whole query string, so 'notes from the vendor call' scores 0 from both despite the note carrying `source: vendor call` in frontmatter and a `vendor` tag. Arbitrary frontmatter fields are not indexed at all (LexicalSearchService reads only aliases/tags), and the flat Zettel layer gives no folder signal. Only the literal words 'vendor' and 'call' in the title and body can match.",
		probes: "provenance scoping: 'from the vendor call' is a source, not a subject. Documents that frontmatter provenance fields are invisible to ranking and that path/tag boosts cannot fire for conversational queries.",
		grades: {
			"Zettel/Vendor Call - Observability Tooling.md": 2,
			// Same `source: vendor call` frontmatter, so a ranker that *could* read
			// provenance fields should surface both. Graded 2 as well rather than 0:
			// the query asks for notes from that call, and this is one.
			"Zettel/How the Vendor Pitched It.md": 2,
			// Downstream of the call but not from it — reasonable, not the answer.
			"Zettel/The Ingest Charge Nobody Modelled.md": 1,
		},
	},

	// ── collision-cluster cases ─────────────────────────────────────────────
	// Added when the Zettel layer grew from 10 to 31 notes (2026-08-18).
	//
	// Every case below was **measured before it was written**: each query was run
	// against the live lexical ranker, and only those where the correct answer did
	// NOT already win were kept. Queries whose target simply matched by title —
	// "the nightly run keeps failing" → `nightly-run-failures.md` at rank 1, "our
	// sync is too long" → `weekly-sync-is-too-long.md` at rank 1 — were discarded
	// rather than banked as easy wins. A case with no headroom cannot discriminate
	// between models, which is the whole contract of this tier.

	{
		query: "why do i lose so much time to interruptions",
		tier: "hard",
		axis: "intent-frame",
		probes: "measured worst case in the layer: the target does not appear in the lexical top 4 at all — a solar-panel note and a smart-grid note beat it, because 'lose' and 'time' are generic and the note's own vocabulary is 'switching', 'reload', 'batching'. Same shape as the feedback failure: the note is about the thing without naming it.",
		grades: {
			"Zettel/The Cost of Switching.md": 2,
			"Zettel/Protecting Focus Blocks.md": 1,
			// Shares 'context' in the LLM-window sense — the collision this cluster exists for.
			"Zettel/Context Window Budget.md": 0,
		},
	},
	{
		query: "how much context can we fit",
		tier: "hard",
		axis: "polysemy",
		probes: "the other side of the same collision. Measured at rank 4 lexically, behind three unrelated notes, because 'context' alone is weak and 'fit' matches nothing. The competing sense (interruption cost) is graded 0 so choosing the wrong sense is scored.",
		grades: {
			"Zettel/Context Window Budget.md": 2,
			"Zettel/The Cost of Switching.md": 0,
			"Zettel/Scaling the Scoring Stage.md": 1,
		},
	},
	{
		query: "i need to block out time to focus",
		tier: "hard",
		axis: "polysemy",
		probes: "'block' as calendar-reservation vs storage-allocation unit. Measured: a daily note beats the dedicated note lexically, because the daily mentions blocking the morning in passing while the real note discusses the practice. The storage note is graded 0 — it owns the word in the wrong sense.",
		grades: {
			"Zettel/Protecting Focus Blocks.md": 2,
			"Zettel/Block Layout in the Storage Engine.md": 0,
			"Zettel/2026-03-16.md": 1,
			"Zettel/The Cost of Switching.md": 1,
		},
	},
	{
		query: "how many people do i actually have",
		tier: "hard",
		axis: "intent-frame",
		probes: "first-person capacity question with no shared content word — the note says 'capacity', 'allocated', 'arithmetic', never 'how many people'. The hiring note is the plausible wrong answer: it is genuinely about headcount, in the future rather than the present.",
		grades: {
			"Zettel/Team Capacity, Honestly.md": 2,
			"Zettel/Platform Hiring - Spring.md": 0,
			"Zettel/What Running a Team Actually Involves.md": 1,
		},
	},
	{
		query: "what's holding up the observability work",
		tier: "hard",
		axis: "intent-frame",
		probes: "the answer ('legal has had the contract eleven days') sits in a note whose title says 'Blocked on Legal Review' and never contains 'observability' in the blocking sentence. Requires joining the blocker to the thing blocked across notes — and 'review' here is the legal sense, colliding with the PR and performance senses elsewhere in the layer.",
		grades: {
			"Zettel/Blocked on Legal Review.md": 2,
			"Zettel/Vendor Call - Observability Tooling.md": 1,
			"Zettel/PR Review Backlog.md": 0,
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
