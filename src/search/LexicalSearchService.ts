import { TFile, getAllTags, type CachedMetadata } from "obsidian";
import type SecondBrainPlugin from "../main";
import { getData } from "../stores/dataStore.svelte";
import { Logger } from "../utils/logging";
import { matchesPathPrefix } from "../utils/pathUtils";
import { MiniSearchService, type LexicalSearchResult } from "../vectorstore/MiniSearchService";
import type { SearchFilter, SearchMatchBadge, SearchMatchExplanation, VectorSearchResult } from "../vectorstore/types";

const MAX_SNIPPET_LENGTH = 180;

let instance: LexicalSearchService | null = null;
let pendingInstance: LexicalSearchService | null = null;
let pendingInitPromise: Promise<void> | null = null;

export function getLexicalSearchService(): LexicalSearchService {
	if (!instance) {
		throw new Error("LexicalSearchService not initialized. Call initialize() first.");
	}
	return instance;
}

export function isLexicalSearchInitialized(): boolean {
	return instance !== null;
}

export async function waitForLexicalSearch(): Promise<boolean> {
	if (instance) return true;
	if (pendingInitPromise !== null) {
		await pendingInitPromise;
		return instance !== null;
	}
	return false;
}

export class LexicalSearchService {
	private readonly plugin: SecondBrainPlugin;
	private readonly miniSearch: MiniSearchService;
	private readonly vaultId: string;

	private constructor(plugin: SecondBrainPlugin) {
		this.plugin = plugin;
		this.vaultId = (plugin.app as unknown as { appId: string }).appId;
		this.miniSearch = new MiniSearchService(this.vaultId);
	}

	static async initialize(plugin: SecondBrainPlugin): Promise<LexicalSearchService> {
		if (instance) {
			Logger.warn("[LexicalSearch] Already initialized");
			return instance;
		}

		if (pendingInstance) {
			Logger.warn("[LexicalSearch] Initialization already in progress");
			if (pendingInitPromise !== null) {
				await pendingInitPromise;
			}
			return instance ?? pendingInstance;
		}

		const service = new LexicalSearchService(plugin);
		pendingInstance = service;
		pendingInitPromise = service
			.init()
			.then(() => {
				instance = service;
			})
			.finally(() => {
				if (pendingInstance === service) {
					pendingInstance = null;
				}
				pendingInitPromise = null;
			});

		await pendingInitPromise;
		return instance ?? service;
	}

	static startInitialize(plugin: SecondBrainPlugin): LexicalSearchService {
		if (instance) {
			Logger.warn("[LexicalSearch] Already initialized");
			return instance;
		}

		if (pendingInstance) {
			Logger.warn("[LexicalSearch] Initialization already in progress");
			return pendingInstance;
		}

		const service = new LexicalSearchService(plugin);
		pendingInstance = service;
		pendingInitPromise = service
			.init()
			.then(() => {
				instance = service;
			})
			.catch((error) => {
				Logger.error("[LexicalSearch] Background initialization failed:", error);
			})
			.finally(() => {
				if (pendingInstance === service) {
					pendingInstance = null;
				}
				pendingInitPromise = null;
			});

		return service;
	}

	private async init(): Promise<void> {
		try {
			await this.miniSearch.open();
			const loaded = await this.miniSearch.loadFromStorage();
			if (loaded) {
				this.plugin.app.workspace.onLayoutReady(() => {
					void this.validateIndex();
				});
			} else {
				this.plugin.app.workspace.onLayoutReady(() => {
					void this.buildIndex();
				});
			}

			this.registerEvents();
			Logger.log("[LexicalSearch] Initialized");
		} catch (error) {
			Logger.error("[LexicalSearch] Initialization failed:", error);
			throw error;
		}
	}

	get documentCount(): number {
		return this.miniSearch.documentCount;
	}

	async search(query: string, topK: number, filter?: SearchFilter): Promise<VectorSearchResult[]> {
		const results = this.miniSearch.search(query, topK * (filter ? 3 : 1));
		return this.applyFilter(results, topK, filter, query);
	}

	async browse(topK: number, filter?: SearchFilter): Promise<VectorSearchResult[]> {
		const results = this.miniSearch.browse(topK * (filter ? 3 : 1));
		return this.applyFilter(results, topK, filter);
	}

	private async buildIndex(): Promise<void> {
		const { vault } = this.plugin.app;
		const files = vault.getMarkdownFiles().filter((file) => this.shouldIndexFile(file));

		for (const file of files) {
			try {
				const content = await vault.cachedRead(file);
				this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
			} catch (error) {
				Logger.error(`[LexicalSearch] Failed to read ${file.path}:`, error);
			}
		}

		await this.miniSearch.flush();
		Logger.log(`[LexicalSearch] Built lexical index: ${this.miniSearch.documentCount} documents`);
	}

	private async validateIndex(): Promise<void> {
		const { vault } = this.plugin.app;
		const files = vault.getMarkdownFiles().filter((file) => this.shouldIndexFile(file));

		let added = 0;
		for (const file of files) {
			if (this.miniSearch.hasDocument(file.path)) {
				continue;
			}

			try {
				const content = await vault.cachedRead(file);
				this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
				added++;
			} catch (error) {
				Logger.error(`[LexicalSearch] Failed to read ${file.path}:`, error);
			}
		}

		if (added > 0) {
			await this.miniSearch.flush();
			Logger.log(`[LexicalSearch] Added ${added} missing documents to lexical index`);
		}
	}

	private registerEvents(): void {
		const { vault } = this.plugin.app;

		this.plugin.registerEvent(
			vault.on("create", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileCreate(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("modify", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileModify(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.miniSearch.removeDocument(file.path);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("rename", async (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileRename(file, oldPath);
				}
			}),
		);
	}

	private async handleFileCreate(file: TFile): Promise<void> {
		if (!this.shouldIndexFile(file)) {
			return;
		}

		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
		} catch (error) {
			Logger.error(`[LexicalSearch] Failed to add ${file.path}:`, error);
		}
	}

	private async handleFileModify(file: TFile): Promise<void> {
		if (!this.shouldIndexFile(file)) {
			this.miniSearch.removeDocument(file.path);
			return;
		}

		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
		} catch (error) {
			Logger.error(`[LexicalSearch] Failed to update ${file.path}:`, error);
		}
	}

	private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
		this.miniSearch.removeDocument(oldPath);

		if (!this.shouldIndexFile(file)) {
			return;
		}

		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
		} catch (error) {
			Logger.error(`[LexicalSearch] Failed to rename ${oldPath} -> ${file.path}:`, error);
		}
	}

	private shouldIndexFile(file: TFile): boolean {
		const pluginData = getData();
		const indexList = pluginData.indexList;
		const isExcluding = pluginData.isExcluding;

		const matchesPattern = indexList.some(
			(pattern) => file.path.startsWith(pattern) || file.path.includes(`/${pattern}`),
		);

		return isExcluding ? !matchesPattern : indexList.length === 0 || matchesPattern;
	}

	private getSearchableTags(file: TFile): string[] {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		return cache ? (getAllTags(cache) ?? []) : [];
	}

	private applyFilter(
		results: LexicalSearchResult[],
		topK: number,
		filter?: SearchFilter,
		query?: string,
	): VectorSearchResult[] {
		const { metadataCache } = this.plugin.app;
		const filteredResults: VectorSearchResult[] = [];
		const normalizedFilterTags = this.normalizeFilterTags(filter?.tags);
		const requireAllTags = filter?.requireAllTags === true;

		for (const result of results) {
			if (filter?.pathPrefixes?.length) {
				const matchesPath = filter.pathPrefixes.some((prefix) => matchesPathPrefix(result.path, prefix));
				if (!matchesPath) continue;
			}

			const file = this.plugin.app.vault.getAbstractFileByPath(result.path);
			const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;
			const docTags = cache ? (getAllTags(cache) ?? []) : [];

			if (normalizedFilterTags && !this.matchesTagFilter(docTags, normalizedFilterTags, requireAllTags)) {
				continue;
			}

			filteredResults.push({
				path: result.path,
				name: result.name,
				frontmatter: cache?.frontmatter,
				tags: docTags,
				matchExplanation: this.buildMatchExplanation(
					query,
					result.path,
					result.name,
					docTags,
					result.content,
					cache,
				),
				matchBadges: this.getMatchBadges(query, result.path, result.name, docTags, result.content, cache),
				score: result.score,
			});

			if (filteredResults.length >= topK) {
				break;
			}
		}

		return filteredResults;
	}

	private normalizeFilterTags(tags: string[] | undefined): string[] | undefined {
		if (!tags?.length) {
			return undefined;
		}

		return tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
	}

	private matchesTagFilter(docTags: string[], filterTags: string[], requireAllTags: boolean): boolean {
		const normalizedDocTags = new Set(docTags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)));
		if (requireAllTags) {
			return filterTags.every((tag) => normalizedDocTags.has(tag));
		}

		return filterTags.some((tag) => normalizedDocTags.has(tag));
	}

	private getMatchBadges(
		query: string | undefined,
		path: string,
		noteName: string,
		docTags: string[],
		content: string | undefined,
		cache: CachedMetadata | null,
	): SearchMatchBadge[] | undefined {
		if (!query?.trim()) return undefined;

		const terms = this.extractSearchTerms(query);
		if (terms.length === 0) return undefined;

		const badges = new Set<SearchMatchBadge>();
		if (this.findMatchIndex(noteName, terms) !== -1) {
			badges.add("title");
		}

		if (this.findAliasMatch(cache?.frontmatter, terms)) {
			badges.add("alias");
		}

		if (this.findTagMatch(docTags, terms)) {
			badges.add("tag");
		}

		if (this.findPathSegmentMatch(path, terms)) {
			badges.add("path");
		}

		const explanation = this.buildMatchExplanation(query, path, noteName, docTags, content, cache);
		if (explanation) {
			badges.add(explanation.source);
		}

		return badges.size > 0 ? Array.from(badges) : undefined;
	}

	private buildMatchExplanation(
		query: string | undefined,
		path: string,
		noteName: string,
		docTags: string[],
		content: string | undefined,
		cache: CachedMetadata | null,
	): SearchMatchExplanation | undefined {
		if (!query?.trim()) return undefined;

		const terms = this.extractSearchTerms(query);
		if (terms.length === 0) return undefined;

		const aliasMatch = this.findAliasMatch(cache?.frontmatter, terms);
		if (aliasMatch) {
			return { source: "alias", text: `Alias: ${aliasMatch}` };
		}

		const tagMatch = this.findTagMatch(docTags, terms);
		if (tagMatch) {
			return { source: "tag", text: `Tag: ${tagMatch}` };
		}

		const headingMatch = this.findHeadingExplanation(content, cache, terms);
		if (headingMatch) {
			return headingMatch;
		}

		const snippet = this.extractSnippet(content, terms);
		if (snippet) {
			return { source: "content", text: snippet };
		}

		if (this.findPathSegmentMatch(path, terms)) {
			return undefined;
		}

		return undefined;
	}

	private findHeadingExplanation(
		content: string | undefined,
		cache: CachedMetadata | null,
		terms: string[],
	): SearchMatchExplanation | undefined {
		if (!content || !cache?.headings?.length) return undefined;

		const lines = content.split(/\r?\n/);
		for (let index = 0; index < cache.headings.length; index++) {
			const heading = cache.headings[index];
			const nextHeading = cache.headings[index + 1];
			const startLine = heading.position.start.line;
			const endLine = nextHeading ? nextHeading.position.start.line : lines.length;
			const headingLine = lines[startLine] ?? heading.heading;
			const sectionText = lines.slice(startLine, endLine).join("\n");
			const sectionBody = lines.slice(startLine + 1, endLine).join("\n");
			const headingMatchIndex = this.findMatchIndex(headingLine, terms);
			const bodyMatchIndex = this.findMatchIndex(sectionBody, terms);

			if (headingMatchIndex === -1 && bodyMatchIndex === -1) {
				continue;
			}

			const matchedBody = bodyMatchIndex >= 0;
			const snippetSource = matchedBody ? sectionBody : sectionText;
			const snippet = this.extractSnippet(snippetSource, terms) ?? this.cleanSnippetText(heading.heading);
			return {
				source: headingMatchIndex >= 0 ? "heading" : "content",
				heading: heading.heading,
				text: snippet,
			};
		}

		return undefined;
	}

	private extractSearchTerms(query: string): string[] {
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

	private findMatchIndex(text: string | undefined, terms: string[]): number {
		if (!text) return -1;

		const normalized = text.toLowerCase();
		let firstMatch = -1;

		for (const term of terms) {
			const index = normalized.indexOf(term);
			if (index !== -1 && (firstMatch === -1 || index < firstMatch)) {
				firstMatch = index;
			}
		}

		return firstMatch;
	}

	private extractSnippet(content: string | undefined, terms: string[]): string | undefined {
		if (!content) return undefined;

		const normalizedContent = this.stripFrontmatter(content);
		const matchIndex = this.findMatchIndex(normalizedContent, terms);
		if (matchIndex === -1) return undefined;

		const start = Math.max(0, matchIndex - 60);
		const end = Math.min(normalizedContent.length, matchIndex + MAX_SNIPPET_LENGTH);
		const prefix = start > 0 ? "…" : "";
		const suffix = end < normalizedContent.length ? "…" : "";

		return `${prefix}${this.cleanSnippetText(normalizedContent.slice(start, end))}${suffix}`;
	}

	private stripFrontmatter(content: string): string {
		if (!content.startsWith("---\n")) return content;

		const endOfFrontmatter = content.indexOf("\n---\n", 4);
		if (endOfFrontmatter === -1) return content;

		return content.slice(endOfFrontmatter + 5);
	}

	private cleanSnippetText(text: string): string {
		return text
			.replaceAll(/^#+\s+/gm, "")
			.replaceAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
			.replaceAll(/\[\[([^\]]+)\]\]/g, "$1")
			.replaceAll(/`([^`]+)`/g, "$1")
			.replaceAll(/[*_~>#-]+/g, " ")
			.replaceAll(/\s+/g, " ")
			.trim();
	}

	private findAliasMatch(frontmatter: Record<string, unknown> | undefined, terms: string[]): string | undefined {
		for (const alias of this.extractAliasesFromFrontmatter(frontmatter)) {
			if (this.findMatchIndex(alias, terms) !== -1) {
				return alias;
			}
		}

		return undefined;
	}

	private findTagMatch(tags: string[], terms: string[]): string | undefined {
		for (const tag of tags) {
			const normalizedTag = tag.startsWith("#") ? tag : `#${tag}`;
			if (
				this.findMatchIndex(normalizedTag, terms) !== -1 ||
				this.findMatchIndex(normalizedTag.slice(1), terms) !== -1
			) {
				return normalizedTag;
			}
		}

		return undefined;
	}

	private findPathSegmentMatch(path: string, terms: string[]): string | undefined {
		const segments = path.split("/").slice(0, -1);
		for (const segment of segments) {
			if (this.findMatchIndex(segment, terms) !== -1) {
				return segment;
			}
		}

		return undefined;
	}

	private extractAliasesFromFrontmatter(frontmatter: Record<string, unknown> | undefined): string[] {
		if (!frontmatter) {
			return [];
		}

		const rawAliases = frontmatter.aliases ?? frontmatter.alias;
		if (typeof rawAliases === "string") {
			return rawAliases.trim() ? [rawAliases.trim()] : [];
		}

		if (Array.isArray(rawAliases)) {
			return rawAliases
				.filter((value): value is string => typeof value === "string")
				.map((alias) => alias.trim())
				.filter((alias) => alias.length > 0);
		}

		return [];
	}

	async cleanup(): Promise<void> {
		try {
			if (pendingInitPromise !== null) {
				await pendingInitPromise.catch(() => {});
			}
			await this.miniSearch.flush();
			this.miniSearch.close();
			Logger.log("[LexicalSearch] Cleanup complete");
		} catch (error) {
			Logger.error("[LexicalSearch] Cleanup failed:", error);
		}

		instance = null;
		pendingInstance = null;
	}
}
