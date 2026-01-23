/**
 * Provider Definition Types
 *
 * Types for defining providers (built-in and custom).
 */

import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Component } from "svelte";
import type { AuthObject, ProviderAuthConfig } from "./auth.ts";
import type { ChatModelConfig } from "./models.ts";

/**
 * Props for provider logo components.
 */
export interface LogoProps {
	width?: number;
	height?: number;
	class?: string;
}

/**
 * Setup instructions for configuring a provider.
 */
export interface ProviderSetupInstructions {
	/** Step-by-step instructions for setting up the provider. */
	steps: string[];

	/** Optional link to an external resource (e.g., API key page). */
	link?: {
		url: string;
		text: string;
	};
}

/**
 * Result of validating provider authentication credentials.
 */
export type AuthValidationResult = { valid: true } | { valid: false; error: string };

/**
 * Base interface for all provider definitions.
 */
export interface BaseProviderDefinition {
	/** Unique identifier for this provider. */
	id: string;

	/** Human-readable name for the provider. */
	displayName: string;

	/** Optional logo component for displaying the provider's icon. */
	logo?: Component<LogoProps>;

	/** Instructions for setting up this provider. */
	setupInstructions: ProviderSetupInstructions;

	/** Authentication field definitions for this provider. At least one field must be required. */
	auth: ProviderAuthConfig;

	/** Creates a LangChain chat instance (e.g., ChatOpenAI, ChatAnthropic, ChatOllama). */
	createChatInstance: (auth: AuthObject, modelId: string, options?: Partial<ChatModelConfig>) => BaseChatModel;

	/** Validates authentication credentials for this provider. */
	validateAuth: (auth: AuthObject) => Promise<AuthValidationResult>;

	/** Discovers available models from the provider's API. */
	discoverModels: (auth: AuthObject) => Promise<string[]>;

	/** Creates a LangChain embedding instance (optional - use EmbeddingProviderDefinition for type safety). */
	createEmbeddingInstance?: (auth: AuthObject, modelId: string) => EmbeddingsInterface;
}

/**
 * Interface for providers that support embedding models.
 * Extends BaseProviderDefinition with required createEmbeddingInstance method.
 */
export interface EmbeddingProviderDefinition extends BaseProviderDefinition {
	/** Creates a LangChain embedding instance. */
	createEmbeddingInstance: (auth: AuthObject, modelId: string) => EmbeddingsInterface;
}

/**
 * Type guard to check if a provider supports embeddings.
 */
export function isEmbeddingProvider(provider: BaseProviderDefinition): provider is EmbeddingProviderDefinition {
	return typeof provider.createEmbeddingInstance === "function";
}
