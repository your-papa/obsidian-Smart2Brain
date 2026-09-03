import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toolHasConfigurableSettings } from "../../src/agent/tools/builtInToolDefaults";
import { BUILT_IN_TOOL_IDS } from "../../src/types/plugin";

/*
 * `TOOLS_WITH_SETTINGS` decides whether ToolsModal renders a gear icon for a tool, and
 * it is hand-maintained alongside the per-tool branches in `ToolConfigForm.svelte`.
 * Nothing enforced that pairing, so it silently went stale when `search_notes` lost its
 * last setting: the gear kept rendering and opened an empty modal.
 *
 * The form is a Svelte component whose branches cannot be introspected at runtime, so
 * this reads its source and compares the two lists directly. Cruder than importing a
 * shared constant, but it fails loudly the next time the two drift — which is the whole
 * point, and is what was missing.
 */

// Resolved from cwd (the repo root under Vitest) rather than `import.meta.url`: the
// jsdom environment does not expose a file:// module URL.
const FORM_SOURCE = readFileSync(resolve("src/components/modal/ToolConfigForm.svelte"), "utf8");

/** Tool ids whose `ToolConfigForm` branch renders at least one real control. */
function toolIdsWithRenderedSettings(): Set<string> {
	// Branches look like `{#if capturedToolId === "x"}` / `{:else if capturedToolId === "x"}`.
	// Slice each branch's body and check whether it contains a SettingContainer; a branch
	// holding only a comment (the deliberate "nothing to configure here" case) does not.
	const branch = /capturedToolId === "([a-z_]+)"\}/g;
	const starts: Array<{ id: string; index: number }> = [];
	let match = branch.exec(FORM_SOURCE);
	while (match !== null) {
		starts.push({ id: match[1], index: match.index + match[0].length });
		match = branch.exec(FORM_SOURCE);
	}

	const withSettings = new Set<string>();
	for (const [i, start] of starts.entries()) {
		const end = i + 1 < starts.length ? starts[i + 1].index : FORM_SOURCE.length;
		if (FORM_SOURCE.slice(start.index, end).includes("<SettingContainer")) {
			withSettings.add(start.id);
		}
	}
	return withSettings;
}

describe("toolHasConfigurableSettings", () => {
	it("matches which tools actually render settings in ToolConfigForm", () => {
		const rendered = toolIdsWithRenderedSettings();
		// Sanity-check the parse itself: if the regex stops matching, every tool would
		// look settings-less and the comparison below would pass vacuously.
		expect(rendered.size).toBeGreaterThan(0);

		for (const toolId of BUILT_IN_TOOL_IDS) {
			expect(
				toolHasConfigurableSettings(toolId),
				`${toolId}: TOOLS_WITH_SETTINGS says ${toolHasConfigurableSettings(toolId)}, but ToolConfigForm ${
					rendered.has(toolId) ? "renders" : "renders no"
				} settings for it. A tool with the gear but no controls opens an empty modal.`,
			).toBe(rendered.has(toolId));
		}
	});

	it("does not offer settings for search_notes", () => {
		// Pinned explicitly because it is the case that regressed: algorithm and
		// maxResults became per-call tool parameters, leaving nothing to configure.
		expect(toolHasConfigurableSettings("search_notes")).toBe(false);
	});
});
