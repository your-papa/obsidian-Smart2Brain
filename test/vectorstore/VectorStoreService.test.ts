import { describe, expect, it } from "vitest";

import { formatEta, summarizeValidationProgressCounts } from "../../src/vectorstore/VectorStoreService";
import { getDefaultEmbeddingBatchSize, normalizeEmbeddingBatchSize } from "../../src/vectorstore/batchSize";

describe("embedding batch size helpers", () => {
	it("returns provider-specific defaults", () => {
		expect(getDefaultEmbeddingBatchSize("ollama")).toBe(10);
		expect(getDefaultEmbeddingBatchSize("omlx")).toBe(10);
		expect(getDefaultEmbeddingBatchSize("openai")).toBe(100);
		expect(getDefaultEmbeddingBatchSize("custom-provider")).toBe(50);
	});

	it("normalizes invalid custom values", () => {
		expect(normalizeEmbeddingBatchSize(undefined, "openai")).toBe(100);
		expect(normalizeEmbeddingBatchSize(0, "openai")).toBe(1);
		expect(normalizeEmbeddingBatchSize(99999, "openai")).toBe(2048);
	});
});

describe("summarizeValidationProgressCounts", () => {
	it("preserves already indexed files when resuming validation indexing", () => {
		expect(
			summarizeValidationProgressCounts({
				eligibleFileCount: 3000,
				pendingFileCount: 1000,
				validPendingFileCount: 1000,
			}),
		).toEqual({
			startingIndexedCount: 2000,
			totalCount: 3000,
		});
	});

	it("reduces the final total when some pending files are later skipped", () => {
		expect(
			summarizeValidationProgressCounts({
				eligibleFileCount: 3000,
				pendingFileCount: 1000,
				validPendingFileCount: 900,
			}),
		).toEqual({
			startingIndexedCount: 2000,
			totalCount: 2900,
		});
	});
});

describe("formatEta", () => {
	it("formats sub-minute durations in seconds", () => {
		expect(formatEta(5_000)).toBe("5s");
		expect(formatEta(59_000)).toBe("59s");
	});

	it("rounds up so in-flight work never reads as 0s", () => {
		expect(formatEta(200)).toBe("1s");
		expect(formatEta(0)).toBe("1s");
	});

	it("formats minutes and hours", () => {
		expect(formatEta(90_000)).toBe("2m");
		expect(formatEta(60 * 60_000)).toBe("1h");
		expect(formatEta(72 * 60_000)).toBe("1h 12m");
	});
});
