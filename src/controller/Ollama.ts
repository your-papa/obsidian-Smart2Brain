import { requestUrl } from 'obsidian';
import { plugin as p } from '../store';
import { get } from 'svelte/store';
import Log from '../logging';

export async function isOllamaRunning() {
    try {
        const response = await requestUrl(get(p).data.ollamaGenModel.baseUrl + '/api/tags');
        return response.status === 200;
    } catch (error) {
        if (error.toString() === 'Error: net::ERR_CONNECTION_REFUSED') console.error('Ollama is not running', error);
        else Log.error(error); // handle better dont necessarily log error
        return false;
    }
}

export async function isOriginSet() {
    try {
        const response = await fetch(get(p).data.ollamaGenModel.baseUrl + '/api/tags');
        return response.status === 200;
    } catch (error) {
        if (error.toString() === 'Error: net::ERR_CONNECTION_REFUSED') console.error('Ollama is not running', error);
        else Log.error(error); // handle better dont necessarily log error
        return false;
    }
}

export async function getOllamaGenModel(): Promise<{ display: string; value: string }[]> {
    const plugin = get(p);
    try {
        const modelsRes = await requestUrl({
            url: plugin.data.ollamaGenModel.baseUrl + '/api/tags',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const models: string[] = modelsRes.json.models.map((model: { name: string }) => model.name);
        return models.map((model: string) => ({ display: model.replace(':latest', ''), value: model.replace(':latest', '') }));
    } catch (e) {
        if (e.toString() == 'Error: net::ERR_CONNECTION_REFUSED') {
            return [];
        }
        // TODO handle better
        Log.error(e);
    }
}

export const changeOllamaBaseUrl = (newBaseUrl: string) => {
    const plugin = get(p);
    newBaseUrl.trim();
    if (newBaseUrl.endsWith('/')) newBaseUrl = newBaseUrl.slice(0, -1);
    plugin.data.ollamaGenModel.baseUrl = newBaseUrl;
    plugin.data.ollamaEmbedModel.baseUrl = newBaseUrl;
    try {
        // check if url is valid
        new URL(plugin.data.ollamaGenModel.baseUrl);
        //styleOllamaBaseUrl = 'bg-[--background-modifier-form-field]';
    } catch (_) {
        //styleOllamaBaseUrl = 'bg-[--background-modifier-error]';
    }
    plugin.saveSettings();
};

export const ollamaEmbedChange = (selected: string) => {
    //TODO Modle types
    const plugin = get(p);
    // @ts-expect-error Have to do this
    plugin.data.ollamaEmbedModel.model = selected;
    plugin.saveSettings();
};
