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
	ProviderInstanceMeta,
} from "../types/provider/index";
import { ProviderNotFoundError } from "./errors";
import { getProviderDefinition } from "./index";

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
	 * Unregisters a provider.
	 */
	unregister(id: string): void {
		this.providers.delete(id);
	}

	/**
	 * Clears all registered providers.
	 */
	clear(): void {
		this.providers.clear();
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
	 * Creates a chat instance for use as a subagent model. Uses the provider's
	 * `createSubAgentChatInstance` (buffered, non-streaming transport) when available,
	 * else falls back to `createChatInstance`.
	 */
	createSubAgentChatInstance(id: string, modelId: string, options?: Partial<ChatModelConfig>): BaseChatModel {
		const entry = this.providers.get(id);
		if (!entry) {
			throw new ProviderNotFoundError(id);
		}
		const factory = entry.definition.createSubAgentChatInstance ?? entry.definition.createChatInstance;
		return factory(entry.auth, modelId, options);
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
	 * @param providerMeta - Provider instance metadata
	 */
	static getDefinition(
		id: string,
		providerMeta?: Record<string, ProviderInstanceMeta>,
	): BaseProviderDefinition | undefined {
		return getProviderDefinition(id, providerMeta);
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
