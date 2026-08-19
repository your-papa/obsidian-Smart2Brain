import { describe, expect, it } from "vitest";
import { pairKey, scanSemanticPairs } from "../../src/utils/semanticEdges";

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
