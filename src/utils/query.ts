import { createQuery } from "@tanstack/svelte-query";
import { QueryClient } from "@tanstack/svelte-query";
import type { RegisteredProvider } from "../types/providers";
import { getPlugin } from "../stores/state.svelte";
import { getData } from "../stores/dataStore.svelte";
import type { ValidationResult } from "../agent/AgentManager";

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

export function createAuthStateQuery(provider: () => RegisteredProvider) {
	const plugin = getPlugin();
	const data = getData();

	return createQuery<ValidationResult>(() => ({
		queryKey: ["authState", provider()],
		queryFn: async () => {
			const res = await plugin.agentManager.testProviderConfig(
				provider(),
				data.getProviderAuthParams(provider()),
			);
			return res;
		},
	}));
}

export function invalidateAuthState(provider: RegisteredProvider) {
	const plugin = getPlugin();
	plugin.queryClient.invalidateQueries({
		queryKey: ["authState", provider],
	});
}

export function createModelListQuery(provider: () => RegisteredProvider) {
	const plugin = getPlugin();
	return createQuery<string[]>(() => ({
		queryKey: ["models", provider()],
		queryFn: async () => plugin.agentManager.getAvailableModels(provider()),
	}));
}
