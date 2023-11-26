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
                    this.plugin.data.AIcolor = DEFAULT_SETTINGS.AIcolor;
                    await this.plugin.saveSettings();
                })
            )
            .addColorPicker((color) =>
                color.setValue(this.plugin.data.AIcolor).onChange(async (value) => {
                    this.plugin.data.AIcolor = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('User Color')
            .addExtraButton((value) => value.setIcon('reset').onClick(() => (this.plugin.data.UserColor = DEFAULT_SETTINGS.UserColor)))
            .addColorPicker((color) =>
                color.setValue(this.plugin.data.UserColor).onChange(async (value) => {
                    this.plugin.data.UserColor = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl).setName('LLM').addDropdown((value) => {
            value
                .addOptions({
                    LLama: 'LLama',
                    Anthropic: 'Anthropic',
                })
                .setValue(this.plugin.data.llm)
                .onChange(async (value) => {
                    this.plugin.data.llm = value;
                    await this.plugin.saveSettings();
                });
        });

        new Setting(containerEl).setName('OpenAI API Key').addText((text) =>
            text
                .setPlaceholder('OpenAI API Key')
                .setValue(this.plugin.data.secondBrain.openAIApiKey || '')
                .onChange(async (value) => {
                    this.plugin.data.secondBrain.openAIApiKey = value;
                    await this.plugin.saveSettings();
                })
        );
    }
}
