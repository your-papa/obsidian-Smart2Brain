import { around } from 'monkey-around';
import { Notice, Plugin, TFile, WorkspaceLeaf, WorkspaceSidedock, normalizePath, type ViewState } from 'obsidian';
import { LogLvl, Prompts, type Language } from 'papa-ts';
import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';

import SmartSecondBrain from './SmartSecondBrain';
import { ConfirmModal } from './components/Settings/ConfirmModal';
import { PullModal } from './components/Modal/PullModal';
import './lang/i18n';
import Log from './logging';
import { chatHistory, data, isChatInSidebar, plugin } from './store';
import './styles.css';
import { ChatView, VIEW_TYPE_CHAT } from './views/Chat';
import { SetupView, VIEW_TYPE_SETUP } from './views/Onboarding';
import SettingsTab from './views/Settings';
import { RemoveModal } from './components/Modal/RemoveModal';
import { type Provider } from './provider';

export interface PluginData {
    isChatComfy: boolean;
    initialAssistantMessageContent: string;
    isUsingRag: boolean;
    retrieveTopK: number;
    assistantLanguage: Language;
    embedProvider: Provider;
    genProvider: Provider;
    openAISettings: { apiKey: string };
    ollamaSettings: { baseUrl: string };
    embedModel: string;
    genModel: string;
    genModels: { [model: string]: { temperature: number; contextWindow: number } };
    embedModels: { [model: string]: { similarityThreshold: number } };
    targetFolder: string;
    excludeFF: Array<string>;
    defaultChatName: string;
    debugginLangchainKey: string;
    isQuickSettingsOpen: boolean;
    isVerbose: boolean;
    isOnboarded: boolean;
    hideIncognitoWarning: boolean;
    isAutostart: boolean;
}

export type PluginDataKey = keyof PluginData;

export const DEFAULT_SETTINGS: Partial<PluginData> = {
    isChatComfy: true,
    isUsingRag: true,
    retrieveTopK: 100,
    assistantLanguage: (window.localStorage.getItem('language') as Language) || 'en',
    initialAssistantMessageContent:
        Prompts[(window.localStorage.getItem('language') as Language) || 'en']?.initialAssistantMessage || Prompts.en.initialAssistantMessage,
    ollamaSettings: { baseUrl: 'http://localhost:11434' },
    openAISettings: { apiKey: '' },
    embedModels: {
        'text-embedding-ada-002': { similarityThreshold: 0.75 },
        'text-embedding-3-large': { similarityThreshold: 0.5 },
        'text-embedding-3-small': { similarityThreshold: 0.5 },
        'nomic-embed-text': { similarityThreshold: 0.5 },
        'mxbai-embed-large': { similarityThreshold: 0.5 },
    },
    genModels: {
        'gpt-3.5-turbo': { temperature: 0.5, contextWindow: 16385 },
        'gpt-4': { temperature: 0.5, contextWindow: 8192 },
        'gpt-4-32k': { temperature: 0.5, contextWindow: 32768 },
        'gpt-4-turbo-preview': { temperature: 0.5, contextWindow: 128000 },
        llama2: { temperature: 0.5, contextWindow: 4096 },
        'llama2-uncensored': { temperature: 0.5, contextWindow: 4096 },
        mistral: { temperature: 0.5, contextWindow: 8000 },
        'mistral-openorca': { temperature: 0.5, contextWindow: 8000 },
        gemma: { temperature: 0.5, contextWindow: 8000 },
        mixtral: { temperature: 0.5, contextWindow: 32000 },
        'dolphin-mixtral': { temperature: 0.5, contextWindow: 32000 },
        phi: { temperature: 0.5, contextWindow: 2048 },
    },
    targetFolder: 'Chats',
    defaultChatName: 'New Chat',
    excludeFF: ['Chats', '*.excalidraw.md'],
    isQuickSettingsOpen: true,
    isVerbose: false,
    isOnboarded: false,
    hideIncognitoWarning: false,
    isAutostart: false,
};

export default class SecondBrainPlugin extends Plugin {
    setupView: SetupView;
    chatView: ChatView;
    s2b: SmartSecondBrain;
    leaf: WorkspaceLeaf;
    private isChatAcivatedFromRibbon = false; // workaround for a bug where the chat view is activated twice through monkey patching
    private autoSaveTimer: number;

    async loadSettings() {
        data.set(Object.assign({}, DEFAULT_SETTINGS, await this.loadData()));
    }

    async saveSettings() {
        await this.saveData(get(data));
    }

    async onload() {
        plugin.set(this);
        const t = get(_);
        await this.loadSettings();
        this.s2b = new SmartSecondBrain(this.app, this.manifest.dir);
        Log.setLogLevel(get(data).isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);

        this.app.workspace.onLayoutReady(() => {
            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT) || this.app.workspace.getLeavesOfType(VIEW_TYPE_SETUP);
            if (leaves.length) this.leaf = leaves[0];
            if (get(data).isOnboarded && get(data).isAutostart) this.s2b.init();
        });
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                if (!this.leaf) {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT) || this.app.workspace.getLeavesOfType(VIEW_TYPE_SETUP);
                    if (!leaves.length) return;
                    this.leaf = leaves[0];
                }
                const isInSidebar = [this.app.workspace.leftSplit, this.app.workspace.rightSplit].includes(this.leaf.getRoot() as WorkspaceSidedock);
                isChatInSidebar.set(isInSidebar);
            })
        );
        this.registerEvent(this.app.metadataCache.on('changed', async (file: TFile) => this.s2b.onFileChange(file)));
        this.registerEvent(this.app.vault.on('delete', async (file: TFile) => this.s2b.onFileDelete(file)));
        this.registerEvent(this.app.vault.on('rename', async (file: TFile, oldPath: string) => this.s2b.onFileRename(file, oldPath)));

        // periodically or on unfocus save vector store data to disk
        window.addEventListener('blur', () => this.s2b.saveVectorStoreData());

        const resetAutoSaveTimer = () => {
            window.clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = window.setTimeout(() => this.s2b.saveVectorStoreData(), 30 * 1000);
        };
        // listen for any event to reset the timer
        window.addEventListener('mousemove', () => resetAutoSaveTimer());
        window.addEventListener('mousedown', () => resetAutoSaveTimer());
        window.addEventListener('keypress', () => resetAutoSaveTimer());
        window.addEventListener('scroll', () => resetAutoSaveTimer());

        if (!this.s2b) {
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);
        }

        this.registerView(VIEW_TYPE_SETUP, (leaf) => {
            this.setupView = new SetupView(leaf);
            return this.setupView;
        });

        this.registerView(VIEW_TYPE_CHAT, (leaf) => {
            this.chatView = new ChatView(leaf);
            return this.chatView;
        });

        this.addRibbonIcon('message-square', t('ribbon.chat'), () => this.activateView());

        this.addCommand({ id: 'open-chat', name: t('cmd.chat'), icon: 'message-square', callback: () => this.activateView() });

        this.addCommand({ id: 'pull-model', name: t('cmd.pull_model'), icon: 'arrow-down-to-line', callback: () => new PullModal(this.app).open() });

        this.addCommand({ id: 'remove-model', name: t('cmd.remove_model'), icon: 'trash', callback: () => new RemoveModal(this.app).open() });

        this.addSettingTab(new SettingsTab(this.app, this));

        this.registerMonkeyPatches();
    }

    async onunload() {
        Log.info('Unloading plugin');
    }

    async activateView(file?: TFile) {
        const d = get(data);
        if (!d.isOnboarded) {
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);
            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SETUP);
            this.leaf = leaves.length ? leaves[0] : this.app.workspace.getRightLeaf(false);
            await this.leaf.setViewState({ type: VIEW_TYPE_SETUP, active: true });
        } else {
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_SETUP);
            if (!file) {
                // If no file is provided, open the default chat
                const chatDirExists = await this.app.vault.adapter.exists(normalizePath(d.targetFolder));
                if (!chatDirExists) {
                    await this.app.vault.createFolder(normalizePath(d.targetFolder));
                }
                const defaultChatExists = await this.app.vault.adapter.exists(normalizePath(d.targetFolder + '/' + d.defaultChatName + '.md'));
                file = defaultChatExists
                    ? this.app.metadataCache.getFirstLinkpathDest(d.targetFolder + '/' + d.defaultChatName + '.md', '')
                    : await this.app.vault.create(
                          normalizePath(d.targetFolder + '/' + d.defaultChatName + '.md'),
                          'Assistant\n' + d.initialAssistantMessageContent + '\n- - - - -'
                      );
            }
            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
            this.leaf = leaves.length ? leaves[0] : this.app.workspace.getRightLeaf(false);
            this.isChatAcivatedFromRibbon = true;
            await this.leaf.openFile(file, { active: true });
            await this.leaf.setViewState({
                type: VIEW_TYPE_CHAT,
                state: { file: file.path },
            });
        }
        this.app.workspace.revealLeaf(this.leaf);
    }

    async saveChat() {
        const d = get(data);
        let fileName = await this.s2b.createFilenameForChat();
        let normalizedFilePath = normalizePath(d.targetFolder + '/' + fileName + '.md');
        while (await this.app.vault.adapter.exists(normalizedFilePath)) {
            //Checks if already existing file has a number at the end
            const regex = /\((\d+)\)$/;
            const match = fileName.match(regex);
            if (match) {
                fileName = fileName.slice(0, -3) + '(' + (parseInt(match[1], 10) + 1) + ')';
            } else {
                fileName = fileName + ' (1)';
            }
            normalizedFilePath = normalizePath(d.targetFolder + '/' + fileName + '.md');
        }
        const newChatFile = await this.app.vault.copy(this.chatView.file, normalizedFilePath);
        chatHistory.reset;
        await this.activateView(newChatFile);
    }

    async clearPluginData() {
        const t = get(_);
        new ConfirmModal(
            get(plugin).app,
            t('settings.clear_modal.title'),
            t('settings.clear_modal.description'),
            async (result) => {
                if (result === 'Yes') {
                    await this.saveData({});
                    const files = (await this.app.vault.adapter.list(normalizePath(this.manifest.dir + '/vectorstores'))).files;
                    for (const file of files) await this.app.vault.adapter.remove(file);
                    new Notice(t('notice.plugin_data_cleared'), 4000);
                    await this.loadSettings();
                    await this.activateView();
                }
            },
            ''
        ).activate();
    }

    registerMonkeyPatches() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        // Monkey patch WorkspaceLeaf to open Chats with ChatView by default
        this.register(
            around(WorkspaceLeaf.prototype, {
                setViewState(next) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return function (state: ViewState, ...rest: any[]) {
                        if (
                            // If we have a markdown file
                            state.type === 'markdown' &&
                            state.state?.file
                        ) {
                            // Then check for the chat frontMatterKey
                            // const cache = self.app.metadataCache.getCache(state.state.file);

                            // if (cache?.frontmatter && cache.frontmatter['second-brain-chat']) {
                            if (state.state.file.startsWith(get(data).targetFolder)) {
                                // If we have it, force the view type to be chat
                                const newState = {
                                    ...state,
                                    type: VIEW_TYPE_CHAT,
                                };
                                if (!self.isChatAcivatedFromRibbon) {
                                    const leaves = self.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
                                    self.leaf = leaves.length ? leaves[0] : self.app.workspace.getRightLeaf(false);
                                }
                                return next.apply(self.leaf, [newState, ...rest]);
                            }
                        }

                        return next.apply(this, [state, ...rest]);
                    };
                },
            })
        );
    }
}
