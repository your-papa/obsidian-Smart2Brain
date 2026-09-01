import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	PLUGIN,
	VAULT_DIR,
	clearBuffers,
	closeAllModals,
	createNote,
	deleteNote,
	domCount,
	domText,
	executeCommand,
	getErrors,
	obsidian,
	obsidianEval,
	pollEval,
	readNote,
	sleep,
	waitForCondition,
	waitForSelector,
	waitForStandaloneMiniSearch,
} from "./helpers/cli.ts";

const ACTIVE_SEARCH_MODAL = ".modal-container:last-of-type .s2b-search-modal";
const searchIndexAvailable = (() => {
	try {
		return obsidianEval(`${PLUGIN}.pluginData.searchEmbedIndex !== null`).includes("true");
	} catch {
		return false;
	}
})();

function activeSearchSelector(selector: string): string {
	return `${ACTIVE_SEARCH_MODAL} ${selector}`;
}

function activeSearchBadgeLabels(): string {
	return obsidian(`dev:dom selector='${activeSearchSelector(".s2b-search-result-badge")}' all attr=aria-label`, {
		ignoreError: true,
	});
}

function setActiveSearchQuery(value: string): string {
	return obsidianEval(`(() => {
		const input = document.querySelector(${JSON.stringify(activeSearchSelector(".prompt-input"))});
		if (!(input instanceof HTMLInputElement)) return "missing";
		input.value = ${JSON.stringify(value)};
		input.dispatchEvent(new Event("input", { bubbles: true }));
		return input.value;
	})()`);
}

function dispatchActiveSearchKey(options: {
	key: string;
	code: string;
	metaKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
}): string {
	return obsidianEval(`(() => {
		const target = document.querySelector(${JSON.stringify(activeSearchSelector(".prompt-input"))})
			?? document.querySelector(${JSON.stringify(ACTIVE_SEARCH_MODAL)});
		if (!(target instanceof HTMLElement)) return "missing-modal";
		const event = new KeyboardEvent("keydown", ${JSON.stringify({
			bubbles: true,
			cancelable: true,
			...options,
		})});
		target.dispatchEvent(event);
		return "dispatched";
	})()`);
}

function clickFirstActiveSuggestion(): string {
	return obsidianEval(`(() => {
		const suggestion = document.querySelector(${JSON.stringify(activeSearchSelector(".suggestion-item"))});
		if (!(suggestion instanceof HTMLElement)) return "missing-suggestion";
		suggestion.click();
		return suggestion.textContent || "clicked";
	})()`);
}

function clickFirstActiveSuggestionInNewTab(): string {
	return obsidianEval(`(() => {
		const suggestion = document.querySelector(${JSON.stringify(activeSearchSelector(".suggestion-item"))});
		if (!(suggestion instanceof HTMLElement)) return "missing-suggestion";
		const event = new MouseEvent("click", { metaKey: true, bubbles: true, cancelable: true });
		suggestion.dispatchEvent(event);
		return "clicked";
	})()`);
}

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
	const numericTitleNoteName = "9. Semester.md";
	const numericTitleNoteContent = ["# 9. Semester", "", "Program overview and module planning."].join("\n");
	const lexicalLeadRankingNoteName = "Recent Boost Probe.md";
	const lexicalLeadRankingBaseName = lexicalLeadRankingNoteName.replace(/\.md$/u, "");
	const lexicalLeadRankingNoteContent = ["# Recent Boost Probe", "", "Control note for lexical title matching."].join(
		"\n",
	);
	const recentBoostRankingNoteName = "Recent Boost Ranking Fixture.md";
	const recentBoostRankingBaseName = recentBoostRankingNoteName.replace(/\.md$/u, "");
	const recentBoostRankingNoteContent = ["# Recent Boost Ranking Fixture", "", "Recent Boost Probe"].join("\n");
	const filesystemFixtureBaseName = `Filesystem Created Recent Fixture ${Date.now()}`;
	const filesystemFixtureNoteName = `${filesystemFixtureBaseName}.md`;
	const filesystemFixturePath = join(VAULT_DIR, filesystemFixtureNoteName);
	const multiSelectCreateNoteName = `Search Modal Shift Enter Fixture ${Date.now()}.md`;
	const multiSelectCreateNoteTitle = multiSelectCreateNoteName.replace(/\.md$/u, "");

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
		createNote(numericTitleNoteName, numericTitleNoteContent);
		createNote(lexicalLeadRankingNoteName, lexicalLeadRankingNoteContent);
		createNote(recentBoostRankingNoteName, recentBoostRankingNoteContent);
		await sleep(2000);
	}, 30_000);

	beforeEach(async () => {
		closeAllModals();
		executeCommand("smart-second-brain:search-notes");
		await waitForSelector(ACTIVE_SEARCH_MODAL);
	}, 30_000);

	afterEach(() => {
		closeAllModals();
	});

	afterAll(() => {
		closeAllModals();
		deleteNote(aliasNoteName);
		deleteNote(tagNoteName);
		deleteNote(inlineTagOnlyNoteName);
		deleteNote(pathNoteName);
		deleteNote(numericTitleNoteName);
		deleteNote(lexicalLeadRankingNoteName);
		deleteNote(recentBoostRankingNoteName);
		deleteNote(multiSelectCreateNoteName);
		rmSync(filesystemFixturePath, { force: true });
		clearBuffers();
	});

	it("should open the search modal via command", async () => {
		expect(domCount(ACTIVE_SEARCH_MODAL)).toBe(1);
	}, 30_000);

	it("should have a prompt input with placeholder text", () => {
		const placeholder = obsidian(`dev:dom selector='${activeSearchSelector(".prompt-input")}' attr=placeholder`, {
			ignoreError: true,
		});
		expect(placeholder).toContain("Search notes");
	});

	it("should render search results after typing a query", async () => {
		setActiveSearchQuery("Machine Learning");

		// Wait for results to appear (debounced search + indexing)
		await waitForCondition(
			() => domCount(activeSearchSelector(".s2b-search-result")) > 0,
			"search results to appear",
			{ timeoutMs: 20_000 },
		);

		const resultCount = domCount(activeSearchSelector(".s2b-search-result"));
		expect(resultCount).toBeGreaterThan(0);
	}, 30_000);

	it("should boost a recently opened typed match above the raw lexical leader", async () => {
		const query = "Recent Boost Probe";
		const lexicalOrderKey = `__s2bRecentBoostLexicalOrder_${Date.now()}`;
		const lexicalOrder = JSON.parse(
			await pollEval(
				`(function(){ window.${lexicalOrderKey} = "pending"; (async function(){
					try {
						const plugin = ${PLUGIN};
						const search = plugin?.lexicalSearchService;
						if (!search || typeof search.search !== "function") {
							window.${lexicalOrderKey} = JSON.stringify({ error: "missing-search", names: [] });
							return;
						}
						const results = await search.search(${JSON.stringify(query)}, 10);
						window.${lexicalOrderKey} = JSON.stringify({
							error: null,
							names: results.map((result) => result.name ?? result.title ?? result.path),
						});
					} catch (error) {
						window.${lexicalOrderKey} = JSON.stringify({
							error: error instanceof Error ? error.message : String(error),
							names: [],
						});
					}
				})(); })()`,
				lexicalOrderKey,
				{ timeoutMs: 15_000, intervalMs: 250 },
			),
		) as { error: string | null; names: string[] };

		expect(lexicalOrder.error).toBeNull();
		expect(lexicalOrder.names[0]).toBe(lexicalLeadRankingBaseName);
		expect(lexicalOrder.names.indexOf(recentBoostRankingBaseName)).toBeGreaterThan(0);

		obsidianEval(`(() => {
			const plugin = ${PLUGIN};
			plugin?.pluginData.recordRecentlyOpenedNote(${JSON.stringify(recentBoostRankingNoteName)});
			return "recorded";
		})()`);

		setActiveSearchQuery(query);

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-name")).includes(recentBoostRankingBaseName),
			"recently opened typed match to rise to the top",
			{ timeoutMs: 20_000, intervalMs: 250 },
		);

		expect(domText(activeSearchSelector(".s2b-search-result-name"))).toContain(recentBoostRankingBaseName);
		expect(activeSearchBadgeLabels()).toContain("Recent");
	}, 30_000);

	it("should not show filesystem-created notes that were never opened in recents", async () => {
		closeAllModals();
		rmSync(filesystemFixturePath, { force: true });
		writeFileSync(
			filesystemFixturePath,
			["# Filesystem fixture", "", "Created on disk without opening in Obsidian."].join("\n"),
			"utf8",
		);

		await waitForCondition(
			() =>
				obsidianEval(
					`Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(filesystemFixtureNoteName)}))`,
				).includes("true"),
			"filesystem-created note to appear in the vault",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		executeCommand("smart-second-brain:search-notes");
		await waitForSelector(ACTIVE_SEARCH_MODAL);

		const resultNames = obsidian(`dev:dom selector='${activeSearchSelector(".s2b-search-result-name")}' all text`, {
			ignoreError: true,
		});

		expect(resultNames).not.toContain(filesystemFixtureBaseName);
		expect(getErrors()).toBe("");

		closeAllModals();
		rmSync(filesystemFixturePath, { force: true });
	}, 30_000);

	it.skip("should open the selected note in a new tab when Command-clicking a result", async () => {
		const initialLeafCount = Number.parseInt(
			obsidianEval(`app.workspace.getLeavesOfType('markdown').length`).replace(/^=>\s*/u, ""),
			10,
		);

		setActiveSearchQuery("Rocket Science");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-name")).includes("Alias Fixture"),
			"alias result to be selected for mod-enter",
			{ timeoutMs: 20_000 },
		);

		clickFirstActiveSuggestionInNewTab();

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
	}, 30_000);

	it("should clear selections when the query changes", async () => {
		setActiveSearchQuery("Rocket Science");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-name")).includes("Alias Fixture"),
			"alias result to appear for first selection",
			{ timeoutMs: 20_000 },
		);

		dispatchActiveSearchKey({ key: "Enter", code: "Enter", shiftKey: true });

		// Selected rows are the only selection indicator — there is no summary chip.
		await waitForCondition(
			() => domCount(activeSearchSelector(".s2b-search-result-item-selected")) > 0,
			"row to render as selected",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		setActiveSearchQuery("orbital-index");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-name")).includes("Tag Fixture"),
			"tag fixture to appear after the query change",
			{ timeoutMs: 20_000 },
		);

		// A selection held across a query change would be invisible state: the rows
		// carrying it are no longer on screen.
		await waitForCondition(
			() => domCount(activeSearchSelector(".s2b-search-result-item-selected")) === 0,
			"selection to be cleared by the query change",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		expect(domCount(activeSearchSelector(".s2b-search-result-item-selected"))).toBe(0);
	}, 30_000);

	it.skip("should create a new note from the query when pressing Mod+Shift+Enter", async () => {
		setActiveSearchQuery(multiSelectCreateNoteTitle);
		dispatchActiveSearchKey({ key: "Enter", code: "Enter", metaKey: true, shiftKey: true });

		await waitForCondition(
			() =>
				obsidianEval(`Boolean(app.vault.getAbstractFileByPath('${multiSelectCreateNoteName}'))`).includes(
					"true",
				),
			"mod-shift-enter note to be created",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		await waitForCondition(
			() => obsidianEval(`app.workspace.getActiveFile()?.path ?? ''`).includes(multiSelectCreateNoteName),
			"created note to open",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		expect(readNote(multiSelectCreateNoteName)).toContain(`# ${multiSelectCreateNoteTitle}`);
		expect(obsidianEval(`app.workspace.getActiveFile()?.path ?? ''`)).toContain(multiSelectCreateNoteName);
	}, 30_000);

	it("should show a notice instead of enabling semantic mode when no search index is selected", async () => {
		const originalIndex = obsidianEval(`${PLUGIN}.pluginData.searchEmbedIndex ?? null`)
			.replace(/^=>\s*/u, "")
			.trim();

		clearBuffers();
		obsidianEval(`${PLUGIN}.pluginData.clearEmbedIndex("search")`);

		await waitForCondition(
			() => obsidianEval(`${PLUGIN}.pluginData.searchEmbedIndex === null`).includes("true"),
			"search embedding index to be cleared",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		obsidianEval(`(() => {
			for (const notice of document.querySelectorAll(".notice")) {
				notice.remove();
			}
			return "cleared";
		})()`);

		const snapshot = JSON.parse(
			obsidianEval(`(() => {
				const plugin = app.plugins.plugins["smart-second-brain"];
				const modal = document.querySelector(${JSON.stringify(ACTIVE_SEARCH_MODAL)});
				if (!(modal instanceof HTMLElement)) {
					return JSON.stringify({ error: "missing-modal", index: null, instructions: "", notices: [] });
				}
				const event = new KeyboardEvent("keydown", {
					key: "Tab",
					code: "Tab",
					bubbles: true,
					cancelable: true,
				});
				modal.dispatchEvent(event);
				return JSON.stringify({
					error: null,
					index: plugin.pluginData.searchEmbedIndex,
					instructions: modal.querySelector(".prompt-instructions")?.textContent ?? "",
					notices: Array.from(document.querySelectorAll(".notice")).map((notice) => notice.textContent ?? ""),
					anchors: Array.from(document.querySelectorAll(".notice a")).map((anchor) => anchor.textContent ?? ""),
				});
			})()`).replace(/^=>\s*/u, ""),
		) as { error: string | null; index: string | null; instructions: string; notices: string[]; anchors: string[] };

		expect(snapshot.error).toBeNull();
		expect(snapshot.index).toBeNull();
		expect(snapshot.instructions).toContain("semantic: off");
		expect(snapshot.notices.join(" ")).toContain(
			"Select a search embedding index before enabling semantic search.",
		);
		expect(snapshot.anchors).toContain("Open search settings");

		obsidianEval(`(() => {
			const link = document.querySelector(".notice a");
			if (!(link instanceof HTMLElement)) return "missing-link";
			link.click();
			return "clicked";
		})()`).replace(/^=>\s*/u, "");

		await waitForCondition(
			() =>
				obsidianEval(
					`document.body.textContent?.includes("Embedding indexes power semantic search across your notes.") ?? false`,
				).includes("true"),
			"search settings tab to open from notice link",
			{ timeoutMs: 10_000, intervalMs: 250 },
		);

		obsidianEval(`(() => {
			const closeButton = document.querySelector(".modal.mod-settings .modal-close-button");
			if (closeButton instanceof HTMLElement) {
				closeButton.click();
				return "closed";
			}
			return "missing-close-button";
		})()`);

		if (originalIndex !== "null") {
			const [provider, ...modelParts] = originalIndex.split(":");
			obsidianEval(`${PLUGIN}.pluginData.setEmbedIndex("search", "${provider}", "${modelParts.join(":")}")`);
			await waitForCondition(
				() => obsidianEval(`${PLUGIN}.pluginData.searchEmbedIndex === "${originalIndex}"`).includes("true"),
				"search embedding index to be restored",
				{ timeoutMs: 10_000, intervalMs: 250 },
			);
		}
	}, 30_000);

	it("should display result names matching the query", () => {
		const resultName = domText(activeSearchSelector(".s2b-search-result-name"));
		expect(resultName.length).toBeGreaterThan(0);
	});

	it("should render both heading and snippet for headed content matches", async () => {
		setActiveSearchQuery("Unsupervised");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-explanation")).includes("Unsupervised Learning"),
			"match explanation to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-search-result-heading"))).toContain("## Unsupervised Learning");
		expect(domText(activeSearchSelector(".s2b-search-result-snippet"))).toContain("Clustering algorithms");
		expect(activeSearchBadgeLabels()).toContain("Heading");
	}, 30_000);

	it("should show a Content badge when the match is inside a section body", async () => {
		setActiveSearchQuery("k-means");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-heading")).includes("Unsupervised Learning"),
			"section body match to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-search-result-heading"))).toContain("## Unsupervised Learning");
		expect(domText(activeSearchSelector(".s2b-search-result-snippet"))).toContain("k means");
		expect(activeSearchBadgeLabels()).toContain("Content");
	}, 30_000);

	it.skip("should show active filter chips and allow toggling tag mode", async () => {
		setActiveSearchQuery("#orbital");
		await waitForCondition(
			() => domCount(activeSearchSelector(".s2b-search-autocomplete")) > 0,
			"tag autocomplete suggestions to appear",
			{ timeoutMs: 20_000 },
		);
		clickFirstActiveSuggestion();

		setActiveSearchQuery("#stealth");
		await waitForCondition(
			() => domCount(activeSearchSelector(".s2b-search-autocomplete")) > 0,
			"second tag autocomplete suggestions to appear",
			{ timeoutMs: 20_000 },
		);
		clickFirstActiveSuggestion();

		await waitForCondition(
			() => domCount(activeSearchSelector(".s2b-inline-chip")) >= 2,
			"filter chips to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-inline-chip-mode"))).toContain("ANY");

		obsidianEval(`(() => {
			const chip = document.querySelector(${JSON.stringify(activeSearchSelector(".s2b-inline-chip-mode"))});
			if (!(chip instanceof HTMLButtonElement)) return 'missing';
			chip.click();
			return chip.textContent || '';
		})()`);

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-inline-chip-mode")).includes("ALL"),
			"tag mode to toggle",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-inline-chip-mode"))).toContain("ALL");
	}, 30_000);

	it.skip("should turn a tag autocomplete selection into a filter chip", async () => {
		setActiveSearchQuery("#orbital");
		await waitForCondition(
			() => domCount(activeSearchSelector(".s2b-search-autocomplete")) > 0,
			"tag autocomplete to appear",
			{ timeoutMs: 20_000 },
		);
		clickFirstActiveSuggestion();

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-inline-chip")).includes("orbital-index"),
			"tag chip to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-inline-chip"))).toContain("orbital-index");
	}, 30_000);

	it.skip("should turn a folder autocomplete selection into a filter chip", async () => {
		setActiveSearchQuery("SpaceOps/");
		await waitForCondition(
			() => domCount(activeSearchSelector(".s2b-search-autocomplete")) > 0,
			"folder autocomplete to appear",
			{ timeoutMs: 20_000 },
		);
		clickFirstActiveSuggestion();

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-inline-chip")).includes("SpaceOps"),
			"path chip to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-inline-chip"))).toContain("SpaceOps");
	}, 30_000);

	it("should show alias matches with alias badge and explanation", async () => {
		setActiveSearchQuery("Rocket Science");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-name")).includes("Alias Fixture"),
			"alias result to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-search-result-name"))).toContain("Alias Fixture");
		expect(activeSearchBadgeLabels()).toContain("Alias");
		expect(domText(activeSearchSelector(".s2b-search-result-snippet"))).toContain("Rocket Science");
	}, 30_000);

	it("should show tag matches with file tag pills", async () => {
		setActiveSearchQuery("orbital-index");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-name")).includes("Tag Fixture"),
			"tag result to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-search-result-name"))).toContain("Tag Fixture");
		expect(activeSearchBadgeLabels()).toContain("Tag");
		expect(domCount(activeSearchSelector(".s2b-search-result-tag"))).toBeGreaterThan(0);
		expect(domText(activeSearchSelector(".s2b-search-result-tags"))).toContain("orbital-index");
	}, 30_000);

	it("should keep inline content tags out of the title tag pills", async () => {
		setActiveSearchQuery("stealth-inline");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-name")).includes("Inline Tag Fixture"),
			"inline tag match to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-search-result-name"))).toContain("Inline Tag Fixture");
		expect(domText(activeSearchSelector(".s2b-search-result-snippet"))).toContain("stealth-inline");
		expect(domCount(activeSearchSelector(".s2b-search-result-tag"))).toBe(0);
	}, 30_000);

	it.skip("should show path matches with path badge", async () => {
		setActiveSearchQuery("SpaceOps");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-name")).includes("Path Fixture"),
			"path result to appear",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-search-result-name"))).toContain("Path Fixture");
		expect(activeSearchBadgeLabels()).toContain("Path");
	}, 30_000);

	it("should prioritize exact title matches over section or link mentions", async () => {
		setActiveSearchQuery("Obsidian Plugin Development");

		await waitForCondition(
			() => domText(activeSearchSelector(".s2b-search-result-name")).includes("Obsidian Plugin Development"),
			"exact title match to rank first",
			{ timeoutMs: 20_000 },
		);

		expect(domText(activeSearchSelector(".s2b-search-result-name"))).toContain("Obsidian Plugin Development");
		expect(
			domCount(activeSearchSelector(".s2b-search-result-name .s2b-search-result-highlight-title")),
		).toBeGreaterThan(0);
	}, 30_000);

	it.skip("should rank numeric-leading title prefix matches ahead of noisy content matches", async () => {
		setActiveSearchQuery("9. semes");

		await waitForCondition(
			() =>
				obsidianEval(`(() => {
					const first = document.querySelector(${JSON.stringify(activeSearchSelector(".s2b-search-result-name"))});
					return first?.textContent ?? '';
				})()`).includes("9. Semester"),
			"numeric-leading title match to rank first",
			{ timeoutMs: 20_000, intervalMs: 250 },
		);

		expect(
			obsidianEval(`(() => {
				const first = document.querySelector(${JSON.stringify(activeSearchSelector(".s2b-search-result-name"))});
				return first?.textContent ?? '';
			})()`),
		).toContain("9. Semester");
	}, 30_000);

	it.skipIf(!searchIndexAvailable)(
		"should only show the semantic glow while a semantic search is in flight",
		async () => {
			expect(
				obsidianEval(`(() => {
				const plugin = app.plugins.plugins["smart-second-brain"];
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
				const modal = document.querySelector(${JSON.stringify(ACTIVE_SEARCH_MODAL)});
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

			setActiveSearchQuery("machine learning");

			await waitForCondition(
				() => domCount(".s2b-search-modal-glow") > 0,
				"semantic glow to appear during active search",
				{ timeoutMs: 10_000, intervalMs: 100 },
			);

			await waitForCondition(
				() => domCount(activeSearchSelector(".s2b-search-result")) > 0,
				"semantic search results to appear",
				{ timeoutMs: 20_000 },
			);

			await waitForCondition(
				() => domCount(".s2b-search-modal-glow") === 0,
				"semantic glow to stop once results are rendered",
				{ timeoutMs: 10_000, intervalMs: 100 },
			);

			expect(
				obsidianEval(`(() => {
				const plugin = app.plugins.plugins["smart-second-brain"];
				const original = window.__s2bOriginalSemanticSearch;
				if (plugin?.vectorStoreService && typeof original === 'function') {
					plugin.vectorStoreService.semanticSearch = original;
				}
				delete window.__s2bOriginalSemanticSearch;
				return 'restored';
			})()`),
			).toContain("restored");
		},
		30_000,
	);

	it("should close without errors when dismissed", async () => {
		// Press Escape to close
		obsidian(`dev:cdp method=Input.dispatchKeyEvent params='{"type":"keyDown","key":"Escape","code":"Escape"}'`, {
			ignoreError: true,
		});
		await sleep(500);

		expect(getErrors()).toBe("");
	});
});
