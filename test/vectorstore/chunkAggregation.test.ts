import { describe, expect, it } from "vitest";
import { aggregateChunksToNotes } from "../../src/vectorstore/chunkAggregation";

describe("aggregateChunksToNotes", () => {
	it("ranks a note matching in several sections above one lucky chunk", () => {
		// The sourdough regression: `weak` edges `strong` on best chunk alone, but
		// `strong` matches in three places and is the better answer.
		const result = aggregateChunksToNotes([
			{ path: "weak.md", score: 0.62 },
			{ path: "strong.md", score: 0.61 },
			{ path: "strong.md", score: 0.6 },
			{ path: "strong.md", score: 0.58 },
		]);

		expect(result[0].path).toBe("strong.md");
		expect(result[0].matchingChunks).toBe(3);
	});

	it("keeps a clearly better single chunk ahead of many weak ones", () => {
		const result = aggregateChunksToNotes([
			{ path: "precise.md", score: 0.9 },
			...Array.from({ length: 20 }, () => ({ path: "sprawling.md", score: 0.3 })),
		]);

		// Support is bounded and relative, so chunk count cannot overturn a big gap.
		expect(result[0].path).toBe("precise.md");
	});

	it("does not let a long note beat a better short one on chunk count alone", () => {
		// The measured length-bias case: a 33-chunk note whose sections are all
		// mediocre used to outrank a tiny note with a genuinely better match,
		// because the old harmonic support term diverged with chunk count.
		const result = aggregateChunksToNotes([
			{ path: "tiny.md", score: 0.72 },
			...Array.from({ length: 33 }, (_, i) => ({ path: "huge.md", score: 0.55 - i * 0.003 })),
		]);

		expect(result[0].path).toBe("tiny.md");
	});

	it("bounds total support no matter how many chunks match", () => {
		const lift = (count: number) => {
			const hits = Array.from({ length: count }, () => ({ path: "n.md", score: 0.6 }));
			return aggregateChunksToNotes(hits)[0].score / 0.6 - 1;
		};

		// Converges: the jump from 50 to 500 chunks is negligible, and the ceiling
		// holds. The old formula grew without limit (+63% at 100 chunks).
		expect(lift(500)).toBeLessThanOrEqual(0.15);
		expect(lift(500) - lift(50)).toBeLessThan(0.01);
	});

	it("weights support by quality rather than by count", () => {
		const twoStrong = aggregateChunksToNotes([
			{ path: "a.md", score: 0.8 },
			{ path: "a.md", score: 0.79 },
			{ path: "a.md", score: 0.78 },
		])[0].score;
		const manyWeak = aggregateChunksToNotes([
			{ path: "b.md", score: 0.8 },
			...Array.from({ length: 15 }, () => ({ path: "b.md", score: 0.08 })),
		])[0].score;

		expect(twoStrong).toBeGreaterThan(manyWeak);
	});

	it("reports the best chunk score untouched by the support term", () => {
		const result = aggregateChunksToNotes([
			{ path: "a.md", score: 0.8 },
			{ path: "a.md", score: 0.7 },
		]);

		expect(result[0].bestChunkScore).toBe(0.8);
		expect(result[0].score).toBeGreaterThan(0.8);
	});

	it("leaves a single-chunk note's score exactly at its chunk score", () => {
		const result = aggregateChunksToNotes([{ path: "solo.md", score: 0.42 }]);

		expect(result[0].score).toBe(0.42);
		expect(result[0].matchingChunks).toBe(1);
	});

	it("applies diminishing returns so later chunks add less", () => {
		const two = aggregateChunksToNotes([
			{ path: "n.md", score: 0.5 },
			{ path: "n.md", score: 0.5 },
		])[0].score;
		const three = aggregateChunksToNotes([
			{ path: "n.md", score: 0.5 },
			{ path: "n.md", score: 0.5 },
			{ path: "n.md", score: 0.5 },
		])[0].score;

		const firstGain = two - 0.5;
		const secondGain = three - two;
		expect(secondGain).toBeGreaterThan(0);
		expect(secondGain).toBeLessThan(firstGain);
	});

	it("weights supporting chunks by how close they are to the note's best", () => {
		const closeSupport = aggregateChunksToNotes([
			{ path: "a.md", score: 0.8 },
			{ path: "a.md", score: 0.79 },
		])[0].score;
		const weakSupport = aggregateChunksToNotes([
			{ path: "b.md", score: 0.8 },
			{ path: "b.md", score: 0.1 },
		])[0].score;

		expect(closeSupport).toBeGreaterThan(weakSupport);
	});

	it("sorts by aggregate score and finds the best chunk regardless of input order", () => {
		const result = aggregateChunksToNotes([
			{ path: "a.md", score: 0.2 },
			{ path: "b.md", score: 0.9 },
			{ path: "a.md", score: 0.85 },
		]);

		expect(result.map((r) => r.path)).toEqual(["b.md", "a.md"]);
		expect(result[1].bestChunkScore).toBe(0.85);
	});

	it("handles an empty hit list", () => {
		expect(aggregateChunksToNotes([])).toEqual([]);
	});

	it("does not divide by zero when every chunk scores zero", () => {
		const result = aggregateChunksToNotes([
			{ path: "z.md", score: 0 },
			{ path: "z.md", score: 0 },
		]);

		expect(result[0].score).toBe(0);
		expect(Number.isNaN(result[0].score)).toBe(false);
	});

	it("ignores negative chunk scores in the support term", () => {
		// Some metrics can emit negatives; they must not reduce the aggregate below
		// the note's best chunk.
		const result = aggregateChunksToNotes([
			{ path: "n.md", score: 0.5 },
			{ path: "n.md", score: -0.3 },
		]);

		expect(result[0].score).toBe(0.5);
	});
});
