import { describe, expect, it } from "vitest";
import { kMeans, silhouetteScore, suggestK, hdbscan } from "../../src/utils/clustering";

/**
 * Helper to create a random Float32Array vector.
 */
function randomVector(dim: number, seed = 0): Float32Array {
    const vec = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
        // Simple deterministic pseudo-random based on seed + index
        const x = Math.sin(seed * 9301 + i * 49297 + 233280) * 10000;
        vec[i] = x - Math.floor(x);
    }
    return vec;
}

/**
 * Create a cluster of vectors around a center point with some noise.
 */
function createCluster(center: Float32Array, count: number, noise: number, startSeed = 0): Float32Array[] {
    const vectors: Float32Array[] = [];
    for (let i = 0; i < count; i++) {
        const vec = new Float32Array(center.length);
        for (let d = 0; d < center.length; d++) {
            const x = Math.sin((startSeed + i) * 9301 + d * 49297 + 233280) * 10000;
            const r = (x - Math.floor(x)) * 2 - 1; // [-1, 1]
            vec[d] = center[d] + r * noise;
        }
        vectors.push(vec);
    }
    return vectors;
}

function dominantNonNoiseLabel(labels: number[]): { label: number; count: number } {
    const counts = new Map<number, number>();
    for (const label of labels) {
        if (label < 0) continue;
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    let bestLabel = -1;
    let bestCount = 0;
    for (const [label, count] of counts) {
        if (count > bestCount) {
            bestLabel = label;
            bestCount = count;
        }
    }

    return { label: bestLabel, count: bestCount };
}

describe("kMeans", () => {
    it("should return empty result for empty input", () => {
        const result = kMeans([], 3);
        expect(result.labels).toEqual([]);
        expect(result.centroids).toEqual([]);
        expect(result.iterations).toBe(0);
    });

    it("should throw for k <= 0", () => {
        const vectors = [randomVector(4)];
        expect(() => kMeans(vectors, 0)).toThrow("k must be positive");
        expect(() => kMeans(vectors, -1)).toThrow("k must be positive");
    });

    it("should handle k=1", () => {
        const vectors = [randomVector(4, 1), randomVector(4, 2), randomVector(4, 3)];
        const result = kMeans(vectors, 1);
        expect(result.labels).toEqual([0, 0, 0]);
        expect(result.centroids).toHaveLength(1);
    });

    it("should handle k >= n (each point its own cluster)", () => {
        const vectors = [randomVector(4, 1), randomVector(4, 2)];
        const result = kMeans(vectors, 5);
        expect(result.labels).toHaveLength(2);
        // Each point should have a unique label
        expect(new Set(result.labels).size).toBe(2);
    });

    it("should assign all vectors to a cluster", () => {
        const vectors = Array.from({ length: 20 }, (_, i) => randomVector(8, i));
        const result = kMeans(vectors, 3);
        expect(result.labels).toHaveLength(20);

        for (const label of result.labels) {
            expect(label).toBeGreaterThanOrEqual(0);
            expect(label).toBeLessThan(3);
        }
    });

    it("should produce correct number of centroids", () => {
        const vectors = Array.from({ length: 30 }, (_, i) => randomVector(8, i));
        const result = kMeans(vectors, 5);
        expect(result.centroids).toHaveLength(5);

        for (const centroid of result.centroids) {
            expect(centroid).toBeInstanceOf(Float32Array);
            expect(centroid.length).toBe(8);
        }
    });

    it("should converge within max iterations", () => {
        const vectors = Array.from({ length: 50 }, (_, i) => randomVector(4, i));
        const result = kMeans(vectors, 3, 200);
        expect(result.iterations).toBeLessThanOrEqual(200);
    });

    it("should produce well-separated clusters for well-separated data", () => {
        // Create 3 clearly separated clusters in 4D space
        const center1 = new Float32Array([10, 0, 0, 0]);
        const center2 = new Float32Array([0, 10, 0, 0]);
        const center3 = new Float32Array([0, 0, 10, 0]);

        const cluster1 = createCluster(center1, 15, 0.5, 100);
        const cluster2 = createCluster(center2, 15, 0.5, 200);
        const cluster3 = createCluster(center3, 15, 0.5, 300);

        const vectors = [...cluster1, ...cluster2, ...cluster3];
        const result = kMeans(vectors, 3);

        // Each original group should mostly have the same label
        const labels1 = new Set(result.labels.slice(0, 15));
        const labels2 = new Set(result.labels.slice(15, 30));
        const labels3 = new Set(result.labels.slice(30, 45));

        // Most points in each group should share a label
        expect(labels1.size).toBeLessThanOrEqual(2);
        expect(labels2.size).toBeLessThanOrEqual(2);
        expect(labels3.size).toBeLessThanOrEqual(2);
    });
});

describe("silhouetteScore", () => {
    it("should return 0 for single point", () => {
        const score = silhouetteScore([randomVector(4)], [0]);
        expect(score).toBe(0);
    });

    it("should return 0 for single cluster", () => {
        const vectors = Array.from({ length: 5 }, (_, i) => randomVector(4, i));
        const labels = new Array(5).fill(0);
        const score = silhouetteScore(vectors, labels);
        expect(score).toBe(0);
    });

    it("should return positive score for well-separated clusters", () => {
        const center1 = new Float32Array([10, 0, 0, 0]);
        const center2 = new Float32Array([0, 10, 0, 0]);

        const vectors = [...createCluster(center1, 10, 0.3, 10), ...createCluster(center2, 10, 0.3, 50)];
        const labels = [...new Array(10).fill(0), ...new Array(10).fill(1)];

        const score = silhouetteScore(vectors, labels);
        expect(score).toBeGreaterThan(0);
    });

    it("should be between -1 and 1", () => {
        const vectors = Array.from({ length: 20 }, (_, i) => randomVector(8, i));
        const labels = vectors.map((_, i) => i % 3);
        const score = silhouetteScore(vectors, labels);

        expect(score).toBeGreaterThanOrEqual(-1);
        expect(score).toBeLessThanOrEqual(1);
    });
});

describe("suggestK", () => {
    it("should return 1 for single point", () => {
        const { k } = suggestK([randomVector(4)]);
        expect(k).toBe(1);
    });

    it("should return a valid K within range", () => {
        const vectors = Array.from({ length: 30 }, (_, i) => randomVector(8, i));
        const { k } = suggestK(vectors, 2, 8);
        expect(k).toBeGreaterThanOrEqual(2);
        expect(k).toBeLessThanOrEqual(8);
    });

    it("should not exceed half the data size", () => {
        const vectors = Array.from({ length: 6 }, (_, i) => randomVector(4, i));
        const { k } = suggestK(vectors, 2, 10);
        expect(k).toBeLessThanOrEqual(3);
    });
});

describe("hdbscan", () => {
    it("should return empty result for empty input", () => {
        const result = hdbscan([], 3);
        expect(result.labels).toEqual([]);
        expect(result.numClusters).toBe(0);
    });

    it("should keep a single point as noise when it cannot form a cluster", () => {
        const result = hdbscan([randomVector(4)], 2);
        expect(result.labels).toEqual([-1]);
        expect(result.numClusters).toBe(0);
    });

    it("should allow a single-point cluster when minClusterSize is 1", () => {
        const result = hdbscan([randomVector(4)], 1);
        expect(result.labels).toEqual([0]);
        expect(result.numClusters).toBe(1);
    });

    it("should handle fewer points than minClusterSize", () => {
        const vectors = [randomVector(4, 1), randomVector(4, 2), randomVector(4, 3)];
        const result = hdbscan(vectors, 5);
        expect(result.labels).toHaveLength(3);
        expect(result.numClusters).toBe(0);
        for (const label of result.labels) {
            expect(label).toBe(-1);
        }
    });

    it("should find clusters in well-separated data", () => {
        const center1 = new Float32Array([10, 0, 0, 0]);
        const center2 = new Float32Array([0, 10, 0, 0]);
        const center3 = new Float32Array([0, 0, 10, 0]);

        const cluster1 = createCluster(center1, 15, 0.3, 100);
        const cluster2 = createCluster(center2, 15, 0.3, 200);
        const cluster3 = createCluster(center3, 15, 0.3, 300);

        const vectors = [...cluster1, ...cluster2, ...cluster3];
        const result = hdbscan(vectors, 5);

        expect(result.labels).toHaveLength(45);
        expect(result.numClusters).toBe(3);

        const dominant1 = dominantNonNoiseLabel(result.labels.slice(0, 15));
        const dominant2 = dominantNonNoiseLabel(result.labels.slice(15, 30));
        const dominant3 = dominantNonNoiseLabel(result.labels.slice(30, 45));

        expect(dominant1.count).toBeGreaterThanOrEqual(5);
        expect(dominant2.count).toBeGreaterThanOrEqual(5);
        expect(dominant3.count).toBeGreaterThanOrEqual(5);
        expect(new Set([dominant1.label, dominant2.label, dominant3.label]).size).toBe(3);
    });

    it("should preserve noise points instead of force-assigning them", () => {
        const cluster1 = createCluster(new Float32Array([0, 0]), 10, 0.15, 10);
        const cluster2 = createCluster(new Float32Array([8, 8]), 10, 0.15, 40);
        const outlier = new Float32Array([4, 4]);

        const result = hdbscan([...cluster1, ...cluster2, outlier], 5, undefined, "euclidean");

        expect(result.numClusters).toBe(2);
        expect(result.labels.at(-1)).toBe(-1);
    });

    it("should find clusters in 2D data with euclidean metric", () => {
        // Simulate projected 2D positions with 3 well-separated groups
        const group1 = Array.from({ length: 15 }, (_, i) => {
            const x = Math.sin((100 + i) * 9301 + 233280) * 0.5;
            const y = Math.sin((100 + i) * 49297 + 233280) * 0.5;
            return new Float32Array([10 + x, 10 + y]);
        });
        const group2 = Array.from({ length: 15 }, (_, i) => {
            const x = Math.sin((200 + i) * 9301 + 233280) * 0.5;
            const y = Math.sin((200 + i) * 49297 + 233280) * 0.5;
            return new Float32Array([-10 + x, 10 + y]);
        });
        const group3 = Array.from({ length: 15 }, (_, i) => {
            const x = Math.sin((300 + i) * 9301 + 233280) * 0.5;
            const y = Math.sin((300 + i) * 49297 + 233280) * 0.5;
            return new Float32Array([0 + x, -10 + y]);
        });

        const vectors = [...group1, ...group2, ...group3];
        const result = hdbscan(vectors, 5, undefined, "euclidean");

        expect(result.numClusters).toBe(3);

        const dominant1 = dominantNonNoiseLabel(result.labels.slice(0, 15));
        const dominant2 = dominantNonNoiseLabel(result.labels.slice(15, 30));
        const dominant3 = dominantNonNoiseLabel(result.labels.slice(30, 45));

        expect(dominant1.count).toBeGreaterThanOrEqual(5);
        expect(dominant2.count).toBeGreaterThanOrEqual(5);
        expect(dominant3.count).toBeGreaterThanOrEqual(5);
        expect(new Set([dominant1.label, dominant2.label, dominant3.label]).size).toBe(3);
    });
});
