/**
 * Vector Store Module
 *
 * Provides embedding-based semantic search over vault notes.
 * Uses Dexie/IndexedDB for fast runtime access and MessagePack for sync.
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
    SerializedDocument,
    SerializedIndex,
    VectorSearchResult,
} from "./types";

export { cosineSimilarity, normalize, dotProduct } from "./similarity";
