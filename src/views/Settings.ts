import { App, PluginSettingTab } from 'obsidian';
import SecondBrainPlugin from '../main';
import SettingsComponent from '../components/Setting/Settings.svelte';

export default class SettingsTab extends PluginSettingTab {
    component: SettingsComponent;
    plugin: SecondBrainPlugin;
    isSecretVisible: boolean;

    constructor(app: App, plugin: SecondBrainPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.isSecretVisible = false;
    }

    display(): void {
        this.containerEl.empty();

        this.component = new SettingsComponent({
            target: this.containerEl,
        });
    }
}
