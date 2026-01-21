import { createQuery } from "@tanstack/svelte-query";
import { QueryClient } from "@tanstack/svelte-query";
import type { ValidationResult } from "../agent/AgentManager";
import { getData } from "../stores/dataStore.svelte";
import { getPlugin } from "../stores/state.svelte";
import type { RegisteredProvider } from "../types/providers";

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
	auth: ValidationResult;
	models: string[];
}

/**
 * Combined query for provider auth state and available models.
 * Both are tightly coupled - if auth fails, models are empty.
 * If auth succeeds, models are fetched.
 */
export function createProviderStateQuery(provider: () => RegisteredProvider) {
	const plugin = getPlugin();
	const data = getData();

	return createQuery<ProviderState>(() => ({
		queryKey: ["provider", provider()],
		queryFn: async () => {
			const providerName = provider();
			// Resolve secrets from SecretStorage
			const resolvedAuth = data.getResolvedProviderAuth(providerName);
			const auth = await plugin.agentManager.testProviderConfig(providerName, resolvedAuth);

			// Only fetch models if auth succeeded
			const models = auth.success ? await plugin.agentManager.getAvailableModels(providerName) : [];

			return { auth, models };
		},
	}));
}

/**
 * Invalidate provider state (auth + models) for a specific provider.
 */
export function invalidateProviderState(provider: RegisteredProvider) {
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
export function createAuthStateQuery(provider: () => RegisteredProvider) {
	const plugin = getPlugin();
	const data = getData();

	return createQuery<ValidationResult>(() => ({
		queryKey: ["authState", provider()],
		queryFn: async () => {
			// Resolve secrets from SecretStorage
			const resolvedAuth = data.getResolvedProviderAuth(provider());
			const res = await plugin.agentManager.testProviderConfig(provider(), resolvedAuth);
			return res;
		},
	}));
}

export function invalidateAuthState(provider: RegisteredProvider) {
	const plugin = getPlugin();
	plugin.queryClient.invalidateQueries({
		queryKey: ["authState", provider],
	});
	// Also invalidate the combined provider state
	plugin.queryClient.invalidateQueries({
		queryKey: ["provider", provider],
	});
}

export function createModelListQuery(provider: () => RegisteredProvider) {
	const plugin = getPlugin();
	return createQuery<string[]>(() => ({
		queryKey: ["models", provider()],
		queryFn: async () => plugin.agentManager.getAvailableModels(provider()),
	}));
}
