import './styles.css';
import { ChatModal } from './views/ChatModal';
import { ChatView, VIEW_TYPE_CHAT, DEFAULT_DATA } from './views/ChatView';
import SettingsTab from './views/Settings';
import { FuzzySuggestModal, TFile, App, Plugin, WorkspaceLeaf, normalizePath } from 'obsidian';
import { SecondBrain, obsidianDocumentLoader } from 'second-brain-ts';
import { plugin } from './store';

interface PluginData {
    llm: string;
    fromBackup: boolean;
    targetFolder: string;
    openAIApiKey: string;
}

export const DEFAULT_SETTINGS: Partial<PluginData> = {
    targetFolder: 'Chats',
    openAIApiKey: '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', // TODO: remove this
    fromBackup: false,
};

export default class BrainPlugin extends Plugin {
    data: PluginData;
    chatView: ChatView;
    secondBrain: SecondBrain;

    async loadSettings() {
        this.data = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.data);
    }

    async initSecondBrain(fromBackup = false) {
        const vectorStoreDataPath = normalizePath('.obsidian/plugins/smart-second-brain/vector-store-data.json');
        this.secondBrain = new SecondBrain({
            openAIApiKey: this.data.openAIApiKey,
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
                mdFiles.filter((mdFile) => !mdFile.path.startsWith(this.data.targetFolder))
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
                if (file.path.startsWith(this.data.targetFolder)) return; // don't embed chat files
                const docs = await obsidianDocumentLoader(this.app, [file]);
                await this.secondBrain.embedDocuments(docs);
            }, 1000);
        });
        this.app.vault.on('delete', async (file: TFile) => {
            if (file.path.startsWith(this.data.targetFolder)) return; // don't embed chat files
            const docs = await obsidianDocumentLoader(this.app, [file]);
            await this.secondBrain.removeDocuments(docs);
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
