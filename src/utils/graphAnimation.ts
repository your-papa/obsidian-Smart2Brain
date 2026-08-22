/**
 * Shared animation utilities for the graph canvas.
 */

export interface Transform {
	x: number;
	y: number;
	scale: number;
}

export interface BoundingBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface FramingPadding {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

function normalizeFramingPadding(padding: number | FramingPadding): FramingPadding {
	if (typeof padding === "number") {
		return {
			top: padding,
			right: padding,
			bottom: padding,
			left: padding,
		};
	}
	return padding;
}

/** Ease-out cubic: fast start, gentle deceleration. */
export function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

/**
 * Compute the axis-aligned bounding box of a set of 2D points.
 * Returns `null` if no valid points are found.
 */
export function computeNodeBounds<T extends { x?: number | null; y?: number | null }>(
	nodes: ReadonlyArray<T>,
	filter?: (node: T) => boolean,
): BoundingBox | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let count = 0;

	for (const node of nodes) {
		if (node.x != null && node.y != null && (!filter || filter(node))) {
			minX = Math.min(minX, node.x);
			minY = Math.min(minY, node.y);
			maxX = Math.max(maxX, node.x);
			maxY = Math.max(maxY, node.y);
			count++;
		}
	}

	return count > 0 ? { minX, minY, maxX, maxY } : null;
}

/** Fraction of nodes excluded from each end of each axis by {@link computeCoreNodeBounds}. */
const CORE_BOUNDS_TRIM_FRACTION = 0.06;
/** Never trim so much that the result stops describing the graph. */
const CORE_BOUNDS_MAX_TRIM_FRACTION = 0.2;

/**
 * Bounding box of the graph's *core*, ignoring the most extreme outliers.
 *
 * Used for the framing *centre* and for measurement, never for the zoom:
 * framing a trimmed core strands the excluded nodes off-screen, which reads as
 * a broken fit. Splitting the two decisions is what lets a lopsided ring of
 * unsorted notes stop shoving the main graph off-centre while every node stays
 * visible — see {@link framingTransform}'s `centreBounds`.
 *
 * Also backs the layout benchmark's `fill`/`waste` metrics, which compare the
 * honest full frame against the area the graph's core actually occupies —
 * how "a knot marooned in white space" gets quantified rather than eyeballed.
 *
 * Trims by rank rather than distance so the result is stable regardless of how
 * far a stray drifted, and always keeps at least one node per end so small
 * graphs (where a single satellite is a large share of the population) are
 * trimmed too — a proportional-only trim rounds to zero there, which is
 * exactly the case that motivated this.
 *
 * Falls back to the full bounds when the graph is too small to trim
 * meaningfully.
 */
export function computeCoreNodeBounds<T extends { x?: number | null; y?: number | null }>(
	nodes: ReadonlyArray<T>,
	filter?: (node: T) => boolean,
): BoundingBox | null {
	const xs: number[] = [];
	const ys: number[] = [];
	for (const node of nodes) {
		if (node.x != null && node.y != null && (!filter || filter(node))) {
			xs.push(node.x);
			ys.push(node.y);
		}
	}
	if (xs.length === 0) return null;
	// Below ~8 nodes every node is a meaningful share of the picture.
	if (xs.length < 8) return computeNodeBounds(nodes, filter);

	const maxTrim = Math.floor((xs.length * CORE_BOUNDS_MAX_TRIM_FRACTION) / 2);
	const trim = Math.min(Math.max(1, Math.round(xs.length * CORE_BOUNDS_TRIM_FRACTION)), maxTrim);
	if (trim < 1) return computeNodeBounds(nodes, filter);

	xs.sort((a, b) => a - b);
	ys.sort((a, b) => a - b);
	return {
		minX: xs[trim],
		maxX: xs[xs.length - 1 - trim],
		minY: ys[trim],
		maxY: ys[ys.length - 1 - trim],
	};
}

/**
 * Zoom ceiling for framing the *whole* graph.
 *
 * Without a cap, fitting a tiny vault (or a collapsed view) magnifies a
 * handful of nodes to fill the viewport — giant discs with giant labels. A
 * small graph should sit comfortably at near-natural scale with room around
 * it instead. Selection zooms deliberately ignore this: zooming *to* a few
 * chosen notes is exactly when high magnification is wanted.
 *
 * Shared with the layout benchmark so measured `fit`/`nodePx` match the app.
 */
export const GRAPH_FIT_MAX_SCALE = 1.3;

/**
 * The world point a framing settles on, plus its scale — what the renderer's
 * `animateToFrame`/`snapToFrame` take. Callers should use this rather than
 * averaging a bounding box themselves, or they lose the outlier-aware centring
 * and its clamp.
 */
export interface FramingFocus {
	centerX: number;
	centerY: number;
	scale: number;
}

/** {@link framingTransform}'s centre and scale, for the renderer's frame API. */
export function framingFocus(
	bounds: BoundingBox,
	viewport: { width: number; height: number },
	padding: number | FramingPadding = 40,
	maxScale = 4,
	centreBounds?: BoundingBox | null,
): FramingFocus {
	const insets = normalizeFramingPadding(padding);
	const usableWidth = Math.max(1, viewport.width - insets.left - insets.right);
	const usableHeight = Math.max(1, viewport.height - insets.top - insets.bottom);
	const transform = framingTransform(bounds, viewport, padding, maxScale, centreBounds);
	// Invert the transform to recover the world point at the viewport's centre.
	return {
		centerX: (insets.left + usableWidth / 2 - transform.x) / transform.scale,
		centerY: (insets.top + usableHeight / 2 - transform.y) / transform.scale,
		scale: transform.scale,
	};
}

/**
 * Calculate the target camera transform that frames a bounding box
 * within a viewport of the given width and height.
 *
 * @param bounds   The bounding box to frame — every node in it stays visible.
 * @param viewport The viewport dimensions `{ width, height }`.
 * @param padding  Pixel padding around the edges.
 * @param maxScale Maximum allowed zoom level (default 4).
 * @param centreBounds
 *   Optional box to centre on instead of `bounds`. Framing is really two
 *   decisions — where to look and how far out — and only the first should
 *   care about outliers. Unsorted notes settle in a lopsided ring, so
 *   centring on the *full* box shoves the main graph off to one side; centring
 *   on the core puts it back in the middle. The centre is then clamped so
 *   `bounds` still fits, which keeps the zoom's promise that nothing is
 *   stranded off-screen.
 */
export function framingTransform(
	bounds: BoundingBox,
	viewport: { width: number; height: number },
	padding: number | FramingPadding = 40,
	maxScale = 4,
	centreBounds?: BoundingBox | null,
): Transform {
	const insets = normalizeFramingPadding(padding);
	const graphWidth = bounds.maxX - bounds.minX || 1;
	const graphHeight = bounds.maxY - bounds.minY || 1;

	const usableWidth = Math.max(1, viewport.width - insets.left - insets.right);
	const usableHeight = Math.max(1, viewport.height - insets.top - insets.bottom);
	const scaleX = usableWidth / graphWidth;
	const scaleY = usableHeight / graphHeight;
	const scale = Math.min(scaleX, scaleY, maxScale);

	const focus = centreBounds ?? bounds;
	let centerX = (focus.minX + focus.maxX) / 2;
	let centerY = (focus.minY + focus.maxY) / 2;

	// Keep every node in `bounds` on screen: the centre may only move as far as
	// the slack between what the viewport shows at this scale and the full
	// extent. When the graph exactly fills the view there is no slack and the
	// centre stays put; when the zoom cap left room to spare, the core can
	// shift into the middle of it.
	const halfViewWidth = usableWidth / (2 * scale);
	const halfViewHeight = usableHeight / (2 * scale);
	const minCenterX = bounds.maxX - halfViewWidth;
	const maxCenterX = bounds.minX + halfViewWidth;
	const minCenterY = bounds.maxY - halfViewHeight;
	const maxCenterY = bounds.minY + halfViewHeight;
	// When the extent exceeds the view the bounds invert; fall back to the
	// full box's centre rather than picking an arbitrary edge.
	centerX =
		minCenterX <= maxCenterX
			? Math.min(Math.max(centerX, minCenterX), maxCenterX)
			: (bounds.minX + bounds.maxX) / 2;
	centerY =
		minCenterY <= maxCenterY
			? Math.min(Math.max(centerY, minCenterY), maxCenterY)
			: (bounds.minY + bounds.maxY) / 2;

	const viewportCenterX = insets.left + usableWidth / 2;
	const viewportCenterY = insets.top + usableHeight / 2;

	return {
		x: viewportCenterX - centerX * scale,
		y: viewportCenterY - centerY * scale,
		scale,
	};
}

/**
 * Animate a camera transform from its current value to a target over a given
 * duration using ease-out cubic easing.
 *
 * Returns a cleanup function that cancels the in-flight animation.
 *
 * @param getCurrent  Read the current transform (snapshot taken once at start).
 * @param setCurrent  Write the new transform each frame (should trigger a re-render).
 * @param target      The desired end transform `{ x, y, scale }`.
 * @param duration    Animation length in milliseconds.
 * @param onComplete  Optional callback fired when the animation finishes.
 */
export function animateTransform(
	getCurrent: () => Transform,
	setCurrent: (t: Transform) => void,
	target: Transform,
	duration: number,
	onComplete?: () => void,
): () => void {
	const start = { ...getCurrent() };
	const startTime = performance.now();
	let rafId: number | null = null;

	function step(now: number) {
		const elapsed = now - startTime;
		const t = Math.min(elapsed / duration, 1);
		const ease = easeOutCubic(t);

		setCurrent({
			x: start.x + (target.x - start.x) * ease,
			y: start.y + (target.y - start.y) * ease,
			scale: start.scale + (target.scale - start.scale) * ease,
		});

		if (t < 1) {
			rafId = requestAnimationFrame(step);
		} else {
			rafId = null;
			onComplete?.();
		}
	}

	rafId = requestAnimationFrame(step);

	return () => {
		if (rafId != null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	};
}
