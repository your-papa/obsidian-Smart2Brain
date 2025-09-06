import { after, around } from "monkey-around";
import {
  Modal,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  WorkspaceSidedock,
  normalizePath,
  type ViewState,
} from "obsidian";
import {
  AnthropicProvider,
  CustomOpenAIProvider,
  LogLvl,
  OllamaProvider,
  OpenAIProvider,
  type Language,
  type Providers,
  type RegisteredProvider,
  type RegisteredEmbedProvider,
  type RegisteredGenProvider,
  Papa,
} from "papa-ts";
import { get } from "svelte/store";
import { _ } from "svelte-i18n";

import { ConfirmModal } from "./components/Settings/ConfirmModal";
import "./lang/i18n";
import Log from "./logging";
import "./styles.css";
import SettingsTab from "./views/Settings";
import { RemoveModal } from "./components/Modal/RemoveModal";
import type { ProviderConfigs } from "./types/providers";
import { createData, getData, PluginDataStore } from "./lib/data.svelte";
import { chatLayout, setPlugin } from "./lib/state.svelte";
import { QueryClient } from "@tanstack/svelte-query";
import { ChatView, VIEW_TYPE_CHAT } from "./views/Chat";
import { ChatDB } from "./components/db/chatDbSchema";
import {
  Chat,
  createMessenger,
  getLastActiveChatId,
  Messenger,
} from "./components/Chat/chatState.svelte";

export interface PluginData {
  providerConfig: ProviderConfigs;
  selEmbedModel: { provider: RegisteredEmbedProvider; model: string };
  selGenModel: { provider: RegisteredGenProvider; model: string };
  isChatComfy: boolean;
  initialAssistantMessageContent: string;
  isUsingRag: boolean;
  retrieveTopK: number;
  assistantLanguage: Language;
  targetFolder: string;
  excludeFF: Array<string>;
  includeFF: Array<string>;
  isExcluding: boolean;
  defaultChatName: string;
  debuggingLangchainKey: string;
  isQuickSettingsOpen: boolean;
  isVerbose: boolean;
  hideIncognitoWarning: boolean;
  isAutostart: boolean;
  lastActiveChatId: string | null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 0,
    },
  },
});

export default class SecondBrainPlugin extends Plugin {
  papa!: Papa;
  queryClient = queryClient;
  pluginData!: PluginDataStore;
  private isChatAcivatedFromRibbon = false; // workaround for a bug where the chat view is activated twice through monkey patching
  private autoSaveTimer!: number;
  private chatCacheDb!: ChatDB;

  async onload() {
    setPlugin(this);
    const VIEW_TYPE_CHAT = "chat-view";
    this.pluginData = await createData(this);
    this.chatCacheDb = new ChatDB();
    const messenger = createMessenger(this.chatCacheDb);

    const lastActiveChat: Chat = await getLastActiveChatId(
      messenger,
      this.pluginData,
    );

    this.papa = new Papa({
      debugging: {
        langsmithApiKey: this.pluginData.debuggingLangchainKey,
        logLvl: 1,
      },
    });

    //Todo setup method with preamptife fetching etcs
    this.pluginData.getConfiguredProviders().forEach((provider) => {
      this.papa.providerRegistry
        .getProvider(provider)
        .setup(this.pluginData.getProviderAuthParams(provider));
    });

    const { isVerbose, isAutostart } = this.pluginData;

    if (this.manifest.dir === undefined) {
      this.unload();
      throw Error("Cannot localize plugin directory.");
    }

    // this.s2b = new SmartSecondBrain(this, this.manifest.dir);
    // Log.setLogLevel(isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);

    // this.app.workspace.onLayoutReady(() => {
    //   if (isAutostart) this.s2b.init();
    // });

    // this.registerEvent(
    // 	this.app.workspace.on("layout-change", () => {
    // 		if (!this.leaf) {
    // 			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    // 			if (!leaves.length) return;
    // 			this.leaf = leaves[0];
    // 		}
    // 		chatLayout.isSidebar = [this.app.workspace.leftSplit, this.app.workspace.rightSplit].includes(
    // 			this.leaf.getRoot() as WorkspaceSidedock,
    // 		);
    // 	}),
    // );
    // this.registerEvent(
    //   this.app.metadataCache.on("changed", async (file: TFile) =>
    //     this.s2b.onFileChange(file),
    //   ),
    // );
    // this.registerEvent(
    //   this.app.vault.on("delete", async (file: TAbstractFile) => {
    //     // guard: only handle real files
    //     if (!(file instanceof TFile)) return;
    //     await this.s2b.onFileDelete(file);
    //   }),
    // );
    // this.registerEvent(
    //   this.app.vault.on(
    //     "rename",
    //     async (file: TAbstractFile, oldPath: string) => {
    //       // guard: only handle real files
    //       if (!(file instanceof TFile)) return;
    //       await this.s2b.onFileRename(file, oldPath);
    //     },
    //   ),
    // );
    // // periodically or on unfocus save vector store data to disk
    // window.addEventListener("blur", () => this.s2b.saveVectorStoreData());

    // const resetAutoSaveTimer = () => {
    //   window.clearTimeout(this.autoSaveTimer);
    //   this.autoSaveTimer = window.setTimeout(
    //     () => this.s2b.saveVectorStoreData(),
    //     30 * 1000,
    //   );
    // };
    // listen for any event to reset the timer
    // window.addEventListener("mousemove", () => resetAutoSaveTimer());
    // window.addEventListener("mousedown", () => resetAutoSaveTimer());
    // window.addEventListener("keypress", () => resetAutoSaveTimer());
    // window.addEventListener("scroll", () => resetAutoSaveTimer());

    this.registerView(
      VIEW_TYPE_CHAT,
      (leaf) => new ChatView(this, leaf, lastActiveChat),
    );

    // this.addRibbonIcon("message-square", t("ribbon.chat"), () =>
    //   this.activateView(),
    // );

    // this.addCommand({
    //   id: "open-chat",
    //   name: t("cmd.chat"),
    //   icon: "message-square",
    //   callback: () => this.activateView(),
    // });
    // this.addCommand({
    //   id: "pull-model",
    //   name: t("cmd.pull_model"),
    //   icon: "arrow-down-to-line",
    //   callback: () => new PullModal(this.app).open(),
    // });
    // this.addCommand({
    //   id: "remove-model",
    //   name: t("cmd.remove_model"),
    //   icon: "trash",
    //   callback: () => new RemoveModal(this.app).open(),
    // });

    this.addSettingTab(new SettingsTab(this));

    //this.registerMonkeyPatches();
  }

  async onunload() {
    Log.info("Unloading plugin");
  }

  async activateView() {
    const { targetFolder, defaultChatName, initialAssistantMessageContent } =
      this.pluginData;
    // If no file is provided, open the default chat

    const chatDirExists: boolean = !!this.app.vault.getFolderByPath(
      normalizePath(targetFolder),
    );

    if (!chatDirExists) {
      await this.app.vault.createFolder(normalizePath(targetFolder));
    }

    const filePath = normalizePath(`${targetFolder}/${defaultChatName}.md`);

    let file = this.app.vault.getFileByPath(filePath);
    if (!file) {
      file = await this.app.vault.create(
        filePath,
        "Assistant\n" + initialAssistantMessageContent + "\n- - - - -",
      );
    }

    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    const isNewLeaf: boolean = !leaves.length;
    const leaf = isNewLeaf ? this.app.workspace.getRightLeaf(false) : leaves[0];
    if (isNewLeaf)
      await leaf?.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  // async saveChat() {
  // 	const { targetFolder } = this.pluginData;
  // 	let fileName = await this.s2b.createFilenameForChat();
  // 	let normalizedFilePath = normalizePath(targetFolder + "/" + fileName + ".md");
  // 	while (await this.app.vault.adapter.exists(normalizedFilePath)) {
  // 		//Checks if already existing file has a number at the end
  // 		const regex = /\((\d+)\)$/;
  // 		const match = fileName.match(regex);
  // 		if (match) {
  // 			fileName = fileName.slice(0, -3) + "(" + (parseInt(match[1], 10) + 1) + ")";
  // 		} else {
  // 			fileName = fileName + " (1)";
  // 		}
  // 		normalizedFilePath = normalizePath(d.targetFolder + "/" + fileName + ".md");
  // 	}
  // 	// const newChatFile = await this.app.vault.copy(this.chatView.file, normalizedFilePath);
  // 	chatHistory.reset;
  // 	await this.activateView(newChatFile);
  // }

  async clearPluginData() {
    const t = get(_);
    new ConfirmModal(
      this.app,
      t("settings.clear_modal.title"),
      t("settings.clear_modal.description"),
      async (result) => {
        if (result === "Yes") {
          const { deleteData } = this.pluginData;
          deleteData();
          const files = (
            await this.app.vault.adapter.list(
              normalizePath(this.manifest.dir + "/vectorstores"),
            )
          ).files;
          for (const file of files) await this.app.vault.adapter.remove(file);
          new Notice(t("notice.plugin_data_cleared"), 4000);
          this.pluginData = await createData(this);
          await this.activateView();
        }
      },
      "",
    ).activate();
  }

  // registerMonkeyPatches() {
  //   const { targetFolder } = this.pluginData;
  //   // eslint-disable-next-line @typescript-eslint/no-this-alias
  //   const self = this;
  //   // Monkey patch WorkspaceLeaf to open Chats with ChatView by default
  //   this.register(
  //     around(WorkspaceLeaf.prototype, {
  //       setViewState(next) {
  //         // eslint-disable-next-line @typescript-eslint/no-explicit-any
  //         return function (state: ViewState, ...rest: any[]) {
  //           if (
  //             // If we have a markdown file
  //             state.type === "markdown" &&
  //             state.state?.file
  //           ) {
  //             // Then check for the chat frontMatterKey
  //             // const cache = self.app.metadataCache.getCache(state.state.file);

  //             // if (cache?.frontmatter && cache.frontmatter['second-brain-chat']) {
  //             if (state.state.file.startsWith(targetFolder)) {
  //               // If we have it, force the view type to be chat
  //               const newState = {
  //                 ...state,
  //                 type: VIEW_TYPE_CHAT,
  //               };
  //               if (!self.isChatAcivatedFromRibbon) {
  //                 const leaves =
  //                   self.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
  //                 self.leaf = leaves.length
  //                   ? leaves[0]
  //                   : self.app.workspace.getRightLeaf(false);
  //               }
  //               return next.apply(self.leaf, [newState, ...rest]);
  //             }
  //           }

  //           return next.apply(this, [state, ...rest]);
  //         };
  //       },
  //     }),
  //   );
  // }
}
