import { type App, Platform, SuggestModal, TFile, debounce } from "obsidian";
import { performSearch, type SearchResult } from "../../agent/tools/searchNotes";
import { getData } from "../../stores/dataStore.svelte";
import type { SearchAlgorithm } from "../../types/plugin";
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
	private semanticEnabled = false;
	private glowAnimationId: number | null = null;
	private borderEl: HTMLElement | null = null;

	constructor(app: App) {
		super(app);
		this.setPlaceholder("Search notes... (path:folder/ tag:#tag)");
		this.updateInstructions();

		// Register Tab to toggle semantic search
		this.scope.register([], "Tab", (evt) => {
			evt.preventDefault();
			this.semanticEnabled = !this.semanticEnabled;
			this.updateInstructions();
			if (this.semanticEnabled) {
				this.startGlowAnimation();
			} else {
				this.stopGlowAnimation();
			}
			// Re-run search with new algorithm if there's a query
			if (this.currentQuery.trim()) {
				this.lastSearchedQuery = ""; // Force re-search
				this.debouncedSearch(this.currentQuery);
			}
			return false;
		});

		// Add custom class for styling
		this.modalEl.addClass("ssb-search-modal");
	}

	private get activeAlgorithm(): SearchAlgorithm {
		return this.semanticEnabled ? "hybrid" : "lexical";
	}

	private updateInstructions(): void {
		const tabKey = Platform.isMacOS ? "⇥" : "Tab";
		const semanticLabel = this.semanticEnabled ? "semantic: on" : "semantic: off";
		this.setInstructions([
			{ command: "↑↓", purpose: "Navigate" },
			{ command: "↵", purpose: "Open note" },
			{ command: tabKey, purpose: semanticLabel },
			{ command: "esc", purpose: "Close" },
		]);
	}

	onClose(): void {
		this.isClosed = true;
		this.stopGlowAnimation();
		// Cancel any pending debounced calls
		this.debouncedSearch.cancel();
	}

	private startGlowAnimation(): void {
		if (this.glowAnimationId !== null) return;

		const accent = getComputedStyle(document.body).getPropertyValue("--interactive-accent").trim() || "#7f6df2";
		const muted =
			getComputedStyle(document.body).getPropertyValue("--background-modifier-border").trim() || "#363636";
		const radius = getComputedStyle(this.modalEl).borderRadius || "12px";
		const borderWidth = 2;

		// Hide the modal's own border so the gradient replaces it
		this.modalEl.style.setProperty("border-color", "transparent", "important");

		// Create a fixed-position overlay exactly on top of the modal
		const border = document.createElement("div");
		const modalRect = this.modalEl.getBoundingClientRect();
		Object.assign(border.style, {
			position: "fixed",
			top: `${modalRect.top}px`,
			left: `${modalRect.left}px`,
			width: `${modalRect.width}px`,
			height: `${modalRect.height}px`,
			pointerEvents: "none",
			zIndex: "9999",
		});
		document.body.appendChild(border);
		this.borderEl = border;

		const canvas = document.createElement("canvas");
		const dpr = window.devicePixelRatio || 1;
		canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
		border.appendChild(canvas);

		const animate = () => {
			const rect = this.modalEl.getBoundingClientRect();
			const w = rect.width;
			const h = rect.height;

			border.style.top = `${rect.top}px`;
			border.style.left = `${rect.left}px`;
			border.style.width = `${w}px`;
			border.style.height = `${h}px`;

			canvas.width = w * dpr;
			canvas.height = h * dpr;

			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			ctx.scale(dpr, dpr);

			const r = parseFloat(radius) || 12;
			const angle = ((performance.now() % 2000) / 2000) * Math.PI * 2;

			const cx = w / 2;
			const cy = h / 2;
			const grad = ctx.createConicGradient(angle, cx, cy);
			grad.addColorStop(0, accent);
			grad.addColorStop(0.25, muted);
			grad.addColorStop(0.5, accent);
			grad.addColorStop(0.75, muted);
			grad.addColorStop(1, accent);

			// Draw ring inward from the modal edges
			ctx.beginPath();
			ctx.roundRect(0, 0, w, h, r);
			ctx.roundRect(
				borderWidth,
				borderWidth,
				w - borderWidth * 2,
				h - borderWidth * 2,
				Math.max(0, r - borderWidth),
			);
			ctx.fillStyle = grad;
			ctx.fill("evenodd");

			this.glowAnimationId = requestAnimationFrame(animate);
		};
		this.glowAnimationId = requestAnimationFrame(animate);
	}

	private stopGlowAnimation(): void {
		if (this.glowAnimationId !== null) {
			cancelAnimationFrame(this.glowAnimationId);
			this.glowAnimationId = null;
		}
		if (this.borderEl) {
			this.borderEl.remove();
			this.borderEl = null;
		}
		this.modalEl.style.removeProperty("border-color");
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
			const algorithm = this.activeAlgorithm;

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
	 * Append a hint encouraging the user to enable semantic search.
	 * Only shown when semantic is off and an embedding index is configured.
	 */
	private appendSemanticHint(): void {
		if (this.semanticEnabled) return;
		if (!getData().searchEmbedIndex) return;

		const tabKey = Platform.isMacOS ? "⇥" : "Tab";
		const hint = this.resultContainerEl.createDiv({ cls: "ssb-search-semantic-hint" });
		hint.setText(`Press ${tabKey} to enhance results with semantic search`);
	}

	/**
	 * Empty state message
	 */
	onNoSuggestion(): void {
		// Clear previous empty state messages
		this.resultContainerEl.empty();
		const emptyEl = this.resultContainerEl.createDiv({ cls: "ssb-search-empty" });
		if (this.isSearching && this.semanticEnabled) {
			emptyEl.setText("Searching...");
		} else if (this.currentQuery.trim()) {
			emptyEl.setText("No notes found");
			this.appendSemanticHint();
		} else {
			emptyEl.setText("Type to search your notes");
		}
	}
}
