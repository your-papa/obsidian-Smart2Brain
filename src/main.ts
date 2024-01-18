import { App, FuzzySuggestModal, Plugin, TFile, WorkspaceLeaf, normalizePath, type ViewState } from 'obsidian';
import { Papa, obsidianDocumentLoader, type Language, type OllamaGenModel, type OpenAIEmbedModel, type OpenAIGenModel } from 'papa-ts';
import { get } from 'svelte/store';
import { INITIAL_ASSISTANT_MESSAGE } from './ChatMessages';
import { around } from 'monkey-around';
import { serializeChatHistory, chatHistory, plugin } from './store';
import './styles.css';
import { ChatModal } from './views/ChatModal';
import { ChatView, VIEW_TYPE_CHAT } from './views/ChatView';
import SettingsTab from './views/Settings';

interface PluginData {
    isChat: boolean;
    initialAssistantMessage: string;
    isUsingRag: boolean;
    assistantLanguage: Language;
    genModelToggle: boolean; // 0 = ollama, 1 = openai
    ollamaGenModel: OllamaGenModel;
    openAIGenModel: OpenAIGenModel;
    openAIEmbedModel: OpenAIEmbedModel;
    fromBackup: boolean;
    targetFolder: string;
    excludeFF: Array<string>;
    defaultChatName: string;
}

export const DEFAULT_SETTINGS: Partial<PluginData> = {
    isChat: true,
    isUsingRag: true,
    assistantLanguage: (window.localStorage.getItem('language') as Language) || 'en',
    initialAssistantMessage: INITIAL_ASSISTANT_MESSAGE.get(window.localStorage.getItem('language') || 'en'),
    genModelToggle: true,
    ollamaGenModel: { model: 'llama2', baseUrl: 'http://localhost:11434' },
    openAIGenModel: { modelName: 'gpt-3.5-turbo', openAIApiKey: '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' }, // TODO: remove openAIApiKey
    openAIEmbedModel: { modelName: 'text-embedding-ada-002', openAIApiKey: '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' }, // TODO: remove openAIApiKey
    targetFolder: 'Chats',
    fromBackup: false,
    defaultChatName: 'Chat Second Brain',
    excludeFF: ['Chats'],
};

export default class SecondBrainPlugin extends Plugin {
    data: PluginData;
    chatView: ChatView;
    secondBrain: Papa;
    leaf: WorkspaceLeaf;

    async loadSettings() {
        this.data = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.data);
    }

    async initSecondBrain(fromBackup = true) {
        const vectorStoreDataPath = normalizePath('.obsidian/plugins/smart-second-brain/vector-store-data.json');
        this.secondBrain = new Papa({
            genModel: this.data.genModelToggle ? this.data.openAIGenModel : this.data.ollamaGenModel,
            embedModel: this.data.openAIEmbedModel,
            saveHandler: async (vectorStoreJson: string) => await this.app.vault.adapter.write(vectorStoreDataPath, vectorStoreJson),
        });

        if (fromBackup) {
            setTimeout(async () => {
                const vectorStoreData = await this.app.vault.adapter.read(vectorStoreDataPath);
                this.secondBrain.load(vectorStoreData);
            }, 1000);
            return;
        }
        setTimeout(async () => {
            const mdFiles = this.app.vault.getMarkdownFiles();
            const docs = await obsidianDocumentLoader(
                this.app,
                mdFiles.filter((mdFile) => {
                    for (const exclude of this.data.excludeFF) return !mdFile.path.startsWith(exclude);
                })
            );
            await this.secondBrain.embedDocuments(docs);
        }, 1000);
    }

    async onload() {
        await this.loadSettings();
        plugin.set(this);

        await this.initSecondBrain(this.data.fromBackup);
        this.data.fromBackup = true;
        await this.saveSettings();

        this.app.vault.on('modify', (file: TFile) => {
            setTimeout(async () => {
                for (const exclude of this.data.excludeFF) if (file.path.startsWith(exclude)) return; // don't embed those files
                // const docs = await obsidianDocumentLoader(this.app, [file]);
                const mdFiles = this.app.vault.getMarkdownFiles();
                const docs = await obsidianDocumentLoader(
                    this.app,
                    mdFiles.filter((mdFile) => !mdFile.path.startsWith(this.data.targetFolder))
                );
                await this.secondBrain.embedDocuments(docs);
            }, 1000);
        });
        this.app.vault.on('delete', async (file: TFile) => {
            for (const exclude of this.data.excludeFF) if (file.path.startsWith(exclude)) return; // don't embed those files
            if (file.path.startsWith(this.data.targetFolder)) return; // don't embed chat files
            // const docs = await obsidianDocumentLoader(this.app, [file]);
            const mdFiles = this.app.vault.getMarkdownFiles();
            const docs = await obsidianDocumentLoader(
                this.app,
                mdFiles.filter((mdFile) => !mdFile.path.startsWith(this.data.targetFolder))
            );
            await this.secondBrain.embedDocuments(docs);
        });

        this.app.vault.on('rename', async (file: TFile) => {
            setTimeout(async () => {
                for (const exclude in this.data.excludeFF) if (file.path.startsWith(exclude)) return; // don't embed those files
                // const docs = await obsidianDocumentLoader(this.app, [file]);
                const mdFiles = this.app.vault.getMarkdownFiles();
                const docs = await obsidianDocumentLoader(
                    this.app,
                    mdFiles.filter((mdFile) => !mdFile.path.startsWith(this.data.targetFolder))
                );
                await this.secondBrain.embedDocuments(docs);
            }, 1000);
        });

        this.registerView(VIEW_TYPE_CHAT, (leaf) => {
            this.chatView = new ChatView(leaf);
            return this.chatView;
        });

        this.addRibbonIcon('brain-circuit', 'Smart Second Brain', () => this.activateView());

        this.addSettingTab(new SettingsTab(this.app, this));

        this.addCommand({
            id: 'chat-modal',
            name: 'Chat with AI',
            callback: () => {
                new ChatModal(this.app).open();
            },
        });

        this.addCommand({
            id: 'find-files',
            name: 'ff',
            callback: () => {
                new FileSelectModal(this.app).open();
            },
        });

        this.registerMonkeyPatches();
    }

    onunload() {
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
            const chatDirExists = await this.app.vault.adapter.exists(normalizePath(this.data.targetFolder));
            if (!chatDirExists) {
                await this.app.vault.createFolder(normalizePath(this.data.targetFolder));
            }
            const defaultChatExists = await this.app.vault.adapter.exists(normalizePath(this.data.targetFolder + '/' + this.data.defaultChatName + '.md'));
            file = defaultChatExists
                ? this.app.metadataCache.getFirstLinkpathDest(this.data.targetFolder + '/' + this.data.defaultChatName + '.md', '')
                : await this.app.vault.create(
                      normalizePath(this.data.targetFolder + '/' + this.data.defaultChatName + '.md'),
                      this.data.initialAssistantMessage
                  );
            await this.leaf.openFile(file, { active: true });
            await this.leaf.setViewState({
                type: VIEW_TYPE_CHAT,
                state: { file: file.path },
            });
        }
        await this.leaf.openFile(file, { active: true });
        await this.leaf.setViewState({
            type: VIEW_TYPE_CHAT,
            state: { file: file.path },
        });
        await this.app.workspace.revealLeaf(this.leaf);
    }

    async saveChatHistory() {
        const fileName = await this.secondBrain.createTitleFromChatHistory(this.data.assistantLanguage, serializeChatHistory(get(chatHistory)));
        const newChatFile = await this.app.vault.copy(this.chatView.file, normalizePath(this.data.targetFolder + '/' + fileName + '.md'));
        // TODO handle if file already exists
        await this.activateView(newChatFile);
    }

    registerMonkeyPatches() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        // Monkey patch WorkspaceLeaf to open Kanbans with KanbanView by default
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
                            // Then check for the kanban frontMatterKey
                            // const cache = self.app.metadataCache.getCache(state.state.file);

                            // if (cache?.frontmatter && cache.frontmatter['second-brain-chat']) {
                            if (state.state.file.startsWith(self.data.targetFolder)) {
                                // If we have it, force the view type to kanban
                                const newState = {
                                    ...state,
                                    type: VIEW_TYPE_CHAT,
                                };

                                return next.apply(this, [newState, ...rest]);
                            }
                        }

                        return next.apply(this, [state, ...rest]);
                    };
                },
            })
        );
    }
}

export class FileSelectModal extends FuzzySuggestModal<TFile> {
    constructor(app: App) {
        super(app);
        this.app = app;
        this.setPlaceholder('Type the name of a file...');
    }
    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles().sort((a, b) => a.basename.localeCompare(b.basename));
    }
    getItemText(item: TFile): string {
        return item.basename;
    }
    onChooseItem(file: TFile) {
        const elem = document.getElementById('chat-view-user-input-element') as HTMLInputElement;
        elem.value = elem.value + `[${file.basename}]]`;
    }
}
