import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type ModelOptions = Record<string, unknown>;

export type ChatModelFactory = (options?: ModelOptions) => Promise<BaseChatModel>;

export type EmbeddingModelFactory = (options?: ModelOptions) => Promise<EmbeddingsInterface>;

export interface ProviderDefinition {
	chatModels?: Record<string, ChatModelFactory>;
	embeddingModels?: Record<string, EmbeddingModelFactory>;
	defaultChatModel?: string;
	defaultEmbeddingModel?: string;
}

export interface BuiltInProviderModelMapEntry {
	model: string;
	options?: ModelOptions;
}

export type BuiltInProviderModelMap = Record<string, string> | Record<string, BuiltInProviderModelMapEntry>;

/**
 * Runtime provider config - contains actual secret values
 * Used when making API calls
 */
export interface ProviderApiConfigOptions {
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	apiVersion?: string;
	organization?: string;
	project?: string;
	fetchImpl?: typeof fetch;
}

/**
 * Stored provider config - contains secret IDs instead of values
 * This is what gets persisted to data.json
 */
export interface StoredProviderApiConfig {
	apiKeyId?: string; // Reference to SecretStorage
	baseUrl?: string;
	headers?: Record<string, string>;
	apiVersion?: string;
	organization?: string;
	project?: string;
}

export interface BuiltInProviderOptions extends ProviderApiConfigOptions {
	chatModels?: BuiltInProviderModelMap;
	embeddingModels?: BuiltInProviderModelMap;
	defaultChatModel?: string;
	defaultEmbeddingModel?: string;
}

/**
 * Stored version of BuiltInProviderOptions - uses secret IDs
 */
export interface StoredProviderOptions extends StoredProviderApiConfig {
	chatModels?: BuiltInProviderModelMap;
	embeddingModels?: BuiltInProviderModelMap;
	defaultChatModel?: string;
	defaultEmbeddingModel?: string;
}

export interface SapAICoreModelEntry extends BuiltInProviderModelMapEntry {}

export interface SapAICoreProviderOptions extends ProviderApiConfigOptions {
	chatModels?: Record<string, SapAICoreModelEntry>;
	embeddingModels?: Record<string, SapAICoreModelEntry>;
	defaultChatModel?: string;
	defaultEmbeddingModel?: string;
}
