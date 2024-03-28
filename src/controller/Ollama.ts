import { Notice, requestUrl } from 'obsidian';
import { plugin as p, data, papaState, cancelPullModel } from '../store';
import { get } from 'svelte/store';
import Log from '../logging';
import { _ } from 'svelte-i18n';
import { OllamaGenModels } from '../components/Settings/models';
import { errorState } from '../store';

export async function isOllamaRunning() {
    const d = get(data);
    try {
        new URL(d.ollamaGenModel.baseUrl);
        const response = await requestUrl(d.ollamaGenModel.baseUrl + '/api/tags');
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

export async function isOllamaOriginsSet() {
    const d = get(data);
    try {
        const response = await fetch(d.ollamaGenModel.baseUrl + '/api/tags');
        if (response.status === 200) {
            return true;
        } else {
            Log.debug(`Unexpected status code: ${response.status}`);
            return false;
        }
    } catch (error) {
        Log.debug('Ollama is not running or origins not correctly set', error);
        return false;
    }
}

export async function getOllamaModels(): Promise<string[]> {
    const d = get(data);
    try {
        const modelsRes = await requestUrl({
            url: d.ollamaGenModel.baseUrl + '/api/tags',
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

export async function ollamaGenChange(selected: string) {
    const plugin = get(p);
    const d = get(data);
    const installedOllamaModels = await getOllamaModels();
    data.update((data) => {
        data.ollamaGenModel.model = selected;
        data.ollamaGenModel.contextWindow = OllamaGenModels[selected] ? OllamaGenModels[selected].contextWindow : 2048;
        return data;
    });
    plugin.saveSettings();
    if (!installedOllamaModels.includes(selected)) {
        papaState.set('error');
        errorState.set('ollama-gen-model-not-installed');
        return;
    }
    plugin.s2b.setGenModel(d.openAIGenModel);
}

export async function ollamaEmbedChange(selected: string) {
    const plugin = get(p);
    const installedOllamaModels = await getOllamaModels();
    data.update((data) => {
        data.ollamaGenModel.model = selected;
        data.ollamaGenModel.contextWindow = OllamaGenModels[selected] ? OllamaGenModels[selected].contextWindow : 2048;
        return data;
    });
    plugin.saveSettings();
    if (!installedOllamaModels.includes(selected)) {
        papaState.set('error');
        errorState.set('ollama-embed-model-not-installed');
        return;
    }
    papaState.set('settings-change');
}

export const changeOllamaBaseUrl = async (newBaseUrl: string) => {
    const d = get(data);
    const plugin = get(p);
    newBaseUrl.trim();
    if (newBaseUrl.endsWith('/')) newBaseUrl = newBaseUrl.slice(0, -1);
    d.ollamaGenModel.baseUrl = newBaseUrl;
    d.ollamaEmbedModel.baseUrl = newBaseUrl;
    await plugin.saveSettings();
    papaState.set('settings-change');
};

export async function deleteOllamaModels(model: string): Promise<boolean> {
    const d = get(data);
    const t = get(_);
    try {
        const modelsRes = await requestUrl({
            url: d.ollamaGenModel.baseUrl + '/api/delete',
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

export async function* pullOllamaModel(model: string) {
    const t = get(_);
    Log.info('Pulling model from Ollama', model);
    try {
        const response = await fetch(`${get(data).ollamaEmbedModel.baseUrl}/api/pull`, {
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
