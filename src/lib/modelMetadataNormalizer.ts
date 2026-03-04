import { lookupModelInfoSync, type ModelsDevApiResponse } from "../providers/modelsDevApi";
import {
	formatParameterSize,
	type OllamaModelInfo,
} from "../providers/ollamaModels";
import type { OpenRouterModelInfo } from "../providers/openrouterModels";
import type {
	HydratedChatModelMetadata,
	HydratedEmbeddingModelMetadata,
} from "../types/modelMetadata";

const DEFAULT_CHAT_CONTEXT_WINDOW = 128000;
const DEFAULT_EMBEDDING_MAX_INPUT_TOKENS = 8191;
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
const DEFAULT_EMBED_MAX_INPUT_TOKENS_BY_PROVIDER: Record<string, number> = {
	openai: 8191,
	openrouter: 8191,
	ollama: 8191,
	anthropic: 8191,
};

export interface ModelHydrationSourceData {
	modelsDevData?: ModelsDevApiResponse | null;
	openRouterData?: Map<string, OpenRouterModelInfo> | null;
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

function buildDisplayName(
	provider: string,
	variantKey: string,
	nameFromMetadata: string | undefined,
	paramSize: string | undefined,
): string {
	const baseName = nameFromMetadata || variantKey;
	if (provider === "ollama" && variantKey.endsWith(":latest") && paramSize) {
		const sizeToken = paramSize.toLowerCase();
		return variantKey.replace(/:latest$/i, `-${sizeToken}`);
	}
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
	ollama?: OllamaModelInfo;
	modelsDev?: ReturnType<typeof lookupModelInfoSync>;
} {
	const openRouter =
		provider === "openrouter" && sourceData.openRouterData
			? sourceData.openRouterData.get(variantKey)
			: undefined;

	const ollama =
		provider === "ollama" && sourceData.ollamaData
			? sourceData.ollamaData.get(variantKey)
			: undefined;

	const modelsDev = sourceData.modelsDevData
		? lookupModelInfoSync(sourceData.modelsDevData, provider, variantKey)
		: null;

	return { openRouter, ollama, modelsDev };
}

export function hydrateChatModel(
	provider: string,
	variantKey: string,
	sourceData: ModelHydrationSourceData = {},
): HydratedChatModelMetadata {
	const { openRouter, ollama, modelsDev } = lookupMetadata(
		provider,
		variantKey,
		sourceData,
	);
	const paramSize = normalizeParamSize(ollama?.parameterSize);
	const quantization = ollama?.quantization;

	const displayName = buildDisplayName(
		provider,
		variantKey,
		openRouter?.name || ollama?.name || modelsDev?.name,
		paramSize,
	);

	const contextWindow =
		openRouter?.context_length ||
		ollama?.contextLength ||
		modelsDev?.limit?.context ||
		DEFAULT_CHAT_CONTEXT_WINDOW;

	const inputUsdPer1M = toUsdPer1MFromPerToken(openRouter?.pricing?.prompt);
	const outputUsdPer1M = toUsdPer1MFromPerToken(openRouter?.pricing?.completion);
	const hasPricing = inputUsdPer1M !== undefined || outputUsdPer1M !== undefined;

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
				openRouter?.supports_tool_calls ??
				ollama?.supportsTools ??
				modelsDev?.tool_call ??
				undefined,
			vision:
				openRouter?.supports_vision ??
				ollama?.supportsVision ??
				modelsDev?.attachment ??
				undefined,
			reasoning: openRouter?.supports_reasoning ?? modelsDev?.reasoning ?? undefined,
			structuredOutput:
				openRouter?.supports_structured_output ??
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
	const { openRouter, ollama, modelsDev } = lookupMetadata(
		provider,
		variantKey,
		sourceData,
	);
	const paramSize = normalizeParamSize(ollama?.parameterSize);
	const quantization = ollama?.quantization;

	const displayName = buildDisplayName(
		provider,
		variantKey,
		openRouter?.name || ollama?.name || modelsDev?.name,
		paramSize,
	);

	const maxInputFromOpenRouter =
		toNumber(openRouter?.per_request_limits?.prompt_tokens) ||
		openRouter?.context_length;

	const providerDefaultMaxInputTokens =
		DEFAULT_EMBED_MAX_INPUT_TOKENS_BY_PROVIDER[provider];

	const maxInputTokens =
		maxInputFromOpenRouter ||
		ollama?.contextLength ||
		modelsDev?.limit?.input ||
		modelsDev?.limit?.context ||
		providerDefaultMaxInputTokens ||
		DEFAULT_EMBEDDING_MAX_INPUT_TOKENS;

	const inputUsdPer1M = toUsdPer1MFromPerToken(openRouter?.pricing?.prompt);

	return {
		kind: "embedding",
		provider,
		variantKey,
		displayName,
		paramSize,
		quantization,
		maxInputTokens,
		dimensions: ollama?.embeddingLength,
		similarityThresholdDefault:
			sourceData.similarityThresholdDefault ?? DEFAULT_SIMILARITY_THRESHOLD,
		pricing: inputUsdPer1M !== undefined ? { inputUsdPer1M } : undefined,
	};
}
