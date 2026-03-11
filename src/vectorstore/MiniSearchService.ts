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
const DB_VERSION = 1;
const STORE_NAME = "index";
const INDEX_KEY = "main";

export interface LexicalSearchResult {
	path: string;
	name: string;
	score: number;
}

interface IndexedDocument {
	id: string;
	path: string;
	title: string;
	content: string;
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
			fields: ["title", "content"],
			storeFields: ["path", "title"],
			idField: "id",
			searchOptions: {
				boost: { title: 2, content: 1 },
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
				if (data?.json) {
					try {
						this.index = MiniSearch.loadJSON(data.json, {
							fields: ["title", "content"],
							storeFields: ["path", "title"],
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
			const request = store.put({ json, paths }, INDEX_KEY);

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
	addDocument(path: string, title: string, content: string): void {
		// Remove existing document if present
		if (this.documentPaths.has(path)) {
			this.index.discard(path);
		}

		const doc: IndexedDocument = {
			id: path,
			path,
			title,
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
			boost: { title: 2, content: 1 },
			fuzzy: 0.2,
			prefix: true,
		});

		return results.slice(0, limit).map((result: MiniSearchResult) => ({
			path: result.id,
			name:
				(result as MiniSearchResult & { title?: string }).title ||
				result.id.replace(/\.md$/, "").split("/").pop() ||
				result.id,
			score: result.score,
		}));
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
