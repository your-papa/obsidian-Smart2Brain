import { App, PluginSettingTab, Setting, requestUrl, Notice, setIcon } from 'obsidian';
import SecondBrainPlugin, { DEFAULT_SETTINGS } from '../main';
import { chatHistory } from '../store';
// import OpenAI from 'openai';
import { get } from 'svelte/store';
import { nanoid } from 'nanoid';
import { Languages, type Language, OpenAIGenModelNames, OllamaGenModelNames, OpenAIEmbedModelNames } from 'papa-ts';
import SettingsComponent from '../components/Settings.svelte';
import { INITIAL_ASSISTANT_MESSAGE } from '../ChatMessages';
import DocsComponent from '../components/temp.svelte';

export default class SettingsTab extends PluginSettingTab {
    component: SettingsComponent;
    plugin: SecondBrainPlugin;
    isSecretVisible: boolean;

    constructor(app: App, plugin: SecondBrainPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.isSecretVisible = false;
    }

    async display(): Promise<void> {
        this.containerEl.empty();

        const data = this.plugin.data;

        new Setting(this.containerEl).setName('Assistant Language').addDropdown((dropdown) => {
            Languages.forEach((lang: Language) => dropdown.addOption(lang, lang));
            dropdown.setValue(data.assistantLanguage).onChange(async (lang: any) => {
                data.assistantLanguage = lang;
                data.initialAssistantMessage = INITIAL_ASSISTANT_MESSAGE.get(lang) || INITIAL_ASSISTANT_MESSAGE.get('en');
                if (get(chatHistory).length === 1) {
                    chatHistory.set([
                        {
                            role: 'Assistant',
                            content: data.initialAssistantMessage,
                            id: nanoid(),
                        },
                    ]);
                    this.plugin.chatView.requestSave();
                }
                await this.plugin.saveSettings();
            });
        });

        this.component = new SettingsComponent({
            target: this.containerEl,
        });

        new Setting(this.containerEl).setName('Icognito Mode').addToggle((toggle) =>
            toggle.setValue(data.isIncognitoMode).onChange(async (isIncognitoMode) => {
                data.isIncognitoMode = isIncognitoMode;
                await this.plugin.saveSettings();
                this.display();
            })
        );

        if (data.isIncognitoMode) {
            new Setting(this.containerEl).setHeading().setName('Ollama Settings');
            const chatModel = data.ollamaGenModel;
            const embedModel = data.ollamaEmbedModel;
            let setting_input: HTMLInputElement;
            new Setting(this.containerEl)
                .setName('Ollama URL')
                .addButton((button) =>
                    button
                        .setButtonText('Restore Default')
                        .setIcon('rotate-cw')
                        .setClass('clickable-icon')
                        .onClick(async () => {
                            chatModel.baseUrl = DEFAULT_SETTINGS.ollamaGenModel.baseUrl;
                            embedModel.baseUrl = DEFAULT_SETTINGS.ollamaEmbedModel.baseUrl;
                            await this.plugin.saveSettings();
                            this.display();
                        })
                )
                .addText((text) =>
                    text
                        .setValue(chatModel.baseUrl)
                        .setPlaceholder('http://localhost:11434')
                        .onChange(async (value) => {
                            value = value.trim();
                            if (value.endsWith('/')) value = value.slice(0, -1);
                            chatModel.baseUrl = value;
                            embedModel.baseUrl = value;
                            try {
                                // check if url is valid
                                new URL(chatModel.baseUrl);
                                setting_input.style.backgroundColor = 'var(--background-modifier-form-field)';
                            } catch (_) {
                                setting_input.style.backgroundColor = 'rgba(var(--color-red-rgb), 0.3)';
                            }
                            await this.plugin.saveSettings();
                        })
                        .then((setting) => {
                            setting_input = setting.inputEl;
                        })
                );
            try {
                const response = await requestUrl({
                    url: embedModel.baseUrl + '/api/tags',
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
                const jsonData = response.json;
                // const models: String[] = jsonData.models.map((model: { name: string }) => model.name);

                new Setting(this.containerEl).setName('Ollama Chat Model').addDropdown(async (dropdown) => {
                    OllamaGenModelNames.forEach((model: string) => dropdown.addOption(model, model));
                    dropdown.setValue(chatModel.model).onChange(async (modelName: any) => {
                        chatModel.model = modelName;
                        await this.plugin.saveSettings();
                        this.plugin.secondBrain.setGenModel(chatModel);
                    });
                });

                new Setting(this.containerEl).setName('Ollama Embedding Model').addDropdown(async (dropdown) => {
                    OllamaGenModelNames.forEach((model: string) => dropdown.addOption(model, model));
                    dropdown.setValue(embedModel.model).onChange(async (modelName: any) => {
                        embedModel.model = modelName;
                        await this.plugin.saveSettings();
                        this.plugin.secondBrain.setEmbedModel(embedModel);
                        // TODO reinit secondbrain because we need to load other vector-store.bin
                    });
                });
            } catch (e) {
                if (e.toString() == 'Error: net::ERR_CONNECTION_REFUSED') {
                    new Notice('Ollama service is not running');
                }
            }
        } else {
            new Setting(this.containerEl).setHeading().setName('OpenAI Settings');
            const chatModel = data.openAIGenModel;
            const embedModel = data.openAIEmbedModel;
            const openaiAPIUrl = 'https://api.openai.com/v1';
            // const openAI = new OpenAI({ apiKey: data.openAIGenModel.openAIApiKey, dangerouslyAllowBrowser: true });

            const openaiTest = {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: 'Say this is a test!' }],
                temperature: 0.7,
            };

            let setting_input2: HTMLInputElement;
            new Setting(this.containerEl)
                .setName('API Key')
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
                            chatModel.openAIApiKey == ''
                                ? ''
                                : this.isSecretVisible
                                  ? chatModel.openAIApiKey
                                  : chatModel.openAIApiKey.substring(0, 6) + '...' + chatModel.openAIApiKey.substring(chatModel.openAIApiKey.length - 3)
                        )
                        .onChange(async (value) => {
                            chatModel.openAIApiKey = value;
                            embedModel.openAIApiKey = value;
                            await this.plugin.saveSettings();
                            setting_input2.style.backgroundColor = 'var(--background-modifier-form-field)';
                            try {
                                await requestUrl({
                                    method: 'POST',
                                    url: `${openaiAPIUrl}/chat/completions`,
                                    headers: {
                                        'Content-Type': 'application/json',
                                        Authorization: `Bearer ${chatModel.openAIApiKey}`,
                                    },
                                    body: JSON.stringify(openaiTest),
                                });
                            } catch (e) {
                                console.log(e);
                                setting_input2.style.backgroundColor = 'rgba(var(--color-red-rgb), 0.3)';
                            }
                        })
                        .then((setting2) => {
                            setting_input2 = setting2.inputEl;
                        })
                );

            new Setting(this.containerEl).setName('Chat Model').addDropdown(async (dropdown) => {
                // dropdown.addOption(data.openAIModel, data.openAIModel).setValue(data.openAIModel);
                // const models = await openAI.models.list();
                // models.data.forEach((model: { id: string }) => {
                // if (!isOpenAIModel(model.id) || model.id == data.openAIModel) return;
                //     dropdown.addOption(model.id, model.id);
                // });
                OpenAIGenModelNames.forEach((model: string) => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(chatModel.modelName).onChange(async (modelName: any) => {
                    chatModel.modelName = modelName;
                    this.plugin.secondBrain.setGenModel(chatModel);
                    await this.plugin.saveSettings();
                });
            });
            new Setting(this.containerEl).setName('Embedding Model').addDropdown(async (dropdown) => {
                OpenAIEmbedModelNames.forEach((model: string) => dropdown.addOption(model, model));
                dropdown.setValue(embedModel.modelName).onChange(async (modelName: any) => {
                    embedModel.modelName = modelName;
                    await this.plugin.saveSettings();
                    this.plugin.secondBrain.setEmbedModel(embedModel);
                    // TODO reinit secondbrain because we need to load other vector-store.bin
                });
            });
        }
        // Setting to initialze SecondBrain
        new Setting(this.containerEl).addButton((button) =>
            button
                .setButtonText('Initialize Smart Second Brain')
                .setClass('mod-cta')
                .onClick(async () => {
                    await this.plugin.initSecondBrain();
                })
        );

        const advancedSettingsEl = this.containerEl.createEl('details');

        advancedSettingsEl.createEl('summary', { text: 'Advanced Settings', cls: ['setting-item-heading', 'py-3'] });
        new Setting(advancedSettingsEl).setName('TBD');
        // new Setting(advancedSettingsEl)
        //     .setName('Prompt')
        //     .addButton((button) => button.setButtonText('Restore Default').setIcon('rotate-cw').setClass('clickable-icon'))
        //     .addText((text) => text.setPlaceholder('Hi was geht ab'));
        //
        // new DocsComponent({
        //     target: advancedSettingsEl,
        // });
    }
}
