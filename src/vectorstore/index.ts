/**
 * Vector Store Module
 *
 * Provides embedding-based semantic search over vault notes.
 * Uses Dexie/IndexedDB for fast runtime access and MessagePack for sync.
 *
 * Supports pluggable backends:
 * - IndexedDB: Brute-force cosine similarity (O(n), simple, reliable)
 * - HNSW: Approximate nearest neighbor (O(log n), faster for large vaults)
 */

export {
    VectorStoreService,
    getVectorStoreService,
    isVectorStoreInitialized,
} from "./VectorStoreService";

export type {
    DefaultEmbedModel,
    DocumentVector,
    IndexMetadata,
    IndexingProgress,
    ScoredDocument,
    SearchFilter,
    SerializedDocument,
    SerializedIndex,
    VectorSearchResult,
    VectorStore,
    VectorStoreBackend,
} from "./types";

export { cosineSimilarity, normalize, dotProduct } from "./similarity";

export { IndexedDBVectorStore } from "./IndexedDBVectorStore";
export { HNSWVectorStore } from "./HNSWVectorStore";

import type { VectorStore, VectorStoreBackend } from "./types";
import { IndexedDBVectorStore } from "./IndexedDBVectorStore";
import { HNSWVectorStore } from "./HNSWVectorStore";

/**
 * Create a vector store instance for the specified backend.
 *
 * @param backend The backend to use: 'indexeddb' (brute-force) or 'hnsw' (ANN)
 * @returns A VectorStore instance
 */
export function createVectorStore(backend: VectorStoreBackend): VectorStore {
    switch (backend) {
        case "hnsw":
            return new HNSWVectorStore();
        case "indexeddb":
        default:
            return new IndexedDBVectorStore();
    }
}
