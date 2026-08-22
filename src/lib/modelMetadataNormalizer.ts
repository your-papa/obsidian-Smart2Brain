import { lookupModelInfoSync, type ModelsDevApiResponse } from "../providers/modelsDevApi";
import { formatParameterSize, type OllamaModelInfo } from "../providers/ollamaModels";
import {
	extractCapabilities as extractOpenRouterCapabilities,
	type OpenRouterModelInfo,
} from "../providers/openrouterModels";
import { extractOrcaRouterCapabilities, type OrcaRouterModelInfo } from "../providers/orcarouterModels";
import type { HydratedChatModelMetadata, HydratedEmbeddingModelMetadata } from "../types/modelMetadata";

const DEFAULT_CHAT_CONTEXT_WINDOW = 128000;
const DEFAULT_EMBEDDING_MAX_INPUT_TOKENS = 8191;
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
const DEFAULT_EMBED_MAX_INPUT_TOKENS_BY_PROVIDER: Record<string, number> = {
	openai: 8191,
	openrouter: 8191,
	orcarouter: 8191,
	ollama: 8191,
	anthropic: 8191,
};

export interface ModelHydrationSourceData {
	modelsDevData?: ModelsDevApiResponse | null;
	openRouterData?: Map<string, OpenRouterModelInfo> | null;
	orcaRouterData?: Map<string, OrcaRouterModelInfo> | null;
	ollamaData?: Map<string, OllamaModelInfo> | null;
	temperature?: number;
	similarityThresholdDefault?: number;
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function toUsdPer1MFromPerToken(perToken?: string): number | undefined {
	const perTokenNumber = toNumber(perToken);
	if (perTokenNumber === undefined) {
		return undefined;
	}
	return perTokenNumber * 1_000_000;
}

function normalizeParamSize(size?: string): string | undefined {
	if (!size) {
		return undefined;
	}
	return formatParameterSize(size);
}

/**
 * Drop the "Lab: " prefix catalogues put on display names (OpenRouter ships
 * names like "Qwen: Qwen3.8 Max"), for surfaces that already convey the vendor
 * some other way — a logo, or simply not having room for it. Only strips a
 * short leading segment so a colon inside the name itself (e.g. a version
 * string) is left alone.
 */
export function stripVendorPrefix(displayName: string): string {
	const match = displayName.match(/^([^:]{1,24}):\s+(.*)$/);
	return match ? match[2] : displayName;
}

function buildDisplayName(
	provider: string,
	variantKey: string,
	nameFromMetadata: string | undefined,
	_paramSize: string | undefined,
): string {
	const baseName = nameFromMetadata || variantKey;
	if (provider === "ollama") {
		return baseName.replace(/:latest$/i, "");
	}
	return baseName;
}

function lookupMetadata(
	provider: string,
	variantKey: string,
	sourceData: ModelHydrationSourceData,
): {
	openRouter?: OpenRouterModelInfo;
	orcaRouter?: OrcaRouterModelInfo;
	ollama?: OllamaModelInfo;
	modelsDev?: ReturnType<typeof lookupModelInfoSync>;
} {
	const openRouter =
		provider === "openrouter" && sourceData.openRouterData ? sourceData.openRouterData.get(variantKey) : undefined;

	const orcaRouter =
		provider === "orcarouter" && sourceData.orcaRouterData ? sourceData.orcaRouterData.get(variantKey) : undefined;

	const ollama = provider === "ollama" && sourceData.ollamaData ? sourceData.ollamaData.get(variantKey) : undefined;

	const modelsDev = sourceData.modelsDevData
		? lookupModelInfoSync(sourceData.modelsDevData, provider, variantKey)
		: null;

	return { openRouter, orcaRouter, ollama, modelsDev };
}

export function hydrateChatModel(
	provider: string,
	variantKey: string,
	sourceData: ModelHydrationSourceData = {},
): HydratedChatModelMetadata {
	const { openRouter, orcaRouter, ollama, modelsDev } = lookupMetadata(provider, variantKey, sourceData);
	const paramSize = normalizeParamSize(ollama?.parameterSize);
	const quantization = ollama?.quantization;

	const displayName = buildDisplayName(
		provider,
		variantKey,
		openRouter?.name || orcaRouter?.name || ollama?.name || modelsDev?.name,
		paramSize,
	);

	const contextWindow =
		openRouter?.context_length ||
		orcaRouter?.context_length ||
		ollama?.contextLength ||
		modelsDev?.limit?.context ||
		DEFAULT_CHAT_CONTEXT_WINDOW;

	const inputUsdPer1M =
		toUsdPer1MFromPerToken(openRouter?.pricing?.prompt) ?? toUsdPer1MFromPerToken(orcaRouter?.pricing?.prompt);
	const outputUsdPer1M =
		toUsdPer1MFromPerToken(openRouter?.pricing?.completion) ??
		toUsdPer1MFromPerToken(orcaRouter?.pricing?.completion);
	const hasPricing = inputUsdPer1M !== undefined || outputUsdPer1M !== undefined;
	const openRouterCapabilities = openRouter ? extractOpenRouterCapabilities(openRouter) : undefined;
	const orcaRouterCapabilities = orcaRouter ? extractOrcaRouterCapabilities(orcaRouter) : undefined;

	return {
		kind: "chat",
		provider,
		variantKey,
		displayName,
		paramSize,
		quantization,
		contextWindow,
		temperature: sourceData.temperature,
		capabilities: {
			toolCalls:
				openRouterCapabilities?.supportsToolCalls ??
				orcaRouterCapabilities?.supportsToolCalls ??
				ollama?.supportsTools ??
				modelsDev?.tool_call ??
				undefined,
			vision:
				openRouterCapabilities?.supportsVision ??
				orcaRouterCapabilities?.supportsVision ??
				ollama?.supportsVision ??
				modelsDev?.attachment ??
				undefined,
			reasoning: openRouterCapabilities?.supportsReasoning ?? modelsDev?.reasoning ?? undefined,
			structuredOutput:
				openRouterCapabilities?.supportsStructuredOutput ??
				orcaRouterCapabilities?.supportsStructuredOutput ??
				modelsDev?.structured_output ??
				undefined,
		},
		pricing: hasPricing ? { inputUsdPer1M, outputUsdPer1M } : undefined,
	};
}

export function hydrateEmbeddingModel(
	provider: string,
	variantKey: string,
	sourceData: ModelHydrationSourceData = {},
): HydratedEmbeddingModelMetadata {
	const { openRouter, orcaRouter, ollama, modelsDev } = lookupMetadata(provider, variantKey, sourceData);
	const paramSize = normalizeParamSize(ollama?.parameterSize);
	const quantization = ollama?.quantization;

	const displayName = buildDisplayName(
		provider,
		variantKey,
		openRouter?.name || orcaRouter?.name || ollama?.name || modelsDev?.name,
		paramSize,
	);

	const maxInputFromOpenRouter =
		toNumber(openRouter?.per_request_limits?.prompt_tokens) || openRouter?.context_length;

	const providerDefaultMaxInputTokens = DEFAULT_EMBED_MAX_INPUT_TOKENS_BY_PROVIDER[provider];

	const maxInputTokens =
		maxInputFromOpenRouter ||
		orcaRouter?.context_length ||
		ollama?.contextLength ||
		modelsDev?.limit?.input ||
		modelsDev?.limit?.context ||
		providerDefaultMaxInputTokens ||
		DEFAULT_EMBEDDING_MAX_INPUT_TOKENS;

	const inputUsdPer1M =
		toUsdPer1MFromPerToken(openRouter?.pricing?.prompt) ?? toUsdPer1MFromPerToken(orcaRouter?.pricing?.prompt);

	return {
		kind: "embedding",
		provider,
		variantKey,
		displayName,
		paramSize,
		quantization,
		maxInputTokens,
		dimensions: ollama?.embeddingLength,
		similarityThresholdDefault: sourceData.similarityThresholdDefault ?? DEFAULT_SIMILARITY_THRESHOLD,
		pricing: inputUsdPer1M !== undefined ? { inputUsdPer1M } : undefined,
	};
}
