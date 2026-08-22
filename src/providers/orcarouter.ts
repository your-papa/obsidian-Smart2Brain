/**
 * OrcaRouter built-in provider definition
 *
 * [OrcaRouter](https://www.orcarouter.ai) is an OpenAI-compatible gateway that
 * routes to 200+ frontier models through a single endpoint
 * (`https://api.orcarouter.ai/v1`). It also runs gateway-level, zero-trust
 * security for AI agents on the same endpoint — screening every prompt/response
 * and governing every tool call on a default-deny basis, with no application
 * code changes.
 *
 * This provider supports:
 * - Chat models (routed via `orcarouter/auto`, plus any vendor/model pair)
 * - Embedding models (filtered by name heuristics)
 * - Model discovery via the OrcaRouter API
 *
 * Authentication: apiKey (required)
 */

import { ChatOpenAI } from "@langchain/openai";
import { requestUrl } from "obsidian";
import OrcaRouterLogo from "../components/ui/logos/OrcaRouterLogo.svelte";
import type {
	AuthObject,
	AuthValidationResult,
	EmbeddingProviderDefinition,
	ChatModelConfig,
} from "../types/provider/index";
import {
	createBufferedTransportedChatOpenAI,
	createTransportedChatOpenAI,
	createTransportedOpenAIEmbeddings,
} from "./chatProviders";
import { populateOrcaRouterCache, type OrcaRouterModelInfo } from "./orcarouterModels";

// =============================================================================
// Constants
// =============================================================================

/** OrcaRouter API base URL */
const ORCAROUTER_BASE_URL = "https://api.orcarouter.ai/v1";

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

interface OrcaRouterModelResponse {
	data?: OrcaRouterModelInfo[];
}

// =============================================================================
// Provider Definition
// =============================================================================

/**
 * OrcaRouter built-in provider definition.
 *
 * Supports chat and embedding models.
 */
export const orcarouterProvider: EmbeddingProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "orcarouter",
	displayName: "OrcaRouter",
	logo: OrcaRouterLogo,

	// =========================================================================
	// Setup Instructions
	// =========================================================================
	setupInstructions: {
		steps: ["Create an account at OrcaRouter", "Generate an API key from the Keys page", "Paste the API key below"],
		link: {
			url: "https://www.orcarouter.ai",
			text: "OrcaRouter",
		},
	},

	// =========================================================================
	// Auth Configuration
	// =========================================================================
	auth: {
		apiKey: {
			label: "API Key",
			description: "Your OrcaRouter API key for authentication",
			kind: "secret",
			required: true,
			placeholder: "sk-orca-...",
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
				baseURL: ORCAROUTER_BASE_URL,
			},
		};

		if (options?.temperature !== undefined) {
			config.temperature = options.temperature;
		}

		// Add custom headers if provided
		if (auth.headers && Object.keys(auth.headers).length > 0) {
			(config.configuration as Record<string, unknown>).defaultHeaders = auth.headers;
		}

		return createTransportedChatOpenAI("orcarouter", config as ConstructorParameters<typeof ChatOpenAI>[0]);
	},

	createSubAgentChatInstance: (auth: AuthObject, modelId: string, options?: Partial<ChatModelConfig>) => {
		const config: Record<string, unknown> = {
			model: modelId,
			apiKey: auth.apiKey,
			configuration: { baseURL: ORCAROUTER_BASE_URL },
		};
		if (options?.temperature !== undefined) {
			config.temperature = options.temperature;
		}
		if (auth.headers && Object.keys(auth.headers).length > 0) {
			(config.configuration as Record<string, unknown>).defaultHeaders = auth.headers;
		}
		return createBufferedTransportedChatOpenAI("orcarouter", config as ConstructorParameters<typeof ChatOpenAI>[0]);
	},

	createEmbeddingInstance: (auth: AuthObject, modelId: string) => {
		const config: Record<string, unknown> = {
			model: modelId,
			apiKey: auth.apiKey,
			// OpenAI SDK v6 defaults to encoding_format:'base64' which many third-party
			// providers don't support, causing malformed responses. Use 'float' explicitly.
			encodingFormat: "float",
			configuration: {
				baseURL: ORCAROUTER_BASE_URL,
			},
		};

		// Add custom headers if provided
		if (auth.headers && Object.keys(auth.headers).length > 0) {
			(config.configuration as Record<string, unknown>).defaultHeaders = auth.headers;
		}

		return createTransportedOpenAIEmbeddings("orcarouter", config);
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

		try {
			const response = await requestUrl({
				url: `${ORCAROUTER_BASE_URL}/models`,
				method: "GET",
				headers,
				throw: false,
			});

			if (response.status >= 200 && response.status < 300) {
				return { valid: true };
			}

			let errorMessage: string | undefined;
			try {
				const parsed = response.json as { error?: { message?: string }; message?: string };
				errorMessage = parsed?.error?.message ?? parsed?.message;
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
				error: errorMessage || response.text || `Request failed with status ${response.status}`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { valid: false, error: `Connection failed: ${message}` };
		}
	},

	discoverModels: async (auth: AuthObject): Promise<string[]> => {
		if (!auth.apiKey?.trim()) {
			throw new Error("OrcaRouter model discovery requires an API key.");
		}

		const headers: Record<string, string> = {
			Authorization: `Bearer ${auth.apiKey}`,
			"Content-Type": "application/json",
		};

		// Add custom headers if provided
		if (auth.headers) {
			Object.assign(headers, auth.headers);
		}

		const response = await globalThis.fetch(`${ORCAROUTER_BASE_URL}/models`, {
			method: "GET",
			headers,
		});

		if (!response.ok) {
			const errorBody = await safeReadText(response);
			throw new Error(`Model discovery failed: ${errorBody || response.statusText}`);
		}

		const payload = (await response.json()) as OrcaRouterModelResponse;
		const resources = Array.isArray(payload.data) ? payload.data : [];

		// Populate the metadata cache with full model info
		populateOrcaRouterCache(resources);

		return resources.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.trim() !== "");
	},

	discoverEmbeddingModels: async (auth: AuthObject): Promise<string[]> => {
		if (!auth.apiKey?.trim()) {
			throw new Error("OrcaRouter embedding model discovery requires an API key.");
		}

		const headers: Record<string, string> = {
			Authorization: `Bearer ${auth.apiKey}`,
			"Content-Type": "application/json",
		};

		// Add custom headers if provided
		if (auth.headers) {
			Object.assign(headers, auth.headers);
		}

		try {
			const response = await requestUrl({
				url: `${ORCAROUTER_BASE_URL}/models`,
				method: "GET",
				headers,
			});

			const payload = response.json as OrcaRouterModelResponse;
			const resources = Array.isArray(payload.data) ? payload.data : [];

			// OrcaRouter exposes embedding-capable models with a supported_endpoint_types
			// value of "embeddings". Filter on that first, falling back to name patterns.
			const embeddingIds = resources
				.filter((r) => {
					const entry = r as { supported_endpoint_types?: string[] };
					return entry.supported_endpoint_types?.includes("embeddings");
				})
				.map((r) => r.id)
				.filter((id): id is string => typeof id === "string" && id.trim() !== "");

			if (embeddingIds.length > 0) {
				return embeddingIds;
			}
		} catch {
			// fall through to name-heuristic filtering
		}

		// Fallback: filter all models by name patterns
		const fallbackResponse = await globalThis.fetch(`${ORCAROUTER_BASE_URL}/models`, {
			method: "GET",
			headers,
		});

		if (!fallbackResponse.ok) {
			const errorBody = await safeReadText(fallbackResponse);
			throw new Error(`Embedding model discovery failed: ${errorBody || fallbackResponse.statusText}`);
		}

		const payload = (await fallbackResponse.json()) as OrcaRouterModelResponse;
		const resources = Array.isArray(payload.data) ? payload.data : [];

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
	},
};
