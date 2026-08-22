/**
 * Vector Store Types
 *
 * Types for the local embedding-based vector store.
 * Supports both runtime (Dexie/IndexedDB) and serialized (MessagePack file) storage.
 */

// Re-export DefaultEmbedModel and EmbeddingIndexConfig from canonical location
export type { DefaultEmbedModel, EmbeddingIndexConfig } from "../types/plugin";
import type { LexicalRankingFeatures } from "../search/lexicalScoring";

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
	 * Chunk index within the document (0-based).
	 * Large notes are split into multiple chunks, each embedded as its own
	 * vector; a note that fits in one embedding has a single chunk at index 0.
	 * The record `id` is `${path}#${chunkIndex}` (see `makeChunkId`).
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
	/** Schema version for persisted index data */
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
 */
export interface VectorSearchResult {
	path: string;
	name: string;
	frontmatter?: Record<string, unknown>;
	/** Tags from the document (frontmatter + inline) */
	tags?: string[];
	/** Match explanation metadata for UI rendering */
	matchExplanation?: SearchMatchExplanation;
	/** Ranked match signals shown as reason badges in the UI */
	matchBadges?: SearchMatchBadge[];
	/** Cosine similarity score (0-1, higher is more similar) */
	score: number;
	rankingDebug?: SearchRankingDebug;
}

/**
 * Canonical search result consumed by the modal and agent tool layer.
 * Structurally identical to `VectorSearchResult` except `score` is optional.
 */
export interface SearchResult {
	path: string;
	name: string;
	frontmatter?: Record<string, unknown>;
	tags?: string[];
	matchExplanation?: SearchMatchExplanation;
	matchBadges?: SearchMatchBadge[];
	score?: number;
	rankingDebug?: SearchRankingDebug;
}

export interface SearchRankingDebug {
	originalRank?: number;
	finalRank?: number;
	rerankScore?: number;
	finalScore?: number;
	recentBoost?: number;
	recentRank?: number;
	baseScore?: number;
	lexicalRank?: number;
	semanticRank?: number;
	semanticScore?: number;
	lexicalRrfScore?: number;
	semanticRrfScore?: number;
	finalTitleBoost?: number;
	finalAliasBoost?: number;
	recentAliasBonus?: number;
	lexicalFeatures?: LexicalRankingFeatures;
	/** Score of the note's single best-matching chunk, before support aggregation. */
	bestChunkScore?: number;
	/** How many of the note's chunks were among the retrieved semantic hits. */
	matchingChunks?: number;
	/** Normalized (0-1) lexical score within the result set, after fusion rework. */
	normalizedLexical?: number;
	/** Normalized (0-1) semantic score within the result set, after fusion rework. */
	normalizedSemantic?: number;
	/** Relevance relative to the top result, used to gate the recency boost. */
	relativeRelevance?: number;
	/** True when recency was gated away because the note was not a strong enough match. */
	recentGated?: boolean;
	/** Adaptive recency-lift ceiling for this query, derived from result-set spread. */
	adaptiveRecentLift?: number;
}

export interface SearchMatchExplanation {
	source: "title" | "alias" | "tag" | "heading" | "content";
	text: string;
	heading?: string;
	headingLevel?: number;
}

export type SearchMatchBadge = "title" | "alias" | "tag" | "path" | "heading" | "content" | "semantic" | "recent";

/**
 * Filter options for vector search.
 * All filters are optional and combined with AND logic.
 */
export interface SearchFilter {
	/**
	 * Filter by path prefix(es).
	 * Documents must match at least one of the provided path prefixes with
	 * folder-boundary-safe matching.
	 * Example: ["folder/subfolder", "another/path"] matches docs in either location.
	 */
	pathPrefixes?: string[];

	/**
	 * Filter by tag(s).
	 * Documents must have at least one of the provided tags.
	 * Tags should include the # prefix (e.g., "#project", "#todo").
	 */
	tags?: string[];

	/**
	 * Require ALL tags instead of ANY tag.
	 * When true, documents must have all specified tags.
	 * Default: false (match any tag).
	 */
	requireAllTags?: boolean;
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
	/** Estimated milliseconds remaining, or null when not yet known */
	etaMs: number | null;
}

/** Reasons a file can be skipped during indexing */
export type SkipReason = "excluded" | "privacy" | "too-large" | "not-indexed" | "read-error" | "embed-error";

/** A file that was skipped during indexing, with its reason */
export interface SkippedFile {
	path: string;
	reason: SkipReason;
}

/**
 * Report generated after an indexing run, showing what was indexed
 * and what was skipped (with reasons).
 */
export interface IndexingReport {
	/** Paths of successfully indexed files */
	indexedFiles: string[];
	/** Files that were skipped, grouped by reason */
	skippedFiles: SkippedFile[];
	/** When this report was generated */
	timestamp: number;
}

/** Current schema version for the serialized index.
 * v2: notes are split into multiple chunks (`${path}#${chunkIndex}` ids) instead
 * of one vector per note. Bumping this forces a rebuild of pre-chunking indexes. */
export const INDEX_VERSION = 2;

/**
 * Sanitize a provider:model string into a filesystem/IndexedDB-safe identifier.
 * Replaces special characters with underscores while preserving readability.
 */
export function sanitizeIndexId(provider: string, model: string): string {
	return `${provider}_${model}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Build the unique record id for a note chunk.
 * A note is identified by its `path`; each chunk within it gets a distinct id
 * so multiple chunks of one note can coexist in the path-indexed store.
 */
export function makeChunkId(path: string, chunkIndex: number): string {
	return `${path}#${chunkIndex}`;
}

/**
 * Get the database name for a specific index ID and vault.
 * @param vaultId The vault identifier
 * @param indexId Optional "provider:model" composite key. If omitted, returns the base vault-scoped name.
 * @returns IndexedDB database name
 */
export function getDbName(prefix: string, vaultId: string, indexId?: string): string {
	if (!indexId) return `${prefix}-${vaultId}`;
	const colonIdx = indexId.indexOf(":");
	const provider = colonIdx >= 0 ? indexId.slice(0, colonIdx) : indexId;
	const model = colonIdx >= 0 ? indexId.slice(colonIdx + 1) : "";
	const sanitized = sanitizeIndexId(provider, model);
	return `${prefix}-${vaultId}-${sanitized}`;
}

/**
 * Result from a vector similarity search (internal use).
 * Contains the document and its similarity score.
 */
export interface ScoredDocument {
	doc: DocumentVector;
	score: number;
}

/**
 * Abstract interface for vector store backends.
 * HNSW implementation conforms to this interface.
 */
export interface VectorStore {
	/**
	 * Open the database connection.
	 */
	open(): Promise<void>;

	/**
	 * Close the database connection.
	 */
	close(): Promise<void>;

	/**
	 * Get the current provider ID.
	 */
	readonly providerId: string | null;

	/**
	 * Get the current model ID.
	 */
	readonly modelId: string | null;

	/**
	 * Set the metadata for this index.
	 */
	setMetadata(providerId: string, modelId: string, version: number): Promise<void>;

	/**
	 * Get the current index metadata.
	 */
	getMetadata(): Promise<IndexMetadata | null>;

	/**
	 * Add or update a document in the store.
	 */
	upsert(doc: DocumentVector): Promise<void>;

	/**
	 * Remove a document by path.
	 */
	remove(path: string): Promise<void>;

	/**
	 * Get a document by path.
	 */
	getByPath(path: string): Promise<DocumentVector | undefined>;

	/**
	 * Get every chunk vector of a note (a large note is stored as several
	 * chunk rows; `getByPath` returns only one of them).
	 */
	getAllByPath(path: string): Promise<DocumentVector[]>;

	/**
	 * Check if a document exists and get its mtime.
	 */
	getDocumentMtime(path: string): Promise<number | undefined>;

	/**
	 * Get all documents.
	 */
	getAll(): Promise<DocumentVector[]>;

	/**
	 * Get all documents as serialized format (for MessagePack).
	 */
	getAllSerialized(): Promise<SerializedDocument[]>;

	/**
	 * Bulk insert documents (for loading from file).
	 */
	bulkPut(docs: DocumentVector[]): Promise<void>;

	/**
	 * Clear all documents from the store.
	 */
	clear(): Promise<void>;

	/**
	 * Get the number of documents (chunks) in the store.
	 */
	count(): Promise<number>;

	/**
	 * Get the number of distinct notes (unique paths) in the store. A note is
	 * split into multiple chunk documents, so this is <= count() and is the
	 * user-facing "notes indexed" figure.
	 */
	countNotes(): Promise<number>;

	/**
	 * Search for similar vectors.
	 * @param queryVector The query vector to search for
	 * @param topK Maximum number of results to return
	 * @param threshold Minimum similarity score (0-1)
	 * @returns Array of documents with their similarity scores
	 */
	search(queryVector: Float32Array, topK: number, threshold?: number): Promise<ScoredDocument[]>;
}
