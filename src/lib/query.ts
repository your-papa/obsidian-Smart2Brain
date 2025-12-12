import { QueryClient } from "@tanstack/svelte-query";

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
