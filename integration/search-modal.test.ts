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
	obsidianEval,
	sleep,
	waitForCondition,
	waitForSelector,
	waitForStandaloneMiniSearch,
} from "./helpers/cli.ts";

describe("search modal", () => {
	const aliasNoteName = "Alias Fixture.md";
	const aliasNoteContent = [
		"---",
		"aliases:",
		"  - Rocket Science",
		"  - Launch Notes",
		"---",
		"",
		"# Alias Fixture",
		"",
		"This note is about spacecraft and propulsion.",
	].join("\n");
	const tagNoteName = "Tag Fixture.md";
	const tagNoteContent = [
		"---",
		"tags:",
		"  - orbital-index",
		"---",
		"",
		"# Tag Fixture",
		"",
		"This note is about propulsion systems.",
	].join("\n");
	const inlineTagOnlyNoteName = "Inline Tag Fixture.md";
	const inlineTagOnlyNoteContent = [
		"# Inline Tag Fixture",
		"",
		"This note mentions #stealth-inline in the body only.",
	].join("\n");
	const pathNoteName = "SpaceOps/Path Fixture.md";
	const pathNoteContent = ["# Path Fixture", "", "This note is about telemetry and consoles."].join("\n");

	// Search uses the standalone MiniSearch (BM25) which is always available,
	// even without an embedding provider. Fixture notes in the vault provide
	// searchable content.

	beforeAll(async () => {
		clearBuffers();
		await waitForStandaloneMiniSearch();
		createNote(aliasNoteName, aliasNoteContent);
		createNote(tagNoteName, tagNoteContent);
		createNote(inlineTagOnlyNoteName, inlineTagOnlyNoteContent);
		createNote(pathNoteName, pathNoteContent);
	});

	afterAll(() => {
		deleteNote(aliasNoteName);
		deleteNote(tagNoteName);
		deleteNote(inlineTagOnlyNoteName);
		deleteNote(pathNoteName);
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

	it("should render both heading and snippet for headed content matches", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'Unsupervised';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText(".s2b-search-result-explanation").includes("Unsupervised Learning"),
			"match explanation to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(".s2b-search-result-heading")).toContain("Unsupervised Learning");
		expect(domText(".s2b-search-result-snippet")).toContain("Clustering algorithms");
		expect(domText(".s2b-search-result-badge")).toContain("Heading");
	});

	it("should show a Content badge when the match is inside a section body", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'k-means';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText(".s2b-search-result-heading").includes("Unsupervised Learning"),
			"section body match to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(".s2b-search-result-heading")).toContain("Unsupervised Learning");
		expect(domText(".s2b-search-result-snippet")).toContain("k-means");
		expect(domText(".s2b-search-result-badge")).toContain("Content");
	});

	it("should show active filter chips and allow toggling tag mode", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'tag:#ai path:Machine';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domCount('.s2b-search-filter-chip') >= 3,
			"filter chips to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText('.s2b-search-filter-chip-mode')).toContain('Tags: ANY');

		obsidianEval(`(() => {
			const chip = document.querySelector('.s2b-search-filter-chip-mode');
			if (!(chip instanceof HTMLButtonElement)) return 'missing';
			chip.click();
			return chip.textContent || '';
		})()`);

		await waitForCondition(
			() => domText('.s2b-search-filter-chip-mode').includes('Tags: ALL'),
			"tag mode to toggle",
			{ timeoutMs: 20_000 },
		);

		expect(domText('.s2b-search-filter-chip-mode')).toContain('Tags: ALL');
	});

	it("should turn bare hashtag input into a tag filter chip", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = '#ai';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText('.s2b-search-filter-chip').includes('#ai'),
			"bare hashtag chip to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText('.s2b-search-filter-chip')).toContain('#ai');
	});

	it("should turn bare trailing-slash input into a path filter chip", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'Projects/';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText('.s2b-search-filter-chip').includes('In Projects/'),
			"bare path chip to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText('.s2b-search-filter-chip')).toContain('In Projects/');
	});

	it("should show alias matches with alias badge and explanation", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'Rocket Science';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText('.s2b-search-result-name').includes('Alias Fixture'),
			"alias result to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText('.s2b-search-result-name')).toContain('Alias Fixture');
		expect(domText('.s2b-search-result-badge')).toContain('Alias');
		expect(domText('.s2b-search-result-snippet')).toContain('Alias: Rocket Science');
	});

	it("should show tag matches with file tag pills", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'orbital-index';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText('.s2b-search-result-name').includes('Tag Fixture'),
			"tag result to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText('.s2b-search-result-name')).toContain('Tag Fixture');
		expect(domText('.s2b-search-result-badge')).toContain('Tag');
		expect(domCount('.s2b-search-result-tag')).toBeGreaterThan(0);
		expect(domText('.s2b-search-result-tags')).toContain('#orbital-index');
		expect(
			obsidianEval(`(() => {
				const firstResult = document.querySelector('.s2b-search-result');
				return firstResult?.querySelector('.s2b-search-result-snippet')?.textContent ?? '';
			})()`),
		).toBe('');
	});

	it("should keep inline content tags out of the title tag pills", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'stealth-inline';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText('.s2b-search-result-name').includes('Inline Tag Fixture'),
			"inline tag match to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText('.s2b-search-result-name')).toContain('Inline Tag Fixture');
		expect(domText('.s2b-search-result-snippet')).toContain('Tag: #stealth-inline');
		expect(domCount('.s2b-search-result-tag')).toBe(0);
	});

	it("should show path matches with path badge", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'SpaceOps';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText('.s2b-search-result-name').includes('Path Fixture'),
			"path result to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText('.s2b-search-result-name')).toContain('Path Fixture');
		expect(domText('.s2b-search-result-badge')).toContain('Path');
	});

	it("should prioritize exact title matches over section or link mentions", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'Obsidian Plugin Development';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText(".s2b-search-result-name").includes("Obsidian Plugin Development"),
			"exact title match to rank first",
			{ timeoutMs: 20_000 },
		);

		expect(domText(".s2b-search-result-name")).toContain("Obsidian Plugin Development");
		expect(domCount(".s2b-search-result-name .s2b-search-result-highlight-title")).toBeGreaterThan(0);
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
