import { App, PluginSettingTab, Setting, requestUrl, Notice, setIcon } from 'obsidian';
import SecondBrainPlugin, { DEFAULT_SETTINGS } from '../main';
import { chatHistory } from '../store';
// import OpenAI from 'openai';
import { get } from 'svelte/store';
import { nanoid } from 'nanoid';
import { Languages, type Language, OpenAIGenModelNames, OllamaGenModelNames } from 'papa-ts';
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

        setIcon(this.containerEl.createEl('div', { cls: ['flex', 'justify-center', '*:!w-[--icon-xl]', '*:!h-[--icon-xl]'] }), 'brain-circuit');
        this.containerEl.createEl('h1', { text: 'Smart Second Brain', cls: ['text-center', 'mt-1'] });

        const generalSettingsEl = this.containerEl.createEl('details');
        generalSettingsEl.open = true;
        generalSettingsEl.createEl('summary', { text: 'General Settings', cls: ['setting-item-heading', 'py-3'] });

        new Setting(generalSettingsEl).setName('Assistant Language').addDropdown((dropdown) => {
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
            target: generalSettingsEl,
        });

        new Setting(generalSettingsEl).setName('Icognito Mode').addToggle((toggle) =>
            toggle.setValue(data.isIncognitoMode).onChange(async (value) => {
                data.isIncognitoMode = value;
                await this.plugin.saveSettings();
                this.plugin.initSecondBrain();
                this.display();
            })
        );

        if (data.isIncognitoMode) {
            new Setting(generalSettingsEl).setHeading().setName('Ollama Settings');
            const model = data.ollamaGenModel;
            let setting_input: HTMLInputElement;
            new Setting(generalSettingsEl)
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
                            try {
                                // check if url is valid
                                new URL(model.baseUrl);
                                setting_input.style.backgroundColor = 'var(--background-modifier-form-field)';
                                this.plugin.secondBrain.setGenModel(model);
                            } catch (_) {
                                setting_input.style.backgroundColor = 'rgba(var(--color-red-rgb), 0.3)';
                            }
                            await this.plugin.saveSettings();
                        })
                        .then((setting) => {
                            setting_input = setting.inputEl;
                        })
                );

            new Setting(generalSettingsEl).setName('Ollama Model').addDropdown(async (dropdown) => {
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
                        await this.plugin.saveSettings();
                        this.plugin.secondBrain.setGenModel(model);
                    });
                } catch (e) {
                    if (e.toString() == 'Error: net::ERR_CONNECTION_REFUSED') {
                        new Notice('Ollama server is not running');
                        dropdown.addOption('Start Ollama service', 'Start Ollama service');
                        dropdown.setValue('Start Ollama service');
                    }
                }
            });
        } else {
            new Setting(generalSettingsEl).setHeading().setName('OpenAI Settings');
            const model = data.openAIGenModel;
            const openaiAPIUrl = 'https://api.openai.com/v1';
            // const openAI = new OpenAI({ apiKey: data.openAIGenModel.openAIApiKey, dangerouslyAllowBrowser: true });

            const openaiTest = {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: 'Say this is a test!' }],
                temperature: 0.7,
            };

            let setting_input2: HTMLInputElement;
            new Setting(generalSettingsEl)
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

            new Setting(generalSettingsEl).setName('OpenAI Model').addDropdown(async (dropdown) => {
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
        }
        // Setting to initialze SecondBrain
        new Setting(generalSettingsEl).addButton((button) =>
            button
                .setButtonText('Reset Smart Second Brain')
                .setClass('mod-cta')
                .onClick(async () => {
                    await this.plugin.initSecondBrain(false);
                })
        );

        const advancedSettingsEl = this.containerEl.createEl('details');

        advancedSettingsEl.createEl('summary', { text: 'Advanced Settings', cls: ['setting-item-heading', 'py-3'] });
        new Setting(advancedSettingsEl)
            .setName('Prompt')
            .addButton((button) => button.setButtonText('Restore Default').setIcon('rotate-cw').setClass('clickable-icon'))
            .addText((text) => text.setPlaceholder('Hi was geht ab'));

        new DocsComponent({
            target: advancedSettingsEl,
        });
    }
}
