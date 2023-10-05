import "./styles.css";
import { ChatView, VIEW_TYPE_CHAT } from "./views/ChatView";
import { App, Modal, Plugin, PluginSettingTab, Setting } from "obsidian";

interface PluginSettings {
    mySetting: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
    mySetting: "default",
};

export default class BrainPlugin extends Plugin {
    settings: PluginSettings;

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async onload() {
        await this.loadSettings();

        this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf));

        this.addRibbonIcon("brain-circuit", "Smart Second Brain", () => {
            this.activateView();
        });

        this.addSettingTab(new SettingsTab(this.app, this));
    }

    onunload() {
        console.log("unloading plugin");
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);

        await this.app.workspace.getRightLeaf(false).setViewState({
            type: VIEW_TYPE_CHAT,
            active: true,
        });

        this.app.workspace.revealLeaf(
            this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0]
        );
    }
}

class SampleModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.setText("Woah!");
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class SettingsTab extends PluginSettingTab {
    plugin: BrainPlugin;

    constructor(app: App, plugin: BrainPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("Setting #1")
            .setDesc("It's a secret")
            .addText((text) =>
                text
                    .setPlaceholder("Enter your secret")
                    .setValue(this.plugin.settings.mySetting)
                    .onChange(async (value) => {
                        this.plugin.settings.mySetting = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
