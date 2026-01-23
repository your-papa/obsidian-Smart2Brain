/**
 * Ollama built-in provider definition
 *
 * This provider supports:
 * - Chat models (llama3.1, mistral, codellama, etc.)
 * - Embedding models (nomic-embed-text, mxbai-embed-large, etc.)
 * - Model discovery via Ollama API (/api/tags)
 *
 * Authentication: Field-based with all three fields (apiKey optional, baseUrl required, headers optional)
 * Ollama runs locally on the user's machine, defaulting to http://localhost:11434
 */

import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import OllamaLogo from "../../components/ui/logos/OllamaLogo.svelte";
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
	return new ProviderEndpointError("ollama", message);
}

// =============================================================================
// Types
// =============================================================================

/**
 * Ollama API tags response structure.
 */
interface OllamaTagsResponse {
	models?: OllamaModelResource[];
}

/**
 * Ollama API model resource structure.
 */
interface OllamaModelResource {
	name?: string;
}

// =============================================================================
// Provider Definition
// =============================================================================

/**
 * Ollama built-in provider definition.
 *
 * Implements BuiltInProviderDefinition with:
 * - Field-based auth (baseUrl only, no API key)
 * - Full capabilities (chat, embedding, modelDiscovery)
 * - Runtime factories using @langchain/ollama
 */
export const ollamaProvider: BuiltInProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "ollama",
	displayName: "Ollama",
	logo: OllamaLogo,
	isBuiltIn: true,

	// =========================================================================
	// Setup Instructions
	// =========================================================================
	setupInstructions: {
		steps: [
			"Install Ollama from ollama.ai",
			"Run 'ollama serve' to start the server",
			"Pull a model with 'ollama pull llama3.1'",
			"The default URL is http://localhost:11434",
		],
		link: {
			url: "https://ollama.ai",
			text: "Ollama Website",
		},
	},

	// =========================================================================
	// Auth Configuration
	// =========================================================================
	auth: buildFieldBasedAuth({
		apiKey: { required: false },
		baseUrl: { required: true, label: "Server URL", placeholder: "http://localhost:11434" },
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
	 * Creates a LangChain ChatOllama instance.
	 *
	 * @param auth - Runtime authentication state with resolved values (baseUrl required)
	 * @param modelId - The model ID (e.g., "llama3.1", "mistral")
	 * @param options - Optional model configuration (temperature, contextWindow, etc.)
	 * @returns ChatOllama instance configured with auth and model
	 */
	createChatInstance: (auth: RuntimeAuthState, modelId: string, options?: Partial<ChatModelConfig>): ChatOllama => {
		if (auth.type !== "field-based") {
			throw new Error("Ollama provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const config: Record<string, unknown> = {
			model: modelId,
		};

		// Add baseUrl configuration if provided and not empty
		const baseUrl = fieldAuth.values.baseUrl;
		if (baseUrl && baseUrl.trim() !== "") {
			config.baseUrl = sanitizeBaseUrl(baseUrl);
		}

		// Add temperature if provided
		if (options?.temperature !== undefined) {
			config.temperature = options.temperature;
		}

		// Add contextWindow as numCtx (Ollama-specific parameter)
		if (options?.contextWindow !== undefined) {
			config.numCtx = options.contextWindow;
		}

		return new ChatOllama(config);
	},

	/**
	 * Creates a LangChain OllamaEmbeddings instance.
	 *
	 * @param auth - Runtime authentication state with resolved values (baseUrl required)
	 * @param modelId - The model ID (e.g., "nomic-embed-text")
	 * @returns OllamaEmbeddings instance configured with auth and model
	 */
	createEmbeddingInstance: (auth: RuntimeAuthState, modelId: string): OllamaEmbeddings => {
		if (auth.type !== "field-based") {
			throw new Error("Ollama provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const config: Record<string, unknown> = {
			model: modelId,
		};

		// Add baseUrl configuration if provided and not empty
		const baseUrl = fieldAuth.values.baseUrl;
		if (baseUrl && baseUrl.trim() !== "") {
			config.baseUrl = sanitizeBaseUrl(baseUrl);
		}

		return new OllamaEmbeddings(config);
	},

	/**
	 * Validates authentication credentials.
	 *
	 * For Ollama, this checks if the server is reachable.
	 * There's no API key to validate - just a connection test.
	 *
	 * @param auth - Runtime authentication state with resolved values (baseUrl optional)
	 * @returns Promise resolving to AuthValidationResult ({ valid: true } or { valid: false, error: string })
	 *
	 * @example
	 * ```typescript
	 * const auth: RuntimeFieldBasedAuthState = {
	 *   type: "field-based",
	 *   values: { baseUrl: "http://localhost:11434" },
	 * };
	 * const result = await ollamaProvider.validateAuth(auth);
	 * if (result.valid) {
	 *   console.log("Ollama server is reachable!");
	 * } else {
	 *   console.error("Connection failed:", result.error);
	 * }
	 * ```
	 */
	validateAuth: async (auth: RuntimeAuthState): Promise<AuthValidationResult> => {
		// Check auth type
		if (auth.type !== "field-based") {
			return { valid: false, error: "Invalid authentication type. Expected field-based auth." };
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const baseUrl = fieldAuth.values.baseUrl?.trim();
		if (!baseUrl) {
			return { valid: false, error: "Server URL is required" };
		}
		const sanitizedUrl = sanitizeBaseUrl(baseUrl);

		let response: Response;
		try {
			response = await globalThis.fetch(`${sanitizedUrl}/api/tags`, {
				method: "GET",
				headers: {
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

		// Build error message
		if (response.status === 401 || response.status === 403) {
			const detail = errorBody || `Authentication failed (${response.status})`;
			return { valid: false, error: detail };
		}

		// Other errors
		const detail = errorBody || `Request failed with status ${response.status}`;
		return { valid: false, error: detail };
	},

	/**
	 * Discovers available models from Ollama API.
	 *
	 * Makes a GET request to /api/tags endpoint and returns all models.
	 * Models are returned in both chat and embedding arrays - users choose
	 * which model to use for each purpose.
	 *
	 * @param auth - Runtime authentication state with resolved values (baseUrl optional)
	 * @returns Promise resolving to DiscoveredModels with chat and embedding arrays
	 * @throws ProviderAuthError if authentication fails (401, 403)
	 * @throws ProviderEndpointError if network request fails
	 *
	 * @example
	 * ```typescript
	 * const auth: RuntimeFieldBasedAuthState = {
	 *   type: "field-based",
	 *   values: { baseUrl: "http://localhost:11434" },
	 * };
	 * const models = await ollamaProvider.discoverModels(auth);
	 * // models.chat = ["llama3.1", "mistral", ...]
	 * // models.embedding = ["nomic-embed-text", ...]
	 * ```
	 */
	discoverModels: async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
		if (auth.type !== "field-based") {
			throw new Error("Ollama provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const baseUrl = fieldAuth.values.baseUrl?.trim();
		if (!baseUrl) {
			throw new Error("Ollama base URL is required");
		}
		const sanitizedUrl = sanitizeBaseUrl(baseUrl);

		let response: Response;
		try {
			response = await globalThis.fetch(`${sanitizedUrl}/api/tags`, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
				},
			});
		} catch (error) {
			throw toEndpointError(error);
		}

		if (!response.ok) {
			const errorBody = await safeReadText(response);
			if (response.status === 401 || response.status === 403) {
				throw new ProviderAuthError("ollama", response.status, undefined, errorBody);
			}
			throw new Error(
				`Ollama model discovery failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
			);
		}

		const payload = (await response.json()) as OllamaTagsResponse;
		const models = Array.isArray(payload.models) ? payload.models : [];

		const modelNames: string[] = [];

		for (const model of models) {
			const name = typeof model?.name === "string" ? model.name.trim() : undefined;
			if (!name) {
				continue;
			}

			modelNames.push(name);
		}

		// Return all models in both arrays - let users choose which model to use for each purpose
		return { chat: modelNames, embedding: modelNames };
	},
};
