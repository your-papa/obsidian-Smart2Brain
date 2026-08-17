import { deu, eng } from "stopword";

/**
 * Stopword handling for lexical (BM25) search.
 *
 * Without it, high-frequency function words dominate ranking. Measured on the test
 * vault, the query "wie spare ich strom" scored `wie` at 19.27 and `ich` at 4.71,
 * while the meaningful `spare` / `strom` scored 2.87 — so two unrelated German filler
 * notes (which merely repeat "Wie stark … wirkt, hängt erheblich von …") outranked the
 * energy notes that the content words had already found. English behaves identically:
 * `the` scores 37.05 and `how` 155.73, against 27.13 for `save energy`.
 *
 * This is not fixable by reweighting the semantic/lexical fusion. `normalizeLexical`
 * in `finalSearchRanking.ts` is min-max over the result set, so those hits saturate to
 * 1.0 / 0.89 against a 0.056 cliff for everything else; suppressing them via fusion
 * weight would also cost real lexical precision on exact-term queries (e.g. an exact
 * title match legitimately scores 1.0). The raw term score is the right place to fix it.
 *
 * Stopwords are **down-weighted, not removed**, so an all-stopword query like "the who"
 * or "how to" still matches. Removal would make such queries return nothing.
 */

/**
 * Word lists to treat as stopwords, one entry per supported language.
 *
 * Adding a language is an import plus an entry here (~3 KB minified each). Import the
 * *named* lists — `import { eng, deu } from "stopword"` — never `import * as`: the
 * named form tree-shakes to ~6.5 KB, the namespace form pulls in all 62 lists (~216 KB).
 *
 * Before adding a language, check its list against `integration/helpers/relevanceJudgments.ts`.
 * List aggressiveness varies a lot: `stopwords-iso` was rejected for this reason, its
 * 1298-word English list classifying `small`, `text`, `open` and `years` as stopwords —
 * all of which are answer-bearing terms in our own benchmark queries.
 */
const STOPWORD_LANGUAGES: readonly string[][] = [eng, deu];

/**
 * Terms never treated as stopwords, whatever the language lists say.
 *
 * Merging lists across languages means each language's function words also apply to
 * queries in the others — 613 German-only entries currently affect English queries,
 * including `die`, `man`, `war` and `will`. That is tolerable because the effect is a
 * partial down-weight rather than removal, but a few terms carry enough domain meaning
 * that even a partial penalty is wrong.
 *
 * `tag` is the clear case: a German stopword ("day"), but a first-class Obsidian concept.
 * Register further collisions here as languages are added.
 */
const DOMAIN_TERM_DENYLIST: ReadonlySet<string> = new Set(["tag"]);

/** Merged lookup, built once at module load. */
const STOPWORDS: ReadonlySet<string> = new Set(
	STOPWORD_LANGUAGES.flat()
		.map((term) => term.toLowerCase())
		.filter((term) => !DOMAIN_TERM_DENYLIST.has(term)),
);

/**
 * Multiplier applied to a stopword's contribution to the BM25 score.
 *
 * Low enough that a stopword cannot carry a match on its own, non-zero so an
 * all-stopword query ("the who", "how to") still ranks something.
 *
 * Swept against `integration/search-relevance-benchmark.test.ts` on
 * `omlx:harrier-oss-v1-0.6b-MLX-8bit`, hybrid mean nDCG@10:
 *
 *   | boost | hybrid | cross-lingual |
 *   |-------|--------|---------------|
 *   | 1.00  | 0.9524 | 0.3807        |  (no down-weighting)
 *   | 0.15  | 0.9524 | 0.6483        |
 *   | 0.05  | 0.9934 | 0.6667        |
 *   | 0.02  | 0.9934 | 0.6667        |
 *
 * The curve is flat below 0.05, so this sits in the plateau rather than at an
 * extreme — leaving room in both directions as corpora and models change.
 */
export const STOPWORD_BOOST = 0.05;

/** `true` when a term is a known function word with no domain meaning. */
export function isStopword(term: string): boolean {
	return STOPWORDS.has(term.toLowerCase());
}

/**
 * Per-term multiplier for MiniSearch's `boostTerm`: `<1` reduces a term's importance,
 * `1` is neutral. Passed directly as the `boostTerm` option.
 */
export function getTermBoost(term: string): number {
	return isStopword(term) ? STOPWORD_BOOST : 1;
}
