import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearBuffers,
	createNote,
	deleteNote,
	domCount,
	domText,
	executeCommand,
	getErrors,
	obsidian,
	sleep,
	waitForCondition,
	waitForSelector,
} from "./helpers/cli.ts";

describe("search modal", () => {
	const testNotes = [
		{ name: "S2B Search Test Alpha", content: "Alpha content about machine learning and neural networks" },
		{ name: "S2B Search Test Beta", content: "Beta content about web development and JavaScript frameworks" },
		{ name: "S2B Search Test Gamma", content: "Gamma content referencing [[S2B Search Test Alpha]] for context" },
	];

	beforeAll(async () => {
		clearBuffers();
		for (const note of testNotes) {
			createNote(note.name, note.content);
		}
		// Give the vault index time to pick up the new files
		await sleep(1000);
	});

	afterAll(() => {
		for (const note of testNotes) {
			deleteNote(note.name);
		}
		clearBuffers();
	});

	it("should open the search modal via command", async () => {
		executeCommand("smart-second-brain:search-notes");
		await waitForSelector(".s2b-search-modal");

		expect(domCount(".s2b-search-modal")).toBe(1);
	});

	it("should have a prompt input with placeholder text", () => {
		const placeholder = obsidian(
			`dev:dom selector='.s2b-search-modal .prompt-input' attr=placeholder`,
			{ ignoreError: true },
		);
		expect(placeholder).toContain("Search notes");
	});

	it("should render search results after typing a query", async () => {
		// Type into the search input using CDP
		obsidian(
			`dev:cdp method=Input.dispatchKeyEvent params='{"type":"keyDown","key":"S","code":"KeyS","text":"S"}'`,
			{ ignoreError: true },
		);
		obsidian(
			`dev:cdp method=Input.insertText params='{"text":"S2B Search Test"}'`,
			{ ignoreError: true },
		);

		// Wait for results to appear (debounced search)
		await waitForCondition(
			() => domCount(".s2b-search-result") > 0,
			"search results to appear",
			{ timeoutMs: 10_000 },
		);

		const resultCount = domCount(".s2b-search-result");
		expect(resultCount).toBeGreaterThan(0);
	});

	it("should display result names matching the query", () => {
		const resultName = domText(".s2b-search-result-name");
		expect(resultName.length).toBeGreaterThan(0);
	});

	it("should close without errors when dismissed", async () => {
		// Press Escape to close
		obsidian(`dev:cdp method=Input.dispatchKeyEvent params='{"type":"keyDown","key":"Escape","code":"Escape"}'`, {
			ignoreError: true,
		});
		await sleep(500);

		expect(getErrors()).toBe("");
	});
});
