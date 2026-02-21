/**
 * IndexedDB Vector Store
 *
 * IndexedDB-backed vector storage using the native IndexedDB API.
 * Provides fast runtime access to document embeddings.
 * Avoids Dexie to prevent version conflicts with Obsidian's internal Dexie.
 */

import { DEXIE_DB_NAME, type DocumentVector, type IndexMetadata, type SerializedDocument } from "./types";
import { toFloat32Array, toNumberArray } from "./similarity";

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
}

const DB_VERSION = 1;
const DOCUMENTS_STORE = "documents";
const METADATA_STORE = "metadata";

/**
 * Native IndexedDB-backed vector store for fast runtime access.
 */
export class IndexedDBVectorStore {
    private db: IDBDatabase | null = null;
    private _providerId: string | null = null;
    private _modelId: string | null = null;

    /**
     * Open the database connection.
     */
    async open(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DEXIE_DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);

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
            };

            request.onsuccess = async (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;

                // Load metadata
                try {
                    const meta = await this.getMetadataInternal();
                    if (meta) {
                        this._providerId = meta.providerId;
                        this._modelId = meta.modelId;
                    }
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };
        });
    }

    /**
     * Close the database connection.
     */
    async close(): Promise<void> {
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
        };

        return this.putInStore(METADATA_STORE, meta);
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
        const stored: StoredDocument = {
            id: doc.id,
            path: doc.path,
            mtime: doc.mtime,
            checksum: doc.checksum,
            vector: toNumberArray(doc.vector),
            chunkIndex: doc.chunkIndex,
        };
        await this.putInStore(DOCUMENTS_STORE, stored);
        await this.updateLastUpdated();
    }

    /**
     * Remove a document by path.
     */
    async remove(path: string): Promise<void> {
        if (!this.db) throw new Error("Database not open");

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(DOCUMENTS_STORE, "readwrite");
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
        if (!this.db) throw new Error("Database not open");

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(DOCUMENTS_STORE, "readonly");
            const store = tx.objectStore(DOCUMENTS_STORE);
            const index = store.index("path");
            const request = index.get(path);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const stored = request.result as StoredDocument | undefined;
                if (!stored) {
                    resolve(undefined);
                } else {
                    resolve(this.toDocumentVector(stored));
                }
            };
        });
    }

    /**
     * Check if a document exists and get its mtime.
     */
    async getDocumentMtime(path: string): Promise<number | undefined> {
        const doc = await this.getByPath(path);
        return doc?.mtime;
    }

    /**
     * Get all documents (for serialization or search).
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
     */
    async bulkPut(docs: DocumentVector[]): Promise<void> {
        if (!this.db) throw new Error("Database not open");

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(DOCUMENTS_STORE, "readwrite");
            const store = tx.objectStore(DOCUMENTS_STORE);

            for (const doc of docs) {
                const stored: StoredDocument = {
                    id: doc.id,
                    path: doc.path,
                    mtime: doc.mtime,
                    checksum: doc.checksum,
                    vector: toNumberArray(doc.vector),
                    chunkIndex: doc.chunkIndex,
                };
                store.put(stored);
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Clear all documents from the store.
     */
    async clear(): Promise<void> {
        if (!this.db) throw new Error("Database not open");

        await this.clearStore(DOCUMENTS_STORE);
        await this.clearStore(METADATA_STORE);
        this._providerId = null;
        this._modelId = null;
    }

    /**
     * Get the number of documents in the store.
     */
    async count(): Promise<number> {
        if (!this.db) throw new Error("Database not open");

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(DOCUMENTS_STORE, "readonly");
            const store = tx.objectStore(DOCUMENTS_STORE);
            const request = store.count();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private async getMetadataInternal(): Promise<StoredMetadata | null> {
        if (!this.db) throw new Error("Database not open");

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(METADATA_STORE, "readonly");
            const store = tx.objectStore(METADATA_STORE);
            const request = store.get("metadata");

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve((request.result as StoredMetadata) ?? null);
        });
    }

    private async putInStore<T>(storeName: string, value: T): Promise<void> {
        if (!this.db) throw new Error("Database not open");

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            const request = store.put(value);

            request.onerror = () => reject(request.error);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    private async getAllStored(): Promise<StoredDocument[]> {
        if (!this.db) throw new Error("Database not open");

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(DOCUMENTS_STORE, "readonly");
            const store = tx.objectStore(DOCUMENTS_STORE);
            const request = store.getAll();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result as StoredDocument[]);
        });
    }

    private async clearStore(storeName: string): Promise<void> {
        if (!this.db) throw new Error("Database not open");

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(storeName, "readwrite");
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
