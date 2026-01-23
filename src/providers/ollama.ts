/**
 * Ollama built-in provider definition
 *
 * This provider supports:
 * - Chat models (llama3.1, mistral, codellama, etc.)
 * - Embedding models (nomic-embed-text, mxbai-embed-large, etc.)
 * - Model discovery via Ollama API (/api/tags)
 *
 * Authentication: baseUrl (required), apiKey (optional), headers (optional)
 * Ollama runs locally on the user's machine, defaulting to http://localhost:11434
 */

import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import OllamaLogo from "../components/ui/logos/OllamaLogo.svelte";
import type {
	AuthObject,
	AuthValidationResult,
	ChatModelConfig,
	EmbeddingProviderDefinition,
} from "../types/provider/index";

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
// Types
// =============================================================================

interface OllamaTagsResponse {
	models?: Array<{ name?: string }>;
}

// =============================================================================
// Provider Definition
// =============================================================================

/**
 * Ollama built-in provider definition.
 *
 * Supports chat models, embedding models, and model discovery.
 */
export const ollamaProvider: EmbeddingProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "ollama",
	displayName: "Ollama",
	logo: OllamaLogo,

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
	auth: {
		baseUrl: {
			label: "Server URL",
			description: "The URL where your Ollama server is running",
			kind: "text",
			required: true,
			placeholder: "http://localhost:11434",
		},
		apiKey: {
			label: "API Key",
			description: "API key for authentication (usually not required for local Ollama)",
			kind: "secret",
			required: false,
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
		if (!auth.baseUrl) {
			throw new Error("Ollama requires a server URL");
		}

		const config: Record<string, unknown> = {
			model: modelId,
			baseUrl: sanitizeBaseUrl(auth.baseUrl),
		};

		if (options?.temperature !== undefined) {
			config.temperature = options.temperature;
		}

		// Add contextWindow as numCtx (Ollama-specific parameter)
		if (options?.contextWindow !== undefined) {
			config.numCtx = options.contextWindow;
		}

		return new ChatOllama(config);
	},

	createEmbeddingInstance: (auth: AuthObject, modelId: string) => {
		if (!auth.baseUrl) {
			throw new Error("Ollama requires a server URL");
		}

		return new OllamaEmbeddings({
			model: modelId,
			baseUrl: sanitizeBaseUrl(auth.baseUrl),
		});
	},

	validateAuth: async (auth: AuthObject): Promise<AuthValidationResult> => {
		if (!auth.baseUrl?.trim()) {
			return { valid: false, error: "Server URL is required" };
		}

		const baseUrl = sanitizeBaseUrl(auth.baseUrl);

		let response: Response;
		try {
			response = await globalThis.fetch(`${baseUrl}/api/tags`, {
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

		const errorBody = await safeReadText(response);

		if (response.status === 401 || response.status === 403) {
			return { valid: false, error: errorBody || `Authentication failed (${response.status})` };
		}

		return { valid: false, error: errorBody || `Request failed with status ${response.status}` };
	},

	discoverModels: async (auth: AuthObject): Promise<string[]> => {
		if (!auth.baseUrl?.trim()) {
			throw new Error("Ollama server URL is required");
		}

		const baseUrl = sanitizeBaseUrl(auth.baseUrl);

		const response = await globalThis.fetch(`${baseUrl}/api/tags`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			const errorBody = await safeReadText(response);
			throw new Error(`Model discovery failed: ${errorBody || response.statusText}`);
		}

		const payload = (await response.json()) as OllamaTagsResponse;
		const models = Array.isArray(payload.models) ? payload.models : [];

		return models
			.map((m) => m.name)
			.filter((name): name is string => typeof name === "string" && name.trim() !== "");
	},
};
