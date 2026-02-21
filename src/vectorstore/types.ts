/**
 * Vector Store Types
 *
 * Types for the local embedding-based vector store.
 * Supports both runtime (Dexie/IndexedDB) and serialized (MessagePack file) storage.
 */

/**
 * A document with its embedding vector stored in IndexedDB.
 * Uses Float32Array for memory efficiency during runtime.
 */
export interface DocumentVector {
    /** Unique identifier - uses file path as ID */
    id: string;
    /** Path to the markdown file in the vault */
    path: string;
    /** File modification time (Unix timestamp ms) for change detection */
    mtime: number;
    /** MD5 hash of content for change detection */
    checksum: string;
    /** Embedding vector as Float32Array for efficient computation */
    vector: Float32Array;
    /**
     * Chunk index within the document (for future chunking support).
     * If undefined, the document is embedded as a single chunk.
     */
    chunkIndex?: number;
}

/**
 * Serialized version of DocumentVector for MessagePack storage.
 * Uses number[] instead of Float32Array for JSON/MessagePack compatibility.
 */
export interface SerializedDocument {
    id: string;
    path: string;
    mtime: number;
    checksum: string;
    /** Vector as number array for serialization */
    vector: number[];
    chunkIndex?: number;
}

/**
 * The complete serialized vector store index.
 * Written to disk as MessagePack binary.
 */
export interface SerializedIndex {
    /** Schema version for migration support */
    version: number;
    /** Provider ID that generated these embeddings */
    providerId: string;
    /** Model ID that generated these embeddings */
    modelId: string;
    /** All indexed documents with their vectors */
    documents: SerializedDocument[];
    /** Last time the index was updated (Unix timestamp ms) */
    lastUpdated: number;
}

/**
 * Metadata about the current index state (without the full document list).
 * Used for quick checks without loading all vectors.
 */
export interface IndexMetadata {
    version: number;
    providerId: string;
    modelId: string;
    documentCount: number;
    lastUpdated: number;
}

/**
 * Result from a vector similarity search.
 * Compatible with the existing SearchResult interface in searchNotes.ts.
 */
export interface VectorSearchResult {
    path: string;
    name: string;
    frontmatter?: Record<string, unknown>;
    /** Cosine similarity score (0-1, higher is more similar) */
    score: number;
}

/**
 * Configuration for the default embedding model.
 * Stored in plugin data.
 */
export interface DefaultEmbedModel {
    provider: string;
    model: string;
}

/**
 * Progress state for indexing operations.
 * Used for UI feedback.
 */
export interface IndexingProgress {
    /** Whether indexing is currently in progress */
    isIndexing: boolean;
    /** Total number of files to index */
    total: number;
    /** Number of files indexed so far */
    indexed: number;
    /** Number of files skipped (too large, errors) */
    skipped: number;
    /** Current file being indexed (for display) */
    currentFile: string | null;
    /** Progress percentage (0-100) */
    percentage: number;
}

/** Current schema version for the serialized index */
export const INDEX_VERSION = 1;

/** Database name for Dexie/IndexedDB */
export const DEXIE_DB_NAME = "smart-second-brain-vectorstore";

/** Path to the serialized index file (relative to plugin data dir) */
export const INDEX_FILE_PATH = "vectorstore/index.msgpack";

/** Debounce delay for file sync (5 minutes in ms) */
export const SYNC_DEBOUNCE_MS = 5 * 60 * 1000;
