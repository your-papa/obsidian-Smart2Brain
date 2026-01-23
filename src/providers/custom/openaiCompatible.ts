/**
 * Custom OpenAI-compatible provider factory
 *
 * Factory function to create custom providers based on the OpenAI-compatible API.
 * Used for providers like Azure OpenAI, local LLM servers, and other OpenAI-compatible endpoints.
 */

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ProviderAuthError, ProviderEndpointError } from "../errors";
import { buildFieldBasedAuth, validateCustomProviderId } from "../helpers";
import type {
	AuthValidationResult,
	ChatModelConfig,
	CustomProviderDefinition,
	DiscoveredModels,
	FieldBasedAuth,
	ProviderCapabilities,
	ProviderSetupInstructions,
	RuntimeAuthState,
	RuntimeFieldBasedAuthState,
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
// Helper Functions
// ============================================================================

/**
 * Removes trailing slashes from a URL.
 */
function sanitizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

/**
 * Safely reads response text, returning undefined on error.
 */
async function safeReadText(response: Response): Promise<string | undefined> {
	try {
		return await response.text();
	} catch {
		return undefined;
	}
}

/**
 * OpenAI API models response structure.
 */
interface OpenAIModelResponse {
	data?: OpenAIModelResource[];
}

/**
 * OpenAI API model resource structure.
 */
interface OpenAIModelResource {
	id?: string;
	object?: string;
}

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
		createChatInstance: createChatInstanceFactory(),
		createEmbeddingInstance: createEmbeddingInstanceFactory(),
		validateAuth: createValidateAuthFactory(apiKeyRequired),
		discoverModels: createDiscoverModelsFactory(),
	};

	return provider;
}

// ============================================================================
// Auth Configuration
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

// ============================================================================
// Instance Creation Factories
// ============================================================================

/**
 * Creates the createChatInstance method for the custom provider.
 */
function createChatInstanceFactory() {
	return (auth: RuntimeAuthState, modelId: string, options?: Partial<ChatModelConfig>): ChatOpenAI => {
		if (auth.type !== "field-based") {
			throw new Error("Custom OpenAI-compatible provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const config: Record<string, unknown> = {
			model: modelId,
		};

		// Add API key if provided
		if (fieldAuth.values.apiKey) {
			config.apiKey = fieldAuth.values.apiKey;
		}

		// Add baseUrl configuration (required for custom providers)
		const baseUrl = fieldAuth.values.baseUrl;
		if (baseUrl && baseUrl.trim() !== "") {
			config.configuration = {
				baseURL: sanitizeBaseUrl(baseUrl),
			};
		}

		// Add temperature if provided
		if (options?.temperature !== undefined) {
			config.temperature = options.temperature;
		}

		return new ChatOpenAI(config);
	};
}

/**
 * Creates the createEmbeddingInstance method for the custom provider.
 */
function createEmbeddingInstanceFactory() {
	return (auth: RuntimeAuthState, modelId: string): OpenAIEmbeddings => {
		if (auth.type !== "field-based") {
			throw new Error("Custom OpenAI-compatible provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const config: Record<string, unknown> = {
			model: modelId,
		};

		// Add API key if provided
		if (fieldAuth.values.apiKey) {
			config.apiKey = fieldAuth.values.apiKey;
		}

		// Add baseUrl configuration (required for custom providers)
		const baseUrl = fieldAuth.values.baseUrl;
		if (baseUrl && baseUrl.trim() !== "") {
			config.configuration = {
				baseURL: sanitizeBaseUrl(baseUrl),
			};
		}

		return new OpenAIEmbeddings(config);
	};
}

// ============================================================================
// Validation Factories
// ============================================================================

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

		// Validate with API key
		return validateOpenAICompatibleAuth(fieldAuth);
	};
}

/**
 * Validates OpenAI-compatible authentication credentials.
 */
async function validateOpenAICompatibleAuth(auth: RuntimeFieldBasedAuthState): Promise<AuthValidationResult> {
	const apiKey = auth.values.apiKey?.trim();
	if (!apiKey) {
		return { valid: false, error: "API key is required" };
	}

	const baseUrl = auth.values.baseUrl?.trim();
	if (!baseUrl) {
		return { valid: false, error: "Base URL is required" };
	}

	const sanitizedUrl = sanitizeBaseUrl(baseUrl);

	let response: Response;
	try {
		response = await globalThis.fetch(`${sanitizedUrl}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { valid: false, error: `Connection failed: ${message}` };
	}

	if (response.ok) {
		return { valid: true };
	}

	// Handle error response
	const errorBody = await safeReadText(response);
	let errorCode: string | undefined;
	let errorMessage: string | undefined;
	try {
		const parsed = errorBody
			? (JSON.parse(errorBody) as {
					error?: { code?: string; message?: string };
				})
			: undefined;
		errorCode = parsed?.error?.code;
		errorMessage = parsed?.error?.message;
	} catch {
		// ignore parse errors
	}

	// Build error message
	if (response.status === 401 || response.status === 403 || errorCode === "invalid_api_key") {
		const detail = errorMessage || `Authentication failed (${response.status})`;
		return { valid: false, error: detail };
	}

	// Other errors
	const detail = errorMessage || errorBody || `Request failed with status ${response.status}`;
	return { valid: false, error: detail };
}

/**
 * Validates connection to an endpoint without API key.
 */
async function validateConnectionOnly(baseUrl: string): Promise<AuthValidationResult> {
	const sanitizedUrl = sanitizeBaseUrl(baseUrl);

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
			return { valid: true };
		}

		return { valid: false, error: `Server returned status ${response.status}` };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { valid: false, error: `Connection failed: ${message}` };
	}
}

// ============================================================================
// Model Discovery
// ============================================================================

/**
 * Creates the discoverModels method for the custom provider.
 */
function createDiscoverModelsFactory() {
	return async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
		if (auth.type !== "field-based") {
			throw new Error("Custom OpenAI-compatible provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		return discoverOpenAICompatibleModels(fieldAuth);
	};
}

/**
 * Discovers available models from an OpenAI-compatible API.
 */
async function discoverOpenAICompatibleModels(auth: RuntimeFieldBasedAuthState): Promise<DiscoveredModels> {
	const apiKey = auth.values.apiKey;
	const baseUrl = auth.values.baseUrl?.trim();

	if (!baseUrl) {
		throw new Error("Base URL is required for model discovery");
	}

	const sanitizedUrl = sanitizeBaseUrl(baseUrl);

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	let response: Response;
	try {
		response = await globalThis.fetch(`${sanitizedUrl}/models`, {
			method: "GET",
			headers,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new ProviderEndpointError("custom-openai", message);
	}

	if (!response.ok) {
		const errorBody = await safeReadText(response);
		let errorCode: string | undefined;
		let errorMessage: string | undefined;
		try {
			const parsed = errorBody
				? (JSON.parse(errorBody) as {
						error?: { code?: string; message?: string };
					})
				: undefined;
			errorCode = parsed?.error?.code;
			errorMessage = parsed?.error?.message;
		} catch {
			// ignore parse errors
		}

		if (response.status === 401 || response.status === 403 || errorCode === "invalid_api_key") {
			throw new ProviderAuthError("custom-openai", response.status, errorCode, errorMessage);
		}
		throw new Error(`Model discovery failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`);
	}

	const payload = (await response.json()) as OpenAIModelResponse;
	const resources = Array.isArray(payload.data) ? payload.data : [];

	const models: string[] = [];

	for (const resource of resources) {
		const id = typeof resource?.id === "string" ? resource.id.trim() : undefined;
		if (!id) {
			continue;
		}
		models.push(id);
	}

	// Return all models in both arrays - let users choose which model to use for each purpose
	return { chat: models, embedding: models };
}
