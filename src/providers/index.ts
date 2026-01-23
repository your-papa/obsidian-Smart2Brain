/**
 * Provider Registry
 *
 * This module provides functions for looking up and listing providers.
 * It serves as the central registry for both built-in and custom providers.
 *
 * Built-in providers are defined in this folder (openai.ts, anthropic.ts, etc.)
 * Custom providers are managed at runtime via ProviderRegistry.
 */

import type { BaseProviderDefinition, CustomProviderMeta } from "../types/provider/index";
import { createOpenAICompatibleProvider } from "./openai-compatible";

// ============================================================================
// Built-in Provider IDs
// ============================================================================

/**
 * List of all built-in provider IDs.
 */
export const BUILT_IN_PROVIDER_IDS = ["openai", "anthropic", "ollama", "openrouter"] as const;

/**
 * Type representing valid built-in provider IDs.
 */
export type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number];

// ============================================================================
// Built-in Providers Map
// ============================================================================

import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";
// Import built-in providers
// TODO: These imports will work once the providers are migrated to new types
// For now, we cast them as unknown and handle type safety at runtime
import { openaiProvider } from "./openai";
import { openrouterProvider } from "./openrouter";

/**
 * Map of built-in provider ID to provider definition.
 */
export const builtInProviders: Record<BuiltInProviderId, unknown> = {
	openai: openaiProvider,
	anthropic: anthropicProvider,
	ollama: ollamaProvider,
	openrouter: openrouterProvider,
};

// ============================================================================
// Built-in Provider Lookup
// ============================================================================

/**
 * Gets a built-in provider definition by ID.
 *
 * @param id - The provider ID to look up
 * @returns The built-in provider definition, or undefined if not found
 */
export function getBuiltInProvider(id: string): BaseProviderDefinition | undefined {
	if (isBuiltInProvider(id)) {
		// TODO: Remove cast once providers are migrated to new types
		return builtInProviders[id] as BaseProviderDefinition;
	}
	return undefined;
}

/**
 * Gets a provider definition by ID, checking built-in providers first,
 * then custom providers.
 *
 * @param id - The provider ID to look up
 * @param customProviderMeta - Record of custom provider metadata keyed by ID
 * @returns The provider definition, or undefined if not found
 */
export function getProviderDefinition(
	id: string,
	customProviderMeta: Record<string, CustomProviderMeta> = {},
): BaseProviderDefinition | undefined {
	// Check built-in first
	const builtIn = getBuiltInProvider(id);
	if (builtIn) {
		return builtIn;
	}

	// Check custom providers
	const meta = customProviderMeta[id];
	if (meta) {
		return createOpenAICompatibleProvider({ id, ...meta });
	}

	return undefined;
}

/**
 * Gets all built-in provider definitions.
 *
 * @returns Array of all built-in provider definitions
 */
export function getAllBuiltInProviders(): BaseProviderDefinition[] {
	return BUILT_IN_PROVIDER_IDS.map((id) => builtInProviders[id] as BaseProviderDefinition);
}

/**
 * Checks if a provider ID corresponds to a built-in provider.
 *
 * @param id - The provider ID to check
 * @returns true if the ID is a built-in provider, false otherwise
 */
export function isBuiltInProvider(id: string): id is BuiltInProviderId {
	return BUILT_IN_PROVIDER_IDS.includes(id as BuiltInProviderId);
}

// ============================================================================
// Re-exports
// ============================================================================

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

// Re-export OpenAI-compatible factory
export { createOpenAICompatibleProvider } from "./openai-compatible";

// Re-export types from central location
export type {
	AuthObject,
	AuthObjectKey,
	AuthFieldDefinition,
	AuthValidationResult,
	BaseProviderDefinition,
	EmbeddingProviderDefinition,
	ChatModelConfig,
	CustomProviderMeta,
	EmbedModelConfig,
	LogoProps,
	ProviderAuthConfig,
	ProviderSetupInstructions,
	RequiredAuthField,
	OptionalAuthField,
} from "../types/provider/index";

export { isEmbeddingProvider } from "../types/provider/index";

// Re-export individual built-in providers for direct access
export { openaiProvider } from "./openai";
export { anthropicProvider } from "./anthropic";
export { ollamaProvider } from "./ollama";
export { openrouterProvider } from "./openrouter";
