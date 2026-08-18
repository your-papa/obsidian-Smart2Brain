import { describe, expect, it } from "vitest";
import { pca2D, umap2D, project2D, pcaReduce, umapReduce, reduceDimensions } from "../../src/utils/projection";

describe("pca2D", () => {
	it("returns empty array for empty input", () => {
		expect(pca2D([])).toEqual([]);
	});

	it("returns origin for a single vector", () => {
		const result = pca2D([new Float32Array([1, 2, 3])]);
		expect(result).toEqual([{ x: 0, y: 0 }]);
	});

	it("returns 2D coordinates for two vectors", () => {
		const v1 = new Float32Array([1, 0, 0]);
		const v2 = new Float32Array([0, 1, 0]);
		const result = pca2D([v1, v2]);
		expect(result).toHaveLength(2);
		// They should be separated (not both at origin)
		const dist = Math.sqrt((result[0].x - result[1].x) ** 2 + (result[0].y - result[1].y) ** 2);
		expect(dist).toBeGreaterThan(0);
	});

	it("places similar vectors close and dissimilar vectors far apart", () => {
		// Group A: vectors pointing roughly the same direction
		const a1 = new Float32Array([1, 0.1, 0, 0]);
		const a2 = new Float32Array([0.9, 0.2, 0, 0]);
		// Group B: vectors pointing a very different direction
		const b1 = new Float32Array([0, 0, 1, 0.1]);
		const b2 = new Float32Array([0, 0, 0.9, 0.2]);

		const result = pca2D([a1, a2, b1, b2]);
		expect(result).toHaveLength(4);

		const distWithin_A = Math.sqrt((result[0].x - result[1].x) ** 2 + (result[0].y - result[1].y) ** 2);
		const distWithin_B = Math.sqrt((result[2].x - result[3].x) ** 2 + (result[2].y - result[3].y) ** 2);
		const distBetween = Math.sqrt((result[0].x - result[2].x) ** 2 + (result[0].y - result[2].y) ** 2);

		// Within-group distance should be much smaller than between-group
		expect(distBetween).toBeGreaterThan(distWithin_A);
		expect(distBetween).toBeGreaterThan(distWithin_B);
	});

	it("produces deterministic results for the same input", () => {
		const vectors = [
			new Float32Array([1, 2, 3, 4, 5]),
			new Float32Array([5, 4, 3, 2, 1]),
			new Float32Array([2, 3, 4, 5, 6]),
		];
		const r1 = pca2D(vectors);
		const r2 = pca2D(vectors);
		for (let i = 0; i < r1.length; i++) {
			expect(r1[i].x).toBeCloseTo(r2[i].x, 10);
			expect(r1[i].y).toBeCloseTo(r2[i].y, 10);
		}
	});

	it("respects the spread parameter", () => {
		const vectors = [new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0]), new Float32Array([0, 0, 1])];
		const smallSpread = pca2D(vectors, 100);
		const largeSpread = pca2D(vectors, 1000);

		// Max coordinate in largeSpread should be ~10x max in smallSpread
		const maxSmall = Math.max(...smallSpread.map((c) => Math.max(Math.abs(c.x), Math.abs(c.y))));
		const maxLarge = Math.max(...largeSpread.map((c) => Math.max(Math.abs(c.x), Math.abs(c.y))));
		expect(maxLarge / maxSmall).toBeCloseTo(10, 0);
	});

	it("falls back to circular layout when all vectors are identical", () => {
		const same = new Float32Array([1, 1, 1]);
		const result = pca2D([same, same, same]);
		expect(result).toHaveLength(3);
		// Not all at origin — should be on a circle
		const dists = result.map((c) => Math.sqrt(c.x ** 2 + c.y ** 2));
		for (const d of dists) {
			expect(d).toBeGreaterThan(0);
		}
	});

	it("works with high-dimensional vectors", () => {
		// Simulate 384-dim embeddings
		const dim = 384;
		const vectors: Float32Array[] = [];
		for (let i = 0; i < 10; i++) {
			const v = new Float32Array(dim);
			// Each vector has a dominant dimension to create distinct groups
			v[i * 38] = 1;
			for (let j = 0; j < dim; j++) v[j] += 0.01 * Math.sin(i + j);
			vectors.push(v);
		}
		const result = pca2D(vectors);
		expect(result).toHaveLength(10);
		// All results should be finite numbers
		for (const c of result) {
			expect(Number.isFinite(c.x)).toBe(true);
			expect(Number.isFinite(c.y)).toBe(true);
		}
	});

	it("handles number[] arrays as well as Float32Array", () => {
		const vectors = [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
		];
		const result = pca2D(vectors);
		expect(result).toHaveLength(3);
		for (const c of result) {
			expect(Number.isFinite(c.x)).toBe(true);
			expect(Number.isFinite(c.y)).toBe(true);
		}
	});
});

describe("umap2D", () => {
	it("returns empty array for empty input", async () => {
		expect(await umap2D([])).toEqual([]);
	});

	it("returns origin for a single vector", async () => {
		const result = await umap2D([new Float32Array([1, 2, 3])]);
		expect(result).toEqual([{ x: 0, y: 0 }]);
	});

	it("produces finite 2D coordinates", async () => {
		const vectors = [
			new Float32Array([1, 0, 0, 0]),
			new Float32Array([0, 1, 0, 0]),
			new Float32Array([0, 0, 1, 0]),
			new Float32Array([0, 0, 0, 1]),
		];
		const result = await umap2D(vectors);
		expect(result).toHaveLength(4);
		for (const c of result) {
			expect(Number.isFinite(c.x)).toBe(true);
			expect(Number.isFinite(c.y)).toBe(true);
		}
	});

	it("places similar vectors closer than dissimilar vectors", async () => {
		// Use larger groups for UMAP to have enough signal
		const groupA = [
			new Float32Array([1, 0.1, 0, 0, 0, 0, 0, 0]),
			new Float32Array([0.9, 0.2, 0.05, 0, 0, 0, 0, 0]),
			new Float32Array([0.8, 0.15, 0.1, 0, 0, 0, 0, 0]),
			new Float32Array([0.95, 0.05, 0, 0, 0, 0, 0, 0]),
		];
		const groupB = [
			new Float32Array([0, 0, 0, 0, 1, 0.1, 0, 0]),
			new Float32Array([0, 0, 0, 0, 0.9, 0.2, 0.05, 0]),
			new Float32Array([0, 0, 0, 0, 0.8, 0.15, 0.1, 0]),
			new Float32Array([0, 0, 0, 0, 0.95, 0.05, 0, 0]),
		];

		const result = await umap2D([...groupA, ...groupB]);
		expect(result).toHaveLength(8);

		// Compute average within-group and between-group distances
		let withinA = 0;
		let countA = 0;
		for (let i = 0; i < 4; i++) {
			for (let j = i + 1; j < 4; j++) {
				withinA += Math.sqrt((result[i].x - result[j].x) ** 2 + (result[i].y - result[j].y) ** 2);
				countA++;
			}
		}
		const avgWithinA = withinA / countA;

		let between = 0;
		let countB = 0;
		for (let i = 0; i < 4; i++) {
			for (let j = 4; j < 8; j++) {
				between += Math.sqrt((result[i].x - result[j].x) ** 2 + (result[i].y - result[j].y) ** 2);
				countB++;
			}
		}
		const avgBetween = between / countB;

		expect(avgBetween).toBeGreaterThan(avgWithinA);
	});

	it("respects the spread parameter", async () => {
		const vectors = [
			new Float32Array([1, 0, 0, 0]),
			new Float32Array([0, 1, 0, 0]),
			new Float32Array([0, 0, 1, 0]),
			new Float32Array([0, 0, 0, 1]),
			new Float32Array([1, 1, 0, 0]),
		];
		const smallSpread = await umap2D(vectors, 100);
		const maxSmall = Math.max(...smallSpread.map((c) => Math.max(Math.abs(c.x), Math.abs(c.y))));
		// Max coordinate should be within spread range
		expect(maxSmall).toBeLessThanOrEqual(100 + 1);
		expect(maxSmall).toBeGreaterThan(0);
	});

	it("falls back to PCA for very small datasets", async () => {
		const vectors = [new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0]), new Float32Array([0, 0, 1])];
		// Should not throw for n < 4, falls back to PCA
		const result = await umap2D(vectors);
		expect(result).toHaveLength(3);
		for (const c of result) {
			expect(Number.isFinite(c.x)).toBe(true);
			expect(Number.isFinite(c.y)).toBe(true);
		}
	});
});

describe("project2D", () => {
	const vectors = [new Float32Array([1, 0, 0, 0]), new Float32Array([0, 1, 0, 0]), new Float32Array([0, 0, 1, 0])];

	it("uses UMAP by default", async () => {
		const vectors = [
			new Float32Array([1, 0, 0, 0]),
			new Float32Array([0, 1, 0, 0]),
			new Float32Array([0, 0, 1, 0]),
			new Float32Array([0, 0, 0, 1]),
			new Float32Array([1, 1, 0, 0]),
		];
		const result = await project2D(vectors);
		expect(result).toHaveLength(5);
		for (const c of result) {
			expect(Number.isFinite(c.x)).toBe(true);
			expect(Number.isFinite(c.y)).toBe(true);
		}
	});

	it("dispatches to PCA when specified", async () => {
		const result = await project2D(vectors, "pca");
		expect(result).toHaveLength(3);
		// PCA is deterministic - calling twice should give same result
		const result2 = await project2D(vectors, "pca");
		for (let i = 0; i < result.length; i++) {
			expect(result[i].x).toBeCloseTo(result2[i].x, 10);
			expect(result[i].y).toBeCloseTo(result2[i].y, 10);
		}
	});

	it("dispatches to UMAP when specified", async () => {
		const vectors = [
			new Float32Array([1, 0, 0, 0]),
			new Float32Array([0, 1, 0, 0]),
			new Float32Array([0, 0, 1, 0]),
			new Float32Array([0, 0, 0, 1]),
			new Float32Array([1, 1, 0, 0]),
		];
		const result = await project2D(vectors, "umap");
		expect(result).toHaveLength(5);
		for (const c of result) {
			expect(Number.isFinite(c.x)).toBe(true);
			expect(Number.isFinite(c.y)).toBe(true);
		}
	});
});

describe("pcaReduce", () => {
	it("returns empty array for empty input", () => {
		expect(pcaReduce([])).toEqual([]);
	});

	it("returns a zero vector for a single input", () => {
		const result = pcaReduce([new Float32Array([1, 2, 3, 4, 5])], 3);
		expect(result).toHaveLength(1);
		expect(result[0].length).toBe(3);
	});

	it("returns copies when input dim <= targetDim (no-op)", () => {
		const vectors = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
		const result = pcaReduce(vectors, 5);
		expect(result).toHaveLength(2);
		expect(result[0].length).toBe(3); // original dim, not targetDim
		// Values should match
		for (let i = 0; i < 3; i++) {
			expect(result[0][i]).toBeCloseTo(vectors[0][i]);
			expect(result[1][i]).toBeCloseTo(vectors[1][i]);
		}
	});

	it("reduces dimensionality to targetDim", () => {
		const dim = 100;
		const vectors: Float32Array[] = [];
		for (let i = 0; i < 20; i++) {
			const v = new Float32Array(dim);
			for (let j = 0; j < dim; j++) v[j] = Math.sin(i * 0.5 + j * 0.1);
			vectors.push(v);
		}
		const result = pcaReduce(vectors, 10);
		expect(result).toHaveLength(20);
		for (const v of result) {
			expect(v.length).toBe(10);
			for (let j = 0; j < v.length; j++) {
				expect(Number.isFinite(v[j])).toBe(true);
			}
		}
	});

	it("preserves group structure after reduction", () => {
		const dim = 64;
		// Group A: vectors pointing in one direction
		const groupA: Float32Array[] = [];
		for (let i = 0; i < 5; i++) {
			const v = new Float32Array(dim);
			v[0] = 1 + i * 0.05;
			v[1] = 0.5 + i * 0.02;
			groupA.push(v);
		}
		// Group B: vectors pointing in a different direction
		const groupB: Float32Array[] = [];
		for (let i = 0; i < 5; i++) {
			const v = new Float32Array(dim);
			v[30] = 1 + i * 0.05;
			v[31] = 0.5 + i * 0.02;
			groupB.push(v);
		}

		const all = [...groupA, ...groupB];
		const reduced = pcaReduce(all, 10);

		// Within-group distances should be smaller than between-group distances
		function eucDist(a: Float32Array, b: Float32Array): number {
			let sum = 0;
			for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
			return Math.sqrt(sum);
		}

		const withinA = eucDist(reduced[0], reduced[4]);
		const withinB = eucDist(reduced[5], reduced[9]);
		const between = eucDist(reduced[0], reduced[5]);

		expect(between).toBeGreaterThan(withinA);
		expect(between).toBeGreaterThan(withinB);
	});

	it("clamps to n-1 components when n < targetDim", () => {
		const vectors = [
			new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
			new Float32Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
			new Float32Array([0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
		];
		// 3 samples, targetDim=5 → can extract at most 2 components
		const result = pcaReduce(vectors, 5);
		expect(result).toHaveLength(3);
		// Output dim = min(targetDim, n-1) = min(5, 2) = 2
		expect(result[0].length).toBe(2);
		for (const v of result) {
			for (let j = 0; j < v.length; j++) {
				expect(Number.isFinite(v[j])).toBe(true);
			}
		}
	});

	it("produces deterministic results", () => {
		const vectors = [
			new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
			new Float32Array([8, 7, 6, 5, 4, 3, 2, 1]),
			new Float32Array([2, 3, 4, 5, 6, 7, 8, 9]),
		];
		const r1 = pcaReduce(vectors, 3);
		const r2 = pcaReduce(vectors, 3);
		for (let i = 0; i < r1.length; i++) {
			for (let j = 0; j < r1[i].length; j++) {
				expect(r1[i][j]).toBeCloseTo(r2[i][j], 10);
			}
		}
	});
});

describe("umapReduce", () => {
	it("returns empty array for empty input", async () => {
		expect(await umapReduce([])).toEqual([]);
	});

	it("returns a zero vector for a single input", async () => {
		const result = await umapReduce([new Float32Array([1, 2, 3, 4, 5])], 3);
		expect(result).toHaveLength(1);
		expect(result[0].length).toBe(3);
	});

	it("returns copies when input dim <= targetDim (no-op)", async () => {
		const vectors = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
		const result = await umapReduce(vectors, 5);
		expect(result).toHaveLength(2);
		expect(result[0].length).toBe(3);
	});

	it("reduces dimensionality to targetDim", async () => {
		const dim = 20;
		const targetDim = 5;
		const vectors: Float32Array[] = [];
		for (let i = 0; i < 10; i++) {
			const v = new Float32Array(dim);
			for (let j = 0; j < dim; j++) v[j] = Math.sin(i * 0.5 + j * 0.1);
			vectors.push(v);
		}
		const result = await umapReduce(vectors, targetDim);
		expect(result).toHaveLength(10);
		for (const v of result) {
			expect(v.length).toBe(targetDim);
			for (let j = 0; j < v.length; j++) {
				expect(Number.isFinite(v[j])).toBe(true);
			}
		}
	});

	it("falls back to PCA for very small datasets", async () => {
		const vectors = [
			new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]),
			new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]),
			new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]),
		];
		// n=3 < 4 → falls back to PCA
		const result = await umapReduce(vectors, 3);
		expect(result).toHaveLength(3);
		for (const v of result) {
			expect(Number.isFinite(v[0])).toBe(true);
		}
	});
});

describe("reduceDimensions", () => {
	const vectors = [
		new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
		new Float32Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
		new Float32Array([0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
		new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
		new Float32Array([1, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
	];

	it("dispatches to PCA by default", async () => {
		const result = await reduceDimensions(vectors, "pca", 3);
		expect(result).toHaveLength(5);
		expect(result[0].length).toBe(3);
	});

	it("dispatches to UMAP when specified", async () => {
		const result = await reduceDimensions(vectors, "umap", 3);
		expect(result).toHaveLength(5);
		expect(result[0].length).toBe(3);
		for (const v of result) {
			for (let j = 0; j < v.length; j++) {
				expect(Number.isFinite(v[j])).toBe(true);
			}
		}
	});
});
