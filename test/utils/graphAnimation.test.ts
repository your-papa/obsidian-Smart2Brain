import { describe, expect, it } from "vitest";
import { computeCoreNodeBounds, computeNodeBounds, framingFocus } from "../../src/utils/graphAnimation";

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

describe("framingFocus", () => {
	const viewport = { width: 1000, height: 1000 };

	// Small enough that the 1.3x zoom cap binds instead of the extent, which is
	// what leaves slack for the centre to move within.
	const bounds = { minX: -100, maxX: 300, minY: -100, maxY: 100 };
	const core = { minX: -100, maxX: 100, minY: -100, maxY: 100 };

	it("centres on the core rather than the full extent", () => {
		// Main graph around the origin, one stray off to the right: centring on
		// the full box would shove the graph to the left of the viewport.
		const focus = framingFocus(bounds, viewport, 40, 1.3, core);
		const fullCentre = (bounds.minX + bounds.maxX) / 2;
		expect(focus.centerX).toBeLessThan(fullCentre);
		expect(focus.centerX).toBeCloseTo(0, 6);
	});

	it("keeps every node in bounds visible despite the recentring", () => {
		const focus = framingFocus(bounds, viewport, 40, 1.3, core);
		const halfW = (viewport.width - 80) / (2 * focus.scale);
		// The clamp is what stops the stray being pushed off-screen.
		expect(focus.centerX + halfW).toBeGreaterThanOrEqual(bounds.maxX - 1e-6);
		expect(focus.centerX - halfW).toBeLessThanOrEqual(bounds.minX + 1e-6);
	});

	it("clamps the recentring when the core sits too far from the extent's edge", () => {
		// Core hard against the left of a wide extent: centring fully on it
		// would push the right-hand nodes out, so the clamp pulls it back.
		const wide = { minX: -100, maxX: 800, minY: -100, maxY: 100 };
		const focus = framingFocus(wide, viewport, 40, 1.3, core);
		const halfW = (viewport.width - 80) / (2 * focus.scale);
		expect(focus.centerX).toBeGreaterThan(0);
		expect(focus.centerX + halfW).toBeGreaterThanOrEqual(wide.maxX - 1e-6);
	});

	it("falls back to the full centre when the graph exceeds the viewport", () => {
		// No slack: the scale is set by the extent, so the centre cannot move.
		const bounds = { minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 };
		const core = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
		const focus = framingFocus(bounds, viewport, 40, 1.3, core);
		expect(focus.centerX).toBeCloseTo(0, 6);
		expect(focus.centerY).toBeCloseTo(0, 6);
	});

	it("matches the plain centre when no core bounds are given", () => {
		const bounds = { minX: 0, maxX: 200, minY: 0, maxY: 200 };
		const focus = framingFocus(bounds, viewport, 40, 1.3);
		expect(focus.centerX).toBeCloseTo(100, 6);
		expect(focus.centerY).toBeCloseTo(100, 6);
	});
});
