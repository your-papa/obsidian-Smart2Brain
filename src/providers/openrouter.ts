/**
 * OpenRouter built-in provider definition
 *
 * OpenRouter is an OpenAI-compatible API that provides access to multiple
 * AI providers (Anthropic, Google, Meta, etc.) through a single API.
 *
 * This provider supports:
 * - Chat models from various providers via OpenRouter
 * - Model discovery via OpenRouter API
 * - NO embedding models
 *
 * Authentication: apiKey (required)
 */

import { ChatOpenAI } from "@langchain/openai";
import GenericAIIcon from "../components/ui/logos/GenericAIIcon.svelte";
import type {
	AuthObject,
	AuthValidationResult,
	BaseProviderDefinition,
	ChatModelConfig,
} from "../types/provider/index";
import OpenRouterLogo from "../components/ui/logos/OpenRouterLogo.svelte";

// =============================================================================
// Constants
// =============================================================================

/** OpenRouter API base URL */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

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

// =============================================================================
// API Response Types
// =============================================================================

interface OpenRouterModelResponse {
	data?: Array<{ id?: string }>;
}

// =============================================================================
// Provider Definition
// =============================================================================

/**
 * OpenRouter built-in provider definition.
 *
 * Supports chat models only (no embeddings).
 */
export const openrouterProvider: BaseProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "openrouter",
	displayName: "OpenRouter",
	logo: OpenRouterLogo,

	// =========================================================================
	// Setup Instructions
	// =========================================================================
	setupInstructions: {
		steps: ["Create an account at OpenRouter", "Generate an API key from the Keys page", "Paste the API key below"],
		link: {
			url: "https://openrouter.ai/keys",
			text: "OpenRouter Keys",
		},
	},

	// =========================================================================
	// Auth Configuration
	// =========================================================================
	auth: {
		apiKey: {
			label: "API Key",
			description: "Your OpenRouter API key for authentication",
			kind: "secret",
			required: true,
			placeholder: "sk-or-...",
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
			configuration: {
				baseURL: OPENROUTER_BASE_URL,
			},
		};

		if (options?.temperature !== undefined) {
			config.temperature = options.temperature;
		}

		// Add custom headers if provided
		if (auth.headers && Object.keys(auth.headers).length > 0) {
			(config.configuration as Record<string, unknown>).defaultHeaders = auth.headers;
		}

		return new ChatOpenAI(config);
	},

	validateAuth: async (auth: AuthObject): Promise<AuthValidationResult> => {
		if (!auth.apiKey?.trim()) {
			return { valid: false, error: "API key is required" };
		}

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
			response = await globalThis.fetch(`${OPENROUTER_BASE_URL}/models`, {
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
		let errorMessage: string | undefined;
		try {
			const parsed = errorBody ? (JSON.parse(errorBody) as { error?: { message?: string } }) : undefined;
			errorMessage = parsed?.error?.message;
		} catch {
			// ignore parse errors
		}

		if (response.status === 401 || response.status === 403) {
			return {
				valid: false,
				error: errorMessage || `Authentication failed (${response.status})`,
			};
		}

		return {
			valid: false,
			error: errorMessage || errorBody || `Request failed with status ${response.status}`,
		};
	},

	discoverModels: async (auth: AuthObject): Promise<string[]> => {
		if (!auth.apiKey?.trim()) {
			throw new Error("OpenRouter model discovery requires an API key.");
		}

		const headers: Record<string, string> = {
			Authorization: `Bearer ${auth.apiKey}`,
			"Content-Type": "application/json",
		};

		// Add custom headers if provided
		if (auth.headers) {
			Object.assign(headers, auth.headers);
		}

		const response = await globalThis.fetch(`${OPENROUTER_BASE_URL}/models`, {
			method: "GET",
			headers,
		});

		if (!response.ok) {
			const errorBody = await safeReadText(response);
			throw new Error(`Model discovery failed: ${errorBody || response.statusText}`);
		}

		const payload = (await response.json()) as OpenRouterModelResponse;
		const resources = Array.isArray(payload.data) ? payload.data : [];

		return resources.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.trim() !== "");
	},
};
