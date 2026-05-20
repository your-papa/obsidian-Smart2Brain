import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    PLUGIN,
    clearBuffers,
    domCount,
    domText,
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

    it("supports keyboard-first selection and confirm in the file picker", async () => {
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
			const inputs = editor instanceof HTMLElement ? Array.from(editor.querySelectorAll("input")) : [];
			const input = inputs.find((el) => el instanceof HTMLInputElement && el.placeholder === "Space name");
			if (!(input instanceof HTMLInputElement)) return "missing-name";
			input.value = "Keyboard Picker Test";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return input.value;
		})()`),
        ).toContain("Keyboard Picker Test");

        expect(
            obsidianEval(`(() => {
			const editors = Array.from(document.querySelectorAll(".s2b-space-editor"));
			const editor = editors[editors.length - 1];
			const buttons = editor instanceof HTMLElement ? Array.from(editor.querySelectorAll("button")) : [];
			const button = buttons.find((el) => {
				if (!(el instanceof HTMLElement)) return false;
				return (el.textContent || "").includes("Add file");
			});
			if (!(button instanceof HTMLElement)) return "missing-add-file";
			button.click();
			return "opened-picker";
		})()`),
        ).toContain("opened-picker");
        await waitForSelector(".space-file-picker .search-input");

        expect(
            obsidianEval(`(() => {
			const pickers = Array.from(document.querySelectorAll(".space-file-picker"));
			const picker = pickers[pickers.length - 1];
			const input = picker instanceof HTMLElement ? picker.querySelector(".search-input") : null;
			if (!(input instanceof HTMLInputElement)) return "missing-search-input";
			input.value = "Welcome";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return input.value;
		})()`),
        ).toContain("Welcome");

        await waitForCondition(
            () =>
                obsidianEval(`Array.from(document.querySelectorAll(".space-file-picker .result-row")).some((el) => {
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
			const pickers = Array.from(document.querySelectorAll(".space-file-picker"));
			const picker = pickers[pickers.length - 1];
			const input = picker instanceof HTMLElement ? picker.querySelector(".search-input") : null;
			if (!(input instanceof HTMLInputElement)) return "missing-search-input";
			input.dispatchEvent(new KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				bubbles: true,
				cancelable: true,
			}));
			return "selected-active-result";
		})()`),
        ).toContain("selected-active-result");

        await waitForCondition(
            () => domCount(".selected-files-tray") === 1,
            "selected-files tray to appear after keyboard selection",
            { timeoutMs: 10_000, intervalMs: 250 },
        );
        expect(domText(".selected-files-tray")).toContain("Welcome");

        expect(
            obsidianEval(`(() => {
			const pickers = Array.from(document.querySelectorAll(".space-file-picker"));
			const picker = pickers[pickers.length - 1];
			const input = picker instanceof HTMLElement ? picker.querySelector(".search-input") : null;
			if (!(input instanceof HTMLInputElement)) return "missing-search-input";
			input.dispatchEvent(new KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}));
			return "confirmed-selection";
		})()`),
        ).toContain("confirmed-selection");

        await waitForCondition(
            () => domCount(".space-file-picker") === 0,
            "file picker to close after keyboard confirm",
            { timeoutMs: 10_000, intervalMs: 250 },
        );

        await waitForCondition(
            () => domText(".s2b-space-editor").includes("Welcome"),
            "selected file to appear in the included files list",
            { timeoutMs: 10_000, intervalMs: 250 },
        );

        expect(domText(".s2b-space-editor")).toContain("Welcome");
        expect(getErrors()).toBe("");
    });
});
