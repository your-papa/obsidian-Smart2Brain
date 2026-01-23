/**
 * Provider Registry
 *
 * This module provides functions for looking up and listing providers.
 * It serves as the central registry for both built-in and custom providers.
 *
 * Built-in providers are imported from the builtin module.
 * Custom providers are passed in at runtime from user configuration.
 */

import { builtInProviders } from "./builtin/index";
import type {
	BuiltInProviderDefinition,
	CustomProviderDefinition,
	ProviderDefinition,
	StoredCustomProviderDefinition,
} from "./types";

// ============================================================================
// Built-in Provider IDs
// ============================================================================

/**
 * List of all built-in provider IDs.
 * Derived from the builtInProviders record to ensure consistency.
 */
export const BUILT_IN_PROVIDER_IDS = ["openai", "anthropic", "ollama"] as const;

/**
 * Type representing valid built-in provider IDs.
 */
export type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number];

// ============================================================================
// Registry Functions
// ============================================================================

/**
 * Gets a built-in provider definition by ID.
 *
 * @param id - The provider ID to look up
 * @returns The built-in provider definition, or undefined if not found
 *
 * @example
 * ```typescript
 * const openai = getBuiltInProvider("openai");
 * if (openai) {
 *   console.log(openai.displayName); // "OpenAI"
 * }
 * ```
 */
export function getBuiltInProvider(id: string): BuiltInProviderDefinition | undefined {
	if (isBuiltInProvider(id)) {
		return builtInProviders[id];
	}
	return undefined;
}

/**
 * Checks if a provider ID corresponds to a built-in provider.
 *
 * @param id - The provider ID to check
 * @returns true if the ID is a built-in provider, false otherwise
 *
 * @example
 * ```typescript
 * isBuiltInProvider("openai"); // true
 * isBuiltInProvider("my-custom"); // false
 * ```
 */
export function isBuiltInProvider(id: string): id is BuiltInProviderId {
	return BUILT_IN_PROVIDER_IDS.includes(id as BuiltInProviderId);
}

/**
 * Gets a provider definition by ID, searching both built-in and custom providers.
 *
 * Built-in providers take precedence over custom providers with the same ID.
 *
 * Note: For custom providers, accepts StoredCustomProviderDefinition (without runtime methods)
 * since stored definitions don't include createRuntimeDefinition/validateAuth/discoverModels.
 * The return type reflects what's actually available from the matched provider.
 *
 * @param id - The provider ID to look up
 * @param customProviders - Array of custom provider definitions (stored format)
 * @returns The provider definition, or undefined if not found
 *
 * @example
 * ```typescript
 * const provider = getProvider("openai", customProviders);
 * if (provider) {
 *   console.log(provider.displayName);
 * }
 * ```
 */
export function getProvider(
	id: string,
	customProviders: StoredCustomProviderDefinition[],
): BuiltInProviderDefinition | StoredCustomProviderDefinition | undefined {
	// First, check built-in providers
	const builtIn = getBuiltInProvider(id);
	if (builtIn) {
		return builtIn;
	}

	// Then, check custom providers
	return customProviders.find((p) => p.id === id);
}

/**
 * Lists all provider IDs (both built-in and custom).
 *
 * Returns unique IDs - if a custom provider has the same ID as a built-in
 * provider, it only appears once.
 *
 * @param customProviders - Array of custom provider definitions (stored format)
 * @returns Array of all unique provider IDs
 *
 * @example
 * ```typescript
 * const ids = listAllProviderIds(customProviders);
 * // ["openai", "anthropic", "ollama", "my-custom"]
 * ```
 */
export function listAllProviderIds(customProviders: StoredCustomProviderDefinition[]): string[] {
	const builtInIds = [...BUILT_IN_PROVIDER_IDS] as string[];
	const customIds = customProviders.map((p) => p.id).filter((id) => !isBuiltInProvider(id)); // Exclude duplicates

	return [...builtInIds, ...customIds];
}

// ============================================================================
// Re-exports
// ============================================================================

// Re-export types for convenience
export type {
	ProviderDefinition,
	BuiltInProviderDefinition,
	CustomProviderDefinition,
	StoredCustomProviderDefinition,
	BaseProviderDefinition,
	StandardAuthFieldKey,
	AuthMethod,
	FieldBasedAuth,
	OAuthAuth,
	OAuthTokens,
	AuthFieldDefinition,
	ProviderCapabilities,
	ProviderSetupInstructions,
	AuthValidationResult,
	DiscoveredModels,
	RuntimeAuthState,
	RuntimeFieldBasedAuthState,
	RuntimeOAuthAuthState,
	StoredAuthState,
	StoredFieldBasedAuthState,
	StoredOAuthAuthState,
	ChatModelConfig,
	EmbedModelConfig,
} from "./types";

// Re-export errors
export {
	ProviderRegistryError,
	ProviderAuthError,
	ProviderEndpointError,
	ProviderNotFoundError,
	ModelNotFoundError,
	ProviderImportError,
} from "./errors";

// Re-export registry
export { ProviderRegistry } from "./registry";

// Re-export helpers
export { validateCustomProviderId, parseHeadersJson } from "./helpers";

// Re-export built-in providers
export { builtInProviders } from "./builtin/index";
export {
	openaiProvider,
	anthropicProvider,
	ollamaProvider,
} from "./builtin/index";

// Re-export custom provider factory
export {
	createCustomOpenAICompatibleProvider,
	type CreateCustomOpenAICompatibleProviderOptions,
} from "./custom/index";
