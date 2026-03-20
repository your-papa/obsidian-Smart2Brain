/**
 * MiniSearch Service
 *
 * Provides BM25 based lexical search using MiniSearch library.
 * Indexes document titles and content for fast full-text search.
 * Persists index to IndexedDB for instant startup.
 */

import MiniSearch, { type SearchResult as MiniSearchResult } from "minisearch";
import { Logger } from "../utils/logging";

import { getDbName } from "./types";

const DB_NAME_PREFIX = "s2b-minisearch";
const DB_VERSION = 4;
const STORE_NAME = "index";
const INDEX_KEY = "main";
const STORAGE_SCHEMA_VERSION = 4;

export interface LexicalSearchResult {
	path: string;
	name: string;
	aliases?: string[];
	tags?: string[];
	content?: string;
	score: number;
}

interface IndexedDocument {
	id: string;
	path: string;
	title: string;
	aliases: string;
	tags: string;
	pathSegments: string;
	content: string;
}

interface RankedLexicalResult {
	result: MiniSearchResult;
	adjustedScore: number;
}

/**
 * Service for full-text lexical search using MiniSearch.
 * Uses BM25 scoring with field boosting (title 2x, content 1x).
 */
export class MiniSearchService {
	private index: MiniSearch<IndexedDocument>;
	private db: IDBDatabase | null = null;
	private isDirty = false;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;
	private documentPaths = new Set<string>();
	private readonly dbName: string;

	constructor(vaultId: string, indexId?: string) {
		this.dbName = getDbName(DB_NAME_PREFIX, vaultId, indexId);
		this.index = this.createIndex();
	}

	/**
	 * Create a new MiniSearch index with configured options.
	 */
	private createIndex(): MiniSearch<IndexedDocument> {
		return new MiniSearch<IndexedDocument>({
			fields: ["title", "aliases", "tags", "pathSegments", "content"],
			storeFields: ["path", "title", "aliases", "tags", "pathSegments", "content"],
			idField: "id",
			searchOptions: {
				boost: { title: 2, aliases: 1.8, tags: 1.5, pathSegments: 1.2, content: 1 },
				fuzzy: 0.2,
				prefix: true,
			},
			// Simple tokenizer: split on whitespace/punctuation
			tokenize: (text) => {
				return text
					.toLowerCase()
					.split(/[\s\-_.,;:!?'"()\[\]{}<>]+/)
					.filter((token) => token.length > 1);
			},
		});
	}

	/**
	 * Open the IndexedDB database for persistence.
	 */
	async open(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, DB_VERSION);

			request.onerror = () => {
				Logger.error("[MiniSearch] Failed to open database:", request.error);
				reject(request.error);
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME);
				}
			};
		});
	}

	/**
	 * Load the index from IndexedDB.
	 * @returns true if index was loaded, false if no stored index exists
	 */
	async loadFromStorage(): Promise<boolean> {
		const db = this.db;
		if (!db) {
			Logger.warn("[MiniSearch] Database not open, cannot load index");
			return false;
		}

		return new Promise((resolve) => {
			const transaction = db.transaction(STORE_NAME, "readonly");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(INDEX_KEY);

			request.onsuccess = () => {
				const data = request.result;
				if (data?.json && data.schemaVersion === STORAGE_SCHEMA_VERSION) {
					try {
						this.index = MiniSearch.loadJSON(data.json, {
							fields: ["title", "aliases", "tags", "pathSegments", "content"],
							storeFields: ["path", "title", "aliases", "tags", "pathSegments", "content"],
							idField: "id",
						});
						// Rebuild paths set
						this.documentPaths.clear();
						if (data.paths && Array.isArray(data.paths)) {
							for (const path of data.paths) {
								this.documentPaths.add(path);
							}
						}
						Logger.log(`[MiniSearch] Loaded index with ${this.documentPaths.size} documents`);
						resolve(true);
					} catch (error) {
						Logger.error("[MiniSearch] Failed to deserialize index:", error);
						this.index = this.createIndex();
						resolve(false);
					}
				} else {
					resolve(false);
				}
			};

			request.onerror = () => {
				Logger.error("[MiniSearch] Failed to load index:", request.error);
				resolve(false);
			};
		});
	}

	/**
	 * Save the index to IndexedDB.
	 */
	async saveToStorage(): Promise<void> {
		const db = this.db;
		if (!db) {
			Logger.warn("[MiniSearch] Database not open, cannot save index");
			return;
		}

		const json = JSON.stringify(this.index);
		const paths = Array.from(this.documentPaths);

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.put({ json, paths, schemaVersion: STORAGE_SCHEMA_VERSION }, INDEX_KEY);

			request.onsuccess = () => {
				this.isDirty = false;
				Logger.log(`[MiniSearch] Saved index with ${this.documentPaths.size} documents`);
				resolve();
			};

			request.onerror = () => {
				Logger.error("[MiniSearch] Failed to save index:", request.error);
				reject(request.error);
			};
		});
	}

	/**
	 * Schedule a debounced save operation.
	 */
	private scheduleSave(): void {
		this.isDirty = true;

		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}

		this.saveTimeout = setTimeout(
			() => void this.saveToStorage().catch((e) => Logger.error("[MiniSearch] Scheduled save failed:", e)),
			5000, // 5 second debounce
		);
	}

	/**
	 * Flush any pending saves immediately.
	 */
	async flush(): Promise<void> {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}

		if (this.isDirty) {
			await this.saveToStorage();
		}
	}

	/**
	 * Add or update a document in the index.
	 * @param path File path (used as unique ID)
	 * @param title Document title (filename without extension)
	 * @param content Document content
	 */
	addDocument(path: string, title: string, content: string, tags: string[] = []): void {
		// Remove existing document if present
		if (this.documentPaths.has(path)) {
			this.index.discard(path);
		}

		const aliases = this.extractAliases(content);
		const doc: IndexedDocument = {
			id: path,
			path,
			title,
			aliases: aliases.join("\n"),
			tags: this.normalizeStoredTags(tags).join("\n"),
			pathSegments: this.extractPathSegments(path).join("\n"),
			content,
		};

		this.index.add(doc);
		this.documentPaths.add(path);
		this.scheduleSave();
	}

	/**
	 * Remove a document from the index.
	 * @param path File path to remove
	 */
	removeDocument(path: string): void {
		if (this.documentPaths.has(path)) {
			this.index.discard(path);
			this.documentPaths.delete(path);
			this.scheduleSave();
		}
	}

	/**
	 * Check if a document exists in the index.
	 */
	hasDocument(path: string): boolean {
		return this.documentPaths.has(path);
	}

	/**
	 * Get the number of indexed documents.
	 */
	get documentCount(): number {
		return this.documentPaths.size;
	}

	/**
	 * Clear all documents from the index.
	 */
	clear(): void {
		this.index = this.createIndex();
		this.documentPaths.clear();
		this.scheduleSave();
	}

	/**
	 * Search for documents matching the query.
	 * @param query Search query
	 * @param limit Maximum results to return
	 * @returns Ranked search results with scores
	 */
	search(query: string, limit = 20): LexicalSearchResult[] {
		if (!query.trim()) {
			return [];
		}

		const results = this.index.search(query, {
			boost: { title: 2, aliases: 1.8, tags: 1.5, pathSegments: 1.2, content: 1 },
			fuzzy: 0.2,
			prefix: true,
		});

		const rankedResults = results
			.map((result): RankedLexicalResult => {
				const title =
					(result as MiniSearchResult & { title?: string }).title ||
					result.id.replace(/\.md$/, "").split("/").pop() ||
					result.id;
				const aliases = this.parseStoredAliases((result as MiniSearchResult & { aliases?: string }).aliases);
				const tags = this.parseStoredList((result as MiniSearchResult & { tags?: string }).tags);
				const pathSegments = this.parseStoredList(
					(result as MiniSearchResult & { pathSegments?: string }).pathSegments,
				);

				return {
					result,
					adjustedScore:
						result.score +
						this.calculateTitleBoost(query, title) +
						this.calculateAliasBoost(query, aliases) +
						this.calculateTagBoost(query, tags) +
						this.calculatePathBoost(query, pathSegments),
				};
			})
			.sort((left, right) => right.adjustedScore - left.adjustedScore);

		return rankedResults.slice(0, limit).map(({ result, adjustedScore }) => ({
			path: result.id,
			name:
				(result as MiniSearchResult & { title?: string }).title ||
				result.id.replace(/\.md$/, "").split("/").pop() ||
				result.id,
			aliases: this.parseStoredAliases((result as MiniSearchResult & { aliases?: string }).aliases),
			tags: this.parseStoredList((result as MiniSearchResult & { tags?: string }).tags),
			content: (result as MiniSearchResult & { content?: string }).content,
			score: adjustedScore,
		}));
	}

	private calculateTagBoost(query: string, tags: string[]): number {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery || tags.length === 0) {
			return 0;
		}

		let bestBoost = 0;
		for (const tag of tags) {
			const normalizedTag = tag.replace(/^#/, "").trim().toLowerCase();
			if (!normalizedTag) continue;

			if (normalizedTag === normalizedQuery) {
				bestBoost = Math.max(bestBoost, 55);
				continue;
			}

			if (normalizedTag.startsWith(normalizedQuery)) {
				bestBoost = Math.max(bestBoost, 22);
				continue;
			}

			if (normalizedTag.includes(normalizedQuery)) {
				bestBoost = Math.max(bestBoost, 14);
			}
		}

		return bestBoost;
	}

	private calculatePathBoost(query: string, pathSegments: string[]): number {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery || pathSegments.length === 0) {
			return 0;
		}

		let bestBoost = 0;
		for (const segment of pathSegments) {
			const normalizedSegment = segment.trim().toLowerCase();
			if (!normalizedSegment) continue;

			if (normalizedSegment === normalizedQuery) {
				bestBoost = Math.max(bestBoost, 35);
				continue;
			}

			if (normalizedSegment.startsWith(normalizedQuery)) {
				bestBoost = Math.max(bestBoost, 16);
				continue;
			}

			if (normalizedSegment.includes(normalizedQuery)) {
				bestBoost = Math.max(bestBoost, 9);
			}
		}

		return bestBoost;
	}

	private calculateAliasBoost(query: string, aliases: string[]): number {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery || aliases.length === 0) {
			return 0;
		}

		let bestBoost = 0;
		for (const alias of aliases) {
			const normalizedAlias = alias.trim().toLowerCase();
			if (!normalizedAlias) continue;

			if (normalizedAlias === normalizedQuery) {
				bestBoost = Math.max(bestBoost, 70);
				continue;
			}

			if (normalizedAlias.startsWith(normalizedQuery)) {
				bestBoost = Math.max(bestBoost, 28);
				continue;
			}

			if (normalizedAlias.includes(normalizedQuery)) {
				bestBoost = Math.max(bestBoost, 18);
			}
		}

		return bestBoost;
	}

	private calculateTitleBoost(query: string, title: string): number {
		const normalizedQuery = query.trim().toLowerCase();
		const normalizedTitle = title.trim().toLowerCase();
		const queryTerms = this.extractQueryTerms(normalizedQuery);

		if (!normalizedQuery || !normalizedTitle || queryTerms.length === 0) {
			return 0;
		}

		if (normalizedTitle === normalizedQuery) {
			return 100;
		}

		if (normalizedTitle.startsWith(normalizedQuery)) {
			return 40;
		}

		if (normalizedTitle.includes(normalizedQuery)) {
			return 25;
		}

		const matchingTerms = queryTerms.filter((term) => normalizedTitle.includes(term));
		if (matchingTerms.length === 0) {
			return 0;
		}

		if (matchingTerms.length === queryTerms.length) {
			return 15;
		}

		return (matchingTerms.length / queryTerms.length) * 8;
	}

	private extractQueryTerms(query: string): string[] {
		return Array.from(
			new Set(
				query
					.split(/[\s\-_.,;:!?'"()\[\]{}<>]+/)
					.map((term) => term.trim())
					.filter((term) => term.length > 1),
			),
		);
	}

	private extractAliases(content: string): string[] {
		const frontmatter = this.extractFrontmatter(content);
		if (!frontmatter) {
			return [];
		}

		const aliases: string[] = [];
		const lines = frontmatter.split(/\r?\n/);

		for (let index = 0; index < lines.length; index++) {
			const match = lines[index].match(/^\s*(aliases?|alias):\s*(.*)$/i);
			if (!match) continue;

			const remainder = match[2].trim();
			if (remainder.startsWith("[") && remainder.endsWith("]")) {
				for (const value of remainder.slice(1, -1).split(",")) {
					const alias = value.trim().replace(/^['"]|['"]$/g, "");
					if (alias) aliases.push(alias);
				}
				continue;
			}

			if (remainder) {
				const alias = remainder.replace(/^['"]|['"]$/g, "");
				if (alias) aliases.push(alias);
				continue;
			}

			for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
				const itemMatch = lines[nextIndex].match(/^\s*-\s*(.+)$/);
				if (!itemMatch) break;
				const alias = itemMatch[1].trim().replace(/^['"]|['"]$/g, "");
				if (alias) aliases.push(alias);
				index = nextIndex;
			}
		}

		return Array.from(new Set(aliases));
	}

	private extractPathSegments(path: string): string[] {
		const segments = path
			.split("/")
			.slice(0, -1)
			.map((segment) => segment.trim())
			.filter((segment) => segment.length > 0);

		return Array.from(new Set(segments));
	}

	private extractFrontmatter(content: string): string | undefined {
		if (!content.startsWith("---\n")) {
			return undefined;
		}

		const endOfFrontmatter = content.indexOf("\n---\n", 4);
		if (endOfFrontmatter === -1) {
			return undefined;
		}

		return content.slice(4, endOfFrontmatter);
	}

	private parseStoredAliases(rawAliases: string | undefined): string[] {
		return this.parseStoredList(rawAliases);
	}

	private parseStoredList(rawValue: string | undefined): string[] {
		if (!rawValue?.trim()) {
			return [];
		}

		return rawValue
			.split(/\r?\n/)
			.map((value) => value.trim())
			.filter((value) => value.length > 0);
	}

	private normalizeStoredTags(tags: string[]): string[] {
		return Array.from(
			new Set(
				tags
					.map((tag) => tag.replace(/^#/, ""))
					.map((tag) => tag.trim())
					.filter((tag) => tag.length > 1),
			),
		);
	}

	/**
	 * Browse all indexed documents (for filter-only queries).
	 * Returns documents sorted alphabetically by path.
	 * @param limit Maximum results to return
	 * @returns All document paths and names
	 */
	browse(limit = 100): LexicalSearchResult[] {
		const paths = Array.from(this.documentPaths).sort();
		return paths.slice(0, limit).map((path) => ({
			path,
			name: path.replace(/\.md$/, "").split("/").pop() || path,
			score: 1,
		}));
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}
