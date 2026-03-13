import OpenAILogo from "../components/ui/logos/OpenAILogo.svelte";
import { createTransportedChatOpenAIResponses } from "./chatProviders";
import type {
	AuthObject,
	AuthValidationResult,
	BaseProviderDefinition,
	ChatModelConfig,
} from "../types/provider/index";
import { createOpenAICodexFetch, getValidOpenAICodexSession } from "./openaiCodex";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

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
			// Reuse the models.dev fallback path already used by the OpenAI provider.
			return ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini"];
		},
	};
}
