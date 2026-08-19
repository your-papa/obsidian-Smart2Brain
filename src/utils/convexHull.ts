/**
 * Convex Hull
 *
 * Geometry for the topic regions drawn behind the graph. Pure and free of Pixi
 * and Obsidian types so it can be unit tested.
 *
 * A topic's hull is its members' convex hull, padded outward so nodes sit
 * comfortably inside rather than on the boundary, then smoothed so the shape
 * reads as an organic region rather than a polygon.
 */

export interface Point {
	x: number;
	y: number;
}

/** Cross product of OA × OB. >0 = counter-clockwise turn. */
function cross(o: Point, a: Point, b: Point): number {
	return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Convex hull via monotone chain (Andrew's algorithm), O(n log n).
 *
 * Returns points in counter-clockwise order. Degenerate inputs (0–2 points, or
 * all points collinear) return the deduplicated input — callers handle those as
 * a special case, since a "region" needs at least a triangle.
 */
export function convexHull(points: Point[]): Point[] {
	if (points.length < 3) return [...points];

	// Sort by x, then y. Also dedupes so repeated coordinates can't break the chain.
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	const unique: Point[] = [];
	for (const point of sorted) {
		const last = unique[unique.length - 1];
		if (!last || last.x !== point.x || last.y !== point.y) unique.push(point);
	}
	if (unique.length < 3) return unique;

	const lower: Point[] = [];
	for (const point of unique) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
			lower.pop();
		}
		lower.push(point);
	}

	const upper: Point[] = [];
	for (let i = unique.length - 1; i >= 0; i--) {
		const point = unique[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
			upper.pop();
		}
		upper.push(point);
	}

	// Drop each chain's last point — it's the other chain's first.
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

/** Arithmetic mean of a set of points. */
export function centroid(points: Point[]): Point {
	if (points.length === 0) return { x: 0, y: 0 };
	let x = 0;
	let y = 0;
	for (const point of points) {
		x += point.x;
		y += point.y;
	}
	return { x: x / points.length, y: y / points.length };
}

/**
 * Push each hull vertex outward from the centroid by `padding` world units, so
 * member nodes sit inside the region instead of on its edge.
 */
export function expandHull(hull: Point[], padding: number): Point[] {
	if (hull.length === 0 || padding === 0) return hull;
	const center = centroid(hull);

	return hull.map((point) => {
		const dx = point.x - center.x;
		const dy = point.y - center.y;
		const distance = Math.hypot(dx, dy);
		// A vertex sitting exactly on the centroid has no outward direction.
		if (distance < 1e-6) return point;
		const scale = (distance + padding) / distance;
		return { x: center.x + dx * scale, y: center.y + dy * scale };
	});
}

/**
 * Smooth a closed polygon by Chaikin corner-cutting.
 *
 * Each iteration replaces every edge with two points at 1/4 and 3/4 along it,
 * rounding the corners. Two iterations is enough to read as organic without
 * inflating the point count much (4× per iteration).
 */
export function smoothClosedPath(points: Point[], iterations = 2): Point[] {
	if (points.length < 3) return points;

	let current = points;
	for (let iteration = 0; iteration < iterations; iteration++) {
		const next: Point[] = [];
		for (let i = 0; i < current.length; i++) {
			const a = current[i];
			const b = current[(i + 1) % current.length];
			next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
			next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
		}
		current = next;
	}
	return current;
}

/**
 * Build the drawable region for a group of node positions.
 *
 * Groups of one or two nodes have no area, so a small circle/capsule is
 * synthesised around them — otherwise a two-note topic would silently vanish
 * while every other topic showed a region.
 *
 * Returns null for an empty group.
 */
export function buildTopicRegion(points: Point[], padding: number): Point[] | null {
	if (points.length === 0) return null;

	if (points.length <= 2) {
		// Trace a capsule around the one or two points.
		const center = centroid(points);
		const half = points.length === 2 ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) / 2 : 0;
		const radius = padding + half;
		const steps = 16;
		return Array.from({ length: steps }, (_, i) => {
			const angle = (i / steps) * Math.PI * 2;
			return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
		});
	}

	const hull = convexHull(points);
	// Collinear points produce a degenerate hull with no area; fall back to a
	// capsule around their extent so the topic still reads as a region.
	if (hull.length < 3) {
		return buildTopicRegion([hull[0] ?? points[0], hull[hull.length - 1] ?? points[points.length - 1]], padding);
	}

	return smoothClosedPath(expandHull(hull, padding));
}
