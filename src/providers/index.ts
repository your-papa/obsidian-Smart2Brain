/**
 * Provider Registry
 *
 * This module provides lookup helpers for code-defined provider templates and
 * persisted provider instances created from those templates.
 */

import type { BaseProviderDefinition, ProviderInstanceMeta, ProviderTemplateId } from "../types/provider/index";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";
import { openaiProvider } from "./openai";
import { openrouterProvider } from "./openrouter";
import { openAICodexProvider } from "./openai-codex";

export interface ProviderTemplateDefinition {
	id: ProviderTemplateId;
	displayName: string;
	description: string;
}

export const PROVIDER_TEMPLATES: readonly ProviderTemplateDefinition[] = [
	{
		id: "openai",
		displayName: "OpenAI",
		description: "OpenAI models via ChatGPT sign-in or an API key.",
	},
	{
		id: "openai-compatible",
		displayName: "Custom",
		description: "Flexible OpenAI-style provider for OpenAI and compatible endpoints.",
	},
	{
		id: "anthropic",
		displayName: "Anthropic",
		description: "Claude models via Anthropic's API.",
	},
	{
		id: "ollama",
		displayName: "Ollama",
		description: "Local Ollama models over the Ollama API.",
	},
	{
		id: "openrouter",
		displayName: "OpenRouter",
		description: "OpenRouter account and model catalog.",
	},
] as const;

export function getProviderTemplate(templateId: ProviderTemplateId): ProviderTemplateDefinition | undefined {
	return PROVIDER_TEMPLATES.find((template) => template.id === templateId);
}

function createTemplateDefinition(
	instanceId: string,
	templateId: ProviderTemplateId,
	meta: ProviderInstanceMeta,
): BaseProviderDefinition | undefined {
	switch (templateId) {
		case "openai":
			return {
				...openaiProvider,
				id: instanceId,
				displayName: meta.displayName,
			};
		case "openai-compatible":
			return createOpenAICompatibleProvider({
				id: instanceId,
				displayName: meta.displayName,
				defaultBaseUrl: "https://api.openai.com",
			});
		case "openai-codex":
			return openAICodexProvider(instanceId, meta.displayName);
		case "anthropic":
			return {
				...anthropicProvider,
				id: instanceId,
				displayName: meta.displayName,
			};
		case "ollama":
			return {
				...ollamaProvider,
				id: instanceId,
				displayName: meta.displayName,
			};
		case "openrouter":
			return {
				...openrouterProvider,
				id: instanceId,
				displayName: meta.displayName,
			};
		default:
			return undefined;
	}
}

export function getProviderDefinition(
	id: string,
	providerMeta: Record<string, ProviderInstanceMeta> = {},
): BaseProviderDefinition | undefined {
	switch (id) {
		case "openai":
			return openaiProvider;
		case "anthropic":
			return anthropicProvider;
		case "ollama":
			return ollamaProvider;
	}

	const meta = providerMeta[id];
	if (!meta) {
		return undefined;
	}

	return createTemplateDefinition(id, meta.templateId, meta);
}

export function getAllProviderTemplates(): readonly ProviderTemplateDefinition[] {
	return PROVIDER_TEMPLATES;
}

export {
	ProviderRegistryError,
	ProviderAuthError,
	ProviderEndpointError,
	ModelNotFoundError,
	ProviderNotFoundError,
	ProviderImportError,
} from "./errors";

export { ProviderRegistry } from "./registry";

export { createOpenAICompatibleProvider } from "./openai-compatible";

export type {
	AuthObject,
	AuthObjectKey,
	CodexSession,
	AuthFieldDefinition,
	AuthValidationResult,
	BaseProviderDefinition,
	EmbeddingProviderDefinition,
	ChatModelConfig,
	EmbedModelConfig,
	LogoProps,
	ProviderAuthConfig,
	ProviderSetupInstructions,
	RequiredAuthField,
	OptionalAuthField,
	OpenAIAuthMode,
	ProviderInstanceMeta,
	ProviderTemplateId,
} from "../types/provider/index";

export { isEmbeddingProvider } from "../types/provider/index";

export { anthropicProvider } from "./anthropic";
export { openaiProvider } from "./openai";
export { ollamaProvider } from "./ollama";
export { openrouterProvider } from "./openrouter";
