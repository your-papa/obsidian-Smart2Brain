/**
 * Clustering Utilities
 *
 * K-Means clustering with cosine distance and silhouette-based auto-K selection.
 * HDBSCAN density-based clustering with EOM cluster selection.
 * Used by the Smart Graph View for semantic clustering of document embeddings.
 *
 * This module is fully self-contained (no external imports) so that it can be
 * serialised and executed inside a Web Worker.
 */

/**
 * Result of a K-Means clustering run.
 */
export interface KMeansResult {
	/** Cluster label for each input vector (index-aligned) */
	labels: number[];
	/** Centroid vectors for each cluster */
	centroids: Float32Array[];
	/** Number of iterations until convergence */
	iterations: number;
}

/**
 * Cosine distance (1 - cosine similarity).
 * Returns a value in [0, 2] where 0 = identical, 2 = opposite.
 */
function cosineDistance(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const ai = a[i];
		const bi = b[i];
		dot += ai * bi;
		normA += ai * ai;
		normB += bi * bi;
	}
	const mag = Math.sqrt(normA) * Math.sqrt(normB);
	if (mag === 0) return 1;
	return 1 - dot / mag;
}

/**
 * Euclidean distance between two vectors.
 */
function euclideanDistance(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		const diff = a[i] - b[i];
		sum += diff * diff;
	}
	return Math.sqrt(sum);
}

/**
 * Compute the mean (centroid) of a set of vectors.
 * Returns a new Float32Array representing the element-wise mean.
 */
function computeCentroid(vectors: Float32Array[]): Float32Array {
	if (vectors.length === 0) {
		throw new Error("Cannot compute centroid of empty set");
	}
	const dim = vectors[0].length;
	const centroid = new Float32Array(dim);

	for (const vec of vectors) {
		for (let i = 0; i < dim; i++) {
			centroid[i] += vec[i];
		}
	}

	for (let i = 0; i < dim; i++) {
		centroid[i] /= vectors.length;
	}

	return centroid;
}

/**
 * Find the nearest centroid for a given vector using cosine distance.
 * Returns the index of the nearest centroid.
 */
function findNearestCentroid(vector: Float32Array, centroids: Float32Array[]): number {
	let minDist = Number.POSITIVE_INFINITY;
	let minIdx = 0;

	for (let i = 0; i < centroids.length; i++) {
		const dist = cosineDistance(vector, centroids[i]);
		if (dist < minDist) {
			minDist = dist;
			minIdx = i;
		}
	}

	return minIdx;
}

/**
 * Initialize centroids using K-Means++ for better convergence.
 * Selects initial centroids that are spread apart.
 */
function initializeCentroidsKMeansPP(vectors: Float32Array[], k: number): Float32Array[] {
	const centroids: Float32Array[] = [];

	// Pick first centroid randomly
	const firstIdx = Math.floor(Math.random() * vectors.length);
	centroids.push(new Float32Array(vectors[firstIdx]));

	// Pick remaining centroids weighted by distance to nearest existing centroid
	for (let c = 1; c < k; c++) {
		const distances: number[] = [];
		let totalDist = 0;

		for (const vec of vectors) {
			let minDist = Number.POSITIVE_INFINITY;
			for (const centroid of centroids) {
				const dist = cosineDistance(vec, centroid);
				if (dist < minDist) minDist = dist;
			}
			distances.push(minDist * minDist); // Square for weighted probability
			totalDist += minDist * minDist;
		}

		// Weighted random selection
		if (totalDist === 0) {
			// All points are identical, pick randomly
			const idx = Math.floor(Math.random() * vectors.length);
			centroids.push(new Float32Array(vectors[idx]));
		} else {
			let r = Math.random() * totalDist;
			let selectedIdx = 0;
			for (let i = 0; i < distances.length; i++) {
				r -= distances[i];
				if (r <= 0) {
					selectedIdx = i;
					break;
				}
			}
			centroids.push(new Float32Array(vectors[selectedIdx]));
		}
	}

	return centroids;
}

/**
 * K-Means clustering using cosine distance.
 *
 * @param vectors Array of embedding vectors to cluster
 * @param k Number of clusters
 * @param maxIterations Maximum iterations before stopping (default: 100)
 * @returns Cluster labels, centroids, and iteration count
 */
export function kMeans(vectors: Float32Array[], k: number, maxIterations = 100): KMeansResult {
	const n = vectors.length;

	// Edge cases
	if (n === 0) {
		return { labels: [], centroids: [], iterations: 0 };
	}
	if (k <= 0) {
		throw new Error("k must be positive");
	}
	if (k >= n) {
		// Each vector is its own cluster
		const labels = vectors.map((_, i) => i);
		const centroids = vectors.map((v) => new Float32Array(v));
		return { labels, centroids, iterations: 0 };
	}
	if (k === 1) {
		const labels = new Array(n).fill(0);
		const centroids = [computeCentroid(vectors)];
		return { labels, centroids, iterations: 0 };
	}

	// Initialize centroids using K-Means++
	let centroids = initializeCentroidsKMeansPP(vectors, k);
	let labels = new Array<number>(n).fill(0);
	let iterations = 0;

	for (let iter = 0; iter < maxIterations; iter++) {
		iterations = iter + 1;
		let changed = false;

		// Assignment step: assign each vector to the nearest centroid
		for (let i = 0; i < n; i++) {
			const newLabel = findNearestCentroid(vectors[i], centroids);
			if (newLabel !== labels[i]) {
				labels[i] = newLabel;
				changed = true;
			}
		}

		// Check convergence
		if (!changed) break;

		// Update step: recompute centroids
		const newCentroids: Float32Array[][] = Array.from({ length: k }, () => []);
		for (let i = 0; i < n; i++) {
			newCentroids[labels[i]].push(vectors[i]);
		}

		centroids = newCentroids.map((cluster, idx) => {
			if (cluster.length === 0) {
				// Empty cluster: keep old centroid
				return centroids[idx];
			}
			return computeCentroid(cluster);
		});
	}

	return { labels, centroids, iterations };
}

/**
 * Compute the silhouette score for a clustering result.
 * Higher scores (closer to 1) indicate better-separated clusters.
 *
 * For performance with large datasets, uses a sampling approach.
 *
 * @param vectors The data points
 * @param labels Cluster assignments
 * @param maxSamples Maximum number of points to evaluate (for performance)
 * @returns Average silhouette score in [-1, 1]
 */
export function silhouetteScore(vectors: Float32Array[], labels: number[], maxSamples = 200): number {
	const n = vectors.length;
	if (n < 2) return 0;

	const uniqueLabels = new Set(labels);
	if (uniqueLabels.size <= 1) return 0;

	// Sample indices for large datasets
	let indices: number[];
	if (n <= maxSamples) {
		indices = Array.from({ length: n }, (_, i) => i);
	} else {
		const idxSet = new Set<number>();
		while (idxSet.size < maxSamples) {
			idxSet.add(Math.floor(Math.random() * n));
		}
		indices = [...idxSet];
	}

	// Group vectors by cluster for efficiency
	const clusters = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const label = labels[i];
		if (!clusters.has(label)) clusters.set(label, []);
		clusters.get(label)?.push(i);
	}

	let totalSilhouette = 0;

	for (const i of indices) {
		const label = labels[i];
		const ownCluster = clusters.get(label)!;

		// a(i) = average distance to points in same cluster
		let a = 0;
		if (ownCluster.length > 1) {
			for (const j of ownCluster) {
				if (j !== i) {
					a += cosineDistance(vectors[i], vectors[j]);
				}
			}
			a /= ownCluster.length - 1;
		}

		// b(i) = minimum average distance to points in any other cluster
		let b = Number.POSITIVE_INFINITY;
		for (const [otherLabel, otherCluster] of clusters) {
			if (otherLabel === label) continue;
			let avgDist = 0;
			for (const j of otherCluster) {
				avgDist += cosineDistance(vectors[i], vectors[j]);
			}
			avgDist /= otherCluster.length;
			if (avgDist < b) b = avgDist;
		}

		// Silhouette coefficient for point i
		const s = a === 0 && b === 0 ? 0 : (b - a) / Math.max(a, b);
		totalSilhouette += s;
	}

	return totalSilhouette / indices.length;
}

/**
 * Auto-suggest the optimal K for K-Means using silhouette analysis.
 * Tests multiple K values and returns the one with the highest silhouette score,
 * along with the corresponding KMeansResult to avoid redundant re-clustering.
 *
 * @param vectors The data points to cluster
 * @param minK Minimum K to test (default: 2)
 * @param maxK Maximum K to test (default: 10)
 * @returns The suggested optimal K and its KMeansResult
 */
export function suggestK(vectors: Float32Array[], minK = 2, maxK = 10): { k: number; result: KMeansResult } {
	const n = vectors.length;

	if (n < 2) return { k: 1, result: kMeans(vectors, 1) };

	// Adjust maxK based on data size
	const effectiveMaxK = Math.min(maxK, Math.floor(n / 2), n - 1);
	const effectiveMinK = Math.min(minK, effectiveMaxK);

	if (effectiveMinK >= effectiveMaxK) {
		return { k: effectiveMinK, result: kMeans(vectors, effectiveMinK) };
	}

	let bestK = effectiveMinK;
	let bestResult = kMeans(vectors, effectiveMinK);
	let bestScore = silhouetteScore(vectors, bestResult.labels);

	for (let k = effectiveMinK + 1; k <= effectiveMaxK; k++) {
		const result = kMeans(vectors, k);
		const score = silhouetteScore(vectors, result.labels);

		if (score > bestScore) {
			bestScore = score;
			bestK = k;
			bestResult = result;
		}
	}

	return { k: bestK, result: bestResult };
}

// ============================================================================
// HDBSCAN
// ============================================================================

/**
 * Result of an HDBSCAN clustering run.
 */
export interface HDBSCANResult {
	/** Cluster label for each input vector. -1 = noise (unassigned). */
	labels: number[];
	/** Number of clusters found (excluding noise). */
	numClusters: number;
}

const HDBSCAN_EPSILON = 1e-9;

function weightToLambda(weight: number): number {
	return weight > 0 ? 1 / weight : Number.MAX_SAFE_INTEGER;
}

/**
 * Compute the mutual reachability distance between two points.
 * mrd(a, b) = max(coreDist(a), coreDist(b), dist(a, b))
 */
function mutualReachabilityDistance(distAB: number, coreDistA: number, coreDistB: number): number {
	return Math.max(coreDistA, coreDistB, distAB);
}

function insertIntoSortedWindow(window: Float64Array, length: number, value: number): void {
	let insertAt = length;
	while (insertAt > 0 && value < window[insertAt - 1]) {
		if (insertAt < window.length) {
			window[insertAt] = window[insertAt - 1];
		}
		insertAt--;
	}
	if (insertAt < window.length) {
		window[insertAt] = value;
	}
}

/**
 * Compute the core distance for each point.
 * The core distance of a point is the distance to its k-th nearest neighbor.
 */
function computeCoreDistances(distMatrix: Float64Array, n: number, minSamples: number): Float64Array {
	const coreDistances = new Float64Array(n);
	const k = Math.min(minSamples, n - 1);

	for (let i = 0; i < n; i++) {
		if (k === 0) {
			coreDistances[i] = 0;
			continue;
		}

		const nearest = new Float64Array(k).fill(Number.POSITIVE_INFINITY);
		let count = 0;
		for (let j = 0; j < n; j++) {
			if (i === j) continue;
			const distance = distMatrix[i * n + j];
			if (count < k) {
				insertIntoSortedWindow(nearest, count, distance);
				count++;
			} else if (distance < nearest[k - 1]) {
				insertIntoSortedWindow(nearest, k - 1, distance);
			}
		}
		coreDistances[i] = nearest[k - 1];
	}

	return coreDistances;
}

/**
 * Union-Find data structure for Kruskal's MST and cluster extraction.
 */
class UnionFind {
	parent: Int32Array;
	rank: Uint8Array;
	size: Int32Array;

	constructor(n: number) {
		this.parent = new Int32Array(n);
		this.rank = new Uint8Array(n);
		this.size = new Int32Array(n);
		for (let i = 0; i < n; i++) {
			this.parent[i] = i;
			this.size[i] = 1;
		}
	}

	find(x: number): number {
		let root = x;
		while (this.parent[root] !== root) root = this.parent[root];
		// Path compression
		while (this.parent[x] !== root) {
			const next = this.parent[x];
			this.parent[x] = root;
			x = next;
		}
		return root;
	}

	union(x: number, y: number): boolean {
		const rx = this.find(x);
		const ry = this.find(y);
		if (rx === ry) return false;
		if (this.rank[rx] < this.rank[ry]) {
			this.parent[rx] = ry;
			this.size[ry] += this.size[rx];
		} else if (this.rank[rx] > this.rank[ry]) {
			this.parent[ry] = rx;
			this.size[rx] += this.size[ry];
		} else {
			this.parent[ry] = rx;
			this.size[rx] += this.size[ry];
			this.rank[rx]++;
		}
		return true;
	}
}

/**
 * Build a minimum spanning tree from the mutual reachability distance graph
 * using a Prim-like approach.
 *
 * Returns edges sorted by weight (ascending).
 */
function buildMST(
	distMatrix: Float64Array,
	coreDistances: Float64Array,
	n: number,
): { from: number; to: number; weight: number }[] {
	const inMST = new Uint8Array(n);
	const minWeight = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
	const minFrom = new Int32Array(n).fill(-1);
	const edges: { from: number; to: number; weight: number }[] = [];

	// Start from node 0
	inMST[0] = 1;
	for (let j = 1; j < n; j++) {
		minWeight[j] = mutualReachabilityDistance(distMatrix[j], coreDistances[0], coreDistances[j]);
		minFrom[j] = 0;
	}

	for (let step = 1; step < n; step++) {
		// Find the closest node not yet in the MST
		let best = -1;
		let bestWeight = Number.POSITIVE_INFINITY;
		for (let j = 0; j < n; j++) {
			if (!inMST[j] && minWeight[j] < bestWeight) {
				bestWeight = minWeight[j];
				best = j;
			}
		}
		if (best === -1) break;

		inMST[best] = 1;
		edges.push({ from: minFrom[best], to: best, weight: bestWeight });

		// Update minimum weights for remaining nodes
		for (let j = 0; j < n; j++) {
			if (inMST[j]) continue;
			const mrd = mutualReachabilityDistance(distMatrix[best * n + j], coreDistances[best], coreDistances[j]);
			if (mrd < minWeight[j]) {
				minWeight[j] = mrd;
				minFrom[j] = best;
			}
		}
	}

	edges.sort((a, b) => a.weight - b.weight);
	return edges;
}

interface SingleLinkageNode {
	left: number;
	right: number;
	size: number;
	lambda: number;
	point: number;
}

function buildSingleLinkageTree(
	edges: { from: number; to: number; weight: number }[],
	n: number,
): { nodes: SingleLinkageNode[]; rootId: number } {
	const uf = new UnionFind(n);
	const componentNodes = new Int32Array(n);
	const nodes: SingleLinkageNode[] = Array.from({ length: n }, (_, point) => ({
		left: -1,
		right: -1,
		size: 1,
		lambda: Number.MAX_SAFE_INTEGER,
		point,
	}));

	for (let i = 0; i < n; i++) {
		componentNodes[i] = i;
	}

	for (const edge of edges) {
		const rootFrom = uf.find(edge.from);
		const rootTo = uf.find(edge.to);
		if (rootFrom === rootTo) continue;

		const leftNode = componentNodes[rootFrom];
		const rightNode = componentNodes[rootTo];
		const newNodeId = nodes.length;
		nodes.push({
			left: leftNode,
			right: rightNode,
			size: nodes[leftNode].size + nodes[rightNode].size,
			lambda: weightToLambda(edge.weight),
			point: -1,
		});

		uf.union(rootFrom, rootTo);
		componentNodes[uf.find(rootFrom)] = newNodeId;
	}

	const rootId = componentNodes[uf.find(0)];
	return { nodes, rootId };
}

interface CondensedCluster {
	nodeId: number;
	parent: number | null;
	children: number[];
	birthLambda: number;
	deathLambda: number;
	stability: number;
	selectable: boolean;
	selected: boolean;
	subtreeStability: number;
}

function collectLeafPoints(nodeId: number, nodes: SingleLinkageNode[], output: number[]): void {
	if (nodeId < 0) return;
	const node = nodes[nodeId];
	if (node.left === -1) {
		output.push(node.point);
		return;
	}
	collectLeafPoints(node.left, nodes, output);
	collectLeafPoints(node.right, nodes, output);
}

function condenseSingleLinkageTree(
	nodes: SingleLinkageNode[],
	rootId: number,
	minClusterSize: number,
): CondensedCluster[] {
	const clusters: CondensedCluster[] = [];

	function createCluster(nodeId: number, birthLambda: number, parent: number | null, selectable: boolean): number {
		const clusterId = clusters.length;
		clusters.push({
			nodeId,
			parent,
			children: [],
			birthLambda,
			deathLambda: birthLambda,
			stability: 0,
			selectable,
			selected: false,
			subtreeStability: 0,
		});
		if (parent !== null) {
			clusters[parent].children.push(clusterId);
		}
		return clusterId;
	}

	function expandCluster(clusterId: number, nodeId: number): void {
		const cluster = clusters[clusterId];
		const node = nodes[nodeId];
		cluster.nodeId = nodeId;

		if (node.left === -1) {
			cluster.deathLambda = cluster.birthLambda;
			return;
		}

		const splitLambda = node.lambda;
		const leftNode = nodes[node.left];
		const rightNode = nodes[node.right];
		const leftLarge = leftNode.size >= minClusterSize;
		const rightLarge = rightNode.size >= minClusterSize;

		if (leftLarge && rightLarge) {
			cluster.deathLambda = splitLambda;
			cluster.stability += node.size * Math.max(0, splitLambda - cluster.birthLambda);

			const leftCluster = createCluster(node.left, splitLambda, clusterId, true);
			const rightCluster = createCluster(node.right, splitLambda, clusterId, true);
			expandCluster(leftCluster, node.left);
			expandCluster(rightCluster, node.right);
			return;
		}

		if (leftLarge || rightLarge) {
			cluster.stability +=
				(leftLarge ? rightNode.size : leftNode.size) * Math.max(0, splitLambda - cluster.birthLambda);
			expandCluster(clusterId, leftLarge ? node.left : node.right);
			return;
		}

		cluster.deathLambda = splitLambda;
		cluster.stability += node.size * Math.max(0, splitLambda - cluster.birthLambda);
	}

	const rootCluster = createCluster(rootId, 0, null, false);
	expandCluster(rootCluster, rootId);
	return clusters;
}

function selectEomClusters(clusters: CondensedCluster[]): number[] {
	if (clusters.length === 0) return [];

	for (let i = clusters.length - 1; i >= 0; i--) {
		const cluster = clusters[i];
		if (cluster.children.length === 0) {
			cluster.subtreeStability = cluster.selectable ? cluster.stability : 0;
			cluster.selected = cluster.selectable && cluster.stability > HDBSCAN_EPSILON;
			continue;
		}

		let childSum = 0;
		for (const childId of cluster.children) {
			childSum += clusters[childId].subtreeStability;
		}

		const chooseSelf =
			cluster.selectable && cluster.stability > HDBSCAN_EPSILON && cluster.stability > childSum + HDBSCAN_EPSILON;

		cluster.subtreeStability = chooseSelf ? cluster.stability : childSum;
		cluster.selected = chooseSelf;
	}

	const selected: number[] = [];
	const stack = [0];
	while (stack.length > 0) {
		const clusterId = stack.pop()!;
		const cluster = clusters[clusterId];
		if (cluster.selected) {
			selected.push(clusterId);
			continue;
		}
		for (let i = cluster.children.length - 1; i >= 0; i--) {
			stack.push(cluster.children[i]);
		}
	}

	return selected;
}

/**
 * Extract flat clusters from the mutual-reachability MST by:
 * 1. Building the single-linkage tree induced by the MST.
 * 2. Condensing that tree with HDBSCAN's minClusterSize semantics.
 * 3. Applying EOM selection to the condensed hierarchy.
 */
function extractClusters(
	edges: { from: number; to: number; weight: number }[],
	n: number,
	minClusterSize: number,
): number[] {
	if (n < 2) return n === 1 ? [0] : [];

	const { nodes, rootId } = buildSingleLinkageTree(edges, n);
	const condensed = condenseSingleLinkageTree(nodes, rootId, minClusterSize);
	const selectedClusters = selectEomClusters(condensed);
	const labels = new Int32Array(n).fill(-1);

	for (let label = 0; label < selectedClusters.length; label++) {
		const members: number[] = [];
		collectLeafPoints(condensed[selectedClusters[label]].nodeId, nodes, members);
		for (const point of members) {
			labels[point] = label;
		}
	}

	return Array.from(labels);
}

/**
 * HDBSCAN clustering.
 *
 * Hierarchical Density-Based Spatial Clustering of Applications with Noise.
 * Automatically determines the number of clusters based on density.
 * Points in low-density regions remain labeled as noise (-1).
 *
 * @param vectors Array of vectors to cluster
 * @param minClusterSize Minimum number of points to form a cluster (default: 5)
 * @param minSamples Number of neighbors for core distance (default: same as minClusterSize)
 * @param metric Distance metric: "cosine" for high-D embeddings, "euclidean" for projected 2D positions (default: "cosine")
 * @returns Cluster labels and number of clusters found
 */
export function hdbscan(
	vectors: Float32Array[],
	minClusterSize = 5,
	minSamples?: number,
	metric: "cosine" | "euclidean" = "cosine",
): HDBSCANResult {
	const n = vectors.length;
	const effectiveMinSamples = minSamples ?? minClusterSize;

	if (n === 0) {
		return { labels: [], numClusters: 0 };
	}
	if (n < minClusterSize) {
		return { labels: new Array(n).fill(-1), numClusters: 0 };
	}

	// Build full pairwise distance matrix
	const distFn = metric === "euclidean" ? euclideanDistance : cosineDistance;
	const distMatrix = new Float64Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const d = distFn(vectors[i], vectors[j]);
			distMatrix[i * n + j] = d;
			distMatrix[j * n + i] = d;
		}
	}

	// Compute core distances
	const coreDistances = computeCoreDistances(distMatrix, n, effectiveMinSamples);

	// Build MST on mutual reachability graph
	const mstEdges = buildMST(distMatrix, coreDistances, n);

	// Extract clusters using the condensed tree
	const labels = extractClusters(mstEdges, n, minClusterSize);
	const numClusters = new Set(labels.filter((label) => label >= 0)).size;
	return { labels, numClusters };
}
