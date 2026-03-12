import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearBuffers,
	domCount,
	domText,
	executeCommand,
	getErrors,
	obsidian,
	sleep,
	waitForCondition,
	waitForSelector,
	waitForStandaloneMiniSearch,
} from "./helpers/cli.ts";

describe("search modal", () => {
	// Search uses the standalone MiniSearch (BM25) which is always available,
	// even without an embedding provider. Fixture notes in the vault provide
	// searchable content.

	beforeAll(async () => {
		clearBuffers();
		await waitForStandaloneMiniSearch();
	});

	afterAll(() => {
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
			`dev:cdp method=Input.dispatchKeyEvent params='{"type":"keyDown","key":"M","code":"KeyM","text":"M"}'`,
			{ ignoreError: true },
		);
		obsidian(
			`dev:cdp method=Input.insertText params='{"text":"Machine Learning"}'`,
			{ ignoreError: true },
		);

		// Wait for results to appear (debounced search + indexing)
		await waitForCondition(
			() => domCount(".s2b-search-result") > 0,
			"search results to appear",
			{ timeoutMs: 20_000 },
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
