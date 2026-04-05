import { describe, expect, it } from "vitest";

import { summarizeValidationProgressCounts } from "../../src/vectorstore/VectorStoreService";
import { getDefaultEmbeddingBatchSize, normalizeEmbeddingBatchSize } from "../../src/vectorstore/batchSize";

describe("embedding batch size helpers", () => {
    it("returns provider-specific defaults", () => {
        expect(getDefaultEmbeddingBatchSize("ollama")).toBe(1);
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
