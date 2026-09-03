import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";

import {
	BulkAttemptMarker,
	MOBILE_BULK_BASE_DELAY_MS,
	MOBILE_BULK_MAX_DELAY_MS,
	bulkBatchPauseMs,
	bulkCheckpointPauseMs,
	bulkStartDelayMs,
	orderForBulkIndexing,
	scheduleBulkRun,
} from "../../src/search/bulkPacing";

/*
 * The pacing and crash-backoff shared by the lexical and embedding bulk
 * indexers (#430, #432). The values encode on-device measurements; these tests
 * pin the *shape* — mobile-only pauses, delay doubling per crashed attempt with
 * a cap, marker set on start and cleared on completion — so a refactor cannot
 * silently drop the backoff.
 */

function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		removeItem: (key: string) => void map.delete(key),
		clear: () => map.clear(),
		key: () => null,
		get length() {
			return map.size;
		},
	} as Storage;
}

const platform = Platform as { isMobile: boolean };

beforeEach(() => {
	vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
	platform.isMobile = false;
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("pauses", () => {
	it("are real on mobile and bare yields on desktop", () => {
		platform.isMobile = false;
		expect(bulkBatchPauseMs()).toBe(0);
		expect(bulkCheckpointPauseMs()).toBe(0);
		platform.isMobile = true;
		expect(bulkBatchPauseMs()).toBeGreaterThan(0);
		expect(bulkCheckpointPauseMs()).toBeGreaterThan(bulkBatchPauseMs());
	});
});

describe("bulkStartDelayMs", () => {
	it("never delays on desktop, whatever the crash history", () => {
		platform.isMobile = false;
		expect(bulkStartDelayMs(0)).toBe(0);
		expect(bulkStartDelayMs(5)).toBe(0);
	});

	it("doubles the mobile base delay per crashed attempt, capped", () => {
		platform.isMobile = true;
		expect(bulkStartDelayMs(0)).toBe(MOBILE_BULK_BASE_DELAY_MS);
		expect(bulkStartDelayMs(1)).toBe(MOBILE_BULK_BASE_DELAY_MS * 2);
		expect(bulkStartDelayMs(2)).toBe(MOBILE_BULK_BASE_DELAY_MS * 4);
		expect(bulkStartDelayMs(20)).toBe(MOBILE_BULK_MAX_DELAY_MS);
	});
});

describe("BulkAttemptMarker", () => {
	it("keys per indexer and vault, counts attempts, and clears on completion", () => {
		const marker = new BulkAttemptMarker("embedding", "vault-1");
		expect(marker.read()).toBe(0);
		marker.markAttempt();
		expect(localStorage.getItem("s2b-embedding-bulk-attempts:vault-1")).toBe("1");
		marker.markAttempt();
		expect(marker.read()).toBe(2);
		// A different indexer on the same vault backs off independently.
		expect(new BulkAttemptMarker("lexical", "vault-1").read()).toBe(0);
		marker.clear();
		expect(marker.read()).toBe(0);
		expect(localStorage.getItem("s2b-embedding-bulk-attempts:vault-1")).toBeNull();
	});

	it("treats garbage as no crashed attempts", () => {
		localStorage.setItem("s2b-embedding-bulk-attempts:vault-1", "nope");
		expect(new BulkAttemptMarker("embedding", "vault-1").read()).toBe(0);
	});
});

describe("scheduleBulkRun", () => {
	it("waits the backed-off delay on mobile before starting the work", async () => {
		vi.useFakeTimers();
		platform.isMobile = true;
		const marker = new BulkAttemptMarker("embedding", "vault-1");
		marker.markAttempt();
		marker.markAttempt(); // two crashed attempts → 4× base delay

		const work = vi.fn(async () => {});
		scheduleBulkRun("Test", marker, work);

		await vi.advanceTimersByTimeAsync(MOBILE_BULK_BASE_DELAY_MS * 4 - 1);
		expect(work).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(work).toHaveBeenCalledTimes(1);
	});

	it("starts at once on desktop", async () => {
		vi.useFakeTimers();
		platform.isMobile = false;
		const marker = new BulkAttemptMarker("embedding", "vault-1");
		marker.markAttempt();
		const work = vi.fn(async () => {});
		scheduleBulkRun("Test", marker, work);
		await vi.advanceTimersByTimeAsync(0);
		expect(work).toHaveBeenCalledTimes(1);
	});
});

describe("orderForBulkIndexing", () => {
	it("moves binary-extraction files (PDFs) after text files, keeping relative order", () => {
		const file = (path: string, extension: string) => ({ path, extension }) as never;
		const ordered = orderForBulkIndexing([
			file("a.pdf", "pdf"),
			file("b.md", "md"),
			file("c.pdf", "pdf"),
			file("d.md", "md"),
		]);
		expect(ordered.map((f: { path: string }) => f.path)).toEqual(["b.md", "d.md", "a.pdf", "c.pdf"]);
	});
});
