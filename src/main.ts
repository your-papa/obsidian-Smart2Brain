import { AbstractTextComponent, Plugin } from "obsidian";
import "./lang/i18n";
import Log from "./logging";
import "./styles.css";
import SettingsTab from "./views/Settings/Settings";
import type { ProviderConfigs } from "./types/providers";
import { createData, PluginDataStore } from "./stores/dataStore.svelte";
import { setPlugin } from "./stores/state.svelte";
import { ChatView, VIEW_TYPE_CHAT } from "./views/Chat/Chat";
import { AgentManager } from "./agent/AgentManager";
import { type ChatModel, createMessenger } from "./stores/chatStore.svelte";
import type { UUIDv7 } from "./utils/uuid7Validator";
import { getQueryClient } from "./utils/query";

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
	mcpServers: Record<string, any>;
	isQuickSettingsOpen: boolean;
	isVerbose: boolean;
	hideIncognitoWarning: boolean;
	isAutostart: boolean;
	lastActiveChatId: UUIDv7 | null;
}
export type ProviderName = "ollama" | "openai" | "anthropic" | "sap-ai-core";

export default class SecondBrainPlugin extends Plugin {
	agentManager!: AgentManager;
	queryClient = getQueryClient();
	pluginData!: PluginDataStore;

	async onload() {
		setPlugin(this);
		this.pluginData = await createData(this);

		// Register file-based chat view and .chat extension (v2 ChatView)
		// const VIEW_TYPE = "my-view";

		this.registerHoverLinkSource(VIEW_TYPE_CHAT, {
			display: "Smart2Brain Chat",
			// true = by default require Cmd/Ctrl for this source
			// false = by default no modifier required (more “reading-mode-like”)
			defaultMod: false,
		});
		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
		this.registerExtensions(["chat"], VIEW_TYPE_CHAT);

		const { isVerbose, isAutostart } = this.pluginData;

		if (this.manifest.dir === undefined) {
			this.unload();
			throw Error("Cannot localize plugin directory.");
		}

		this.addRibbonIcon("message-square", "New Chat", () =>
			this.createNewChat(),
		);

		this.addCommand({
			id: "open-chat",
			name: "Open Chat",
			icon: "message-square",
			callback: async () => await this.agentManager.openLatestChat(),
		});

		this.addCommand({
			id: "new-chat",
			name: "New Chat",
			icon: "plus",
			callback: async () => await this.agentManager.createNewChat(),
		});

		this.addSettingTab(new SettingsTab(this));

		// Initialize Agent Manager (v2)
		this.agentManager = new AgentManager(this);
		await this.agentManager.initialize();

		createMessenger(this.agentManager);
	}

	async onunload() {
		Log.info("Unloading plugin");
		if (this.agentManager) this.agentManager.cleanup();
	}

	async createNewChat() {
		return this.agentManager.createNewChat();
	}

	async openLatestChat() {
		return this.agentManager.openLatestChat();
	}
}
