import { Notice, Platform, TFile, getAllTags, type CachedMetadata } from "obsidian";
import type SecondBrainPlugin from "../main";
import { compileFilter, matchesPathFilter, matchesSearchFilter } from "../search/searchFilters";
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
import { StartupProfiler } from "../utils/startupProfiler";
import {
	getIndexableVaultFiles,
	isBinaryTextFile,
	isIndexableFile,
	readIndexableContent,
} from "../utils/fileFiltering";
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
			await StartupProfiler.measure("lexical:miniSearch.open", () => this.miniSearch.open());
			const loaded = await StartupProfiler.measure("lexical:loadFromStorage", () =>
				this.miniSearch.loadFromStorage(),
			);
			// Size metrics: whether slowness scales with index/vault size.
			StartupProfiler.setMeta("lexicalIndexDocs", this.miniSearch.documentCount);
			StartupProfiler.setMeta("lexicalIndexBytes", this.miniSearch.lastLoadedBytes);
			StartupProfiler.setMeta("lexicalIndexLoadedFromCache", loaded);
			try {
				StartupProfiler.setMeta("vaultFileCount", this.plugin.app.vault.getFiles().length);
			} catch {
				// getFiles can throw if the vault metadata cache isn't ready; non-fatal.
			}
			if (loaded) {
				this.plugin.app.workspace.onLayoutReady(() => {
					this.scheduleBulkRun(() => this.validateIndex());
				});
			} else {
				this.plugin.app.workspace.onLayoutReady(() => {
					this.scheduleBulkRun(() => this.buildIndex());
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

	/**
	 * Over-fetch factor when a filter is present, so that filtering still leaves
	 * enough survivors to fill `topK`.
	 *
	 * Only a heuristic: a filter selecting a rare tag can still exhaust it. The
	 * `browse` path does not rely on this at all — it filters before limiting,
	 * which is exact — but ranked search has no way to know a document's tags
	 * without reading its cache, so it over-fetches and filters afterwards.
	 */
	private static readonly FILTERED_OVERFETCH = 10;

	async search(query: string, topK: number, filter?: SearchFilter): Promise<VectorSearchResult[]> {
		const limit = filter ? topK * LexicalSearchService.FILTERED_OVERFETCH : topK;
		const results = this.miniSearch.search(query, limit);
		return this.applyFilter(results, topK, filter, query);
	}

	async browse(topK: number, filter?: SearchFilter): Promise<VectorSearchResult[]> {
		// Push the path predicate *into* the browse so it filters before slicing.
		// Browsing is ordered by path, so post-filtering a sliced list only ever
		// sees the alphabetically-earliest candidates — which silently returned
		// 18 of a 77-note folder. Tag constraints still resolve in applyFilter,
		// which has the metadata cache; this pre-filter is path-only and
		// deliberately permissive.
		const compiled = filter ? compileFilter(filter) : undefined;
		// A tag constraint is still applied after the fact (tags need the metadata
		// cache), so leave headroom for it; a path-only filter is already exact and
		// needs none.
		const limit = filter?.tags?.length ? topK * LexicalSearchService.FILTERED_OVERFETCH : topK;
		const results = this.miniSearch.browse(
			limit,
			compiled ? (path) => matchesPathFilter(path, compiled) : undefined,
		);
		return this.applyFilter(results, topK, filter);
	}

	getAutocompleteCache(): AutocompleteCacheSnapshot {
		return this.miniSearch.getAutocompleteCache();
	}

	/**
	 * How many documents a bulk run indexes between IndexedDB checkpoints.
	 *
	 * Each checkpoint serializes the whole index, so the interval trades save cost
	 * against how much progress a crash can lose. On mobile the process can be
	 * killed by the OS mid-build; a checkpoint every few hundred documents lets the
	 * next boot's validateIndex resume roughly where this run died instead of
	 * starting over.
	 */
	private static readonly BULK_CHECKPOINT_INTERVAL = 250;

	/** Files indexed between pacing pauses during a bulk run. */
	private static readonly BULK_BATCH_SIZE = 25;

	/**
	 * Pause between bulk batches, and after each checkpoint.
	 *
	 * Tokenizing text files back-to-back allocates garbage faster than the mobile
	 * WebView's GC reclaims it, so an unthrottled loop balloons the footprint until
	 * the OS kills the process — measured as a reload every ~10 s on a large vault.
	 * (PDF extraction used to throttle the loop by accident; ordering PDFs last
	 * removed that brake.) Real pauses give the collector room to keep up. Desktop
	 * has no memory ceiling and only yields the event loop.
	 */
	private static readonly BULK_BATCH_PAUSE_MS = Platform.isMobile ? 100 : 0;

	/** Extra pause after a checkpoint's full-index serialization, for the same reason. */
	private static readonly BULK_CHECKPOINT_PAUSE_MS = Platform.isMobile ? 250 : 0;

	/**
	 * How long after layout-ready a bulk run may start on mobile, before backoff.
	 *
	 * Boot is the highest-pressure window — the vault, the metadata cache, and
	 * every plugin allocate at once, and the OS kill ceiling is effectively lower
	 * because of it. Starting the indexer into that spike is what turned one kill
	 * into a kill loop: each reload restarted indexing at second zero and died
	 * again. Waiting lets the boot spike drain first; steady state idles at ~2% CPU.
	 */
	private static readonly MOBILE_BULK_BASE_DELAY_MS = 15_000;

	/** Upper bound for the crash-backoff delay. */
	private static readonly MOBILE_BULK_MAX_DELAY_MS = 300_000;

	private static bulkPause(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * How boot pressure varies is unknowable from inside the WebView (there is no
	 * JS memory-pressure API), so no fixed delay can be right on every device: 15 s
	 * was measured to land inside the boot spike on a phone already under system
	 * pressure, where the OS killed the process seconds into the run. Instead the
	 * delay adapts to observed deaths: every bulk attempt writes this marker and a
	 * completed run clears it, so a marker still present at boot means the last
	 * attempt died mid-run — and the next one waits twice as long. localStorage,
	 * not plugin data: it survives the kill (the plugin's data debounce may not)
	 * and stays out of sync.
	 */
	private bulkAttemptKey(): string {
		return `s2b-lexical-bulk-attempts:${this.vaultId}`;
	}

	private readCrashedBulkAttempts(): number {
		const raw = Number(window.localStorage.getItem(this.bulkAttemptKey()));
		return Number.isFinite(raw) && raw > 0 ? raw : 0;
	}

	/** Run `work` after the platform-appropriate bulk start delay. */
	private scheduleBulkRun(work: () => Promise<void>): void {
		const attempts = this.readCrashedBulkAttempts();
		const delay = Platform.isMobile
			? Math.min(
					LexicalSearchService.MOBILE_BULK_BASE_DELAY_MS * 2 ** attempts,
					LexicalSearchService.MOBILE_BULK_MAX_DELAY_MS,
				)
			: 0;
		if (attempts > 0) {
			Logger.warn(
				`[LexicalSearch] Last bulk index attempt did not complete (${attempts} in a row) — delaying the next by ${Math.round(delay / 1000)}s`,
			);
		}
		window.setTimeout(() => void work(), delay);
	}

	/**
	 * Bulk-indexing file order: cheap text files first, binary-extraction files
	 * (PDFs) last. PDF text extraction is minutes of work on a large vault, and
	 * putting it first held the whole searchable corpus hostage to it — this way
	 * every note is searchable early even if the PDF tail never finishes.
	 */
	private static orderForBulkIndexing(files: TFile[]): TFile[] {
		return [...files].sort((a, b) => Number(isBinaryTextFile(a)) - Number(isBinaryTextFile(b)));
	}

	/** Index `files`, paced in batches and checkpointing every {@link BULK_CHECKPOINT_INTERVAL} additions. */
	/**
	 * Runs below this size stay silent: routine validateIndex catch-ups (a few
	 * changed notes) shouldn't flash a progress notice on every boot.
	 */
	private static readonly PROGRESS_NOTICE_MIN_FILES = 100;

	private async bulkIndexFiles(files: TFile[]): Promise<number> {
		const { vault } = this.plugin.app;
		let added = 0;
		let processed = 0;
		// Mark the attempt before the first read; cleared below only when the whole
		// run survives. See bulkAttemptKey for why this drives the start backoff.
		window.localStorage.setItem(this.bulkAttemptKey(), String(this.readCrashedBulkAttempts() + 1));
		const notice = files.length >= LexicalSearchService.PROGRESS_NOTICE_MIN_FILES ? new Notice("", 0) : null;
		if (notice) this.updateProgressNotice(notice, 0, files.length);
		this.miniSearch.suspendScheduledSaves();
		try {
			for (const file of files) {
				try {
					const content = await readIndexableContent(vault, file);
					this.miniSearch.addDocument(file.path, file.basename, content, this.getSearchableTags(file));
					added++;
				} catch (error) {
					Logger.error(`[LexicalSearch] Failed to read ${file.path}:`, error);
				}
				processed++;

				if (added > 0 && added % LexicalSearchService.BULK_CHECKPOINT_INTERVAL === 0) {
					await this.miniSearch.flush();
					await LexicalSearchService.bulkPause(LexicalSearchService.BULK_CHECKPOINT_PAUSE_MS);
				} else if (processed % LexicalSearchService.BULK_BATCH_SIZE === 0) {
					await LexicalSearchService.bulkPause(LexicalSearchService.BULK_BATCH_PAUSE_MS);
				}
				if (notice && processed % LexicalSearchService.BULK_BATCH_SIZE === 0) {
					this.updateProgressNotice(notice, processed, files.length);
				}
			}
			await this.miniSearch.flush();
			window.localStorage.removeItem(this.bulkAttemptKey());
			if (notice) {
				notice.setMessage(`✓ Search index updated: ${added} notes`);
				setTimeout(() => notice.hide(), 3000);
			}
		} catch (error) {
			// An unexpected abort (not a per-file failure) — don't leave a stuck
			// notice behind on top of whatever surfaced the error.
			notice?.hide();
			throw error;
		} finally {
			this.miniSearch.resumeScheduledSaves();
		}
		return added;
	}

	/**
	 * Render bulk progress into the sticky notice. Same layout as the embedding
	 * indexer's notice (VectorStoreService.updateNotice) so the two indexing
	 * surfaces read as one feature.
	 */
	private updateProgressNotice(notice: Notice, processed: number, total: number): void {
		const percentage = total > 0 ? Math.round((processed / total) * 100) : 100;

		const el = notice.noticeEl;
		el.empty();
		const container = el.createDiv({ cls: "s2b-indexing-notice" });
		container.createDiv({
			cls: "s2b-indexing-status",
			text: `Indexing notes for search: ${processed}/${total}`,
		});

		const progressContainer = container.createDiv({ cls: "s2b-indexing-progress" });
		progressContainer.style.cssText =
			"width: 100%; height: 6px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden; margin: 8px 0;";
		const progressFill = progressContainer.createDiv({ cls: "s2b-indexing-fill" });
		progressFill.style.cssText = `width: ${percentage}%; height: 100%; background: var(--interactive-accent); border-radius: 3px; transition: width 0.2s ease;`;

		container.createDiv({ cls: "s2b-indexing-percent", text: `${percentage}%` });
	}

	private async buildIndex(): Promise<void> {
		await StartupProfiler.logDuration("lexical:buildIndex", async () => {
			const files = LexicalSearchService.orderForBulkIndexing(getIndexableVaultFiles(this.plugin.app.vault));
			await this.bulkIndexFiles(files);
			Logger.log(`[LexicalSearch] Built lexical index: ${this.miniSearch.documentCount} documents`);
		});
	}

	private async validateIndex(): Promise<void> {
		const files = getIndexableVaultFiles(this.plugin.app.vault);
		const vaultPaths = new Set(files.map((f) => f.path));

		let removed = 0;
		for (const indexedPath of this.miniSearch.getDocumentPaths()) {
			if (!vaultPaths.has(indexedPath)) {
				this.miniSearch.removeDocument(indexedPath);
				removed++;
			}
		}

		const missing = LexicalSearchService.orderForBulkIndexing(
			files.filter((file) => !this.miniSearch.hasDocument(file.path)),
		);
		const added = await this.bulkIndexFiles(missing);

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
				if (!(file instanceof TFile)) return;
				// Note the guard is *inside* handleFileRename, not here: renaming a
				// note to a non-indexable extension (`note.md` → `note.base`) must
				// still drop the old entry. Gating on the post-rename file skipped
				// the removal and left a stale, still-searchable document behind.
				await this.handleFileRename(file, oldPath);
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
		// Always drop the old path, even when the destination is no longer
		// indexable — otherwise the pre-rename document stays searchable forever.
		this.miniSearch.removeDocument(oldPath);

		if (!isIndexableFile(file)) return;

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

	private async applyFilter(
		results: LexicalSearchResult[],
		topK: number,
		filter?: SearchFilter,
		query?: string,
	): Promise<VectorSearchResult[]> {
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

			// Only the results that survive the filter — at most topK of them — pay
			// for a file read, and only when there is a query to explain.
			const content =
				query?.trim() && file instanceof TFile ? await this.readExplanationContent(file) : undefined;

			const matchMetadata = this.resolveMatchMetadata(
				query,
				result.path,
				result.name,
				docTags,
				content,
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

	/**
	 * Largest file worth reading back for a snippet, in bytes. Files above the
	 * mobile indexing gate are title-indexed and so still appear in results —
	 * without this bound, explaining such a match would re-read the very file
	 * indexing skipped for memory safety.
	 */
	private static readonly EXPLANATION_MAX_FILE_BYTES = 1_000_000;

	/**
	 * Content for match explanations, read on demand. The index no longer stores
	 * document text (see MiniSearchService storeFields), so snippets come from the
	 * live file. Plain markdown only: binary formats (PDF) would need a full
	 * re-extraction for a one-line snippet, and Excalidraw's raw JSON never matches
	 * what was indexed — both fall back to badge-only explanations.
	 */
	private async readExplanationContent(file: TFile): Promise<string | undefined> {
		if (file.extension !== "md" || file.path.toLowerCase().endsWith(".excalidraw.md")) {
			return undefined;
		}
		if (file.stat.size > LexicalSearchService.EXPLANATION_MAX_FILE_BYTES) {
			return undefined;
		}
		try {
			return await this.plugin.app.vault.cachedRead(file);
		} catch {
			return undefined;
		}
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
