/**
 * Provider Registry
 *
 * Tracks which providers are configured and their authentication state.
 * Delegates to provider definitions for creating LangChain instances.
 */

import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ProviderNotFoundError } from "./errors";
import { getBuiltInProvider } from "./index";
import type { ChatModelConfig, RuntimeAuthState } from "./types";

/**
 * Internal state for a registered provider.
 */
interface RegisteredProvider {
	auth: RuntimeAuthState;
}

/**
 * Registry for configured providers.
 *
 * Tracks which providers are configured with their auth state.
 * Uses provider definitions to create LangChain instances on demand.
 */
export class ProviderRegistry {
	private readonly providers = new Map<string, RegisteredProvider>();

	/**
	 * Registers a provider with its authentication state.
	 */
	registerProvider(name: string, auth: RuntimeAuthState): this {
		const key = ProviderRegistry.normalizeName(name);
		this.providers.set(key, { auth });
		return this;
	}

	/**
	 * Unregisters a provider.
	 */
	unregisterProvider(name: string): this {
		const key = ProviderRegistry.normalizeName(name);
		this.providers.delete(key);
		return this;
	}

	/**
	 * Checks if a provider is registered.
	 */
	hasProvider(name: string): boolean {
		return this.providers.has(ProviderRegistry.normalizeName(name));
	}

	/**
	 * Lists all registered provider names.
	 */
	listProviders(): string[] {
		return Array.from(this.providers.keys());
	}

	/**
	 * Gets the auth state for a registered provider.
	 * @throws ProviderNotFoundError if provider is not registered
	 */
	getAuth(name: string): RuntimeAuthState {
		const key = ProviderRegistry.normalizeName(name);
		const provider = this.providers.get(key);
		if (!provider) {
			throw new ProviderNotFoundError(name);
		}
		return provider.auth;
	}

	/**
	 * Creates a LangChain chat instance for the given provider and model.
	 * Delegates to the provider definition's createChatInstance method.
	 *
	 * @param providerId - The provider ID (e.g., "openai", "anthropic", "ollama")
	 * @param modelId - The model ID (e.g., "gpt-4o", "claude-3-5-sonnet-20241022")
	 * @param options - Optional model configuration (temperature, contextWindow, etc.)
	 * @throws ProviderNotFoundError if provider is not registered or not found
	 */
	getChatInstance(providerId: string, modelId: string, options?: Partial<ChatModelConfig>): BaseChatModel {
		const auth = this.getAuth(providerId);
		const providerDef = getBuiltInProvider(providerId);

		if (!providerDef) {
			throw new ProviderNotFoundError(providerId);
		}

		return providerDef.createChatInstance(auth, modelId, options);
	}

	/**
	 * Creates a LangChain embedding instance for the given provider and model.
	 * Delegates to the provider definition's createEmbeddingInstance method.
	 *
	 * @param providerId - The provider ID (e.g., "openai", "ollama")
	 * @param modelId - The model ID (e.g., "text-embedding-3-small", "nomic-embed-text")
	 * @throws ProviderNotFoundError if provider is not registered, not found, or doesn't support embeddings
	 */
	getEmbeddingInstance(providerId: string, modelId: string): EmbeddingsInterface {
		const auth = this.getAuth(providerId);
		const providerDef = getBuiltInProvider(providerId);

		if (!providerDef) {
			throw new ProviderNotFoundError(providerId);
		}

		if (!providerDef.createEmbeddingInstance) {
			throw new Error(`Provider "${providerId}" does not support embeddings`);
		}

		return providerDef.createEmbeddingInstance(auth, modelId);
	}

	/**
	 * Normalizes provider names to lowercase.
	 */
	private static normalizeName(name: string): string {
		return name.trim().toLowerCase();
	}
}
