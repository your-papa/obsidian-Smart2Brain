import { Logger } from "../utils/logging";
import type { OpenRouterModelInfo } from "../providers/openrouterModels";

export interface UiClassifiableModel {
	provider: string;
	model: string;
	family?: string;
	families?: string[];
}

export const UI_VENDOR_IDS = [
	"openai",
	"anthropic",
	"google",
	"microsoft",
	"meta-llama",
	"deepseek",
	"x-ai",
	"mistralai",
	"qwen",
] as const;

const UI_VENDOR_ID_SET = new Set<string>(UI_VENDOR_IDS);

export type UnclassifiedUiModelReason = "no_vendor_match" | "vendor_not_in_ui";

export interface UnclassifiedUiModel {
	provider: string;
	model: string;
	reason: UnclassifiedUiModelReason;
	extractedVendor?: string;
}

function normalizeComparableToken(model: string): string {
	return model
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]/g, "");
}

function extractPrefixFromOpenRouterModelId(modelId: string): string | null {
	if (!modelId.includes("/")) return null;
	const [prefix] = modelId.split("/", 1);
	return prefix || null;
}

function inferOllamaVendorFromOpenRouter(
	families: string[],
	openRouterModels: Map<string, OpenRouterModelInfo> | null | undefined,
): string | null {
	if (!openRouterModels || openRouterModels.size === 0) {
		return null;
	}

	const normalizedFamilies = families
		.map((family) => normalizeComparableToken(family))
		.filter((family) => family.length > 0);
	if (normalizedFamilies.length === 0) return null;

	for (const normalizedFamily of normalizedFamilies) {
		const matches = new Set<string>();
		for (const modelInfo of openRouterModels.values()) {
			const sourceId = modelInfo.canonical_slug ?? modelInfo.id;
			const prefix = extractPrefixFromOpenRouterModelId(sourceId);
			if (!prefix) continue;

			const modelPart = sourceId.split("/").slice(1).join("/");
			const modelPartNormalized = normalizeComparableToken(modelPart);

			if (modelPartNormalized.startsWith(normalizedFamily)) {
				matches.add(prefix);
			}
		}

		if (matches.size === 1) {
			return Array.from(matches)[0] ?? null;
		}
	}

	return null;
}

export function extractVendor(
	model: UiClassifiableModel,
	openRouterModels?: Map<string, OpenRouterModelInfo> | null,
): string | null {
	if (model.provider === "openrouter" && model.model.includes("/")) {
		return model.model.split("/")[0];
	}

	if (model.provider === "openai" || model.provider === "anthropic") {
		return model.provider;
	}

	if (model.provider === "ollama") {
		const candidateFamilies = [model.family, ...(model.families ?? [])].filter(
			(family): family is string => typeof family === "string" && family.length > 0,
		);
		if (candidateFamilies.length === 0) return null;
		return inferOllamaVendorFromOpenRouter(candidateFamilies, openRouterModels);
	}

	return null;
}

export function getUnclassifiedModelsForUi(
	models: readonly UiClassifiableModel[],
	openRouterModels?: Map<string, OpenRouterModelInfo> | null,
): UnclassifiedUiModel[] {
	const unresolvedByKey = new Map<string, UnclassifiedUiModel>();

	for (const model of models) {
		const extractedVendor = extractVendor(model, openRouterModels);
		if (!extractedVendor) {
			const key = `${model.provider}:${model.model}:no_vendor_match`;
			unresolvedByKey.set(key, {
				provider: model.provider,
				model: model.model,
				reason: "no_vendor_match",
			});
			continue;
		}

		if (!UI_VENDOR_ID_SET.has(extractedVendor)) {
			const key = `${model.provider}:${model.model}:vendor_not_in_ui:${extractedVendor}`;
			unresolvedByKey.set(key, {
				provider: model.provider,
				model: model.model,
				extractedVendor,
				reason: "vendor_not_in_ui",
			});
		}
	}

	return Array.from(unresolvedByKey.values()).sort((a, b) => {
		const aKey = `${a.provider}:${a.model}:${a.reason}:${a.extractedVendor ?? ""}`;
		const bKey = `${b.provider}:${b.model}:${b.reason}:${b.extractedVendor ?? ""}`;
		return aKey.localeCompare(bKey);
	});
}

const loggedUnclassifiedSignatures = new Set<string>();

export function logUnclassifiedModelsInfo(
	scope: string,
	models: readonly UiClassifiableModel[],
	openRouterModels?: Map<string, OpenRouterModelInfo> | null,
): void {
	const unresolved = getUnclassifiedModelsForUi(models, openRouterModels);
	if (unresolved.length === 0) {
		return;
	}

	const signature = unresolved
		.map((entry) => `${entry.provider}:${entry.model}:${entry.reason}:${entry.extractedVendor ?? ""}`)
		.sort()
		.join("|");

	if (loggedUnclassifiedSignatures.has(signature)) {
		return;
	}

	loggedUnclassifiedSignatures.add(signature);
	Logger.info("ui.model-classification.unclassified", {
		scope,
		count: unresolved.length,
		models: unresolved,
	});
}
