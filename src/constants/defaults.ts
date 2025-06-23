import { Prompts, type Language } from "papa-ts";
import type { PluginData } from "../main";
import type { ProviderConfigs } from "../types/providers";

export const DEFAULT_PROVIDER_CONFIGS: ProviderConfigs = {
	Ollama: {
		isConfigured: false,
		providerAuth: {
			baseUrl: "http://localhost:11434",
		},
		embedModels: new Map([
			["nomic-embed-text", { similarityThreshold: 0.5 }],
			["mxbai-embed-large", { similarityThreshold: 0.5 }],
		]),
		genModels: new Map([
			["llama2", { temperature: 0.5, contextWindow: 4096 }],
			["llama2-uncensored", { temperature: 0.5, contextWindow: 4096 }],
			["mistral", { temperature: 0.5, contextWindow: 8000 }],
			["mistral-openorca", { temperature: 0.5, contextWindow: 8000 }],
			["gemma", { temperature: 0.5, contextWindow: 8000 }],
			["mixtral", { temperature: 0.5, contextWindow: 32000 }],
			["dolphin-mixtral", { temperature: 0.5, contextWindow: 32000 }],
			["phi", { temperature: 0.5, contextWindow: 2048 }],
			["llama3.1", { temperature: 0.5, contextWindow: 8192 }],
		]),
	},
	OpenAI: {
		isConfigured: false,
		providerAuth: {
			apiKey: "",
		},
		embedModels: new Map([
			["text-embedding-ada-002", { similarityThreshold: 0.75 }],
			["text-embedding-3-large", { similarityThreshold: 0.5 }],
			["text-embedding-3-small", { similarityThreshold: 0.5 }],
		]),
		genModels: new Map([
			["chatgpt-4o-latest", { temperature: 0.4, contextWindow: 128000 }],
			["gpt-4.1-mini-2025-04-14", { temperature: 0.4, contextWindow: 1047576 }],
			["gpt-4.1", { temperature: 0.2, contextWindow: 1047576 }],
			["o4-mini", { temperature: 0.2, contextWindow: 200000 }],
			["o1", { temperature: 0.2, contextWindow: 200000 }],
			["o1", { temperature: 0.2, contextWindow: 200000 }],
		]),
	},
	Anthropic: {
		isConfigured: false,
		providerAuth: {
			apiKey: "",
		},
		genModels: new Map([
			["claude-3-haiku-20240307", { temperature: 0.5, contextWindow: 200000 }],
			["claude-3-sonnet-20240229", { temperature: 0.5, contextWindow: 200000 }],
			["claude-3-opus-20240229", { temperature: 0.5, contextWindow: 200000 }],
			["claude-3-5-sonnet-20241022", { temperature: 0.5, contextWindow: 200000 }],
		]),
	},
	CustomOpenAI: {
		isConfigured: false,
		providerAuth: {
			apiKey: "",
			baseUrl: "",
		},
		embedModels: new Map([["text-embedding-ada-002", { similarityThreshold: 0.75 }]]),
		genModels: new Map([["gpt-3.5-turbo", { temperature: 0.5, contextWindow: 16385 }]]),
	},
};

export const DEFAULT_SETTINGS: PluginData = {
	providerConfig: DEFAULT_PROVIDER_CONFIGS,
	selEmbedModel: {
		provider: "OpenAI",
		model: "text-embedding-3-small",
	},
	selGenModel: {
		provider: "OpenAI",
		model: "gpt-4.1-mini-2025-04-14",
	},
	isChatComfy: true,
	isUsingRag: false,
	retrieveTopK: 100,
	assistantLanguage: (window.localStorage.getItem("language") as Language) || "en",
	initialAssistantMessageContent:
		Prompts[(window.localStorage.getItem("language") as Language) || "en"]?.initialAssistantMessage ||
		Prompts.en.initialAssistantMessage,
	targetFolder: "Chats",
	defaultChatName: "New Chat",
	excludeFF: ["Chats", ".excalidraw.md"],
	includeFF: [],
	isExcluding: true,
	isQuickSettingsOpen: true,
	isVerbose: false,
	hideIncognitoWarning: false,
	isAutostart: false,
	debuggingLangchainKey: "",
};
