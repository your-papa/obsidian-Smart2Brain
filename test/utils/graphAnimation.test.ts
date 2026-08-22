import { describe, expect, it } from "vitest";
import { computeCoreNodeBounds, computeNodeBounds } from "../../src/utils/graphAnimation";

/** A tight knot of connected nodes plus far-flung unlinked ones. */
function knotWithOutliers(knotSize: number, outliers: Array<{ x: number; y: number }>) {
	return [...Array.from({ length: knotSize }, (_, i) => ({ x: i * 10, y: i * 8 })), ...outliers];
}

// Measurement helper (the benchmark's fill/waste metrics), not a framing
// policy — the camera deliberately frames full bounds so an explicit fit
// never strands nodes off-screen.
describe("computeCoreNodeBounds", () => {
	it("excludes far outliers that would otherwise dominate the measurement", () => {
		const nodes = knotWithOutliers(20, [
			{ x: 5000, y: 0 },
			{ x: -5000, y: 4000 },
		]);
		const full = computeNodeBounds(nodes);
		const core = computeCoreNodeBounds(nodes);
		expect(full?.maxX).toBe(5000);
		// The core ignores both strays, so the frame describes the knot.
		expect(core!.maxX).toBeLessThan(500);
		expect(core!.minX).toBeGreaterThan(-500);
	});

	it("trims small graphs too, where one satellite is a large share of the population", () => {
		// The regression this exists for: a proportional-only trim rounds to
		// zero here, so the outlier stayed inside the "core".
		const nodes = knotWithOutliers(9, [{ x: 4000, y: 4000 }]);
		const core = computeCoreNodeBounds(nodes);
		expect(core!.maxX).toBeLessThan(1000);
	});

	it("falls back to full bounds when the graph is too small to trim", () => {
		const nodes = [
			{ x: 0, y: 0 },
			{ x: 10, y: 10 },
			{ x: 900, y: 900 },
		];
		expect(computeCoreNodeBounds(nodes)).toEqual(computeNodeBounds(nodes));
	});

	it("never trims more than a fifth of the population", () => {
		// 20 evenly spaced nodes: a 6% trim keeps the frame near the full span
		// rather than collapsing onto the middle few.
		const nodes = Array.from({ length: 20 }, (_, i) => ({ x: i * 100, y: 0 }));
		const core = computeCoreNodeBounds(nodes)!;
		const span = core.maxX - core.minX;
		expect(span).toBeGreaterThan(0.7 * 1900);
	});

	it("matches full bounds when there are no outliers", () => {
		const nodes = Array.from({ length: 30 }, (_, i) => ({ x: Math.cos(i) * 100, y: Math.sin(i) * 100 }));
		const full = computeNodeBounds(nodes)!;
		const core = computeCoreNodeBounds(nodes)!;
		// Trimming a uniform ring shrinks it slightly, never drastically.
		expect(core.maxX - core.minX).toBeGreaterThan(0.6 * (full.maxX - full.minX));
	});

	it("respects the filter and handles empty input", () => {
		const nodes = knotWithOutliers(20, [{ x: 9999, y: 9999 }]);
		expect(computeCoreNodeBounds(nodes, (n) => n.x < 0)).toBeNull();
		expect(computeCoreNodeBounds([])).toBeNull();
	});
});
