import { around } from 'monkey-around';
import { nanoid } from 'nanoid';
import { Notice, Plugin, TFile, WorkspaceLeaf, normalizePath, type ViewState, WorkspaceSidedock } from 'obsidian';
import {
    Papa,
    Prompts,
    obsidianDocumentLoader,
    type Language,
    type OllamaEmbedModel,
    type OllamaGenModel,
    type OpenAIEmbedModel,
    type OpenAIGenModel,
    LogLvl,
} from 'papa-ts';
import { get } from 'svelte/store';
import { serializeChatHistory, chatHistory, plugin, isOnboarded, isIncognitoMode, papaState, papaIndexingProgress, isChatInSidebar } from './store';
import './styles.css';
import { ChatView, VIEW_TYPE_CHAT } from './views/Chat';
import SettingsTab from './views/Settings';
import { isOllamaRunning } from './controller/Ollama';
import { isAPIKeyValid } from './controller/OpenAI';
import { SetupView, VIEW_TYPE_SETUP } from './views/Onboarding';
import { wildTest } from './components/Settings/FuzzyModal';
import './lang/i18n';
import Log from './logging';

interface PluginData {
    isChatComfy: boolean;
    initialAssistantMessage: string;
    isUsingRag: boolean;
    assistantLanguage: Language;
    isIncognitoMode: boolean;
    ollamaGenModel: OllamaGenModel;
    ollamaEmbedModel: OllamaEmbedModel;
    openAIGenModel: OpenAIGenModel;
    openAIEmbedModel: OpenAIEmbedModel;
    targetFolder: string;
    excludeFF: Array<string>;
    defaultChatName: string;
    docRetrieveNum: number;
    debugginLangchainKey: string;
    isQuickSettingsOpen: boolean;
    isVerbose: boolean;
    isOnboarded: boolean;
}

export const DEFAULT_SETTINGS: Partial<PluginData> = {
    isChatComfy: true,
    isUsingRag: true,
    assistantLanguage: (window.localStorage.getItem('language') as Language) || 'en',
    initialAssistantMessage: Prompts[(window.localStorage.getItem('language') as Language) || 'en'].initialAssistantMessage,
    isIncognitoMode: false,
    ollamaGenModel: { model: 'llama2', baseUrl: 'http://localhost:11434' },
    ollamaEmbedModel: { model: 'nomic-embed-text', baseUrl: 'http://localhost:11434', similarityThreshold: 0.75 },
    openAIGenModel: {
        model: 'gpt-3.5-turbo',
        openAIApiKey: '',
    },
    openAIEmbedModel: {
        model: 'text-embedding-ada-002',
        openAIApiKey: '',
        similarityThreshold: 0.75,
    },
    targetFolder: 'Chats',
    defaultChatName: 'New Chat',
    excludeFF: ['Chats', '*.excalidraw.md'],
    docRetrieveNum: 5,
    isQuickSettingsOpen: true,
    isVerbose: false,
    isOnboarded: false,
};

export default class SecondBrainPlugin extends Plugin {
    data: PluginData;
    setupView: SetupView;
    chatView: ChatView;
    secondBrain: Papa;
    leaf: WorkspaceLeaf;
    private needsToSaveVectorStoreData = false;
    private autoSaveTimer: number;
    private isChatAcivatedFromRibbon = false; // workaround for a bug where the chat view is activated twice through monkey patching

    async loadSettings() {
        this.data = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        isIncognitoMode.set(this.data.isIncognitoMode);
        isOnboarded.set(this.data.isOnboarded);
    }

    async saveSettings() {
        await this.saveData(this.data);
    }

    private getVectorStorePath() {
        return normalizePath(
            this.manifest.dir + '/' + (this.data.isIncognitoMode ? this.data.ollamaEmbedModel.model : this.data.openAIEmbedModel.model) + '-vector-store.bin'
        );
    }

    async saveVectorStoreData() {
        if (this.needsToSaveVectorStoreData && this.secondBrain) {
            Log.debug('Saving vector store data');
            this.needsToSaveVectorStoreData = false;
            await this.app.vault.adapter.writeBinary(this.getVectorStorePath(), await this.secondBrain.getData());
            Log.info('Saved vector store data');
        }
    }

    async initPapa() {
        if (get(papaState) === 'running') return new Notice('Smart Second Brain is still running.', 4000);
        else if (get(papaState) === 'indexing' || get(papaState) === 'indexing-pause' || get(papaState) === 'loading') {
            return new Notice('Please wait for the indexing to finish', 4000);
        } else if (this.data.isIncognitoMode && !(await isOllamaRunning())) {
            papaState.set('error');
            return new Notice('Please make sure Ollama is running before initializing Smart Second Brain.', 4000);
        } else if (!this.data.isIncognitoMode && !(await isAPIKeyValid())) {
            papaState.set('error');
            return new Notice('Please make sure OpenAI API Key is valid before initializing Smart Second Brain.', 4000);
        }

        papaState.set('loading');
        Log.info(
            'Initializing second brain',
            '\nGen Model: ',
            this.data.isIncognitoMode ? this.data.ollamaGenModel : this.data.openAIGenModel,
            '\nEmbed Model: ',
            this.data.isIncognitoMode ? this.data.ollamaEmbedModel : this.data.openAIEmbedModel
        );
        this.secondBrain = new Papa({
            genModel: this.data.isIncognitoMode ? this.data.ollamaGenModel : this.data.openAIGenModel,
            embedModel: this.data.isIncognitoMode ? this.data.ollamaEmbedModel : this.data.openAIEmbedModel,
            langsmithApiKey: this.data.debugginLangchainKey || undefined,
            logLvl: this.data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED,
        });
        // check if vector store data exists
        if (await this.app.vault.adapter.exists(this.getVectorStorePath())) {
            const vectorStoreData = await this.app.vault.adapter.readBinary(this.getVectorStorePath());
            await this.secondBrain.load(vectorStoreData);
        }
        const mdFiles = this.app.vault.getMarkdownFiles();
        const docs = await obsidianDocumentLoader(
            this.app,
            mdFiles.filter((mdFile: TFile) => {
                for (const exclude of this.data.excludeFF) if (wildTest(exclude, mdFile.path)) return false;
                return true;
            })
        );
        papaState.set('indexing');
        // const embedNotice = new Notice('Indexing notes into your smart second brain...', 0);
        let needsSave = false;
        try {
            for await (const result of this.secondBrain.embedDocuments(docs)) {
                // embedNotice.setMessage(
                //     `Indexing notes into your smart second brain... Added: ${result.numAdded}, Skipped: ${result.numSkipped}, Deleted: ${result.numDeleted}`
                // );
                needsSave = (!this.needsToSaveVectorStoreData && result.numAdded > 0) || result.numDeleted > 0;
                const progress = ((result.numAdded + result.numSkipped) / docs.length) * 100;
                papaIndexingProgress.set(Math.max(progress, get(papaIndexingProgress)));
                // pause indexing on "indexing-stopped" state
                if (get(papaState) === 'indexing-pause') break;
            }
            // embedNotice.hide();
        } catch (e) {
            Log.error(e);
            papaState.set('error');
            new Notice('Failed to index notes into your smart second brain. Please retry.', 4000);
        }
        this.needsToSaveVectorStoreData = needsSave;
        this.saveVectorStoreData();
        if (get(papaIndexingProgress) === 100) {
            new Notice('Smart Second Brain initialized.', 2000);
            papaIndexingProgress.set(0);
            papaState.set('idle');
        }
    }

    async onload() {
        await this.loadSettings();
        plugin.set(this);
        Log.setLogLevel(this.data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);

        this.app.workspace.onLayoutReady(() => this.initPapa());
        // reembed documents on change
        this.registerEvent(
            this.app.metadataCache.on('changed', async (file: TFile) => {
                if (!this.secondBrain) return;
                for (const exclude of this.data.excludeFF) if (wildTest(exclude, file.path)) return;
                const docs = await obsidianDocumentLoader(this.app, [file]);
                this.secondBrain.embedDocuments(docs, 'byFile');
                this.needsToSaveVectorStoreData = true;
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', async (file: TFile) => {
                if (!this.secondBrain) return;
                for (const exclude of this.data.excludeFF) if (wildTest(exclude, file.path)) return;
                const docs = await obsidianDocumentLoader(this.app, [file]);
                this.secondBrain.deleteDocuments({ docs });
                this.needsToSaveVectorStoreData = true;
            })
        );
        this.registerEvent(
            this.app.vault.on('rename', async (file: TFile, oldPath: string) => {
                if (!this.secondBrain) return;
                for (const exclude of this.data.excludeFF) if (wildTest(exclude, file.path)) return;
                await this.secondBrain.deleteDocuments({ sources: [oldPath] });
                const docs = await obsidianDocumentLoader(this.app, [file]);
                this.secondBrain.embedDocuments(docs, 'byFile');
                this.needsToSaveVectorStoreData = true;
            })
        );

        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                if (!this.leaf) {
                    const leaves = this.app.workspace.getLeavesOfType(get(isOnboarded) ? VIEW_TYPE_CHAT : VIEW_TYPE_SETUP);
                    if (!leaves.length) return;
                    this.leaf = leaves[0];
                }
                const isInSidebar = [this.app.workspace.leftSplit, this.app.workspace.rightSplit].includes(this.leaf.getRoot() as WorkspaceSidedock);
                isChatInSidebar.set(isInSidebar);
            })
        );

        // periodically or on unfocus save vector store data to disk
        window.addEventListener('blur', () => this.saveVectorStoreData());

        const resetAutoSaveTimer = () => {
            window.clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = window.setTimeout(() => this.saveVectorStoreData(), 30 * 1000);
        };
        // listen for any event to reset the timer
        window.addEventListener('mousemove', () => resetAutoSaveTimer());
        window.addEventListener('mousedown', () => resetAutoSaveTimer());
        window.addEventListener('keypress', () => resetAutoSaveTimer());
        window.addEventListener('scroll', () => resetAutoSaveTimer());

        if (!this.secondBrain) {
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

        this.addRibbonIcon('brain-circuit', 'Smart Second Brain', () => this.activateView());

        this.addSettingTab(new SettingsTab(this.app, this));

        this.registerMonkeyPatches();
    }

    async onunload() {
        Log.info('Unloading plugin');
    }

    async activateView(file?: TFile) {
        if (!get(isOnboarded)) {
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);
            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SETUP);
            this.leaf = leaves.length ? leaves[0] : this.app.workspace.getRightLeaf(false);
            await this.leaf.setViewState({ type: VIEW_TYPE_SETUP, active: true });
        } else {
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_SETUP);
            if (!file) {
                // If no file is provided, open the default chat
                const chatDirExists = await this.app.vault.adapter.exists(normalizePath(this.data.targetFolder));
                if (!chatDirExists) {
                    await this.app.vault.createFolder(normalizePath(this.data.targetFolder));
                }
                const defaultChatExists = await this.app.vault.adapter.exists(normalizePath(this.data.targetFolder + '/' + this.data.defaultChatName + '.md'));
                file = defaultChatExists
                    ? this.app.metadataCache.getFirstLinkpathDest(this.data.targetFolder + '/' + this.data.defaultChatName + '.md', '')
                    : await this.app.vault.create(
                          normalizePath(this.data.targetFolder + '/' + this.data.defaultChatName + '.md'),
                          'Assistant\n' + this.data.initialAssistantMessage + '\n- - - - -'
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
        let fileName = await this.secondBrain.createTitleFromChatHistory(this.data.assistantLanguage, serializeChatHistory(get(chatHistory)));
        // File name cannot contain any of the following characters: \/:
        fileName = fileName.replace(/[\\/:]/g, '');

        let normalizedFilePath = normalizePath(this.data.targetFolder + '/' + fileName + '.md');
        while (await this.app.vault.adapter.exists(normalizedFilePath)) {
            //Checks if already existing file has a number at the end
            const regex = /\((\d+)\)$/;
            const match = fileName.match(regex);
            if (match) {
                fileName = fileName.slice(0, -3) + '(' + (parseInt(match[1], 10) + 1) + ')';
            } else {
                fileName = fileName + ' (1)';
            }
            normalizedFilePath = normalizePath(this.data.targetFolder + '/' + fileName + '.md');
        }
        const newChatFile = await this.app.vault.copy(this.chatView.file, normalizedFilePath);
        // delete default chat history (TODO redundant with delete chat button in input.svelte)
        chatHistory.set([
            {
                role: 'Assistant',
                content: this.data.initialAssistantMessage,
                id: nanoid(),
            },
        ]);
        await this.chatView.save();
        await this.activateView(newChatFile);
    }

    async clearPluginData() {
        await this.saveData({});
        const files = (await this.app.vault.adapter.list(normalizePath(this.manifest.dir))).files;
        for (const file of files) {
            if (file.endsWith('vector-store.bin')) await this.app.vault.adapter.remove(file);
        }
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
                            if (state.state.file.startsWith(self.data.targetFolder)) {
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
