import { App, PluginSettingTab, SearchComponent, Setting } from 'obsidian';
import { DEFAULT_SETTINGS } from '../main';
import type BrainPlugin from '../main';

export default class SettingsTab extends PluginSettingTab {
    plugin: BrainPlugin;

    constructor(app: App, plugin: BrainPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('AI Color')
            .addExtraButton((value) =>
                value.setIcon('reset').onClick(async () => {
                    this.plugin.settings.AIcolor = DEFAULT_SETTINGS.AIcolor;
                    await this.plugin.saveSettings();
                })
            )
            .addColorPicker((color) =>
                color.setValue(this.plugin.settings.AIcolor).onChange(async (value) => {
                    this.plugin.settings.AIcolor = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('User Color')
            .addExtraButton((value) => value.setIcon('reset').onClick(() => (this.plugin.settings.UserColor = DEFAULT_SETTINGS.UserColor)))
            .addColorPicker((color) =>
                color.setValue(this.plugin.settings.UserColor).onChange(async (value) => {
                    this.plugin.settings.UserColor = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl).setName('LLM').addDropdown((value) => {
            value
                .addOptions({
                    LLama: 'LLama',
                    Anthropic: 'Anthropic',
                })
                .setValue(this.plugin.settings.llm)
                .onChange(async (value) => {
                    this.plugin.settings.llm = value;
                    await this.plugin.saveSettings();
                });
        });
    }
}
