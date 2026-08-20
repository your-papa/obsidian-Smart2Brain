import { describe, expect, it } from "vitest";
import {
	approximateSemanticPairs,
	computeSemanticPairs,
	pairKey,
	scanSemanticPairs,
} from "../../src/utils/semanticEdges";

/** Flatten note vectors (one chunk each) into the scan's transfer shape. */
function flatten(notes: number[][]): { data: Float32Array; count: number; dim: number; owners: Int32Array } {
	const dim = notes[0]?.length ?? 0;
	const data = new Float32Array(notes.length * dim);
	notes.forEach((vec, i) => data.set(vec, i * dim));
	return {
		data,
		count: notes.length,
		dim,
		owners: Int32Array.from(notes.map((_, i) => i)),
	};
}

describe("scanSemanticPairs", () => {
	it("returns pairs above the threshold with source < target", () => {
		const { data, count, dim, owners } = flatten([
			[1, 0, 0],
			[0.99, 0.1, 0],
			[0, 0, 1],
		]);
		const pairs = scanSemanticPairs(data, count, dim, owners, 3, { threshold: 0.5 });

		expect(pairs.length).toBeGreaterThan(0);
		for (const pair of pairs) {
			expect(pair.source).toBeLessThan(pair.target);
			expect(pair.score).toBeGreaterThanOrEqual(0.5);
		}
		// The orthogonal note never pairs with the other two.
		expect(pairs.some((p) => p.source === 2 || p.target === 2)).toBe(false);
	});

	it("computes cosine similarity regardless of vector magnitude", () => {
		// Same direction, very different norms — cosine should be ~1.
		const { data, count, dim, owners } = flatten([
			[1, 0, 0],
			[500, 0, 0],
		]);
		const pairs = scanSemanticPairs(data, count, dim, owners, 2, { threshold: 0.9 });

		expect(pairs).toHaveLength(1);
		expect(pairs[0].score).toBeCloseTo(1, 5);
	});

	it("scores a note pair by its best matching chunk", () => {
		// Note 0 owns two chunks; only the second matches note 1.
		const data = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 1]);
		const owners = Int32Array.from([0, 0, 1]);
		const pairs = scanSemanticPairs(data, 3, 3, owners, 2, { threshold: 0.9 });

		expect(pairs).toHaveLength(1);
		expect(pairs[0].score).toBeCloseTo(1, 5);
	});

	it("caps neighbours per note", () => {
		const notes = Array.from({ length: 6 }, (_, i) => [1, i * 0.001, 0]);
		const { data, count, dim, owners } = flatten(notes);

		const capped = scanSemanticPairs(data, count, dim, owners, 6, { threshold: 0, neighborCount: 1 });
		const uncapped = scanSemanticPairs(data, count, dim, owners, 6, { threshold: 0, neighborCount: 5 });

		expect(capped.length).toBeLessThan(uncapped.length);
		expect(capped.length).toBeLessThanOrEqual(6);
	});

	it("honours excluded pairs", () => {
		const { data, count, dim, owners } = flatten([
			[1, 0, 0],
			[0.99, 0.1, 0],
			[0.98, 0.15, 0],
		]);
		const excluded = pairKey(0, 1);
		const pairs = scanSemanticPairs(data, count, dim, owners, 3, {
			threshold: 0.5,
			excludePairs: new Set([excluded]),
		});

		expect(pairs.map((p) => pairKey(p.source, p.target))).not.toContain(excluded);
	});

	it("emits each unordered pair at most once", () => {
		const notes = Array.from({ length: 8 }, (_, i) => [1, i * 0.01, 0]);
		const { data, count, dim, owners } = flatten(notes);
		const pairs = scanSemanticPairs(data, count, dim, owners, 8, { threshold: 0 });

		const keys = pairs.map((p) => pairKey(p.source, p.target));
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("is deterministic across runs", () => {
		const notes = Array.from({ length: 10 }, (_, i) => [Math.cos(i), Math.sin(i), 0.5]);
		const a = flatten(notes);
		const b = flatten(notes);

		expect(scanSemanticPairs(a.data, a.count, a.dim, a.owners, 10, { threshold: 0.3 })).toEqual(
			scanSemanticPairs(b.data, b.count, b.dim, b.owners, 10, { threshold: 0.3 }),
		);
	});

	it("returns nothing for degenerate inputs", () => {
		const { data, count, dim, owners } = flatten([[1, 0, 0]]);
		expect(scanSemanticPairs(data, count, dim, owners, 1, { threshold: 0 })).toHaveLength(0);
		expect(scanSemanticPairs(data, count, dim, owners, 2, { neighborCount: 0 })).toHaveLength(0);
		expect(scanSemanticPairs(new Float32Array(0), 0, 0, new Int32Array(0), 0)).toHaveLength(0);
	});

	it("tolerates zero vectors without emitting NaN scores", () => {
		const { data, count, dim, owners } = flatten([
			[0, 0, 0],
			[1, 0, 0],
		]);
		const pairs = scanSemanticPairs(data, count, dim, owners, 2, { threshold: -1 });

		for (const pair of pairs) {
			expect(Number.isNaN(pair.score)).toBe(false);
		}
	});
});

/**
 * Well-separated synthetic clusters: unit vectors near one of `clusterCount`
 * orthogonal axes, with small deterministic jitter on the remaining dims.
 * Within-cluster similarity stays near 1, cross-cluster near 0, so exact and
 * approximate kernels must find the same neighbourhoods.
 */
function clusteredNotes(clusterCount: number, perCluster: number, dim: number): number[][] {
	const notes: number[][] = [];
	for (let c = 0; c < clusterCount; c++) {
		for (let i = 0; i < perCluster; i++) {
			const vec = new Array(dim).fill(0);
			vec[c] = 1;
			// Deterministic jitter, small enough not to bridge clusters.
			vec[(c + 1 + (i % (dim - clusterCount))) % dim] += 0.05 + 0.01 * (i % 7);
			notes.push(vec);
		}
	}
	return notes;
}

describe("approximateSemanticPairs", () => {
	it("finds the same pairs as the exact scan on well-separated clusters", async () => {
		const notes = clusteredNotes(3, 20, 8);
		const { data, count, dim, owners } = flatten(notes);

		const exact = scanSemanticPairs(data, count, dim, owners, notes.length, {
			threshold: 0.8,
			neighborCount: 3,
		});
		const approx = await approximateSemanticPairs(data, count, dim, owners, notes.length, {
			threshold: 0.8,
			neighborCount: 3,
		});

		const keys = (pairs: { source: number; target: number }[]) =>
			new Set(pairs.map((p) => pairKey(p.source, p.target)));
		expect(keys(approx)).toEqual(keys(exact));
		// No cross-cluster edges survive the threshold in either kernel.
		for (const pair of approx) {
			expect(Math.floor(pair.source / 20)).toBe(Math.floor(pair.target / 20));
		}
	});

	it("orders pairs source < target and never duplicates a pair", async () => {
		const notes = clusteredNotes(2, 15, 6);
		const { data, count, dim, owners } = flatten(notes);
		const pairs = await approximateSemanticPairs(data, count, dim, owners, notes.length, { threshold: 0.5 });

		expect(pairs.length).toBeGreaterThan(0);
		const keys = pairs.map((p) => pairKey(p.source, p.target));
		expect(new Set(keys).size).toBe(keys.length);
		for (const pair of pairs) {
			expect(pair.source).toBeLessThan(pair.target);
		}
	});

	it("scores a note pair by its best matching chunk", async () => {
		// Note 0 owns two chunks; only the second matches note 1.
		const data = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 1]);
		const owners = Int32Array.from([0, 0, 1]);
		const pairs = await approximateSemanticPairs(data, 3, 3, owners, 2, { threshold: 0.9 });

		expect(pairs).toHaveLength(1);
		expect(pairs[0].score).toBeCloseTo(1, 5);
	});

	it("honours excluded pairs", async () => {
		const notes = clusteredNotes(1, 10, 4);
		const { data, count, dim, owners } = flatten(notes);
		const excluded = pairKey(0, 1);
		const pairs = await approximateSemanticPairs(data, count, dim, owners, notes.length, {
			threshold: 0.5,
			excludePairs: new Set([excluded]),
		});

		expect(pairs.length).toBeGreaterThan(0);
		expect(pairs.map((p) => pairKey(p.source, p.target))).not.toContain(excluded);
	});

	it("is deterministic across runs despite HNSW's randomized levels", async () => {
		const notes = clusteredNotes(4, 25, 12);
		const a = flatten(notes);
		const b = flatten(notes);

		const first = await approximateSemanticPairs(a.data, a.count, a.dim, a.owners, notes.length, {
			threshold: 0.6,
		});
		const second = await approximateSemanticPairs(b.data, b.count, b.dim, b.owners, notes.length, {
			threshold: 0.6,
		});

		expect(first).toEqual(second);
	});

	it("returns nothing for degenerate inputs", async () => {
		const { data, count, dim, owners } = flatten([[1, 0, 0]]);
		expect(await approximateSemanticPairs(data, count, dim, owners, 1, { threshold: 0 })).toHaveLength(0);
		expect(await approximateSemanticPairs(data, count, dim, owners, 2, { neighborCount: 0 })).toHaveLength(0);
		expect(await approximateSemanticPairs(new Float32Array(0), 0, 0, new Int32Array(0), 0)).toHaveLength(0);
	});

	it("tolerates zero vectors without emitting NaN scores", async () => {
		const { data, count, dim, owners } = flatten([
			[0, 0, 0],
			[1, 0, 0],
			[0.9, 0.1, 0],
		]);
		const pairs = await approximateSemanticPairs(data, count, dim, owners, 3, { threshold: 0.5 });

		for (const pair of pairs) {
			expect(Number.isNaN(pair.score)).toBe(false);
		}
	});
});

describe("computeSemanticPairs", () => {
	it("matches the exact scan below the HNSW crossover", async () => {
		const notes = clusteredNotes(2, 10, 4);
		const { data, count, dim, owners } = flatten(notes);

		const dispatched = await computeSemanticPairs(data, count, dim, owners, notes.length, { threshold: 0.5 });
		const exact = scanSemanticPairs(data, count, dim, owners, notes.length, { threshold: 0.5 });

		expect(dispatched).toEqual(exact);
	});
});
