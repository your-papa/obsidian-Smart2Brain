/**
 * Provider Types - Barrel Export
 *
 * Re-exports all provider-related types from their respective modules.
 */

// Model configuration types
export type { ChatModelConfig, EmbedModelConfig } from "./models";

// Auth types
export type {
	AuthObjectKey,
	AuthFieldDefinition,
	AuthObject,
	RequiredAuthField,
	OptionalAuthField,
	ProviderAuthConfig,
} from "./auth";

// Provider definition types
export type {
	LogoProps,
	ProviderSetupInstructions,
	AuthValidationResult,
	BaseProviderDefinition,
	EmbeddingProviderDefinition,
} from "./definition";

// Provider definition type guard
export { isEmbeddingProvider } from "./definition";

// Stored provider types
export type { CustomProviderMeta } from "./stored";
