import { requestUrl } from 'obsidian';
import { plugin } from '../store';
import { get } from 'svelte/store';

export async function isOllamaRunning() {
    try {
        const response = await requestUrl(get(plugin).data.ollamaGenModel.baseUrl + '/api/tags');
        return response.status === 200;
    } catch (error) {
        if (error.toString() === 'Error: net::ERR_CONNECTION_REFUSED') console.error('Ollama is not running', error);
        else console.error(error);
        return false;
    }
}

export async function origingsNotSet() {
    try {
        const response = await fetch(get(plugin).data.ollamaGenModel.baseUrl + '/api/tags');
        return response.status === 200;
    } catch (error) {
        if (error.toString() === 'Error: net::ERR_CONNECTION_REFUSED') console.error('Ollama is not running', error);
        else console.error(error);
        return false;
    }
}
