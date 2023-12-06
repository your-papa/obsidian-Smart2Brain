import './styles.css';
import { ChatModal } from './views/ChatModal';
import { ChatView, VIEW_TYPE_CHAT } from './views/ChatView';
import SettingsTab from './views/Settings';
import { FuzzySuggestModal, TFile, App, Plugin } from 'obsidian';
import { secondBrain } from './store';
import { SecondBrain, obsidianDocumentLoader, type SecondBrainData } from 'second-brain-ts';
import { plugin } from './store';

interface PluginData {
    llm: string;
    embeddedAllOnce: boolean;
    secondBrain: SecondBrainData;
}

export const DEFAULT_SETTINGS: Partial<PluginData> = {
    secondBrain: {
        openAIApiKey: 'Your key',
    },
};

export default class BrainPlugin extends Plugin {
    data: PluginData;

    async loadSettings() {
        this.data = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.data);
    }

    async onload() {
        await this.loadSettings();
        secondBrain.set(await SecondBrain.loadFromData(this.data.secondBrain));

        plugin.set(this);

        this.app.vault.on('modify', (file: TFile) => {
            setTimeout(async () => {
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
                const docs = await obsidianDocumentLoader(this.app, [file]);
                await secondBrain.removeDocuments(docs);
                this.data.secondBrain.vectorStoreJson = await secondBrain.getVectorStoreJson();
                await this.saveSettings();
            });
        });

        this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf));

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

        if (!this.data.embeddedAllOnce) {
            setTimeout(() => {
                secondBrain.subscribe(async (secondBrain) => {
                    const docs = await obsidianDocumentLoader(this.app, this.app.vault.getMarkdownFiles());
                    await secondBrain.embedDocuments(docs);
                    this.data.secondBrain.vectorStoreJson = await secondBrain.getVectorStoreJson();
                    this.data.embeddedAllOnce = true;
                    await this.saveSettings();
                });
            }, 1000);
        }
    }

    onunload() {
        console.log('unloading plugin');
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);

        await this.app.workspace.getRightLeaf(false).setViewState({
            type: VIEW_TYPE_CHAT,
            active: true,
        });

        this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0]);
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
