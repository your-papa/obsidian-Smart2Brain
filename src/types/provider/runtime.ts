/**
 * Runtime Types
 *
 * Types for runtime authentication state and model factories.
 */

import type { OAuthTokens } from "./auth.ts";

/**
 * Field-based authentication state at runtime (secrets resolved).
 *
 * This is the resolved version of StoredFieldBasedAuthState:
 * - secretIds are looked up from SecretStorage
 * - Secret values are merged into the `values` object
 * - No secretIds property exists at runtime
 */
export interface RuntimeFieldBasedAuthState {
	/**
	 * Discriminator for the RuntimeAuthState union type.
	 * Always "field-based" for this interface.
	 */
	type: "field-based";

	/**
	 * All field values, including resolved secrets.
	 * Contains both plain values (e.g., baseUrl) and resolved secrets (e.g., apiKey).
	 */
	values: Record<string, string>;
}

/**
 * OAuth authentication state at runtime.
 * Identical to StoredOAuthAuthState - OAuth tokens don't need resolution.
 */
export interface RuntimeOAuthAuthState {
	/**
	 * Discriminator for the RuntimeAuthState union type.
	 * Always "oauth" for this interface.
	 */
	type: "oauth";

	/**
	 * OAuth tokens for authentication.
	 */
	tokens: OAuthTokens;
}

/**
 * Discriminated union type for runtime authentication state.
 *
 * This represents authentication credentials ready for use at runtime.
 * Unlike StoredAuthState, all secrets have been resolved from SecretStorage.
 */
export type RuntimeAuthState = RuntimeFieldBasedAuthState | RuntimeOAuthAuthState;

/**
 * Options passed to model factory functions.
 */
export type ModelOptions = Record<string, unknown>;

/**
 * Factory function that creates a LangChain chat model instance.
 */
export type ChatModelFactory = (options?: ModelOptions) => Promise<unknown>;

/**
 * Factory function that creates a LangChain embedding model instance.
 */
export type EmbeddingModelFactory = (options?: ModelOptions) => Promise<unknown>;

/**
 * Runtime provider definition containing model factories.
 *
 * Created by a provider's `createRuntimeDefinition` method
 * and used by the ProviderRegistry to instantiate models at runtime.
 */
export interface RuntimeProviderDefinition {
	/**
	 * Map of model name → factory function for chat models.
	 */
	chatModels: Record<string, ChatModelFactory>;

	/**
	 * Map of model name → factory function for embedding models.
	 */
	embeddingModels: Record<string, EmbeddingModelFactory>;

	/**
	 * Default chat model to use if none specified.
	 */
	defaultChatModel?: string;

	/**
	 * Default embedding model to use if none specified.
	 */
	defaultEmbeddingModel?: string;
}
