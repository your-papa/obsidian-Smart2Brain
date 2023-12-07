import './styles.css';
import { ChatModal } from './views/ChatModal';
import { ChatView, VIEW_TYPE_CHAT, DEFAULT_DATA } from './views/ChatView';
import SettingsTab from './views/Settings';
import { FuzzySuggestModal, TFile, App, Plugin, WorkspaceLeaf, normalizePath } from 'obsidian';
import { SecondBrain, obsidianDocumentLoader, type SecondBrainData } from 'second-brain-ts';
import { plugin, secondBrain } from './store';

interface PluginData {
    llm: string;
    embeddedAllOnce: boolean;
    secondBrain: SecondBrainData;
    targetFolder: string;
}

export const DEFAULT_SETTINGS: Partial<PluginData> = {
    secondBrain: {
        openAIApiKey: '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', // TODO: remove
    },
    targetFolder: 'Chats',
};

export default class BrainPlugin extends Plugin {
    data: PluginData;
    chatView: ChatView;

    async loadSettings() {
        this.data = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.data);
    }

    async onload() {
        await this.loadSettings();
        plugin.set(this);
        secondBrain.set(SecondBrain.loadFromData(this.data.secondBrain));

        if (!this.data.embeddedAllOnce) {
            setTimeout(() => {
                secondBrain.subscribe(async (secondBrain) => {
                    const files = this.app.vault.getMarkdownFiles();
                    const docs = await obsidianDocumentLoader(
                        this.app,
                        files.filter((file) => !file.path.startsWith(this.data.targetFolder))
                    );
                    await secondBrain.embedDocuments(docs);
                    this.data.secondBrain.vectorStoreJson = await secondBrain.getVectorStoreJson();
                    this.data.embeddedAllOnce = true;
                    await this.saveSettings();
                });
            }, 1000);
        }

        this.app.vault.on('modify', (file: TFile) => {
            setTimeout(async () => {
                if (file.path.startsWith(this.data.targetFolder)) return; // don't embed chat files
                secondBrain.subscribe(async (secondBrain) => {
                    const docs = await obsidianDocumentLoader(this.app, [file]);
                    await secondBrain.embedDocuments(docs);
                    this.data.secondBrain.vectorStoreJson = await secondBrain.getVectorStoreJson();
                    await this.saveSettings();
                });
            }, 1000);
        });
        this.app.vault.on('delete', (file: TFile) => {
            secondBrain.subscribe(async (secondBrain) => {
                if (file.path.startsWith(this.data.targetFolder)) return; // don't embed chat files
                const docs = await obsidianDocumentLoader(this.app, [file]);
                await secondBrain.removeDocuments(docs);
                this.data.secondBrain.vectorStoreJson = await secondBrain.getVectorStoreJson();
                await this.saveSettings();
            });
        });

        this.registerView(VIEW_TYPE_CHAT, (leaf) => {
            this.chatView = new ChatView(leaf);
            return this.chatView;
        });

        this.addRibbonIcon('brain-circuit', 'Smart Second Brain', () => {
            this.activateView();
        });

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
    }

    onunload() {
        console.log('unloading plugin');
    }

    async activateView() {
        let leaf: WorkspaceLeaf;
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
        if (leaves.length) {
            leaf = leaves[0];
        } else {
            leaf = this.app.workspace.getRightLeaf(false);
            const chatDirExists = await this.app.vault.adapter.exists(normalizePath(this.data.targetFolder));
            if (!chatDirExists) {
                await this.app.vault.createFolder(normalizePath(this.data.targetFolder));
            }
            const defaultChatExists = await this.app.vault.adapter.exists(normalizePath(this.data.targetFolder + '/Chat Second Brain.md'));
            const file = defaultChatExists
                ? this.app.metadataCache.getFirstLinkpathDest(this.data.targetFolder + '/Chat Second Brain.md', '')
                : await this.app.vault.create(normalizePath(this.data.targetFolder + '/Chat Second Brain.md'), DEFAULT_DATA);
            await leaf.openFile(file, { active: true });
            await leaf.setViewState({
                type: VIEW_TYPE_CHAT,
                state: { file: file.path },
            });
        }
        this.app.workspace.revealLeaf(leaf);
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
