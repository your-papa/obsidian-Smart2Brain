/**
 * Svelte action: keep touch drags inside this element away from Obsidian's
 * mobile swipe gestures (sidebar open/close, pull-down command palette).
 *
 * ## What the host actually does
 *
 * Measured on-device (iOS 26) by patching `addEventListener` in the live
 * WebView, the recognizer registers as:
 *
 *     window | touchmove | bubble | function(i){var r=E(i); ...
 *       Math.abs(o-a) vs Math.abs(h-s) ... Date.now()-d>200 ...
 *
 * That is: **`touchmove`, on `window`, in the bubble phase**, doing axis
 * detection against the touch start within a 200 ms window.
 *
 * Two consequences, both of which earlier attempts got wrong:
 *
 * 1. **It listens to `touchmove`, not `pointermove`.** iOS Safari dispatches
 *    the two independently, so stopping pointer events does nothing.
 * 2. **It is on `window` in the bubble phase** — the very last thing to run.
 *    So `stopPropagation` from anywhere inside the sheet reliably starves it.
 *    (A capture-phase listener on an ancestor could not have been blocked
 *    this way; this one can.)
 *
 * Verified on-device: with this stop attached, synthetic touchmoves on the
 * slider reach the window listener 0 times; without it, every one arrives.
 *
 * ## Why not `touch-action`
 *
 * `touch-action` only governs the *browser's* built-in panning/zooming. It
 * never had any effect on a JS recognizer, which is why `manipulation` →
 * `pan-y` (#417) and then `pan-y` → `none` both failed on hardware. It is
 * still worth setting to stop native scroll fighting the drag, but it is not
 * what protects against the host gesture.
 *
 * ## Scope
 *
 * `touchmove` only. `touchstart`/`touchend` still propagate, so taps, focus
 * and the host's own bookkeeping are untouched — a swipe recognizer that gets
 * a start but no moves simply never fires. Non-passive is required: some
 * callers also want `preventDefault` available, and a passive listener could
 * not offer it; we only ever call `stopPropagation` here.
 */
export function claimTouchGestures(node: HTMLElement) {
	const stop = (e: Event) => e.stopPropagation();
	node.addEventListener("touchmove", stop);
	return {
		destroy() {
			node.removeEventListener("touchmove", stop);
		},
	};
}
