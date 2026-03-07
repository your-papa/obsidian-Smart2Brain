/**
 * Clustering Utilities
 *
 * K-Means clustering with cosine distance and silhouette-based auto-K selection.
 * Used by the Smart Graph View for semantic clustering of document embeddings.
 */

import { cosineSimilarity } from "../vectorstore/similarity";

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
    return 1 - cosineSimilarity(a, b);
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
