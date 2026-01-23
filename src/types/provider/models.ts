/**
 * Model Configuration Types
 *
 * Types for configuring chat and embedding models.
 */

/**
 * Configuration for a chat model.
 * Stored in data.json under provider.chatModels[modelId]
 *
 * These values are passed to LangChain when creating the model instance.
 * LangChain may ignore unsupported options (e.g., temperature on reasoning models).
 */
export interface ChatModelConfig {
	/**
	 * Sampling temperature (0-2).
	 * Optional - some models (o1, o3, gpt-5) don't support temperature.
	 * If not set, LangChain uses its default.
	 */
	temperature?: number;

	/**
	 * Maximum context window in tokens.
	 * REQUIRED - used by LangChain's trimMessages() for context management.
	 * Also used by our UI to show context usage.
	 */
	contextWindow: number;
}

/**
 * Configuration for an embedding model.
 * Stored in data.json under provider.embedModels[modelId]
 *
 * NOTE: These values are used by our retrieval system, NOT passed to LangChain.
 * LangChain embedding models don't typically need configuration beyond the model name.
 */
export interface EmbedModelConfig {
	/**
	 * Similarity threshold for retrieval (0-1).
	 * Used by our retrieval system to filter results.
	 * A higher value means only more similar results are returned.
	 */
	similarityThreshold: number;
}
