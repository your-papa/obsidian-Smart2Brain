import { describe, expect, it } from "vitest";
import { LARGE_EMBEDDING_DIMENSIONS, largeDimensionHint } from "../../src/vectorstore/embeddingMemoryHint";

describe("largeDimensionHint", () => {
	it("hints only for wide vectors, and only once the width is known", () => {
		expect(largeDimensionHint("nomic-embed-text", undefined)).toBeNull();
		expect(largeDimensionHint("all-minilm", 384)).toBeNull();
		expect(largeDimensionHint("nomic-embed-text", 768)).toBeNull();
		expect(largeDimensionHint("text-embedding-3-small", LARGE_EMBEDDING_DIMENSIONS)).toContain(
			"text-embedding-3-small",
		);
		expect(largeDimensionHint("text-embedding-3-large", 3072)).toContain("3072");
	});
});
