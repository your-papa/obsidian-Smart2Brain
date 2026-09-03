import { describe, expect, it } from "vitest";
import { pointInPolygon, rectContains, trimOutliers } from "../../src/utils/graphGeometry";

describe("rectContains", () => {
	const outer = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

	it("accepts a rect fully inside, including one sharing an edge", () => {
		expect(rectContains(outer, { minX: 1, minY: 1, maxX: 9, maxY: 9 })).toBe(true);
		expect(rectContains(outer, { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBe(true);
	});

	it("rejects a rect that pokes out on any side", () => {
		expect(rectContains(outer, { minX: -1, minY: 1, maxX: 9, maxY: 9 })).toBe(false);
		expect(rectContains(outer, { minX: 1, minY: 1, maxX: 11, maxY: 9 })).toBe(false);
	});
});

describe("pointInPolygon", () => {
	const square = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
	];

	it("distinguishes inside from outside", () => {
		expect(pointInPolygon(5, 5, square)).toBe(true);
		expect(pointInPolygon(15, 5, square)).toBe(false);
		expect(pointInPolygon(5, -1, square)).toBe(false);
	});

	it("handles a concave polygon", () => {
		// A "C" shape: the notch at x in (4,10), y in (3,7) is outside.
		const c = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 3 },
			{ x: 4, y: 3 },
			{ x: 4, y: 7 },
			{ x: 10, y: 7 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		];
		expect(pointInPolygon(2, 5, c)).toBe(true);
		expect(pointInPolygon(7, 5, c)).toBe(false);
	});
});

describe("trimOutliers", () => {
	const core = [
		{ x: 0, y: 0 },
		{ x: 1, y: 0 },
		{ x: 0, y: 1 },
		{ x: 1, y: 1 },
		{ x: 0.5, y: 0.5 },
	];

	it("drops a single far-away stray but keeps the core", () => {
		const trimmed = trimOutliers([...core, { x: 50, y: 50 }]);
		expect(trimmed).toHaveLength(core.length);
		expect(trimmed).not.toContainEqual({ x: 50, y: 50 });
	});

	it("leaves small or degenerate sets alone", () => {
		const three = core.slice(0, 3);
		expect(trimOutliers(three)).toBe(three);
		const stacked = [
			{ x: 1, y: 1 },
			{ x: 1, y: 1 },
			{ x: 1, y: 1 },
			{ x: 1, y: 1 },
		];
		expect(trimOutliers(stacked)).toBe(stacked);
	});

	it("never trims below three points", () => {
		const spread = [
			{ x: 0, y: 0 },
			{ x: 0.1, y: 0 },
			{ x: 100, y: 0 },
			{ x: -100, y: 0 },
		];
		expect(trimOutliers(spread, 0.01)).toBe(spread);
	});
});
