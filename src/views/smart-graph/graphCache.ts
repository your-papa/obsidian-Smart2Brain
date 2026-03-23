/**
 * Smart Graph Cache
 *
 * Module-level singleton that caches the expensive stages of the smart graph
 * pipeline: raw document vectors, filtered documents, PCA-reduced vectors,
 * and 2D projected positions. Each layer is keyed by a hash of its inputs so
 * that only the stages whose inputs changed are recomputed.
 *
 * Lifetime: persists for the entire plugin session (survives graph tab
 * close/reopen). Cleared on plugin unload or explicit `clear()`.
 */

import type { DocumentVector } from "../../vectorstore/types";
import type { GraphStructureResult } from "./graphDataBuilder";
import { Logger } from "../../utils/logging";

// ============================================================================
// Cache key helpers
// ============================================================================

/**
 * Create a stable string key from the set of document paths.
 * Sorting ensures order-independence.
 */
function pathSetKey(paths: string[]): string {
	return paths.slice().sort().join("\0");
}

/**
 * Deterministic key for the raw vector layer.
 * Changes when the embedding index or its document count changes.
 */
export function documentsKey(indexId: string | null, documentCount: number): string {
	return `${indexId ?? ""}:${documentCount}`;
}

/**
 * Deterministic key for the filtered-documents layer.
 * Includes the raw-vector key plus the active folder/tag filters.
 */
export function filteredKey(rawKey: string, folders: string[] | undefined, tags: string[] | undefined): string {
	const f = folders ? folders.slice().sort().join(",") : "";
	const t = tags ? tags.slice().sort().join(",") : "";
	return `${rawKey}|f:${f}|t:${t}`;
}

/**
 * Deterministic key for the PCA-reduced-vectors layer.
 * Depends on the filtered doc set and the PCA reduction dimension
 * (derived from layoutFidelity + document count).
 */
export function reducedKey(filterKey: string, reductionDim: number | undefined): string {
	return `${filterKey}|dim:${reductionDim ?? "auto"}`;
}

/**
 * Deterministic key for the 2D-projection layer.
 * Depends on the reduced vectors plus all projection parameters.
 */
export function projectionKey(
	reducKey: string,
	projectionMethod: string,
	umapNeighbors: number | undefined,
	umapMinDist: number,
	umapEpochs: number | undefined,
): string {
	return `${reducKey}|proj:${projectionMethod}|n:${umapNeighbors ?? "-"}|d:${umapMinDist}|e:${umapEpochs ?? "-"}`;
}

// ============================================================================
// Cached layer types
// ============================================================================

interface DocumentsLayer {
	key: string;
	documents: DocumentVector[];
}

interface FilteredLayer {
	key: string;
	filteredDocs: DocumentVector[];
	vectors: Float32Array[];
	/** Sorted path list key for fast doc-set-changed detection */
	pathSetKey: string;
}

interface ReducedLayer {
	key: string;
	reducedVectors: Float32Array[];
}

interface ProjectionLayer {
	key: string;
	/** The full GraphStructureResult (positions, edges, degree, etc.) */
	result: GraphStructureResult;
}

// ============================================================================
// Singleton cache
// ============================================================================

/** Status of each cache layer — useful for logging / debugging. */
export interface CacheStatus {
	documents: boolean;
	filtered: boolean;
	reduced: boolean;
	projection: boolean;
}

class SmartGraphCacheImpl {
	private documents: DocumentsLayer | null = null;
	private filtered: FilteredLayer | null = null;
	private reduced: ReducedLayer | null = null;
	private projection: ProjectionLayer | null = null;

	// ── Getters ──────────────────────────────────────────────────────

	getDocuments(key: string): DocumentVector[] | null {
		if (this.documents?.key === key) return this.documents.documents;
		return null;
	}

	getFiltered(key: string): { filteredDocs: DocumentVector[]; vectors: Float32Array[]; pathSetKey: string } | null {
		if (this.filtered?.key === key) {
			return {
				filteredDocs: this.filtered.filteredDocs,
				vectors: this.filtered.vectors,
				pathSetKey: this.filtered.pathSetKey,
			};
		}
		return null;
	}

	getReduced(key: string): Float32Array[] | null {
		if (this.reduced?.key === key) return this.reduced.reducedVectors;
		return null;
	}

	getProjection(key: string): GraphStructureResult | null {
		if (this.projection?.key === key) return this.projection.result;
		return null;
	}

	// ── Setters ──────────────────────────────────────────────────────

	setDocuments(key: string, documents: DocumentVector[]): void {
		this.documents = { key, documents };
		// Downstream layers are stale
		this.filtered = null;
		this.reduced = null;
		this.projection = null;
	}

	setFiltered(key: string, filteredDocs: DocumentVector[], vectors: Float32Array[]): void {
		const psk = pathSetKey(filteredDocs.map((d) => d.path));
		this.filtered = { key, filteredDocs, vectors, pathSetKey: psk };
		// Downstream layers are stale
		this.reduced = null;
		this.projection = null;
	}

	setReduced(key: string, reducedVectors: Float32Array[]): void {
		this.reduced = { key, reducedVectors };
		// Downstream is stale
		this.projection = null;
	}

	setProjection(key: string, result: GraphStructureResult): void {
		this.projection = { key, result };
	}

	// ── Utilities ────────────────────────────────────────────────────

	/** Get the cached path-set key for fast doc-set-changed detection. */
	getFilteredPathSetKey(): string | null {
		return this.filtered?.pathSetKey ?? null;
	}

	/**
	 * Get the set of file paths in the raw document cache.
	 * Used to constrain wiki mode to the same node set as smart mode.
	 */
	getDocumentPaths(): Set<string> | null {
		if (!this.documents) return null;
		return new Set(this.documents.documents.map((d) => d.path));
	}

	/** Clear all cached layers. */
	clear(): void {
		Logger.info("[SmartGraphCache] Cache cleared");
		this.documents = null;
		this.filtered = null;
		this.reduced = null;
		this.projection = null;
	}

	/** Report which layers are populated. */
	status(): CacheStatus {
		return {
			documents: this.documents !== null,
			filtered: this.filtered !== null,
			reduced: this.reduced !== null,
			projection: this.projection !== null,
		};
	}
}

/**
 * Module-level singleton. Survives graph tab close/reopen for the plugin's
 * lifetime. Call `smartGraphCache.clear()` on explicit Refresh or when the
 * embedding index changes.
 */
export const smartGraphCache = new SmartGraphCacheImpl();
