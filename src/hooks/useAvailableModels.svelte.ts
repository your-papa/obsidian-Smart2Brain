import { createProviderStateQuery, invalidateAllProviders } from "../lib/query";
import { getProviderDefinition, isEmbeddingProvider } from "../providers/index";
import type { EmbedModelConfig } from "../providers/index";
import type { ChatModel } from "../stores/chatStore.svelte";
import { getData } from "../stores/dataStore.svelte";
import { getPlugin } from "../stores/state.svelte";

export interface ModelOption {
	value: string;
	label: string;
	chatModel: ChatModel;
}

export interface EmbedModelOption {
	value: string;
	label: string;
	embedModel: EmbedModel;
}

export interface EmbedModel {
	model: string;
	provider: string;
	modelConfig: EmbedModelConfig;
}

/** Default context window when models.dev lookup fails */
const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Heuristic to detect embedding models by name.
 * Embedding models typically have "embed" in their name or follow known patterns.
 */
function isLikelyEmbeddingModel(modelName: string): boolean {
	const lower = modelName.toLowerCase();
	return (
		lower.includes("embed") ||
		lower.includes("bge-") ||
		lower.includes("bge/") ||
		lower.includes("/bge") ||
		lower.includes("voyage") ||
		lower.includes("e5-") ||
		lower.includes("/e5-") ||
		lower.includes("gte-") ||
		lower.includes("/gte-") ||
		lower.includes("nomic-") ||
		lower.includes("titan-text-") || // AWS Titan text embedding
		lower.includes("-embedding")
	);
}

/**
 * Class that provides reactive access to available models across all configured providers.
 * Models are auto-discovered from providers - no manual configuration needed.
 * Used by ModelPopover and Dropdown components.
 */
export class AvailableModels {
	#data = getData();
	#plugin = getPlugin();

	// Reactive providers list - reads from reactive $state in dataStore
	#providers = $derived(this.#data.getConfiguredProviders());

	// Combined query for each provider (auth + models together)
	#providerQueries = $derived(this.#providers.map((provider) => createProviderStateQuery(() => provider)));

	// Compute available models from all providers - excludes embedding models
	#availableModels = $derived.by(() => {
		const out: ChatModel[] = [];
		this.#providers.forEach((provider, idx) => {
			const state = this.#providerQueries[idx]?.data;
			// Get all discovered models from the provider
			const discoveredModels = state?.models ?? [];

			for (const modelName of discoveredModels) {
				// Skip embedding models - they shouldn't appear in chat model selection
				if (isLikelyEmbeddingModel(modelName)) {
					continue;
				}

				// Use default config - will be enriched from models.dev at runtime
				out.push({
					model: modelName,
					provider,
					modelConfig: { contextWindow: DEFAULT_CONTEXT_WINDOW },
				});
			}
		});
		return out;
	});

	// Compute available embedding models from embedding-capable providers only
	#availableEmbedModels = $derived.by(() => {
		const out: EmbedModel[] = [];
		this.#providers.forEach((provider, idx) => {
			// Check if this provider supports embeddings
			const providerDef = getProviderDefinition(provider, this.#data.getAllCustomProviderMeta());
			if (!providerDef || !isEmbeddingProvider(providerDef)) {
				return; // Skip non-embedding providers
			}

			const state = this.#providerQueries[idx]?.data;

			// Use dedicated embedding models if provider supports discoverEmbeddingModels
			// Otherwise, fall back to heuristic filtering on all models
			const embeddingModelNames = state?.embeddingModels;
			if (embeddingModelNames && embeddingModelNames.length > 0) {
				// Provider has dedicated embedding model discovery
				for (const modelName of embeddingModelNames) {
					out.push({
						model: modelName,
						provider,
						modelConfig: { similarityThreshold: 0.7 },
					});
				}
			} else {
				// Fall back to heuristic filtering
				const discoveredModels = state?.models ?? [];
				for (const modelName of discoveredModels) {
					if (isLikelyEmbeddingModel(modelName)) {
						out.push({
							model: modelName,
							provider,
							modelConfig: { similarityThreshold: 0.7 },
						});
					}
				}
			}
		});
		return out;
	});

	// Providers that are configured but not available (auth failed)
	#unavailableProviders = $derived.by(() => {
		const unavailable: string[] = [];
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

	// Embed model options formatted for dropdowns/selects
	#embedModelOptions = $derived.by(() =>
		this.#availableEmbedModels.map((m) => ({
			value: `${m.provider}::${m.model}`,
			label: m.model,
			embedModel: m,
		})),
	);

	get providers(): string[] {
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

	get availableEmbedModels(): EmbedModel[] {
		return this.#availableEmbedModels;
	}

	get hasEmbedModels(): boolean {
		return this.#availableEmbedModels.length > 0;
	}

	get embedModelOptions(): EmbedModelOption[] {
		return this.#embedModelOptions;
	}

	get unavailableProviders(): string[] {
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
		// Internal Obsidian API for opening settings
		const app = this.#plugin.app as unknown as {
			setting?: { open: () => void; openTabById: (id: string) => void };
		};
		app.setting?.open();
		app.setting?.openTabById("smart-second-brain");
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
