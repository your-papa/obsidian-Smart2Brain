import type { ChatModel } from "../stores/chatStore.svelte";
import type { UUIDv7 } from "../utils/uuid7Validator";
import type { ProviderConfigs } from "./providers";

export type SearchAlgorithm = "grep" | "omnisearch" | "embeddings";

export interface PluginData {
	providerConfig: ProviderConfigs;
	initialAssistantMessageContent: string;
	isUsingRag: boolean;
	isGeneratingChatTitle: boolean;
	defaultChatModel: ChatModel | null;
	retrieveTopK: number;
	assistantLanguage: "de" | "en";
	excludeFF: Array<string>;
	includeFF: Array<string>;
	isExcluding: boolean;
	defaultChatName: string;
	targetFolder: string;
	isChatComfy: boolean;
	isOnboarded: boolean;
	debuggingLangchainKey: string;
	enableLangSmith: boolean;
	langSmithApiKey: string;
	langSmithProject: string;
	langSmithEndpoint: string;
	mcpServers: Record<string, unknown>;
	isQuickSettingsOpen: boolean;
	isVerbose: boolean;
	hideIncognitoWarning: boolean;
	isAutostart: boolean;
	lastActiveChatId: UUIDv7 | null;
	searchAlgorithm: SearchAlgorithm;
}

export type PluginDataKey = keyof PluginData;
