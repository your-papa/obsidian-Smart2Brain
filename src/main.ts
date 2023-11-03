import './styles.css';
import { ChatModal } from './views/ChatModal';
import Input from './components/Input.svelte';
import { ChatView, VIEW_TYPE_CHAT } from './views/ChatView';
import { App, FuzzySuggestModal, Modal, Notice, Plugin, TFile, MarkdownRenderer } from 'obsidian';
import SettingsTab from './views/Settings';

interface PluginSettings {
    AIcolor: string;
    UserColor: string;
    llm: string;
}

export const DEFAULT_SETTINGS: Partial<PluginSettings> = {
    AIcolor: '#82c8f6',
    UserColor: '#8e5eef',
};

export default class BrainPlugin extends Plugin {
    settings: PluginSettings;

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async onload() {
        await this.loadSettings();

        this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(app, leaf, this.settings.AIcolor, this.settings.UserColor));

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
