import { Plugin, TFile, WorkspaceLeaf, normalizePath, type ViewState } from 'obsidian';
import {
    Papa,
    obsidianDocumentLoader,
    type Language,
    type OllamaGenModel,
    type OllamaEmbedModel,
    type OpenAIEmbedModel,
    type OpenAIGenModel,
    Prompts,
} from 'papa-ts';
import { get } from 'svelte/store';
import { around } from 'monkey-around';
import { serializeChatHistory, chatHistory, plugin, isIncognitoMode } from './store';
import './styles.css';
import { ChatView, VIEW_TYPE_CHAT } from './views/Chat';
import SettingsTab from './views/Settings';
import { isOllamaRunning } from './controller/Ollama';
import { isAPIKeyValid } from './controller/OpenAI';
import './lang/i18n';
import { nanoid } from 'nanoid';

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
}

export const DEFAULT_SETTINGS: Partial<PluginData> = {
    isChatComfy: true,
    isUsingRag: true,
    assistantLanguage: (window.localStorage.getItem('language') as Language) || 'en',
    initialAssistantMessage: Prompts[(window.localStorage.getItem('language') as Language) || 'en'].initialAssistantMessage,
    isIncognitoMode: false,
    ollamaGenModel: { model: 'llama2', baseUrl: 'http://localhost:11434' },
    ollamaEmbedModel: { model: 'llama2', baseUrl: 'http://localhost:11434' },
    openAIGenModel: {
        modelName: 'gpt-3.5-turbo',
        openAIApiKey: '',
    },
    openAIEmbedModel: {
        modelName: 'text-embedding-ada-002',
        openAIApiKey: '',
    },
    targetFolder: 'Chats',
    defaultChatName: 'New Chat',
    excludeFF: ['Chats'],
    docRetrieveNum: 5,
    isQuickSettingsOpen: true,
};

export default class SecondBrainPlugin extends Plugin {
    data: PluginData;
    chatView: ChatView;
    secondBrain: Papa;
    leaf: WorkspaceLeaf;
    private needsToSaveVectorStoreData = false;
    private autoSaveTimer: NodeJS.Timeout;

    async loadSettings() {
        this.data = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        isIncognitoMode.set(this.data.isIncognitoMode);
    }

    async saveSettings() {
        await this.saveData(this.data);
    }

    private getVectorStorePath() {
        return normalizePath(
            this.app.vault.configDir +
                '/plugins/smart-second-brain/' +
                (this.data.isIncognitoMode ? this.data.ollamaEmbedModel.model : this.data.openAIEmbedModel.modelName) +
                '-vector-store.bin'
        );
    }

    async saveVectorStoreData() {
        if (this.needsToSaveVectorStoreData) {
            console.log('saving vector store data');
            this.needsToSaveVectorStoreData = false;
            await this.app.vault.adapter.writeBinary(this.getVectorStorePath(), await this.secondBrain.getData());
            console.log('saved vector store data');
        }
    }

    async initSecondBrain() {
        console.log(
            'Initializing second brain',
            '\nGen Model: ' + (this.data.isIncognitoMode ? this.data.ollamaGenModel.model : this.data.openAIGenModel.modelName),
            '\nEmbed Model: ' + (this.data.isIncognitoMode ? this.data.ollamaEmbedModel.model : this.data.openAIEmbedModel.modelName)
        );
        this.secondBrain = new Papa({
            genModel: this.data.isIncognitoMode ? this.data.ollamaGenModel : this.data.openAIGenModel,
            embedModel: this.data.isIncognitoMode ? this.data.ollamaEmbedModel : this.data.openAIEmbedModel,
            langsmithApiKey: this.data.debugginLangchainKey || undefined,
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
                for (const exclude of this.data.excludeFF) if (mdFile.path.startsWith(exclude)) return false;
                return true;
            })
        );
        const result = await this.secondBrain.embedDocuments(docs);
        if (result.numAdded > 0 || result.numDeleted > 0) this.needsToSaveVectorStoreData = true;
        this.saveVectorStoreData();
    }

    async onload() {
        await this.loadSettings();
        plugin.set(this);

        this.app.workspace.onLayoutReady(async () => {
            if (!((this.data.isIncognitoMode && (await isOllamaRunning())) || (!this.data.isIncognitoMode && (await isAPIKeyValid())))) return;

            await this.initSecondBrain();

            // reembed documents on change
            this.app.metadataCache.on('changed', async (file: TFile) => {
                for (const exclude of this.data.excludeFF) if (file.path.startsWith(exclude)) return;
                const docs = await obsidianDocumentLoader(this.app, [file]);
                await this.secondBrain.embedDocuments(docs, 'byFile');
                this.needsToSaveVectorStoreData = true;
            });
            this.registerEvent(
                this.app.vault.on('delete', async (file: TFile) => {
                    for (const exclude of this.data.excludeFF) if (file.path.startsWith(exclude)) return;
                    const docs = await obsidianDocumentLoader(this.app, [file]);
                    await this.secondBrain.deleteDocuments({ docs });
                    this.needsToSaveVectorStoreData = true;
                })
            );
            this.registerEvent(
                this.app.vault.on('rename', async (file: TFile, oldPath: string) => {
                    for (const exclude of this.data.excludeFF) if (file.path.startsWith(exclude)) return;
                    await this.secondBrain.deleteDocuments({ sources: [oldPath] });
                    const docs = await obsidianDocumentLoader(this.app, [file]);
                    await this.secondBrain.embedDocuments(docs, 'byFile');
                    this.needsToSaveVectorStoreData = true;
                })
            );

            // periodically or on unfocus save vector store data to disk
            window.addEventListener('blur', () => this.saveVectorStoreData());

            const resetAutoSaveTimer = () => {
                clearTimeout(this.autoSaveTimer);
                this.autoSaveTimer = setTimeout(() => this.saveVectorStoreData(), 30 * 1000);
            };
            // listen for any event to reset the timer
            window.addEventListener('mousemove', () => resetAutoSaveTimer());
            window.addEventListener('mousedown', () => resetAutoSaveTimer());
            window.addEventListener('keypress', () => resetAutoSaveTimer());
            window.addEventListener('scroll', () => resetAutoSaveTimer());
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
        console.log('unloading plugin');
    }

    async activateView(file?: TFile) {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
        if (leaves.length) {
            this.leaf = leaves[0];
        } else {
            this.leaf = this.app.workspace.getRightLeaf(false);
        }
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
        await this.leaf.openFile(file, { active: true });
        await this.leaf.setViewState({
            type: VIEW_TYPE_CHAT,
            state: { file: file.path },
        });
        this.app.workspace.revealLeaf(this.leaf);
    }

    async saveChat() {
        let fileName = await this.secondBrain.createTitleFromChatHistory(this.data.assistantLanguage, serializeChatHistory(get(chatHistory)));
        // File name cannot contain any of the following characters: \ / :
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
                                const leaves = self.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
                                if (leaves.length) {
                                    self.leaf = leaves[0];
                                } else {
                                    self.leaf = self.app.workspace.getRightLeaf(false);
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
