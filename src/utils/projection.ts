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

export interface UMAPOptions {
	nNeighbors?: number;
	minDist?: number;
	nEpochs?: number;
}

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
const DEFAULT_UMAP_NEIGHBORS = 15;
const DEFAULT_UMAP_MIN_DIST = 0.1;
const DEFAULT_UMAP_EPOCHS_MIN = 200;
const DEFAULT_UMAP_EPOCHS_MAX = 500;
const PCA_OVERSAMPLING = 8;
const PCA_POWER_ITERATIONS = 1;

function clampUMAPNeighbors(n: number, requested?: number): number {
	const fallback = Math.max(3, Math.min(DEFAULT_UMAP_NEIGHBORS, n - 1));
	if (requested == null || !Number.isFinite(requested)) return fallback;
	return Math.max(3, Math.min(Math.round(requested), n - 1));
}

function clampUMAPMinDist(requested?: number): number {
	if (requested == null || !Number.isFinite(requested)) return DEFAULT_UMAP_MIN_DIST;
	return Math.max(0, Math.min(requested, 0.99));
}

function clampUMAPEpochs(n: number, requested?: number): number {
	const fallback = Math.min(DEFAULT_UMAP_EPOCHS_MAX, Math.max(DEFAULT_UMAP_EPOCHS_MIN, n * 2));
	if (requested == null || !Number.isFinite(requested)) return fallback;
	return Math.max(50, Math.min(Math.round(requested), DEFAULT_UMAP_EPOCHS_MAX));
}

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
	umapOptions?: UMAPOptions,
): Promise<Float32Array[]> {
	switch (method) {
		case "umap":
			return umapReduce(vectors, targetDim, umapOptions);
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
	umapOptions?: UMAPOptions,
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
	const data: number[][] = vectors.map((v) => (v instanceof Float32Array ? Array.from(v) : v));

	const nNeighbors = clampUMAPNeighbors(n, umapOptions?.nNeighbors);
	const nEpochs = clampUMAPEpochs(n, umapOptions?.nEpochs);

	const umap = new UMAP({
		nComponents: targetDim,
		nNeighbors,
		minDist: clampUMAPMinDist(umapOptions?.minDist),
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
export function pcaReduce(vectors: (Float32Array | number[])[], targetDim = DEFAULT_REDUCE_DIM): Float32Array[] {
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

	return computePCAScores(vectors, Math.min(targetDim, n - 1, d));
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
	umapOptions?: UMAPOptions,
): Promise<{ x: number; y: number }[]> {
	switch (method) {
		case "umap":
			return umap2D(vectors, spread, umapOptions);
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
export function pca2D(vectors: (Float32Array | number[])[], spread = 500): { x: number; y: number }[] {
	const n = vectors.length;

	if (n === 0) return [];
	if (n === 1) return [{ x: 0, y: 0 }];
	const scores = computePCAScores(vectors, Math.min(2, vectors[0].length, n - 1));
	const raw = scores.map((point) => ({
		x: point[0] ?? 0,
		y: point[1] ?? 0,
	}));

	return normalizeCoordinates(raw, spread);
}

function computePCAScores(vectors: (Float32Array | number[])[], targetDim: number): Float32Array[] {
	const n = vectors.length;
	if (n === 0) return [];
	if (targetDim <= 0) return vectors.map(() => new Float32Array(0));

	const d = vectors[0].length;
	const mean = computeMean(vectors, d);
	const sketchDim = Math.min(d, Math.max(targetDim + PCA_OVERSAMPLING, targetDim));
	const randomBasis = createRandomBasis(d, sketchDim);

	let qColumns = orthonormalizeColumns(multiplyCenteredByBasis(vectors, mean, randomBasis));
	if (qColumns.length === 0) {
		return vectors.map(() => new Float32Array(targetDim));
	}

	for (let i = 0; i < PCA_POWER_ITERATIONS; i++) {
		const lifted = multiplyCenteredTransposeByBasis(vectors, mean, qColumns);
		qColumns = orthonormalizeColumns(multiplyCenteredByBasis(vectors, mean, lifted));
		if (qColumns.length === 0) {
			return vectors.map(() => new Float32Array(targetDim));
		}
	}

	const compressed = multiplyCenteredTransposeByBasis(vectors, mean, qColumns);
	const smallMatrix = buildBasisGramMatrix(compressed);
	const { eigenvectors, eigenvalues } = extractTopEigenpairs(
		smallMatrix,
		qColumns.length,
		Math.min(targetDim, qColumns.length),
	);

	const actualDim = eigenvectors.length;
	if (actualDim === 0) {
		return vectors.map(() => new Float32Array(targetDim));
	}

	const result = Array.from({ length: n }, () => new Float32Array(targetDim));
	for (let component = 0; component < actualDim; component++) {
		const eigenvalue = Math.max(eigenvalues[component], 0);
		if (eigenvalue < 1e-10) continue;
		const scale = Math.sqrt(eigenvalue);
		const basisWeights = eigenvectors[component];
		for (let sample = 0; sample < n; sample++) {
			let score = 0;
			for (let col = 0; col < qColumns.length; col++) {
				score += qColumns[col][sample] * basisWeights[col];
			}
			result[sample][component] = score * scale;
		}
	}

	return result;
}

function computeMean(vectors: (Float32Array | number[])[], dimension: number): Float64Array {
	const mean = new Float64Array(dimension);
	for (const vector of vectors) {
		for (let i = 0; i < dimension; i++) {
			mean[i] += vector[i];
		}
	}
	for (let i = 0; i < dimension; i++) {
		mean[i] /= vectors.length;
	}
	return mean;
}

function createRandomBasis(dimension: number, count: number): Float64Array[] {
	const random = seededRandom();
	return Array.from({ length: count }, () => {
		const basis = new Float64Array(dimension);
		for (let i = 0; i < dimension; i++) {
			basis[i] = random() * 2 - 1;
		}
		return basis;
	});
}

function multiplyCenteredByBasis(
	vectors: (Float32Array | number[])[],
	mean: Float64Array,
	basis: Float64Array[],
): Float64Array[] {
	const columns = basis.map(() => new Float64Array(vectors.length));
	for (let row = 0; row < vectors.length; row++) {
		const vector = vectors[row];
		for (let col = 0; col < basis.length; col++) {
			const basisVector = basis[col];
			let sum = 0;
			for (let dim = 0; dim < mean.length; dim++) {
				sum += (vector[dim] - mean[dim]) * basisVector[dim];
			}
			columns[col][row] = sum;
		}
	}
	return columns;
}

function multiplyCenteredTransposeByBasis(
	vectors: (Float32Array | number[])[],
	mean: Float64Array,
	basis: Float64Array[],
): Float64Array[] {
	const columns = basis.map(() => new Float64Array(mean.length));
	for (let row = 0; row < vectors.length; row++) {
		const vector = vectors[row];
		for (let dim = 0; dim < mean.length; dim++) {
			const centered = vector[dim] - mean[dim];
			for (let col = 0; col < basis.length; col++) {
				columns[col][dim] += centered * basis[col][row];
			}
		}
	}
	return columns;
}

function orthonormalizeColumns(columns: Float64Array[]): Float64Array[] {
	const basis: Float64Array[] = [];
	for (const column of columns) {
		const vector = new Float64Array(column);
		for (const existing of basis) {
			let projection = 0;
			for (let i = 0; i < vector.length; i++) {
				projection += vector[i] * existing[i];
			}
			for (let i = 0; i < vector.length; i++) {
				vector[i] -= projection * existing[i];
			}
		}
		normalize(vector);
		let norm = 0;
		for (let i = 0; i < vector.length; i++) {
			norm += vector[i] * vector[i];
		}
		if (norm > 1e-12) {
			basis.push(vector);
		}
	}
	return basis;
}

function buildBasisGramMatrix(columns: Float64Array[]): Float64Array {
	const size = columns.length;
	const matrix = new Float64Array(size * size);
	for (let i = 0; i < size; i++) {
		for (let j = i; j < size; j++) {
			let dot = 0;
			for (let k = 0; k < columns[i].length; k++) {
				dot += columns[i][k] * columns[j][k];
			}
			matrix[i * size + j] = dot;
			matrix[j * size + i] = dot;
		}
	}
	return matrix;
}

function extractTopEigenpairs(
	matrix: Float64Array,
	size: number,
	count: number,
): { eigenvectors: Float64Array[]; eigenvalues: number[] } {
	const working = new Float64Array(matrix);
	const eigenvectors: Float64Array[] = [];
	const eigenvalues: number[] = [];
	for (let component = 0; component < count; component++) {
		const vector = powerIteration(working, size, 80);
		const eigenvalue = rayleighQuotient(working, vector, size);
		if (eigenvalue < 1e-10) break;
		eigenvectors.push(vector);
		eigenvalues.push(eigenvalue);
		for (let i = 0; i < size; i++) {
			for (let j = 0; j < size; j++) {
				working[i * size + j] -= eigenvalue * vector[i] * vector[j];
			}
		}
	}
	return { eigenvectors, eigenvalues };
}

/**
 * Project high-dimensional vectors into 2D via UMAP.
 *
 * UMAP preserves both local and global structure better than PCA.
 * Parameters are tuned for knowledge-graph-style visualization and support
 * caller-provided UMAP options for neighborhood size and minimum distance.
 * Epoch count still scales with n (capped at 500).
 *
 * @param vectors - Array of embedding vectors (Float32Array or number[])
 * @param spread  - Scale factor for output coordinates (default 500)
 * @returns Array of { x, y } coordinates, one per input vector
 */
export async function umap2D(
	vectors: (Float32Array | number[])[],
	spread = 500,
	umapOptions?: UMAPOptions,
): Promise<{ x: number; y: number }[]> {
	const n = vectors.length;

	if (n === 0) return [];
	if (n === 1) return [{ x: 0, y: 0 }];

	// Convert Float32Arrays to number[][] as required by umap-js
	const data: number[][] = vectors.map((v) => (v instanceof Float32Array ? Array.from(v) : v));

	// UMAP requires nNeighbors < n; fall back to PCA for too-small datasets
	if (n < 4) {
		return pca2D(vectors, spread);
	}

	// Clamp neighbor count to UMAP's requirements: at least 3 and strictly less than n.
	const nNeighbors = clampUMAPNeighbors(n, umapOptions?.nNeighbors);

	// Scale epochs: small datasets converge quickly, large ones need more
	const nEpochs = clampUMAPEpochs(n, umapOptions?.nEpochs);

	const umap = new UMAP({
		nComponents: 2,
		nNeighbors,
		minDist: clampUMAPMinDist(umapOptions?.minDist),
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
function powerIteration(matrix: Float64Array, n: number, maxIter: number): Float64Array {
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
function rayleighQuotient(matrix: Float64Array, v: Float64Array, n: number): number {
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
function normalizeCoordinates(coords: { x: number; y: number }[], spread: number): { x: number; y: number }[] {
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
