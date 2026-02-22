/**
 * OpenRouter built-in provider definition
 *
 * OpenRouter is an OpenAI-compatible API that provides access to multiple
 * AI providers (Anthropic, Google, Meta, etc.) through a single API.
 *
 * This provider supports:
 * - Chat models from various providers via OpenRouter
 * - Embedding models (filtered by name heuristics)
 * - Model discovery via OpenRouter API
 *
 * Authentication: apiKey (required)
 */

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { requestUrl } from "obsidian";
import GenericAIIcon from "../components/ui/logos/GenericAIIcon.svelte";
import type {
	AuthObject,
	AuthValidationResult,
	EmbeddingProviderDefinition,
	ChatModelConfig,
} from "../types/provider/index";
import OpenRouterLogo from "../components/ui/logos/OpenRouterLogo.svelte";
import { populateOpenRouterCache, type OpenRouterModelInfo } from "./openrouterModels";

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
	data?: OpenRouterModelInfo[];
}

// =============================================================================
// Provider Definition
// =============================================================================

/**
 * OpenRouter built-in provider definition.
 *
 * Supports chat and embedding models.
 */
export const openrouterProvider: EmbeddingProviderDefinition = {
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

	createEmbeddingInstance: (auth: AuthObject, modelId: string) => {
		const config: Record<string, unknown> = {
			model: modelId,
			apiKey: auth.apiKey,
			configuration: {
				baseURL: OPENROUTER_BASE_URL,
			},
		};

		// Add custom headers if provided
		if (auth.headers && Object.keys(auth.headers).length > 0) {
			(config.configuration as Record<string, unknown>).defaultHeaders = auth.headers;
		}

		return new OpenAIEmbeddings(config);
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

		// Populate the metadata cache with full model info
		populateOpenRouterCache(resources);

		return resources.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.trim() !== "");
	},

	discoverEmbeddingModels: async (auth: AuthObject): Promise<string[]> => {
		if (!auth.apiKey?.trim()) {
			throw new Error("OpenRouter embedding model discovery requires an API key.");
		}

		const headers: Record<string, string> = {
			Authorization: `Bearer ${auth.apiKey}`,
			"Content-Type": "application/json",
		};

		// Add custom headers if provided
		if (auth.headers) {
			Object.assign(headers, auth.headers);
		}

		// Use Obsidian's requestUrl to bypass CORS for the dedicated embeddings models endpoint
		try {
			const response = await requestUrl({
				url: `${OPENROUTER_BASE_URL}/embeddings/models`,
				method: "GET",
				headers,
			});

			const payload = response.json as OpenRouterModelResponse;
			const resources = Array.isArray(payload.data) ? payload.data : [];
			return resources.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.trim() !== "");
		} catch (error) {
			// If the dedicated endpoint fails, fall back to filtering all models
			const response = await globalThis.fetch(`${OPENROUTER_BASE_URL}/models`, {
				method: "GET",
				headers,
			});

			if (!response.ok) {
				const errorBody = await safeReadText(response);
				throw new Error(`Embedding model discovery failed: ${errorBody || response.statusText}`);
			}

			const payload = (await response.json()) as OpenRouterModelResponse;
			const resources = Array.isArray(payload.data) ? payload.data : [];

			// Filter to embedding models by name patterns
			return resources
				.map((r) => r.id)
				.filter((id): id is string => {
					if (typeof id !== "string" || !id.trim()) return false;
					const lower = id.toLowerCase();
					return (
						lower.includes("embed") ||
						lower.includes("bge-") ||
						lower.includes("voyage") ||
						lower.includes("e5-") ||
						lower.includes("gte-") ||
						lower.includes("nomic-") ||
						lower.includes("-embedding")
					);
				});
		}
	},
};
