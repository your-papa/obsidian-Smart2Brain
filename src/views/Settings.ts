import { App, Notice, PluginSettingTab, SearchComponent, Setting, requestUrl } from 'obsidian';
import { DEFAULT_SETTINGS } from '../main';
import OpenAI from 'openai';
import type BrainPlugin from '../main';
import type { OpenAIModel } from '../main';
import { AssistentLang } from 'second-brain-ts';
import type { Language } from 'second-brain-ts';
import { FolderSuggest } from '../FolderSuggester';

export default class SettingsTab extends PluginSettingTab {
    plugin: BrainPlugin;
    isSecretVisible: boolean;

    constructor(app: App, plugin: BrainPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.isSecretVisible = false;
    }

    async display(): Promise<void> {
        let { containerEl } = this;

        const data = this.plugin.data;
        const openaiAPIUrl = 'https://api.openai.com/v1';
        const openAI = new OpenAI({ apiKey: data.openAIApiKey, dangerouslyAllowBrowser: true });

        function isOpenAIModel(model: any): model is OpenAIModel {
            return ['gpt-3.5-turbo', 'gpt-3.5-turbo-1106', 'gpt-4', 'gpt-4-1106-preview'].includes(model);
        }

        const openaiTest = {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Say this is a test!' }],
            temperature: 0.7,
        };

        function isValidUrl(string) {
            let url: URL;
            try {
                url = new URL(string);
            } catch (_) {
                return false;
            }

            return true;
        }

        containerEl.empty();

        const ollamaUrl = data.ollamaUrl;

        new Setting(containerEl).setName('Assistant Language').addDropdown((dropdown) => {
            Object.keys(AssistentLang).forEach((lang: Language) => dropdown.addOption(lang, lang));
            dropdown.setValue(data.assistantLanguage).onChange(async (lang: string) => {
                data.assistantLanguage = lang;
                await this.plugin.saveSettings();
            });
        });

        let setting_input;
        new Setting(containerEl)
            .setName('Ollama URL')
            .addButton((button) =>
                button
                    .setButtonText('Restore Default')
                    .setIcon('rotate-cw')
                    .setClass('clickable-icon')
                    .onClick(async () => {
                        data.ollamaUrl = DEFAULT_SETTINGS.ollamaUrl;
                        await this.plugin.saveSettings();
                        this.display();
                    })
            )
            .addText((text) =>
                text
                    .setValue(ollamaUrl)
                    .setPlaceholder('localhost:11434')
                    .onChange(async (value) => {
                        value = value.trim();
                        if (value.endsWith('/')) {
                            value = value.slice(0, -1);
                        }
                        if (!isValidUrl(value)) setting_input.style.backgroundColor = 'rgba(var(--color-red-rgb), 0.3)';
                        else setting_input.style.backgroundColor = 'var(--background-modifier-form-field)';
                        data.ollamaUrl = value;
                        await this.plugin.saveSettings();
                    })
                    .then((setting) => {
                        setting_input = setting.inputEl;
                    })
            );

        new Setting(containerEl).setName('Ollama Model').addDropdown(async (dropdown) => {
            const response = await requestUrl({
                url: data.ollamaUrl + '/api/tags',
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            const jsonData = response.json;
            const models: String[] = jsonData.models.map((model: { name: string }) => model.name);
            models.forEach((model: string) => dropdown.addOption(model, model));
            dropdown.setValue(data.ollamaModel).onChange(async (model: string) => {
                data.ollamaModel = model;
                await this.plugin.saveSettings();
            });
        });

        let setting_input2;
        new Setting(containerEl)
            .setName('OpenAI API Key')
            .addButton((button) => {
                button
                    .setButtonText(this.isSecretVisible ? 'Hide Key' : 'Show Key')
                    .setIcon(this.isSecretVisible ? 'eye-off' : 'eye')
                    .setClass('clickable-icon')
                    .onClick(async () => {
                        this.isSecretVisible = !this.isSecretVisible;
                        this.display();
                    });
            })
            .addText((text) =>
                text
                    .setPlaceholder('OpenAI API Key')
                    .setValue(
                        this.isSecretVisible
                            ? data.openAIApiKey
                            : data.openAIApiKey.substring(0, 6) + '...' + data.openAIApiKey.substring(data.openAIApiKey.length - 3)
                    )
                    .onChange(async (value) => {
                        data.openAIApiKey = value;
                        await this.plugin.saveSettings();
                        setting_input2.style.backgroundColor = 'var(--background-modifier-form-field)';
                        try {
                            await requestUrl({
                                method: 'POST',
                                url: `${openaiAPIUrl}/chat/completions`,
                                headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: `Bearer ${data.openAIApiKey}`,
                                },
                                body: JSON.stringify(openaiTest),
                            });
                        } catch (e) {
                            setting_input2.style.backgroundColor = 'rgba(var(--color-red-rgb), 0.3)';
                        }
                    })
                    .then((setting2) => {
                        setting_input2 = setting2.inputEl;
                    })
            );

        new Setting(containerEl).setName('GPT Model').addDropdown(async (dropdown) => {
            dropdown.addOption(data.openAIModel, data.openAIModel).setValue(data.openAIModel);
            const models = await openAI.models.list();
            models.data.forEach((model: { id: string }) => {
                if (!isOpenAIModel(model.id) || model.id == data.openAIModel) return;
                dropdown.addOption(model.id, model.id);
            });
            dropdown.onChange(async (model: string) => {
                data.openAIModel = model;
                await this.plugin.saveSettings();
            });
        });

        new Setting(containerEl).setName('Folder Exclusion').addSearch((folder) => {
            try {
                new FolderSuggest(this.app, folder.inputEl);
            } catch {
                // eslint-disable
            }
            folder
                .setPlaceholder('Example: folder1/folder2')
                .setValue(this.plugin.data.excludeFolders)
                .onChange((new_folder) => {
                    this.plugin.data.excludeFolder = new_folder;
                    this.plugin.saveSettings();
                });
        });
    }
}
