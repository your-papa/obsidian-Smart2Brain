/**
 * OpenAI built-in provider definition
 *
 * This provider supports:
 * - Chat models (gpt-4o, gpt-4o-mini, gpt-4-turbo, etc.)
 * - Embedding models (text-embedding-3-small, text-embedding-3-large, etc.)
 * - Model discovery via OpenAI API
 *
 * Authentication: Field-based with apiKey (required), baseUrl (optional), headers (optional)
 */

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import OpenAILogo from "../../components/ui/logos/OpenAILogo.svelte";
import { ProviderAuthError, ProviderEndpointError } from "../errors";
import { buildFieldBasedAuth } from "../helpers";
import type {
	AuthValidationResult,
	BuiltInProviderDefinition,
	ChatModelConfig,
	DiscoveredModels,
	RuntimeAuthState,
	RuntimeFieldBasedAuthState,
} from "../types";

// =============================================================================
// Constants
// =============================================================================

/** Default base URL for OpenAI API */
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Removes trailing slashes from a URL.
 * @param url - The URL to sanitize
 * @returns URL with trailing slashes removed
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
 * Converts an error to a ProviderEndpointError.
 */
function toEndpointError(error: unknown): Error {
	if (error instanceof ProviderEndpointError) {
		return error;
	}
	const message = error instanceof Error ? error.message : String(error);
	return new ProviderEndpointError("openai", message);
}

// =============================================================================
// API Response Types
// =============================================================================

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

// =============================================================================
// Provider Definition
// =============================================================================

/**
 * OpenAI built-in provider definition.
 *
 * Implements BuiltInProviderDefinition with:
 * - Field-based auth (apiKey required, baseUrl/headers optional)
 * - Full capabilities (chat, embedding, modelDiscovery)
 * - Runtime factories using @langchain/openai
 */
export const openaiProvider: BuiltInProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "openai",
	displayName: "OpenAI",
	logo: OpenAILogo,
	isBuiltIn: true,

	// =========================================================================
	// Setup Instructions
	// =========================================================================
	setupInstructions: {
		steps: [
			"Create an API key from OpenAI's Dashboard",
			"Ensure your OpenAI account has credits loaded",
			"Paste the API key below (starts with 'sk-')",
		],
		link: {
			url: "https://platform.openai.com/api-keys",
			text: "OpenAI Dashboard",
		},
	},

	// =========================================================================
	// Auth Configuration
	// =========================================================================
	auth: buildFieldBasedAuth({
		apiKey: { required: true },
		baseUrl: { required: false, placeholder: "https://api.openai.com/v1" },
		headers: { required: false },
	}),

	// =========================================================================
	// Capabilities
	// =========================================================================
	capabilities: {
		chat: true,
		embedding: true,
		modelDiscovery: true,
	},

	// =========================================================================
	// Runtime Methods
	// =========================================================================

	/**
	 * Creates a LangChain ChatOpenAI instance.
	 *
	 * @param auth - Runtime authentication state with resolved secrets
	 * @param modelId - The model ID (e.g., "gpt-4o", "gpt-4o-mini")
	 * @param options - Optional model configuration (temperature, etc.)
	 * @returns ChatOpenAI instance configured with auth and model
	 */
	createChatInstance: (auth: RuntimeAuthState, modelId: string, options?: Partial<ChatModelConfig>): ChatOpenAI => {
		if (auth.type !== "field-based") {
			throw new Error("OpenAI provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const config: Record<string, unknown> = {
			model: modelId,
			apiKey: fieldAuth.values.apiKey,
		};

		// Add temperature if provided
		if (options?.temperature !== undefined) {
			config.temperature = options.temperature;
		}

		// Add baseUrl configuration if provided and not empty
		const baseUrl = fieldAuth.values.baseUrl;
		if (baseUrl && baseUrl.trim() !== "") {
			config.configuration = {
				baseURL: sanitizeBaseUrl(baseUrl),
			};
		}

		return new ChatOpenAI(config);
	},

	/**
	 * Creates a LangChain OpenAIEmbeddings instance.
	 *
	 * @param auth - Runtime authentication state with resolved secrets
	 * @param modelId - The model ID (e.g., "text-embedding-3-small")
	 * @returns OpenAIEmbeddings instance configured with auth and model
	 */
	createEmbeddingInstance: (auth: RuntimeAuthState, modelId: string): OpenAIEmbeddings => {
		if (auth.type !== "field-based") {
			throw new Error("OpenAI provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const config: Record<string, unknown> = {
			model: modelId,
			apiKey: fieldAuth.values.apiKey,
		};

		// Add baseUrl configuration if provided and not empty
		const baseUrl = fieldAuth.values.baseUrl;
		if (baseUrl && baseUrl.trim() !== "") {
			config.configuration = {
				baseURL: sanitizeBaseUrl(baseUrl),
			};
		}

		return new OpenAIEmbeddings(config);
	},

	/**
	 * Validates authentication credentials.
	 *
	 * Makes a GET request to the /models endpoint to verify the API key is valid.
	 * This validates both the API key and the baseUrl configuration.
	 */
	validateAuth: async (auth: RuntimeAuthState): Promise<AuthValidationResult> => {
		// Check auth type
		if (auth.type !== "field-based") {
			return { valid: false, error: "Invalid authentication type. Expected field-based auth." };
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;

		// Check API key presence
		const apiKey = fieldAuth.values.apiKey?.trim();
		if (!apiKey) {
			return { valid: false, error: "API key is required" };
		}

		const baseUrl =
			fieldAuth.values.baseUrl && fieldAuth.values.baseUrl.trim() !== ""
				? sanitizeBaseUrl(fieldAuth.values.baseUrl)
				: OPENAI_DEFAULT_BASE_URL;

		let response: Response;
		try {
			response = await globalThis.fetch(`${baseUrl}/models`, {
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
	},

	/**
	 * Discovers available models from OpenAI API.
	 *
	 * Makes a GET request to /models endpoint and returns all model IDs.
	 * Models are returned in both chat and embedding arrays - users choose
	 * which model to use for each purpose.
	 */
	discoverModels: async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
		if (auth.type !== "field-based") {
			throw new Error("OpenAI provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const apiKey = fieldAuth.values.apiKey;
		if (!apiKey) {
			throw new Error("OpenAI model discovery requires an API key.");
		}

		const baseUrl =
			fieldAuth.values.baseUrl && fieldAuth.values.baseUrl.trim() !== ""
				? sanitizeBaseUrl(fieldAuth.values.baseUrl)
				: OPENAI_DEFAULT_BASE_URL;

		let response: Response;
		try {
			response = await globalThis.fetch(`${baseUrl}/models`, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			});
		} catch (error) {
			throw toEndpointError(error);
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
				throw new ProviderAuthError("openai", response.status, errorCode, errorMessage);
			}
			throw new Error(
				`OpenAI model discovery failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
			);
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
	},
};
