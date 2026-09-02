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

/**
 * Normalize a vector to unit length (L2 normalization).
 * Pre-normalizing vectors allows faster similarity computation.
 *
 * @param vector Input vector
 * @returns New Float32Array with unit length
 */
export function normalize(vector: Float32Array | number[]): Float32Array {
	let sumSquares = 0;
	for (let i = 0; i < vector.length; i++) {
		sumSquares += vector[i] * vector[i];
	}

	const magnitude = Math.sqrt(sumSquares);

	// Handle zero vector
	if (magnitude === 0) {
		return new Float32Array(vector.length);
	}

	const normalized = new Float32Array(vector.length);
	for (let i = 0; i < vector.length; i++) {
		normalized[i] = vector[i] / magnitude;
	}

	return normalized;
}

/**
 * Compute dot product of two pre-normalized vectors.
 * Equivalent to cosine similarity when vectors are unit length.
 * Faster than cosineSimilarity since it skips magnitude calculation.
 *
 * @param a First normalized vector
 * @param b Second normalized vector
 * @returns Dot product (same as cosine similarity for unit vectors)
 */
export function dotProduct(a: Float32Array | number[], b: Float32Array | number[]): number {
	if (a.length !== b.length) {
		throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
	}

	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		sum += a[i] * b[i];
	}
	return sum;
}
