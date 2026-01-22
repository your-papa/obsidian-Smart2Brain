import type { ChatModel } from "../stores/chatStore.svelte";
import type { UUIDv7 } from "../utils/uuid7Validator";
import type { ProviderConfigs } from "./providers";

export type SearchAlgorithm = "grep" | "omnisearch" | "embeddings";

/**
 * Configuration for a plugin-specific prompt extension.
 * These are appended to the base system prompt when the plugin is installed and enabled.
 */
export interface PluginPromptExtension {
	/** Internal plugin ID (e.g., "dataview", "obsidian-charts") */
	pluginId: string;
	/** Display name shown in settings (e.g., "Dataview") */
	displayName: string;
	/** Whether this extension is enabled by the user */
	enabled: boolean;
	/** The prompt content for this plugin */
	prompt: string;
}

export interface PluginData {
	providerConfig: ProviderConfigs;
	systemPrompt: string;
	pluginPromptExtensions: Record<string, PluginPromptExtension>;
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
