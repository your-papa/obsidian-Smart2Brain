import { createQuery } from "@tanstack/svelte-query";
import { QueryClient } from "@tanstack/svelte-query";
import type { AuthValidationResult } from "../agent/AgentManager";
import { getBuiltInProvider } from "../providers";
import type { DiscoveredModels } from "../providers/types";
import { getData } from "../stores/dataStore.svelte";
import { getPlugin } from "../stores/state.svelte";

/**
 * Query functions for provider state management.
 *
 * These functions use the new provider ID system (lowercase IDs like "openai", "anthropic").
 * Auth state is resolved using dataStore.getResolvedAuthState() which returns RuntimeAuthState.
 */

// Create a global QueryClient instance
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 1000 * 60 * 5, // 5 minutes
			gcTime: 1000 * 60 * 10, // 10 minutes
			retry: false,
			refetchOnWindowFocus: false,
		},
	},
});

export function getQueryClient() {
	return queryClient;
}

export interface ProviderState {
	auth: AuthValidationResult;
	models: DiscoveredModels;
}

/**
 * Empty models result used when discovery fails or is not available.
 */
const EMPTY_MODELS: DiscoveredModels = { chat: [], embedding: [] };

/**
 * Combined query for provider auth state and available models.
 * Both are tightly coupled - if auth fails, models are empty.
 * If auth succeeds, models are fetched via discoverModels().
 *
 * @param provider - Function returning the provider ID string
 */
export function createProviderStateQuery(provider: () => string) {
	const plugin = getPlugin();
	const data = getData();

	return createQuery<ProviderState>(() => ({
		queryKey: ["provider", provider()],
		queryFn: async () => {
			const providerId = provider();
			// Get resolved auth state (with secrets resolved)
			const resolvedAuth = data.getResolvedAuthState(providerId);

			if (!resolvedAuth) {
				return {
					auth: { success: false, message: `No auth configuration found for ${providerId}` },
					models: EMPTY_MODELS,
				};
			}

			// Validate auth using new provider system
			const auth = await plugin.agentManager.validateProviderAuth(providerId, resolvedAuth);

			// Only fetch models if auth succeeded
			if (!auth.success) {
				return { auth, models: EMPTY_MODELS };
			}

			// Get provider definition for model discovery
			// TODO: Add support for custom providers once StoredCustomProvider -> CustomProviderDefinition conversion is implemented
			const providerDef = getBuiltInProvider(providerId);
			if (!providerDef) {
				return { auth, models: EMPTY_MODELS };
			}

			// Discover models from the provider's API
			try {
				const discovered = await providerDef.discoverModels(resolvedAuth);
				return { auth, models: discovered };
			} catch (error) {
				// Model discovery failed - return error and empty models
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.warn(`Model discovery failed for ${providerId}:`, errorMessage);
				return {
					auth: { success: false, message: `Model discovery failed: ${errorMessage}` },
					models: EMPTY_MODELS,
				};
			}
		},
	}));
}

/**
 * Invalidate provider state (auth + models) for a specific provider.
 *
 * @param provider - The provider ID string
 */
export function invalidateProviderState(provider: string) {
	const plugin = getPlugin();
	plugin.queryClient.invalidateQueries({
		queryKey: ["provider", provider],
	});
}

/**
 * Invalidate all provider states.
 */
export function invalidateAllProviders() {
	const plugin = getPlugin();
	plugin.queryClient.invalidateQueries({
		queryKey: ["provider"],
	});
}

// Legacy exports for backward compatibility
/**
 * Query for provider auth state only (without models).
 *
 * @param provider - Function returning the provider ID string
 */
export function createAuthStateQuery(provider: () => string) {
	const plugin = getPlugin();
	const data = getData();

	return createQuery<AuthValidationResult>(() => ({
		queryKey: ["authState", provider()],
		queryFn: async () => {
			const providerId = provider();
			// Get resolved auth state (with secrets resolved)
			const resolvedAuth = data.getResolvedAuthState(providerId);

			if (!resolvedAuth) {
				return { success: false, message: `No auth configuration found for ${providerId}` };
			}

			// Validate auth using new provider system
			return plugin.agentManager.validateProviderAuth(providerId, resolvedAuth);
		},
	}));
}

/**
 * Invalidate auth state for a specific provider.
 *
 * @param provider - The provider ID string
 */
export function invalidateAuthState(provider: string) {
	const plugin = getPlugin();
	plugin.queryClient.invalidateQueries({
		queryKey: ["authState", provider],
	});
	// Also invalidate the combined provider state
	plugin.queryClient.invalidateQueries({
		queryKey: ["provider", provider],
	});
}

/**
 * Query for model discovery - returns all available models (chat and embedding).
 *
 * @param provider - Function returning the provider ID (e.g., "openai", "anthropic")
 */
export function createModelDiscoveryQuery(provider: () => string) {
	const data = getData();

	return createQuery<DiscoveredModels>(() => ({
		queryKey: ["models", provider()],
		queryFn: async () => {
			const providerId = provider();

			// Get resolved auth state (with secrets resolved)
			const resolvedAuth = data.getResolvedAuthState(providerId);
			if (!resolvedAuth) {
				return EMPTY_MODELS;
			}

			// Get provider definition for model discovery
			const providerDef = getBuiltInProvider(providerId);
			if (!providerDef) {
				return EMPTY_MODELS;
			}

			// Discover models from the provider's API
			try {
				return await providerDef.discoverModels(resolvedAuth);
			} catch (error) {
				console.warn(`Model discovery failed for ${providerId}:`, error);
				return EMPTY_MODELS;
			}
		},
	}));
}
