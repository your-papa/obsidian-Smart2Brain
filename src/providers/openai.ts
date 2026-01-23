/**
 * OpenAI built-in provider definition
 *
 * This provider supports:
 * - Chat models (gpt-4o, gpt-4o-mini, gpt-4-turbo, etc.)
 * - Embedding models (text-embedding-3-small, text-embedding-3-large, etc.)
 * - Model discovery via OpenAI API
 *
 * Authentication: apiKey (required), baseUrl (optional), headers (optional)
 */

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import OpenAILogo from "../components/ui/logos/OpenAILogo.svelte";
import type {
	AuthObject,
	AuthValidationResult,
	ChatModelConfig,
	EmbeddingProviderDefinition,
} from "../types/provider/index";

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

// =============================================================================
// API Response Types
// =============================================================================

interface OpenAIModelResponse {
	data?: Array<{ id?: string }>;
}

// =============================================================================
// Provider Definition
// =============================================================================

/**
 * OpenAI built-in provider definition.
 *
 * Supports chat models, embedding models, and model discovery.
 */
export const openaiProvider: EmbeddingProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "openai",
	displayName: "OpenAI",
	logo: OpenAILogo,

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
	auth: {
		apiKey: {
			label: "API Key",
			description: "Your OpenAI API key for authentication",
			kind: "secret",
			required: true,
			placeholder: "sk-...",
		},
		baseUrl: {
			label: "Base URL",
			description: "Custom API endpoint (leave empty for default OpenAI)",
			kind: "text",
			required: false,
			placeholder: "https://api.openai.com/v1",
		},
		headers: {
			label: "Custom Headers",
			description: "Additional headers as JSON (optional)",
			kind: "textarea",
			required: false,
			placeholder: '{"X-Custom-Header": "value"}',
		},
	},

	// =========================================================================
	// Runtime Methods
	// =========================================================================

	createChatInstance: (auth: AuthObject, modelId: string, options?: Partial<ChatModelConfig>) => {
		const config: Record<string, unknown> = {
			model: modelId,
			apiKey: auth.apiKey,
		};

		if (options?.temperature !== undefined) {
			config.temperature = options.temperature;
		}

		// Add baseUrl configuration if provided
		if (auth.baseUrl && auth.baseUrl.trim() !== "") {
			config.configuration = {
				baseURL: sanitizeBaseUrl(auth.baseUrl),
			};
		}

		// Add custom headers if provided
		if (auth.headers && Object.keys(auth.headers).length > 0) {
			config.configuration = {
				...(config.configuration as Record<string, unknown>),
				defaultHeaders: auth.headers,
			};
		}

		return new ChatOpenAI(config);
	},

	createEmbeddingInstance: (auth: AuthObject, modelId: string) => {
		const config: Record<string, unknown> = {
			model: modelId,
			apiKey: auth.apiKey,
		};

		// Add baseUrl configuration if provided
		if (auth.baseUrl && auth.baseUrl.trim() !== "") {
			config.configuration = {
				baseURL: sanitizeBaseUrl(auth.baseUrl),
			};
		}

		// Add custom headers if provided
		if (auth.headers && Object.keys(auth.headers).length > 0) {
			config.configuration = {
				...(config.configuration as Record<string, unknown>),
				defaultHeaders: auth.headers,
			};
		}

		return new OpenAIEmbeddings(config);
	},

	validateAuth: async (auth: AuthObject): Promise<AuthValidationResult> => {
		if (!auth.apiKey?.trim()) {
			return { valid: false, error: "API key is required" };
		}

		const baseUrl =
			auth.baseUrl && auth.baseUrl.trim() !== "" ? sanitizeBaseUrl(auth.baseUrl) : OPENAI_DEFAULT_BASE_URL;

		const headers: Record<string, string> = {
			Authorization: `Bearer ${auth.apiKey}`,
			"Content-Type": "application/json",
		};

		// Add custom headers if provided
		if (auth.headers) {
			Object.assign(headers, auth.headers);
		}

		let response: Response;
		try {
			response = await globalThis.fetch(`${baseUrl}/models`, {
				method: "GET",
				headers,
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
				? (JSON.parse(errorBody) as { error?: { code?: string; message?: string } })
				: undefined;
			errorCode = parsed?.error?.code;
			errorMessage = parsed?.error?.message;
		} catch {
			// ignore parse errors
		}

		if (response.status === 401 || response.status === 403 || errorCode === "invalid_api_key") {
			return { valid: false, error: errorMessage || `Authentication failed (${response.status})` };
		}

		return { valid: false, error: errorMessage || errorBody || `Request failed with status ${response.status}` };
	},

	discoverModels: async (auth: AuthObject): Promise<string[]> => {
		if (!auth.apiKey) {
			throw new Error("OpenAI model discovery requires an API key.");
		}

		const baseUrl =
			auth.baseUrl && auth.baseUrl.trim() !== "" ? sanitizeBaseUrl(auth.baseUrl) : OPENAI_DEFAULT_BASE_URL;

		const headers: Record<string, string> = {
			Authorization: `Bearer ${auth.apiKey}`,
			"Content-Type": "application/json",
		};

		// Add custom headers if provided
		if (auth.headers) {
			Object.assign(headers, auth.headers);
		}

		const response = await globalThis.fetch(`${baseUrl}/models`, {
			method: "GET",
			headers,
		});

		if (!response.ok) {
			const errorBody = await safeReadText(response);
			throw new Error(`Model discovery failed: ${errorBody || response.statusText}`);
		}

		const payload = (await response.json()) as OpenAIModelResponse;
		const resources = Array.isArray(payload.data) ? payload.data : [];

		return resources.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.trim() !== "");
	},
};
