/**
 * Models.dev API Integration
 *
 * Fetches model metadata from the open-source models.dev database.
 * Used to automatically populate model configuration (context window, costs, capabilities).
 *
 * @see https://models.dev
 */

import { createObsidianFetch } from "../lib/obsidianFetch";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/** Model metadata from models.dev */
export interface ModelsDevModelInfo {
	id: string;
	name: string;
	family?: string;
	attachment?: boolean;
	reasoning?: boolean;
	tool_call?: boolean;
	structured_output?: boolean;
	temperature?: boolean;
	knowledge?: string;
	release_date?: string;
	last_updated?: string;
	modalities?: {
		input?: string[];
		output?: string[];
	};
	open_weights?: boolean;
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	limit?: {
		context?: number;
		input?: number;
		output?: number;
	};
}

/** Provider entry from models.dev */
export interface ModelsDevProvider {
	id: string;
	env?: string[];
	npm?: string;
	api?: string;
	name: string;
	doc?: string;
	models: Record<string, ModelsDevModelInfo>;
}

/** Full API response structure */
export type ModelsDevApiResponse = Record<string, ModelsDevProvider>;

/** Cached data structure */
interface CachedData {
	data: ModelsDevApiResponse;
	timestamp: number;
}

// Module-level cache
let cachedResponse: CachedData | null = null;

/**
 * Fetches and caches the models.dev API response
 */
export async function fetchModelsDevData(): Promise<ModelsDevApiResponse | null> {
	// Return cached data if still valid
	if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_TTL_MS) {
		return cachedResponse.data;
	}

	try {
		const obsidianFetch = createObsidianFetch();

		const response = await obsidianFetch(MODELS_DEV_API_URL, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			console.warn(`Failed to fetch models.dev data: ${response.status}`);
			return cachedResponse?.data ?? null;
		}

		const data = (await response.json()) as ModelsDevApiResponse;

		// Cache the response
		cachedResponse = {
			data,
			timestamp: Date.now(),
		};

		return data;
	} catch (error) {
		console.warn("Error fetching models.dev data:", error);
		return cachedResponse?.data ?? null;
	}
}

/**
 * Maps our provider IDs to models.dev provider IDs
 */
const PROVIDER_ID_MAP: Record<string, string[]> = {
	openai: ["openai"],
	anthropic: ["anthropic"],
	ollama: [], // Ollama models are local, not in models.dev
	openrouter: ["openrouter"],
	// Custom providers may match various providers in models.dev
};

function normalizeModelToken(value: string): string {
	let token = value.toLowerCase().trim();
	if (token.includes("/")) {
		token = token.split("/").pop() ?? token;
	}

	token = token
		.replace(/:latest$/i, "")
		.replace(/:free$/i, "")
		.replace(/:([0-9.]+[a-z]+)$/i, "-$1")
		.replace(/[^a-z0-9]/g, "");

	return token;
}

function digitSequence(token: string): string {
	return token.replace(/[^0-9]/g, "");
}

function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	const prev = new Array<number>(b.length + 1);
	const curr = new Array<number>(b.length + 1);

	for (let j = 0; j <= b.length; j++) {
		prev[j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}

		for (let j = 0; j <= b.length; j++) {
			prev[j] = curr[j];
		}
	}

	return prev[b.length];
}

function findNormalizedOrFuzzyModelMatch(
	models: Record<string, ModelsDevModelInfo>,
	modelId: string,
): ModelsDevModelInfo | null {
	const target = normalizeModelToken(modelId);
	if (!target) return null;

	let bestMatch: { value: ModelsDevModelInfo; distance: number; score: number } | null = null;

	for (const [key, value] of Object.entries(models)) {
		const candidates = [key, value.id, value.name];
		for (const candidate of candidates) {
			if (!candidate) continue;
			const normalized = normalizeModelToken(candidate);
			if (!normalized) continue;

			if (normalized === target) {
				return value;
			}

			// A version digit is a one-character edit, so without this guard the
			// fuzzy tier reads "claude-sonnet-4" as a typo of "claude-sonnet-4.5".
			if (digitSequence(normalized) !== digitSequence(target)) {
				continue;
			}

			if (Math.abs(normalized.length - target.length) > 2) {
				continue;
			}

			const prefixLen = Math.min(3, normalized.length, target.length);
			if (prefixLen > 0 && normalized.slice(0, prefixLen) !== target.slice(0, prefixLen)) {
				continue;
			}

			const distance = levenshteinDistance(target, normalized);
			const maxLen = Math.max(target.length, normalized.length);
			const score = distance / maxLen;
			if (distance <= 2 && score <= 0.2) {
				if (!bestMatch || distance < bestMatch.distance || score < bestMatch.score) {
					bestMatch = { value, distance, score };
				}
			}
		}
	}

	return bestMatch?.value ?? null;
}

/**
 * Synchronous lookup of model metadata from cached models.dev data
 *
 * @param data Cached models.dev API response
 * @param providerId Our internal provider ID
 * @param modelId The model identifier (e.g., "gpt-4o", "claude-3-5-sonnet")
 * @returns Model info if found, null otherwise
 */
export function lookupModelInfoSync(
	data: ModelsDevApiResponse,
	providerId: string,
	modelId: string,
): ModelsDevModelInfo | null {
	// Get potential provider IDs to search
	const providerIds = PROVIDER_ID_MAP[providerId] ?? [providerId];

	// Search in mapped providers
	for (const pid of providerIds) {
		const provider = data[pid];
		if (provider?.models) {
			// Direct match
			if (provider.models[modelId]) {
				return provider.models[modelId];
			}

			// Try with provider prefix (e.g., "openai/gpt-4o")
			const prefixedId = `${pid}/${modelId}`;
			if (provider.models[prefixedId]) {
				return provider.models[prefixedId];
			}

			// Try partial match (model ID might be a substring)
			for (const [key, value] of Object.entries(provider.models)) {
				if (key.endsWith(`/${modelId}`) || key === modelId) {
					return value;
				}
			}

			const normalizedMatch = findNormalizedOrFuzzyModelMatch(provider.models, modelId);
			if (normalizedMatch) {
				return normalizedMatch;
			}
		}
	}

	// Search across all providers for the model ID
	for (const provider of Object.values(data)) {
		if (provider.models) {
			if (provider.models[modelId]) {
				return provider.models[modelId];
			}

			// Check for prefixed variants
			for (const [key, value] of Object.entries(provider.models)) {
				if (key.endsWith(`/${modelId}`) || key.split("/").pop() === modelId) {
					return value;
				}
			}

			const normalizedMatch = findNormalizedOrFuzzyModelMatch(provider.models, modelId);
			if (normalizedMatch) {
				return normalizedMatch;
			}
		}
	}

	return null;
}

/**
 * Looks up model metadata from models.dev (async - fetches data if needed)
 *
 * @param providerId Our internal provider ID
 * @param modelId The model identifier (e.g., "gpt-4o", "claude-3-5-sonnet")
 * @returns Model info if found, null otherwise
 */
export async function lookupModelInfo(providerId: string, modelId: string): Promise<ModelsDevModelInfo | null> {
	const data = await fetchModelsDevData();
	if (!data) return null;

	return lookupModelInfoSync(data, providerId, modelId);
}

/**
 * Extracts chat model configuration from models.dev info
 */
export function extractChatModelConfig(info: ModelsDevModelInfo): {
	contextWindow: number;
	supportsToolCalls: boolean;
	supportsReasoning: boolean;
	supportsStructuredOutput: boolean;
	supportsVision: boolean;
} {
	return {
		contextWindow: info.limit?.context ?? 128000,
		supportsToolCalls: info.tool_call ?? false,
		supportsReasoning: info.reasoning ?? false,
		supportsStructuredOutput: info.structured_output ?? false,
		supportsVision: info.attachment ?? false,
	};
}

/**
 * Extracts embedding model configuration from models.dev info
 */
export function extractEmbedModelConfig(info: ModelsDevModelInfo): {
	contextWindow: number;
	dimensions: number;
} {
	return {
		contextWindow: info.limit?.context ?? 8192,
		// models.dev doesn't typically include dimensions, use sensible default
		dimensions: 1536,
	};
}

/**
 * Checks if a model is likely an embedding model based on its info
 */
export function isEmbeddingModel(info: ModelsDevModelInfo): boolean {
	const name = info.name?.toLowerCase() ?? "";
	const id = info.id?.toLowerCase() ?? "";
	const family = info.family?.toLowerCase() ?? "";

	return name.includes("embed") || id.includes("embed") || family.includes("embed") || family === "text-embedding";
}

/**
 * Clears the cached data (useful for testing or forcing refresh)
 */
export function clearModelsDevCache(): void {
	cachedResponse = null;
}
