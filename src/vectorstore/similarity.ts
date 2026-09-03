/**
 * Vector Similarity Functions
 *
 * Optimized similarity calculations for embedding vectors.
 * Uses Float32Array for memory efficiency and performance.
 */

/**
 * Compute the cosine similarity between two vectors.
 *
 * Cosine similarity = (A · B) / (||A|| × ||B||)
 *
 * @param a First vector (Float32Array or number[])
 * @param b Second vector (Float32Array or number[])
 * @returns Similarity score between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
	if (a.length !== b.length) {
		throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		const ai = a[i];
		const bi = b[i];
		dotProduct += ai * bi;
		normA += ai * ai;
		normB += bi * bi;
	}

	const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

	// Handle zero vectors
	if (magnitude === 0) {
		return 0;
	}

	return dotProduct / magnitude;
}
