import { Plugin } from "obsidian";
import "./lib/i18n";
import Log from "./utils/logging";
import "./styles.css";
import { AgentManager } from "./agent/AgentManager";
import { getQueryClient } from "./lib/query";
import { createMessenger } from "./stores/chatStore.svelte";
import { type PluginDataStore, createData } from "./stores/dataStore.svelte";
import { setPlugin } from "./stores/state.svelte";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chat/Chat";
import SettingsTab from "./views/settings/Settings";

// Re-export types for backward compatibility
export type {
	BuiltInToolId,
	DataviewQuerySettings,
	MCPHTTPServerConfig,
	MCPServerConfig,
	MCPServersConfig,
	MCPSSEServerConfig,
	MCPStdioServerConfig,
	MCPTransportType,
	PluginData,
	PluginDataKey,
	PluginPromptExtension,
	ReadNoteSettings,
	SearchAlgorithm,
	SearchNotesSettings,
	ToolConfig,
	ToolsConfig,
	ToolSpecificSettings,
} from "./types/plugin";

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

		this.addRibbonIcon("message-square", "New Chat", () => this.createNewChat());

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
