import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Regression: `clear()` used to recreate the in-memory HNSWWithDB wrapper without
 * deleting the *persisted* graph. Because clear() also resets `nextHnswId` to 0,
 * the next indexing run reassigned numeric ids that were already present in the
 * resurrected graph. `search()` resolves each hit through `numericToId` and
 * `continue`s on a miss, so those collisions silently dropped results — semantic
 * search returned too few results, or none at all, for valid queries.
 *
 * Measured in the test vault before the fix: 337 indexed chunks but 10,161 nodes
 * in the persisted graph, with only 377 surviving id mappings.
 */

const deleteIndex = vi.fn().mockResolvedValue(undefined);
const saveIndex = vi.fn().mockResolvedValue(undefined);
const loadIndex = vi.fn().mockResolvedValue(undefined);
const create = vi.fn();

vi.mock("hnsw", () => ({
	HNSWWithDB: {
		create: (...args: unknown[]) => create(...args),
	},
}));

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

import { HNSWVectorStore } from "../../src/vectorstore/HNSWVectorStore";

/**
 * Minimal IndexedDB stand-in. `clearStore` resolves on the *transaction's*
 * `oncomplete` (not the request's `onsuccess`), and clear() clears three stores in
 * sequence — so each transaction needs its own object with `oncomplete` fired
 * asynchronously, after the caller has had a chance to attach the handler.
 */
function fakeDb() {
	const store = {
		clear: () => ({ onerror: null as null | (() => void) }),
	};
	return {
		transaction: () => {
			const tx = {
				objectStore: () => store,
				oncomplete: null as null | (() => void),
				onerror: null as null | (() => void),
			};
			queueMicrotask(() => tx.oncomplete?.());
			return tx;
		},
		close: vi.fn(),
	};
}

function makeStore(): HNSWVectorStore {
	const store = new HNSWVectorStore("vault-1", "index-1");
	// Reach past the IndexedDB bootstrap; clear() only needs `db` and `dimensions`.
	Object.assign(store as unknown as Record<string, unknown>, {
		db: fakeDb(),
		dimensions: 4096,
	});
	return store;
}

describe("HNSWVectorStore.clear", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		create.mockResolvedValue({ deleteIndex, saveIndex, loadIndex });
	});

	it("deletes the persisted graph rather than only dropping the in-memory handle", async () => {
		const store = makeStore();
		const index = { deleteIndex, saveIndex, loadIndex };
		Object.assign(store as unknown as Record<string, unknown>, { hnswIndex: index });

		await store.clear();

		// The whole point: without this the graph survives in its own IndexedDB
		// database and is reloaded on the next open().
		expect(deleteIndex).toHaveBeenCalledTimes(1);
	});

	it("leaves a usable empty graph behind so later upserts can insert", async () => {
		const store = makeStore();
		Object.assign(store as unknown as Record<string, unknown>, {
			hnswIndex: { deleteIndex, saveIndex, loadIndex },
		});

		await store.clear();

		// Recreated after deletion, so indexing does not have to re-open it lazily.
		expect(create).toHaveBeenCalledTimes(1);
		expect((store as unknown as { hnswIndex: unknown }).hnswIndex).not.toBeNull();
	});

	it("resets the numeric id counter that the deleted graph was keyed on", async () => {
		const store = makeStore();
		Object.assign(store as unknown as Record<string, unknown>, {
			hnswIndex: { deleteIndex, saveIndex, loadIndex },
			nextHnswId: 10_161,
		});

		await store.clear();

		expect((store as unknown as { nextHnswId: number }).nextHnswId).toBe(0);
	});

	it("still clears when the persisted graph cannot be deleted", async () => {
		const store = makeStore();
		deleteIndex.mockRejectedValueOnce(new Error("db locked"));
		Object.assign(store as unknown as Record<string, unknown>, {
			hnswIndex: { deleteIndex, saveIndex, loadIndex },
		});

		// A failed delete must not abort clear() and strand the store mid-reset.
		await expect(store.clear()).resolves.toBeUndefined();
		expect((store as unknown as { nextHnswId: number }).nextHnswId).toBe(0);
	});

	it("drops any pending graph save so it cannot rewrite the cleared graph", async () => {
		const store = makeStore();
		Object.assign(store as unknown as Record<string, unknown>, {
			hnswIndex: { deleteIndex, saveIndex, loadIndex },
			hasPendingIndexSave: true,
		});

		await store.clear();

		expect((store as unknown as { hasPendingIndexSave: boolean }).hasPendingIndexSave).toBe(false);
	});
});
