import { describe, expect, it } from "vitest";
import { canNavigate, createResolveButton } from "../../src/lib/diffActionButton";

/**
 * `diffActionButton` sits in an import cycle:
 *   diffActionButton -> pendingChangeNavigation -> readingViewDiffProcessor
 * and both editor modules import back into diffActionButton. Importing and
 * calling across that cycle must not hit a temporal-dead-zone ReferenceError.
 */
describe("diffActionButton module cycle", () => {
	it("resolves canNavigate across the cycle without a TDZ error", () => {
		// The pending-changes store isn't initialized in the unit env, so this must
		// fall into the guard and return false rather than throwing.
		expect(canNavigate("nonexistent-entry")).toBe(false);
	});

	it("builds a resolve button with a separable icon and label", () => {
		const btn = createResolveButton("s2b-diff-accept-btn", "check", "Accept", "Accept change");
		expect(btn.className).toBe("s2b-diff-accept-btn");
		expect(btn.getAttribute("aria-label")).toBe("Accept change");
		// The label lives in its own span so the container query can drop it
		// without touching the glyph.
		expect(btn.querySelector(".s2b-diff-btn-label")?.textContent).toBe("Accept");
		expect(btn.querySelector(".s2b-diff-btn-icon")).not.toBeNull();
	});
});
