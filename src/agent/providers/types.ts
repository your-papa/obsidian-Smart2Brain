import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";

export type ModelOptions = Record<string, unknown>;

export type ChatModelFactory = (
	options?: ModelOptions,
) => Promise<BaseChatModel>;

export type EmbeddingModelFactory = (
	options?: ModelOptions,
) => Promise<EmbeddingsInterface>;

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

export type BuiltInProviderModelMap =
	| Record<string, string>
	| Record<string, BuiltInProviderModelMapEntry>;

export interface ProviderApiConfigOptions {
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	apiVersion?: string;
	organization?: string;
	project?: string;
	fetchImpl?: typeof fetch;
}

export interface BuiltInProviderOptions extends ProviderApiConfigOptions {
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
