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

import {
	createOllamaChatModel,
	createOllamaEmbeddingModel,
	discoverOllamaModels,
	validateOllamaConnection,
} from "../base/ollamaRuntime";
import { buildFieldBasedAuth } from "../helpers";
import type {
	AuthValidationResult,
	BuiltInProviderDefinition,
	ChatModelConfig,
	ChatModelFactory,
	DiscoveredModels,
	EmbeddingModelFactory,
	ModelOptions,
	RuntimeAuthState,
	RuntimeFieldBasedAuthState,
	RuntimeProviderDefinition,
} from "../types";

/**
 * Default chat models available for Ollama.
 * These are common models that users might have installed.
 * Users can discover their actual installed models via model discovery.
 */
const DEFAULT_CHAT_MODELS = ["llama3.1", "llama3.1:70b", "mistral", "codellama", "gemma2"];

/**
 * Default embedding models available for Ollama.
 * These are common embedding models that users might have installed.
 */
const DEFAULT_EMBEDDING_MODELS = ["nomic-embed-text", "mxbai-embed-large"];

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
	 * Creates the runtime provider definition with model factories.
	 *
	 * The factories capture the auth state in closures so models can be
	 * created without re-passing credentials.
	 */
	createRuntimeDefinition: async (auth: RuntimeAuthState): Promise<RuntimeProviderDefinition> => {
		if (auth.type !== "field-based") {
			throw new Error("Ollama provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;

		// Create chat model factories
		const chatModels: Record<string, ChatModelFactory> = {};
		for (const modelId of DEFAULT_CHAT_MODELS) {
			chatModels[modelId] = async (options?: ModelOptions) => {
				// Cast ModelOptions to ChatModelConfig if provided
				const chatConfig = options as ChatModelConfig | undefined;
				return createOllamaChatModel(modelId, fieldAuth, chatConfig);
			};
		}

		// Create embedding model factories
		const embeddingModels: Record<string, EmbeddingModelFactory> = {};
		for (const modelId of DEFAULT_EMBEDDING_MODELS) {
			embeddingModels[modelId] = async () => {
				return createOllamaEmbeddingModel(modelId, fieldAuth);
			};
		}

		return {
			chatModels,
			embeddingModels,
			defaultChatModel: "llama3.1",
			defaultEmbeddingModel: "nomic-embed-text",
		};
	},

	/**
	 * Validates authentication credentials.
	 *
	 * For Ollama, this checks if the server is reachable.
	 * There's no API key to validate - just a connection test.
	 */
	validateAuth: async (auth: RuntimeAuthState): Promise<AuthValidationResult> => {
		// Check auth type
		if (auth.type !== "field-based") {
			return { valid: false, error: "Invalid authentication type. Expected field-based auth." };
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;

		// Delegate to base runtime for connection validation
		// Ollama doesn't require an API key, so we just check if the server is reachable
		return validateOllamaConnection(fieldAuth);
	},

	/**
	 * Discovers available models from Ollama API.
	 *
	 * Delegates to the base runtime's discoverOllamaModels function.
	 */
	discoverModels: async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
		if (auth.type !== "field-based") {
			throw new Error("Ollama provider requires field-based authentication");
		}

		return discoverOllamaModels(auth as RuntimeFieldBasedAuthState);
	},
};
