/**
 * OpenRouter Models API Integration
 *
 * Fetches and caches model metadata from OpenRouter's API.
 * Used for rich model information (context window, pricing, capabilities).
 *
 * @see https://openrouter.ai/docs/api/api-reference/models/get-models
 */

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Model pricing from OpenRouter API (per token costs)
 */
export interface OpenRouterPricing {
	/** Cost per prompt/input token (string for precision) */
	prompt: string;
	/** Cost per completion/output token (string for precision) */
	completion: string;
	/** Cost per image (if applicable) */
	image?: string;
	/** Cost per request (if applicable) */
	request?: string;
}

/**
 * Model architecture info from OpenRouter API
 */
export interface OpenRouterArchitecture {
	/** Model modality (e.g., "text->text", "text+image->text") */
	modality?: string;
	/** Tokenizer used */
	tokenizer?: string;
	/** Instruction type (e.g., "chat", "completion") */
	instruct_type?: string | null;
}

/**
 * Top provider info from OpenRouter API
 */
export interface OpenRouterTopProvider {
	/** Context length for top provider */
	context_length?: number;
	/** Max completion tokens */
	max_completion_tokens?: number;
	/** Whether the provider is moderated */
	is_moderated?: boolean;
}

/**
 * Full model data from OpenRouter API
 */
export interface OpenRouterModelInfo {
	/** Model ID (e.g., "openai/gpt-4o") */
	id: string;
	/** Display name */
	name: string;
	/** Model description */
	description?: string;
	/** Context length in tokens */
	context_length: number;
	/** Pricing info */
	pricing: OpenRouterPricing;
	/** Architecture details */
	architecture?: OpenRouterArchitecture;
	/** Top provider info */
	top_provider?: OpenRouterTopProvider;
	/** When the model was created in OpenRouter */
	created?: number;

	// Capability flags
	/** Whether model supports function/tool calling */
	supports_tool_calls?: boolean;
	/** Whether model supports vision (image input) */
	supports_vision?: boolean;
	/** Whether model is a reasoning model */
	supports_reasoning?: boolean;
	/** Whether model supports structured output */
	supports_structured_output?: boolean;

	/** Per-request limits */
	per_request_limits?: {
		prompt_tokens?: string;
		completion_tokens?: string;
	};
}

/**
 * OpenRouter models API response
 */
interface OpenRouterModelsResponse {
	data: OpenRouterModelInfo[];
}

/**
 * Cached data structure
 */
interface CachedData {
	/** Map of model ID -> model info */
	models: Map<string, OpenRouterModelInfo>;
	timestamp: number;
}

// Module-level cache
let cachedResponse: CachedData | null = null;

/**
 * Populates the cache with model data from an external source.
 * Used by the OpenRouter provider to avoid duplicate API calls.
 */
export function populateOpenRouterCache(models: OpenRouterModelInfo[]): void {
	const modelMap = new Map<string, OpenRouterModelInfo>();
	for (const model of models) {
		if (model.id) {
			modelMap.set(model.id, model);
		}
	}
	cachedResponse = {
		models: modelMap,
		timestamp: Date.now(),
	};
}

/**
 * Checks if the cache is still valid.
 */
export function hasValidCache(): boolean {
	return cachedResponse !== null && Date.now() - cachedResponse.timestamp < CACHE_TTL_MS;
}

/**
 * Fetches and caches OpenRouter models data.
 * Uses the public endpoint (no auth required).
 */
export async function fetchOpenRouterModels(): Promise<Map<string, OpenRouterModelInfo> | null> {
	// Return cached data if still valid
	if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_TTL_MS) {
		return cachedResponse.models;
	}

	try {
		const response = await globalThis.fetch(OPENROUTER_MODELS_URL, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			console.warn(`Failed to fetch OpenRouter models: ${response.status}`);
			return cachedResponse?.models ?? null;
		}

		const data = (await response.json()) as OpenRouterModelsResponse;

		// Build map for fast lookups
		const models = new Map<string, OpenRouterModelInfo>();
		if (Array.isArray(data.data)) {
			for (const model of data.data) {
				if (model.id) {
					models.set(model.id, model);
				}
			}
		}

		// Cache the response
		cachedResponse = {
			models,
			timestamp: Date.now(),
		};

		return models;
	} catch (error) {
		console.warn("Error fetching OpenRouter models:", error);
		return cachedResponse?.models ?? null;
	}
}

/**
 * Synchronous lookup of model info from cached data
 */
export function lookupOpenRouterModelSync(
	data: Map<string, OpenRouterModelInfo>,
	modelId: string,
): OpenRouterModelInfo | null {
	return data.get(modelId) ?? null;
}

/**
 * Format context window for display
 */
export function formatContextWindow(contextLength?: number): string {
	if (!contextLength) return "—";
	if (contextLength >= 1_000_000) {
		return `${(contextLength / 1_000_000).toFixed(1)}M`;
	}
	if (contextLength >= 1_000) {
		return `${Math.round(contextLength / 1_000)}K`;
	}
	return contextLength.toString();
}

/**
 * Format cost for display (per million tokens)
 * OpenRouter API returns cost per token as a string
 */
export function formatCostPerMillion(costPerToken?: string): string {
	if (!costPerToken) return "—";
	const cost = Number.parseFloat(costPerToken);
	if (Number.isNaN(cost)) return "—";
	if (cost === 0) return "Free";

	// Convert from per-token to per-million tokens
	const perMillion = cost * 1_000_000;

	if (perMillion < 0.01) return `$${perMillion.toFixed(4)}`;
	if (perMillion < 1) return `$${perMillion.toFixed(2)}`;
	return `$${perMillion.toFixed(2)}`;
}

/**
 * Extract capabilities from model info
 */
export function extractCapabilities(info: OpenRouterModelInfo): {
	supportsToolCalls: boolean;
	supportsVision: boolean;
	supportsReasoning: boolean;
	supportsStructuredOutput: boolean;
} {
	return {
		supportsToolCalls: info.supports_tool_calls ?? false,
		supportsVision: info.supports_vision ?? false,
		supportsReasoning: info.supports_reasoning ?? false,
		supportsStructuredOutput: info.supports_structured_output ?? false,
	};
}

/**
 * Checks if a model is an embedding model based on its architecture/modality
 */
export function isEmbeddingModel(info: OpenRouterModelInfo): boolean {
	const id = info.id.toLowerCase();
	const modality = info.architecture?.modality?.toLowerCase() ?? "";

	return (
		modality.includes("embedding") ||
		id.includes("embed") ||
		id.includes("bge-") ||
		id.includes("voyage") ||
		id.includes("e5-") ||
		id.includes("gte-") ||
		id.includes("nomic-") ||
		id.includes("-embedding")
	);
}

/**
 * Clears the cached data (useful for testing or forcing refresh)
 */
export function clearOpenRouterCache(): void {
	cachedResponse = null;
}
