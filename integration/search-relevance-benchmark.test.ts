import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	isProviderConfigured,
	obsidianEval,
	pollEval,
	waitForStandaloneMiniSearch,
} from "./helpers/cli.ts";
import {
	PHRASE_JUDGMENTS,
	REFORMULATION_JUDGMENTS,
	RELEVANCE_JUDGMENTS,
	ndcgAt,
	pairedBootstrapCI,
	reciprocalRank,
	signTest,
} from "./helpers/relevanceJudgments.ts";

/*
 * Graded relevance benchmark for the hybrid search ranking.
 *
 * Unlike the assertion-style tests in `semantic-search.test.ts` ("query X returns
 * note Y"), this measures ranking *quality* as a number, so a change to the ranking
 * algorithm can be shown to improve rather than merely alter results.
 *
 * Run it once before a ranking change to capture a baseline, then again after:
 *
 *   bunx vitest run --config vitest.integration.config.ts \
 *     integration/search-relevance-benchmark.test.ts
 *
 * Requires the generated corpus (`bun run scripts/generate-search-corpus.ts`) to be
 * present in the vault and indexed. Semantic cases need a configured embedding
 * provider; they skip cleanly without one so CI stays green.
 */

const NDCG_K = 10;
/** Query enough results that a target sitting outside the top-10 is still visible in the debug output. */
const RESULT_LIMIT = 25;

/**
 * Current best measured scores — the ratchet the suite defends.
 *
 * Recorded 2026-08-16 on the 300-note generated corpus, 18 cases. Now stable
 * across embedding models, since the recency lift cap adapts to result-set
 * spread rather than being a fixed percentage:
 *   - `openrouter:qwen/qwen3-embedding-8b`  mean nDCG@10 = 0.9966, MRR = 1.0
 *   - `omlx:harrier-oss-v1-0.6b-MLX-8bit`   mean nDCG@10 = 0.9934, MRR = 1.0
 * The baseline below is set to clear both.
 *
 * 2026-08-17, `harrier-oss-v1-0.6b-MLX-8bit`: indexing `.chat` files as
 * active-branch Q&A pairs and adding stopword down-weighting restored this model to
 * 0.9934 / 1.0 from an interim 0.9524 / 0.9444. The hard tier moved 0.6814 → 0.8308,
 * driven almost entirely by `cross-lingual` (0.3807 → 0.6667), where German function
 * words had been carrying matches on their own.
 *
 * The four recency cases then moved to their own tier, so this baseline now covers 14
 * distinct queries rather than 18 with 4 duplicated. Both tiers are ratcheted against
 * the same number — the recency cases restate core queries and are equally expected to
 * score ~1.0 — so a change that breaks either still fails the suite. Measured after
 * the split on `harrier-oss-v1-0.6b-MLX-8bit`: core 0.9915 / 1.0 (n=14), recency
 * 1.0000 / 1.0 (n=4). The core mean moved 0.9934 → 0.9915 purely because the four
 * perfect-scoring duplicates no longer pad it.
 *
 * **Raise these whenever a change improves the mean** — the test prints the new
 * value when it clears the bar. Lowering them is a deliberate act that should
 * come with an explanation of why the regression is acceptable.
 *
 * **Lowered 2026-08-17, 0.99 → 0.82, when the corpus gained the `size-bias`
 * distractors.** This is not a tolerated ranking regression — the ranker is
 * byte-for-byte the same code that scored 0.9934, and every case it passed before
 * it still passes. What changed is the corpus: four long padded notes were added
 * that share a query's vocabulary without answering it, and three `core` queries
 * are restated verbatim by the new `size-bias` axis, so those queries now have a
 * long wrong answer to beat where previously they had none.
 *
 * The honest reading is that the old 0.99 was measuring a corpus in which no
 * many-chunk note was ever the wrong answer. Measured after the change:
 * `qwen3-embedding-8b` 0.8871, `harrier-oss-v1-0.6b` 0.8300. The floor is set just
 * under the weaker of the two.
 *
 * **Raised back to 0.88 (2026-08-17)** once the size-bias defect was fixed by
 * re-weighting the hybrid fusion (`SEMANTIC_SOURCE_WEIGHT` 0.60 → 0.78 in
 * `finalSearchRanking.ts`). The padded distractors no longer take rank 1
 * anywhere. Measured after the fix: `qwen3-embedding-8b` 0.9959 / MRR 1.0000,
 * `harrier-oss-v1-0.6b` 0.8889 / MRR 0.8571. Floor set just under the weaker.
 *
 * The gap between the two models is now the honest signal — `harrier` still loses
 * the padded-note contest on some queries where `qwen3` wins it outright.
 *
 * **2026-08-18 layout change: measured, and the floor holds.** `Topics/` and
 * `Large Notes/` were consolidated into the flat `Zettel/` namespace, removing the
 * `Topics/Smart Cities/` path segment that `smart city sensors and data platforms` had
 * been matching through `calculatePathBoost`. On the *lexical* tier that cost real
 * score — the query fell 0.839 → 0.735, taking the lexical mean 0.7281 → 0.7203 — and a
 * comparable hybrid dip was expected.
 *
 * It did not happen. Measured on `harrier-oss-v1-0.6b-MLX-8bit` after the change:
 * **core 0.9085 / MRR 0.8929**, comfortably clearing this floor. The semantic half
 * recovers what the folder boost was previously supplying, so the layout rework cost
 * the ratcheted tier nothing.
 *
 * The lexical finding stands on its own, though: a directory name was worth ~0.10 nDCG
 * on a single query when the semantic half was absent.
 *
 * **Reindex before comparing two runs.** Scores reproduce exactly against a given
 * index but not across a rebuild of it — an earlier build of this same corpus (hash
 * verified identical) gave core 0.8821 and a `size-bias` axis 0.12 lower. HNSW graph
 * construction is order-dependent, so `BASELINE_TOLERANCE` does not cover it; measure
 * both sides of any comparison against the same build.
 *
 * **Raised 0.88 → 0.93 (2026-08-18)** after `SEMANTIC_SOURCE_WEIGHT` 0.78 → 0.86 in
 * `finalSearchRanking.ts`. Measured on `harrier-oss-v1-0.6b-MLX-8bit` against a
 * single index build: core 0.9085 → **0.9355**, MRR 0.8929 → **0.9286**. The floor
 * sits just under the measured value, as before.
 *
 * Only `harrier` has been re-measured at this weight. If `qwen3` (which scored
 * higher at every previous weight) comes in below this, lower it rather than
 * assuming a regression — but re-sweep the weight for that model first, since the
 * plateau's upper edge moved with the corpus once already.
 *
 * **Lowered 0.93 → 0.92 (2026-08-19), and this is NOT a ranking regression.** The
 * judgment set gained graded distractors on three under-judged queries (Hole@10 was
 * 7.4-8.5 of every top-10 ungraded). Core moved 0.9355 → **0.9305** because errors that
 * were previously *invisible* are now scored — most starkly, the declared size-bias
 * distractor `Central Bank Communications Archive` takes rank 1 in both legs for
 * "which borrowers feel a policy rate change first" while disclaiming that exact query
 * in its own body. The ranker is byte-identical; the measurement got stricter.
 *
 * Expect this to happen again as more holes are filled. A drop that coincides with new
 * judgments is the benchmark improving, not the ranker degrading — verify by checking
 * whether the ranking itself moved before lowering the floor.
 */
const BASELINE_MEAN_NDCG = 0.92;
const BASELINE_MEAN_RR = 0.9;

/**
 * Separate floor for the `recency` tier, which cannot share the core one.
 *
 * The tier is only four cases, and three of them restate queries that the
 * `size-bias` axis also targets. A padded distractor beating the real answer
 * therefore moves this mean by a quarter each time, where the same defect is
 * diluted across fourteen core cases. Sharing a constant would make the recency
 * tier fail for a size-bias reason, hiding whichever problem was not the cause.
 *
 * Measured after the hybrid re-weighting fixed the size-bias defect: `harrier`
 * 0.8155, `qwen3-embedding-8b` 1.0000 (both up from 0.7232 / 0.8155). Set just
 * under the weaker. The per-case `> 0.5` guard below is what actually protects
 * recency behaviour — it still catches a recent note outranking the right
 * answer, which is what this tier exists for.
 *
 * **Raised 0.8 → 0.88 (2026-08-18)** with the same `SEMANTIC_SOURCE_WEIGHT` change:
 * `harrier` 0.8155 → **0.9077**. Recency was never the subject of that change — the
 * tier improved because two of its four cases restate `size-bias` queries, so
 * strengthening the semantic leg helped the real answer beat the padded distractor
 * here too.
 */
const RECENCY_FLOOR_MEAN_NDCG = 0.88;

/**
 * Floor for the `hard` tier — the model-discrimination cases.
 *
 * This is NOT a ratchet, and it is deliberately loose. Those cases are built to
 * have headroom (see the HARD TIER block in `relevanceJudgments.ts`); scoring below
 * 1.0 on them is the intended state, because a case every model aces cannot tell two
 * models apart. The number here only catches a *collapse* — a change that breaks
 * hard retrieval outright — while leaving room for the score to move up and down as
 * embedding models are swapped.
 *
 * Record measurements per model in `integration/README.md` rather than encoding one
 * model's score here as if it were a target.
 */
const HARD_FLOOR_MEAN_NDCG = 0.35;

/**
 * Absorbs embedding-provider jitter only. Repeated runs against the same index
 * reproduce the mean exactly, so this is headroom for a model or provider whose
 * scores differ slightly — not licence for a real regression to pass.
 */
const BASELINE_TOLERANCE = 0.02;

const providerAvailable = (() => {
	try {
		return isProviderConfigured();
	} catch {
		return false;
	}
})();

const searchIndexAvailable = (() => {
	try {
		return obsidianEval(`${PLUGIN}.pluginData.searchEmbedIndex !== null`).includes("true");
	} catch {
		return false;
	}
})();

const corpusIndexed = (() => {
	try {
		const raw = obsidianEval(
			`${PLUGIN}.app.vault.getFiles().filter(function(f){ return f.path.indexOf("Corpus/") === 0; }).length`,
		);
		const value = raw.startsWith("=> ") ? raw.slice(3) : raw;
		return Number.parseInt(value, 10) > 0;
	} catch {
		return false;
	}
})();

interface QueryOutcome {
	query: string;
	probes: string;
	ndcg: number;
	rr: number;
	targetRank: number | null;
	topPaths: string[];
	knownFailure?: string;
	axis?: string;
	/**
	 * How many of the returned top-`NDCG_K` results carry no grade at all.
	 *
	 * BEIR calls this Hole@k, and it is the standard diagnostic for *pooling
	 * bias*: nDCG scores an ungraded document as 0, identically to one judged
	 * irrelevant, so a system that surfaces good-but-unjudged notes is punished
	 * for it. BEIR's own authors found this materially understated dense
	 * retrievers — on TREC-COVID, annotating 980 previously-unjudged pairs moved
	 * ANCE from 0.654 (below BM25) to 0.735 (6.7 points above it), while a lexical
	 * system barely moved.
	 *
	 * This suite is *more* exposed than BEIR, not less: judgments here are
	 * hand-written per query rather than pooled, so anything the author did not
	 * think of is a hole by default. A high number does not invalidate a score,
	 * but it does mean the score is a lower bound, and it flags which queries are
	 * worth re-grading before trusting a small delta on them.
	 */
	holes: number;
}

/** The regression-guarding cases (everything without an explicit tier). */
const CORE_JUDGMENTS = RELEVANCE_JUDGMENTS.filter((j) => (j.tier ?? "core") === "core");
/** The model-discrimination cases. */
const HARD_JUDGMENTS = RELEVANCE_JUDGMENTS.filter((j) => j.tier === "hard");
/** The cases that put a recently-opened note in conflict with the right answer. */
const RECENCY_JUDGMENTS = RELEVANCE_JUDGMENTS.filter((j) => j.tier === "recency");

/**
 * Reset the recent-notes list, then mark this case's fixtures as opened, and confirm
 * the list ended up holding exactly those notes.
 *
 * Recency is real ranking input, and it leaks between queries — without an
 * explicit reset a case would inherit whatever the previous one opened, making
 * results order-dependent. `recordRecentlyOpenedNote` prepends, so the array is
 * applied in reverse to leave `recentNotes[0]` as the most recent.
 *
 * It also leaks in from *outside* the benchmark. `main.ts` records every note opened
 * in the vault via `workspace.on("file-open")`, so a note clicked in Obsidian while
 * the suite runs lands at position 0 with a fresh timestamp — ahead of the fixtures.
 * A click before a case is harmless (the clear removes it), but one landing between
 * the clear and the query survives, and that is precisely the recency-vs-relevance
 * conflict this tier measures. Verified: a stray note recorded before a fixture is
 * still present alongside it afterwards.
 *
 * So the state is read back and asserted rather than assumed. `clearRecentNotes` is
 * async (it awaits `saveSettings`), which is why a fixed sleep was needed before —
 * awaiting it and then verifying removes both the guess and the blind spot.
 */
async function applyRecentNotes(paths: readonly string[]): Promise<void> {
	const ordered = [...paths].reverse();
	const globalKey = `__s2bRecent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const raw = await pollEval(
		`(function(){ window.${globalKey} = "pending"; var d = ${PLUGIN}.pluginData; d.clearRecentNotes().then(function(){ ${ordered
			.map((p) => `d.recordRecentlyOpenedNote(${JSON.stringify(p)});`)
			.join(
				" ",
			)} window.${globalKey} = JSON.stringify(d.recentNotes.map(function(e){ return e.path; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: String(e && e.message || e)}); }); return "started"; })()`,
		globalKey,
		{ timeoutMs: 15_000 },
	);

	const actual = JSON.parse(raw);
	if (actual.error) throw new Error(`failed to set recent notes: ${actual.error}`);

	// Most-recent-first, which is the reverse of the order they were recorded in.
	const expected = [...ordered].reverse();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`recent-notes fixture mismatch — expected [${expected.join(", ")}], got [${actual.join(", ")}]. A note opened in the vault during the run can land here; leave the test vault idle while the benchmark runs.`,
		);
	}
}

/**
 * Encode a query list as a base64 blob the eval decodes back to an array.
 *
 * `obsidian eval` takes `code=<js>` as one argv element, and an apostrophe inside a
 * query survives `JSON.stringify` but not the shell round-trip — the code string is
 * truncated at the quote. That failure is *silent and misleading*: the search comes back
 * with zero results, which reads exactly like a broken ranker rather than a quoting bug.
 * (Hit twice: once in `scripts/pool-candidates.mjs`, then here, when the reformulation
 * tier added the suite's first query containing "didn't".)
 *
 * `atob` alone yields latin1, which would corrupt the German queries in the
 * `cross-lingual` axis, so the bytes are decoded as UTF-8 explicitly.
 */
function encodeQueries(queries: string[]): string {
	const b64 = Buffer.from(JSON.stringify(queries), "utf8").toString("base64");
	return `JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(${JSON.stringify(b64)}), function(c){ return c.charCodeAt(0); })))`;
}

/** Score one query's returned ordering against its graded expectations. */
function scoreOutcome(judgment: (typeof RELEVANCE_JUDGMENTS)[number], paths: string[]): QueryOutcome {
	// Multi-target cases have several grade-2 notes; report the best-placed one so
	// the "rank" column stays meaningful for them too.
	const targets = Object.entries(judgment.grades)
		.filter(([, grade]) => grade === 2)
		.map(([path]) => path);
	const targetIndex = targets
		.map((path) => paths.indexOf(path))
		.filter((index) => index >= 0)
		.reduce((best, index) => (best < 0 ? index : Math.min(best, index)), -1);

	return {
		query: judgment.query,
		probes: judgment.probes,
		ndcg: ndcgAt(paths, judgment.grades, NDCG_K),
		rr: reciprocalRank(paths, judgment.grades),
		targetRank: targetIndex >= 0 ? targetIndex + 1 : null,
		topPaths: paths.slice(0, 5),
		knownFailure: judgment.knownFailure,
		axis: judgment.axis,
		// Hole@k: returned-but-ungraded results in the scored window.
		holes: paths.slice(0, NDCG_K).filter((path) => judgment.grades[path] === undefined).length,
	};
}

/**
 * Run a whole tier in one CLI round-trip, issuing its queries concurrently.
 *
 * Each `obsidian eval` costs ~254ms of process spawn and IPC regardless of the work
 * it does, so a per-query fire-and-poll (2 round-trips each) spent ~21s of a 42s run
 * on the CLI alone. Batching a tier collapses that to 2 round-trips total, and
 * `Promise.all` then overlaps the searches inside Obsidian: measured 1304ms → 511ms
 * for 5 hybrid queries, since most of each is an awaited embedding call rather than
 * CPU. Verified byte-identical to sequential execution across 6 queries — search
 * holds no per-query state, so concurrency cannot reorder results.
 *
 * Recency fixtures are the one thing that *is* shared mutable state, so a tier whose
 * cases set them must run sequentially; `parallel` is false for that tier.
 */
async function scoreQueries(
	keyPrefix: string,
	algorithm: "hybrid" | "lexical" | "semantic",
	judgments: readonly (typeof RELEVANCE_JUDGMENTS)[number][],
	{ parallel = true } = {},
): Promise<QueryOutcome[]> {
	if (judgments.length === 0) return [];

	// Vitest retries a failed test in the same page, so a fixed key would let the
	// retry read the previous attempt's value before the new run overwrites it —
	// which surfaced as a hybrid tier reporting the lexical tier's score.
	// The prefix ends up in a `window.<key>` identifier, so anything that is not
	// identifier-safe (a hyphen from an axis name, say) would make the evaluated code a
	// syntax error — and the only symptom is unparseable output, which reads like a
	// search failure rather than a naming bug. Sanitize rather than trusting callers.
	const safePrefix = keyPrefix.replace(/[^A-Za-z0-9_$]/g, "_");
	const globalKey = `${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

	if (!parallel) {
		const outcomes: QueryOutcome[] = [];
		for (const [index, judgment] of judgments.entries()) {
			await applyRecentNotes(judgment.recentNotes ?? []);
			const raw = await pollEval(
				fireOne(`${globalKey}${index}`, algorithm, judgment.query),
				`${globalKey}${index}`,
			);
			const parsed = JSON.parse(raw);
			if (parsed.error) throw new Error(`search failed for "${judgment.query}": ${parsed.error}`);
			outcomes.push(scoreOutcome(judgment, parsed));
		}
		return outcomes;
	}

	// Concurrency is only safe because none of these cases touch the shared
	// recent-notes list. Fail loudly rather than silently mis-scoring if one is added.
	const withFixtures = judgments.filter((j) => (j.recentNotes?.length ?? 0) > 0);
	if (withFixtures.length > 0) {
		throw new Error(
			`cannot run in parallel — these set recentNotes: ${withFixtures.map((j) => j.query).join(", ")}. Pass { parallel: false }.`,
		);
	}

	// The list must still be empty: recency persists in plugin data, so a previous
	// tier's leftovers would apply to these queries.
	await applyRecentNotes([]);

	const queries = judgments.map((j) => j.query);
	const raw = await pollEval(
		`(function(){ window.${globalKey} = "pending"; Promise.all(${encodeQueries(queries)}.map(function(q){ return ${PLUGIN}.searchNotesForBenchmark(q, ${JSON.stringify(algorithm)}, ${RESULT_LIMIT}).then(function(r){ return r.map(function(d){ return d.path; }); }); })).then(function(all){ window.${globalKey} = JSON.stringify(all); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: String(e && e.message || e)}); }); return "started"; })()`,
		globalKey,
		{ timeoutMs: 120_000 },
	);

	const parsed = JSON.parse(raw);
	if (parsed.error) throw new Error(`batched search failed: ${parsed.error}`);
	const results: string[][] = parsed;
	if (results.length !== judgments.length) {
		throw new Error(`expected ${judgments.length} result sets, got ${results.length}`);
	}
	return judgments.map((judgment, index) => scoreOutcome(judgment, results[index]));
}

/** Fire-and-forget expression for a single query, used by the sequential path. */
function fireOne(globalKey: string, algorithm: "hybrid" | "lexical" | "semantic", query: string): string {
	// Same base64 smuggling as the batched path — see `encodeQueries`.
	return `(function(){ window.${globalKey} = "pending"; ${PLUGIN}.searchNotesForBenchmark(${encodeQueries([query])}[0], ${JSON.stringify(algorithm)}, ${RESULT_LIMIT}).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return d.path; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: String(e && e.message || e)}); }); return "started"; })()`;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function report(label: string, outcomes: QueryOutcome[]): void {
	const lines: string[] = [
		"",
		`──────── ${label} ────────`,
		`${"nDCG".padStart(6)} ${"RR".padStart(5)} ${"rank".padStart(5)}  query`,
	];
	for (const o of outcomes) {
		const flag = o.knownFailure ? " ⚠" : "";
		lines.push(
			`${o.ndcg.toFixed(3).padStart(6)} ${o.rr.toFixed(2).padStart(5)} ${String(o.targetRank ?? "—").padStart(5)}${flag}  ${o.query}`,
		);
		// The imperfect cases are the interesting ones — show what beat the target.
		if (o.ndcg < 1) {
			lines.push(`${" ".repeat(19)}probes: ${o.probes}`);
			lines.push(`${" ".repeat(19)}top: ${o.topPaths.join(", ") || "(none)"}`);
		}
	}

	// Split the aggregate: the known-failure cases are exactly the ones a ranking
	// rework is meant to move, so averaging them in would hide progress on the rest.
	const known = outcomes.filter((o) => o.knownFailure);
	const rest = outcomes.filter((o) => !o.knownFailure);
	lines.push(
		`${" ".repeat(19)}ALL      nDCG@${NDCG_K}=${mean(outcomes.map((o) => o.ndcg)).toFixed(4)} MRR=${mean(outcomes.map((o) => o.rr)).toFixed(4)} (n=${outcomes.length})`,
	);

	// Hole@k (pooling bias). Aggregate plus the worst offenders — printing it per
	// row would bury the scores. A query whose top-10 is mostly ungraded is scored
	// against a judgment set that never considered what the ranker actually
	// returned, so its nDCG is a lower bound rather than a verdict.
	const worstHoles = [...outcomes].sort((a, b) => b.holes - a.holes).slice(0, 3);
	lines.push(
		`${" ".repeat(19)}HOLE@${NDCG_K}  mean=${mean(outcomes.map((o) => o.holes)).toFixed(1)}/${NDCG_K} ungraded` +
			` — worst: ${worstHoles.map((o) => `${o.holes} (${o.query.slice(0, 28)})`).join(", ")}`,
	);
	if (known.length > 0) {
		lines.push(
			`${" ".repeat(19)}EXPECTED nDCG@${NDCG_K}=${mean(rest.map((o) => o.ndcg)).toFixed(4)} MRR=${mean(rest.map((o) => o.rr)).toFixed(4)} (n=${rest.length}, excludes ${known.length} known failure(s))`,
			`${" ".repeat(19)}KNOWN FAILURES:`,
		);
		for (const o of known) {
			lines.push(`${" ".repeat(21)}⚠ ${o.query}`);
			lines.push(`${" ".repeat(23)}${o.knownFailure}`);
		}
	}
	lines.push("");
	console.log(lines.join("\n"));
}

describe("search relevance benchmark", () => {
	beforeAll(async () => {
		clearBuffers();
		await waitForStandaloneMiniSearch();

		// Warm the embedding path before any tier is scored. The first hybrid query
		// after a reload pays model load / connection setup, and when a whole tier is
		// issued concurrently that cost lands on all of them at once — some resolve
		// before the embedder is ready and fall back to lexical-only, which showed up
		// as the hybrid tier scoring its lexical value (0.8496) on the first attempt
		// and the true value on Vitest's retry.
		if (corpusIndexed && providerAvailable && searchIndexAvailable) {
			await pollEval(
				`(function(){ window.__s2bWarm = "pending"; ${PLUGIN}.searchNotesForBenchmark("warm up the embedder", "hybrid", 1).then(function(){ window.__s2bWarm = "ok"; }).catch(function(){ window.__s2bWarm = "ok"; }); return "started"; })()`,
				"__s2bWarm",
				{ timeoutMs: 120_000 },
			);
		}
	});

	afterAll(async () => {
		// Recency is persisted plugin state; leaving fixtures behind would skew any
		// later search in this vault (including a subsequent benchmark run).
		await applyRecentNotes([]);
		clearBuffers();
	});

	it("has the generated corpus present in the vault", () => {
		expect(corpusIndexed, "Corpus/ not found in the vault — run: bun run scripts/generate-search-corpus.ts").toBe(
			true,
		);
	});

	describe.skipIf(!corpusIndexed)("lexical baseline", () => {
		it("measures nDCG@10 and MRR for lexical-only ranking", async () => {
			const outcomes = await scoreQueries("__s2bBenchLex", "lexical", CORE_JUDGMENTS);
			report(`LEXICAL  (n=${outcomes.length})`, outcomes);

			// Lexical alone cannot bridge the near-synonym cases; this run exists to
			// quantify the gap the semantic half is supposed to close, so it only
			// asserts that the harness produced a score for every query.
			expect(outcomes).toHaveLength(CORE_JUDGMENTS.length);
		});
	});

	describe.skipIf(!corpusIndexed)("phrase sensitivity", () => {
		/**
		 * Does word adjacency carry any ranking weight? Measured per leg.
		 *
		 * **Reported, not gated** — these cases test a hypothesis (that phrase
		 * blindness costs real ranking quality), and gating a hypothesis would be
		 * asserting its answer. See the PHRASE TIER block in
		 * `relevanceJudgments.ts` for the case construction and the expected
		 * outcome, stated up front so this output can falsify it.
		 *
		 * The legs are scored separately because the diagnosis differs by leg:
		 *  - lexical losing to the decoy confirms the structural gap (MiniSearch
		 *    stores no positions, so it *cannot* see adjacency);
		 *  - hybrid losing says the semantic leg does not cover for it, and a
		 *    phrase-aware re-rank would pay for itself;
		 *  - hybrid winning while lexical loses says the gap is already absorbed,
		 *    and the re-rank would only help lexical-only users.
		 *
		 * Semantic/hybrid run only when an embedding provider is configured, so
		 * the lexical half of the measurement stays available in CI.
		 */
		it("scores phrase-verbatim targets against scattered-word decoys, per leg", async () => {
			const legs: Array<"lexical" | "semantic" | "hybrid"> =
				providerAvailable && searchIndexAvailable ? ["lexical", "semantic", "hybrid"] : ["lexical"];

			const byLeg = new Map<string, QueryOutcome[]>();
			for (const algorithm of legs) {
				const outcomes = await scoreQueries(`__s2bBenchPhrase${algorithm}`, algorithm, PHRASE_JUDGMENTS);
				byLeg.set(algorithm, outcomes);
				report(`PHRASE — ${algorithm.toUpperCase()}  (n=${outcomes.length})`, outcomes);
			}

			// One verdict line per query so the cross-leg comparison does not have to
			// be reassembled from three blocks by eye.
			const lines = ["", "──────── PHRASE verdict (target rank per leg; reported, not gated) ────────"];
			for (const [index, judgment] of PHRASE_JUDGMENTS.entries()) {
				const ranks = legs.map((leg) => `${leg} ${byLeg.get(leg)?.[index]?.targetRank ?? "—"}`).join("  ");
				lines.push(`  ${ranks}   "${judgment.query}"`);
			}
			lines.push(
				"  Rank 1 everywhere = adjacency already handled (or absorbed by the semantic leg).",
				"  Lexical > 1 with hybrid = 1: gap is real but covered — a phrase re-rank only helps lexical-only search.",
				"  Hybrid > 1: the gap survives fusion — a phrase-aware re-rank would pay for itself.",
				"",
			);
			console.log(lines.join("\n"));

			// Only that the harness produced a score for every query in every leg.
			for (const algorithm of legs) {
				expect(byLeg.get(algorithm)).toHaveLength(PHRASE_JUDGMENTS.length);
			}
		});
	});

	describe.skipIf(!corpusIndexed || !providerAvailable || !searchIndexAvailable)("hybrid ranking", () => {
		it("measures nDCG@10 and MRR for hybrid ranking", async () => {
			const outcomes = await scoreQueries("__s2bBenchHyb", "hybrid", CORE_JUDGMENTS);
			report(`HYBRID  (n=${outcomes.length})`, outcomes);

			const meanNdcg = mean(outcomes.map((o) => o.ndcg));
			const meanRr = mean(outcomes.map((o) => o.rr));

			// Ratchet. Raise BASELINE_* whenever a change improves the score, so the
			// suite locks in progress instead of only catching catastrophes. The
			// tolerance absorbs embedding-provider jitter, not real regressions —
			// repeated runs on the same index reproduce the mean exactly.
			expect(meanNdcg, `mean nDCG@${NDCG_K} regressed`).toBeGreaterThanOrEqual(
				BASELINE_MEAN_NDCG - BASELINE_TOLERANCE,
			);
			expect(meanRr, "MRR regressed").toBeGreaterThanOrEqual(BASELINE_MEAN_RR - BASELINE_TOLERANCE);

			if (meanNdcg > BASELINE_MEAN_NDCG + BASELINE_TOLERANCE) {
				console.log(
					`\n  ✅ IMPROVED — raise BASELINE_MEAN_NDCG to ${meanNdcg.toFixed(4)} (was ${BASELINE_MEAN_NDCG})\n`,
				);
			}

			// No single case may collapse, even if the mean still clears the bar —
			// that would hide one query breaking while others improve.
			for (const outcome of outcomes) {
				expect(outcome.ndcg, `${outcome.query} — ${outcome.probes}`).toBeGreaterThan(0.5);
			}
		});

		it("reports which known failures the current ranker still exhibits", async () => {
			const known = RELEVANCE_JUDGMENTS.filter((j) => j.knownFailure);
			if (known.length === 0) return;

			// May include recency cases, which mutate shared fixture state — run serially.
			const outcomes = await scoreQueries("__s2bBenchKnown", "hybrid", known, { parallel: false });

			// Informational, not a gate: if one of these starts passing, the ranking
			// change worked and the `knownFailure` annotation should be removed.
			for (const outcome of outcomes) {
				if (outcome.ndcg >= 1) {
					console.log(`\n  ✅ FIXED — remove knownFailure from: "${outcome.query}"\n`);
				}
			}
			expect(outcomes).toHaveLength(known.length);
		});

		/**
		 * Precision floor: what a meaningless query currently returns.
		 *
		 * **Reported, not asserted.** Semantic search has no notion of "no answer":
		 * every query embeds to some vector and returns its nearest neighbours, so
		 * gibberish comes back with a full page of results at cosines in the same
		 * band real matches occupy (0.515-0.597 against 0.665-0.700).
		 *
		 * Three suppression strategies were implemented and measured, and all three
		 * fail — see the note in `hybridSearch` (`src/agent/tools/searchNotes.ts`).
		 * The one that looked best (semantic distribution shape) separates cleanly
		 * on `harrier` and is provably unusable on `qwen3`, where a genuine query
		 * scores *below* four gibberish ones on the same metric.
		 *
		 * So this stays a measurement rather than a gate. Its companion,
		 * `still returns results for meaningful queries with no lexical overlap`,
		 * *is* asserted — because silently returning nothing for a real query is
		 * the worse failure. Any future fix has to move this number down without
		 * moving that one, on both models.
		 */
		it("reports how many results a meaningless query returns", async () => {
			// Strings with no meaning in any indexed note. Kept obviously synthetic:
			// a real-word query that merely has no answer would be a recall question,
			// which is a different (and much harder) judgement call.
			const NONSENSE = ["zzzznotarealword", "qqxjvbwm", "asdfghjkl zxcvbnm"];

			const globalKey = `__s2bBenchNoMatch_${Date.now()}`;
			const raw = await pollEval(
				`(function(){ window.${globalKey} = "pending"; Promise.all(${JSON.stringify(NONSENSE)}.map(function(q){ return ${PLUGIN}.searchNotesForBenchmark(q, "hybrid", ${RESULT_LIMIT}).then(function(r){ return r.length; }); })).then(function(all){ window.${globalKey} = JSON.stringify(all); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: String(e && e.message || e)}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 120_000 },
			);

			const counts = JSON.parse(raw) as number[] | { error: string };
			if (!Array.isArray(counts)) throw new Error(`no-match probe failed: ${counts.error}`);

			const lines = ["", "──────── NO-MATCH (precision floor — reported, not gated) ────────"];
			NONSENSE.forEach((q, i) => lines.push(`${String(counts[i]).padStart(3)} results  ${JSON.stringify(q)}`));
			lines.push("  (a working suppression would drive these to 0 without breaking SEMANTIC-ONLY below)");
			console.log(lines.join("\n"));

			expect(counts).toHaveLength(NONSENSE.length);
		});

		/**
		 * The other side of the precision floor: a *meaningful* query must still
		 * return results even when no indexed note shares a literal term with it.
		 *
		 * These are the queries the no-match gate can wrongly suppress. All three
		 * are German baking terms that appear nowhere in the corpus, so lexical
		 * returns zero — but semantic correctly surfaces the German sourdough note
		 * (`sauerteig-fuehrung-im-winter.md`), which genuinely is the best answer.
		 *
		 * The distinction the gate has to make is *not* "did lexical agree" alone.
		 * Measured semantic spread (top score minus the weakest of 20):
		 *
		 *   noise      0.030-0.071  (gibberish, and real-but-absent single words
		 *                            like `petrichor`, whose top hits are wrong)
		 *   these      0.135-0.200
		 *   genuine    0.078-0.277  (ordinary queries that lexical also matches)
		 *
		 * Noise returns a flat field of equally-mediocre neighbours; a real query
		 * has a clear winner. Suppressing on lexical emptiness alone conflates the
		 * two and loses these.
		 */
		it("still returns results for meaningful queries with no lexical overlap", async () => {
			// German baking vocabulary, absent from the corpus as literal text. The
			// answer note is German, so this is the realistic shape of the failure:
			// a user searching their own vault in a language the notes use, with
			// wording the notes happen not to contain.
			const SEMANTIC_ONLY = ["Zwiebelkuchen", "Sauerteigbrot backen", "Hefeteig"];

			const globalKey = `__s2bBenchSemOnly_${Date.now()}`;
			const raw = await pollEval(
				`(function(){ window.${globalKey} = "pending"; Promise.all(${JSON.stringify(SEMANTIC_ONLY)}.map(function(q){ return ${PLUGIN}.searchNotesForBenchmark(q, "hybrid", ${RESULT_LIMIT}).then(function(r){ return r.length; }); })).then(function(all){ window.${globalKey} = JSON.stringify(all); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: String(e && e.message || e)}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 120_000 },
			);

			const counts = JSON.parse(raw) as number[] | { error: string };
			if (!Array.isArray(counts)) throw new Error(`semantic-only probe failed: ${counts.error}`);

			const lines = ["", "──────── SEMANTIC-ONLY (recall floor) ────────"];
			SEMANTIC_ONLY.forEach((q, i) =>
				lines.push(`${String(counts[i]).padStart(3)} results  ${JSON.stringify(q)}`),
			);
			console.log(lines.join("\n"));

			for (const [index, count] of counts.entries()) {
				expect(count, `"${SEMANTIC_ONLY[index]}" is meaningful and must not be suppressed`).toBeGreaterThan(0);
			}
		});

		/**
		 * The model-discrimination tier.
		 *
		 * Reported per axis, because the aggregate is not the useful number: a model
		 * can be strong overall and still be unusable for a vault that is partly
		 * German, and only the per-axis split makes that visible. When comparing two
		 * embedding models, compare the axis rows — the mean hides exactly the
		 * differences the tier was built to expose.
		 */
		it("measures the hard tier per difficulty axis (model discrimination)", async () => {
			const outcomes = await scoreQueries("__s2bBenchHard", "hybrid", HARD_JUDGMENTS);
			report(`HARD  (n=${outcomes.length})`, outcomes);

			const axes = [...new Set(outcomes.map((o) => o.axis ?? "unknown"))].sort();
			const lines = ["", "──────── HARD tier by axis ────────"];
			for (const axis of axes) {
				const inAxis = outcomes.filter((o) => (o.axis ?? "unknown") === axis);
				lines.push(
					`  ${axis.padEnd(14)} nDCG@${NDCG_K}=${mean(inAxis.map((o) => o.ndcg)).toFixed(4)}` +
						` MRR=${mean(inAxis.map((o) => o.rr)).toFixed(4)} (n=${inAxis.length})`,
				);
			}
			const meanNdcg = mean(outcomes.map((o) => o.ndcg));
			// The collapse guard excludes `knownFailure` cases. They are measured,
			// already-diagnosed defects expected to score ~0 (the `provenance` case
			// cannot score above 0 until path/tag matching becomes token-wise), so
			// averaging them into the gate would drag it down by a fixed amount that has
			// nothing to do with whether hard retrieval still works. The full mean is
			// still reported above — only the assertion narrows.
			const gated = outcomes.filter((o) => !o.knownFailure);
			const gatedMeanNdcg = mean(gated.map((o) => o.ndcg));
			lines.push(
				`  ${"OVERALL".padEnd(14)} nDCG@${NDCG_K}=${meanNdcg.toFixed(4)}` +
					` MRR=${mean(outcomes.map((o) => o.rr)).toFixed(4)} (n=${outcomes.length})`,
				`  ${"GATED".padEnd(14)} nDCG@${NDCG_K}=${gatedMeanNdcg.toFixed(4)} (n=${gated.length}, excludes known failures)`,
				"",
				"  Record this per embedding model in integration/README.md.",
				"  Sub-1.0 is expected here — these cases exist to have headroom.",
				"",
			);
			console.log(lines.join("\n"));

			// Collapse guard only — deliberately far below the measured score. This
			// must not be ratcheted like the core baseline: tightening it would turn a
			// measurement instrument into a second regression gate, and the whole point
			// of the tier is that the number is allowed to move when the model changes.
			expect(gatedMeanNdcg, `hard-tier mean nDCG@${NDCG_K} collapsed`).toBeGreaterThanOrEqual(
				HARD_FLOOR_MEAN_NDCG,
			);
		});

		/**
		 * The `semantic` algorithm — embeddings only, no lexical leg.
		 *
		 * **Reported, not gated.** This is a *user-selected* mode, not the default: the
		 * search modal's Tab toggle picks it (`SearchModal.activeAlgorithm`) because by
		 * the time a user toggles, they have already seen and rejected the lexical
		 * ordering. Gating it would assert that one retrieval strategy must beat another
		 * on a corpus that cannot represent the thing that distinguishes them — the
		 * suite scores every query cold, with no notion of "these results were already
		 * shown and dismissed".
		 *
		 * **It is not equivalent to `SEMANTIC_SOURCE_WEIGHT = 1.0`.** Dropping the
		 * lexical leg entirely puts `rankSearchResults` on its single-source branch,
		 * which skips RRF rank-mixing *and* swaps `FUSION_TITLE_BOOST_MAX` (0.18) for
		 * `SEMANTIC_ONLY_TITLE_BOOST_MAX` (0.30). Any earlier weight-sweep row is
		 * therefore not a prediction of these numbers.
		 *
		 * Both tiers are run so the hybrid/semantic comparison is like-for-like.
		 */
		it("reports the semantic-only algorithm beside hybrid (user-selected mode)", async () => {
			// Both algorithms over the same judgments, so the comparison is paired and
			// the bootstrap below is valid. Hybrid is re-run here rather than reusing
			// the earlier tiers' numbers: those are separate `it` blocks and a shared
			// mutable result would couple them.
			const [semCore, semHard, hybCore, hybHard] = [
				await scoreQueries("__s2bBenchSemCore", "semantic", CORE_JUDGMENTS),
				await scoreQueries("__s2bBenchSemHard", "semantic", HARD_JUDGMENTS),
				await scoreQueries("__s2bBenchHybCore2", "hybrid", CORE_JUDGMENTS),
				await scoreQueries("__s2bBenchHybHard2", "hybrid", HARD_JUDGMENTS),
			];

			const axes = [...new Set(semHard.map((o) => o.axis ?? "unknown"))].sort();
			const lines = [
				"",
				"──────── SEMANTIC-ONLY algorithm (reported, not gated) ────────",
				`  core     nDCG@${NDCG_K}=${mean(semCore.map((o) => o.ndcg)).toFixed(4)} MRR=${mean(semCore.map((o) => o.rr)).toFixed(4)} (n=${semCore.length})`,
				`  hard     nDCG@${NDCG_K}=${mean(semHard.map((o) => o.ndcg)).toFixed(4)} MRR=${mean(semHard.map((o) => o.rr)).toFixed(4)} (n=${semHard.length})`,
				"  by axis:",
			];
			for (const axis of axes) {
				const inAxis = semHard.filter((o) => (o.axis ?? "unknown") === axis);
				lines.push(
					`    ${axis.padEnd(14)} nDCG@${NDCG_K}=${mean(inAxis.map((o) => o.ndcg)).toFixed(4)}` +
						` MRR=${mean(inAxis.map((o) => o.rr)).toFixed(4)} (n=${inAxis.length})`,
				);
			}

			// Significance. Without it a tier mean moving by a few points reads as a
			// trend when it is often one query flipping between 0 and 1 — the per-query
			// scores here are strongly bimodal.
			lines.push("", "  ─── hybrid vs semantic (paired bootstrap, 10k resamples, seeded) ───");
			for (const [label, hyb, sem] of [
				["core", hybCore, semCore],
				["hard", hybHard, semHard],
			] as const) {
				const ci = pairedBootstrapCI(
					hyb.map((o) => o.ndcg),
					sem.map((o) => o.ndcg),
				);
				const st = signTest(
					hyb.map((o) => o.ndcg),
					sem.map((o) => o.ndcg),
				);
				const sign = ci.delta >= 0 ? "+" : "";
				lines.push(
					`    ${label.padEnd(6)} δ=${sign}${ci.delta.toFixed(4)}` +
						`  95% CI [${ci.ciLow.toFixed(4)}, ${ci.ciHigh.toFixed(4)}]` +
						`  ${ci.significant ? "✓ significant" : "✗ not significant"}  (n=${ci.n})`,
					`           sign test: hybrid ${st.aWins} / semantic ${st.bWins} / ${st.ties} tied`,
				);
			}

			lines.push(
				"",
				"    ⚠ Hard-tier queries are adversarially selected (kept only if the ranker",
				"      already failed them) and partly duplicated across tiers, so a CI here",
				"      bounds resampling noise on THESE queries — it does not generalise to",
				"      queries a user might type.",
				"    ⚠ No per-axis CI: n=1..5 per axis. Axis rows are directional only.",
				"",
				"  Compare against the HYBRID and HARD blocks above, per embedding model.",
				"  This is a distinct algorithm, NOT the SEMANTIC_SOURCE_WEIGHT=1.0 sweep row.",
				"",
			);
			console.log(lines.join("\n"));

			// Only that the harness produced a score for every query — see the docblock.
			expect(semCore).toHaveLength(CORE_JUDGMENTS.length);
			expect(semHard).toHaveLength(HARD_JUDGMENTS.length);
		});

		/**
		 * Direction sensitivity: the sharpest single diagnostic in the suite.
		 *
		 * "feedback i received" and "feedback i gave someone" are near-identical strings
		 * over the same two notes, with *opposite* correct answers. A ranker that keys on
		 * topic rather than relational frame returns the same ordering for both — which is
		 * exactly the reported real-vault failure, where a query about feedback the user
		 * received surfaced an LLM feedback-scoring component instead.
		 *
		 * It exists because this is a property no aggregate can express: both queries can
		 * score respectably on nDCG while returning an identical top result, since each has
		 * a graded-2 note the other ranks highly. Only comparing the two orderings against
		 * each other catches it.
		 *
		 * **Reported, not gated** — the same treatment the `knownFailure` cases and the
		 * NO-MATCH precision floor get. Measured 2026-08-18 on
		 * `harrier-oss-v1-0.6b-MLX-8bit`: both directions return
		 * `Zettel/Feedback Scoring Service.md`, so the ranker is keying on topic and
		 * ignoring the relational frame entirely. That is the reported real-vault failure,
		 * reproduced — a measured, already-diagnosed defect, which by this file's
		 * convention is recorded rather than made to fail the suite.
		 *
		 * The check itself is deliberately weak: it only asks whether the *top result
		 * differs*, not whether either is correct — that is what the `intent-frame` nDCG
		 * cases measure. A ranker with any frame sensitivity at all would satisfy it.
		 *
		 * **Turn the `expect` back on once the ranker distinguishes them**, so the suite
		 * starts defending the fix. Until then it prints a loud ⚠ line.
		 *
		 * **Investigated 2026-08-18 — the fix is not in ranking.** The wrong note is
		 * rank 1 in the lexical *and* the semantic leg simultaneously, while both
		 * correct answers are absent from lexical entirely and sit at semantic ranks 7
		 * and 13. No reweighting of two sources can promote a note that loses on both,
		 * which rules out the entire fusion-tuning family — including the
		 * `SEMANTIC_SOURCE_WEIGHT` lever that fixed `size-bias`.
		 *
		 * The embedder *does* resolve direction given a richer query ("criticism my
		 * manager gave me about my work" → correct note at rank 1, wrong note down to
		 * rank 7), so the real defect is single-term topical dominance in a short
		 * query, and the lever is query expansion *upstream* of retrieval rather than
		 * anything here. Full measurements in `integration/README.md`.
		 *
		 * So do not re-enable this assertion until that upstream step exists: it would
		 * assert a property nothing in the current pipeline can deliver.
		 */
		it("reports whether direction is distinguished: 'feedback i received' vs 'gave'", async () => {
			const PAIR = ["feedback i received", "feedback i gave someone"];

			const globalKey = `__s2bBenchFrame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			const raw = await pollEval(
				`(function(){ window.${globalKey} = "pending"; Promise.all(${JSON.stringify(PAIR)}.map(function(q){ return ${PLUGIN}.searchNotesForBenchmark(q, "hybrid", ${RESULT_LIMIT}).then(function(r){ return r.map(function(d){ return d.path; }); }); })).then(function(all){ window.${globalKey} = JSON.stringify(all); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: String(e && e.message || e)}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 120_000 },
			);

			const parsed = JSON.parse(raw) as string[][] | { error: string };
			if (!Array.isArray(parsed)) throw new Error(`intent-frame probe failed: ${parsed.error}`);
			const [received, gave] = parsed;

			const distinguished = received[0] !== gave[0];
			console.log(
				[
					"",
					"──────── INTENT-FRAME direction check (reported, not gated) ────────",
					`  "feedback i received"     top: ${received[0] ?? "(none)"}`,
					`  "feedback i gave someone" top: ${gave[0] ?? "(none)"}`,
					distinguished
						? "  ✅ DISTINGUISHED — the ranker separates the two directions.\n" +
							"     Re-enable the assertion below so the suite defends this."
						: "  ⚠ NOT DISTINGUISHED — both directions return the same top note. The ranker is\n" +
							"     keying on topic ('feedback') and ignoring the relational frame entirely.\n" +
							"     This is the reported real-vault failure, reproduced.",
					"",
				].join("\n"),
			);

			// Only the recall floor is gated: returning *nothing* for a meaningful query is a
			// different and worse failure than returning the wrong thing, and it is not a
			// known defect. The direction comparison itself is reported above — see the
			// docblock for why, and for when to turn it back into an assertion.
			expect(received.length, "'feedback i received' returned nothing").toBeGreaterThan(0);
			expect(gave.length, "'feedback i gave someone' returned nothing").toBeGreaterThan(0);
		});

		/**
		 * The reformulation tier — can rephrasing reach what ranking cannot?
		 *
		 * `intent-frame` is the weakest axis and is **unfixable in the ranker**: on
		 * `what did my manager say i should work on` the wrong note is rank 1 in the
		 * lexical AND semantic legs simultaneously, so no monotone reweighting of the
		 * two can promote the right one. The fix has to happen before retrieval, by
		 * changing the query — which the agent can do (`explore-vault` skill) and the
		 * ranker cannot.
		 *
		 * This runs each case's original phrasing and its authored reformulations
		 * against the *same* grades, and reports the delta. A large positive delta says
		 * the corpus is reachable and the skill guidance is worth having; a flat one
		 * says the note cannot be found however the question is asked, which would make
		 * the guidance pointless and is the more important thing to learn.
		 *
		 * **Reported, never ratcheted.** The reformulations are hand-authored, so
		 * gating on them would reward writing easier rephrasings over improving
		 * retrieval — the same reason `HARD_FLOOR_MEAN_NDCG` is only a collapse guard.
		 */
		it("reports whether reformulation reaches what the original phrasing misses", async () => {
			if (REFORMULATION_JUDGMENTS.length === 0) return;

			const lines: string[] = ["", "──────── REFORMULATION (reported, not gated) ────────"];
			const originalScores: number[] = [];
			const bestScores: number[] = [];

			for (const [caseIndex, judgment] of REFORMULATION_JUDGMENTS.entries()) {
				const algorithm = judgment.algorithm ?? "hybrid";
				const phrasings = [judgment.query, ...judgment.reformulations];
				// `keyPrefix` becomes part of a `window.<key>` identifier, so it must be
				// identifier-safe — an axis name like "intent-frame" produces a syntax
				// error inside the eval, which surfaces only as unparseable output.
				const outcomes = await scoreQueries(
					`reform${caseIndex}`,
					algorithm,
					phrasings.map((query) => ({ ...judgment, query })),
				);

				const [original, ...rephrased] = outcomes;
				const best = rephrased.reduce((a, b) => (b.ndcg > a.ndcg ? b : a), rephrased[0]);
				originalScores.push(original.ndcg);
				bestScores.push(best.ndcg);

				lines.push(
					`  ${judgment.axis}  (${algorithm})`,
					`    ${original.ndcg.toFixed(3)}  rank ${original.targetRank ?? "—"}   ORIGINAL   "${judgment.query}"`,
				);
				for (const outcome of rephrased) {
					const marker = outcome === best ? "*" : " ";
					lines.push(
						`   ${marker}${outcome.ndcg.toFixed(3)}  rank ${outcome.targetRank ?? "—"}   rephrased  "${outcome.query}"`,
					);
				}
				lines.push(
					`    Δ best-vs-original = ${best.ndcg - original.ndcg >= 0 ? "+" : ""}${(best.ndcg - original.ndcg).toFixed(4)}`,
					"",
				);
			}

			lines.push(
				`  ORIGINAL phrasings  mean nDCG@${NDCG_K}=${mean(originalScores).toFixed(4)} (n=${originalScores.length})`,
				`  BEST reformulation  mean nDCG@${NDCG_K}=${mean(bestScores).toFixed(4)} (n=${bestScores.length})`,
				"",
				"  ⚠ This is a CEILING, not an expectation. The reformulations were written",
				"    by someone who had already read the target note; a real agent is guessing",
				"    at vocabulary it cannot see. One kept rephrasing scores WORSE than its",
				"    original, and others were discarded for missing entirely — so a given",
				"    attempt is closer to a coin flip than these means suggest.",
				"    Measuring real agent reformulation needs a different instrument.",
				"",
			);
			console.log(lines.join("\n"));

			// The only assertion: the harness ran. Scores here are reported, and the
			// premise of the tier is that the originals fail — asserting on them would
			// gate the thing being measured.
			expect(bestScores.length).toBe(REFORMULATION_JUDGMENTS.length);
		});

		/**
		 * The recency-vs-relevance tier.
		 *
		 * Each case re-runs a `core` query with the *wrong* note marked recently-opened.
		 * The recent note is graded 0, so a high score means the recency lift did not
		 * hijack the result — this measures resistance, not recency quality.
		 *
		 * Held apart from `core` because every query here duplicates a core one
		 * verbatim; averaging them together double-weights those four queries, so one
		 * genuine failure reads as two. It carries its own ratchet: these cases are
		 * expected to score ~1.0, since the ranking they guard is shipped and tuned.
		 */
		it("measures recency resistance (a recent wrong note must not win)", async () => {
			if (RECENCY_JUDGMENTS.length === 0) return;

			// Sequential by necessity: each case rewrites the shared recent-notes list,
			// so concurrent runs would score against each other's fixtures.
			const outcomes = await scoreQueries("__s2bBenchRecent", "hybrid", RECENCY_JUDGMENTS, { parallel: false });
			report(`RECENCY  (n=${outcomes.length})`, outcomes);

			const meanNdcg = mean(outcomes.map((o) => o.ndcg));
			expect(meanNdcg, `recency-tier mean nDCG@${NDCG_K} regressed`).toBeGreaterThanOrEqual(
				RECENCY_FLOOR_MEAN_NDCG - BASELINE_TOLERANCE,
			);

			// A single case collapsing means one recent note now outranks the right
			// answer, which the mean alone would hide.
			for (const outcome of outcomes) {
				expect(outcome.ndcg, `${outcome.query} — ${outcome.probes}`).toBeGreaterThan(0.5);
			}
		});
	});
});
