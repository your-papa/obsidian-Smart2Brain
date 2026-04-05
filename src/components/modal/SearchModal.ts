import {
	type App,
	MarkdownView,
	Notice,
	Platform,
	SuggestModal,
	TFile,
	TFolder,
	getAllTags,
	normalizePath,
	setIcon,
} from "obsidian";
import { performSearch } from "../../agent/tools/searchNotes";
import { getRecentNotes } from "../../search/recentNotes";
import type { SearchResult } from "../../vectorstore/types";
import { extractSearchTerms } from "../../search/searchTermUtils";
import { getData } from "../../stores/dataStore.svelte";
import { getMessenger } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";
import type { SearchAlgorithm } from "../../types/plugin";
import type { SearchFilter } from "../../vectorstore";
import type { SearchMatchBadge } from "../../vectorstore/types";
import { Logger } from "../../utils/logging";
import { getPathIcon, getSearchResultNoteIcon, getTagIcon, resolveIconColor } from "../../utils/noteIcons";

interface AutocompleteSuggestion {
	type: "autocomplete";
	kind: "tag" | "folder";
	value: string;
	display: string;
}

type SearchSuggestion = SearchResult | AutocompleteSuggestion;

function isAutocomplete(item: SearchSuggestion): item is AutocompleteSuggestion {
	return "type" in item && item.type === "autocomplete";
}

function getHighlightTerms(query: string): string[] {
	return extractSearchTerms(query);
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

function sanitizeNoteTitle(title: string): string {
	return title
		.replace(/[<>:"/\\|?*]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.substring(0, 100);
}

/**
 * Search modal that provides a popup search experience using the configured search algorithm.
 * Similar to Obsidian's native search or Omnisearch.
 *
 * Supports inline filter chips via # (tags) and / (folders) autocomplete.
 */
export class SearchModal extends SuggestModal<SearchSuggestion> {
	private searchResults: SearchResult[] = [];
	private currentQuery = "";
	private isSearching = false;
	private isClosed = false;
	private semanticEnabled = false;
	private requireAllTags = false;
	private glowAnimationId: number | null = null;
	private borderEl: HTMLElement | null = null;
	private searchTimeout: number | null = null;
	private searchRequestId = 0;
	private lastRequestedSearchKey = "";
	private cachedAutocompleteTags: string[] = [];
	private cachedTagChildCount = new Map<string, number>();
	private cachedAutocompleteFolders: string[] = [];
	/** Inline filter state — chips live inside the input container */
	private activeFilters: { type: "path" | "tag"; value: string }[] = [];
	private inlineChipsEl: HTMLElement | null = null;
	private inlineInputContentEl: HTMLElement | null = null;

	constructor(app: App) {
		super(app);
		this.setPlaceholder("Search notes, use #tag or /folder, or leave empty for recent notes...");
		this.updateInstructions();

		// Register Tab to toggle semantic search
		this.scope.register([], "Tab", (evt) => {
			evt.preventDefault();
			this.semanticEnabled = !this.semanticEnabled;
			this.updateInstructions();
			this.syncGlowAnimation();
			// Re-run search with new algorithm if there's a query or filters
			if (this.currentQuery.trim() || this.activeFilters.length > 0) {
				this.invalidateSearch();
				this.triggerSearch(this.currentQuery);
			}
			return false;
		});

		// Register Backspace to remove last filter chip when input is empty
		this.scope.register([], "Backspace", () => {
			const inputEl = this.getInputEl();
			if (inputEl && inputEl.value === "" && this.activeFilters.length > 0) {
				this.activeFilters.pop();
				this.renderInlineChips();
				this.invalidateSearch();
				this.triggerSearch(this.currentQuery);
				return false;
			}
			// Let default backspace behavior handle text deletion
			return true;
		});

		this.scope.register(["Mod"], "Enter", (evt) => {
			evt.preventDefault();
			void this.openSelectedSuggestionInNewTab();
			return false;
		});

		this.scope.register(["Shift"], "Enter", (evt) => {
			evt.preventDefault();
			void this.createNoteFromQuery();
			return false;
		});

		this.scope.register(["Alt"], "Enter", (evt) => {
			evt.preventDefault();
			void this.sendSelectedToChat();
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
		const pluginData = getData();
		if (!pluginData.searchShowKeyboardHints) {
			this.setInstructions([]);
			return;
		}
		const tabKey = Platform.isMacOS ? "⇥" : "Tab";
		const modEnterKey = Platform.isMacOS ? "⌘↵" : "Ctrl+↵";
		const altEnterKey = Platform.isMacOS ? "⌥↵" : "Alt+↵";
		const semanticLabel = this.semanticEnabled ? "semantic: on" : "semantic: off";
		this.setInstructions([
			{ command: "↑↓", purpose: "Navigate" },
			{ command: "↵", purpose: "Open note" },
			{ command: modEnterKey, purpose: "Open in new tab" },
			{ command: altEnterKey, purpose: "Send to chat" },
			{ command: "⇧↵", purpose: "Create note" },
			{ command: tabKey, purpose: semanticLabel },
			{ command: "esc", purpose: "Close" },
		]);
	}

	private getSelectedSuggestion(): SearchResult | null {
		if (this.searchResults.length === 0) {
			return null;
		}

		const suggestionEls = Array.from(this.resultContainerEl?.children ?? []).filter(
			(child): child is HTMLElement =>
				child instanceof HTMLElement && child.classList.contains("suggestion-item"),
		);

		if (suggestionEls.length === 0) {
			return this.searchResults[0] ?? null;
		}

		const selectedIndex = suggestionEls.findIndex((child) => child.classList.contains("is-selected"));
		const resultIndex = selectedIndex >= 0 ? selectedIndex : 0;
		return this.searchResults[resultIndex] ?? this.searchResults[0] ?? null;
	}

	private openSearchResult(result: SearchResult, destination: false | "tab"): void {
		const file = this.app.vault.getAbstractFileByPath(result.path);
		if (!(file instanceof TFile)) {
			return;
		}

		if (destination === false) {
			const existingLeaf = this.app.workspace
				.getLeavesOfType("markdown")
				.find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);

			if (existingLeaf) {
				this.close();
				this.app.workspace.revealLeaf(existingLeaf);
				return;
			}
		}

		this.close();
		this.app.workspace.openLinkText(result.path, "", destination);
	}

	private async openSelectedSuggestionInNewTab(): Promise<void> {
		const selectedSuggestion = this.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		this.openSearchResult(selectedSuggestion, "tab");
	}

	private async sendSelectedToChat(): Promise<void> {
		const selectedSuggestion = this.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(selectedSuggestion.path);
		if (!(file instanceof TFile)) {
			return;
		}

		this.close();

		// Ensure a chat is open
		const plugin = getPlugin();
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
		if (!existingLeaf) {
			await plugin.agentManager.createNewChat();
		} else {
			this.app.workspace.revealLeaf(existingLeaf);
		}

		const messenger = getMessenger();
		if (messenger) {
			messenger.pendingAttachmentPaths = [file.path];
		} else {
			new Notice("Chat is not initialized yet. Please open a chat first.");
		}
	}

	private async getUniqueNotePath(baseTitle: string): Promise<{ title: string; path: string }> {
		const targetFolder = this.getDefaultNewNoteFolder();
		let index = 1;
		while (true) {
			const title = index === 1 ? baseTitle : `${baseTitle} (${index})`;
			const path = targetFolder ? normalizePath(`${targetFolder}/${title}.md`) : normalizePath(`${title}.md`);

			if (!(await this.app.vault.adapter.exists(path))) {
				return { title, path };
			}

			index += 1;
		}
	}

	private getDefaultNewNoteFolder(): string {
		try {
			// @ts-expect-error - internal Obsidian config API
			const newFileLocation: unknown = this.app.vault.getConfig("newFileLocation");
			if (newFileLocation === "folder") {
				// @ts-expect-error - internal Obsidian config API
				const configuredFolder: unknown = this.app.vault.getConfig("newFileFolderPath");
				if (typeof configuredFolder === "string" && configuredFolder.length > 0 && configuredFolder !== "/") {
					return normalizePath(configuredFolder);
				}
			}

			if (newFileLocation === "current") {
				const activeFile = this.app.workspace.getActiveFile();
				const activeFolder = activeFile?.parent?.path;
				if (activeFolder && activeFolder !== "/") {
					return normalizePath(activeFolder);
				}
			}
		} catch {
			// Ignore internal config lookup failures and fall back to vault root.
		}

		return "";
	}

	private async createNoteFromQuery(): Promise<void> {
		const requestedTitle = this.currentQuery.trim();
		const baseTitle = sanitizeNoteTitle(requestedTitle) || "Untitled";

		try {
			const { title, path } = await this.getUniqueNotePath(baseTitle);
			const content = title === "Untitled" ? "" : `# ${title}\n`;
			const file = await this.app.vault.create(path, content);

			this.close();
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			this.app.workspace.revealLeaf(leaf);
		} catch (error) {
			Logger.error("[SearchModal] Failed to create note from query:", error);
			new Notice("Failed to create note");
		}
	}

	onOpen(): void {
		super.onOpen();
		this.isClosed = false;
		this.currentQuery = "";
		this.lastRequestedSearchKey = "";
		this.searchResults = getRecentNotes(this.app).slice(0, 20);
		this.buildAutocompleteCaches();
		this.setupInlineChips();
		// Seed the empty-query state immediately so recent notes are visible on first open.
		// @ts-ignore - updateSuggestions is a protected method
		this.updateSuggestions();
	}

	onClose(): void {
		this.isClosed = true;
		this.stopGlowAnimation();
		this.inlineChipsEl?.remove();
		this.inlineChipsEl = null;
		this.inlineInputContentEl?.remove();
		this.inlineInputContentEl = null;
		this.cachedAutocompleteTags = [];
		this.cachedTagChildCount.clear();
		this.cachedAutocompleteFolders = [];
		// Cancel any pending search
		if (this.searchTimeout !== null) {
			window.clearTimeout(this.searchTimeout);
			this.searchTimeout = null;
		}
	}

	/**
	 * Set up the inline chip container inside the prompt-input-container,
	 * before the <input> element, so chips appear inside the input field.
	 */
	private setupInlineChips(): void {
		const inputContainer = this.modalEl.querySelector<HTMLElement>(".prompt-input-container");
		const inputEl = this.getInputEl();
		if (!inputContainer || !inputEl) return;

		// Reserve a dedicated content column so wrapped chips never slide beneath the search icon.
		inputContainer.addClass("s2b-inline-chips-container");

		this.inlineInputContentEl = document.createElement("div");
		this.inlineInputContentEl.className = "s2b-inline-input-content";
		inputContainer.insertBefore(this.inlineInputContentEl, inputEl);

		// Create the chip wrapper inside the content flow, before the input.
		this.inlineChipsEl = document.createElement("div");
		this.inlineChipsEl.className = "s2b-inline-chips";
		this.inlineInputContentEl.appendChild(this.inlineChipsEl);
		this.inlineInputContentEl.appendChild(inputEl);

		// Make the input grow to fill the remaining space inside the flow container.
		inputEl.addClass("s2b-inline-input");
		this.updateInlineInputSpacing();
	}

	private getInputEl(): HTMLInputElement | null {
		return this.modalEl.querySelector<HTMLInputElement>(".prompt-input");
	}

	private usesCupertinoTheme(): boolean {
		const customCss = (this.app as App & { customCss?: { theme?: string } }).customCss;
		const themeName = customCss?.theme?.toLowerCase() ?? "";
		return themeName.includes("cupertino") || themeName.includes("baseline");
	}

	private updateInlineInputSpacing(): void {
		const inputEl = this.getInputEl();
		if (!inputEl) return;

		const usesCupertinoTheme = this.usesCupertinoTheme();
		const hasChips = this.activeFilters.length > 0;
		if (this.inlineInputContentEl) {
			this.inlineInputContentEl.style.setProperty(
				"padding-left",
				hasChips && usesCupertinoTheme ? "36px" : "8px",
				"important",
			);
		}

		const leadingInset = hasChips || !usesCupertinoTheme ? "0" : "36px";
		inputEl.style.setProperty("padding-left", leadingInset, "important");
		inputEl.style.setProperty("padding-inline-start", leadingInset, "important");
		inputEl.style.setProperty("padding-right", "0", "important");
		inputEl.style.setProperty("padding-inline-end", "0", "important");
		inputEl.style.setProperty("margin-left", "0", "important");
		inputEl.style.setProperty("text-indent", "0", "important");
	}

	private setSearchQuery(cleanQuery: string): void {
		this.currentQuery = cleanQuery;

		const inputEl = this.getInputEl();
		if (inputEl && inputEl.value !== cleanQuery) {
			inputEl.value = cleanQuery;
		}

		if (cleanQuery.trim() || this.activeFilters.length > 0) {
			this.invalidateSearch();
			this.triggerSearch(cleanQuery);
		} else {
			this.searchResults = getRecentNotes(this.app).slice(0, 20);
			this.lastRequestedSearchKey = "";
			this.setSearching(false);
			// @ts-ignore - updateSuggestions is a protected method
			this.updateSuggestions();
		}
	}

	private removeFilter(index: number): void {
		this.activeFilters.splice(index, 1);

		const activeTags = this.activeFilters.filter((f) => f.type === "tag");
		if (activeTags.length < 2) {
			this.requireAllTags = false;
		}

		this.renderInlineChips();
		this.invalidateSearch();
		this.triggerSearch(this.currentQuery);
	}

	private toggleRequireAllTags(): void {
		this.requireAllTags = !this.requireAllTags;
		this.renderInlineChips();
		if (this.currentQuery.trim() || this.activeFilters.length > 0) {
			this.invalidateSearch();
			this.triggerSearch(this.currentQuery);
		}
	}

	/** Build a SearchFilter from the active inline chips */
	private buildActiveFilter(): SearchFilter | undefined {
		const tags = this.activeFilters.filter((f) => f.type === "tag").map((f) => f.value);
		const pathPrefixes = this.activeFilters.filter((f) => f.type === "path").map((f) => f.value);

		if (tags.length === 0 && pathPrefixes.length === 0) return undefined;

		return {
			tags: tags.length > 0 ? tags : undefined,
			pathPrefixes: pathPrefixes.length > 0 ? pathPrefixes : undefined,
			requireAllTags: tags.length > 1 ? this.requireAllTags : undefined,
		};
	}

	private buildSearchKey(query: string): string {
		return JSON.stringify({
			query,
			algorithm: this.activeAlgorithm,
			filter: this.buildActiveFilter() ?? null,
		});
	}

	private buildAutocompleteCaches(): void {
		const leafTags = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) {
				continue;
			}

			for (const tag of getAllTags(cache) ?? []) {
				leafTags.add(tag);
			}
		}

		this.cachedTagChildCount.clear();
		for (const tag of leafTags) {
			const parts = tag.split("/");
			for (let index = 1; index < parts.length; index++) {
				const parent = parts.slice(0, index).join("/");
				this.cachedTagChildCount.set(parent, (this.cachedTagChildCount.get(parent) ?? 0) + 1);
			}
		}

		this.cachedAutocompleteTags = Array.from(new Set([...leafTags, ...this.cachedTagChildCount.keys()])).sort();
		this.cachedAutocompleteFolders = this.app.vault
			.getAllLoadedFiles()
			.filter(
				(abstractFile): abstractFile is TFolder => abstractFile instanceof TFolder && abstractFile.path !== "/",
			)
			.map((folder) => folder.path)
			.sort();
	}

	/** Render inline filter chips inside the input container */
	private renderInlineChips(): void {
		const chipsEl = this.inlineChipsEl;
		if (!chipsEl) return;

		chipsEl.empty();
		this.inlineInputContentEl?.toggleClass("s2b-inline-input-content-has-chips", this.activeFilters.length > 0);
		this.updateInlineInputSpacing();

		for (const [index, filter] of this.activeFilters.entries()) {
			const chip = chipsEl.createEl("button", { cls: "s2b-inline-chip" }) as HTMLButtonElement;
			chip.type = "button";

			// Try to get an icon from Iconic / Iconize
			const iconRenderer =
				filter.type === "tag"
					? getTagIcon(this.app, filter.value)
					: getPathIcon(this.app, filter.value.replace(/\/$/, ""), "folder");

			if (iconRenderer) {
				chip.classList.add(`s2b-inline-chip-${iconRenderer.provider}`);
				const resolvedColor = resolveIconColor(iconRenderer.color);
				if (resolvedColor) {
					const rgbaColor = resolvedColor.replace("rgb(", "rgba(").replace(")", "");
					chip.style.setProperty("--tag-color", resolvedColor);
					chip.style.setProperty("--tag-color-hover", resolvedColor);
					chip.style.setProperty("--tag-color-remove-hover", resolvedColor);
					chip.style.setProperty("--tag-background", `${rgbaColor}, 0.1)`);
					chip.style.setProperty("--tag-background-hover", `${rgbaColor}, 0.1)`);
					chip.style.setProperty("--tag-border-color", `${rgbaColor}, 0.25)`);
					chip.style.setProperty("--tag-border-color-hover", `${rgbaColor}, 0.5)`);
				}
				const iconEl = chip.createSpan({ cls: "s2b-inline-chip-icon" });
				iconEl.setAttribute("aria-hidden", "true");
				iconRenderer.render(iconEl);
			} else {
				// Fallback: default icon for type
				const iconEl = chip.createSpan({ cls: "s2b-inline-chip-icon" });
				iconEl.setAttribute("aria-hidden", "true");
				setIcon(iconEl, filter.type === "tag" ? "tag" : "folder");
			}

			const label = filter.type === "path" ? filter.value.replace(/\/$/, "") : filter.value.replace(/^#/, "");
			chip.setAttribute("aria-label", `Remove filter ${label}`);
			chip.createSpan({ cls: "s2b-inline-chip-label", text: label });
			chip.createSpan({ cls: "s2b-inline-chip-remove", text: "×" });
			chip.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this.removeFilter(index);
				this.getInputEl()?.focus();
			});
		}

		// Tags ANY/ALL toggle chip (only with 2+ tags)
		const tagCount = this.activeFilters.filter((f) => f.type === "tag").length;
		if (tagCount > 1) {
			const modeChip = chipsEl.createEl("button", {
				cls: "s2b-inline-chip s2b-inline-chip-mode",
				text: this.requireAllTags ? "ALL" : "ANY",
			}) as HTMLButtonElement;
			modeChip.type = "button";
			modeChip.setAttribute("aria-label", "Toggle tag match mode");
			modeChip.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this.toggleRequireAllTags();
			});
		}
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

	/** Force the next getSuggestions call to re-trigger a search. */
	private invalidateSearch(): void {
		this.lastRequestedSearchKey = "";
	}

	/**
	 * Schedule a search with the appropriate debounce for the active algorithm.
	 * Uses a monotonic request ID to discard stale results.
	 */
	private triggerSearch(cleanQuery: string): void {
		if (this.searchTimeout !== null) {
			window.clearTimeout(this.searchTimeout);
			this.searchTimeout = null;
		}

		const delay = this.activeAlgorithm === "lexical" ? 40 : 200;

		this.searchTimeout = window.setTimeout(() => {
			this.searchTimeout = null;
			void this.requestSearch(cleanQuery);
		}, delay);
	}

	/**
	 * Single search path for all algorithms.
	 * A monotonic `searchRequestId` ensures only the latest request can update the UI.
	 */
	private async requestSearch(cleanQuery: string): Promise<void> {
		if (this.isClosed) return;

		const filter = this.buildActiveFilter();
		const algorithm = this.activeAlgorithm;
		const requestId = ++this.searchRequestId;

		if (!cleanQuery.trim() && !filter) {
			this.searchResults = [];
			this.setSearching(false);
			// @ts-ignore - updateSuggestions is a protected method
			this.updateSuggestions();
			return;
		}

		this.setSearching(true);

		try {
			const results = await performSearch(this.app, cleanQuery, algorithm, filter);

			// Discard results from stale requests
			if (requestId !== this.searchRequestId || this.isClosed) return;

			this.searchResults = results.slice(0, 20);
			// @ts-ignore - updateSuggestions is a protected method
			this.updateSuggestions();
		} catch (error) {
			Logger.error("[SearchModal] Search failed:", error);
			if (requestId === this.searchRequestId) {
				this.searchResults = [];
			}
		} finally {
			if (requestId === this.searchRequestId) {
				this.setSearching(false);
			}
		}
	}

	/**
	 * Detect whether the user is typing a partial filter token at the end of the query.
	 * Returns autocomplete suggestions for tags (#) or folders (path/) when applicable.
	 */
	private getAutocompleteSuggestions(query: string): AutocompleteSuggestion[] | null {
		// Match a partial tag at the end: "#" or "#part"
		const tagMatch = query.match(/(#)([^\s]*)$/u);
		if (tagMatch) {
			const partial = tagMatch[2].toLowerCase();
			return this.getTagSuggestions(partial);
		}

		// Match a partial folder path at the end.
		// Triggers when the trailing token contains "/" (e.g. "src/", "/fo", "my/deep/path")
		// or when it starts with "/" (e.g. "/docs").
		// Excludes URLs (http:// https://).
		const folderMatch = query.match(/(?:^|\s)((?!https?:\/\/)(\/[^\s]*|[^\s]*\/[^\s]*))$/u);
		if (folderMatch) {
			const partial = folderMatch[1].toLowerCase();
			const suggestions = this.getFolderSuggestions(partial);
			// Only enter folder autocomplete if there are matching folders.
			if (suggestions.length > 0) {
				return suggestions;
			}
		}

		return null;
	}

	private getTagSuggestions(partial: string): AutocompleteSuggestion[] {
		return this.cachedAutocompleteTags
			.filter((tag) => !partial || tag.toLowerCase().slice(1).includes(partial))
			.slice(0, 20)
			.map((tag) => {
				const children = this.cachedTagChildCount.get(tag);
				const label = tag.startsWith("#") ? tag.slice(1) : tag;
				return {
					type: "autocomplete" as const,
					kind: "tag" as const,
					value: tag,
					display: children ? `${label} (${children} subtags)` : label,
				};
			});
	}

	private getFolderSuggestions(partial: string): AutocompleteSuggestion[] {
		// Strip leading/trailing slashes so "/fo" → "fo" matches folder "foobar"
		const needle = partial.replace(/^\/+|\/+$/gu, "");
		return this.cachedAutocompleteFolders
			.filter((folder) => !needle || folder.toLowerCase().includes(needle))
			.slice(0, 20)
			.map((folder) => ({
				type: "autocomplete" as const,
				kind: "folder" as const,
				value: `${folder}/`,
				display: folder,
			}));
	}

	private deferSuggestions(suggestions: SearchSuggestion[]): Promise<SearchSuggestion[]> {
		return new Promise((resolve) => {
			window.setTimeout(() => resolve(suggestions), 0);
		});
	}

	private applyAutocompleteSuggestion(suggestion: AutocompleteSuggestion): void {
		// Add the selected suggestion as an inline filter chip
		this.activeFilters.push({ type: suggestion.kind === "tag" ? "tag" : "path", value: suggestion.value });
		this.renderInlineChips();

		// Remove the partial token from the input (the #... or folder/ text)
		let cleanQuery: string;
		if (suggestion.kind === "tag") {
			cleanQuery = this.currentQuery.replace(/(#)[^\s]*$/u, "").trim();
		} else {
			cleanQuery = this.currentQuery.replace(/(?:^|\s)((?!https?:\/\/)(\/[^\s]*|[^\s]*\/[^\s]*))$/u, "").trim();
		}

		this.setSearchQuery(cleanQuery);
		// @ts-ignore - updateSuggestions is a protected method
		this.updateSuggestions();
	}

	getSuggestions(query: string): SearchSuggestion[] | Promise<SearchSuggestion[]> {
		this.currentQuery = query;

		// Check for autocomplete mode (typing # or folder/)
		const autocompleteSuggestions = this.getAutocompleteSuggestions(query);
		if (autocompleteSuggestions && autocompleteSuggestions.length > 0) {
			this.lastRequestedSearchKey = "";
			if (this.searchTimeout !== null) {
				window.clearTimeout(this.searchTimeout);
				this.searchTimeout = null;
			}
			return autocompleteSuggestions;
		}

		const filter = this.buildActiveFilter();

		// Empty query with no filter → show recent notes synchronously
		if (!query.trim() && !filter) {
			this.searchResults = getRecentNotes(this.app).slice(0, 20);
			this.lastRequestedSearchKey = "";
			return this.searchResults;
		}

		// Deduplicate: only trigger a new search when the key changes
		const searchKey = this.buildSearchKey(query);
		if (searchKey !== this.lastRequestedSearchKey) {
			this.lastRequestedSearchKey = searchKey;
			this.triggerSearch(query);
		}
		return this.deferSuggestions(this.searchResults);
	}

	/**
	 * Render each suggestion item
	 */
	renderSuggestion(item: SearchSuggestion, el: HTMLElement): void {
		if (isAutocomplete(item)) {
			this.renderAutocompleteSuggestion(item, el);
			return;
		}

		const result = item;
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

	private renderAutocompleteSuggestion(suggestion: AutocompleteSuggestion, el: HTMLElement): void {
		const container = el.createDiv({ cls: "s2b-search-autocomplete" });
		const iconEl = container.createSpan({ cls: "s2b-search-autocomplete-icon" });

		// Use Iconic/Iconize tag icon if available, otherwise fall back to default icons
		if (suggestion.kind === "tag") {
			const tagIcon = getTagIcon(this.app, suggestion.value);
			if (tagIcon) {
				iconEl.classList.add(`s2b-search-autocomplete-icon-${tagIcon.provider}`);
				const resolvedColor = resolveIconColor(tagIcon.color);
				if (resolvedColor) {
					iconEl.style.color = resolvedColor;
				}
				tagIcon.render(iconEl);
			} else {
				setIcon(iconEl, "tag");
			}
		} else {
			const folderIcon = getPathIcon(this.app, suggestion.value.replace(/\/$/, ""), "folder");
			if (folderIcon) {
				iconEl.classList.add(`s2b-search-autocomplete-icon-${folderIcon.provider}`);
				const resolvedColor = resolveIconColor(folderIcon.color);
				if (resolvedColor) {
					iconEl.style.color = resolvedColor;
				}
				folderIcon.render(iconEl);
			} else {
				setIcon(iconEl, "folder");
			}
		}

		container.createSpan({ cls: "s2b-search-autocomplete-text", text: suggestion.display });
		container.createSpan({
			cls: "s2b-search-autocomplete-hint",
			text: suggestion.kind === "tag" ? "Filter by tag" : "Filter by folder",
		});
	}

	/**
	 * Handle selection — open note, or apply autocomplete suggestion
	 */
	onChooseSuggestion(item: SearchSuggestion, evt: MouseEvent | KeyboardEvent): void {
		if (isAutocomplete(item)) {
			this.applyAutocompleteSuggestion(item);
			return;
		}

		const destination = evt.ctrlKey || evt.metaKey ? "tab" : false;
		this.openSearchResult(item, destination);
	}

	/**
	 * Override selectSuggestion to prevent closing the modal on autocomplete selection.
	 */
	selectSuggestion(value: SearchSuggestion, evt: MouseEvent | KeyboardEvent): void {
		if (isAutocomplete(value)) {
			this.applyAutocompleteSuggestion(value);
			return;
		}
		super.selectSuggestion(value, evt);
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
		this.resultContainerEl.empty();

		// While a search is in-flight or debounced, show nothing to avoid
		// flashing "No notes found" between keystrokes.
		if (this.isSearching || this.searchTimeout !== null) {
			return;
		}

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
