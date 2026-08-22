/**
 * OrcaRouter Models API Integration
 *
 * Fetches and caches model metadata from OrcaRouter's API.
 * Used for rich model information (context window, capabilities, endpoint types).
 *
 * @see https://api.orcarouter.ai/v1/models
 */

const ORCAROUTER_MODELS_URL = "https://api.orcarouter.ai/v1/models";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Model info from the OrcaRouter models API.
 */
export interface OrcaRouterModelInfo {
	/** Model ID (e.g., "orcarouter/auto", "anthropic/claude-opus-4-8") */
	id: string;
	/** Display name */
	name?: string;
	/** Model description */
	description?: string;
	/** Context length in tokens */
	context_length?: number;
	/** Max completion tokens */
	max_completion_tokens?: number;
	/** Architecture details */
	architecture?: {
		input_modalities?: string[];
		output_modalities?: string[] | null;
	};
	/** Endpoint types the model supports (e.g. "openai", "openai-response", "anthropic", "gemini", "embeddings") */
	supported_endpoint_types?: string[];
	/** Pricing per token (string for precision) */
	pricing?: {
		prompt?: string;
		completion?: string;
	};
}

/**
 * OrcaRouter models API response
 */
interface OrcaRouterModelsResponse {
	data: OrcaRouterModelInfo[];
}

/**
 * Cached data structure
 */
interface CachedData {
	models: Map<string, OrcaRouterModelInfo>;
	timestamp: number;
}

// Module-level cache
let cachedResponse: CachedData | null = null;

/**
 * Populates the cache with model data from an external source.
 * Used by the OrcaRouter provider to avoid duplicate API calls.
 */
export function populateOrcaRouterCache(models: OrcaRouterModelInfo[]): void {
	const modelMap = new Map<string, OrcaRouterModelInfo>();
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
export function hasValidOrcaRouterCache(): boolean {
	return cachedResponse !== null && Date.now() - cachedResponse.timestamp < CACHE_TTL_MS;
}

/**
 * Fetches and caches OrcaRouter models data.
 * Uses the public endpoint (no auth required).
 */
export async function fetchOrcaRouterModels(): Promise<Map<string, OrcaRouterModelInfo> | null> {
	// Return cached data if still valid
	if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_TTL_MS) {
		return cachedResponse.models;
	}

	try {
		const response = await globalThis.fetch(ORCAROUTER_MODELS_URL, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			console.warn(`Failed to fetch OrcaRouter models: ${response.status}`);
			return cachedResponse?.models ?? null;
		}

		const data = (await response.json()) as OrcaRouterModelsResponse;

		// Build map for fast lookups
		const models = new Map<string, OrcaRouterModelInfo>();
		if (Array.isArray(data.data)) {
			for (const model of data.data) {
				if (model.id) {
					models.set(model.id, model);
				}
			}
		}

		cachedResponse = {
			models,
			timestamp: Date.now(),
		};

		return models;
	} catch (error) {
		console.warn("Failed to fetch OrcaRouter models:", error);
		return cachedResponse?.models ?? null;
	}
}

/**
 * Extracts capabilities from OrcaRouter model info.
 */
export function extractOrcaRouterCapabilities(info: OrcaRouterModelInfo): {
	supportsToolCalls: boolean;
	supportsVision: boolean;
	supportsStructuredOutput: boolean;
	supportsEmbedding: boolean;
} {
	const endpoints = info.supported_endpoint_types ?? [];
	const inputModalities = info.architecture?.input_modalities ?? [];

	return {
		supportsToolCalls: endpoints.includes("openai") || endpoints.includes("openai-response"),
		supportsVision: inputModalities.includes("image"),
		supportsStructuredOutput: endpoints.includes("openai") || endpoints.includes("openai-response"),
		supportsEmbedding: endpoints.includes("embeddings"),
	};
}

/**
 * Clears the cached data (useful for testing or forcing refresh)
 */
export function clearOrcaRouterCache(): void {
	cachedResponse = null;
}
