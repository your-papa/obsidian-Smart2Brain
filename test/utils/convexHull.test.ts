import { describe, expect, it } from "vitest";
import {
	buildTopicRegion,
	centroid,
	convexHull,
	expandHull,
	smoothClosedPath,
	type Point,
} from "../../src/utils/convexHull";

const square: Point[] = [
	{ x: 0, y: 0 },
	{ x: 10, y: 0 },
	{ x: 10, y: 10 },
	{ x: 0, y: 10 },
];

/** Winding-independent comparison — the hull's start vertex isn't meaningful. */
function asSet(points: Point[]): Set<string> {
	return new Set(points.map((p) => `${p.x},${p.y}`));
}

describe("convexHull", () => {
	it("returns the enclosing corners of a square", () => {
		const hull = convexHull(square);
		expect(hull).toHaveLength(4);
		expect(asSet(hull)).toEqual(asSet(square));
	});

	it("discards interior points", () => {
		const hull = convexHull([...square, { x: 5, y: 5 }, { x: 3, y: 7 }]);
		expect(hull).toHaveLength(4);
		expect(asSet(hull)).toEqual(asSet(square));
	});

	it("keeps points on the boundary out of the hull when collinear", () => {
		// Midpoint of an edge adds no area, so it should not become a vertex.
		const hull = convexHull([...square, { x: 5, y: 0 }]);
		expect(hull).toHaveLength(4);
	});

	it("handles duplicate coordinates", () => {
		const hull = convexHull([...square, ...square]);
		expect(hull).toHaveLength(4);
	});

	it("returns degenerate input unchanged", () => {
		expect(convexHull([])).toEqual([]);
		expect(convexHull([{ x: 1, y: 1 }])).toHaveLength(1);
		expect(
			convexHull([
				{ x: 1, y: 1 },
				{ x: 2, y: 2 },
			]),
		).toHaveLength(2);
	});

	it("returns fewer than 3 points for a collinear set", () => {
		const collinear = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			{ x: 2, y: 2 },
		];
		expect(convexHull(collinear).length).toBeLessThan(3);
	});

	it("does not mutate its input", () => {
		const input = [...square];
		convexHull(input);
		expect(input).toEqual(square);
	});
});

describe("centroid", () => {
	it("averages the points", () => {
		expect(centroid(square)).toEqual({ x: 5, y: 5 });
	});

	it("returns the origin for an empty set", () => {
		expect(centroid([])).toEqual({ x: 0, y: 0 });
	});
});

describe("expandHull", () => {
	it("pushes every vertex away from the centroid", () => {
		const expanded = expandHull(square, 5);
		const center = centroid(square);

		for (let i = 0; i < square.length; i++) {
			const before = Math.hypot(square[i].x - center.x, square[i].y - center.y);
			const after = Math.hypot(expanded[i].x - center.x, expanded[i].y - center.y);
			expect(after).toBeCloseTo(before + 5, 5);
		}
	});

	it("is a no-op at zero padding", () => {
		expect(expandHull(square, 0)).toEqual(square);
	});

	it("leaves a vertex at the centroid alone rather than producing NaN", () => {
		const result = expandHull([{ x: 5, y: 5 }], 10);
		expect(result[0]).toEqual({ x: 5, y: 5 });
	});
});

describe("smoothClosedPath", () => {
	it("quadruples the point count per iteration", () => {
		expect(smoothClosedPath(square, 1)).toHaveLength(8);
		expect(smoothClosedPath(square, 2)).toHaveLength(16);
	});

	it("keeps the smoothed path inside the original bounds", () => {
		for (const point of smoothClosedPath(square, 2)) {
			expect(point.x).toBeGreaterThanOrEqual(0);
			expect(point.x).toBeLessThanOrEqual(10);
			expect(point.y).toBeGreaterThanOrEqual(0);
			expect(point.y).toBeLessThanOrEqual(10);
		}
	});

	it("preserves the centroid", () => {
		const before = centroid(square);
		const after = centroid(smoothClosedPath(square, 2));
		expect(after.x).toBeCloseTo(before.x, 5);
		expect(after.y).toBeCloseTo(before.y, 5);
	});

	it("leaves degenerate paths alone", () => {
		const two = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		];
		expect(smoothClosedPath(two)).toEqual(two);
	});
});

describe("buildTopicRegion", () => {
	it("returns null for an empty group", () => {
		expect(buildTopicRegion([], 10)).toBeNull();
	});

	it("synthesises a region around a single node", () => {
		const region = buildTopicRegion([{ x: 0, y: 0 }], 10);
		expect(region).not.toBeNull();
		expect(region!.length).toBeGreaterThan(2);
		// Every point sits at the padding radius.
		for (const point of region!) {
			expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 5);
		}
	});

	it("synthesises a region around two nodes", () => {
		const region = buildTopicRegion(
			[
				{ x: 0, y: 0 },
				{ x: 20, y: 0 },
			],
			5,
		);
		expect(region).not.toBeNull();
		expect(region!.length).toBeGreaterThan(2);
	});

	it("produces a region enclosing a normal group", () => {
		const region = buildTopicRegion(square, 5);
		expect(region).not.toBeNull();
		// Smoothed + padded, so it must be bigger than the raw square.
		const xs = region!.map((p) => p.x);
		expect(Math.min(...xs)).toBeLessThan(0);
		expect(Math.max(...xs)).toBeGreaterThan(10);
	});

	it("still produces a region for collinear nodes", () => {
		const region = buildTopicRegion(
			[
				{ x: 0, y: 0 },
				{ x: 5, y: 5 },
				{ x: 10, y: 10 },
			],
			4,
		);
		expect(region).not.toBeNull();
		expect(region!.length).toBeGreaterThan(2);
	});
});
