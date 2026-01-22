/**
 * SAP AI Core built-in provider definition
 *
 * This provider supports:
 * - Chat models (gpt-4o, gpt-4o-mini, gpt-35-turbo, etc. via SAP AI Core)
 * - Embedding models (text-embedding-ada-002, text-embedding-3-small, etc.)
 * - Model discovery via SAP AI Core API
 *
 * Authentication: Field-based with apiKey (token), baseUrl (deployment URL), resourceGroup
 *
 * NOTE: This provider requires the optional @sap-ai-sdk/langchain package.
 * Users must install it separately: npm install @sap-ai-sdk/langchain
 *
 * SAP AI Core provides access to foundation models (Azure OpenAI, etc.) through
 * SAP's AI platform, using SAP-specific authentication and deployment URLs.
 */

import {
	createSapAiCoreChatModel,
	createSapAiCoreEmbeddingModel,
	discoverSapAiCoreModels,
	validateSapAiCoreAuth,
} from "../base/sapAiCoreRuntime";
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
 * Default chat models available for SAP AI Core.
 * These are common models available through SAP AI Core's foundation models.
 * Users can discover their available models via model discovery.
 */
const DEFAULT_CHAT_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-35-turbo"];

/**
 * Default embedding models available for SAP AI Core.
 * These are common embedding models available through SAP AI Core.
 */
const DEFAULT_EMBEDDING_MODELS = ["text-embedding-ada-002", "text-embedding-3-small"];

/**
 * SAP AI Core built-in provider definition.
 *
 * Implements BuiltInProviderDefinition with:
 * - Field-based auth (apiKey/token required, baseUrl required, resourceGroup optional)
 * - Full capabilities (chat, embedding, modelDiscovery)
 * - Runtime factories using @sap-ai-sdk/langchain
 */
export const sapAiCoreProvider: BuiltInProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "sap-ai-core",
	displayName: "SAP AI Core",
	isBuiltIn: true,

	// =========================================================================
	// Setup Instructions
	// =========================================================================
	setupInstructions: {
		steps: [
			"Set up SAP AI Core in your SAP BTP account",
			"Create a deployment for foundation models",
			"Generate an API token from the SAP AI Launchpad",
			"Copy the deployment URL and API token below",
			"Install the SAP AI SDK: npm install @sap-ai-sdk/langchain",
		],
		link: {
			url: "https://help.sap.com/docs/sap-ai-core",
			text: "SAP AI Core Documentation",
		},
	},

	// =========================================================================
	// Auth Configuration
	// =========================================================================
	auth: buildFieldBasedAuth({
		fields: {
			apiKey: { required: true, label: "API Token" },
			baseUrl: {
				required: true,
				label: "Deployment URL",
				placeholder: "https://api.ai.YOUR-SUBACCOUNT.sap.hana.ondemand.com/v2",
			},
		},
		customFields: {
			resourceGroup: {
				label: "Resource Group",
				kind: "text",
				required: false,
				placeholder: "default",
			},
		},
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
			throw new Error("SAP AI Core provider requires field-based authentication");
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;

		// Create chat model factories
		const chatModels: Record<string, ChatModelFactory> = {};
		for (const modelId of DEFAULT_CHAT_MODELS) {
			chatModels[modelId] = async (options?: ModelOptions) => {
				// Cast ModelOptions to ChatModelConfig if provided
				const chatConfig = options as ChatModelConfig | undefined;
				return createSapAiCoreChatModel(modelId, fieldAuth, chatConfig);
			};
		}

		// Create embedding model factories
		const embeddingModels: Record<string, EmbeddingModelFactory> = {};
		for (const modelId of DEFAULT_EMBEDDING_MODELS) {
			embeddingModels[modelId] = async () => {
				return createSapAiCoreEmbeddingModel(modelId, fieldAuth);
			};
		}

		return {
			chatModels,
			embeddingModels,
			defaultChatModel: "gpt-4o",
			defaultEmbeddingModel: "text-embedding-ada-002",
		};
	},

	/**
	 * Validates authentication credentials.
	 *
	 * First checks that required fields are present, then delegates to
	 * the base runtime's validateSapAiCoreAuth for API-level validation.
	 */
	validateAuth: async (auth: RuntimeAuthState): Promise<AuthValidationResult> => {
		// Check auth type
		if (auth.type !== "field-based") {
			return { valid: false, error: "Invalid authentication type. Expected field-based auth." };
		}

		const fieldAuth = auth as RuntimeFieldBasedAuthState;

		// Check API token presence
		const apiKey = fieldAuth.values.apiKey?.trim();
		if (!apiKey) {
			return { valid: false, error: "API token is required" };
		}

		// Check deployment URL presence
		const baseUrl = fieldAuth.values.baseUrl?.trim();
		if (!baseUrl) {
			return { valid: false, error: "Deployment URL is required" };
		}

		// Delegate to base runtime for API validation
		return validateSapAiCoreAuth(fieldAuth);
	},

	/**
	 * Discovers available models from SAP AI Core API.
	 *
	 * Delegates to the base runtime's discoverSapAiCoreModels function.
	 */
	discoverModels: async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
		if (auth.type !== "field-based") {
			throw new Error("SAP AI Core provider requires field-based authentication");
		}

		return discoverSapAiCoreModels(auth as RuntimeFieldBasedAuthState);
	},
};
