/**
 * Vector width from which an index's resident memory becomes a concern on a
 * phone. At 1024+ dimensions a 20k-chunk index is ~80–120 MB of vectors alone
 * (Float32), on top of the WebContent process's ~1 GB baseline on the
 * reference vault; a 384-dim model is a quarter of that.
 */
export const LARGE_EMBEDDING_DIMENSIONS = 1024;

/**
 * Settings hint for a mobile user whose selected model produces wide vectors,
 * or `null` when no hint applies (unknown width, or a small model). Phrased as
 * a hint, not a warning — the index works, it just costs memory.
 */
export function largeDimensionHint(model: string, dimensions: number | undefined): string | null {
	if (dimensions === undefined || dimensions < LARGE_EMBEDDING_DIMENSIONS) return null;
	return `${model} produces ${dimensions}-dimensional vectors. On a phone the loaded index costs memory in proportion; a small model (384 or 768 dimensions) keeps it at a fraction of that.`;
}
