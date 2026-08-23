import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteDatabase } from "../../src/vectorstore/types";

/**
 * Minimal stand-in for the slice of `IDBOpenDBRequest` the helper touches. The real
 * request reports outcomes through events, which is the whole reason the helper exists —
 * a bare `indexedDB.deleteDatabase()` call resolves nothing and swallows failures.
 */
function createRequestStub() {
	return {
		onsuccess: null as (() => void) | null,
		onerror: null as (() => void) | null,
		onblocked: null as (() => void) | null,
		error: null as Error | null,
	};
}

function stubIndexedDB(request: ReturnType<typeof createRequestStub>) {
	vi.stubGlobal("indexedDB", {
		deleteDatabase: vi.fn(() => request),
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("deleteDatabase", () => {
	it("reports a successful deletion", async () => {
		const request = createRequestStub();
		stubIndexedDB(request);

		const promise = deleteDatabase("db");
		request.onsuccess?.();

		await expect(promise).resolves.toEqual({ status: "deleted" });
	});

	it("reports the request error when deletion fails", async () => {
		const request = createRequestStub();
		stubIndexedDB(request);

		const promise = deleteDatabase("db");
		request.error = new Error("quota exceeded");
		request.onerror?.();

		const result = await promise;
		expect(result.status).toBe("error");
		expect(result).toMatchObject({ error: { message: "quota exceeded" } });
	});

	it("falls back to a named error when the request exposes none", async () => {
		const request = createRequestStub();
		stubIndexedDB(request);

		const promise = deleteDatabase("my-db");
		request.onerror?.();

		const result = await promise;
		expect(result.status).toBe("error");
		expect(result).toMatchObject({ error: { message: 'Failed to delete IndexedDB database "my-db"' } });
	});

	it("reports blocked immediately instead of waiting", async () => {
		const request = createRequestStub();
		stubIndexedDB(request);

		const promise = deleteDatabase("db");
		request.onblocked?.();

		// Resolves without any timer advancing: an IndexedDB delete request cannot be
		// cancelled, so there is nothing to wait for — the browser completes it once the
		// blocking connection closes.
		await expect(promise).resolves.toEqual({ status: "blocked" });
	});

	it("never rejects when deleteDatabase throws synchronously", async () => {
		vi.stubGlobal("indexedDB", {
			deleteDatabase: vi.fn(() => {
				throw new Error("indexedDB unavailable");
			}),
		});

		const result = await deleteDatabase("db");
		expect(result.status).toBe("error");
		expect(result).toMatchObject({ error: { message: "indexedDB unavailable" } });
	});
});
