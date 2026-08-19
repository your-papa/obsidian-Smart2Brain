/**
 * Semantic Edge Scan
 *
 * The pairwise similarity scan behind the smart graph's inferred edges, kept
 * free of Obsidian and vault types so it can run inside the compute worker as
 * well as on the main thread.
 *
 * Inputs are a flat vector batch plus a per-vector note index (large notes are
 * embedded as several chunks), which is what survives a structured-clone
 * transfer. Outputs are index pairs; callers map them back to paths.
 */

/**
 * How many semantic neighbours each note may contribute. Kept deliberately low:
 * the union of every note's top-K is already denser than it looks, because an
 * edge survives if *either* endpoint ranks the other.
 */
export const DEFAULT_SEMANTIC_NEIGHBOR_COUNT = 5;

/**
 * Minimum cosine similarity for a semantic edge. Below roughly this value pairs
 * are mostly noise floor rather than genuine topical overlap, so a lower bound
 * matters more than K for keeping topics clean.
 */
export const DEFAULT_SEMANTIC_THRESHOLD = 0.55;

/** A scored pair of note indices, ordered so `source < target`. */
export interface SemanticPair {
	source: number;
	target: number;
	score: number;
}

export interface SemanticScanOptions {
	neighborCount?: number;
	threshold?: number;
	/**
	 * Note-index pairs (encoded `${min}:${max}`) to skip — used to suppress pairs
	 * that already have an authored wiki link.
	 */
	excludePairs?: Set<string>;
}

/** Encode an unordered note-index pair for dedupe/exclusion lookups. */
export function pairKey(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Pre-normalize every chunk vector so similarity is a plain dot product.
 *
 * The scan compares each pair of notes, so a vector's norm would otherwise be
 * recomputed once per comparison — O(n²) redundant work. Normalizing up front
 * makes it O(n).
 */
function normalizeChunks(data: Float32Array, count: number, dim: number): Float32Array {
	const normalized = new Float32Array(count * dim);
	for (let i = 0; i < count; i++) {
		const offset = i * dim;
		let norm = 0;
		for (let d = 0; d < dim; d++) {
			const value = data[offset + d];
			norm += value * value;
		}
		norm = Math.sqrt(norm);
		if (norm === 0) continue;
		for (let d = 0; d < dim; d++) {
			normalized[offset + d] = data[offset + d] / norm;
		}
	}
	return normalized;
}

/**
 * Best cosine similarity between any chunk of note `a` and any chunk of note `b`.
 *
 * Best-chunk (rather than a mean vector) keeps a note discoverable by any one of
 * its sections, so a note covering several topics still matches each of them.
 */
function bestChunkSimilarity(normalized: Float32Array, dim: number, aChunks: number[], bChunks: number[]): number {
	let best = Number.NEGATIVE_INFINITY;
	for (const ai of aChunks) {
		const aOffset = ai * dim;
		for (const bi of bChunks) {
			const bOffset = bi * dim;
			let dot = 0;
			for (let d = 0; d < dim; d++) {
				dot += normalized[aOffset + d] * normalized[bOffset + d];
			}
			if (dot > best) best = dot;
		}
	}
	return best;
}

/**
 * Scan all note pairs and return the top-K neighbours of each, deduped.
 *
 * `chunkOwners[i]` gives the note index owning chunk `i`; `noteCount` is the
 * number of distinct notes. O(n²) in notes — callers cap the input size.
 */
export function scanSemanticPairs(
	data: Float32Array,
	chunkCount: number,
	dim: number,
	chunkOwners: Int32Array,
	noteCount: number,
	options: SemanticScanOptions = {},
): SemanticPair[] {
	const neighborCount = options.neighborCount ?? DEFAULT_SEMANTIC_NEIGHBOR_COUNT;
	const threshold = options.threshold ?? DEFAULT_SEMANTIC_THRESHOLD;
	const excludePairs = options.excludePairs;

	if (neighborCount <= 0 || noteCount < 2 || dim === 0 || chunkCount === 0) return [];

	// Invert chunk → note into note → chunks.
	const chunksByNote: number[][] = Array.from({ length: noteCount }, () => []);
	for (let i = 0; i < chunkCount; i++) {
		const owner = chunkOwners[i];
		if (owner >= 0 && owner < noteCount) chunksByNote[owner].push(i);
	}

	const normalized = normalizeChunks(data, chunkCount, dim);

	// Similarity is symmetric, so score each unordered pair once and let both
	// endpoints consider it for their own top-K list.
	const candidates: Array<Array<{ note: number; score: number }>> = Array.from({ length: noteCount }, () => []);
	for (let a = 0; a < noteCount; a++) {
		const aChunks = chunksByNote[a];
		if (aChunks.length === 0) continue;
		for (let b = a + 1; b < noteCount; b++) {
			const bChunks = chunksByNote[b];
			if (bChunks.length === 0) continue;
			const score = bestChunkSimilarity(normalized, dim, aChunks, bChunks);
			if (!Number.isFinite(score) || score < threshold) continue;
			candidates[a].push({ note: b, score });
			candidates[b].push({ note: a, score });
		}
	}

	const pairs: SemanticPair[] = [];
	const seen = new Set<string>();
	for (let note = 0; note < noteCount; note++) {
		const list = candidates[note];
		if (list.length === 0) continue;
		// Ties break on note index so results are stable across runs.
		list.sort((left, right) => right.score - left.score || left.note - right.note);
		const limit = Math.min(neighborCount, list.length);
		for (let i = 0; i < limit; i++) {
			const { note: other, score } = list[i];
			const key = pairKey(note, other);
			if (seen.has(key) || excludePairs?.has(key)) continue;
			seen.add(key);
			pairs.push({
				source: Math.min(note, other),
				target: Math.max(note, other),
				score,
			});
		}
	}

	return pairs;
}
