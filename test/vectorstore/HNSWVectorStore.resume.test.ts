import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

/*
 * #432 part 2: a bulk embed run can be killed by the OS mid-build. Document
 * rows are durable on every `upsert`, but the graph topology is saved on a
 * debounce and at checkpoints (`flush`). Rows written after the last save used
 * to be silently unsearchable after a reopen while still counting as indexed,
 * so nothing ever repaired them. `loadGraph` now re-links such rows.
 */

import { HNSWVectorStore } from "../../src/vectorstore/HNSWVectorStore";
import type { DocumentVector } from "../../src/vectorstore/types";

function doc(path: string, vector: number[]): DocumentVector {
	return { id: `${path}#0`, path, mtime: 1, checksum: "c", chunkIndex: 0, vector: new Float32Array(vector) };
}

async function openStore(): Promise<HNSWVectorStore> {
	const store = new HNSWVectorStore("vault-1", "index-1");
	await store.open();
	return store;
}

/** A build writes the metadata record first (`buildFullIndex` → `setMetadata`); mirror that. */
async function openForBuild(): Promise<HNSWVectorStore> {
	const store = await openStore();
	await store.setMetadata("p", "m", 2);
	return store;
}

/** Graph-side state, to prove hits came through the HNSW graph and not the brute-force fallback. */
function graphNodeCount(store: HNSWVectorStore): number | undefined {
	return (store as unknown as { hnswIndex: { nodes: Map<number, unknown> } | null }).hnswIndex?.nodes.size;
}

beforeEach(() => {
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("IDBKeyRange", IDBKeyRange);
	// Only the debounce timer is faked, so the pending graph save never fires —
	// that is the "killed before the debounce" state. fake-indexeddb schedules
	// its own work on setImmediate, which must keep running.
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("HNSWVectorStore — resuming after an interrupted build", () => {
	it("re-links rows written after the last checkpoint on the next open", async () => {
		const first = await openForBuild();
		await first.upsert(doc("a.md", [1, 0, 0]));
		await first.upsert(doc("b.md", [0, 1, 0]));
		await first.flush(); // checkpoint: a and b are in the persisted graph
		await first.upsert(doc("c.md", [0, 0, 1])); // after the checkpoint; never saved
		// No close(): the process died here.

		const second = await openStore();
		const hits = await second.search(new Float32Array([0, 0, 1]), 1);
		expect(hits.map((h) => h.doc.path)).toEqual(["c.md"]);
		expect(graphNodeCount(second)).toBe(3);
		// And the earlier rows are still reachable through the graph.
		const older = await second.search(new Float32Array([1, 0, 0]), 1);
		expect(older.map((h) => h.doc.path)).toEqual(["a.md"]);
		await second.close();
	});

	it("builds the graph from rows alone when no checkpoint was ever written", async () => {
		const first = await openForBuild();
		await first.upsert(doc("a.md", [1, 0]));
		await first.upsert(doc("b.md", [0, 1]));

		const second = await openStore();
		expect(await second.count()).toBe(2);
		const hits = await second.search(new Float32Array([0, 1]), 1);
		expect(hits.map((h) => h.doc.path)).toEqual(["b.md"]);
		expect(graphNodeCount(second)).toBe(2);
		await second.close();
	});

	it("flush() persists the pending graph immediately instead of on the debounce", async () => {
		const first = await openForBuild();
		await first.upsert(doc("a.md", [1, 0]));
		await first.flush();

		// The persisted topology alone must describe the node — no re-link log.
		const second = await openStore();
		const persisted = second as unknown as { getGraphHeader: () => Promise<unknown> };
		expect(await persisted.getGraphHeader()).not.toBeNull();
		await second.search(new Float32Array([1, 0]), 1);
		expect(graphNodeCount(second)).toBe(1);
		await second.close();
	});
});
