import { describe, expect, it } from "vitest";
import type { GraphEdge } from "../../src/types/graph";
import {
	decodeTopicCaches,
	encodeTopicCaches,
	getCachedSemanticEdges,
	setActiveGraphResolution,
	setCachedSemanticEdges,
	snapshotTopicCaches,
	swapActiveGraphCache,
	topicCaches,
	type TopicCacheSnapshot,
} from "../../src/views/smart-graph/topicCaches";

function sampleSnapshot(): TopicCacheSnapshot {
	const semantic: GraphEdge = { source: "a.md", target: "c.md", weight: 0.81, type: "semantic" };
	return {
		activeSignature: "full-graph-sig",
		graphs: new Map([
			[
				"full-graph-sig",
				{
					leiden: new Map([
						["7:1:fused", { "a.md": 0, "b.md": 0, "c.md": 1 }],
						// A different rung over the same graph may cover a different
						// node set (e.g. link-only mode sees fewer edges).
						["7:0.5:wiki", { "a.md": 0, "b.md": 0 }],
					]),
					granularityLadder: [0.4, 1.0, 2.2],
					resolution: 1.0,
					lastUsed: 100,
				},
			],
			[
				"immersed-sig",
				{
					leiden: new Map([["7:1:fused", { "a.md": 0, "b.md": 1 }]]),
					granularityLadder: null,
					resolution: 2.2,
					lastUsed: 50,
				},
			],
		]),
		semanticEdges: new Map([["sig|index|123|5|0.55", { edges: [semantic], lastUsed: 100 }]]),
		topicLabels: new Map([["a b c", "Test Topic"]]),
	};
}

describe("encodeTopicCaches / decodeTopicCaches", () => {
	it("round-trips every cached graph exactly", () => {
		const original = sampleSnapshot();
		const decoded = decodeTopicCaches(encodeTopicCaches(original));
		expect(decoded).not.toBeNull();
		expect(decoded?.activeSignature).toBe(original.activeSignature);
		expect([...decoded!.graphs.keys()].sort()).toEqual([...original.graphs.keys()].sort());
		for (const [signature, entry] of original.graphs) {
			const decodedEntry = decoded?.graphs.get(signature);
			expect(decodedEntry?.granularityLadder).toEqual(entry.granularityLadder);
			expect(decodedEntry?.resolution).toBe(entry.resolution);
			expect([...decodedEntry!.leiden.keys()].sort()).toEqual([...entry.leiden.keys()].sort());
			for (const [key, partition] of entry.leiden) {
				expect(decodedEntry?.leiden.get(key)).toEqual(partition);
			}
		}
		expect([...decoded!.semanticEdges.keys()]).toEqual([...original.semanticEdges.keys()]);
		expect(decoded?.semanticEdges.get("sig|index|123|5|0.55")?.edges).toEqual(
			original.semanticEdges.get("sig|index|123|5|0.55")?.edges,
		);
		expect([...decoded!.topicLabels]).toEqual([...original.topicLabels]);
	});

	it("round-trips empty optional caches", () => {
		const original: TopicCacheSnapshot = {
			activeSignature: "sig",
			graphs: new Map([
				["sig", { leiden: new Map([["7:1:fused", { "a.md": 0 }]]), granularityLadder: null, resolution: null, lastUsed: 1 }],
			]),
			semanticEdges: new Map(),
			topicLabels: new Map(),
		};
		const decoded = decodeTopicCaches(encodeTopicCaches(original));
		expect(decoded?.graphs.get("sig")?.granularityLadder).toBeNull();
		expect(decoded?.graphs.get("sig")?.resolution).toBeNull();
		expect(decoded?.semanticEdges.size).toBe(0);
		expect(decoded?.topicLabels.size).toBe(0);
		expect(decoded?.graphs.get("sig")?.leiden.get("7:1:fused")).toEqual({ "a.md": 0 });
	});

	it("shares one path list per graph across its partitions", () => {
		const encoded = encodeTopicCaches(sampleSnapshot());
		const fullGraph = encoded.graphs.find((graph) => graph.signature === "full-graph-sig");
		expect(fullGraph?.nodePaths.slice().sort()).toEqual(["a.md", "b.md", "c.md"]);
		// The wiki-only partition has no c.md — its slot is the -1 sentinel.
		const wikiPartition = fullGraph?.partitions["7:0.5:wiki"];
		expect(wikiPartition).toContain(-1);
		expect(wikiPartition).toHaveLength(3);
	});

	it("discards a ladder derived under different rules, keeping the rest of the entry", () => {
		// The regression: a persisted 10-rung ladder survived the switch to a
		// 7-rung derivation, because the cache is keyed by graph signature —
		// which cannot notice that the code computing the ladder changed.
		const encoded = encodeTopicCaches(sampleSnapshot());
		const stale = structuredClone(encoded);
		for (const graph of stale.graphs) graph.granularityLadderRules = "rules-from-an-older-build";

		const decoded = decodeTopicCaches(stale);
		expect(decoded).not.toBeNull();
		const entry = decoded?.graphs.get("full-graph-sig");
		expect(entry?.granularityLadder).toBeNull();
		// The expensive partitions are unaffected — only the ladder is re-derived.
		expect(entry?.leiden.get("7:1:fused")).toEqual({ "a.md": 0, "b.md": 0, "c.md": 1 });
	});

	it("rejects payloads from another schema version or malformed shapes", () => {
		const encoded = encodeTopicCaches(sampleSnapshot());
		expect(decodeTopicCaches({ ...encoded, version: 999 })).toBeNull();
		expect(decodeTopicCaches(null)).toBeNull();
		expect(decodeTopicCaches("junk")).toBeNull();
		expect(decodeTopicCaches({ ...encoded, graphs: "not-an-array" })).toBeNull();
		// A partition whose length disagrees with its graph's path list is corrupt.
		const corrupt = structuredClone(encoded);
		corrupt.graphs[0].partitions["7:1:fused"] = [0];
		expect(decodeTopicCaches(corrupt)).toBeNull();
	});
});

describe("swapActiveGraphCache", () => {
	it("archives the outgoing graph and restores it when its signature returns", () => {
		// Establish a "full graph" slot with content.
		swapActiveGraphCache("swap-full");
		topicCaches.leiden.set("7:1:fused", { "a.md": 0, "b.md": 1 });
		topicCaches.granularityLadder = [0.5, 1.5];

		// Immerse: different signature, nothing cached for it yet.
		expect(swapActiveGraphCache("swap-immersed")).toBe(false);
		expect(topicCaches.leiden.size).toBe(0);
		expect(topicCaches.granularityLadder).toBeNull();
		topicCaches.leiden.set("7:1:fused", { "a.md": 0 });

		// Exit immerse: the full graph's derivations come back untouched.
		expect(swapActiveGraphCache("swap-full")).toBe(true);
		expect(topicCaches.leiden.get("7:1:fused")).toEqual({ "a.md": 0, "b.md": 1 });
		expect(topicCaches.granularityLadder).toEqual([0.5, 1.5]);

		// And re-immersing restores the immersed slot too.
		expect(swapActiveGraphCache("swap-immersed")).toBe(true);
		expect(topicCaches.leiden.get("7:1:fused")).toEqual({ "a.md": 0 });
	});

	it("keeps granularity per graph across an immerse round-trip", () => {
		// Full graph viewed at γ 1.0.
		swapActiveGraphCache("res-full");
		topicCaches.leiden.set("7:1:fused", { "a.md": 0 });
		setActiveGraphResolution(1.0);

		// Immerse and dial the topics finer — a statement about the subset.
		swapActiveGraphCache("res-immersed", 1.0);
		topicCaches.leiden.set("7:4.2:fused", { "a.md": 0 });
		setActiveGraphResolution(4.2);

		// Exiting restores the full graph's own γ, not the immersed one.
		expect(swapActiveGraphCache("res-full", 4.2)).toBe(true);
		expect(topicCaches.resolution).toBe(1.0);

		// …and re-immersing brings the subset's γ back.
		expect(swapActiveGraphCache("res-immersed", 1.0)).toBe(true);
		expect(topicCaches.resolution).toBe(4.2);
	});

	it("leaves resolution null for a graph never assigned one", () => {
		swapActiveGraphCache("res-fresh-a");
		topicCaches.leiden.set("7:1:fused", { "a.md": 0 });
		setActiveGraphResolution(2.2);
		// A graph seen for the first time has no γ of its own — the caller keeps
		// the current global setting rather than being moved.
		swapActiveGraphCache("res-fresh-b", 2.2);
		expect(topicCaches.resolution).toBeNull();
	});

	it("treats a swap to the current signature as a restore no-op", () => {
		swapActiveGraphCache("swap-same");
		topicCaches.leiden.set("7:1:fused", { "a.md": 0 });
		expect(swapActiveGraphCache("swap-same")).toBe(true);
		expect(topicCaches.leiden.size).toBe(1);
	});

	it("does not archive a slot that never derived anything", () => {
		swapActiveGraphCache("swap-empty");
		expect(topicCaches.leiden.size).toBe(0);
		swapActiveGraphCache("swap-elsewhere");
		// Coming back finds nothing archived — the empty slot wasn't kept.
		expect(swapActiveGraphCache("swap-empty")).toBe(false);
	});

	it("evicts the least recently used graph past the cap", () => {
		// Fill well past MAX_CACHED_GRAPHS with distinct non-empty graphs.
		for (let i = 0; i < 8; i++) {
			swapActiveGraphCache(`swap-evict-${i}`);
			topicCaches.leiden.set("7:1:fused", { "a.md": i });
		}
		// The earliest graphs must have been evicted…
		expect(swapActiveGraphCache("swap-evict-0")).toBe(false);
		// …while the most recent previous one survives. (Returning to 0 above
		// re-keyed the slot, so the latest graph was archived, not lost.)
		expect(swapActiveGraphCache("swap-evict-7")).toBe(true);
		expect(topicCaches.leiden.get("7:1:fused")).toEqual({ "a.md": 7 });
	});
});

describe("semantic edge set cache", () => {
	it("stores and retrieves edge sets by key, missing on unknown keys", () => {
		const edges: GraphEdge[] = [{ source: "a.md", target: "b.md", weight: 0.9, type: "semantic" }];
		setCachedSemanticEdges("sem-key-1", edges);
		expect(getCachedSemanticEdges("sem-key-1")).toEqual(edges);
		expect(getCachedSemanticEdges("sem-key-unknown")).toBeNull();
	});

	it("keeps multiple keys alive at once (immerse round-trip)", () => {
		const full: GraphEdge[] = [{ source: "a.md", target: "b.md", weight: 0.9, type: "semantic" }];
		const immersed: GraphEdge[] = [{ source: "a.md", target: "c.md", weight: 0.8, type: "semantic" }];
		setCachedSemanticEdges("sem-full", full);
		setCachedSemanticEdges("sem-immersed", immersed);
		expect(getCachedSemanticEdges("sem-full")).toEqual(full);
		expect(getCachedSemanticEdges("sem-immersed")).toEqual(immersed);
	});
});

describe("snapshotTopicCaches", () => {
	it("includes the active graph and archived graphs", () => {
		swapActiveGraphCache("snap-a");
		topicCaches.leiden.set("7:1:fused", { "a.md": 0 });
		swapActiveGraphCache("snap-b");
		topicCaches.leiden.set("7:1:fused", { "b.md": 1 });

		const snapshot = snapshotTopicCaches();
		expect(snapshot.activeSignature).toBe("snap-b");
		expect(snapshot.graphs.get("snap-a")?.leiden.get("7:1:fused")).toEqual({ "a.md": 0 });
		expect(snapshot.graphs.get("snap-b")?.leiden.get("7:1:fused")).toEqual({ "b.md": 1 });
	});
});
