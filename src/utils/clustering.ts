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
        clusters.get(label)!.push(i);
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

/**
 * Compute the mutual reachability distance between two points.
 * mrd(a, b) = max(coreDist(a), coreDist(b), dist(a, b))
 */
function mutualReachabilityDistance(distAB: number, coreDistA: number, coreDistB: number): number {
    return Math.max(coreDistA, coreDistB, distAB);
}

/**
 * Compute the core distance for each point.
 * The core distance of a point is the distance to its k-th nearest neighbor.
 */
function computeCoreDistances(distMatrix: Float64Array, n: number, minSamples: number): Float64Array {
    const coreDistances = new Float64Array(n);
    const k = Math.min(minSamples, n - 1);

    for (let i = 0; i < n; i++) {
        // Collect distances from point i to all other points
        const distances: number[] = [];
        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            distances.push(distMatrix[i * n + j]);
        }
        distances.sort((a, b) => a - b);
        coreDistances[i] = k > 0 ? distances[k - 1] : 0;
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
            const mrd = mutualReachabilityDistance(
                distMatrix[best * n + j],
                coreDistances[best],
                coreDistances[j],
            );
            if (mrd < minWeight[j]) {
                minWeight[j] = mrd;
                minFrom[j] = best;
            }
        }
    }

    edges.sort((a, b) => a.weight - b.weight);
    return edges;
}

/**
 * Extract flat clusters from the MST using a bottom-up condensed tree
 * with the Excess of Mass (EOM) cluster selection method.
 *
 * Processes sorted MST edges (ascending weight) and tracks three merge cases:
 * 1. Two small groups (both < minClusterSize) merge to form a new cluster → leaf in hierarchy
 * 2. Two large groups (both ≥ minClusterSize) merge → parent cluster with two children
 * 3. Small group merges into large group → cluster grows, noise points absorbed
 *
 * Each point records its own λ_p (1/weight at time of absorption), and stability
 * is computed as Σ(λ_p − λ_min) per cluster.
 */
function extractClusters(
    edges: { from: number; to: number; weight: number }[],
    n: number,
    minClusterSize: number,
): number[] {
    if (n < 2) return n === 1 ? [0] : [];

    const uf = new UnionFind(n);

    // Track current groups: rootIndex → array of point indices in that group
    const currentGroups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        currentGroups.set(i, [i]);
    }

    // Hierarchy entries built bottom-up
    interface HierarchyEntry {
        childrenClusters: [number, number] | null; // indices into hierarchy array
        elements: number[]; // point indices
        lambdaPs: number[]; // per-point λ values (1/weight at absorption)
        lambdaMin: number | null; // λ at which this cluster dies (set when merged into parent)
        lambdaMax: number; // λ at which this cluster was born
    }
    const hierarchy: HierarchyEntry[] = [];

    // Map: UF root → index in hierarchy array
    const rootToHierarchy = new Map<number, number>();

    for (const edge of edges) {
        const rootFrom = uf.find(edge.from);
        const rootTo = uf.find(edge.to);
        if (rootFrom === rootTo) continue;

        const sizeFrom = currentGroups.get(rootFrom)!.length;
        const sizeTo = currentGroups.get(rootTo)!.length;
        const newSize = sizeFrom + sizeTo;
        const lambda = edge.weight > 0 ? 1 / edge.weight : Number.MAX_SAFE_INTEGER;

        uf.union(edge.from, edge.to);
        const newRoot = uf.find(edge.from);
        const newElements = currentGroups.get(rootFrom)!.concat(currentGroups.get(rootTo)!);

        if (newSize >= minClusterSize && sizeFrom < minClusterSize && sizeTo < minClusterSize) {
            // Case 1: Two noise groups merge to form a new leaf cluster
            hierarchy.push({
                childrenClusters: null,
                elements: newElements,
                lambdaPs: new Array(newElements.length).fill(lambda),
                lambdaMin: null,
                lambdaMax: lambda,
            });
            rootToHierarchy.set(newRoot, hierarchy.length - 1);
        } else if (newSize >= minClusterSize && sizeFrom >= minClusterSize && sizeTo >= minClusterSize) {
            // Case 2: Two clusters merge to form a parent cluster
            const leftIdx = rootToHierarchy.get(rootFrom)!;
            const rightIdx = rootToHierarchy.get(rootTo)!;

            hierarchy.push({
                childrenClusters: [leftIdx, rightIdx],
                elements: newElements,
                lambdaPs: new Array(newElements.length).fill(lambda),
                lambdaMin: null,
                lambdaMax: lambda,
            });

            // Children die at this lambda
            hierarchy[leftIdx].lambdaMin = lambda;
            hierarchy[rightIdx].lambdaMin = lambda;

            rootToHierarchy.set(newRoot, hierarchy.length - 1);
        } else if (newSize >= minClusterSize) {
            // Case 3: Noise group absorbed into existing cluster
            if (rootToHierarchy.get(newRoot) === undefined) {
                // UF made the noise group's root the new root — reassign
                const existingIdx = rootToHierarchy.get(rootFrom) ?? rootToHierarchy.get(rootTo);
                if (existingIdx !== undefined) {
                    rootToHierarchy.set(newRoot, existingIdx);
                }
            }
            const hIdx = rootToHierarchy.get(newRoot);
            if (hIdx !== undefined) {
                const cluster = hierarchy[hIdx];
                cluster.elements = newElements;
                const noiseSize = sizeFrom < minClusterSize ? sizeFrom : sizeTo;
                for (let i = 0; i < noiseSize; i++) {
                    cluster.lambdaPs.push(lambda);
                }
            }
        }
        // else: both groups small and combined still small → stays noise

        currentGroups.set(newRoot, newElements);
        currentGroups.delete(newRoot === rootFrom ? rootTo : rootFrom);
    }

    // Remove the root entry (last hierarchy entry spans everything — not useful)
    if (hierarchy.length > 0) {
        hierarchy.pop();
    }

    if (hierarchy.length === 0) {
        // No clusters formed — assign everything to cluster 0
        return new Array(n).fill(0);
    }

    // Compute stability for each cluster: Σ(λ_p − λ_min) for all points
    const stabilities = new Float64Array(hierarchy.length);
    for (let i = 0; i < hierarchy.length; i++) {
        const h = hierarchy[i];
        const lMin = h.lambdaMin ?? 0;
        for (const lp of h.lambdaPs) {
            stabilities[i] += lp - lMin;
        }
    }

    // EOM cluster selection (bottom-up since hierarchy is in topological order)
    const isSelected = new Uint8Array(hierarchy.length);
    const sHat = new Float64Array(hierarchy.length);

    for (let i = 0; i < hierarchy.length; i++) {
        if (hierarchy[i].childrenClusters === null) {
            // Leaf cluster
            sHat[i] = stabilities[i];
            isSelected[i] = 1;
        } else {
            const [leftIdx, rightIdx] = hierarchy[i].childrenClusters!;
            const childSum = sHat[leftIdx] + sHat[rightIdx];

            if (stabilities[i] < childSum) {
                // Children are more stable
                sHat[i] = childSum;
                isSelected[i] = 0;
            } else {
                // Parent is more stable — select it, deselect children
                sHat[i] = stabilities[i];
                isSelected[i] = 1;
                isSelected[leftIdx] = 0;
                isSelected[rightIdx] = 0;
            }
        }
    }

    // Assign labels from selected clusters
    const labels = new Int32Array(n).fill(-1);
    let labelCounter = 0;
    for (let i = 0; i < hierarchy.length; i++) {
        if (isSelected[i]) {
            for (const p of hierarchy[i].elements) {
                labels[p] = labelCounter;
            }
            labelCounter++;
        }
    }

    if (labelCounter === 0) {
        for (let i = 0; i < n; i++) labels[i] = 0;
    }

    return Array.from(labels);
}

/**
 * HDBSCAN clustering.
 *
 * Hierarchical Density-Based Spatial Clustering of Applications with Noise.
 * Automatically determines the number of clusters based on density.
 * Points in low-density regions are labeled as noise (-1) but are reassigned
 * to the nearest cluster for graph display purposes.
 *
 * @param vectors Array of vectors to cluster
 * @param minClusterSize Minimum number of points to form a cluster (default: 5)
 * @param minSamples Number of neighbors for core distance (default: same as minClusterSize)
 * @param metric Distance metric: "cosine" for high-D embeddings, "euclidean" for projected 2D positions (default: "cosine")
 * @returns Cluster labels and number of clusters found
 */
export function hdbscan(vectors: Float32Array[], minClusterSize = 5, minSamples?: number, metric: "cosine" | "euclidean" = "cosine"): HDBSCANResult {
    const n = vectors.length;
    const effectiveMinSamples = minSamples ?? minClusterSize;

    if (n === 0) {
        return { labels: [], numClusters: 0 };
    }
    if (n === 1) {
        return { labels: [0], numClusters: 1 };
    }
    if (n < minClusterSize) {
        // Not enough points for even one cluster — assign all to cluster 0
        return { labels: new Array(n).fill(0), numClusters: 1 };
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

    // Reassign noise points (-1) to their nearest non-noise cluster
    const noiseIndices: number[] = [];
    for (let i = 0; i < n; i++) {
        if (labels[i] === -1) noiseIndices.push(i);
    }
    if (noiseIndices.length > 0 && noiseIndices.length < n) {
        for (const ni of noiseIndices) {
            let bestDist = Number.POSITIVE_INFINITY;
            let bestLabel = 0;
            for (let j = 0; j < n; j++) {
                if (labels[j] === -1 || j === ni) continue;
                const d = distMatrix[ni * n + j];
                if (d < bestDist) {
                    bestDist = d;
                    bestLabel = labels[j];
                }
            }
            labels[ni] = bestLabel;
        }
    }

    const numClusters = new Set(labels).size;
    return { labels, numClusters };
}
