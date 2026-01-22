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

import {
	createOpenAIChatModel,
	createOpenAIEmbeddingModel,
	discoverOpenAIModels,
	validateOpenAIAuth,
} from "../base/openaiCompatible";
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
 * Default chat models available for OpenAI.
 * These are used to create the initial runtime definition.
 * Users can discover more models via model discovery.
 */
const DEFAULT_CHAT_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"];

/**
 * Default embedding models available for OpenAI.
 */
const DEFAULT_EMBEDDING_MODELS = ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"];

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
	 * Creates the runtime provider definition with model factories.
	 *
	 * The factories capture the auth state in closures so models can be
	 * created without re-passing credentials.
	 */
	createRuntimeDefinition: async (auth: RuntimeAuthState): Promise<RuntimeProviderDefinition> => {
		if (auth.type !== "field-based") {
			throw new Error("OpenAI provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;

		// Create chat model factories
		const chatModels: Record<string, ChatModelFactory> = {};
		for (const modelId of DEFAULT_CHAT_MODELS) {
			chatModels[modelId] = async (options?: ModelOptions) => {
				// Cast ModelOptions to ChatModelConfig if provided
				const chatConfig = options as ChatModelConfig | undefined;
				return createOpenAIChatModel(modelId, fieldAuth, chatConfig);
			};
		}

		// Create embedding model factories
		const embeddingModels: Record<string, EmbeddingModelFactory> = {};
		for (const modelId of DEFAULT_EMBEDDING_MODELS) {
			embeddingModels[modelId] = async () => {
				return createOpenAIEmbeddingModel(modelId, fieldAuth);
			};
		}

		return {
			chatModels,
			embeddingModels,
			defaultChatModel: "gpt-4o",
			defaultEmbeddingModel: "text-embedding-3-small",
		};
	},

	/**
	 * Validates authentication credentials.
	 *
	 * First checks that required fields are present, then delegates to
	 * the base runtime's validateOpenAIAuth for API-level validation.
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

		// Delegate to base runtime for API validation
		return validateOpenAIAuth(fieldAuth);
	},

	/**
	 * Discovers available models from OpenAI API.
	 *
	 * Delegates to the base runtime's discoverOpenAIModels function.
	 */
	discoverModels: async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
		if (auth.type !== "field-based") {
			throw new Error("OpenAI provider requires field-based authentication");
		}

		return discoverOpenAIModels(auth as RuntimeFieldBasedAuthState);
	},
};
