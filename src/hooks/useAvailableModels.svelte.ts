import { Notice } from "obsidian";
import { createProviderStateQuery, invalidateAllProviders } from "../lib/query";
import { hydrateChatModel, hydrateEmbeddingModel } from "../lib/modelMetadataNormalizer";
import { fetchModelsDevData, type ModelsDevApiResponse } from "../providers/modelsDevApi";
import { getOllamaModelsCache, type OllamaModelInfo } from "../providers/ollamaModels";
import { fetchOpenRouterModels, type OpenRouterModelInfo } from "../providers/openrouterModels";
import { getProviderDefinition, isEmbeddingProvider } from "../providers/index";
import type { EmbedModelConfig } from "../providers/index";
import type { ChatModel } from "../stores/chatStore.svelte";
import { getData } from "../stores/dataStore.svelte";
import { getPlugin, requestSettingsTab } from "../stores/state.svelte";
import type { HydratedChatModelMetadata, HydratedEmbeddingModelMetadata } from "../types/modelMetadata";

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
	#modelsDevData = $state<ModelsDevApiResponse | null>(null);
	#openRouterData = $state<Map<string, OpenRouterModelInfo> | null>(null);
	#metadataLoadStarted = false;

	constructor() {
		void this.#loadMetadataSources();
	}

	async #loadMetadataSources(): Promise<void> {
		if (this.#metadataLoadStarted) {
			return;
		}
		this.#metadataLoadStarted = true;
		const [modelsDevData, openRouterData] = await Promise.all([fetchModelsDevData(), fetchOpenRouterModels()]);
		this.#modelsDevData = modelsDevData;
		this.#openRouterData = openRouterData;
	}

	#getOllamaData(): Map<string, OllamaModelInfo> | null {
		const auth = this.#data.getResolvedProviderAuth("ollama");
		if (!auth?.baseUrl) {
			return null;
		}
		return getOllamaModelsCache(auth.baseUrl);
	}

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

			const ollamaData = provider === "ollama" ? this.#getOllamaData() : null;
			for (const modelName of discoveredModels) {
				// Skip embedding models - they shouldn't appear in chat model selection
				const ollamaInfo = ollamaData?.get(modelName);
				const hasEmbeddingCapability = ollamaInfo?.capabilities?.includes("embedding");
				if (hasEmbeddingCapability || isLikelyEmbeddingModel(modelName)) {
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
			const providerDef = getProviderDefinition(provider, this.#data.getAllProviderMeta());
			if (!providerDef || !isEmbeddingProvider(providerDef)) {
				return; // Skip non-embedding providers
			}

			if (!this.#data.isProviderEmbeddingAvailable(provider)) {
				return;
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
				// Fall back to heuristic filtering, augmented by Ollama capabilities metadata
				const ollamaData = provider === "ollama" ? this.#getOllamaData() : null;
				const discoveredModels = state?.models ?? [];
				for (const modelName of discoveredModels) {
					const ollamaInfo = ollamaData?.get(modelName);
					const hasEmbeddingCapability = ollamaInfo?.capabilities?.includes("embedding");
					if (hasEmbeddingCapability || isLikelyEmbeddingModel(modelName)) {
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

	#hydratedChatModels = $derived.by(() => {
		const ollamaData = this.#getOllamaData();
		return this.#availableModels.map((model) =>
			hydrateChatModel(model.provider, model.model, {
				modelsDevData: this.#modelsDevData,
				openRouterData: this.#openRouterData,
				ollamaData,
				temperature: model.modelConfig.temperature,
			}),
		);
	});

	#hydratedChatModelsByKey = $derived.by(() => {
		const out = new Map<string, HydratedChatModelMetadata>();
		for (const model of this.#hydratedChatModels) {
			out.set(`${model.provider}:${model.variantKey}`, model);
		}
		return out;
	});

	#hydratedEmbeddingModels = $derived.by(() => {
		const ollamaData = this.#getOllamaData();
		return this.#availableEmbedModels.map((model) =>
			hydrateEmbeddingModel(model.provider, model.model, {
				modelsDevData: this.#modelsDevData,
				openRouterData: this.#openRouterData,
				ollamaData,
				similarityThresholdDefault: model.modelConfig.similarityThreshold,
			}),
		);
	});

	#hydratedEmbeddingModelsByKey = $derived.by(() => {
		const out = new Map<string, HydratedEmbeddingModelMetadata>();
		for (const model of this.#hydratedEmbeddingModels) {
			out.set(`${model.provider}:${model.variantKey}`, model);
		}
		return out;
	});

	// Model options formatted for dropdowns/selects
	#modelOptions = $derived.by(() =>
		this.#availableModels.map((m) => ({
			value: `${m.provider}:${m.model}`,
			label: this.#hydratedChatModelsByKey.get(`${m.provider}:${m.model}`)?.displayName ?? m.model,
			chatModel: m,
		})),
	);

	// Embed model options formatted for dropdowns/selects
	#embedModelOptions = $derived.by(() =>
		this.#availableEmbedModels.map((m) => ({
			value: `${m.provider}::${m.model}`,
			label: this.#hydratedEmbeddingModelsByKey.get(`${m.provider}:${m.model}`)?.displayName ?? m.model,
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

	get isLoadingModels(): boolean {
		return this.#providerQueries.some((q) => q.isPending);
	}

	get modelOptions(): ModelOption[] {
		return this.#modelOptions;
	}

	get hydratedChatModels(): HydratedChatModelMetadata[] {
		return this.#hydratedChatModels;
	}

	get hydratedChatModelsByKey(): Map<string, HydratedChatModelMetadata> {
		return this.#hydratedChatModelsByKey;
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

	get hydratedEmbeddingModels(): HydratedEmbeddingModelMetadata[] {
		return this.#hydratedEmbeddingModels;
	}

	get hydratedEmbeddingModelsByKey(): Map<string, HydratedEmbeddingModelMetadata> {
		return this.#hydratedEmbeddingModelsByKey;
	}

	get openRouterModels(): Map<string, OpenRouterModelInfo> | null {
		return this.#openRouterData;
	}

	getOllamaModelInfo(modelId: string): OllamaModelInfo | undefined {
		const ollamaData = this.#getOllamaData();
		return ollamaData?.get(modelId);
	}

	getOllamaModelFamilies(modelId: string): string[] {
		const info = this.getOllamaModelInfo(modelId);
		const families = new Set<string>();
		if (info?.family) {
			families.add(info.family);
		}
		for (const family of info?.families ?? []) {
			if (family) {
				families.add(family);
			}
		}
		// Fallback to the variant base when Ollama details are missing.
		// This still relies on OpenRouter data for lab inference.
		const variantBase = modelId.split(":")[0]?.trim();
		if (variantBase) {
			families.add(variantBase);
			const withoutNumericSuffix = variantBase.replace(/-\d+[a-z]*$/i, "");
			if (withoutNumericSuffix && withoutNumericSuffix !== variantBase) {
				families.add(withoutNumericSuffix);
			}
			const [firstSegment] = variantBase.split("-", 1);
			if (firstSegment && firstSegment !== variantBase) {
				families.add(firstSegment);
			}
		}
		return Array.from(families);
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
		const app = this.#plugin.app as unknown as {
			setting?: { open: () => void; openTabById: (id: string) => void };
		};

		if (!this.hasProviders) {
			new Notice("Add an AI provider first to use model features.");
		} else if (!this.hasModels) {
			new Notice("No models found. Check that your provider is running and reachable.");
		}

		requestSettingsTab("general");
		app.setting?.open();
		app.setting?.openTabById("smart-second-brain");
	};
}

// Module-level singleton instance (lazy initialized)
let instance: AvailableModels | null = null;

/**
 * Returns the singleton AvailableModels instance.
 * All components share the same reactive state.
 *
 * The instance is created inside an `$effect.root` so the TanStack queries it
 * spins up (each `createQuery` registers an internal `$effect`) always have a
 * stable, app-lifetime owner. Without this, the first `useAvailableModels()`
 * call from inside a consumer's `$derived` (e.g. the model-selection modal
 * reading `hydratedChatModels` during onboarding) constructs the singleton in
 * an unowned reactive context and Svelte throws `effect_in_unowned_derived`.
 * The root is never disposed — the singleton lives for the whole session.
 */
export function useAvailableModels(): AvailableModels {
	if (!instance) {
		$effect.root(() => {
			instance = new AvailableModels();
		});
	}
	// biome-ignore lint/style/noNonNullAssertion: the $effect.root callback runs synchronously, so `instance` is set here.
	return instance!;
}
