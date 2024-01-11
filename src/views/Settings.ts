import { App, PluginSettingTab, Setting, requestUrl, Notice } from 'obsidian';
import SecondBrainPlugin, { DEFAULT_SETTINGS } from '../main';
// import OpenAI from 'openai';
import { Languages, type Language, OpenAIGenModelNames, OllamaGenModelNames } from 'second-brain-ts';

export default class SettingsTab extends PluginSettingTab {
    plugin: SecondBrainPlugin;
    isSecretVisible: boolean;

    constructor(app: App, plugin: SecondBrainPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.isSecretVisible = false;
    }

    async display(): Promise<void> {
        let { containerEl } = this;
        containerEl.empty();

        const data = this.plugin.data;

        this.containerEl.createEl('h2', { text: 'General Settings' });
        new Setting(containerEl).setName('Assistant Language').addDropdown((dropdown) => {
            Languages.forEach((lang: Language) => dropdown.addOption(lang, lang));
            dropdown.setValue(data.assistantLanguage).onChange(async (lang: any) => {
                data.assistantLanguage = lang;
                await this.plugin.saveSettings();
            });
        });
        new Setting(this.containerEl).setName('Toggle OpenAI').addToggle((toggle) =>
            toggle.setValue(data.genModelToggle).onChange(async (value) => {
                data.genModelToggle = value;
                await this.plugin.saveSettings();
                this.plugin.initSecondBrain();
                this.display();
            })
        );

        // new Setting(containerEl).setName('Folder Exclusion').addSearch((folder) => {
        //     try {
        //         new FolderSuggest(this.app, folder.inputEl);
        //     } catch {
        //         // eslint-disable
        //     }
        //     folder
        //         .setPlaceholder('Example: folder1/folder2')
        //         .setValue(data.excludeFolders)
        //         .onChange((new_folder) => {
        //             data.excludeFolder = new_folder;
        //             this.plugin.saveSettings();
        //         });
        // });

        if (data.genModelToggle) {
            this.containerEl.createEl('h2', { text: 'OpenAI Settings' });
            const model = data.openAIGenModel;
            const openaiAPIUrl = 'https://api.openai.com/v1';
            // const openAI = new OpenAI({ apiKey: data.openAIGenModel.openAIApiKey, dangerouslyAllowBrowser: true });

            const openaiTest = {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: 'Say this is a test!' }],
                temperature: 0.7,
            };

            let setting_input2: HTMLInputElement;
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
                                ? model.openAIApiKey
                                : model.openAIApiKey.substring(0, 6) + '...' + model.openAIApiKey.substring(model.openAIApiKey.length - 3)
                        )
                        .onChange(async (value) => {
                            model.openAIApiKey = value;
                            await this.plugin.saveSettings();
                            setting_input2.style.backgroundColor = 'var(--background-modifier-form-field)';
                            try {
                                await requestUrl({
                                    method: 'POST',
                                    url: `${openaiAPIUrl}/chat/completions`,
                                    headers: {
                                        'Content-Type': 'application/json',
                                        Authorization: `Bearer ${model.openAIApiKey}`,
                                    },
                                    body: JSON.stringify(openaiTest),
                                });
                                this.plugin.secondBrain.setGenModel(model);
                            } catch (e) {
                                setting_input2.style.backgroundColor = 'rgba(var(--color-red-rgb), 0.3)';
                            }
                        })
                        .then((setting2) => {
                            setting_input2 = setting2.inputEl;
                        })
                );

            new Setting(containerEl).setName('OpenAI Model').addDropdown(async (dropdown) => {
                // dropdown.addOption(data.openAIModel, data.openAIModel).setValue(data.openAIModel);
                // const models = await openAI.models.list();
                // models.data.forEach((model: { id: string }) => {
                // if (!isOpenAIModel(model.id) || model.id == data.openAIModel) return;
                //     dropdown.addOption(model.id, model.id);
                // });
                OpenAIGenModelNames.forEach((model: string) => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(model.modelName).onChange(async (modelName: any) => {
                    model.modelName = modelName;
                    await this.plugin.saveSettings();
                    this.plugin.secondBrain.setGenModel(model);
                });
            });
        } else {
            this.containerEl.createEl('h2', { text: 'Ollama Settings' });
            const model = data.ollamaGenModel;
            function isValidUrl(url: string) {
                try {
                    new URL(url);
                } catch (_) {
                    return false;
                }

                return true;
            }
            let setting_input: HTMLInputElement;
            new Setting(containerEl)
                .setName('Ollama URL')
                .addButton((button) =>
                    button
                        .setButtonText('Restore Default')
                        .setIcon('rotate-cw')
                        .setClass('clickable-icon')
                        .onClick(async () => {
                            model.baseUrl = DEFAULT_SETTINGS.ollamaGenModel.baseUrl;
                            await this.plugin.saveSettings();
                            this.display();
                        })
                )
                .addText((text) =>
                    text
                        .setValue(model.baseUrl)
                        .setPlaceholder('http://localhost:11434')
                        .onChange(async (value) => {
                            value = value.trim();
                            if (value.endsWith('/')) value = value.slice(0, -1);
                            model.baseUrl = value;
                            if (isValidUrl(value)) {
                                setting_input.style.backgroundColor = 'var(--background-modifier-form-field)';
                                this.plugin.secondBrain.setGenModel(model);
                            } else setting_input.style.backgroundColor = 'rgba(var(--color-red-rgb), 0.3)';
                            await this.plugin.saveSettings();
                        })
                        .then((setting) => {
                            setting_input = setting.inputEl;
                        })
                );

            new Setting(containerEl).setName('Ollama Model').addDropdown(async (dropdown) => {

                try {
                    const response = await requestUrl({
                        url: model.baseUrl + '/api/tags',
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    });
                    const jsonData = response.json;
                    // const models: String[] = jsonData.models.map((model: { name: string }) => model.name);
                    OllamaGenModelNames.forEach((model: string) => dropdown.addOption(model, model));
                    dropdown.setValue(model.model).onChange(async (modelName: any) => {
                        model.model = modelName;
                        console.log(jsonData);
                        await this.plugin.saveSettings();
                        this.plugin.secondBrain.setGenModel(model);
                    });
                } catch (e) {
                    console.log(e);
                    if (e.toString() == "Error: net::ERR_CONNECTION_REFUSED") {
                        new Notice('Ollama server is not running');
                        dropdown.addOption('Start Ollama service', 'Start Ollama service');
                        dropdown.setValue("Start Ollama service");
                    }
                }
            });
        }
    }
}
