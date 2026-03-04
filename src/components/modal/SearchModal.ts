import { type App, SuggestModal, TFile, debounce } from "obsidian";
import { performSearch, type SearchResult } from "../../agent/tools/searchNotes";
import { getData } from "../../stores/dataStore.svelte";
import type { SearchFilter } from "../../vectorstore";
import { Logger } from "../../utils/logging";

interface ParsedQuery {
	query: string;
	filter?: SearchFilter;
}

/**
 * Parse search query for filter syntax:
 * - path:folder/subfolder/ - filter by path prefix
 * - tag:#tagname or tag:tagname - filter by tag (can use multiple)
 *
 * Example: "path:projects/ tag:#active my search query"
 */
function parseQueryWithFilters(rawQuery: string): ParsedQuery {
	const pathPrefixes: string[] = [];
	const tags: string[] = [];

	// Extract path: prefixes
	const pathRegex = /path:(\S+)/gi;
	for (;;) {
		const pathMatch = pathRegex.exec(rawQuery);
		if (!pathMatch) break;
		pathPrefixes.push(pathMatch[1]);
	}

	// Extract tag: prefixes
	const tagRegex = /tag:(#?\S+)/gi;
	for (;;) {
		const tagMatch = tagRegex.exec(rawQuery);
		if (!tagMatch) break;
		const tag = tagMatch[1].startsWith("#") ? tagMatch[1] : `#${tagMatch[1]}`;
		tags.push(tag);
	}

	// Remove filter syntax from query
	const cleanQuery = rawQuery
		.replace(/path:\S+/gi, "")
		.replace(/tag:\S+/gi, "")
		.trim();

	const filter: SearchFilter | undefined =
		pathPrefixes.length > 0 || tags.length > 0
			? {
					pathPrefixes: pathPrefixes.length > 0 ? pathPrefixes : undefined,
					tags: tags.length > 0 ? tags : undefined,
				}
			: undefined;

	return { query: cleanQuery, filter };
}

/**
 * Search modal that provides a popup search experience using the configured search algorithm.
 * Similar to Obsidian's native search or Omnisearch.
 *
 * Supports filter syntax:
 * - path:folder/ to filter by path prefix
 * - tag:#tagname to filter by tag
 */
export class SearchModal extends SuggestModal<SearchResult> {
	private searchResults: SearchResult[] = [];
	private currentQuery = "";
	private lastSearchedQuery = "";
	private isSearching = false;
	private isClosed = false;

	constructor(app: App) {
		super(app);
		this.setPlaceholder("Search notes... (path:folder/ tag:#tag)");
		this.setInstructions([
			{ command: "↑↓", purpose: "Navigate" },
			{ command: "↵", purpose: "Open note" },
			{ command: "esc", purpose: "Close" },
		]);

		// Add custom class for styling
		this.modalEl.addClass("ssb-search-modal");
	}

	onClose(): void {
		this.isClosed = true;
		// Cancel any pending debounced calls
		this.debouncedSearch.cancel();
	}

	/**
	 * Debounced search to avoid too many API calls during typing
	 */
	private debouncedSearch = debounce(
		async (rawQuery: string) => {
			// Abort if modal was closed
			if (this.isClosed) return;

			if (!rawQuery.trim()) {
				this.searchResults = [];
				// @ts-ignore - updateSuggestions is a protected method
				this.updateSuggestions();
				return;
			}

			this.isSearching = true;
			const pluginData = getData();
			const algorithm = pluginData.searchAlgorithm;

			// Parse query for filter syntax
			const { query, filter } = parseQueryWithFilters(rawQuery);

			// Skip if no query and no filter
			if (!query.trim() && !filter) {
				this.searchResults = [];
				this.isSearching = false;
				// @ts-ignore - updateSuggestions is a protected method
				this.updateSuggestions();
				return;
			}

			try {
				const results = await performSearch(this.app, query, algorithm, filter);
				// Only update if query hasn't changed and modal is still open
				if (rawQuery === this.currentQuery && !this.isClosed) {
					this.searchResults = results.slice(0, 20);
					this.lastSearchedQuery = rawQuery;
					// @ts-ignore - updateSuggestions is a protected method
					this.updateSuggestions();
				}
			} catch (error) {
				Logger.error("[SearchModal] Search failed:", error);
				this.searchResults = [];
			} finally {
				this.isSearching = false;
			}
		},
		200,
		false, // Don't run on leading edge - wait for debounce
	);

	/**
	 * Get suggestions based on query - called by SuggestModal
	 */
	getSuggestions(query: string): SearchResult[] {
		this.currentQuery = query;

		// Only trigger search if query changed
		if (query.trim() && query !== this.lastSearchedQuery) {
			this.debouncedSearch(query);
		} else if (!query.trim()) {
			this.searchResults = [];
			this.lastSearchedQuery = "";
		}

		return this.searchResults;
	}

	/**
	 * Render each suggestion item
	 */
	renderSuggestion(result: SearchResult, el: HTMLElement): void {
		const container = el.createDiv({ cls: "ssb-search-result" });

		// Title row
		const titleRow = container.createDiv({ cls: "ssb-search-result-title" });
		titleRow.createSpan({ text: result.name, cls: "ssb-search-result-name" });

		// Path (folder)
		const pathParts = result.path.split("/");
		if (pathParts.length > 1) {
			const folder = pathParts.slice(0, -1).join("/");
			titleRow.createSpan({ text: folder, cls: "ssb-search-result-path" });
		}

		// Score (if available)
		if (result.score !== undefined) {
			const scoreText = result.score.toFixed(3);
			container.createSpan({ text: scoreText, cls: "ssb-search-result-score" });
		}

		// Tags from frontmatter (if available)
		if (result.frontmatter?.tags) {
			const tags = Array.isArray(result.frontmatter.tags) ? result.frontmatter.tags : [result.frontmatter.tags];
			if (tags.length > 0) {
				const tagsContainer = container.createDiv({ cls: "ssb-search-result-tags" });
				for (const tag of tags.slice(0, 3)) {
					tagsContainer.createSpan({ text: `#${tag}`, cls: "ssb-search-result-tag" });
				}
			}
		}
	}

	/**
	 * Handle selection - open the note
	 */
	onChooseSuggestion(result: SearchResult, evt: MouseEvent | KeyboardEvent): void {
		const file = this.app.vault.getAbstractFileByPath(result.path);
		if (file instanceof TFile) {
			// Open in new leaf if ctrl/cmd is held
			const newLeaf = evt.ctrlKey || evt.metaKey;
			this.app.workspace.openLinkText(result.path, "", newLeaf);
		}
	}

	/**
	 * Empty state message
	 */
	onNoSuggestion(): void {
		// Clear previous empty state messages
		this.resultContainerEl.empty();
		const emptyEl = this.resultContainerEl.createDiv({ cls: "ssb-search-empty" });
		if (this.isSearching) {
			emptyEl.setText("Searching...");
		} else if (this.currentQuery.trim()) {
			emptyEl.setText("No notes found");
		} else {
			emptyEl.setText("Type to search your notes");
		}
	}
}
