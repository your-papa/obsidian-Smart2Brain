import { describe, expect, it } from "vitest";

import { selectIndexRestoreSource, summarizeValidationProgressCounts } from "../../src/vectorstore/VectorStoreService";
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

describe("selectIndexRestoreSource", () => {
    it("prefers newer runtime data over a stale file snapshot", () => {
        const source = selectIndexRestoreSource({
            runtime: {
                providerId: "openai",
                modelId: "text-embedding-3-large",
                documentCount: 2000,
                lastUpdated: 2_000,
            },
            file: {
                providerId: "openai",
                modelId: "text-embedding-3-large",
                documents: new Array(1500).fill(null),
                lastUpdated: 1_000,
            },
            expectedProviderId: "openai",
            expectedModelId: "text-embedding-3-large",
        });

        expect(source).toBe("runtime");
    });

    it("uses the file snapshot when runtime data is missing", () => {
        const source = selectIndexRestoreSource({
            runtime: null,
            file: {
                providerId: "openai",
                modelId: "text-embedding-3-small",
                documents: new Array(20).fill(null),
                lastUpdated: 1_000,
            },
            expectedProviderId: "openai",
            expectedModelId: "text-embedding-3-small",
        });

        expect(source).toBe("file");
    });

    it("ignores mismatched storage sources", () => {
        const source = selectIndexRestoreSource({
            runtime: {
                providerId: "openai",
                modelId: "text-embedding-3-small",
                documentCount: 10,
                lastUpdated: 1_000,
            },
            file: {
                providerId: "ollama",
                modelId: "nomic-embed-text",
                documents: new Array(10).fill(null),
                lastUpdated: 2_000,
            },
            expectedProviderId: "openai",
            expectedModelId: "text-embedding-3-large",
        });

        expect(source).toBe("none");
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
