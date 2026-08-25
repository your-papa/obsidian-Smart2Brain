import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));
// Only the pure diff-attribution helpers are under test; stub the module's
// UI-side imports so the test doesn't drag in the whole view layer.
vi.mock("../../src/lib/pendingChangeNavigation", () => ({ navigateToPendingChange: vi.fn() }));
vi.mock("../../src/stores/state.svelte", () => ({ getPlugin: vi.fn() }));
vi.mock("../../src/stores/dataStore.svelte", () => ({ getData: vi.fn() }));
vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({ getPendingChangesStore: vi.fn() }));

import { computeOriginalAffectedLines, insertionAnchorLine } from "../../src/editor/readingViewDiffProcessor";

describe("insertionAnchorLine", () => {
	it("anchors to the following line, and to the previous line at EOF", () => {
		expect(insertionAnchorLine(2, 5)).toBe(2);
		expect(insertionAnchorLine(5, 5)).toBe(4);
		expect(insertionAnchorLine(0, 0)).toBe(0);
	});
});

describe("computeOriginalAffectedLines", () => {
	it("marks removed lines as affected", () => {
		const affected = computeOriginalAffectedLines("a\nb\nc\n", "a\nc\n");
		expect(affected).toEqual(new Set([1]));
	});

	it("anchors a pure insertion to the following original line", () => {
		const affected = computeOriginalAffectedLines("a\nb\n", "a\nNEW\nb\n");
		expect(affected).toEqual(new Set([1]));
	});

	it("anchors a pure insertion at EOF to the last original line", () => {
		const affected = computeOriginalAffectedLines("a\nb\n", "a\nb\nNEW\n");
		expect(affected).toEqual(new Set([1]));
	});

	/**
	 * Regression: a REPLACEMENT (removed + added in one group) must affect only
	 * the replaced lines. The added part used to be anchored like a pure
	 * insertion — but by then the line counter had advanced past the removed
	 * run, so the line AFTER the replacement was falsely marked. In the reading
	 * view that handed the change's new text to the NEXT rendered section: any
	 * single-line heading edit showed the old heading as fully removed with the
	 * new text missing from its card, while the following section got a phantom
	 * card.
	 */
	it("does not mark the line after a replacement as affected", () => {
		const affected = computeOriginalAffectedLines(
			"# Title\n\nintro paragraph\n",
			"# Title (edited)\n\nintro paragraph\n",
		);
		expect(affected).toEqual(new Set([0]));
	});

	it("keeps replacement and pure-insertion attribution independent in one diff", () => {
		// Line 0 replaced; a new line inserted before line 2 ("c").
		const affected = computeOriginalAffectedLines("a\nb\nc\n", "A\nb\nNEW\nc\n");
		expect(affected).toEqual(new Set([0, 2]));
	});
});
