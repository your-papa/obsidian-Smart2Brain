/**
 * Chunk → note score aggregation for semantic search.
 *
 * A note is stored as one vector per section, so a single query can hit several
 * chunks of the same note. Collapsing those hits with "first one wins" throws
 * away a real relevance signal: a note that matches in three separate sections is
 * usually a better answer than one that matches in a single lucky paragraph.
 *
 * Measured consequence of first-hit-wins, after section-aware chunking split the
 * fixture corpus: the query "how long does a wet sourdough starter take to
 * double" put the correct note at rank 3, behind two generic
 * `sourdough-starter-maintenance-*` siblings whose best chunk edged it out by a
 * hair — even though the correct note matched in more places.
 *
 * Pure module: no Obsidian / DOM dependencies so it is trivially unit-testable.
 */

/**
 * Maximum lift a note can gain from supporting chunks, as a fraction of its own
 * best chunk. The support term *converges* to this — it never exceeds it no
 * matter how many chunks match.
 */
const SUPPORT_WEIGHT = 0.15;

/**
 * Half-saturation constant: the amount of accumulated support at which a note
 * receives half the maximum lift. Larger values make support build more slowly.
 *
 * Sized so that the shape matches how notes actually chunk. In the fixture vault
 * a typical note yields 3-8 chunks and a 66KB reference note yields 33, so `3`
 * puts ordinary multi-section notes on the steep part of the curve (2 supporting
 * chunks ≈ 6% lift) while a 33-chunk note saturates near the ceiling (≈14%)
 * rather than running away.
 */
const SUPPORT_HALF_SATURATION = 3;

/** A single chunk hit, already sorted best-first by the caller. */
export interface ChunkHit {
	path: string;
	score: number;
}

export interface AggregatedNote {
	path: string;
	/** Final note-level score: best chunk plus a bounded support term. */
	score: number;
	/** Score of this note's single best-matching chunk. */
	bestChunkScore: number;
	/** How many of this note's chunks were among the retrieved hits. */
	matchingChunks: number;
}

/**
 * Collapse chunk-level hits into note-level scores.
 *
 * The aggregate is `best * (1 + SUPPORT_WEIGHT * s / (s + K))`, where `s` is the
 * summed strength of the supporting chunks (each measured relative to the note's
 * own best chunk) and `K` is `SUPPORT_HALF_SATURATION`. Properties:
 *
 *  - **Best-chunk dominance.** The strongest single match sets the scale, so a
 *    precise short note is never buried by a sprawling one.
 *  - **Converging lift.** `s/(s+K)` approaches 1 but never reaches it, so total
 *    support is hard-bounded by SUPPORT_WEIGHT regardless of chunk count.
 *  - **Quality over count.** `s` sums *relative* strengths, so two sections that
 *    nearly match the best chunk outweigh twenty that barely register.
 *  - **Relative, not absolute.** No constant is compared against a raw cosine, so
 *    behaviour is unchanged across embedding models and vault sizes.
 *
 * The earlier formula summed `1/(i+1)` — a harmonic series, which *diverges*.
 * Support therefore grew without bound in chunk count: measured lift was +19% at
 * 5 chunks, +39% at 20, +63% at 100, and a real 33-chunk note was inflated from a
 * 0.662 best chunk to 0.909. That let a long note beat a genuinely better short
 * one on length alone — a 33-chunk note scoring 0.55 per chunk outranked a note
 * scoring 0.72. Long notes get more chunks sub-linearly in their length (100x the
 * bytes yields only ~11x the chunks), so this bias grows with vault heterogeneity.
 *
 * ## Known residual: max-of-N size bias (measured, deliberately not corrected)
 *
 * Support is not the only way chunk count leaks into a note's score. The score
 * is anchored on the note's *best* chunk, and the maximum of N samples grows
 * with N whether or not any of them is relevant: a note split into 40 chunks
 * gets 40 draws at producing a high cosine, while a 4-chunk note gets 4.
 * Simulated against this function, an irrelevant 40-chunk note at per-chunk mean
 * 0.45 beats a relevant 4-chunk note at mean 0.55 in ~53% of trials — and still
 * wins ~27% of the time with the support term removed entirely, which is what
 * identifies `best` itself, not support, as the source.
 *
 * **Two corrections were built and measured here; both made retrieval worse.**
 * Do not re-attempt either without new evidence:
 *
 *  - Subtracting `0.5 * spread * ln(totalChunks)` — the expected-max baseline for
 *    a note's own size, calibrated per query so it stays model-independent. Cost
 *    0.0135 hard-tier nDCG@10 on one embedding model and 0.0529 on another, and
 *    its one apparent gain (`long-context`) changed sign between them. A penalty
 *    keyed on note *size* cannot tell "long because padded" from "long because
 *    thorough", and real targets are often the long notes. Getting the totals
 *    also meant a per-path count map maintained across every store mutation,
 *    since over-fetch truncates the retrieved count.
 *  - Shrinking the best chunk toward the note's own median: *worse than doing
 *    nothing* (41.3% vs 49.2% on the target case), because a genuinely relevant
 *    short note also has an outlier best chunk.
 *
 * The defect those attempts targeted turned out to be mostly lexical rather than
 * semantic. A padded note wins by matching *more distinct query terms* — BM25
 * rewards breadth, and length buys vocabulary coverage — not by drawing a lucky
 * maximum. Re-weighting the hybrid fusion toward semantic fixed it outright
 * (`SEMANTIC_SOURCE_WEIGHT` in `finalSearchRanking.ts`), taking the benchmark's
 * `size-bias` axis from 0.6309 to 1.0000 on the stronger model. Reach for that
 * knob before touching this one.
 *
 * @param hits Chunk hits sorted by score descending (as returned by the store).
 * @returns Notes sorted by aggregate score descending.
 */
export function aggregateChunksToNotes(hits: readonly ChunkHit[]): AggregatedNote[] {
	const byPath = new Map<string, number[]>();
	for (const hit of hits) {
		const scores = byPath.get(hit.path);
		if (scores) {
			scores.push(hit.score);
		} else {
			byPath.set(hit.path, [hit.score]);
		}
	}

	const aggregated: AggregatedNote[] = [];
	for (const [path, scores] of byPath) {
		// Caller sorts best-first, but a note's own chunks may arrive interleaved
		// with other notes' — sort defensively so `best` is genuinely the best.
		scores.sort((a, b) => b - a);
		const best = scores[0];

		let support = 0;
		if (best > 0) {
			for (let i = 1; i < scores.length; i++) {
				// Relative to the note's own best chunk, so a note whose sections all
				// match strongly gains more than one with a single spike.
				support += Math.max(0, scores[i]) / best;
			}
		}

		// Saturating: rises quickly for the first few supporting sections, then
		// flattens toward SUPPORT_WEIGHT. Chunk count alone can never run away.
		const supportLift = SUPPORT_WEIGHT * (support / (support + SUPPORT_HALF_SATURATION));

		aggregated.push({
			path,
			score: best * (1 + supportLift),
			bestChunkScore: best,
			matchingChunks: scores.length,
		});
	}

	return aggregated.sort((left, right) => right.score - left.score);
}
