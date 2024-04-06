import { get } from 'svelte/store';
import { data, plugin } from '../store';

export const providerNames = ['OpenAI', 'Ollama'];
export type providers = (typeof providerNames)[number];

export abstract class Provider {
    name: providers;
    rcmdGenModel: string;
    otherGenModels: string[];
    rcmdEmbedModel: string;
    otherEmbedModels: string[];
    isLocal: boolean;

    isSetup: () => Promise<boolean>;
    changeSetup: (setup: string) => void;
    getModels: () => Promise<string[]>;
    setGenModel: (model: string) => void;
    setEmbedModel: (model: string) => void;
    getSetup: () => string;
    toString: () => string;

    static changeEmbedProvider = async (provider: string) => {
        data.update((d) => {
            switch (provider) {
                case 'Ollama':
                    d.embedProvider = d.ollamaProvider;
                    break;
                case 'OpenAI':
                    d.embedProvider = d.openAIProvider;
                    break;
            }
            return d;
        });
        get(plugin).saveSettings();
    };
    static changeGenProvider = async (provider: string) => {
        data.update((d) => {
            switch (provider) {
                case 'Ollama':
                    d.genProvider = d.ollamaProvider;
                    break;
                case 'OpenAI':
                    d.genProvider = d.openAIProvider;
                    break;
            }
            return d;
        });
        get(plugin).saveSettings();
    };
}
