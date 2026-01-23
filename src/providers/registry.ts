/**
 * Provider Registry (Singleton)
 *
 * Runtime registry that manages configured providers.
 * - Stores configured providers with their definition and auth
 * - Creates LangChain instances on demand
 * - Single source of truth for runtime provider access
 *
 * The registry only contains CONFIGURED providers.
 * Settings (dataStore) remains the persistent source of truth.
 */

import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type {
	AuthObject,
	AuthValidationResult,
	BaseProviderDefinition,
	ChatModelConfig,
	CustomProviderMeta,
} from "../types/provider/index";
import { ProviderNotFoundError } from "./errors";
import { getBuiltInProvider, isBuiltInProvider } from "./index";
import { createOpenAICompatibleProvider } from "./openai-compatible";

/**
 * Entry for a configured provider in the registry.
 */
interface RegisteredProvider {
	definition: BaseProviderDefinition;
	auth: AuthObject;
}

/**
 * Singleton registry for configured providers.
 *
 * Only contains providers that are configured and ready to use.
 * Use `getRegistry()` to access the singleton instance.
 */
class ProviderRegistry {
	private static instance: ProviderRegistry | null = null;

	/** Configured providers with their definition and auth */
	private readonly providers = new Map<string, RegisteredProvider>();

	/** Custom provider metadata (needed to recreate definitions) */
	private readonly customMeta = new Map<string, CustomProviderMeta>();

	private constructor() {
		// Private constructor for singleton
	}

	/**
	 * Gets the singleton instance.
	 */
	static getInstance(): ProviderRegistry {
		if (!ProviderRegistry.instance) {
			ProviderRegistry.instance = new ProviderRegistry();
		}
		return ProviderRegistry.instance;
	}

	/**
	 * Resets the singleton instance (for testing).
	 */
	static resetInstance(): void {
		ProviderRegistry.instance = null;
	}

	// =========================================================================
	// Registration
	// =========================================================================

	/**
	 * Registers a configured provider.
	 *
	 * @param id - Provider ID
	 * @param definition - Provider definition
	 * @param auth - Resolved authentication object
	 */
	register(id: string, definition: BaseProviderDefinition, auth: AuthObject): void {
		this.providers.set(id, { definition, auth });
	}

	/**
	 * Registers a custom provider with its metadata.
	 * Creates the definition from metadata using OpenAI-compatible factory.
	 *
	 * @param id - Provider ID
	 * @param meta - Custom provider metadata
	 * @param auth - Resolved authentication object
	 */
	registerCustom(id: string, meta: CustomProviderMeta, auth: AuthObject): void {
		this.customMeta.set(id, meta);
		const definition = createOpenAICompatibleProvider({ id, ...meta });
		this.providers.set(id, { definition, auth });
	}

	/**
	 * Unregisters a provider.
	 */
	unregister(id: string): void {
		this.providers.delete(id);
		this.customMeta.delete(id);
	}

	/**
	 * Clears all registered providers.
	 */
	clear(): void {
		this.providers.clear();
		this.customMeta.clear();
	}

	// =========================================================================
	// Queries
	// =========================================================================

	/**
	 * Checks if a provider is registered (configured).
	 */
	has(id: string): boolean {
		return this.providers.has(id);
	}

	/**
	 * Gets a provider definition.
	 * Returns undefined if not registered.
	 */
	get(id: string): BaseProviderDefinition | undefined {
		return this.providers.get(id)?.definition;
	}

	/**
	 * Gets auth for a registered provider.
	 * Returns undefined if not registered.
	 */
	getAuth(id: string): AuthObject | undefined {
		return this.providers.get(id)?.auth;
	}

	/**
	 * Updates auth for a registered provider.
	 * Does nothing if provider is not registered.
	 */
	updateAuth(id: string, auth: AuthObject): void {
		const entry = this.providers.get(id);
		if (entry) {
			entry.auth = auth;
		}
	}

	/**
	 * Lists all registered provider IDs.
	 */
	list(): string[] {
		return Array.from(this.providers.keys());
	}

	/**
	 * Checks if a provider ID is a custom provider.
	 */
	isCustom(id: string): boolean {
		return this.customMeta.has(id);
	}

	/**
	 * Gets custom provider metadata.
	 */
	getCustomMeta(id: string): CustomProviderMeta | undefined {
		return this.customMeta.get(id);
	}

	// =========================================================================
	// Delegated Operations
	// =========================================================================

	/**
	 * Validates auth for a provider.
	 *
	 * @param id - Provider ID (must be registered)
	 * @throws ProviderNotFoundError if provider is not registered
	 */
	async validateAuth(id: string): Promise<AuthValidationResult> {
		const entry = this.providers.get(id);
		if (!entry) {
			throw new ProviderNotFoundError(id);
		}
		return entry.definition.validateAuth(entry.auth);
	}

	/**
	 * Discovers available models for a provider.
	 *
	 * @param id - Provider ID (must be registered)
	 * @throws ProviderNotFoundError if provider is not registered
	 */
	async discoverModels(id: string): Promise<string[]> {
		const entry = this.providers.get(id);
		if (!entry) {
			throw new ProviderNotFoundError(id);
		}
		return entry.definition.discoverModels(entry.auth);
	}

	/**
	 * Creates a LangChain chat instance.
	 *
	 * @param id - Provider ID (must be registered)
	 * @param modelId - Model ID
	 * @param options - Optional model configuration
	 * @throws ProviderNotFoundError if provider is not registered
	 */
	createChatInstance(id: string, modelId: string, options?: Partial<ChatModelConfig>): BaseChatModel {
		const entry = this.providers.get(id);
		if (!entry) {
			throw new ProviderNotFoundError(id);
		}
		return entry.definition.createChatInstance(entry.auth, modelId, options);
	}

	/**
	 * Creates a LangChain embedding instance.
	 *
	 * @param id - Provider ID (must be registered)
	 * @param modelId - Model ID
	 * @throws ProviderNotFoundError if provider is not registered
	 * @throws Error if provider doesn't support embeddings
	 */
	createEmbeddingInstance(id: string, modelId: string): EmbeddingsInterface {
		const entry = this.providers.get(id);
		if (!entry) {
			throw new ProviderNotFoundError(id);
		}
		if (!entry.definition.createEmbeddingInstance) {
			throw new Error(`Provider "${id}" does not support embeddings`);
		}
		return entry.definition.createEmbeddingInstance(entry.auth, modelId);
	}

	// =========================================================================
	// Static Helpers (don't require registration)
	// =========================================================================

	/**
	 * Gets a provider definition without requiring registration.
	 * Useful for settings UI before a provider is configured.
	 *
	 * @param id - Provider ID
	 * @param customMeta - Custom provider metadata (if custom provider)
	 */
	static getDefinition(
		id: string,
		customMeta?: Record<string, CustomProviderMeta>,
	): BaseProviderDefinition | undefined {
		// Check built-in first
		if (isBuiltInProvider(id)) {
			return getBuiltInProvider(id);
		}

		// Check custom
		const meta = customMeta?.[id];
		if (meta) {
			return createOpenAICompatibleProvider({ id, ...meta });
		}

		return undefined;
	}
}

/**
 * Gets the singleton provider registry instance.
 */
export function getRegistry(): ProviderRegistry {
	return ProviderRegistry.getInstance();
}

/**
 * Resets the registry (for testing).
 */
export function resetRegistry(): void {
	ProviderRegistry.resetInstance();
}

// Also export the class for type usage
export { ProviderRegistry };
