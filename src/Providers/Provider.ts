import { get } from 'svelte/store';
import { data, plugin } from '../store';

export const providerNames = ['OpenAI', 'Ollama'];
export type ProviderName = (typeof providerNames)[number];

export abstract class ProviderBase<TSettings> {
    readonly isLocal: boolean;
    protected apiConfig: TSettings;

    abstract isSetuped(): Promise<boolean>;
    async setConfig(apiConfig: TSettings) {
        const { saveSettings } = get(plugin);
        this.apiConfig = apiConfig;
        await saveSettings();
    }
    getConfig() {
        return this.apiConfig;
    }
}

export type GenModelSettings = {
    temperature?: number;
    contextWindow?: number;
};

export type EmbedModelSettings = {
    similarityThreshold?: number;
};

export abstract class Provider<TModelSettings, TPapaModel> {
    protected selectedModel: string;
    protected models: { [model: string]: TModelSettings } = {};
    protected providerName: ProviderName;

    constructor(selectedModel: string) {
        this.selectedModel = selectedModel;
    }

    abstract getModels(): Promise<string[]>;
    abstract setModel(model: string): void;
    getModel() {
        return this.selectedModel;
    }
    getModelSettings() {
        return this.models[this.selectedModel];
    }

    async setModelSettings(settings: TModelSettings) {
        const { saveSettings } = get(plugin);
        this.models[this.selectedModel] = { ...this.models[this.selectedModel], ...settings };
        await saveSettings();
    }

    getPapaModel(): TPapaModel {
        return {
            model: this.selectedModel,
            ...this.models[this.selectedModel],
            ...get(data).providerSettings[this.providerName].getConfig(),
        };
    }
}

export const getSelectedProvider = () => {
    const { embedProviders, selEmbedProvider, genProviders, selGenProvider } = get(data);
    return { embed: embedProviders[selEmbedProvider], gen: genProviders[selGenProvider] };
};
