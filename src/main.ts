import { Modal, Notice, Plugin, normalizePath, type ViewState } from "obsidian";
import { _ } from "svelte-i18n";
import "./lang/i18n";
import Log from "./logging";
import "./styles.css";
import SettingsTab from "./views/Settings/Settings";
import type { ProviderConfigs } from "./types/providers";
import {
  createData,
  getData,
  PluginDataStore,
} from "./stores/dataStore.svelte";
import { chatLayout, setPlugin } from "./stores/state.svelte";
import { ChatView, VIEW_TYPE_CHAT } from "./views/Chat/Chat";
import { AgentManager } from "./agent/AgentManager";
import type { SmartSecondBrainSettings } from "../v2/src/settings";
import { ChatDB } from "./db/chatDbSchema";
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
  private chatCacheDb!: ChatDB;

  async onload() {
    setPlugin(this);
    this.pluginData = await createData(this);

    // Register file-based chat view and .chat extension (v2 ChatView)
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
      callback: () => this.openLatestChat(),
    });

    this.addSettingTab(new SettingsTab(this));

    // Initialize Agent Manager (v2)
    this.agentManager = new AgentManager(this);
    await this.agentManager.initialize();
  }

  async onunload() {
    Log.info("Unloading plugin");
    if (this.agentManager) this.agentManager.cleanup();
  }

  async createNewChat() {
    const folder = this.pluginData.targetFolder || "Chats";
    // Ensure folder exists
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.adapter.mkdir(folder);
    }
    // Timestamp-based name
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const threadId = `Chat ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const path = normalizePath(`${folder}/${threadId}.chat`);
    const initial = {
      threadId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      checkpoints: {},
      writes: {},
    };
    const file = await this.app.vault.create(
      path,
      JSON.stringify(initial, null, 2),
    );
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async openLatestChat() {
    const folder = this.pluginData.targetFolder || "Chats";
    // Ensure folder exists
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.adapter.mkdir(folder);
    }
    // Find latest .chat file
    const files = this.app.vault
      .getFiles()
      .filter((f) => f.path.startsWith(folder + "/") && f.extension === "chat")
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    let fileToOpen = files[0];
    if (!fileToOpen) {
      await this.createNewChat();
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(fileToOpen);
  }
}
