import { Notice, requestUrl } from 'obsidian';
import Log from '../logging';
import { Provider, ProviderBase, type GenModelSettings, type EmbedModelSettings } from './Provider';
import { _ } from 'svelte-i18n';
import { get } from 'svelte/store';
import { data, plugin } from '../store';
import type { EmbedModel, GenModel } from 'papa-ts';

export class OpenAIBaseProvider extends ProviderBase {
    readonly isLocal = false;

    async isSetuped(): Promise<boolean> {
        const t = get(_);
        try {
            const response = await requestUrl({
                method: 'GET',
                url: `https://api.openai.com/v1/models`,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiConfig}`,
                },
            });
            return response.status === 200;
        } catch (error) {
            new Notice(t('notice.openai_key'), 4000);
            return false;
        }
    }
}

async function getOpenAIModels(apiKey: string, models: { [model: string]: GenModelSettings | EmbedModelSettings }) {
    try {
        const modelRes = await requestUrl({
            method: 'GET',
            url: `https://api.openai.com/v1/models`,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
        });
        return modelRes.json.data.map((model: { id: string }) => model.id).filter((id: string) => Object.keys(models).includes(id));
    } catch (error) {
        Log.debug('OpenAI is not running', error);
        return [];
    }
}

export class OpenAIGenProvider extends Provider<GenModelSettings, GenModel> {
    models = {
        'gpt-3.5-turbo': { temperature: 0.5, contextWindow: 16385 },
        'gpt-4': { temperature: 0.5, contextWindow: 8192 },
        'gpt-4-32k': { temperature: 0.5, contextWindow: 32768 },
        'gpt-4-turbo-preview': { temperature: 0.5, contextWindow: 128000 },
    };
    getPapaModel() {
        return {
            model: this.selectedModel,
            ...this.getModelSettings(),
            openAIApiKey: get(data).providerSettings['OpenAI'].getConfig(),
        };
    }

    async getModels(): Promise<string[]> {
        return getOpenAIModels(get(data).providerSettings['OpenAI'].getConfig(), this.models);
    }
}

export class OpenAIEmbedProvider extends Provider<EmbedModelSettings, EmbedModel> {
    models = {
        'text-embedding-ada-002': { similarityThreshold: 0.75 },
        'text-embedding-3-large': { similarityThreshold: 0.5 },
        'text-embedding-3-small': { similarityThreshold: 0.5 },
    };
    getPapaModel() {
        return {
            model: this.selectedModel,
            ...this.getModelSettings(),
            openAIApiKey: get(data).providerSettings['OpenAI'].getConfig(),
        };
    }

    async getModels(): Promise<string[]> {
        return getOpenAIModels(get(data).providerSettings['OpenAI'].getConfig(), this.models);
    }
}
