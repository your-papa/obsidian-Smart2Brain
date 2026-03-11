/**
 * Vector Store Module
 *
 * Provides embedding-based semantic search over vault notes.
 * Uses IndexedDB for fast runtime access and MessagePack for file sync.
 * Uses HNSW (Hierarchical Navigable Small World) for O(log n) approximate nearest neighbor search.
 */

export {
	VectorStoreService,
	getVectorStoreService,
	isVectorStoreInitialized,
} from "./VectorStoreService";

export type {
	DefaultEmbedModel,
	DocumentVector,
	EmbeddingIndexConfig,
	IndexMetadata,
	IndexingProgress,
	ScoredDocument,
	SearchFilter,
	SerializedDocument,
	SerializedIndex,
	VectorSearchResult,
	VectorStore,
} from "./types";

export { sanitizeIndexId, getIndexFilePath, getDbName } from "./types";

export { cosineSimilarity, normalize, dotProduct } from "./similarity";

export { HNSWWorkerProxy } from "./HNSWWorkerProxy";

import type { VectorStore } from "./types";
import { HNSWWorkerProxy } from "./HNSWWorkerProxy";

/**
 * Create a vector store instance.
 *
 * @param vaultId The vault identifier for scoping the database
 * @param indexId Optional index identifier ("provider:model") for multi-index support
 * @returns A VectorStore instance
 */
export function createVectorStore(vaultId: string, indexId?: string): VectorStore {
	return new HNSWWorkerProxy(vaultId, indexId);
}
