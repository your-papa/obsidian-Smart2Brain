import { type App, Platform, SuggestModal, TFile, debounce, setIcon } from "obsidian";
import { getRecentNotes, performSearch, type SearchResult } from "../../agent/tools/searchNotes";
import { getData } from "../../stores/dataStore.svelte";
import type { SearchAlgorithm } from "../../types/plugin";
import type { SearchFilter } from "../../vectorstore";
import type { SearchMatchBadge } from "../../vectorstore/types";
import { Logger } from "../../utils/logging";
import { getSearchResultNoteIcon, getTagIcon, resolveIconColor } from "../../utils/noteIcons";

interface ParsedQuery {
	query: string;
	filter?: SearchFilter;
}

interface ParsedFilterToken {
	type: "path" | "tag";
	value: string;
	raw: string;
	start: number;
	end: number;
}

function getHighlightTerms(rawQuery: string): string[] {
	const { query } = parseQueryWithFilters(rawQuery);
	return Array.from(
		new Set(
			query
				.toLowerCase()
				.split(/[^\p{L}\p{N}#@_-]+/u)
				.map((term) => term.trim())
				.filter((term) => term.length > 1),
		),
	).sort((left, right) => right.length - left.length);
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendHighlightedText(
	el: HTMLElement,
	text: string,
	terms: string[],
	highlightClass = "s2b-search-result-highlight",
): void {
	if (!terms.length) {
		el.setText(text);
		return;
	}

	const pattern = new RegExp(`(${terms.map((term) => escapeRegExp(term)).join("|")})`, "giu");
	let lastIndex = 0;

	for (const match of text.matchAll(pattern)) {
		const start = match.index ?? 0;
		if (start > lastIndex) {
			el.appendChild(document.createTextNode(text.slice(lastIndex, start)));
		}

		const mark = el.createEl("mark", { cls: highlightClass });
		mark.setText(match[0]);
		lastIndex = start + match[0].length;
	}

	if (lastIndex < text.length) {
		el.appendChild(document.createTextNode(text.slice(lastIndex)));
	}
}

function escapeForPattern(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHeadingPrefix(text: string, heading: string): string {
	const trimmed = text.trim();
	if (!trimmed) return trimmed;

	const patterns = [
		new RegExp(`^#+\\s*${escapeForPattern(heading)}\\s*`, "iu"),
		new RegExp(`^§\\s*${escapeForPattern(heading)}\\s*[—:-]?\\s*`, "iu"),
		new RegExp(`^${escapeForPattern(heading)}\\s*[—:-]?\\s*`, "iu"),
	];

	for (const pattern of patterns) {
		const stripped = trimmed.replace(pattern, "").trim();
		if (stripped !== trimmed) {
			return stripped;
		}
	}

	return trimmed;
}

function formatHeadingLabel(heading: string, level?: number): string {
	const normalizedLevel = Math.max(1, Math.min(level ?? 1, 6));
	return `${"#".repeat(normalizedLevel)} ${heading}`;
}

function getBadgeLabel(badge: SearchMatchBadge): string {
	switch (badge) {
		case "title":
			return "Title";
		case "alias":
			return "Alias";
		case "tag":
			return "Tag";
		case "path":
			return "Path";
		case "heading":
			return "Heading";
		case "content":
			return "Content";
		case "semantic":
			return "Semantic";
		case "recent":
			return "Recent";
	}
}

function getBadgeIconId(badge: SearchMatchBadge): string {
	switch (badge) {
		case "title":
			return "type";
		case "alias":
			return "forward";
		case "tag":
			return "tags";
		case "path":
			return "folder-tree";
		case "heading":
			return "heading";
		case "content":
			return "align-left";
		case "semantic":
			return "sparkles";
		case "recent":
			return "clock-3";
	}
}

function normalizeDisplayTags(tags: string[] | undefined): string[] {
	if (!tags?.length) {
		return [];
	}

	return Array.from(
		new Set(
			tags
				.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 1),
		),
	);
}

function getFrontmatterDisplayTags(frontmatter: Record<string, unknown> | undefined): string[] {
	if (!frontmatter) {
		return [];
	}

	const rawTags = frontmatter.tags ?? frontmatter.tag;
	if (typeof rawTags === "string") {
		return normalizeDisplayTags(
			rawTags
				.split(",")
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 0),
		);
	}

	if (Array.isArray(rawTags)) {
		return normalizeDisplayTags(rawTags.filter((tag): tag is string => typeof tag === "string"));
	}

	return [];
}

function getDisplayTagLabel(tag: string): string {
	return tag.startsWith("#") ? tag.slice(1) : tag;
}

function getExplanationTag(matchExplanation: SearchResult["matchExplanation"]): string | undefined {
	if (matchExplanation?.source !== "tag") {
		return undefined;
	}

	const match = matchExplanation.text.match(/^Tag:\s*(#\S+)/u);
	return match?.[1];
}

function shouldShowMatchExplanation(
	matchExplanation: SearchResult["matchExplanation"],
	displayTags: string[],
): boolean {
	const explanationTag = getExplanationTag(matchExplanation);
	if (!explanationTag) {
		return true;
	}

	return !displayTags.includes(explanationTag);
}

function quoteFilterValue(value: string): string {
	return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function normalizeTag(tag: string): string {
	return tag.startsWith("#") ? tag : `#${tag}`;
}

function pushFilterToken(tokens: ParsedFilterToken[], token: ParsedFilterToken): void {
	if (token.value.length <= 1) {
		return;
	}

	const overlapsExisting = tokens.some((existing) => token.start < existing.end && token.end > existing.start);
	if (!overlapsExisting) {
		tokens.push(token);
	}
}

function extractFilterTokens(rawQuery: string): ParsedFilterToken[] {
	const tokenRegex = /(path|tag):(?:"([^"]+)"|'([^']+)'|(\S+))/giu;
	const bareTagRegex = /(^|\s)(#[^\s"']+)/gu;
	const barePathRegex = /(^|\s)((?!https?:\/\/)[^\s"'#]+(?:\/[^\s"'#]+)*\/)/gu;
	const tokens: ParsedFilterToken[] = [];

	for (const match of rawQuery.matchAll(tokenRegex)) {
		const type = match[1].toLowerCase() as ParsedFilterToken["type"];
		const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
		if (!value) continue;

		pushFilterToken(tokens, {
			type,
			value: type === "tag" ? normalizeTag(value) : value,
			raw: match[0],
			start: match.index ?? 0,
			end: (match.index ?? 0) + match[0].length,
		});
	}

	for (const match of rawQuery.matchAll(bareTagRegex)) {
		const value = normalizeTag(match[2]);
		const leadingWhitespace = match[1]?.length ?? 0;
		const start = (match.index ?? 0) + leadingWhitespace;

		pushFilterToken(tokens, {
			type: "tag",
			value,
			raw: match[2],
			start,
			end: start + match[2].length,
		});
	}

	for (const match of rawQuery.matchAll(barePathRegex)) {
		const value = match[2].trim();
		const leadingWhitespace = match[1]?.length ?? 0;
		const start = (match.index ?? 0) + leadingWhitespace;

		pushFilterToken(tokens, {
			type: "path",
			value,
			raw: match[2],
			start,
			end: start + match[2].length,
		});
	}

	return tokens.sort((left, right) => left.start - right.start);
}

function stripFilterTokens(rawQuery: string, tokens: ParsedFilterToken[]): string {
	if (tokens.length === 0) {
		return rawQuery.trim();
	}

	let cursor = 0;
	let remaining = "";
	for (const token of tokens) {
		remaining += `${rawQuery.slice(cursor, token.start)} `;
		cursor = token.end;
	}
	remaining += rawQuery.slice(cursor);

	return remaining.replace(/\s+/g, " ").trim();
}

function buildRawQuery(query: string, filter?: SearchFilter): string {
	const parts: string[] = [];
	if (query.trim()) {
		parts.push(query.trim());
	}

	for (const pathPrefix of filter?.pathPrefixes ?? []) {
		parts.push(`path:${quoteFilterValue(pathPrefix)}`);
	}

	for (const tag of filter?.tags ?? []) {
		parts.push(`tag:${quoteFilterValue(tag)}`);
	}

	return parts.join(" ").trim();
}

/**
 * Parse search query for filter syntax:
 * - path:folder/subfolder/ - filter by path prefix
 * - path:"folder with spaces/" - quoted path filter
 * - folder/subfolder/ - shorthand path filter
 * - tag:#tagname or tag:tagname - filter by tag (can use multiple)
 * - #tagname - shorthand tag filter
 *
 * Example: "path:projects/ tag:#active my search query"
 */
function parseQueryWithFilters(rawQuery: string): ParsedQuery {
	const tokens = extractFilterTokens(rawQuery);
	const pathPrefixes = tokens.filter((token) => token.type === "path").map((token) => token.value);
	const tags = tokens.filter((token) => token.type === "tag").map((token) => token.value);
	const cleanQuery = stripFilterTokens(rawQuery, tokens);

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
	private requireAllTags = false;
	private glowAnimationId: number | null = null;
	private borderEl: HTMLElement | null = null;
	private filterChipsEl: HTMLElement | null = null;

	constructor(app: App) {
		super(app);
		this.setPlaceholder("Search notes, use #tag or folder/, or leave empty for recent notes...");
		this.updateInstructions();

		// Register Tab to toggle semantic search
		this.scope.register([], "Tab", (evt) => {
			evt.preventDefault();
			this.semanticEnabled = !this.semanticEnabled;
			this.updateInstructions();
			this.syncGlowAnimation();
			// Re-run search with new algorithm if there's a query
			if (this.currentQuery.trim()) {
				this.lastSearchedQuery = ""; // Force re-search
				this.debouncedSearch(this.currentQuery);
			}
			return false;
		});

		// Add custom class for styling
		this.modalEl.addClass("s2b-search-modal");
		this.modalEl.setAttribute("data-testid", "search-modal");
	}

	private get activeAlgorithm(): SearchAlgorithm {
		return this.semanticEnabled ? "hybrid" : "lexical";
	}

	private syncGlowAnimation(): void {
		if (this.semanticEnabled && this.isSearching) {
			this.startGlowAnimation();
			return;
		}

		this.stopGlowAnimation();
	}

	private setSearching(isSearching: boolean): void {
		if (this.isSearching === isSearching) {
			return;
		}

		this.isSearching = isSearching;
		this.syncGlowAnimation();
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

	onOpen(): void {
		super.onOpen();
		this.ensureFilterChipsEl();
		this.renderFilterChips(parseQueryWithFilters(this.currentQuery));
	}

	onClose(): void {
		this.isClosed = true;
		this.stopGlowAnimation();
		this.filterChipsEl?.remove();
		this.filterChipsEl = null;
		// Cancel any pending debounced calls
		this.debouncedSearch.cancel();
	}

	private ensureFilterChipsEl(): HTMLElement | null {
		if (this.filterChipsEl?.isConnected) {
			return this.filterChipsEl;
		}

		if (!this.resultContainerEl) {
			return null;
		}

		this.filterChipsEl = this.modalEl.createDiv({ cls: "s2b-search-filter-bar" });
		this.resultContainerEl.before(this.filterChipsEl);
		return this.filterChipsEl;
	}

	private getInputEl(): HTMLInputElement | null {
		return this.modalEl.querySelector<HTMLInputElement>(".prompt-input");
	}

	private setSearchQuery(rawQuery: string): void {
		this.currentQuery = rawQuery;
		this.renderFilterChips(parseQueryWithFilters(rawQuery));

		const inputEl = this.getInputEl();
		if (inputEl && inputEl.value !== rawQuery) {
			inputEl.value = rawQuery;
		}

		if (rawQuery.trim() && rawQuery !== this.lastSearchedQuery) {
			this.debouncedSearch(rawQuery);
		} else if (!rawQuery.trim()) {
			this.searchResults = [];
			this.lastSearchedQuery = "";
			this.setSearching(false);
			// @ts-ignore - updateSuggestions is a protected method
			this.updateSuggestions();
		}
	}

	private removeFilterValue(type: "path" | "tag", value: string): void {
		const parsed = parseQueryWithFilters(this.currentQuery);
		const nextFilter: SearchFilter = {
			pathPrefixes:
				type === "path"
					? parsed.filter?.pathPrefixes?.filter((pathPrefix) => pathPrefix !== value)
					: parsed.filter?.pathPrefixes,
			tags: type === "tag" ? parsed.filter?.tags?.filter((tag) => tag !== value) : parsed.filter?.tags,
			requireAllTags: this.requireAllTags,
		};

		if (!nextFilter.tags?.length) {
			this.requireAllTags = false;
			nextFilter.requireAllTags = false;
		}

		this.setSearchQuery(buildRawQuery(parsed.query, nextFilter));
	}

	private toggleRequireAllTags(): void {
		this.requireAllTags = !this.requireAllTags;
		this.renderFilterChips(parseQueryWithFilters(this.currentQuery));
		if (this.currentQuery.trim()) {
			this.lastSearchedQuery = "";
			this.debouncedSearch(this.currentQuery);
		}
	}

	private renderFilterChips(parsed: ParsedQuery): void {
		const chipsEl = this.ensureFilterChipsEl();
		if (!chipsEl) return;

		chipsEl.empty();
		const filter = parsed.filter;
		if (!filter?.pathPrefixes?.length && !filter?.tags?.length) {
			this.requireAllTags = false;
			chipsEl.style.display = "none";
			return;
		}

		chipsEl.style.display = "flex";

		for (const pathPrefix of filter.pathPrefixes ?? []) {
			this.createFilterChip(chipsEl, `In ${pathPrefix}`, () => this.removeFilterValue("path", pathPrefix));
		}

		for (const tag of filter.tags ?? []) {
			this.createFilterChip(chipsEl, tag, () => this.removeFilterValue("tag", tag));
		}

		if (filter.tags?.length) {
			const modeChip = chipsEl.createEl("button", {
				cls: "s2b-search-filter-chip s2b-search-filter-chip-mode",
				text: this.requireAllTags ? "Tags: ALL" : "Tags: ANY",
			}) as HTMLButtonElement;
			modeChip.type = "button";
			modeChip.setAttribute("aria-label", "Toggle tag match mode");
			modeChip.addEventListener("click", () => this.toggleRequireAllTags());
		}
	}

	private createFilterChip(container: HTMLElement, label: string, onRemove: () => void): void {
		const chip = container.createEl("button", { cls: "s2b-search-filter-chip" }) as HTMLButtonElement;
		chip.type = "button";
		chip.setAttribute("aria-label", `Remove filter ${label}`);
		chip.createSpan({ cls: "s2b-search-filter-chip-value", text: label });
		chip.createSpan({ cls: "s2b-search-filter-chip-remove", text: "×" });
		chip.addEventListener("click", onRemove);
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
		border.className = "s2b-search-modal-glow";
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
				this.setSearching(false);
				// @ts-ignore - updateSuggestions is a protected method
				this.updateSuggestions();
				return;
			}

			this.setSearching(true);
			const algorithm = this.activeAlgorithm;

			// Parse query for filter syntax
			const { query, filter } = parseQueryWithFilters(rawQuery);
			const effectiveFilter = filter?.tags?.length
				? {
						...filter,
						requireAllTags: this.requireAllTags,
					}
				: filter;

			// Skip if no query and no filter
			if (!query.trim() && !effectiveFilter) {
				this.searchResults = [];
				this.setSearching(false);
				// @ts-ignore - updateSuggestions is a protected method
				this.updateSuggestions();
				return;
			}

			try {
				const results = await performSearch(this.app, query, algorithm, effectiveFilter);
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
				this.setSearching(false);
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
		const parsed = parseQueryWithFilters(query);
		this.renderFilterChips(parsed);

		// Only trigger search if query changed
		if (query.trim() && query !== this.lastSearchedQuery) {
			this.debouncedSearch(query);
		} else if (!query.trim()) {
			this.searchResults = getRecentNotes(this.app).slice(0, 20);
			this.lastSearchedQuery = "";
		}

		return this.searchResults;
	}

	/**
	 * Render each suggestion item
	 */
	renderSuggestion(result: SearchResult, el: HTMLElement): void {
		const container = el.createDiv({ cls: "s2b-search-result" });
		const highlightTerms = getHighlightTerms(this.currentQuery);
		const searchSettings = getData();
		const showPath = searchSettings.searchShowPath;
		const showTags = searchSettings.searchShowTags;
		const showMatchBadges = searchSettings.searchShowMatchBadges;
		const showMatchContext = searchSettings.searchShowMatchContext;
		const displayTags = showTags ? getFrontmatterDisplayTags(result.frontmatter) : [];

		// Title row
		const titleRow = container.createDiv({ cls: "s2b-search-result-title" });
		const titleMeta = titleRow.createDiv({ cls: "s2b-search-result-title-meta" });
		const noteIcon = getSearchResultNoteIcon(this.app, result.path);
		if (noteIcon) {
			const iconEl = titleMeta.createSpan({ cls: "s2b-search-result-note-icon" });
			iconEl.setAttribute("aria-hidden", "true");
			noteIcon.render(iconEl);
		}
		const titleEl = titleMeta.createSpan({ cls: "s2b-search-result-name" });
		titleEl.setAttribute("title", result.name);
		appendHighlightedText(titleEl, result.name, highlightTerms, "s2b-search-result-highlight-title");

		const pathParts = result.path.split("/");
		const folder = showPath && pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : "";
		if (folder || displayTags.length > 0) {
			const visibleTags = displayTags.slice(0, 3);
			const hiddenTags = displayTags.slice(visibleTags.length);
			const titleSecondary = titleMeta.createDiv({ cls: "s2b-search-result-title-secondary" });

			if (folder) {
				titleSecondary.createSpan({ text: "•", cls: "s2b-search-result-separator" });
				const pathEl = titleSecondary.createSpan({ text: folder, cls: "s2b-search-result-path" });
				pathEl.setAttribute("title", folder);
			}

			if (displayTags.length > 0) {
				const tagsContainer = titleSecondary.createDiv({ cls: "s2b-search-result-tags" });
				for (const tag of visibleTags) {
					const tagEl = tagsContainer.createSpan({ cls: "s2b-search-result-tag" });
					const tagIcon = getTagIcon(this.app, tag);
					if (tagIcon) {
						tagEl.classList.add(`s2b-search-result-tag-${tagIcon.provider}`);
						const resolvedTagColor = resolveIconColor(tagIcon.color);
						if (resolvedTagColor) {
							const rgbaColor = resolvedTagColor.replace("rgb(", "rgba(").replace(")", "");
							tagEl.style.setProperty("--tag-color", resolvedTagColor);
							tagEl.style.setProperty("--tag-color-hover", resolvedTagColor);
							tagEl.style.setProperty("--tag-color-remove-hover", resolvedTagColor);
							tagEl.style.setProperty("--tag-background", `${rgbaColor}, 0.1)`);
							tagEl.style.setProperty("--tag-background-hover", `${rgbaColor}, 0.1)`);
							tagEl.style.setProperty("--tag-border-color", `${rgbaColor}, 0.25)`);
							tagEl.style.setProperty("--tag-border-color-hover", `${rgbaColor}, 0.5)`);
						}

						const tagIconEl = tagEl.createSpan({ cls: "s2b-search-result-tag-icon iconic-icon" });
						tagIconEl.setAttribute("aria-hidden", "true");
						tagIcon.render(tagIconEl);
					}

					tagEl.createSpan({ text: getDisplayTagLabel(tag), cls: "s2b-search-result-tag-label" });
				}

				if (hiddenTags.length > 0) {
					const overflowTagEl = tagsContainer.createSpan({
						text: `+${hiddenTags.length}`,
						cls: "s2b-search-result-tag s2b-search-result-tag-overflow",
					});
					overflowTagEl.setAttribute("title", hiddenTags.join(", "));
				}
			}
		}

		if (showMatchBadges && result.matchBadges?.length) {
			const badgesRow = titleRow.createDiv({ cls: "s2b-search-result-badges" });
			for (const badge of result.matchBadges) {
				const badgeLabel = getBadgeLabel(badge);
				const badgeEl = badgesRow.createSpan({
					cls: `s2b-search-result-badge s2b-search-result-badge-${badge}`,
				});
				badgeEl.setAttribute("aria-label", badgeLabel);
				badgeEl.setAttribute("title", badgeLabel);

				const badgeIconEl = badgeEl.createSpan({ cls: "s2b-search-result-badge-icon" });
				badgeIconEl.setAttribute("aria-hidden", "true");
				setIcon(badgeIconEl, getBadgeIconId(badge));
			}
		}

		if (
			showMatchContext &&
			result.matchExplanation &&
			shouldShowMatchExplanation(result.matchExplanation, displayTags)
		) {
			const explanationRow = container.createDiv({ cls: "s2b-search-result-explanation" });

			if (result.matchExplanation.heading) {
				const headingEl = explanationRow.createDiv({ cls: "s2b-search-result-heading" });
				appendHighlightedText(
					headingEl,
					formatHeadingLabel(result.matchExplanation.heading, result.matchExplanation.headingLevel),
					highlightTerms,
				);

				const snippetText = stripHeadingPrefix(result.matchExplanation.text, result.matchExplanation.heading);
				if (snippetText) {
					const snippetEl = explanationRow.createDiv({ cls: "s2b-search-result-snippet" });
					appendHighlightedText(snippetEl, snippetText, highlightTerms);
				}
			} else {
				const snippetEl = explanationRow.createDiv({ cls: "s2b-search-result-snippet" });
				appendHighlightedText(snippetEl, result.matchExplanation.text, highlightTerms);
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
		const hint = this.resultContainerEl.createDiv({ cls: "s2b-search-semantic-hint" });
		hint.setText(`Press ${tabKey} to enhance results with semantic search`);
	}

	/**
	 * Empty state message
	 */
	onNoSuggestion(): void {
		// Clear previous empty state messages
		this.resultContainerEl.empty();
		const emptyEl = this.resultContainerEl.createDiv({ cls: "s2b-search-empty" });
		if (this.isSearching && this.semanticEnabled) {
			emptyEl.setText("Searching...");
		} else if (this.currentQuery.trim()) {
			emptyEl.setText("No notes found");
			this.appendSemanticHint();
		} else {
			emptyEl.setText("No recent notes yet. Open a note to see it here, or type to search your notes.");
		}
	}
}
