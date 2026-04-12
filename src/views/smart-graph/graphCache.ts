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
 * Includes the raw-vector key plus the active folder/tag filters and optional
 * region/drill-in path constraint.
 *
 * IMPORTANT: The 5th `drillPaths` parameter MUST be passed when a region
 * constraint is active (region-detail view). Omitting it causes incorrect
 * cache hits — vault-view and region-detail-view would share the same cache
 * entry even though they operate on different document sets.
 * Fix is in callers (SmartGraphView), not here.
 */
export function filteredKey(
	rawKey: string,
	folders: string[] | undefined,
	tags: string[] | undefined,
	extensions?: string[] | undefined,
	drillPaths?: Set<string> | null,
): string {
	const f = folders ? folders.slice().sort().join(",") : "";
	const t = tags ? tags.slice().sort().join(",") : "";
	const e = extensions ? extensions.slice().sort().join(",") : "";
	const d = drillPaths ? [...drillPaths].sort().join(",") : "";
	return `${rawKey}|f:${f}|t:${t}|e:${e}|d:${d}`;
}

/**
 * Deterministic key for the PCA-reduced-vectors layer.
 * Depends on the filtered doc set and the PCA reduction dimension
 * (derived from layoutFidelity + document count).
 */
export function reducedKey(filterKey: string, reductionDim: number | undefined): string {
	return `${filterKey}|dim:${reductionDim ?? "auto"}`;
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

// ============================================================================
// Singleton cache
// ============================================================================

/** Status of each cache layer — useful for logging / debugging. */
export interface CacheStatus {
	documents: boolean;
	filtered: boolean;
	reduced: boolean;
}

class SmartGraphCacheImpl {
	private documents: DocumentsLayer | null = null;
	private filtered: Map<string, FilteredLayer> = new Map();
	private reduced: Map<string, ReducedLayer> = new Map();

	// ── Getters ──────────────────────────────────────────────────────

	getDocuments(key: string): DocumentVector[] | null {
		if (this.documents?.key === key) return this.documents.documents;
		return null;
	}

	getFiltered(key: string): { filteredDocs: DocumentVector[]; vectors: Float32Array[]; pathSetKey: string } | null {
		const entry = this.filtered.get(key);
		if (!entry) return null;
		return {
			filteredDocs: entry.filteredDocs,
			vectors: entry.vectors,
			pathSetKey: entry.pathSetKey,
		};
	}

	getReduced(key: string): Float32Array[] | null {
		return this.reduced.get(key)?.reducedVectors ?? null;
	}

	// ── Setters ──────────────────────────────────────────────────────

	setDocuments(key: string, documents: DocumentVector[]): void {
		this.documents = { key, documents };
		// Downstream layers are stale
		this.filtered.clear();
		this.reduced.clear();
	}

	setFiltered(key: string, filteredDocs: DocumentVector[], vectors: Float32Array[]): void {
		const psk = pathSetKey(filteredDocs.map((d) => d.path));
		this.filtered.set(key, { key, filteredDocs, vectors, pathSetKey: psk });
		// Invalidate downstream layers whose keys are derived from this filtered key
		for (const k of this.reduced.keys()) if (k.startsWith(key)) this.reduced.delete(k);
	}

	setReduced(key: string, reducedVectors: Float32Array[]): void {
		this.reduced.set(key, { key, reducedVectors });
	}

	// ── Utilities ────────────────────────────────────────────────────

	/** Get the cached path-set key for fast doc-set-changed detection. */
	getFilteredPathSetKey(key: string): string | null {
		return this.filtered.get(key)?.pathSetKey ?? null;
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
		this.filtered.clear();
		this.reduced.clear();
	}

	/** Report which layers are populated. */
	status(): CacheStatus {
		return {
			documents: this.documents !== null,
			filtered: this.filtered.size > 0,
			reduced: this.reduced.size > 0,
		};
	}
}

/**
 * Module-level singleton. Survives graph tab close/reopen for the plugin's
 * lifetime. Call `smartGraphCache.clear()` on explicit Refresh or when the
 * embedding index changes.
 */
export const smartGraphCache = new SmartGraphCacheImpl();
