/**
 * Anthropic built-in provider definition
 *
 * This provider supports:
 * - Chat models (claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus, etc.)
 * - NO embedding models (Anthropic doesn't offer embeddings)
 * - Model discovery via Anthropic API (/v1/models)
 *
 * Authentication: Field-based with apiKey (required), baseUrl (optional), headers (optional)
 */

import { ChatAnthropic } from "@langchain/anthropic";
import AnthropicLogo from "../../components/ui/logos/AnthropicLogo.svelte";
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

/** Default base URL for Anthropic API */
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

/** Anthropic API version header value */
const ANTHROPIC_API_VERSION = "2023-06-01";

// =============================================================================
// Helper Functions
// =============================================================================

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
 * Converts a fetch error to a ProviderEndpointError.
 */
function toEndpointError(error: unknown): ProviderEndpointError {
	if (error instanceof Error) {
		return new ProviderEndpointError("anthropic", error.message);
	}
	return new ProviderEndpointError("anthropic", String(error));
}

// =============================================================================
// Types
// =============================================================================

/**
 * Response structure for Anthropic's /v1/models endpoint.
 */
interface AnthropicModelResponse {
	data: Array<{
		id: string;
		created_at?: string;
		display_name?: string;
		type?: string;
	}>;
	has_more?: boolean;
	first_id?: string;
	last_id?: string;
}

// =============================================================================
// Provider Definition
// =============================================================================

/**
 * Anthropic built-in provider definition.
 *
 * Implements BuiltInProviderDefinition with:
 * - Field-based auth (apiKey required only)
 * - Limited capabilities (chat only, no embedding, with model discovery)
 * - Runtime factories using @langchain/anthropic
 */
export const anthropicProvider: BuiltInProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "anthropic",
	displayName: "Anthropic",
	logo: AnthropicLogo,
	isBuiltIn: true,

	// =========================================================================
	// Setup Instructions
	// =========================================================================
	setupInstructions: {
		steps: [
			"Create an API key from Anthropic's Console",
			"Ensure your Anthropic account has credits available",
			"Paste the API key below (starts with 'sk-ant-')",
		],
		link: {
			url: "https://console.anthropic.com/settings/keys",
			text: "Anthropic Console",
		},
	},

	// =========================================================================
	// Auth Configuration
	// =========================================================================
	auth: buildFieldBasedAuth({
		apiKey: { required: true, placeholder: "sk-ant-..." },
		baseUrl: { required: false },
		headers: { required: false },
	}),

	// =========================================================================
	// Capabilities
	// =========================================================================
	capabilities: {
		chat: true,
		embedding: false,
		modelDiscovery: true,
	},

	// =========================================================================
	// Runtime Methods
	// =========================================================================

	/**
	 * Creates a LangChain ChatAnthropic instance.
	 *
	 * @param auth - Runtime authentication state with resolved secrets
	 * @param modelId - The model ID (e.g., "claude-3-5-sonnet-20241022")
	 * @param options - Optional model configuration (temperature, etc.)
	 * @returns ChatAnthropic instance configured with auth and model
	 */
	createChatInstance: (
		auth: RuntimeAuthState,
		modelId: string,
		options?: Partial<ChatModelConfig>,
	): ChatAnthropic => {
		if (auth.type !== "field-based") {
			throw new Error("Anthropic provider requires field-based authentication");
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

		return new ChatAnthropic(config);
	},

	/**
	 * Validates authentication credentials.
	 *
	 * Makes a POST request to the /v1/messages endpoint with a minimal payload
	 * to verify the API key is valid. This is the standard Anthropic endpoint
	 * for chat completions.
	 *
	 * @param auth - Runtime authentication state with resolved secrets
	 * @returns Promise resolving to AuthValidationResult ({ valid: true } or { valid: false, error: string })
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

		let response: Response;
		try {
			response = await globalThis.fetch(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`, {
				method: "POST",
				headers: {
					"x-api-key": apiKey,
					"anthropic-version": ANTHROPIC_API_VERSION,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "claude-3-5-sonnet-20241022",
					max_tokens: 1,
					messages: [{ role: "user", content: "hi" }],
				}),
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
		let errorType: string | undefined;
		let errorMessage: string | undefined;
		try {
			const parsed = errorBody
				? (JSON.parse(errorBody) as {
						error?: { type?: string; message?: string };
					})
				: undefined;
			errorType = parsed?.error?.type;
			errorMessage = parsed?.error?.message;
		} catch {
			// ignore parse errors
		}

		// Build error message
		if (response.status === 401 || response.status === 403 || errorType === "authentication_error") {
			const detail = errorMessage || `Authentication failed (${response.status})`;
			return { valid: false, error: detail };
		}

		// Other errors
		const detail = errorMessage || errorBody || `Request failed with status ${response.status}`;
		return { valid: false, error: detail };
	},

	/**
	 * Discovers available models from Anthropic API.
	 *
	 * Makes a GET request to /v1/models endpoint to list available models.
	 * All Anthropic models are chat models - they don't offer embedding models.
	 *
	 * @param auth - Runtime authentication state with resolved secrets
	 * @returns Promise resolving to DiscoveredModels with chat array and empty embedding array
	 * @throws ProviderAuthError if authentication fails (401, 403)
	 * @throws ProviderEndpointError if network request fails
	 * @throws Error if API key is missing
	 */
	discoverModels: async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
		if (auth.type !== "field-based") {
			throw new Error("Anthropic provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;
		const apiKey = fieldAuth.values.apiKey?.trim();
		if (!apiKey) {
			throw new Error("Anthropic model discovery requires an API key.");
		}

		let response: Response;
		try {
			response = await globalThis.fetch(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/models`, {
				method: "GET",
				headers: {
					"x-api-key": apiKey,
					"anthropic-version": ANTHROPIC_API_VERSION,
					"Content-Type": "application/json",
				},
			});
		} catch (error) {
			throw toEndpointError(error);
		}

		if (!response.ok) {
			const errorBody = await safeReadText(response);
			let errorType: string | undefined;
			let errorMessage: string | undefined;
			try {
				const parsed = errorBody
					? (JSON.parse(errorBody) as {
							error?: { type?: string; message?: string };
						})
					: undefined;
				errorType = parsed?.error?.type;
				errorMessage = parsed?.error?.message;
			} catch {
				// ignore parse errors
			}

			if (response.status === 401 || response.status === 403 || errorType === "authentication_error") {
				throw new ProviderAuthError("anthropic", response.status, errorType, errorMessage);
			}
			throw new Error(
				`Anthropic model discovery failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
			);
		}

		const payload = (await response.json()) as AnthropicModelResponse;
		const resources = Array.isArray(payload.data) ? payload.data : [];

		const chatModels: string[] = [];

		for (const resource of resources) {
			const id = typeof resource?.id === "string" ? resource.id.trim() : undefined;
			if (!id) {
				continue;
			}
			// All Anthropic models are chat models
			chatModels.push(id);
		}

		// Anthropic doesn't offer embedding models
		return { chat: chatModels, embedding: [] };
	},
};
