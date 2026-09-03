import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it } from "vitest";
import type SecondBrainPlugin from "../../src/main";
import { SmartGraphView } from "../../src/views/smart-graph/SmartGraphView";

describe("SmartGraphView", () => {
	it("is a navigation view, so Obsidian's Escape handler leaves it alone", () => {
		// Obsidian's workspace binds a window-level Escape listener that moves
		// focus to the most-recently-active navigation leaf whenever the active
		// view has navigation=false (the "escape from sidebar back to editor"
		// behavior). The graph is a main-area tab like the core graph view;
		// without this flag, pressing Escape in it appeared to open a random note.
		const view = new SmartGraphView(new WorkspaceLeaf(), {} as SecondBrainPlugin);
		expect(view.navigation).toBe(true);
	});
});
