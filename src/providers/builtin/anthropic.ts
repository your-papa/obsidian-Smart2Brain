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

import { createAnthropicChatModel, discoverAnthropicModels, validateAnthropicAuth } from "../base/anthropicRuntime";
import { buildFieldBasedAuth } from "../helpers";
import type {
	AuthValidationResult,
	BuiltInProviderDefinition,
	ChatModelConfig,
	ChatModelFactory,
	DiscoveredModels,
	ModelOptions,
	RuntimeAuthState,
	RuntimeFieldBasedAuthState,
	RuntimeProviderDefinition,
} from "../types";

/**
 * Default chat models available for Anthropic.
 * These are used to create the initial runtime definition.
 * Note: Anthropic doesn't support model discovery, so these are fixed.
 */
const DEFAULT_CHAT_MODELS = [
	"claude-3-5-sonnet-20241022",
	"claude-3-5-haiku-20241022",
	"claude-3-opus-20240229",
	"claude-3-sonnet-20240229",
	"claude-3-haiku-20240307",
];

/**
 * Anthropic built-in provider definition.
 *
 * Implements BuiltInProviderDefinition with:
 * - Field-based auth (apiKey required only)
 * - Limited capabilities (chat only, no embedding, no model discovery)
 * - Runtime factories using @langchain/anthropic
 */
export const anthropicProvider: BuiltInProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "anthropic",
	displayName: "Anthropic",
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
	 * Creates the runtime provider definition with model factories.
	 *
	 * The factories capture the auth state in closures so models can be
	 * created without re-passing credentials.
	 */
	createRuntimeDefinition: async (auth: RuntimeAuthState): Promise<RuntimeProviderDefinition> => {
		if (auth.type !== "field-based") {
			throw new Error("Anthropic provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;

		// Create chat model factories
		const chatModels: Record<string, ChatModelFactory> = {};
		for (const modelId of DEFAULT_CHAT_MODELS) {
			chatModels[modelId] = async (options?: ModelOptions) => {
				// Cast ModelOptions to ChatModelConfig if provided
				const chatConfig = options as ChatModelConfig | undefined;
				return createAnthropicChatModel(modelId, fieldAuth, chatConfig);
			};
		}

		return {
			chatModels,
			embeddingModels: {}, // Anthropic doesn't support embeddings
			defaultChatModel: "claude-3-5-sonnet-20241022",
			// No defaultEmbeddingModel - Anthropic doesn't support embeddings
		};
	},

	/**
	 * Validates authentication credentials.
	 *
	 * First checks that required fields are present, then delegates to
	 * the base runtime's validateAnthropicAuth for API-level validation.
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
		return validateAnthropicAuth(fieldAuth);
	},

	/**
	 * Discovers available models from Anthropic API.
	 *
	 * Delegates to the base runtime's discoverAnthropicModels function.
	 */
	discoverModels: async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
		if (auth.type !== "field-based") {
			throw new Error("Anthropic provider requires field-based authentication");
		}

		return discoverAnthropicModels(auth as RuntimeFieldBasedAuthState);
	},
};
