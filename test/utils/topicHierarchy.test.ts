import { describe, expect, it } from "vitest";
import {
	buildTopicHierarchy,
	coarseResolutionFor,
	countChildrenByParent,
	deriveGranularityLadder,
	MAX_DERIVED_GRANULARITY_LEVELS,
	maxGranularityLevel,
	MAX_GRANULARITY_RESOLUTION,
	MIN_GRANULARITY_LEVEL,
	MIN_GRANULARITY_RESOLUTION,
	resolutionToGranularity,
	summarizePartition,
	granularityToResolution,
} from "../../src/utils/topicHierarchy";
import { DEFAULT_SMART_GRAPH_SETTINGS } from "../../src/types/graph";

describe("buildTopicHierarchy", () => {
	it("nests fine topics under the coarse topic holding most of their notes", () => {
		// Coarse: {a,b,c,d} = 0, {e,f} = 1. Fine splits the first into two.
		const coarse = { a: 0, b: 0, c: 0, d: 0, e: 1, f: 1 };
		const fine = { a: 0, b: 0, c: 1, d: 1, e: 2, f: 2 };

		const hierarchy = buildTopicHierarchy(coarse, fine);

		expect(hierarchy.children).toHaveLength(3);
		expect(hierarchy.children.find((c) => c.id === 0)?.parentId).toBe(0);
		expect(hierarchy.children.find((c) => c.id === 1)?.parentId).toBe(0);
		expect(hierarchy.children.find((c) => c.id === 2)?.parentId).toBe(1);
	});

	it("rolls every note up to a parent", () => {
		const coarse = { a: 0, b: 0, c: 1, d: 1 };
		const fine = { a: 0, b: 1, c: 2, d: 3 };

		const { parentOfNode, parents } = buildTopicHierarchy(coarse, fine);

		expect(parentOfNode).toEqual({ a: 0, b: 0, c: 1, d: 1 });
		expect(parents.get(0)).toEqual(["a", "b"]);
		expect(parents.get(1)).toEqual(["c", "d"]);
	});

	it("assigns a split child by plurality, not by its first member", () => {
		// Child 0 spans both parents but leans to parent 1.
		const coarse = { a: 0, b: 1, c: 1, d: 1 };
		const fine = { a: 0, b: 0, c: 0, d: 0 };

		const hierarchy = buildTopicHierarchy(coarse, fine);

		expect(hierarchy.children[0].parentId).toBe(1);
	});

	it("breaks ties on the lower parent id for determinism", () => {
		const coarse = { a: 5, b: 2 };
		const fine = { a: 0, b: 0 };

		expect(buildTopicHierarchy(coarse, fine).children[0].parentId).toBe(2);
	});

	it("ignores notes the coarse level never placed", () => {
		// `c` is unassigned at the coarse level, so it must not outvote parent 0.
		const coarse = { a: 0, b: 0 };
		const fine = { a: 0, b: 0, c: 0 };

		const hierarchy = buildTopicHierarchy(coarse, fine);

		expect(hierarchy.children[0].parentId).toBe(0);
		// It still travels with its child topic.
		expect(hierarchy.children[0].members).toEqual(["a", "b", "c"]);
	});

	it("drops a child whose members are all unplaced at the coarse level", () => {
		const coarse = { a: 0 };
		const fine = { a: 0, b: 1, c: 1 };

		const hierarchy = buildTopicHierarchy(coarse, fine);

		expect(hierarchy.children.map((c) => c.id)).toEqual([0]);
		expect(hierarchy.parentOfNode.b).toBeUndefined();
	});

	it("handles a coarse level identical to the fine one", () => {
		const flat = { a: 0, b: 0, c: 1 };
		const hierarchy = buildTopicHierarchy(flat, flat);

		expect(hierarchy.children).toHaveLength(2);
		for (const child of hierarchy.children) {
			expect(child.parentId).toBe(child.id);
		}
	});

	it("returns empty structures for empty input", () => {
		const hierarchy = buildTopicHierarchy({}, {});
		expect(hierarchy.children).toEqual([]);
		expect(hierarchy.parents.size).toBe(0);
		expect(hierarchy.parentOfNode).toEqual({});
	});

	it("is deterministic across runs", () => {
		const coarse = { a: 0, b: 0, c: 1, d: 1, e: 1 };
		const fine = { a: 0, b: 1, c: 2, d: 2, e: 3 };

		expect(buildTopicHierarchy(coarse, fine)).toEqual(buildTopicHierarchy(coarse, fine));
	});
});

describe("countChildrenByParent", () => {
	it("counts subtopics per parent", () => {
		const coarse = { a: 0, b: 0, c: 0, d: 1 };
		const fine = { a: 0, b: 1, c: 2, d: 3 };

		const counts = countChildrenByParent(buildTopicHierarchy(coarse, fine));

		expect(counts.get(0)).toBe(3);
		expect(counts.get(1)).toBe(1);
	});
});

describe("granularity mapping", () => {
	it("spans the full resolution range", () => {
		expect(granularityToResolution(MIN_GRANULARITY_LEVEL)).toBeCloseTo(MIN_GRANULARITY_RESOLUTION, 5);
		expect(granularityToResolution(maxGranularityLevel())).toBeCloseTo(MAX_GRANULARITY_RESOLUTION, 5);
	});

	it("increases monotonically — right means more topics", () => {
		let previous = -1;
		for (let level = MIN_GRANULARITY_LEVEL; level <= maxGranularityLevel(); level++) {
			const resolution = granularityToResolution(level);
			expect(resolution).toBeGreaterThan(previous);
			previous = resolution;
		}
	});

	it("gives every level a distinct resolution", () => {
		const seen = new Set<number>();
		for (let level = MIN_GRANULARITY_LEVEL; level <= maxGranularityLevel(); level++) {
			seen.add(granularityToResolution(level));
		}
		expect(seen.size).toBe(maxGranularityLevel());
	});

	it("weights steps toward the fine end where the partition actually changes", () => {
		// Measured: γ 0.1–0.8 barely moves the topic count, γ >1.3 moves it a lot.
		// So adjacent-level ratios should shrink as levels get finer, spending more
		// rungs in the range that produces distinct groupings.
		const firstRatio = granularityToResolution(2) / granularityToResolution(1);
		const lastRatio = granularityToResolution(maxGranularityLevel()) / granularityToResolution(maxGranularityLevel() - 1);
		expect(lastRatio).toBeLessThan(firstRatio);
	});

	it("keeps the default resolution exactly on a rung", () => {
		// Otherwise the first slider touch silently shifts γ.
		const defaultResolution = DEFAULT_SMART_GRAPH_SETTINGS.leidenResolution;
		expect(granularityToResolution(resolutionToGranularity(defaultResolution))).toBe(defaultResolution);
	});

	it("clamps out-of-range input", () => {
		expect(granularityToResolution(-5)).toBeCloseTo(MIN_GRANULARITY_RESOLUTION, 5);
		expect(granularityToResolution(999)).toBeCloseTo(MAX_GRANULARITY_RESOLUTION, 5);
	});

	it("rounds a fractional level to the nearest step", () => {
		expect(granularityToResolution(3.4)).toBe(granularityToResolution(3));
		expect(granularityToResolution(3.6)).toBe(granularityToResolution(4));
	});

	it("round-trips through resolutionToGranularity", () => {
		for (let level = MIN_GRANULARITY_LEVEL; level <= maxGranularityLevel(); level++) {
			expect(resolutionToGranularity(granularityToResolution(level))).toBe(level);
		}
	});

	it("snaps an arbitrary stored resolution to the nearest level", () => {
		// Values that predate the ladder (or came from the dev panel) must still
		// place the slider somewhere sensible.
		expect(resolutionToGranularity(0.001)).toBe(MIN_GRANULARITY_LEVEL);
		expect(resolutionToGranularity(99)).toBe(maxGranularityLevel());
		// Exactly between two rungs resolves to one of them, not off the ladder.
		const midpoint = (granularityToResolution(3) + granularityToResolution(4)) / 2;
		expect([3, 4]).toContain(resolutionToGranularity(midpoint));
	});
});

describe("deriveGranularityLadder", () => {
	it("keeps one rung per distinct topic count", () => {
		const ladder = deriveGranularityLadder([
			{ resolution: 0.1, topicCount: 3 },
			{ resolution: 0.2, topicCount: 3 },
			{ resolution: 0.5, topicCount: 5 },
			{ resolution: 1.0, topicCount: 5 },
			{ resolution: 2.0, topicCount: 9 },
		]);

		// 0.2 and 1.0 are dropped — they repeat a grouping already represented.
		expect(ladder).toEqual([0.1, 0.5, 2.0]);
	});

	it("keeps the lowest resolution achieving each grouping", () => {
		const ladder = deriveGranularityLadder([
			{ resolution: 3.0, topicCount: 4 },
			{ resolution: 1.0, topicCount: 4 },
			{ resolution: 2.0, topicCount: 7 },
		]);

		expect(ladder).toEqual([1.0, 2.0]);
	});

	it("returns a sorted ladder", () => {
		const ladder = deriveGranularityLadder([
			{ resolution: 2.0, topicCount: 8 },
			{ resolution: 0.5, topicCount: 3 },
			{ resolution: 1.0, topicCount: 5 },
		]);

		expect(ladder).toEqual([...(ladder ?? [])].sort((a, b) => a - b));
	});

	it("ignores probes that found no topics", () => {
		const ladder = deriveGranularityLadder([
			{ resolution: 0.1, topicCount: 0 },
			{ resolution: 0.5, topicCount: 2 },
			{ resolution: 1.0, topicCount: 4 },
		]);

		expect(ladder).toEqual([0.5, 1.0]);
	});

	it("returns null when the vault supports fewer than two groupings", () => {
		expect(deriveGranularityLadder([])).toBeNull();
		expect(deriveGranularityLadder([{ resolution: 1.0, topicCount: 4 }])).toBeNull();
		// Every probe gives the same grouping — a slider would have nothing to do.
		expect(
			deriveGranularityLadder([
				{ resolution: 0.5, topicCount: 6 },
				{ resolution: 1.0, topicCount: 6 },
				{ resolution: 2.0, topicCount: 6 },
			]),
		).toBeNull();
	});

	it("caps a very varied vault at the maximum ladder length", () => {
		const probes = Array.from({ length: 30 }, (_, i) => ({
			resolution: 0.1 + i * 0.25,
			topicCount: i + 2,
		}));

		const ladder = deriveGranularityLadder(probes);

		expect(ladder!.length).toBeLessThanOrEqual(MAX_DERIVED_GRANULARITY_LEVELS);
		// The broad extreme must survive trimming, or the slider loses reach.
		expect(ladder![0]).toBeCloseTo(0.1, 5);
		// The fine extreme is deliberately NOT the finest grouping found: rungs
		// past the readability cap (30 topics here → count 31 dropped) and
		// near-duplicate steps are trimmed first, so the top rung is the finest
		// *useful* grouping — count 26 at γ 0.1 + 24×0.25.
		expect(ladder![ladder!.length - 1]).toBeCloseTo(0.1 + 24 * 0.25, 5);
	});

	it("drops rungs whose topic count exceeds the readability cap", () => {
		const ladder = deriveGranularityLadder([
			{ resolution: 0.5, topicCount: 8 },
			{ resolution: 1.0, topicCount: 20 },
			{ resolution: 2.0, topicCount: 45 },
			{ resolution: 4.0, topicCount: 80 },
		]);
		expect(ladder).toEqual([0.5, 1.0]);
	});

	it("requires a real jump in topic count between rungs", () => {
		// 10 → 11 → 12 are near-duplicate groupings; only 10 and 20 remain.
		const ladder = deriveGranularityLadder([
			{ resolution: 0.5, topicCount: 10 },
			{ resolution: 1.0, topicCount: 11 },
			{ resolution: 1.5, topicCount: 12 },
			{ resolution: 2.0, topicCount: 20 },
		]);
		expect(ladder).toEqual([0.5, 2.0]);
	});

	it("waives the readability cap when every grouping exceeds it", () => {
		// A huge vault whose coarsest partition is already past the cap still
		// deserves a slider — capped-only filtering would return nothing.
		const ladder = deriveGranularityLadder([
			{ resolution: 0.5, topicCount: 40 },
			{ resolution: 1.0, topicCount: 60 },
			{ resolution: 2.0, topicCount: 90 },
		]);
		expect(ladder).toEqual([0.5, 1.0, 2.0]);
	});
});

describe("summarizePartition", () => {
	it("counts only groups big enough to be a topic", () => {
		// Two real topics (a/b and c/d) plus two loners.
		const communities = { a: 0, b: 0, c: 1, d: 1, e: 2, f: 3 };
		expect(summarizePartition(communities).topicCount).toBe(2);
	});

	it("flags a partition that has shattered into singletons", () => {
		const shattered = { a: 0, b: 1, c: 2, d: 3, e: 4 };
		expect(summarizePartition(shattered).isFragmented).toBe(true);
	});

	it("tolerates a few strays alongside real topics", () => {
		// 3 real topics, 1 loner — well under the singleton share limit.
		const communities = { a: 0, b: 0, c: 1, d: 1, e: 2, f: 2, g: 3 };
		expect(summarizePartition(communities).isFragmented).toBe(false);
	});

	it("handles an empty partition", () => {
		expect(summarizePartition({})).toEqual({ topicCount: 0, isFragmented: false });
	});

	it("reports zero topics when every group is a singleton", () => {
		expect(summarizePartition({ a: 0, b: 1 }).topicCount).toBe(0);
	});
});

describe("deriveGranularityLadder with fragmentation", () => {
	it("rejects levels that shattered into singletons", () => {
		const ladder = deriveGranularityLadder([
			{ resolution: 0.5, topicCount: 4, isFragmented: false },
			{ resolution: 1.0, topicCount: 8, isFragmented: false },
			// γ pushed high enough that the vault fell apart — not a usable level.
			{ resolution: 5.0, topicCount: 40, isFragmented: true },
		]);

		expect(ladder).toEqual([0.5, 1.0]);
	});

	it("returns null when every level is fragmented", () => {
		expect(
			deriveGranularityLadder([
				{ resolution: 3.0, topicCount: 20, isFragmented: true },
				{ resolution: 5.0, topicCount: 40, isFragmented: true },
			]),
		).toBeNull();
	});
});

describe("granularity mapping with a derived ladder", () => {
	const ladder = [0.3, 0.9, 2.5];

	it("maps levels onto the supplied ladder", () => {
		expect(granularityToResolution(1, ladder)).toBe(0.3);
		expect(granularityToResolution(3, ladder)).toBe(2.5);
	});

	it("clamps to the ladder's own length", () => {
		expect(granularityToResolution(99, ladder)).toBe(2.5);
		expect(maxGranularityLevel(ladder)).toBe(3);
	});

	it("round-trips against the supplied ladder", () => {
		for (let level = 1; level <= ladder.length; level++) {
			expect(resolutionToGranularity(granularityToResolution(level, ladder), ladder)).toBe(level);
		}
	});

	it("falls back to the static ladder when given an empty one", () => {
		expect(granularityToResolution(1, [])).toBe(MIN_GRANULARITY_RESOLUTION);
		expect(maxGranularityLevel([])).toBe(MIN_GRANULARITY_LEVEL);
	});
});

describe("coarseResolutionFor", () => {
	it("returns a lower resolution than the fine level", () => {
		expect(coarseResolutionFor(1.0)).toBeLessThan(1.0);
		expect(coarseResolutionFor(2.0)).toBeLessThan(2.0);
	});

	it("never collapses to zero", () => {
		expect(coarseResolutionFor(0.01)).toBeGreaterThan(0);
		expect(coarseResolutionFor(0)).toBeGreaterThan(0);
	});
});
