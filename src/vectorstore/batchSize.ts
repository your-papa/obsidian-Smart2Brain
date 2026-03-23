export const MIN_EMBEDDING_BATCH_SIZE = 1;
export const MAX_EMBEDDING_BATCH_SIZE = 2048;

export function getDefaultEmbeddingBatchSize(providerId: string): number {
	switch (providerId) {
		case "openai":
		case "openrouter":
			return 100;
		case "ollama":
			return 1;
		default:
			return 50;
	}
}

export function normalizeEmbeddingBatchSize(value: number | null | undefined, providerId: string): number {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) {
		return getDefaultEmbeddingBatchSize(providerId);
	}

	return Math.min(MAX_EMBEDDING_BATCH_SIZE, Math.max(MIN_EMBEDDING_BATCH_SIZE, Math.trunc(parsed)));
}
