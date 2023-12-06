import './styles.css';
import { ChatModal } from './views/ChatModal';
import { ChatView, VIEW_TYPE_CHAT, DEFAULT_DATA } from './views/ChatView';
import SettingsTab from './views/Settings';
import { FuzzySuggestModal, TFile, App, Plugin, type ViewState } from 'obsidian';
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
        openAIApiKey: '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',
    },
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
                    const docs = await obsidianDocumentLoader(this.app, this.app.vault.getMarkdownFiles());
                    await secondBrain.embedDocuments(docs);
                    this.data.secondBrain.vectorStoreJson = await secondBrain.getVectorStoreJson();
                    this.data.embeddedAllOnce = true;
                    await this.saveSettings();
                });
            }, 1000);
        }

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
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);

        const file = await this.app.vault.create(`Chat ${window.moment().format('YY-MM-DD hh.mm.ss')}.md`, DEFAULT_DATA);
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.openFile(file, { active: true });
        leaf.setViewState({
            type: VIEW_TYPE_CHAT,
            state: leaf.view.getState(),
            popstate: true,
        } as ViewState);
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
