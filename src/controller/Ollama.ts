import { Notice, requestUrl } from 'obsidian';
import { plugin, data, papaState, cancelPullModel } from '../store';
import { get } from 'svelte/store';
import Log from '../logging';
import { _ } from 'svelte-i18n';
import { errorState } from '../store';

export async function isOllamaRunning() {
    const { ollamaSettings } = get(data);
    try {
        new URL(ollamaSettings.baseUrl);
        const response = await requestUrl(ollamaSettings.baseUrl + '/api/tags');
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
    const { ollamaSettings } = get(data);
    try {
        const response = await fetch(ollamaSettings.baseUrl + '/api/tags');
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
    const { ollamaSettings } = get(data);
    try {
        const modelsRes = await requestUrl({
            url: ollamaSettings.baseUrl + '/api/tags',
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
    const { s2b, saveSettings } = get(plugin);
    const installedOllamaModels = await getOllamaModels();
    get(data).genModel = selected;
    await saveSettings();
    if (!installedOllamaModels.includes(selected)) {
        papaState.set('error');
        errorState.set('ollama-gen-model-not-installed');
        return;
    }
    s2b.setGenModel();
}

export async function ollamaEmbedChange(selected: string) {
    const installedOllamaModels = await getOllamaModels();
    get(data).genModel = selected;
    await get(plugin).saveSettings();
    if (!installedOllamaModels.includes(selected)) {
        papaState.set('error');
        errorState.set('ollama-embed-model-not-installed');
        return;
    }
    papaState.set('settings-change');
}

export const changeOllamaBaseUrl = async (newBaseUrl: string) => {
    const { ollamaSettings } = get(data);
    newBaseUrl.trim();
    if (newBaseUrl.endsWith('/')) newBaseUrl = newBaseUrl.slice(0, -1);
    ollamaSettings.baseUrl = newBaseUrl;
    await get(plugin).saveSettings();
    papaState.set('settings-change');
};

export async function deleteOllamaModels(model: string): Promise<boolean> {
    const { ollamaSettings } = get(data);
    const t = get(_);
    try {
        const modelsRes = await requestUrl({
            url: `${ollamaSettings.baseUrl}/api/pull`,
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
    const { ollamaSettings } = get(data);
    const t = get(_);
    Log.info('Pulling model from Ollama', model);
    try {
        const response = await fetch(`${ollamaSettings.baseUrl}/api/pull`, {
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
