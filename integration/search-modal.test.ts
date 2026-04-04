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
	readNote,
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
	const recentCreatedNoteName = `Recent Created Fixture ${Date.now()}.md`;
	const recentCreatedNoteContent = ["# Recent Created Fixture", "", "Created for recent notes coverage."].join("\n");
	const shiftCreateNoteName = `Search Modal Shift Enter Fixture ${Date.now()}.md`;
	const shiftCreateNoteTitle = shiftCreateNoteName.replace(/\.md$/u, "");

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
		createNote(recentCreatedNoteName, recentCreatedNoteContent);
	});

	afterAll(() => {
		deleteNote(aliasNoteName);
		deleteNote(tagNoteName);
		deleteNote(inlineTagOnlyNoteName);
		deleteNote(pathNoteName);
		deleteNote(recentCreatedNoteName);
		deleteNote(shiftCreateNoteName);
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

	it("should include newly created notes in the initial recent notes view", async () => {
		await waitForCondition(
			() =>
				obsidianEval(`(() => {
					return Array.from(document.querySelectorAll('.s2b-search-result-name'))
						.map((el) => el.textContent ?? '')
						.includes('${recentCreatedNoteName.replace(/\.md$/u, "")}');
				})()`).includes("true"),
			"recently created note to appear in recent notes",
			{ timeoutMs: 20_000, intervalMs: 250 },
		);

		expect(domText('.s2b-search-result-name')).toContain(recentCreatedNoteName.replace(/\.md$/u, ""));
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

	it("should open the selected note in a new tab when pressing Command+Enter", async () => {
		const initialLeafCount = Number.parseInt(
			obsidianEval(`app.workspace.getLeavesOfType('markdown').length`).replace(/^=>\s*/u, ""),
			10,
		);

		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'Rocket Science';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domText('.s2b-search-result-name').includes('Alias Fixture'),
			"alias result to be selected for mod-enter",
			{ timeoutMs: 20_000 },
		);

		obsidianEval(`(() => {
			const modal = document.querySelector('.s2b-search-modal');
			if (!(modal instanceof HTMLElement)) return 'missing-modal';
			const event = new KeyboardEvent('keydown', {
				key: 'Enter',
				code: 'Enter',
				metaKey: true,
				bubbles: true,
				cancelable: true,
			});
			modal.dispatchEvent(event);
			return 'dispatched';
		})()`);

		await waitForCondition(
			() => domCount('.s2b-search-modal') === 0,
			"search modal to close after mod-enter",
			{ timeoutMs: 10_000 },
		);

		await waitForCondition(
			() =>
				obsidianEval(`JSON.stringify({
					active: app.workspace.getActiveFile()?.path ?? null,
					total: app.workspace.getLeavesOfType('markdown').length,
					matching: app.workspace.getLeavesOfType('markdown').filter((leaf) => leaf.view.file?.path === '${aliasNoteName}').length,
				})`).includes(aliasNoteName),
			"selected note to open in a new tab",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		const state = JSON.parse(
			obsidianEval(`JSON.stringify({
				active: app.workspace.getActiveFile()?.path ?? null,
				total: app.workspace.getLeavesOfType('markdown').length,
				matching: app.workspace.getLeavesOfType('markdown').filter((leaf) => leaf.view.file?.path === '${aliasNoteName}').length,
			})`).replace(/^=>\s*/u, ""),
		) as { active: string | null; total: number; matching: number };

		expect(state.active).toBe(aliasNoteName);
		expect(state.matching).toBeGreaterThan(0);
		expect(state.total).toBeGreaterThan(initialLeafCount);

		executeCommand("smart-second-brain:search-notes");
		await waitForSelector(".s2b-search-modal");
	});

	it("should create a new note from the query when pressing Shift+Enter", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = '${shiftCreateNoteTitle}';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		obsidianEval(`(() => {
			const modal = document.querySelector('.s2b-search-modal');
			if (!(modal instanceof HTMLElement)) return 'missing-modal';
			const event = new KeyboardEvent('keydown', {
				key: 'Enter',
				code: 'Enter',
				shiftKey: true,
				bubbles: true,
				cancelable: true,
			});
			modal.dispatchEvent(event);
			return 'dispatched';
		})()`);

		await waitForCondition(
			() => obsidianEval(`Boolean(app.vault.getAbstractFileByPath('${shiftCreateNoteName}'))`).includes('true'),
			"shift-enter note to be created",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		await waitForCondition(
			() => obsidianEval(`app.workspace.getActiveFile()?.path ?? ''`).includes(shiftCreateNoteName),
			"created note to open",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		expect(readNote(shiftCreateNoteName)).toContain(`# ${shiftCreateNoteTitle}`);
		expect(obsidianEval(`app.workspace.getActiveFile()?.path ?? ''`)).toContain(shiftCreateNoteName);

		executeCommand("smart-second-brain:search-notes");
		await waitForSelector(".s2b-search-modal");
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

		expect(domText(".s2b-search-result-heading")).toContain("## Unsupervised Learning");
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

		expect(domText(".s2b-search-result-heading")).toContain("## Unsupervised Learning");
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

	it("should rank numeric-leading title prefix matches ahead of noisy content matches", async () => {
		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = '9. semes';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() =>
				obsidianEval(`(() => {
					const first = document.querySelector('.s2b-search-result-name');
					return first?.textContent ?? '';
				})()`).includes('9. Semester'),
			"numeric-leading title match to rank first",
			{ timeoutMs: 20_000, intervalMs: 250 },
		);

		expect(
			obsidianEval(`(() => {
				const first = document.querySelector('.s2b-search-result-name');
				return first?.textContent ?? '';
			})()`),
		).toContain("9. Semester");
	});

	it("should only show the semantic glow while a semantic search is in flight", async () => {
		expect(
			obsidianEval(`(() => {
				const plugin = app.plugins.plugins['smart-second-brain'];
				if (!plugin?.vectorStoreService) return 'missing-plugin';
				const service = plugin.vectorStoreService;
				if (!window.__s2bOriginalSemanticSearch) {
					window.__s2bOriginalSemanticSearch = service.semanticSearch.bind(service);
				}
				service.semanticSearch = async (...args) => {
					await new Promise((resolve) => setTimeout(resolve, 800));
					return window.__s2bOriginalSemanticSearch(...args);
				};
				return 'patched';
			})()`),
		).toContain("patched");

		expect(
			obsidianEval(`(() => {
				const modal = document.querySelector('.s2b-search-modal');
				if (!(modal instanceof HTMLElement)) return 'missing-modal';
				const event = new KeyboardEvent('keydown', {
					key: 'Tab',
					code: 'Tab',
					bubbles: true,
					cancelable: true,
				});
				modal.dispatchEvent(event);
				return modal.querySelector('.prompt-instructions')?.textContent ?? 'ok';
			})()`),
		).not.toContain("missing");

		obsidianEval(`(() => {
			const input = document.querySelector('.s2b-search-modal .prompt-input');
			if (!(input instanceof HTMLInputElement)) return 'missing';
			input.value = 'machine learning';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`);

		await waitForCondition(
			() => domCount('.s2b-search-modal-glow') > 0,
			"semantic glow to appear during active search",
			{ timeoutMs: 10_000, intervalMs: 100 },
		);

		await waitForCondition(
			() => domCount('.s2b-search-result') > 0,
			"semantic search results to appear",
			{ timeoutMs: 20_000 },
		);

		await waitForCondition(
			() => domCount('.s2b-search-modal-glow') === 0,
			"semantic glow to stop once results are rendered",
			{ timeoutMs: 10_000, intervalMs: 100 },
		);

		expect(
			obsidianEval(`(() => {
				const plugin = app.plugins.plugins['smart-second-brain'];
				const original = window.__s2bOriginalSemanticSearch;
				if (plugin?.vectorStoreService && typeof original === 'function') {
					plugin.vectorStoreService.semanticSearch = original;
				}
				delete window.__s2bOriginalSemanticSearch;
				return 'restored';
			})()`),
		).toContain("restored");
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
