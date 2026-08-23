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
	vi.useRealTimers();
});

describe("deleteDatabase", () => {
	it("resolves when the request succeeds", async () => {
		const request = createRequestStub();
		stubIndexedDB(request);

		const promise = deleteDatabase("db");
		request.onsuccess?.();

		await expect(promise).resolves.toBeUndefined();
	});

	it("rejects with the request error when deletion fails", async () => {
		const request = createRequestStub();
		stubIndexedDB(request);

		const promise = deleteDatabase("db");
		request.error = new Error("quota exceeded");
		request.onerror?.();

		await expect(promise).rejects.toThrow("quota exceeded");
	});

	it("rejects with a named fallback when the request exposes no error", async () => {
		const request = createRequestStub();
		stubIndexedDB(request);

		const promise = deleteDatabase("my-db");
		request.onerror?.();

		await expect(promise).rejects.toThrow('Failed to delete IndexedDB database "my-db"');
	});

	it("still resolves when a blocked deletion later completes", async () => {
		vi.useFakeTimers();
		const request = createRequestStub();
		stubIndexedDB(request);

		const promise = deleteDatabase("db");
		// Blocked is not terminal: the delete goes through once the other connection closes.
		request.onblocked?.();
		vi.advanceTimersByTime(1000);
		request.onsuccess?.();

		await expect(promise).resolves.toBeUndefined();
	});

	it("rejects when a deletion stays blocked past the timeout", async () => {
		vi.useFakeTimers();
		const request = createRequestStub();
		stubIndexedDB(request);

		const promise = deleteDatabase("stuck-db");
		const assertion = expect(promise).rejects.toThrow(/blocked by an open connection/);
		request.onblocked?.();
		await vi.advanceTimersByTimeAsync(5000);

		await assertion;
	});

	it("rejects when deleteDatabase throws synchronously", async () => {
		vi.stubGlobal("indexedDB", {
			deleteDatabase: vi.fn(() => {
				throw new Error("indexedDB unavailable");
			}),
		});

		await expect(deleteDatabase("db")).rejects.toThrow("indexedDB unavailable");
	});
});
