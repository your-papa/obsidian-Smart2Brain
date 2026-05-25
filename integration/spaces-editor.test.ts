import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	closeAllModals,
	executeCommand,
	getErrors,
	obsidianEval,
	waitForCondition,
	waitForSelector,
} from "./helpers/cli.ts";

function resetSpaces() {
	obsidianEval(`(() => {
		const plugin = ${PLUGIN};
		const spaces = [...plugin.pluginData.spaces];
		for (const space of spaces) {
			plugin.pluginData.deleteSpace(space.id);
		}
		return plugin.pluginData.spaces.length;
	})()`);
}

const ACTIVE_PICKER = ".modal-container:last-of-type .s2b-search-modal";

function activePickerSelector(selector: string): string {
	return `${ACTIVE_PICKER} ${selector}`;
}

function latestSpaceEditorText(): string {
	const raw = obsidianEval(`(() => {
		const editors = Array.from(document.querySelectorAll(".s2b-space-editor"));
		const editor = editors[editors.length - 1];
		return editor instanceof HTMLElement ? (editor.textContent ?? "") : "";
	})()`);
	return raw.startsWith("=> ") ? raw.slice(3) : raw;
}

function latestSelectionSummaryText(): string {
	const raw = obsidianEval(`(() => {
		const summary = document.querySelector(${JSON.stringify(activePickerSelector(".s2b-search-selection-summary"))});
		return summary instanceof HTMLElement ? (summary.textContent ?? "") : "";
	})()`);
	return raw.startsWith("=> ") ? raw.slice(3) : raw;
}

function dispatchLatestPickerKey(options: {
	key: string;
	code: string;
	shiftKey?: boolean;
}): string {
	return obsidianEval(`(() => {
		const picker = document.querySelector(${JSON.stringify(ACTIVE_PICKER)});
		const target = picker instanceof HTMLElement ? picker.querySelector(".prompt-input") ?? picker : null;
		if (!(target instanceof HTMLElement)) return "missing-picker";
		target.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify({
		bubbles: true,
		cancelable: true,
		...options,
	})}));
		return "dispatched";
	})()`);
}

describe("spaces editor", () => {
	beforeAll(() => {
		clearBuffers();
		resetSpaces();
		closeAllModals();
	});

	afterAll(() => {
		resetSpaces();
		closeAllModals();
		clearBuffers();
	});

	it("adds multiple selected files when confirming from the shared file picker", async () => {
		clearBuffers();
		resetSpaces();
		closeAllModals();

		executeCommand("smart-second-brain:open-smart-graph");
		await waitForSelector(".space-switcher-trigger");

		expect(
			obsidianEval(`(() => {
			const trigger = document.querySelector(".space-switcher-trigger");
			if (!(trigger instanceof HTMLElement)) return "missing-trigger";
			trigger.click();
			return "clicked-trigger";
		})()`),
		).toContain("clicked-trigger");

		await waitForCondition(
			() =>
				obsidianEval(`Array.from(document.querySelectorAll("button")).some((el) => {
					if (!(el instanceof HTMLElement)) return false;
					return (el.textContent || "").trim() === "New Space";
				})`).includes("true"),
			"New Space option to appear",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		expect(
			obsidianEval(`(() => {
			const button = Array.from(document.querySelectorAll("button")).find((el) => {
				if (!(el instanceof HTMLElement)) return false;
				return (el.textContent || "").trim() === "New Space";
			});
			if (!(button instanceof HTMLElement)) return "missing-new-space";
			button.click();
			return "clicked-new-space";
		})()`),
		).toContain("clicked-new-space");
		await waitForSelector(".s2b-space-editor");

		expect(
			obsidianEval(`(() => {
			const editors = Array.from(document.querySelectorAll(".s2b-space-editor"));
			const editor = editors[editors.length - 1];
			const buttons = editor instanceof HTMLElement ? Array.from(editor.querySelectorAll("button")) : [];
			const addButton = buttons.find((el) => {
				if (!(el instanceof HTMLElement)) return false;
				return (el.textContent || "").trim() === "Add files";
			});
			if (!(addButton instanceof HTMLElement)) return "missing-add-files";
			addButton.click();
			return "opened-picker-modal";
		})()`),
		).toContain("opened-picker-modal");

		await waitForSelector(activePickerSelector(".prompt-input"));

		expect(
			obsidianEval(`(() => {
			const picker = document.querySelector(${JSON.stringify(ACTIVE_PICKER)});
			const searchInput = picker instanceof HTMLElement ? picker.querySelector(".prompt-input") : null;
			return searchInput instanceof HTMLInputElement ? searchInput.placeholder : "missing-search-input";
		})()`),
		).toContain("Search vault files");

		expect(
			obsidianEval(`(() => {
			const picker = document.querySelector(${JSON.stringify(ACTIVE_PICKER)});
			const input = picker instanceof HTMLElement ? picker.querySelector(".prompt-input") : null;
			if (!(input instanceof HTMLInputElement)) return "missing-search-input";
			input.value = "Welcome";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return input.value;
		})()`),
		).toContain("Welcome");

		await waitForCondition(
			() =>
				obsidianEval(`Array.from(document.querySelectorAll(${JSON.stringify(activePickerSelector(".suggestion-item"))})).some((el) => {
					if (!(el instanceof HTMLElement)) return false;
					return (el.textContent || "").includes("Welcome");
				})`).includes(
					"true",
				),
			"Welcome result row to appear",
			{ timeoutMs: 20_000, intervalMs: 250 },
		);

		expect(dispatchLatestPickerKey({ key: "Enter", code: "Enter", shiftKey: true })).toContain(
			"dispatched",
		);

		await waitForCondition(
			() => latestSelectionSummaryText().includes("Selected:"),
			"first picker selection summary to appear",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		expect(
			obsidianEval(`(() => {
			const picker = document.querySelector(${JSON.stringify(ACTIVE_PICKER)});
			const input = picker instanceof HTMLElement ? picker.querySelector(".prompt-input") : null;
			if (!(input instanceof HTMLInputElement)) return "missing-search-input";
			input.value = "Project";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return input.value;
		})()`),
		).toContain("Project");

		await waitForCondition(
			() =>
				obsidianEval(`Array.from(document.querySelectorAll(${JSON.stringify(activePickerSelector(".suggestion-item"))})).some((el) => {
					if (!(el instanceof HTMLElement)) return false;
					return (el.textContent || "").includes("Project Management Notes");
				})`).includes("true"),
			"Project Management Notes result row to appear",
			{ timeoutMs: 20_000, intervalMs: 250 },
		);

		expect(dispatchLatestPickerKey({ key: "Enter", code: "Enter", shiftKey: true })).toContain(
			"dispatched",
		);

		await waitForCondition(
			() => latestSelectionSummaryText().includes("2 selected"),
			"second picker selection summary to appear",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		expect(dispatchLatestPickerKey({ key: "Enter", code: "Enter" })).toContain("dispatched");

		await waitForCondition(
			() => {
				const editorText = latestSpaceEditorText();
				return editorText.includes("Welcome") && editorText.includes("Project Management Notes");
			},
			"selected files to appear in the included files list",
			{ timeoutMs: 20_000, intervalMs: 250 },
		);

		expect(latestSpaceEditorText()).toContain("Welcome");
		expect(latestSpaceEditorText()).toContain("Project Management Notes");
		expect(getErrors()).toBe("");
	});
});
