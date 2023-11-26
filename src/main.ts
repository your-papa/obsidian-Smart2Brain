import './styles.css';
import { ChatModal } from './views/ChatModal';
import { ChatView, VIEW_TYPE_CHAT } from './views/ChatView';
import SettingsTab from './views/Settings';
import { FuzzySuggestModal, TFile, App, Plugin } from 'obsidian';
import { secondBrain } from './store';
import { SecondBrain, obsidianDocumentLoader, type SecondBrainData } from 'second-brain-ts';

interface PluginData {
    AIcolor: string;
    UserColor: string;
    llm: string;
    secondBrain: SecondBrainData;
}

const getThemeColor = (name: string) => {
    return getComputedStyle(document.body).getPropertyValue(name);
};

export const DEFAULT_SETTINGS: Partial<PluginData> = {
    AIcolor: getThemeColor('--color-accent'),
    UserColor: getThemeColor('--color-base-40'),
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

        this.app.vault.on('modify', (file: TAbstractFile) => {
            secondBrain.subscribe(async (secondBrain) => {
                console.log('File modified, reloading', file.basename);
                const docs = await obsidianDocumentLoader(this.app);
                await secondBrain.embedDocuments(docs);
                this.data.secondBrain.vectorStoreJson = await secondBrain.getVectorStoreJson();
                await this.saveSettings();
            });
        });

        this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(app, leaf, this.data.AIcolor, this.data.UserColor));

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
