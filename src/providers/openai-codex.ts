import OpenAILogo from "../components/ui/logos/OpenAILogo.svelte";
import { createTransportedChatOpenAIResponses } from "./chatProviders";
import type {
	AuthObject,
	AuthValidationResult,
	BaseProviderDefinition,
	ChatModelConfig,
} from "../types/provider/index";
import { createOpenAICodexFetch, getValidOpenAICodexSession } from "./openaiCodex";
import { fetchOpenRouterModels, isEmbeddingModel, type OpenRouterModelInfo } from "./openrouterModels";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

function isCodexDiscoverableOpenAIModel(model: OpenRouterModelInfo): boolean {
	if (!model.id.startsWith("openai/")) {
		return false;
	}

	if (isEmbeddingModel(model)) {
		return false;
	}

	const modelId = model.id.slice("openai/".length).toLowerCase();
	if (!modelId || modelId.includes(":")) {
		return false;
	}

	const outputModalities = model.architecture?.output_modalities ?? [];
	if (outputModalities.length > 0 && !outputModalities.includes("text")) {
		return false;
	}

	return !(
		modelId.includes("audio") ||
		modelId.includes("image") ||
		modelId.includes("deep-research") ||
		modelId.includes("safeguard")
	);
}

export function openAICodexProvider(providerId: string, displayName = "OpenAI Codex"): BaseProviderDefinition {
	return {
		id: providerId,
		displayName,
		logo: OpenAILogo,
		setupInstructions: {
			steps: [
				"Use ChatGPT/Codex sign-in to authorize this provider",
				"Complete the browser-based sign-in flow",
				"Select one of the discovered Codex-backed chat models",
			],
		},
		auth: {
			apiKey: {
				label: "ChatGPT Sign-In",
				description: "This provider uses a browser-based ChatGPT/Codex sign-in flow.",
				kind: "text",
				required: true,
				placeholder: "Authorized via ChatGPT sign-in",
			},
		},
		createChatInstance: (_auth: AuthObject, modelId: string, options?: Partial<ChatModelConfig>) =>
			createTransportedChatOpenAIResponses(providerId, {
				model: modelId,
				apiKey: async () => {
					const session = await getValidOpenAICodexSession();
					if (!session) {
						throw new Error("ChatGPT sign-in required");
					}
					return session.accessToken;
				},
				configuration: {
					baseURL: OPENAI_DEFAULT_BASE_URL,
					fetch: createOpenAICodexFetch(),
				},
				temperature: options?.temperature,
			}),
		validateAuth: async (_auth: AuthObject): Promise<AuthValidationResult> => {
			const session = await getValidOpenAICodexSession();
			if (!session) {
				return { valid: false, error: "Sign in with ChatGPT to use Codex" };
			}
			return { valid: true };
		},
		discoverModels: async (): Promise<string[]> => {
			const models = await fetchOpenRouterModels();
			if (!models) {
				return [];
			}

			return Array.from(
				new Set(
					Array.from(models.values())
						.filter(isCodexDiscoverableOpenAIModel)
						.map((model) => model.id.split("/").pop()?.trim())
						.filter((modelId): modelId is string => Boolean(modelId)),
				),
			).sort((a, b) => a.localeCompare(b));
		},
	};
}
