/**
 * Topic-derivation caches + restart persistence
 *
 * The expensive smart-graph derivations (Leiden partitions, the granularity
 * ladder, semantic edges, AI topic labels) are pure over the graph plus the
 * keys embedded in each entry, so staleness is handled by keying, not by
 * lifecycle. The caches live here — module-scoped, shared by every graph leaf
 * (they all describe the same vault) — so they survive closing and reopening
 * the view.
 *
 * **Multiple graphs are cached at once.** The component works against one
 * *active* slot ({@link topicCaches}), but a signature change doesn't discard
 * the outgoing graph's derivations: {@link swapActiveGraphCache} archives them
 * under their signature and restores an archived slot when its graph comes
 * back. That's what makes immerse enter/exit and filter round-trips instant —
 * before this, immersing re-keyed the single slot to the subset and exiting
 * re-ran Leiden, the ladder probes and labeling over the full vault from
 * scratch. Semantic edge sets are keyed the same way (their cache key embeds
 * the wiki-graph signature), so both sides of a round-trip keep theirs too.
 *
 * Everything is also persisted to IndexedDB (issue #404): each entry's
 * invalidation key already exists (graph topology signature, partition key,
 * the embedding index's `lastUpdated` stamp, topic membership signature), so
 * hydration is unconditional and the *consumers'* key checks decide what is
 * still valid. That makes the first graph open after an Obsidian restart as
 * instant as a reopen within a session — a stale persisted entry simply
 * misses its key and is recomputed exactly as before.
 *
 * Partitions are stored as one shared path list per graph plus per-partition
 * community arrays: the same 20k paths repeated across ~15 cached rungs would
 * otherwise dominate the payload.
 */

import type { GraphEdge } from "../../types/graph";
import { GRANULARITY_LADDER_RULES_KEY } from "../../utils/topicHierarchy";
import { getData } from "../../stores/dataStore.svelte";
import { Logger } from "../../utils/logging";

export interface TopicCaches {
	/**
	 * Leiden partitions keyed by `${seed}:${resolution}:${edge mode}`, valid for
	 * the graph whose topology signature is {@link TopicCaches.graphSignature}.
	 */
	leiden: Map<string, Record<string, number>>;
	/**
	 * Signature of the graph the Leiden cache and granularity ladder were
	 * derived from. A rebuild that produces an identical graph — reopening the
	 * view, a Refresh over an unchanged vault, a filter round-trip, a restart —
	 * keeps them all, so topics reappear from cache instead of re-spending
	 * seconds of worker time.
	 */
	graphSignature: string;
	/** The derived granularity ladder for that same graph, restored on reopen. */
	granularityLadder: number[] | null;
	/**
	 * The γ this graph was last viewed at, so granularity is per-graph rather
	 * than one global setting. Immersing and dialling the topics finer is a
	 * statement about the subset, not about the vault — without this, exiting
	 * immerse would leave the full graph re-segmented at the subset's γ.
	 * Null until the user has actually chosen a granularity for this graph;
	 * the stored global setting is the fallback.
	 */
	resolution: number | null;
	/**
	 * Membership-signature → generated topic label, so re-running Leiden at the
	 * same grouping (or reopening the view) doesn't re-spend API calls. Global
	 * across graphs: a topic that exists in both the full and an immersed graph
	 * shares its name.
	 */
	topicLabels: Map<string, string>;
}

/** The active graph's caches. Mutated in place so persistence sees live state. */
export const topicCaches: TopicCaches = {
	leiden: new Map(),
	graphSignature: "",
	granularityLadder: null,
	resolution: null,
	topicLabels: new Map(),
};

interface ArchivedGraphCaches {
	leiden: Map<string, Record<string, number>>;
	granularityLadder: number[] | null;
	resolution: number | null;
	lastUsed: number;
}

/**
 * Graphs other than the active one, keyed by topology signature — the full
 * vault while immersed, an immersed subset after exit, a filtered view.
 * Bounded: the oldest entry is evicted past {@link MAX_CACHED_GRAPHS}.
 */
const archivedGraphs = new Map<string, ArchivedGraphCaches>();

/** Active slot + archived graphs kept at once. */
const MAX_CACHED_GRAPHS = 4;

/** Cached semantic edge sets (full key → edges), bounded the same way. */
const semanticEdgeSets = new Map<string, { edges: GraphEdge[]; lastUsed: number }>();
const MAX_CACHED_SEMANTIC_EDGE_SETS = 4;

function evictOldest<T extends { lastUsed: number }>(map: Map<string, T>, maxSize: number): void {
	while (map.size > maxSize) {
		let oldestKey: string | null = null;
		let oldestUsed = Number.POSITIVE_INFINITY;
		for (const [key, entry] of map) {
			if (entry.lastUsed < oldestUsed) {
				oldestUsed = entry.lastUsed;
				oldestKey = key;
			}
		}
		if (oldestKey === null) return;
		map.delete(oldestKey);
	}
}

/**
 * Re-key the active cache slot to a different graph.
 *
 * The outgoing graph's derivations (partitions + ladder + the γ it was last
 * viewed at) are archived under its signature rather than cleared; if the
 * incoming signature was archived earlier, they're restored and the caller can
 * treat the switch like a signature match. Returns true when a restore
 * happened.
 *
 * `currentResolution` is the γ on screen right now — recorded against the
 * outgoing graph so returning to it re-applies its own granularity instead of
 * inheriting whatever the graph in between was dialled to.
 */
export function swapActiveGraphCache(signature: string, currentResolution?: number): boolean {
	if (signature === topicCaches.graphSignature) {
		if (currentResolution !== undefined) topicCaches.resolution = currentResolution;
		return true;
	}

	// Archive the outgoing graph — but only when it actually derived something.
	if (topicCaches.graphSignature && topicCaches.leiden.size > 0) {
		archivedGraphs.set(topicCaches.graphSignature, {
			leiden: topicCaches.leiden,
			granularityLadder: topicCaches.granularityLadder,
			resolution: currentResolution ?? topicCaches.resolution,
			lastUsed: Date.now(),
		});
	}

	const restored = archivedGraphs.get(signature);
	archivedGraphs.delete(signature);
	topicCaches.graphSignature = signature;
	topicCaches.leiden = restored?.leiden ?? new Map();
	topicCaches.granularityLadder = restored?.granularityLadder ?? null;
	topicCaches.resolution = restored?.resolution ?? null;

	evictOldest(archivedGraphs, MAX_CACHED_GRAPHS - 1);
	return restored !== undefined;
}

/** Record the γ the active graph is being viewed at. */
export function setActiveGraphResolution(resolution: number): void {
	topicCaches.resolution = resolution;
}

/**
 * Ensure the active slot describes `signature`, swapping it in if not.
 *
 * The slot is module-level and shared by every graph leaf. One leaf is the
 * normal case (the command reuses the existing view), but a user can split or
 * duplicate the tab, or restore a layout with two — and then two leaves
 * showing different filtered or immersed topologies each re-key the slot under
 * the other. Whoever reads next would consume the other leaf's Leiden
 * partition or ladder.
 *
 * Callers hold the signature of the graph they are actually rendering, so any
 * entry point that is going to read or write the slot can cheaply re-assert
 * it. A no-op when the slot already matches, which is every single-leaf case.
 */
export function ensureActiveGraphCache(signature: string): void {
	if (signature !== topicCaches.graphSignature) swapActiveGraphCache(signature);
}

/**
 * Store a Leiden partition against the graph it was computed for.
 *
 * Async work (a Leiden run, a probe sweep) starts while one graph is active
 * and finishes an arbitrary time later — by which point another leaf may have
 * re-keyed the active slot. Writing to `topicCaches.leiden` at that point
 * files the result under the *other* graph, where it would later be served as
 * that graph's partition and paint the wrong communities.
 *
 * Addressing the write by signature makes it land correctly whichever slot is
 * active: the active map when it still matches, the archived entry otherwise.
 * A signature with no entry either way is simply dropped — that graph is gone
 * (evicted, or never derived anything), so nothing would ever read it back.
 */
export function setCachedPartition(signature: string, key: string, communities: Record<string, number>): void {
	if (signature === topicCaches.graphSignature) {
		topicCaches.leiden.set(key, communities);
		return;
	}
	const archived = archivedGraphs.get(signature);
	if (archived) {
		archived.leiden.set(key, communities);
		archived.lastUsed = Date.now();
		return;
	}
	// Not the active graph and not archived: preserve it rather than lose the
	// computation, so returning to that graph finds its partition waiting.
	archivedGraphs.set(signature, {
		leiden: new Map([[key, communities]]),
		granularityLadder: null,
		resolution: null,
		lastUsed: Date.now(),
	});
	evictOldest(archivedGraphs, MAX_CACHED_GRAPHS - 1);
}

/** Read a partition from the graph it belongs to, active slot or archive. */
export function getCachedPartition(signature: string, key: string): Record<string, number> | undefined {
	if (signature === topicCaches.graphSignature) return topicCaches.leiden.get(key);
	return archivedGraphs.get(signature)?.leiden.get(key);
}

/** Look up a cached semantic edge set by its full cache key. */
export function getCachedSemanticEdges(key: string): GraphEdge[] | null {
	const entry = semanticEdgeSets.get(key);
	if (!entry) return null;
	entry.lastUsed = Date.now();
	return entry.edges;
}

/** Cache a semantic edge set under its full cache key. */
export function setCachedSemanticEdges(key: string, edges: GraphEdge[]): void {
	semanticEdgeSets.set(key, { edges, lastUsed: Date.now() });
	evictOldest(semanticEdgeSets, MAX_CACHED_SEMANTIC_EDGE_SETS);
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * v2: multiple graphs (active + archived) instead of a single slot.
 * v3: each cached graph carries the γ it was last viewed at.
 * v4: granularity ladders are derived by different rules (readability cap,
 *     minimum step between rungs), so ladders cached under v3 describe a
 *     slider this build would never produce. Bump whenever the *derivation*
 *     changes — the cache is keyed by graph signature, which cannot notice
 *     that the code computing the value changed.
 */
const TOPIC_CACHE_VERSION = 4;

/** One graph's cached derivations, as carried in a snapshot. */
export interface CachedGraphEntry {
	leiden: Map<string, Record<string, number>>;
	granularityLadder: number[] | null;
	/** The γ this graph was last viewed at; null when never chosen. */
	resolution: number | null;
	lastUsed: number;
}

/** All cache state as plain data — the unit that persistence round-trips. */
export interface TopicCacheSnapshot {
	activeSignature: string;
	/** Every cached graph (the active one included), keyed by signature. */
	graphs: Map<string, CachedGraphEntry>;
	semanticEdges: Map<string, { edges: GraphEdge[]; lastUsed: number }>;
	topicLabels: Map<string, string>;
}

interface PersistedGraphCaches {
	signature: string;
	/** Union of every node path appearing in any of this graph's partitions. */
	nodePaths: string[];
	/** Partition key → community id per node, aligned with `nodePaths`; -1 = absent. */
	partitions: Record<string, number[]>;
	granularityLadder: number[] | null;
	/** Identity of the derivation rules that produced `granularityLadder`. */
	granularityLadderRules?: string;
	resolution: number | null;
	lastUsed: number;
}

export interface PersistedTopicCaches {
	version: number;
	activeSignature: string;
	graphs: PersistedGraphCaches[];
	semanticEdges: Array<{ key: string; edges: GraphEdge[]; lastUsed: number }>;
	topicLabels: Record<string, string>;
	savedAt: number;
}

/** Collect the live module state (active slot + archives) into a snapshot. */
export function snapshotTopicCaches(): TopicCacheSnapshot {
	const graphs: TopicCacheSnapshot["graphs"] = new Map();
	for (const [signature, entry] of archivedGraphs) {
		graphs.set(signature, {
			leiden: entry.leiden,
			granularityLadder: entry.granularityLadder,
			resolution: entry.resolution,
			lastUsed: entry.lastUsed,
		});
	}
	if (topicCaches.graphSignature && topicCaches.leiden.size > 0) {
		graphs.set(topicCaches.graphSignature, {
			leiden: topicCaches.leiden,
			granularityLadder: topicCaches.granularityLadder,
			resolution: topicCaches.resolution,
			lastUsed: Date.now(),
		});
	}
	return {
		activeSignature: topicCaches.graphSignature,
		graphs,
		semanticEdges: new Map(semanticEdgeSets),
		topicLabels: new Map(topicCaches.topicLabels),
	};
}

/** Install a snapshot as the live module state (hydration). */
function restoreSnapshot(snapshot: TopicCacheSnapshot): void {
	archivedGraphs.clear();
	for (const [signature, entry] of snapshot.graphs) {
		if (signature === snapshot.activeSignature) continue;
		archivedGraphs.set(signature, {
			leiden: entry.leiden,
			granularityLadder: entry.granularityLadder,
			resolution: entry.resolution,
			lastUsed: entry.lastUsed,
		});
	}
	const active = snapshot.graphs.get(snapshot.activeSignature);
	topicCaches.graphSignature = snapshot.activeSignature;
	topicCaches.leiden = active?.leiden ?? new Map();
	topicCaches.granularityLadder = active?.granularityLadder ?? null;
	topicCaches.resolution = active?.resolution ?? null;
	for (const [key, entry] of snapshot.semanticEdges) semanticEdgeSets.set(key, entry);
	for (const [key, label] of snapshot.topicLabels) topicCaches.topicLabels.set(key, label);
}

function encodeGraph(signature: string, entry: CachedGraphEntry): PersistedGraphCaches {
	const pathIndex = new Map<string, number>();
	for (const partition of entry.leiden.values()) {
		for (const path of Object.keys(partition)) {
			if (!pathIndex.has(path)) pathIndex.set(path, pathIndex.size);
		}
	}
	const nodePaths = [...pathIndex.keys()];
	const partitions: Record<string, number[]> = {};
	for (const [key, partition] of entry.leiden) {
		const communities = new Array<number>(nodePaths.length).fill(-1);
		for (const [path, community] of Object.entries(partition)) {
			const index = pathIndex.get(path);
			if (index !== undefined) communities[index] = community;
		}
		partitions[key] = communities;
	}
	return {
		signature,
		nodePaths,
		partitions,
		granularityLadder: entry.granularityLadder ? [...entry.granularityLadder] : null,
		granularityLadderRules: GRANULARITY_LADDER_RULES_KEY,
		resolution: entry.resolution,
		lastUsed: entry.lastUsed,
	};
}

export function encodeTopicCaches(snapshot: TopicCacheSnapshot): PersistedTopicCaches {
	return {
		version: TOPIC_CACHE_VERSION,
		activeSignature: snapshot.activeSignature,
		graphs: [...snapshot.graphs].map(([signature, entry]) => encodeGraph(signature, entry)),
		semanticEdges: [...snapshot.semanticEdges].map(([key, entry]) => ({
			key,
			edges: entry.edges.map((edge) => ({ ...edge })),
			lastUsed: entry.lastUsed,
		})),
		topicLabels: Object.fromEntries(snapshot.topicLabels),
		savedAt: Date.now(),
	};
}

function decodeGraph(raw: unknown): { signature: string; entry: CachedGraphEntry } | null {
	if (typeof raw !== "object" || raw === null) return null;
	const persisted = raw as Partial<PersistedGraphCaches>;
	if (typeof persisted.signature !== "string") return null;
	if (
		!Array.isArray(persisted.nodePaths) ||
		typeof persisted.partitions !== "object" ||
		persisted.partitions === null
	)
		return null;

	const nodePaths = persisted.nodePaths.filter((path): path is string => typeof path === "string");
	if (nodePaths.length !== persisted.nodePaths.length) return null;

	const leiden = new Map<string, Record<string, number>>();
	for (const [key, communities] of Object.entries(persisted.partitions)) {
		if (!Array.isArray(communities) || communities.length !== nodePaths.length) return null;
		const partition: Record<string, number> = {};
		for (let i = 0; i < communities.length; i++) {
			const community = communities[i];
			if (typeof community !== "number") return null;
			if (community >= 0) partition[nodePaths[i]] = community;
		}
		leiden.set(key, partition);
	}

	// A ladder derived under different rules describes a slider this build
	// would never produce — drop it so it is re-probed rather than restored.
	const rulesMatch = persisted.granularityLadderRules === GRANULARITY_LADDER_RULES_KEY;
	const ladder = rulesMatch ? persisted.granularityLadder : null;
	return {
		signature: persisted.signature,
		entry: {
			leiden,
			granularityLadder: Array.isArray(ladder) && ladder.every((g) => typeof g === "number") ? [...ladder] : null,
			resolution: typeof persisted.resolution === "number" ? persisted.resolution : null,
			lastUsed: typeof persisted.lastUsed === "number" ? persisted.lastUsed : 0,
		},
	};
}

/**
 * Decode a persisted payload back into a snapshot, or `null` when it is from
 * a different schema version or structurally not what we wrote. No content
 * validation beyond that — every entry is key-checked by its consumer anyway.
 */
export function decodeTopicCaches(raw: unknown): TopicCacheSnapshot | null {
	if (typeof raw !== "object" || raw === null) return null;
	const persisted = raw as Partial<PersistedTopicCaches>;
	if (persisted.version !== TOPIC_CACHE_VERSION) return null;
	if (typeof persisted.activeSignature !== "string" || !Array.isArray(persisted.graphs)) return null;

	const graphs: TopicCacheSnapshot["graphs"] = new Map();
	for (const rawGraph of persisted.graphs) {
		const decoded = decodeGraph(rawGraph);
		if (!decoded) return null;
		graphs.set(decoded.signature, decoded.entry);
	}

	const semanticEdges: TopicCacheSnapshot["semanticEdges"] = new Map();
	for (const entry of persisted.semanticEdges ?? []) {
		if (typeof entry?.key !== "string" || !Array.isArray(entry.edges)) continue;
		semanticEdges.set(entry.key, {
			edges: entry.edges,
			lastUsed: typeof entry.lastUsed === "number" ? entry.lastUsed : 0,
		});
	}

	return {
		activeSignature: persisted.activeSignature,
		graphs,
		semanticEdges,
		topicLabels: new Map(
			Object.entries(persisted.topicLabels ?? {}).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
	};
}

// ============================================================================
// IndexedDB persistence
// ============================================================================

const DB_NAME_PREFIX = "s2b-topic-cache";
const DB_VERSION = 1;
const STORE_NAME = "caches";
const RECORD_KEY = "topic-caches";
const SAVE_DEBOUNCE_MS = 3000;

function openDatabase(): Promise<IDBDatabase> {
	const dbName = `${DB_NAME_PREFIX}-${getData().vaultSlug}`;
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, DB_VERSION);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function readPersisted(): Promise<unknown> {
	const db = await openDatabase();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

async function writePersisted(payload: PersistedTopicCaches): Promise<void> {
	const db = await openDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			tx.objectStore(STORE_NAME).put(payload, RECORD_KEY);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

let hydration: Promise<void> | null = null;

/**
 * Hydrate the caches from IndexedDB, once per plugin load.
 *
 * Callers await this before their first cache read; later calls resolve
 * immediately. Hydration never *overwrites* in-session state: if any Leiden
 * entry exists already, this session has fresher derivations than the disk
 * copy and the load is skipped.
 */
export function loadPersistedTopicCaches(): Promise<void> {
	if (hydration) return hydration;
	hydration = (async () => {
		if (typeof indexedDB === "undefined") return;
		const start = performance.now();
		const decoded = decodeTopicCaches(await readPersisted());
		if (!decoded || topicCaches.leiden.size > 0 || archivedGraphs.size > 0) return;
		restoreSnapshot(decoded);
		Logger.info(
			`[SmartGraph] Restored topic caches (${decoded.graphs.size} graph(s), ` +
				`${decoded.semanticEdges.size} semantic edge set(s)) in ${Math.round(performance.now() - start)}ms`,
		);
	})().catch((error) => {
		Logger.warn("[SmartGraph] Could not restore persisted topic caches:", error);
	});
	return hydration;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persist the current caches, debounced — derivations land in bursts (probe
 * ladder, hierarchy, labels), and one write at the end covers all of them.
 * An entirely empty cache is never written: it would clobber a useful
 * persisted copy with the transient state right after an invalidation, before
 * the fresh run (which triggers its own save) has landed.
 */
export function scheduleTopicCacheSave(): void {
	if (typeof indexedDB === "undefined") return;
	if (saveTimer != null) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = null;
		if (topicCaches.leiden.size === 0 && archivedGraphs.size === 0) return;
		writePersisted(encodeTopicCaches(snapshotTopicCaches())).catch((error) => {
			Logger.warn("[SmartGraph] Could not persist topic caches:", error);
		});
	}, SAVE_DEBOUNCE_MS);
}
