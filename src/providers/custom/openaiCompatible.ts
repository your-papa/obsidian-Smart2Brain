/**
 * Custom OpenAI-compatible provider factory
 *
 * Factory function to create custom providers based on the OpenAI-compatible API.
 * Used for providers like Azure OpenAI, local LLM servers, and other OpenAI-compatible endpoints.
 */

import { discoverOpenAIModels, validateOpenAIAuth } from "../base/openaiCompatible";
import { buildFieldBasedAuth, validateCustomProviderId } from "../helpers";
import type {
	AuthValidationResult,
	CustomProviderDefinition,
	DiscoveredModels,
	FieldBasedAuth,
	ProviderCapabilities,
	ProviderSetupInstructions,
	RuntimeAuthState,
	RuntimeFieldBasedAuthState,
	RuntimeProviderDefinition,
} from "../types";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a custom OpenAI-compatible provider.
 */
export interface CreateCustomOpenAICompatibleProviderOptions {
	/**
	 * Unique identifier for this provider.
	 * Must be lowercase with no spaces, using dashes for separation.
	 * @example "azure-openai-prod", "local-llm", "my-provider"
	 */
	id: string;

	/**
	 * Human-readable name for the provider.
	 * Shown in the settings UI.
	 * @example "Azure OpenAI (Production)", "Local LLM Server"
	 */
	displayName: string;

	/**
	 * Array of existing provider IDs to check for duplicates.
	 * If not provided, no duplicate check is performed.
	 */
	existingIds?: string[];

	/**
	 * Custom setup instructions.
	 * If not provided, default instructions are used.
	 */
	setupInstructions?: ProviderSetupInstructions;

	/**
	 * Whether the API key is required for this provider.
	 * Defaults to true. Set to false for local servers that don't need authentication.
	 */
	apiKeyRequired?: boolean;

	/**
	 * Custom capabilities override.
	 * If not provided, defaults to { chat: true, embedding: true, modelDiscovery: false }.
	 */
	capabilities?: ProviderCapabilities;

	/**
	 * Custom createdAt timestamp.
	 * If not provided, Date.now() is used.
	 */
	createdAt?: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default setup instructions for custom OpenAI-compatible providers.
 */
const DEFAULT_SETUP_INSTRUCTIONS: ProviderSetupInstructions = {
	steps: [
		"Enter your API key and endpoint URL",
		"The endpoint should be OpenAI-compatible (e.g., http://localhost:8000/v1)",
		"Add models manually in the Models section below",
	],
};

/**
 * Default capabilities for custom providers.
 * Model discovery is enabled - uses OpenAI-compatible /models endpoint.
 */
const DEFAULT_CAPABILITIES: ProviderCapabilities = {
	chat: true,
	embedding: true,
	modelDiscovery: true,
};

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a custom OpenAI-compatible provider definition.
 *
 * This factory function creates a CustomProviderDefinition that:
 * - Has isBuiltIn set to false (literal)
 * - Uses "openai" as the baseProviderId
 * - Includes a createdAt timestamp
 * - Uses OpenAI-compatible runtime functions
 *
 * @param options - Configuration options for the custom provider
 * @returns A CustomProviderDefinition ready for use
 * @throws Error if the provider ID is invalid
 *
 * @example Basic usage
 * ```typescript
 * const provider = createCustomOpenAICompatibleProvider({
 *   id: "local-llm",
 *   displayName: "Local LLM Server",
 *   apiKeyRequired: false,
 * });
 * ```
 *
 * @example Azure OpenAI
 * ```typescript
 * const provider = createCustomOpenAICompatibleProvider({
 *   id: "azure-openai",
 *   displayName: "Azure OpenAI",
 *   setupInstructions: {
 *     steps: ["Get your Azure OpenAI endpoint and key"],
 *     link: { url: "https://portal.azure.com", text: "Azure Portal" },
 *   },
 * });
 * ```
 */
export function createCustomOpenAICompatibleProvider(
	options: CreateCustomOpenAICompatibleProviderOptions,
): CustomProviderDefinition {
	const {
		id,
		displayName,
		existingIds = [],
		setupInstructions,
		apiKeyRequired = true,
		capabilities,
		createdAt,
	} = options;

	// Validate the provider ID
	const validationResult = validateCustomProviderId(id, existingIds);
	if (!validationResult.valid) {
		throw new Error(validationResult.error);
	}

	// Build auth configuration
	const authConfig = buildAuthConfig(apiKeyRequired);

	// Build the custom provider definition
	const provider: CustomProviderDefinition = {
		// Identity
		id,
		displayName,
		isBuiltIn: false,
		baseProviderId: "openai",
		createdAt: createdAt ?? Date.now(),

		// Setup
		setupInstructions: setupInstructions ?? DEFAULT_SETUP_INSTRUCTIONS,

		// Auth
		auth: authConfig,

		// Capabilities
		capabilities: capabilities ?? DEFAULT_CAPABILITIES,

		// Runtime methods
		createRuntimeDefinition: createRuntimeDefinitionFactory(),
		validateAuth: createValidateAuthFactory(apiKeyRequired),
		discoverModels: createDiscoverModelsFactory(),
	};

	return provider;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Builds the auth configuration for the custom provider.
 */
function buildAuthConfig(apiKeyRequired: boolean): FieldBasedAuth {
	return buildFieldBasedAuth({
		apiKey: { required: apiKeyRequired },
		baseUrl: { required: true },
		headers: { required: false },
	});
}

/**
 * Creates the createRuntimeDefinition method for the custom provider.
 *
 * Custom providers don't create factories at this level - the ProviderRegistry
 * is responsible for creating factories using base runtime functions.
 * This method returns an empty structure that will be populated by the registry.
 *
 * Note: Auth validation is handled by validateAuth, not here.
 */
function createRuntimeDefinitionFactory() {
	return async (_auth: RuntimeAuthState): Promise<RuntimeProviderDefinition> => {
		// Custom providers start with empty model factories
		// Users add models manually through the UI, which populates the data store
		return {
			chatModels: {},
			embeddingModels: {},
		};
	};
}

/**
 * Creates the validateAuth method for the custom provider.
 */
function createValidateAuthFactory(apiKeyRequired: boolean) {
	return async (auth: RuntimeAuthState): Promise<AuthValidationResult> => {
		// Check auth type
		if (auth.type !== "field-based") {
			return { valid: false, error: "Invalid authentication type. Expected field-based auth." };
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;

		// Check base URL - always required for custom providers
		const baseUrl = fieldAuth.values.baseUrl?.trim();
		if (!baseUrl) {
			return { valid: false, error: "Base URL is required" };
		}

		// Check API key if required
		const apiKey = fieldAuth.values.apiKey?.trim();
		if (apiKeyRequired && !apiKey) {
			return { valid: false, error: "API key is required" };
		}

		// If API key is not required and not provided, validate connection only
		if (!apiKeyRequired && !apiKey) {
			return validateConnectionOnly(baseUrl);
		}

		// Delegate to base runtime for API validation
		return validateOpenAIAuth(fieldAuth);
	};
}

/**
 * Validates connection to an endpoint without API key.
 * Makes a simple request to check if the server is reachable.
 */
async function validateConnectionOnly(baseUrl: string): Promise<AuthValidationResult> {
	const sanitizedUrl = baseUrl.replace(/\/+$/, "");

	try {
		const response = await globalThis.fetch(`${sanitizedUrl}/models`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		});

		if (response.ok) {
			return { valid: true };
		}

		// Some servers may return 401 without auth, but that's expected
		// We just want to verify the server is reachable
		if (response.status === 401 || response.status === 403) {
			// Server is reachable but requires auth - but we said API key is not required
			// This is a configuration issue, but we'll allow it
			return { valid: true };
		}

		return { valid: false, error: `Server returned status ${response.status}` };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { valid: false, error: `Connection failed: ${message}` };
	}
}

/**
 * Creates the discoverModels method for the custom provider.
 *
 * Custom OpenAI-compatible providers use the same model discovery
 * as the built-in OpenAI provider (GET /models endpoint).
 */
function createDiscoverModelsFactory() {
	return async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
		if (auth.type !== "field-based") {
			throw new Error("Custom OpenAI-compatible provider requires field-based authentication");
		}

		// Use OpenAI-compatible model discovery
		return discoverOpenAIModels(auth as RuntimeFieldBasedAuthState);
	};
}
