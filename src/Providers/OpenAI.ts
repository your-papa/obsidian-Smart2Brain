import { Notice, requestUrl } from 'obsidian';
import { type Provider } from './Provider';
import Log from '../logging';
import { _ } from 'svelte-i18n';
import { get } from 'svelte/store';
import { plugin } from '../store';

export class OpenAI implements Provider {
    name = 'OpenAI';
    rcmdGenModel = 'gpt-4';
    otherGenModels = ['gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gpt-4-turbo-preview'];
    rcmdEmbedModel = 'text-embedding-3-large';
    otherEmbedModels = ['text-embedding-ada-002', 'text-embedding-3-small'];
    isLocal = false;
    apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    getSetup(): string {
        return this.apiKey;
    }

    async isSetup(): Promise<boolean> {
        const t = get(_);
        try {
            const response = await requestUrl({
                method: 'GET',
                url: `https://api.openai.com/v1/models`,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
            });
            return response.status === 200;
        } catch (error) {
            new Notice(t('notice.openai_key'), 4000);
            return false;
        }
    }

    changeSetup(apiKey: string): void {
        const { saveSettings } = get(plugin);
        apiKey.trim();
        this.apiKey = apiKey;
        saveSettings();
    }

    async getModels(): Promise<string[]> {
        try {
            const modelRes = await requestUrl({
                method: 'GET',
                url: `https://api.openai.com/v1/models`,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
            });
            return modelRes.json.data
                .map((model: { id: string }) => model.id)
                .filter(
                    (id) => id === this.rcmdEmbedModel || this.otherEmbedModels.includes(id) || id === this.rcmdGenModel || this.otherGenModels.includes(id)
                );
        } catch (error) {
            Log.debug('OpenAI is not running', error);
            return [];
        }
    }
    setGenModel: (model: string) => void;
    setEmbedModel: (model: string) => void;

    toString(): string {
        return 'OpenAI';
    }
}
