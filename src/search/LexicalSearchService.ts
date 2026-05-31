import { TFile, getAllTags, type CachedMetadata } from "obsidian";
import type SecondBrainPlugin from "../main";
import { compileFilter, matchesSearchFilter } from "../search/searchFilters";
import { extractSearchTerms } from "../search/searchTermUtils";
import { createQueryPlan, type QueryPlan } from "../search/queryPlan";
import {
	hasLexicalAliasSignal,
	hasLexicalContentSignal,
	hasLexicalPathSignal,
	hasLexicalTagSignal,
	hasLexicalTitleSignal,
} from "../search/lexicalScoring";
import { Logger } from "../utils/logging";
import { getIndexableVaultFiles, isIndexableFile, readIndexableContent } from "../utils/fileFiltering";
import {
	MiniSearchService,
	type AutocompleteCacheSnapshot,
	type LexicalSearchResult,
} from "../vectorstore/MiniSearchService";
import type { SearchFilter, SearchMatchBadge, SearchMatchExplanation, VectorSearchResult } from "../vectorstore/types";
import { getData } from "../stores/dataStore.svelte";

const MAX_SNIPPET_LENGTH = 180;

interface ResolvedMatchMetadata {
	badges?: SearchMatchBadge[];
	explanation?: SearchMatchExplanation;
}

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
		this.vaultId = getData().vaultSlug;
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

	getAutocompleteCache(): AutocompleteCacheSnapshot {
		return this.miniSearch.getAutocompleteCache();
	}

	private async buildIndex(): Promise<void> {
		const { vault } = this.plugin.app;
		const files = getIndexableVaultFiles(vault);

		for (const file of files) {
			try {
				const content = await readIndexableContent(vault, file);
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
		const files = getIndexableVaultFiles(vault);
		const vaultPaths = new Set(files.map((f) => f.path));

		let removed = 0;
		for (const indexedPath of this.miniSearch.getDocumentPaths()) {
			if (!vaultPaths.has(indexedPath)) {
				this.miniSearch.removeDocument(indexedPath);
				removed++;
			}
		}

		let added = 0;
		for (const file of files) {
			if (this.miniSearch.hasDocument(file.path)) {
				continue;
			}

			try {
				const content = await readIndexableContent(vault, file);
				this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
				added++;
			} catch (error) {
				Logger.error(`[LexicalSearch] Failed to read ${file.path}:`, error);
			}
		}

		if (added > 0 || removed > 0) {
			await this.miniSearch.flush();
			Logger.log(`[LexicalSearch] Validated lexical index: added ${added}, removed ${removed} documents`);
		}
	}

	private registerEvents(): void {
		const { vault } = this.plugin.app;

		this.plugin.registerEvent(
			vault.on("create", async (file) => {
				if (file instanceof TFile && isIndexableFile(file)) {
					await this.handleFileCreate(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("modify", async (file) => {
				if (file instanceof TFile && isIndexableFile(file)) {
					await this.handleFileModify(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("delete", (file) => {
				if (file instanceof TFile) {
					this.miniSearch.removeDocument(file.path);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("rename", async (file, oldPath) => {
				if (file instanceof TFile && isIndexableFile(file)) {
					await this.handleFileRename(file, oldPath);
				}
			}),
		);
	}

	private async handleFileCreate(file: TFile): Promise<void> {
		try {
			const content = await readIndexableContent(this.plugin.app.vault, file);
			this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
		} catch (error) {
			Logger.error(`[LexicalSearch] Failed to add ${file.path}:`, error);
		}
	}

	private async handleFileModify(file: TFile): Promise<void> {
		try {
			const content = await readIndexableContent(this.plugin.app.vault, file);
			this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
		} catch (error) {
			Logger.error(`[LexicalSearch] Failed to update ${file.path}:`, error);
		}
	}

	private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
		this.miniSearch.removeDocument(oldPath);

		try {
			const content = await readIndexableContent(this.plugin.app.vault, file);
			this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
		} catch (error) {
			Logger.error(`[LexicalSearch] Failed to rename ${oldPath} -> ${file.path}:`, error);
		}
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
		// Compile once before the loop so large path-prefix lists build their
		// exact-path Set a single time instead of on every matchesSearchFilter call.
		const compiled = filter ? compileFilter(filter) : undefined;

		for (const result of results) {
			const file = this.plugin.app.vault.getAbstractFileByPath(result.path);
			const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;
			const docTags = cache ? (getAllTags(cache) ?? []) : [];

			if (!matchesSearchFilter(result.path, docTags, compiled ?? filter)) {
				continue;
			}

			const matchMetadata = this.resolveMatchMetadata(
				query,
				result.path,
				result.name,
				docTags,
				result.content,
				result.features,
				cache,
			);

			filteredResults.push({
				path: result.path,
				name: result.name,
				frontmatter: cache?.frontmatter,
				tags: docTags,
				matchExplanation: matchMetadata.explanation,
				matchBadges: matchMetadata.badges,
				score: result.score,
				rankingDebug: result.features ? { lexicalFeatures: result.features } : undefined,
			});

			if (filteredResults.length >= topK) {
				break;
			}
		}

		return filteredResults;
	}

	private resolveMatchMetadata(
		query: string | undefined,
		path: string,
		noteName: string,
		docTags: string[],
		content: string | undefined,
		features: LexicalSearchResult["features"],
		cache: CachedMetadata | null,
	): ResolvedMatchMetadata {
		if (!query?.trim()) return {};

		const plan = this.buildQueryPlan(query);
		if (!plan || plan.searchTerms.length === 0) return {};

		const badges = new Set<SearchMatchBadge>();
		const hasAliasSignal = hasLexicalAliasSignal(features);
		const hasTagSignal = hasLexicalTagSignal(features);
		const hasTitleSignal = hasLexicalTitleSignal(features);
		const hasPathSignal = hasLexicalPathSignal(features);
		const hasContentSignal = hasLexicalContentSignal(features);

		if (hasTitleSignal) {
			badges.add("title");
		}

		if (hasAliasSignal) {
			badges.add("alias");
		}

		if (hasTagSignal) {
			badges.add("tag");
		}

		if (hasPathSignal) {
			badges.add("path");
		}

		const explanation = this.buildFeatureDrivenExplanation(path, noteName, docTags, content, features, cache, plan);
		if (explanation?.source !== "alias" && explanation?.source !== "tag" && explanation?.source !== "title") {
			badges.add(explanation?.source ?? "content");
		} else if (explanation) {
			badges.add(explanation.source);
		} else if (hasContentSignal) {
			badges.add("content");
		}

		return {
			badges: badges.size > 0 ? Array.from(badges) : undefined,
			explanation,
		};
	}

	private buildFeatureDrivenExplanation(
		path: string,
		noteName: string,
		docTags: string[],
		content: string | undefined,
		features: LexicalSearchResult["features"],
		cache: CachedMetadata | null,
		plan: QueryPlan,
	): SearchMatchExplanation | undefined {
		if (hasLexicalAliasSignal(features)) {
			const aliasMatch = this.findAliasMatch(cache?.frontmatter, plan);
			return { source: "alias", text: aliasMatch ? `Alias: ${aliasMatch}` : "Alias match" };
		}

		if (hasLexicalTagSignal(features)) {
			const tagMatch = this.findTagMatch(docTags, plan);
			return { source: "tag", text: tagMatch ? `Tag: ${tagMatch}` : "Tag match" };
		}

		if (hasLexicalTitleSignal(features)) {
			return { source: "title", text: `Title: ${noteName}` };
		}

		if (hasLexicalContentSignal(features)) {
			const headingMatch = this.findHeadingExplanation(content, cache, plan);
			if (headingMatch) {
				return headingMatch;
			}

			const snippet = this.extractSnippet(content, plan);
			if (snippet) {
				return { source: "content", text: snippet };
			}
		}

		if (hasLexicalPathSignal(features) && this.findPathSegmentMatch(path, plan)) {
			return undefined;
		}

		return undefined;
	}

	private findHeadingExplanation(
		content: string | undefined,
		cache: CachedMetadata | null,
		plan: QueryPlan,
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
			const headingMatchIndex = this.findMatchIndex(headingLine, plan);
			const bodyMatchIndex = this.findMatchIndex(sectionBody, plan);

			if (headingMatchIndex === -1 && bodyMatchIndex === -1) {
				continue;
			}

			const matchedBody = bodyMatchIndex >= 0;
			const snippetSource = matchedBody ? sectionBody : sectionText;
			const snippet = this.extractSnippet(snippetSource, plan) ?? this.cleanSnippetText(heading.heading);
			return {
				source: headingMatchIndex >= 0 ? "heading" : "content",
				heading: heading.heading,
				headingLevel: heading.level,
				text: snippet,
			};
		}

		return undefined;
	}

	private extractSearchTerms(query: string): string[] {
		return extractSearchTerms(query);
	}

	private buildQueryPlan(query: string | undefined): QueryPlan | null {
		if (!query?.trim()) {
			return null;
		}

		return createQueryPlan(query);
	}

	private findMatchIndex(text: string | undefined, plan: QueryPlan): number {
		if (!text) return -1;

		const normalized = text.toLowerCase();
		let firstMatch = -1;
		let matchedTerms = 0;
		const requiredMatches = plan.minimumMatchedTerms;

		for (const term of plan.searchTerms) {
			const index = normalized.indexOf(term);
			if (index !== -1) {
				matchedTerms++;
				if (firstMatch === -1 || index < firstMatch) {
					firstMatch = index;
				}
			}
		}

		return matchedTerms >= requiredMatches ? firstMatch : -1;
	}

	private extractSnippet(content: string | undefined, plan: QueryPlan): string | undefined {
		if (!content) return undefined;

		const normalizedContent = this.stripFrontmatter(content);
		const matchIndex = this.findMatchIndex(normalizedContent, plan);
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

	private findAliasMatch(frontmatter: Record<string, unknown> | undefined, plan: QueryPlan): string | undefined {
		for (const alias of this.extractAliasesFromFrontmatter(frontmatter)) {
			if (this.findMatchIndex(alias, plan) !== -1) {
				return alias;
			}
		}

		return undefined;
	}

	private findTagMatch(tags: string[], plan: QueryPlan): string | undefined {
		for (const tag of tags) {
			const normalizedTag = tag.startsWith("#") ? tag : `#${tag}`;
			if (
				this.findMatchIndex(normalizedTag, plan) !== -1 ||
				this.findMatchIndex(normalizedTag.slice(1), plan) !== -1
			) {
				return normalizedTag;
			}
		}

		return undefined;
	}

	private findPathSegmentMatch(path: string, plan: QueryPlan): string | undefined {
		const segments = path.split("/").slice(0, -1);
		for (const segment of segments) {
			if (this.findMatchIndex(segment, plan) !== -1) {
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
				await pendingInitPromise.catch(() => { });
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
