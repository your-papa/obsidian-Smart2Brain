import { Prompts, type Language } from "papa-ts";
import type { PluginData } from "../main";
import type { ProviderConfigs } from "../types/providers";

export const DEFAULT_PROVIDER_CONFIGS: ProviderConfigs = {
	Ollama: {
		isConfigured: false,
		providerAuth: {
			baseUrl: "http://localhost:11434",
		},
		selEmbedModel: "nomic-embed-text",
		embedModels: new Map([
			["nomic-embed-text", { similarityThreshold: 0.5 }],
			["mxbai-embed-large", { similarityThreshold: 0.5 }],
		]),
		selGenModel: "llama3.1",
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
		selEmbedModel: "text-embedding-3-small",
		embedModels: new Map([
			["text-embedding-ada-002", { similarityThreshold: 0.75 }],
			["text-embedding-3-large", { similarityThreshold: 0.5 }],
			["text-embedding-3-small", { similarityThreshold: 0.5 }],
		]),
		selGenModel: "gpt-4o-mini",
		genModels: new Map([
			["gpt-3.5-turbo", { temperature: 0.5, contextWindow: 16385 }],
			["gpt-4", { temperature: 0.5, contextWindow: 8192 }],
			["gpt-4-32k", { temperature: 0.5, contextWindow: 32768 }],
			["gpt-4-turbo-preview", { temperature: 0.5, contextWindow: 128000 }],
			["gpt-4o-mini", { temperature: 0.5, contextWindow: 8192 }],
			["gpt-4o", { temperature: 0.5, contextWindow: 128000 }],
		]),
	},
	Anthropic: {
		isConfigured: false,
		providerAuth: {
			apiKey: "",
		},
		selGenModel: "claude-3-haiku-20240307",
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
		selEmbedModel: "text-embedding-ada-002",
		embedModels: new Map([["text-embedding-ada-002", { similarityThreshold: 0.75 }]]),
		selGenModel: "gpt-3.5-turbo",
		genModels: new Map([["gpt-3.5-turbo", { temperature: 0.5, contextWindow: 16385 }]]),
	},
};

export const DEFAULT_SETTINGS: PluginData = {
	providerConfig: DEFAULT_PROVIDER_CONFIGS,
	selEmbedProvider: "Ollama",
	selGenProvider: "Ollama",
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
