/**
 * Provider Definition Types
 *
 * Types for defining providers (built-in and custom).
 */

import type { AuthMethod } from "./auth.ts";
import type { RuntimeAuthState, RuntimeProviderDefinition } from "./runtime.ts";

/**
 * Declares what features a provider supports.
 */
export interface ProviderCapabilities {
	/** Whether this provider supports chat/completion models. */
	chat: boolean;

	/** Whether this provider supports embedding models. */
	embedding: boolean;

	/** Whether this provider can discover models via API. */
	modelDiscovery: boolean;
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
 * Result of discovering models from a provider's API.
 */
export interface DiscoveredModels {
	/** Available chat model IDs discovered from the provider's API. */
	chat: string[];

	/** Available embedding model IDs discovered from the provider's API. */
	embedding: string[];
}

/**
 * Base interface for all provider definitions.
 */
export interface BaseProviderDefinition {
	/** Unique identifier for this provider. */
	id: string;

	/** Human-readable name for the provider. */
	displayName: string;

	/** Instructions for setting up this provider. */
	setupInstructions: ProviderSetupInstructions;

	/** Authentication configuration for this provider. */
	auth: AuthMethod;

	/** What features this provider supports. */
	capabilities: ProviderCapabilities;

	/** Creates a runtime provider definition from authentication state. */
	createRuntimeDefinition: (auth: RuntimeAuthState) => Promise<RuntimeProviderDefinition>;

	/** Validates authentication credentials for this provider. */
	validateAuth: (auth: RuntimeAuthState) => Promise<AuthValidationResult>;

	/** Discovers available models from the provider's API. */
	discoverModels: (auth: RuntimeAuthState) => Promise<DiscoveredModels>;
}

/**
 * Built-in provider definition for providers shipped with the plugin.
 */
export interface BuiltInProviderDefinition extends BaseProviderDefinition {
	/** Discriminator indicating this is a built-in provider. */
	isBuiltIn: true;
}

/**
 * Custom provider definition for providers created by users.
 */
export interface CustomProviderDefinition extends BaseProviderDefinition {
	/** Discriminator indicating this is a custom (user-created) provider. */
	isBuiltIn: false;

	/** The base provider template this custom provider is based on. */
	baseProviderId: string;

	/** Unix timestamp when this custom provider was created. */
	createdAt: number;
}

/**
 * Union type for any provider definition (built-in or custom).
 */
export type ProviderDefinition = BuiltInProviderDefinition | CustomProviderDefinition;

/**
 * Custom provider definition without runtime methods.
 *
 * This type represents what's actually stored in data.json for custom providers.
 * Runtime methods (createRuntimeDefinition, validateAuth, discoverModels) are
 * provided by the base provider template at runtime, not stored.
 */
export type StoredCustomProviderDefinition = Omit<
	CustomProviderDefinition,
	"createRuntimeDefinition" | "validateAuth" | "discoverModels"
>;
