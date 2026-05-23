import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
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

function closeOpenModals() {
	obsidianEval(`(() => {
		document.querySelectorAll(".modal-close-button, .modal button").forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			const text = el.textContent || "";
			const label = el.getAttribute("aria-label") || "";
			if (
				label === "Close" ||
				text.includes("Cancel") ||
				text.includes("Create Space") ||
				text.includes("Save Changes") ||
				text.includes("Add file") ||
				text.includes("Add 1 file") ||
				text.includes("Add 2 files")
			) {
				try {
					el.click();
				} catch {}
			}
		});
		return document.querySelectorAll(".modal").length;
	})()`);
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
		const summaries = Array.from(document.querySelectorAll(".s2b-search-selection-summary"));
		const summary = summaries[summaries.length - 1];
		return summary instanceof HTMLElement ? (summary.textContent ?? "") : "";
	})()`);
	return raw.startsWith("=> ") ? raw.slice(3) : raw;
}

describe("spaces editor", () => {
	beforeAll(() => {
		clearBuffers();
		resetSpaces();
		closeOpenModals();
	});

	afterAll(() => {
		resetSpaces();
		closeOpenModals();
		clearBuffers();
	});

	it("adds multiple selected files when confirming from the shared file picker", async () => {
		clearBuffers();
		resetSpaces();
		closeOpenModals();

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

		await waitForSelector(".s2b-search-modal .prompt-input");

		expect(
			obsidianEval(`(() => {
			const pickers = Array.from(document.querySelectorAll(".s2b-search-modal"));
			const picker = pickers[pickers.length - 1];
			const searchInput = picker instanceof HTMLElement ? picker.querySelector(".prompt-input") : null;
			return searchInput instanceof HTMLInputElement ? searchInput.placeholder : "missing-search-input";
		})()`),
		).toContain("Search vault files");

		expect(
			obsidianEval(`(() => {
			const pickers = Array.from(document.querySelectorAll(".s2b-search-modal"));
			const picker = pickers[pickers.length - 1];
			const input = picker instanceof HTMLElement ? picker.querySelector(".prompt-input") : null;
			if (!(input instanceof HTMLInputElement)) return "missing-search-input";
			input.value = "Welcome";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return input.value;
		})()`),
		).toContain("Welcome");

		await waitForCondition(
			() =>
				obsidianEval(`Array.from(document.querySelectorAll(".s2b-search-modal .suggestion-item")).some((el) => {
					if (!(el instanceof HTMLElement)) return false;
					return (el.textContent || "").includes("Welcome");
				})`).includes(
					"true",
				),
			"Welcome result row to appear",
			{ timeoutMs: 20_000, intervalMs: 250 },
		);

		expect(
			obsidianEval(`(() => {
			const pickers = Array.from(document.querySelectorAll(".s2b-search-modal"));
			const picker = pickers[pickers.length - 1];
			if (!(picker instanceof HTMLElement)) return "missing-picker";
			picker.dispatchEvent(new KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				shiftKey: true,
				bubbles: true,
				cancelable: true,
			}));
			return "toggled-first-selection";
		})()`),
		).toContain("toggled-first-selection");

		await waitForCondition(
			() => latestSelectionSummaryText().includes("1 selected"),
			"first picker selection summary to appear",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		expect(
			obsidianEval(`(() => {
			const pickers = Array.from(document.querySelectorAll(".s2b-search-modal"));
			const picker = pickers[pickers.length - 1];
			const input = picker instanceof HTMLElement ? picker.querySelector(".prompt-input") : null;
			if (!(input instanceof HTMLInputElement)) return "missing-search-input";
			input.value = "Project";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return input.value;
		})()`),
		).toContain("Project");

		await waitForCondition(
			() =>
				obsidianEval(`Array.from(document.querySelectorAll(".s2b-search-modal .suggestion-item")).some((el) => {
					if (!(el instanceof HTMLElement)) return false;
					return (el.textContent || "").includes("Project Management Notes");
				})`).includes("true"),
			"Project Management Notes result row to appear",
			{ timeoutMs: 20_000, intervalMs: 250 },
		);

		expect(
			obsidianEval(`(() => {
			const pickers = Array.from(document.querySelectorAll(".s2b-search-modal"));
			const picker = pickers[pickers.length - 1];
			if (!(picker instanceof HTMLElement)) return "missing-picker";
			picker.dispatchEvent(new KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				shiftKey: true,
				bubbles: true,
				cancelable: true,
			}));
			return "toggled-second-selection";
		})()`),
		).toContain("toggled-second-selection");

		await waitForCondition(
			() => latestSelectionSummaryText().includes("2 selected"),
			"second picker selection summary to appear",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		expect(
			obsidianEval(`(() => {
			const pickers = Array.from(document.querySelectorAll(".s2b-search-modal"));
			const picker = pickers[pickers.length - 1];
			if (!(picker instanceof HTMLElement)) return "missing-picker";
			picker.dispatchEvent(new KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				bubbles: true,
				cancelable: true,
			}));
			return "confirmed-selected-files";
		})()`),
		).toContain("confirmed-selected-files");

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
