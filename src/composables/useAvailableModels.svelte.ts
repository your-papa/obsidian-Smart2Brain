import type { ChatModel } from "../stores/chatStore.svelte";
import { getData } from "../stores/dataStore.svelte";
import { getPlugin } from "../stores/state.svelte";
import { createProviderStateQuery, invalidateAllProviders } from "../utils/query";
import type { RegisteredProvider } from "../types/providers";

export interface ModelOption {
	value: string;
	label: string;
	chatModel: ChatModel;
}

/**
 * Class that provides reactive access to available models across all configured providers.
 * Used by ModelPopover and Dropdown components.
 */
export class AvailableModels {
	#data = getData();
	#plugin = getPlugin();

	// Reactive providers list - reads from reactive $state in dataStore
	#providers = $derived(this.#data.getConfiguredProviders());

	// Combined query for each provider (auth + models together)
	#providerQueries = $derived(this.#providers.map((provider) => createProviderStateQuery(() => provider)));

	// Compute available models from all providers
	#availableModels = $derived.by(() => {
		const out: ChatModel[] = [];
		this.#providers.forEach((provider, idx) => {
			const state = this.#providerQueries[idx]?.data;
			const models: string[] = state?.models ?? [];
			const confModels = this.#data.getGenModels(provider);
			for (const [modelName, modelConfig] of confModels.entries()) {
				if (models.includes(modelName)) {
					out.push({ model: modelName, provider, modelConfig });
				}
			}
		});
		return out;
	});

	// Providers that are configured but not available (auth failed)
	#unavailableProviders = $derived.by(() => {
		const unavailable: RegisteredProvider[] = [];
		this.#providers.forEach((provider, idx) => {
			const state = this.#providerQueries[idx]?.data;
			if (state && !state.auth.success) {
				unavailable.push(provider);
			}
		});
		return unavailable;
	});

	// Model options formatted for dropdowns/selects
	#modelOptions = $derived.by(() =>
		this.#availableModels.map((m) => ({
			value: `${m.provider}:${m.model}`,
			label: m.model,
			chatModel: m,
		})),
	);

	get providers(): RegisteredProvider[] {
		return this.#providers;
	}

	get hasProviders(): boolean {
		return this.#providers.length > 0;
	}

	get availableModels(): ChatModel[] {
		return this.#availableModels;
	}

	get hasModels(): boolean {
		return this.#availableModels.length > 0;
	}

	get modelOptions(): ModelOption[] {
		return this.#modelOptions;
	}

	get unavailableProviders(): RegisteredProvider[] {
		return this.#unavailableProviders;
	}

	get hasUnavailableProviders(): boolean {
		return this.#unavailableProviders.length > 0;
	}

	// Use arrow functions to preserve `this` context when passed as callbacks
	refetchModels = () => {
		invalidateAllProviders();
	};

	refetchProviders = () => {
		invalidateAllProviders();
	};

	openSettings = () => {
		const app = this.#plugin.app;
		(app as any).setting.open();
		(app as any).setting.openTabById("smart-second-brain");
	};
}

// Module-level singleton instance (lazy initialized)
let instance: AvailableModels | null = null;

/**
 * Returns the singleton AvailableModels instance.
 * All components share the same reactive state.
 */
export function useAvailableModels(): AvailableModels {
	if (!instance) {
		instance = new AvailableModels();
	}
	return instance;
}
