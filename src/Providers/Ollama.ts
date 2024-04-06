import { Provider } from './Provider';
import Log from '../logging';
import { requestUrl, Notice } from 'obsidian';
import { cancelPullModel, data, errorState, papaState, plugin } from '../store';
import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';

export class Ollama implements Provider {
    name = 'Ollama';
    rcmdGenModel = 'llama2';
    otherGenModels = ['llama2-uncensored', 'mistral', 'mistral-openorca', 'gemma', 'mixtral', 'dolphin-mixtral', 'phi'];
    rcmdEmbedModel = 'mxbai-embed-large';
    otherEmbedModels = ['nomic-embed-text'];
    isLocal = true;
    baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    getSetup(): string {
        return this.baseUrl;
    }

    async isSetup(): Promise<boolean> {
        const t = get(_);
        try {
            const response = await fetch(this.baseUrl + '/api/tags');
            if (response.status === 200) {
                return true;
            } else {
                Log.debug(`Unexpected status code: ${response.status}`);
                new Notice(t('notice.ollama_not_running'), 4000);
                errorState.set('ollama-not-running');
                return false;
            }
        } catch (error) {
            Log.debug('Ollama is not running or origins not correctly set', error);
            new Notice(t('notice.ollama_not_running'), 4000);
            errorState.set('ollama-not-running');
            return false;
        }
    }

    async changeSetup(newBaseUrl: string) {
        newBaseUrl.trim();
        if (newBaseUrl.endsWith('/')) newBaseUrl = newBaseUrl.slice(0, -1);
        this.baseUrl = newBaseUrl;
        await get(plugin).saveSettings();
        papaState.set('settings-change');
    }

    async getModels(): Promise<string[]> {
        try {
            const modelsRes = await requestUrl({
                url: this.baseUrl + '/api/tags',
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            const models: string[] = modelsRes.json.models.map((model: { name: string }) => model.name);
            return models.map((model: string) => model.replace(':latest', ''));
        } catch (error) {
            Log.debug('Ollama is not running', error);
            return [];
        }
    }

    async setGenModel(model: string): Promise<void> {
        const { s2b, saveSettings } = get(plugin);
        const installedOllamaModels = await this.getModels();
        get(data).genModel = model;
        await saveSettings();
        if (!installedOllamaModels.includes(model)) {
            papaState.set('error');
            errorState.set('ollama-gen-model-not-installed');
            return;
        }
        s2b.setGenModel();
    }

    async setEmbedModel(model: string): Promise<void> {
        const installedOllamaModels = await this.getModels();
        get(data).embedModel = model;
        await get(plugin).saveSettings();
        if (!installedOllamaModels.includes(model)) {
            papaState.set('error');
            errorState.set('ollama-embed-model-not-installed');
            return;
        }
        papaState.set('settings-change');
    }

    async isOllamaRunning() {
        try {
            new URL(this.baseUrl);
            const response = await requestUrl(this.baseUrl + '/api/tags');
            if (response.status === 200) {
                return true;
            } else {
                Log.debug(`IsOllamaRunning, Unexpected status code: ${response.status}`);
                return false;
            }
        } catch (error) {
            Log.debug('Ollama is not running', error);
            return false;
        }
    }

    async deleteOllamaModel(model: string): Promise<boolean> {
        const t = get(_);
        try {
            const modelsRes = await requestUrl({
                url: `${this.baseUrl}/api/pull`,
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: model }),
            });
            if (modelsRes.status === 404) {
                new Notice(t('notice.no_models', { values: { model } }), 4000);
                return false;
            } else if (modelsRes.status === 200) {
                new Notice(t('notice.models_deleted', { values: { model } }), 4000);
                return true;
            }
            return false;
        } catch (error) {
            Log.debug('Ollama is not running', error);
        }
    }

    async *pullOllamaModel(model: string) {
        const t = get(_);
        Log.info('Pulling model from Ollama', model);
        try {
            const response = await fetch(`${this.baseUrl}/api/pull`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({ name: model }),
            });

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            cancelPullModel.subscribe((value: boolean) => {
                if (value) {
                    reader.cancel();
                    new Notice(t('notice.model_pull_canceled'), 1000);
                }
            });

            while (true) {
                const { done, value } = await reader.read();

                if (done) break; // Exit the loop when no more data

                const chunkText = decoder.decode(value, { stream: true });
                buffer += chunkText;

                // Process buffer if it contains line-delimited JSON objects
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep the last partial line in the buffer

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const json = JSON.parse(line);
                            yield json;
                        } catch (error) {
                            return error;
                        }
                    }
                }
            }
        } catch (error) {
            return error;
        }
    }
    toString(): string {
        return 'Ollama';
    }
}
