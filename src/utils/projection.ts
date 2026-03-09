/**
 * Dimensionality reduction for projecting embeddings.
 *
 * Supports multiple algorithms:
 * - PCA: Fast linear projection via Gram matrix (X·Xᵀ, n×n)
 * - UMAP: Non-linear projection preserving local + global structure
 *
 * Includes both intermediate reduction (high-dim → medium-dim for clustering)
 * and final 2D projection for visualization.
 */

import { UMAP } from "umap-js";

import type { ProjectionMethod } from "../types/graph";

/** Seeded PRNG (mulberry32) for deterministic UMAP results. */
function seededRandom(seed = 42): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Cosine distance for UMAP: 1 - cos(a, b). */
function umapCosineDistance(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (denom < 1e-15) return 1;
	return 1 - dot / denom;
}

/** Default number of components for intermediate dimensionality reduction. */
const DEFAULT_REDUCE_DIM = 50;

/**
 * Reduce high-dimensional vectors to an intermediate dimensionality.
 *
 * Dispatches to PCA or UMAP based on `method`. Meant as a preprocessing step
 * before clustering: keeps enough structure for meaningful clusters while
 * being far cheaper than the original space.
 *
 * @param vectors   - Array of embedding vectors (Float32Array or number[])
 * @param method    - Reduction algorithm: "pca" (fast) or "umap" (better structure)
 * @param targetDim - Number of components to keep (default 50)
 * @returns Array of Float32Array with reduced dimensionality
 */
export async function reduceDimensions(
	vectors: (Float32Array | number[])[],
	method: ProjectionMethod = "pca",
	targetDim = DEFAULT_REDUCE_DIM,
): Promise<Float32Array[]> {
	switch (method) {
		case "umap":
			return umapReduce(vectors, targetDim);
		case "pca":
			return pcaReduce(vectors, targetDim);
		default:
			return pcaReduce(vectors, targetDim);
	}
}

/**
 * Reduce high-dimensional vectors to an intermediate dimensionality via UMAP.
 *
 * UMAP preserves non-linear relationships better than PCA, producing a
 * reduced space where density-based clustering (HDBSCAN) works particularly
 * well. Slower than PCA but produces higher-quality clustering input.
 *
 * @param vectors   - Array of embedding vectors (Float32Array or number[])
 * @param targetDim - Number of UMAP components to keep (default 50)
 * @returns Array of Float32Array with reduced dimensionality
 */
export async function umapReduce(
	vectors: (Float32Array | number[])[],
	targetDim = DEFAULT_REDUCE_DIM,
): Promise<Float32Array[]> {
	const n = vectors.length;
	if (n === 0) return [];

	const d = vectors[0].length;

	// No reduction needed if already low-dimensional
	if (d <= targetDim) {
		return vectors.map((v) => new Float32Array(v));
	}

	if (n === 1) {
		return [new Float32Array(targetDim)];
	}

	// UMAP needs nNeighbors < n; fall back to PCA for tiny datasets
	if (n < 4) {
		return pcaReduce(vectors, targetDim);
	}

	// Convert to number[][] as required by umap-js
	const data: number[][] = vectors.map((v) =>
		v instanceof Float32Array ? Array.from(v) : v,
	);

	const nNeighbors = Math.max(3, Math.min(15, n - 1));
	const nEpochs = Math.min(500, Math.max(200, n * 2));

	const umap = new UMAP({
		nComponents: targetDim,
		nNeighbors,
		minDist: 0.1,
		spread: 1,
		nEpochs,
		distanceFn: umapCosineDistance,
		random: seededRandom(),
	});

	const totalEpochs = umap.initializeFit(data);
	const yieldInterval = 50;
	for (let epoch = 0; epoch < totalEpochs; epoch++) {
		umap.step();
		if ((epoch + 1) % yieldInterval === 0) {
			await new Promise<void>((r) => setTimeout(r, 0));
		}
	}
	const embedding = umap.getEmbedding();

	return embedding.map((point: number[]) => new Float32Array(point));
}

/**
 * Reduce high-dimensional vectors to an intermediate dimensionality via PCA.
 *
 * Fast linear projection that preserves the directions of greatest variance.
 * If the input dimensionality is already ≤ targetDim, returns copies of the
 * original vectors (no-op).
 *
 * @param vectors   - Array of embedding vectors (Float32Array or number[])
 * @param targetDim - Number of principal components to keep (default 50)
 * @returns Array of Float32Array with reduced dimensionality
 */
export function pcaReduce(
	vectors: (Float32Array | number[])[],
	targetDim = DEFAULT_REDUCE_DIM,
): Float32Array[] {
	const n = vectors.length;
	if (n === 0) return [];

	const d = vectors[0].length;

	// No reduction needed if already low-dimensional
	if (d <= targetDim) {
		return vectors.map((v) => new Float32Array(v));
	}

	if (n === 1) {
		// Single vector — just zero-pad to targetDim
		return [new Float32Array(targetDim)];
	}

	// Clamp to max extractable components (n-1 from Gram matrix)
	const nComponents = Math.min(targetDim, n - 1);

	// 1. Compute the mean vector
	const mean = new Float64Array(d);
	for (const v of vectors) {
		for (let j = 0; j < d; j++) mean[j] += v[j];
	}
	for (let j = 0; j < d; j++) mean[j] /= n;

	// 2. Center the data
	const centered: Float64Array[] = vectors.map((v) => {
		const c = new Float64Array(d);
		for (let j = 0; j < d; j++) c[j] = v[j] - mean[j];
		return c;
	});

	// 3. Gram matrix K = X·Xᵀ (n × n)
	const K = new Float64Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = i; j < n; j++) {
			let dot = 0;
			for (let k = 0; k < d; k++) dot += centered[i][k] * centered[j][k];
			K[i * n + j] = dot;
			K[j * n + i] = dot;
		}
	}

	// 4. Extract top-nComponents eigenvectors via power iteration + deflation
	const eigenvectors: Float64Array[] = [];
	const eigenvalues: number[] = [];

	for (let c = 0; c < nComponents; c++) {
		const v = powerIteration(K, n, 200);
		const lambda = rayleighQuotient(K, v, n);

		if (lambda < 1e-10) break; // remaining components have near-zero variance

		eigenvectors.push(v);
		eigenvalues.push(lambda);

		// Deflate: K ← K − λ·v·vᵀ
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < n; j++) {
				K[i * n + j] -= lambda * v[i] * v[j];
			}
		}
	}

	const actualDim = eigenvectors.length;
	if (actualDim === 0) {
		// Degenerate case — all zero variance
		return vectors.map(() => new Float32Array(nComponents));
	}

	// 5. Project: coordinate j of sample i = sqrt(λⱼ) · vⱼ[i]
	const result: Float32Array[] = [];
	for (let i = 0; i < n; i++) {
		const reduced = new Float32Array(nComponents);
		for (let j = 0; j < actualDim; j++) {
			reduced[j] = eigenvectors[j][i] * Math.sqrt(eigenvalues[j]);
		}
		result.push(reduced);
	}

	return result;
}

/**
 * Project high-dimensional vectors into 2D using the specified method.
 *
 * @param vectors - Array of embedding vectors (Float32Array or number[])
 * @param method  - Projection algorithm: "pca" or "umap"
 * @param spread  - Scale factor for output coordinates (default 500)
 * @returns Array of { x, y } coordinates, one per input vector
 */
export async function project2D(
	vectors: (Float32Array | number[])[],
	method: ProjectionMethod = "umap",
	spread = 500,
): Promise<{ x: number; y: number }[]> {
	switch (method) {
		case "umap":
			return umap2D(vectors, spread);
		case "pca":
			return pca2D(vectors, spread);
		default:
			return pca2D(vectors, spread);
	}
}

/**
 * Project high-dimensional vectors into 2D via PCA.
 *
 * @param vectors - Array of embedding vectors (Float32Array or number[])
 * @param spread  - Scale factor for output coordinates (default 500)
 * @returns Array of { x, y } coordinates, one per input vector
 */
export function pca2D(
	vectors: (Float32Array | number[])[],
	spread = 500,
): { x: number; y: number }[] {
	const n = vectors.length;

	if (n === 0) return [];
	if (n === 1) return [{ x: 0, y: 0 }];

	const d = vectors[0].length;

	// 1. Compute the mean vector
	const mean = new Float64Array(d);
	for (const v of vectors) {
		for (let j = 0; j < d; j++) mean[j] += v[j];
	}
	for (let j = 0; j < d; j++) mean[j] /= n;

	// 2. Center the data
	const centered: Float64Array[] = vectors.map((v) => {
		const c = new Float64Array(d);
		for (let j = 0; j < d; j++) c[j] = v[j] - mean[j];
		return c;
	});

	// 3. Compute Gram matrix K = X·Xᵀ (n × n)
	//    K[i][j] = dot(centered[i], centered[j])
	const K = new Float64Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = i; j < n; j++) {
			let dot = 0;
			for (let k = 0; k < d; k++) dot += centered[i][k] * centered[j][k];
			K[i * n + j] = dot;
			K[j * n + i] = dot;
		}
	}

	// 4. Find top eigenvector via power iteration
	const v1 = powerIteration(K, n, 200);
	const lambda1 = rayleighQuotient(K, v1, n);

	// 5. Deflate: K' = K - λ₁·v₁·v₁ᵀ
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			K[i * n + j] -= lambda1 * v1[i] * v1[j];
		}
	}

	// 6. Find second eigenvector
	const v2 = powerIteration(K, n, 200);
	const lambda2 = rayleighQuotient(K, v2, n);

	// 7. Scale eigenvectors by sqrt(eigenvalue) to get PCA projections
	const scale1 = Math.sqrt(Math.max(lambda1, 0));
	const scale2 = Math.sqrt(Math.max(lambda2, 0));

	const raw = vectors.map((_, i) => ({
		x: v1[i] * scale1,
		y: v2[i] * scale2,
	}));

	// 8. Normalize to [-spread, spread] range
	return normalizeCoordinates(raw, spread);
}

/**
 * Project high-dimensional vectors into 2D via UMAP.
 *
 * UMAP preserves both local and global structure better than PCA.
 * Parameters are tuned for knowledge-graph-style visualization:
 * - nNeighbors: 15 (balances local vs global focus)
 * - minDist: 0.1 (allows tight clusters)
 * - nEpochs: scales with n (more points = more epochs, capped at 500)
 *
 * @param vectors - Array of embedding vectors (Float32Array or number[])
 * @param spread  - Scale factor for output coordinates (default 500)
 * @returns Array of { x, y } coordinates, one per input vector
 */
export async function umap2D(
	vectors: (Float32Array | number[])[],
	spread = 500,
): Promise<{ x: number; y: number }[]> {
	const n = vectors.length;

	if (n === 0) return [];
	if (n === 1) return [{ x: 0, y: 0 }];

	// Convert Float32Arrays to number[][] as required by umap-js
	const data: number[][] = vectors.map((v) =>
		v instanceof Float32Array ? Array.from(v) : v,
	);

	// UMAP requires nNeighbors < n; fall back to PCA for too-small datasets
	if (n < 4) {
		return pca2D(vectors, spread);
	}

	// Scale nNeighbors with data: at least 3, at most 15, strictly less than n
	const nNeighbors = Math.max(3, Math.min(15, n - 1));

	// Scale epochs: small datasets converge quickly, large ones need more
	const nEpochs = Math.min(500, Math.max(200, n * 2));

	const umap = new UMAP({
		nComponents: 2,
		nNeighbors,
		minDist: 0.1,
		spread: 1,
		nEpochs,
		distanceFn: umapCosineDistance,
		random: seededRandom(),
	});

	// Use incremental fitting to yield to the event loop periodically,
	// preventing UI freezes on large vaults.
	const totalEpochs = umap.initializeFit(data);
	const yieldInterval = 50;
	for (let epoch = 0; epoch < totalEpochs; epoch++) {
		umap.step();
		if ((epoch + 1) % yieldInterval === 0) {
			await new Promise<void>((r) => setTimeout(r, 0));
		}
	}
	const embedding = umap.getEmbedding();

	const raw = embedding.map((point: number[]) => ({
		x: point[0],
		y: point[1],
	}));

	return normalizeCoordinates(raw, spread);
}

/**
 * Power iteration to find the dominant eigenvector of a symmetric matrix.
 */
function powerIteration(
	matrix: Float64Array,
	n: number,
	maxIter: number,
): Float64Array {
	const v = new Float64Array(n);

	// Deterministic initialization: use index-based seeding
	for (let i = 0; i < n; i++) {
		v[i] = Math.sin(i * 2.39996323 + 1.0) + 0.5; // golden-angle-ish spread
	}
	normalize(v);

	for (let iter = 0; iter < maxIter; iter++) {
		// w = matrix · v
		const w = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			let sum = 0;
			for (let j = 0; j < n; j++) sum += matrix[i * n + j] * v[j];
			w[i] = sum;
		}

		// Check for zero vector (degenerate case)
		let norm = 0;
		for (let i = 0; i < n; i++) norm += w[i] * w[i];
		if (norm < 1e-15) break;
		norm = Math.sqrt(norm);

		// Check convergence: |w/||w|| - v|
		let diff = 0;
		for (let i = 0; i < n; i++) {
			const wn = w[i] / norm;
			diff += (wn - v[i]) * (wn - v[i]);
			v[i] = wn;
		}
		if (diff < 1e-12) break;
	}

	return v;
}

/**
 * Compute the Rayleigh quotient: vᵀMv / vᵀv
 */
function rayleighQuotient(
	matrix: Float64Array,
	v: Float64Array,
	n: number,
): number {
	let numerator = 0;
	for (let i = 0; i < n; i++) {
		let Mv_i = 0;
		for (let j = 0; j < n; j++) Mv_i += matrix[i * n + j] * v[j];
		numerator += v[i] * Mv_i;
	}
	return numerator;
}

/**
 * Normalize a vector in-place to unit length.
 */
function normalize(v: Float64Array): void {
	let norm = 0;
	for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
	norm = Math.sqrt(norm);
	if (norm > 1e-15) {
		for (let i = 0; i < v.length; i++) v[i] /= norm;
	}
}

/**
 * Scale coordinates to fit within [-spread, spread] while preserving aspect ratio.
 */
function normalizeCoordinates(
	coords: { x: number; y: number }[],
	spread: number,
): { x: number; y: number }[] {
	if (coords.length === 0) return [];

	let maxAbs = 0;
	for (const c of coords) {
		maxAbs = Math.max(maxAbs, Math.abs(c.x), Math.abs(c.y));
	}

	if (maxAbs < 1e-10) {
		// All points collapsed — fall back to circular layout
		return coords.map((_, i) => {
			const angle = (2 * Math.PI * i) / coords.length;
			return { x: Math.cos(angle) * spread * 0.5, y: Math.sin(angle) * spread * 0.5 };
		});
	}

	const scale = spread / maxAbs;
	return coords.map((c) => ({ x: c.x * scale, y: c.y * scale }));
}
