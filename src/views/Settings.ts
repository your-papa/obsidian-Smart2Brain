import { App, PluginSettingTab } from 'obsidian';
import SecondBrainPlugin from '../main';
import SettingsComponent from '../components/Settings/Settings.svelte';
import { mount } from "svelte";

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

        this.component = mount(SettingsComponent, {
                    target: this.containerEl,
                });
    }
}
