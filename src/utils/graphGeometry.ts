/**
 * Pure 2-D geometry used by the graph canvas for hit-testing and culling.
 * Free of Pixi/Svelte/Obsidian types so it can be unit tested; the hull
 * construction itself lives in `convexHull.ts`.
 */

import { type Point, centroid } from "./convexHull";

/** Axis-aligned world-space rectangle. */
export type WorldRect = { minX: number; minY: number; maxX: number; maxY: number };

/** Whether `inner` lies entirely within `outer` (touching edges count as inside). */
export function rectContains(outer: WorldRect, inner: WorldRect): boolean {
	return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if (px, py) is inside the polygon defined by `poly`.
 */
export function pointInPolygon(px: number, py: number, poly: Point[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const xi = poly[i].x;
		const yi = poly[i].y;
		const xj = poly[j].x;
		const yj = poly[j].y;
		if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * How far past the median centroid distance a member may sit before it stops
 * shaping its topic's region. Low enough to keep strays from stretching a hull
 * across the canvas, high enough not to clip genuinely spread-out topics.
 */
export const HULL_OUTLIER_FACTOR = 2.2;

/**
 * Drop members that sit far outside their topic's core.
 *
 * A convex hull is defined by its extremes, so one stray node drags the whole
 * region with it. Anything beyond {@link HULL_OUTLIER_FACTOR} times the median
 * distance from the centroid is excluded from the shape — the node still
 * renders, it just doesn't define the boundary.
 */
export function trimOutliers(points: Point[], outlierFactor = HULL_OUTLIER_FACTOR): Point[] {
	if (points.length < 4) return points;

	const center = centroid(points);
	const distances = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
	const sorted = [...distances].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	if (median <= 0) return points;

	const limit = median * outlierFactor;
	const kept = points.filter((_, index) => distances[index] <= limit);
	// Never trim away so much that the region stops representing the topic.
	return kept.length >= 3 ? kept : points;
}
