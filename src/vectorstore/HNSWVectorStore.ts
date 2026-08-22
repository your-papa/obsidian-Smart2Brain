/**
 * HNSW Vector Store
 *
 * IndexedDB-backed vector storage with HNSW (Hierarchical Navigable Small World) index.
 * Provides O(log n) approximate nearest neighbor search instead of O(n) brute-force.
 *
 * Uses the `hnsw` npm package which is pure TypeScript (no native bindings).
 * Stores both the HNSW index and document metadata in IndexedDB.
 *
 * Note: The HNSW library uses numeric IDs internally, so we maintain a mapping
 * between string document IDs and numeric HNSW IDs.
 */

import { HNSWWithDB } from "hnsw";
import {
	type DocumentVector,
	type IndexMetadata,
	type ScoredDocument,
	type SerializedDocument,
	type VectorStore,
} from "./types";
import { cosineSimilarity, toFloat32Array, toNumberArray } from "./similarity";

import { getDbName } from "./types";
import { Logger } from "../utils/logging";

const LOG_PREFIX = "[VectorStore] [HNSW]";

const DB_NAME_PREFIX = "s2b-hnsw";
const DOCUMENTS_STORE = "documents";
const METADATA_STORE = "metadata";
const ID_MAPPING_STORE = "id_mapping";
const DB_VERSION = 2; // Bumped for ID mapping store

/**
 * How long to wait on a blocked `indexedDB.open` before failing with a real error.
 * A blocked open fires neither `success` nor `error`, so without a bound it hangs
 * forever. Generous enough that the normal case — the other connection yielding via
 * its `versionchange` handler — always wins the race.
 */
const OPEN_BLOCKED_TIMEOUT_MS = 10_000;

/**
 * Internal representation stored in IndexedDB.
 * Uses number[] since IndexedDB doesn't efficiently store Float32Array.
 */
interface StoredDocument {
	id: string;
	path: string;
	mtime: number;
	checksum: string;
	vector: number[];
	chunkIndex?: number;
	/** Numeric ID for HNSW index */
	hnswId: number;
}

/**
 * Metadata stored in IndexedDB to track index state.
 */
interface StoredMetadata {
	key: "metadata";
	version: number;
	providerId: string;
	modelId: string;
	lastUpdated: number;
	dimensions: number;
	nextHnswId: number;
}

/**
 * ID mapping entry for HNSW numeric IDs.
 */
interface IdMapping {
	numericId: number;
	stringId: string;
}

/**
 * Runs a single read request inside `tx` and settles a promise on it, covering the
 * transaction-level failures a bare `request.onerror` misses.
 *
 * An IndexedDB transaction can abort without ever firing `error` on its request —
 * the connection being force-closed (which our `versionchange` handler now does),
 * storage eviction, or the browser tearing the tx down. In those cases only
 * `tx.onabort` fires, so a promise wired solely to `request.onerror`/`onsuccess`
 * never settles and its caller hangs indefinitely with no error surfaced.
 *
 * For the read paths only; the write paths already settle on `tx.oncomplete` /
 * `tx.onerror`, which covers them. `map` turns the raw request result into the
 * caller's shape, and may be called more than once for cursor-driven reads —
 * return a value only when the read is complete (see `awaitCursor`).
 */
function awaitRequest<T>(tx: IDBTransaction, request: IDBRequest, map: (result: never) => T): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const fail = (reason: unknown) => {
			if (settled) return;
			settled = true;
			reject(reason);
		};

		request.onerror = () => fail(request.error);
		tx.onerror = () => fail(tx.error);
		tx.onabort = () => fail(tx.error ?? new Error("IndexedDB transaction aborted before the request completed."));
		request.onsuccess = () => {
			if (settled) return;
			settled = true;
			try {
				resolve(map(request.result as never));
			} catch (error) {
				reject(error);
			}
		};
	});
}

/**
 * Cursor variant of {@link awaitRequest}: `step` runs on every `onsuccess` and
 * resolves the promise by returning a value once the cursor is exhausted
 * (returning `undefined` keeps iterating). Same transaction-abort guards.
 */
function awaitCursor<T>(
	tx: IDBTransaction,
	request: IDBRequest,
	step: (cursor: IDBCursor | null) => { done: true; value: T } | undefined,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const fail = (reason: unknown) => {
			if (settled) return;
			settled = true;
			reject(reason);
		};

		request.onerror = () => fail(request.error);
		tx.onerror = () => fail(tx.error);
		tx.onabort = () => fail(tx.error ?? new Error("IndexedDB transaction aborted before the cursor completed."));
		request.onsuccess = () => {
			if (settled) return;
			try {
				const outcome = step((request.result as IDBCursor | null) ?? null);
				if (outcome) {
					settled = true;
					resolve(outcome.value);
				}
			} catch (error) {
				fail(error);
			}
		};
	});
}

/**
 * HNSW-backed vector store with O(log n) search complexity.
 * Uses pure TypeScript HNSW implementation with IndexedDB persistence.
 */
export class HNSWVectorStore implements VectorStore {
	private db: IDBDatabase | null = null;
	private hnswIndex: HNSWWithDB | null = null;
	private _providerId: string | null = null;
	private _modelId: string | null = null;
	private dimensions: number | null = null;
	private nextHnswId = 0;
	private readonly dbName: string;

	/**
	 * Debounced HNSW graph flush for the incremental path. `upsert` mutates the
	 * in-memory graph but, without this, only `close()`/`bulkPut` ever persisted
	 * it — so a force-quit between full rebuilds lost every incrementally-added
	 * point from the persisted graph (their doc rows/id-mappings survived in IDB,
	 * so search silently returned stale results with no error). Coalesce rapid
	 * edits into one save; `close()` cancels this and does a final synchronous
	 * flush.
	 *
	 * A plain timer (not obsidian's `debounce`) because this module also runs
	 * inside the HNSW Web Worker, where the `obsidian` package can't be resolved.
	 */
	private static readonly SAVE_DEBOUNCE_MS = 2000;
	private hasPendingIndexSave = false;
	private saveIndexTimer: ReturnType<typeof setTimeout> | null = null;

	private scheduleIndexSave(): void {
		if (this.saveIndexTimer !== null) clearTimeout(this.saveIndexTimer);
		this.saveIndexTimer = setTimeout(() => {
			this.saveIndexTimer = null;
			void this.flushIndex();
		}, HNSWVectorStore.SAVE_DEBOUNCE_MS);
	}

	// ID mappings (string ID <-> numeric HNSW ID)
	private idToNumeric: Map<string, number> = new Map();
	private numericToId: Map<number, string> = new Map();

	// HNSW parameters
	private readonly M = 16; // Number of connections per node
	private readonly efConstruction = 100; // Construction time accuracy (100 is sufficient for <10k docs)
	private readonly efSearch = 100; // Search time accuracy

	constructor(vaultId: string, indexId?: string) {
		this.dbName = getDbName(DB_NAME_PREFIX, vaultId, indexId);
	}

	/**
	 * Open the database connection and initialize HNSW index.
	 */
	async open(): Promise<void> {
		await this.openIndexedDB();

		// Load ID mappings
		await this.loadIdMappings();

		// Load metadata to get dimensions
		const meta = await this.getMetadataInternal();
		if (meta?.dimensions) {
			this.dimensions = meta.dimensions;
			this._providerId = meta.providerId;
			this._modelId = meta.modelId;
			this.nextHnswId = meta.nextHnswId ?? this.idToNumeric.size;
		}
	}

	private async openIndexedDB(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, DB_VERSION);
			let settled = false;
			let blockedTimer: ReturnType<typeof setTimeout> | null = null;

			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				if (blockedTimer !== null) clearTimeout(blockedTimer);
				fn();
			};

			request.onerror = () => finish(() => reject(request.error));

			// The DB name is per-vault, so a second Obsidian window on the same vault
			// opens the *same* database. When this open needs a version upgrade and
			// that other connection is still open, IndexedDB fires `blocked` and then
			// fires NEITHER `success` NOR `error` — the promise would hang forever, and
			// with it the whole VectorStoreService init, with no error surfaced anywhere.
			//
			// The other window normally yields via the `versionchange` handler installed
			// below (added in the same change), so `blocked` should resolve on its own
			// within a moment. Time-bounded rather than rejecting immediately so that
			// normal case still succeeds; if the wait elapses, fail loudly with an
			// actionable message instead of hanging.
			request.onblocked = () => {
				Logger.warn(
					`${LOG_PREFIX} open blocked on "${this.dbName}" — another connection is still open (a second Obsidian window on this vault?). Waiting ${OPEN_BLOCKED_TIMEOUT_MS}ms for it to close.`,
				);
				if (blockedTimer !== null) clearTimeout(blockedTimer);
				blockedTimer = setTimeout(() => {
					finish(() =>
						reject(
							new Error(
								`Timed out opening the vector index database "${this.dbName}": another Obsidian window has it open with an older version. Close the other window and reload.`,
							),
						),
					);
				}, OPEN_BLOCKED_TIMEOUT_MS);
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Create documents store with indexes
				if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
					const docStore = db.createObjectStore(DOCUMENTS_STORE, {
						keyPath: "id",
					});
					docStore.createIndex("path", "path", { unique: false });
					docStore.createIndex("mtime", "mtime", { unique: false });
				}

				// Create metadata store
				if (!db.objectStoreNames.contains(METADATA_STORE)) {
					db.createObjectStore(METADATA_STORE, { keyPath: "key" });
				}

				// Create ID mapping store
				if (!db.objectStoreNames.contains(ID_MAPPING_STORE)) {
					db.createObjectStore(ID_MAPPING_STORE, { keyPath: "numericId" });
				}
			};

			request.onsuccess = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				// The other half of the deadlock: if a *future* connection (another
				// window, or this plugin after an update) needs a version upgrade, it
				// blocks until every existing connection closes. Without this handler
				// we would be the connection that never yields, hanging the other side
				// exactly the way `onblocked` above guards against.
				db.onversionchange = () => {
					Logger.warn(
						`${LOG_PREFIX} another connection requested a version upgrade of "${this.dbName}" — closing ours to let it proceed.`,
					);
					db.close();
					if (this.db === db) this.db = null;
				};
				finish(() => {
					this.db = db;
					resolve();
				});
			};
		});
	}

	private async loadIdMappings(): Promise<void> {
		if (!this.db) return;
		const db = this.db;

		const tx = db.transaction(ID_MAPPING_STORE, "readonly");
		const request = tx.objectStore(ID_MAPPING_STORE).getAll();
		return awaitRequest<void>(tx, request, (mappings: IdMapping[]) => {
			this.idToNumeric.clear();
			this.numericToId.clear();
			for (const mapping of mappings) {
				this.idToNumeric.set(mapping.stringId, mapping.numericId);
				this.numericToId.set(mapping.numericId, mapping.stringId);
			}
		});
	}

	private async saveIdMapping(stringId: string, numericId: number): Promise<void> {
		if (!this.db) return;

		const mapping: IdMapping = { numericId, stringId };
		await this.putInStore(ID_MAPPING_STORE, mapping);
		this.idToNumeric.set(stringId, numericId);
		this.numericToId.set(numericId, stringId);
	}

	private async removeIdMapping(stringId: string): Promise<void> {
		if (!this.db) return;
		const db = this.db;

		const numericId = this.idToNumeric.get(stringId);
		if (numericId === undefined) return;

		return new Promise((resolve, reject) => {
			const tx = db.transaction(ID_MAPPING_STORE, "readwrite");
			const store = tx.objectStore(ID_MAPPING_STORE);
			const request = store.delete(numericId);

			request.onerror = () => reject(request.error);
			tx.oncomplete = () => {
				this.idToNumeric.delete(stringId);
				this.numericToId.delete(numericId);
				resolve();
			};
			tx.onerror = () => reject(tx.error);
		});
	}

	private async initHNSWIndex(): Promise<void> {
		if (!this.dimensions || this.hnswIndex) return;

		// Create HNSW index with IndexedDB persistence
		this.hnswIndex = await HNSWWithDB.create(
			this.M,
			this.efConstruction,
			`${this.dbName}-hnsw-index`,
			this.efSearch,
		);

		// Load existing index if available
		try {
			await this.hnswIndex.loadIndex();
		} catch {
			// Index doesn't exist yet, will be built on first insert
		}
	}

	private async ensureHNSWIndex(): Promise<void> {
		if (!this.dimensions) return;
		await this.initHNSWIndex();
	}

	/**
	 * Close the database connection.
	 */
	async close(): Promise<void> {
		// Cancel the pending debounced save so it can't fire after we null `db`,
		// then flush synchronously so no incremental changes are lost on close.
		if (this.saveIndexTimer !== null) {
			clearTimeout(this.saveIndexTimer);
			this.saveIndexTimer = null;
		}
		if (this.hnswIndex) {
			try {
				await this.hnswIndex.saveIndex();
				this.hasPendingIndexSave = false;
			} catch {
				// Ignore save errors on close
			}
		}

		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	/**
	 * Get the current provider ID.
	 */
	get providerId(): string | null {
		return this._providerId;
	}

	/**
	 * Get the current model ID.
	 */
	get modelId(): string | null {
		return this._modelId;
	}

	/**
	 * Set the metadata for this index.
	 */
	async setMetadata(providerId: string, modelId: string, version: number): Promise<void> {
		this._providerId = providerId;
		this._modelId = modelId;

		const meta: StoredMetadata = {
			key: "metadata",
			version,
			providerId,
			modelId,
			lastUpdated: Date.now(),
			dimensions: this.dimensions ?? 0,
			nextHnswId: this.nextHnswId,
		};

		await this.putInStore(METADATA_STORE, meta);
	}

	/**
	 * Get the current index metadata.
	 */
	async getMetadata(): Promise<IndexMetadata | null> {
		const meta = await this.getMetadataInternal();
		if (!meta) return null;

		const count = await this.count();
		return {
			version: meta.version,
			providerId: meta.providerId,
			modelId: meta.modelId,
			documentCount: count,
			lastUpdated: meta.lastUpdated,
		};
	}

	/**
	 * Add or update a document in the store.
	 */
	async upsert(doc: DocumentVector): Promise<void> {
		// Initialize dimensions from first document
		if (!this.dimensions) {
			this.dimensions = doc.vector.length;
		}
		await this.ensureHNSWIndex();

		// Remove the prior version of *this chunk* if updating.
		//
		// Must be keyed on the chunk id, not the path: `getByPath` returns only the
		// first chunk of a note, so on a multi-chunk note re-upserting chunk #2 would
		// drop chunk #0's mapping while #2's own stale mapping survived. Each such
		// upsert then assigned a fresh numeric id and orphaned a graph node, leaving
		// nodes with no `numericToId` entry — which `search()` silently skips,
		// truncating results. (Observed after section-aware chunking turned
		// single-chunk notes into multi-chunk ones: 2611 graph nodes vs 2281
		// mappings, and a 50-result query returning 4.)
		const existing = await this.getById(doc.id);
		if (existing) {
			await this.removeFromHNSW(existing.id);
			await this.removeIdMapping(existing.id);
		}

		// Assign numeric ID for HNSW
		const hnswId = this.nextHnswId++;
		await this.saveIdMapping(doc.id, hnswId);

		// Store in IndexedDB
		const stored: StoredDocument = {
			id: doc.id,
			path: doc.path,
			mtime: doc.mtime,
			checksum: doc.checksum,
			vector: toNumberArray(doc.vector),
			chunkIndex: doc.chunkIndex,
			hnswId,
		};
		await this.putInStore(DOCUMENTS_STORE, stored);

		// Add to HNSW index with numeric ID
		if (this.hnswIndex) {
			await this.hnswIndex.addPoint(hnswId, Array.from(doc.vector));
		}

		await this.updateLastUpdated();

		// Persist the in-memory graph. Debounced so a burst of edits collapses
		// into one save; a clean close() flushes anything still pending.
		this.hasPendingIndexSave = true;
		this.scheduleIndexSave();
	}

	/**
	 * Persist the HNSW graph to IndexedDB if there are unsaved incremental
	 * changes. Safe to call repeatedly (no-op when nothing is pending).
	 */
	private async flushIndex(): Promise<void> {
		if (!this.hasPendingIndexSave || !this.hnswIndex || !this.db) return;
		this.hasPendingIndexSave = false;
		try {
			await this.hnswIndex.saveIndex();
		} catch (e) {
			// Re-arm so a later flush (or close) retries the save.
			this.hasPendingIndexSave = true;
			Logger.error(`${LOG_PREFIX} Failed to persist HNSW graph:`, e);
		}
	}

	private async removeFromHNSW(_id: string): Promise<void> {
		// Note: The hnsw package doesn't support deletion directly.
		// Deleted entries remain in the HNSW graph until the index is rebuilt
		// (bulkPut). Search tolerates them: numeric ids with no string mapping
		// are skipped. Chunking increases the orphan count per note edit, but
		// introduces no new failure mode — the graph is rebuilt on full reindex.
	}

	/**
	 * Remove a document by path.
	 * A note may be stored as multiple chunk rows sharing the same `path`; this
	 * deletes every one of them and drops each chunk's id-mapping.
	 */
	async remove(path: string): Promise<void> {
		const db = this.requireDb();

		// Drop id-mappings for ALL chunks of this note (getByPath returns only one).
		const stored = await this.getAllStoredForPath(path);
		for (const doc of stored) {
			await this.removeFromHNSW(doc.id);
			await this.removeIdMapping(doc.id);
		}

		return new Promise((resolve, reject) => {
			const tx = db.transaction(DOCUMENTS_STORE, "readwrite");
			const store = tx.objectStore(DOCUMENTS_STORE);
			const index = store.index("path");
			const request = index.openCursor(IDBKeyRange.only(path));

			request.onerror = () => reject(request.error);
			request.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
				if (cursor) {
					cursor.delete();
					cursor.continue();
				}
			};

			tx.oncomplete = () => {
				this.updateLastUpdated().then(resolve).catch(reject);
			};
			tx.onerror = () => reject(tx.error);
		});
	}

	/**
	 * Get a document by path.
	 */
	async getByPath(path: string): Promise<DocumentVector | undefined> {
		const db = this.requireDb();

		const tx = db.transaction(DOCUMENTS_STORE, "readonly");
		const request = tx.objectStore(DOCUMENTS_STORE).index("path").get(path);
		return awaitRequest(tx, request, (stored: StoredDocument | undefined) =>
			stored ? this.toDocumentVector(stored) : undefined,
		);
	}

	/**
	 * Get every chunk vector of a note. `getByPath` returns only one chunk;
	 * per-note operations (e.g. the graph's incremental semantic re-query)
	 * need all of them.
	 */
	async getAllByPath(path: string): Promise<DocumentVector[]> {
		const stored = await this.getAllStoredForPath(path);
		return stored.map((s) => this.toDocumentVector(s));
	}

	/**
	 * Check if a document exists and get its mtime.
	 */
	async getDocumentMtime(path: string): Promise<number | undefined> {
		const doc = await this.getByPath(path);
		return doc?.mtime;
	}

	/**
	 * Get all documents.
	 */
	async getAll(): Promise<DocumentVector[]> {
		const stored = await this.getAllStored();
		return stored.map((s) => this.toDocumentVector(s));
	}

	/**
	 * Get all documents as serialized format (for MessagePack).
	 */
	async getAllSerialized(): Promise<SerializedDocument[]> {
		const stored = await this.getAllStored();
		return stored.map((s) => ({
			id: s.id,
			path: s.path,
			mtime: s.mtime,
			checksum: s.checksum,
			vector: s.vector,
			chunkIndex: s.chunkIndex,
		}));
	}

	/**
	 * Bulk insert documents (for loading from file).
	 * Rebuilds the HNSW index from scratch for efficiency.
	 */
	async bulkPut(docs: DocumentVector[]): Promise<void> {
		const totalStart = performance.now();
		const db = this.requireDb();

		// Initialize dimensions from first document
		if (docs.length > 0 && !this.dimensions) {
			this.dimensions = docs[0].vector.length;
		}
		await this.ensureHNSWIndex();

		// Clear existing mappings
		await this.clearStore(ID_MAPPING_STORE);
		this.idToNumeric.clear();
		this.numericToId.clear();
		this.nextHnswId = 0;

		// Prepare vectors with numeric IDs for HNSW
		const hnswVectors: Array<{ id: number; vector: number[] }> = [];

		// Store all documents in IndexedDB in a single transaction
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction([DOCUMENTS_STORE, ID_MAPPING_STORE], "readwrite");
			const docStore = tx.objectStore(DOCUMENTS_STORE);
			const mappingStore = tx.objectStore(ID_MAPPING_STORE);

			for (const doc of docs) {
				const hnswId = this.nextHnswId++;

				// Save mapping
				const mapping: IdMapping = { numericId: hnswId, stringId: doc.id };
				mappingStore.put(mapping);
				this.idToNumeric.set(doc.id, hnswId);
				this.numericToId.set(hnswId, doc.id);

				// Store document with hnswId
				const stored: StoredDocument = {
					id: doc.id,
					path: doc.path,
					mtime: doc.mtime,
					checksum: doc.checksum,
					vector: toNumberArray(doc.vector),
					chunkIndex: doc.chunkIndex,
					hnswId,
				};
				docStore.put(stored);

				// Prepare for HNSW index
				hnswVectors.push({ id: hnswId, vector: Array.from(doc.vector) });
			}

			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		// Rebuild HNSW index from all documents with numeric IDs
		if (this.hnswIndex && hnswVectors.length > 0) {
			await this.hnswIndex.buildIndex(hnswVectors);
			await this.hnswIndex.saveIndex();
		}
		Logger.debug(`${LOG_PREFIX} bulkPut (${docs.length} docs): ${(performance.now() - totalStart).toFixed(1)}ms`);
	}

	/**
	 * Clear all documents from the store.
	 */
	async clear(): Promise<void> {
		if (!this.db) throw new Error("Database not open");

		await this.clearStore(DOCUMENTS_STORE);
		await this.clearStore(METADATA_STORE);
		await this.clearStore(ID_MAPPING_STORE);

		// Clear in-memory mappings
		this.idToNumeric.clear();
		this.numericToId.clear();
		this.nextHnswId = 0;

		// Drop the *persisted* graph, not just the in-memory handle. Recreating the
		// HNSWWithDB wrapper leaves the serialized graph in its own IndexedDB
		// database, so the next open() → loadIndex() resurrects every node from
		// previous indexing runs. Because clear() also resets `nextHnswId` to 0,
		// those stale nodes then collide with freshly assigned numeric ids: search
		// resolves a hit through `numericToId`, misses, and silently drops the
		// result — which manifests as semantic search returning too few results,
		// or none at all, for perfectly valid queries.
		if (this.hnswIndex) {
			try {
				await this.hnswIndex.deleteIndex();
			} catch (e) {
				Logger.error(`${LOG_PREFIX} Failed to delete persisted HNSW graph:`, e);
			}
			this.hnswIndex = null;
		}
		this.hasPendingIndexSave = false;

		// Recreate an empty graph so subsequent upserts have somewhere to insert.
		if (this.dimensions) {
			this.hnswIndex = await HNSWWithDB.create(
				this.M,
				this.efConstruction,
				`${this.dbName}-hnsw-index`,
				this.efSearch,
			);
		}

		this._providerId = null;
		this._modelId = null;
	}

	/**
	 * Get the number of documents in the store.
	 */
	async count(): Promise<number> {
		const db = this.requireDb();

		const tx = db.transaction(DOCUMENTS_STORE, "readonly");
		const request = tx.objectStore(DOCUMENTS_STORE).count();
		return awaitRequest(tx, request, (n: number) => n);
	}

	/**
	 * Count distinct notes (unique paths). Walks the `path` index with a
	 * unique-key cursor so it never deserializes vectors.
	 */
	async countNotes(): Promise<number> {
		const db = this.requireDb();

		const tx = db.transaction(DOCUMENTS_STORE, "readonly");
		const request = tx.objectStore(DOCUMENTS_STORE).index("path").openKeyCursor(null, "nextunique");

		let notes = 0;
		return awaitCursor(tx, request, (cursor) => {
			if (!cursor) return { done: true, value: notes };
			notes++;
			cursor.continue();
			return undefined;
		});
	}

	/**
	 * Search for similar vectors using HNSW approximate nearest neighbor.
	 * O(log n) complexity - much faster than brute-force for large datasets.
	 */
	async search(queryVector: Float32Array, topK: number, threshold?: number): Promise<ScoredDocument[]> {
		await this.ensureHNSWIndex();
		if (!this.hnswIndex) {
			// Fall back to brute-force if HNSW not initialized
			return this.bruteForceSearch(queryVector, topK, threshold);
		}

		try {
			// Use HNSW to get nearest neighbors (returns numeric IDs)
			const hnswResults = this.hnswIndex.searchKNN(Array.from(queryVector), topK);

			// Fetch full documents using numeric -> string ID mapping
			const results: ScoredDocument[] = [];
			for (const result of hnswResults) {
				const stringId = this.numericToId.get(result.id);
				if (!stringId) continue;

				const stored = await this.getById(stringId);
				if (stored) {
					const doc = this.toDocumentVector(stored);
					// The hnsw package returns score (higher = more similar), not distance
					const score = result.score;
					results.push({ doc, score });
				}
			}

			// Apply threshold if provided
			const effectiveThreshold = threshold ?? 0;
			return results.filter((r) => r.score >= effectiveThreshold);
		} catch (error) {
			// Fallback to brute-force if HNSW fails
			return this.bruteForceSearch(queryVector, topK, threshold);
		}
	}

	/**
	 * Fallback brute-force search if HNSW is not available.
	 */
	private async bruteForceSearch(
		queryVector: Float32Array,
		topK: number,
		threshold?: number,
	): Promise<ScoredDocument[]> {
		const docs = await this.getAll();
		const results: ScoredDocument[] = [];

		for (const doc of docs) {
			const score = cosineSimilarity(queryVector, doc.vector);
			results.push({ doc, score });
		}

		results.sort((a, b) => b.score - a.score);
		const effectiveThreshold = threshold ?? 0;
		const filtered = results.filter((r) => r.score >= effectiveThreshold);
		return filtered.slice(0, topK);
	}

	// =========================================================================
	// Private helpers
	// =========================================================================

	private requireDb(): IDBDatabase {
		if (!this.db) throw new Error("Database not open");
		return this.db;
	}

	private async getById(id: string): Promise<StoredDocument | null> {
		if (!this.db) return null;
		const db = this.db;

		const tx = db.transaction(DOCUMENTS_STORE, "readonly");
		const request = tx.objectStore(DOCUMENTS_STORE).get(id);
		return awaitRequest(tx, request, (doc: StoredDocument | undefined) => doc ?? null);
	}

	private async getMetadataInternal(): Promise<StoredMetadata | null> {
		const db = this.requireDb();

		const tx = db.transaction(METADATA_STORE, "readonly");
		const request = tx.objectStore(METADATA_STORE).get("metadata");
		return awaitRequest(tx, request, (meta: StoredMetadata | undefined) => meta ?? null);
	}

	private async putInStore<T>(storeName: string, value: T): Promise<void> {
		const db = this.requireDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, "readwrite");
			const store = tx.objectStore(storeName);
			const request = store.put(value);

			request.onerror = () => reject(request.error);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	private async getAllStored(): Promise<StoredDocument[]> {
		const db = this.requireDb();

		const tx = db.transaction(DOCUMENTS_STORE, "readonly");
		const request = tx.objectStore(DOCUMENTS_STORE).getAll();
		return awaitRequest(tx, request, (docs: StoredDocument[]) => docs);
	}

	/** Get every stored chunk row for a given note path. */
	private async getAllStoredForPath(path: string): Promise<StoredDocument[]> {
		const db = this.requireDb();

		const tx = db.transaction(DOCUMENTS_STORE, "readonly");
		const request = tx.objectStore(DOCUMENTS_STORE).index("path").getAll(IDBKeyRange.only(path));
		return awaitRequest(tx, request, (docs: StoredDocument[]) => docs);
	}

	private async clearStore(storeName: string): Promise<void> {
		const db = this.requireDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, "readwrite");
			const store = tx.objectStore(storeName);
			const request = store.clear();

			request.onerror = () => reject(request.error);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	private async updateLastUpdated(): Promise<void> {
		const meta = await this.getMetadataInternal();
		if (meta) {
			meta.lastUpdated = Date.now();
			// Persist the id high-water mark and dimensions on the incremental
			// path too. `upsert` bumps `nextHnswId` in memory; if only
			// `setMetadata` (full-rebuild path) persisted it, a reload would
			// restore a stale counter and reassign an in-use id → `addPoint`
			// throws "Node with id N already exists" and the note silently fails
			// to index. Keep the persisted counter in lockstep with memory.
			meta.nextHnswId = this.nextHnswId;
			if (this.dimensions) meta.dimensions = this.dimensions;
			await this.putInStore(METADATA_STORE, meta);
		}
	}

	/**
	 * Convert stored format to runtime DocumentVector.
	 */
	private toDocumentVector(stored: StoredDocument): DocumentVector {
		return {
			id: stored.id,
			path: stored.path,
			mtime: stored.mtime,
			checksum: stored.checksum,
			vector: toFloat32Array(stored.vector),
			chunkIndex: stored.chunkIndex,
		};
	}
}
