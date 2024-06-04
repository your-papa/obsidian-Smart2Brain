import { ProviderBase, Provider, type EmbedModelSettings, type GenModelSettings } from './Provider';
import Log from '../logging';
import { requestUrl, Notice } from 'obsidian';
import { cancelPullModel, data, errorState, papaState, plugin } from '../store';
import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';
import type { GenModel, EmbedModel } from 'papa-ts';

export type OllamaSettings = {
    baseUrl: string;
};

export class OllamaBaseProvider extends ProviderBase<OllamaSettings> {
    readonly isLocal = true;

    async isSetuped(): Promise<boolean> {
        const t = get(_);
        try {
            const response = await fetch(this.apiConfig.baseUrl + '/api/tags');
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

    // async setSetup({ baseUrl }: IOllamaSettings) {
    //     baseUrl.trim();
    //     if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    //     this.baseUrl = baseUrl;
    //     await get(plugin).saveSettings();
    //     papaState.set('settings-change');
    // }

    async isOllamaRunning() {
        try {
            new URL(this.apiConfig.baseUrl);
            const response = await requestUrl(this.apiConfig.baseUrl + '/api/tags');
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

    async getModels(): Promise<string[]> {
        try {
            const modelsRes = await requestUrl({
                url: this.apiConfig + '/api/tags',
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

    async deleteOllamaModel(model: string): Promise<boolean> {
        const t = get(_);
        try {
            const modelsRes = await requestUrl({
                url: `${this.apiConfig}/api/pull`,
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
            const response = await fetch(`${this.apiConfig}/api/pull`, {
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
}

export class OllamaGenProvider extends Provider<GenModelSettings, GenModel> {
    models = {
        llama2: { temperature: 0.5, contextWindow: 4096 },
        'llama2-uncensored': { temperature: 0.5, contextWindow: 4096 },
        mistral: { temperature: 0.5, contextWindow: 8000 },
        'mistral-openorca': { temperature: 0.5, contextWindow: 8000 },
        gemma: { temperature: 0.5, contextWindow: 8000 },
        mixtral: { temperature: 0.5, contextWindow: 32000 },
        'dolphin-mixtral': { temperature: 0.5, contextWindow: 32000 },
        phi: { temperature: 0.5, contextWindow: 2048 },
    };

    async setModel(model: string) {
        this.selectedModel = model;
        const { s2b, saveSettings } = get(plugin);
        const installedOllamaModels = await get(data).providerSettings['Ollama'].getModels();
        await saveSettings();
        if (!installedOllamaModels.includes(model)) {
            papaState.set('error');
            errorState.set('ollama-gen-model-not-installed');
            new Notice(get(_)('notice.ollama_gen_model'), 4000);
            return;
        }
        s2b.setGenModel(this.getPapaModel());
    }
}

export class OllamaEmbedProvider extends Provider<EmbedModelSettings, EmbedModel> {
    models = {
        'nomic-embed-text': { similarityThreshold: 0.5 },
        'mxbai-embed-large': { similarityThreshold: 0.5 },
    };

    async setModel(model: string) {
        this.selectedModel = model;
        const installedOllamaModels = await get(data).providerSettings['Ollama'].getModels();
        await get(plugin).saveSettings();
        if (!installedOllamaModels.includes(model)) {
            papaState.set('error');
            errorState.set('ollama-embed-model-not-installed');
            new Notice(get(_)('notice.ollama_embed_model'), 4000);
            return;
        }
        papaState.set('settings-change');
    }
}
