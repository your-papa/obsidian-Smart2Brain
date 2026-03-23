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

/**
 * Calculate the target camera transform that frames a bounding box
 * within a viewport of the given width and height.
 *
 * @param bounds   The bounding box to frame.
 * @param viewport The viewport dimensions `{ width, height }`.
 * @param padding  Pixel padding around the edges.
 * @param maxScale Maximum allowed zoom level (default 4).
 */
export function framingTransform(
	bounds: BoundingBox,
	viewport: { width: number; height: number },
	padding = 40,
	maxScale = 4,
): Transform {
	const graphWidth = bounds.maxX - bounds.minX || 1;
	const graphHeight = bounds.maxY - bounds.minY || 1;

	const scaleX = (viewport.width - padding * 2) / graphWidth;
	const scaleY = (viewport.height - padding * 2) / graphHeight;
	const scale = Math.min(scaleX, scaleY, maxScale);

	const centerX = (bounds.minX + bounds.maxX) / 2;
	const centerY = (bounds.minY + bounds.maxY) / 2;

	return {
		x: viewport.width / 2 - centerX * scale,
		y: viewport.height / 2 - centerY * scale,
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
