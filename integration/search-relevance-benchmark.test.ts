import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	isProviderConfigured,
	obsidianEval,
	pollEval,
	sleep,
	waitForStandaloneMiniSearch,
} from "./helpers/cli.ts";
import { RELEVANCE_JUDGMENTS, ndcgAt, reciprocalRank } from "./helpers/relevanceJudgments.ts";

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
 * **Raise these whenever a change improves the mean** — the test prints the new
 * value when it clears the bar. Lowering them is a deliberate act that should
 * come with an explanation of why the regression is acceptable.
 */
const BASELINE_MEAN_NDCG = 0.99;
const BASELINE_MEAN_RR = 1.0;

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
}

/**
 * Reset the recent-notes list, then mark this case's fixtures as opened.
 *
 * Recency is real ranking input, and it leaks between queries — without an
 * explicit reset a case would inherit whatever the previous one opened, making
 * results order-dependent. `recordRecentlyOpenedNote` prepends, so the array is
 * applied in reverse to leave `recentNotes[0]` as the most recent.
 */
async function applyRecentNotes(paths: readonly string[]): Promise<void> {
	const ordered = [...paths].reverse();
	obsidianEval(
		`(function(){ var d = ${PLUGIN}.pluginData; d.clearRecentNotes(); ${ordered
			.map((p) => `d.recordRecentlyOpenedNote(${JSON.stringify(p)});`)
			.join(" ")} return "ok"; })()`,
	);
	// The setter persists asynchronously; give it a beat before querying.
	await sleep(500);
}

/** Run one query through the real search stack and score the returned ordering. */
async function scoreQuery(
	globalKey: string,
	algorithm: "hybrid" | "lexical",
	judgment: (typeof RELEVANCE_JUDGMENTS)[number],
): Promise<QueryOutcome> {
	await applyRecentNotes(judgment.recentNotes ?? []);

	const raw = await pollEval(
		`(function(){ window.${globalKey} = "pending"; ${PLUGIN}.searchNotesForBenchmark(${JSON.stringify(judgment.query)}, ${JSON.stringify(algorithm)}, ${RESULT_LIMIT}).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return d.path; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: String(e && e.message || e)}); }); return "started"; })()`,
		globalKey,
		{ timeoutMs: 60_000 },
	);

	const parsed = JSON.parse(raw);
	if (parsed.error) throw new Error(`search failed for "${judgment.query}": ${parsed.error}`);
	const paths: string[] = parsed;

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
	};
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
	});

	afterAll(async () => {
		// Recency is persisted plugin state; leaving fixtures behind would skew any
		// later search in this vault (including a subsequent benchmark run).
		await applyRecentNotes([]);
		clearBuffers();
	});

	it("has the generated corpus present in the vault", () => {
		expect(
			corpusIndexed,
			"Corpus/ not found in the vault — run: bun run scripts/generate-search-corpus.ts",
		).toBe(true);
	});

	describe.skipIf(!corpusIndexed)("lexical baseline", () => {
		it("measures nDCG@10 and MRR for lexical-only ranking", async () => {
			const outcomes: QueryOutcome[] = [];
			for (const [i, judgment] of RELEVANCE_JUDGMENTS.entries()) {
				outcomes.push(await scoreQuery(`__s2bBenchLex${i}`, "lexical", judgment));
			}
			report(`LEXICAL  (n=${outcomes.length})`, outcomes);

			// Lexical alone cannot bridge the near-synonym cases; this run exists to
			// quantify the gap the semantic half is supposed to close, so it only
			// asserts that the harness produced a score for every query.
			expect(outcomes).toHaveLength(RELEVANCE_JUDGMENTS.length);
		});
	});

	describe.skipIf(!corpusIndexed || !providerAvailable || !searchIndexAvailable)("hybrid ranking", () => {
		it("measures nDCG@10 and MRR for hybrid ranking", async () => {
			const outcomes: QueryOutcome[] = [];
			for (const [i, judgment] of RELEVANCE_JUDGMENTS.entries()) {
				outcomes.push(await scoreQuery(`__s2bBenchHyb${i}`, "hybrid", judgment));
			}
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

			const outcomes: QueryOutcome[] = [];
			for (const [i, judgment] of known.entries()) {
				outcomes.push(await scoreQuery(`__s2bBenchKnown${i}`, "hybrid", judgment));
			}

			// Informational, not a gate: if one of these starts passing, the ranking
			// change worked and the `knownFailure` annotation should be removed.
			for (const outcome of outcomes) {
				if (outcome.ndcg >= 1) {
					console.log(`\n  ✅ FIXED — remove knownFailure from: "${outcome.query}"\n`);
				}
			}
			expect(outcomes).toHaveLength(known.length);
		});
	});
});
