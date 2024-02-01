import { requestUrl } from 'obsidian';
import { get } from 'svelte/store';
import { plugin } from '../store';

export async function isAPIKeyValid() {
    try {
        const response = await requestUrl({
            method: 'GET',
            url: `https://api.openai.com/v1/models`,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${get(plugin).data.openAIGenModel.openAIApiKey}`,
            },
        });
        return response.status === 200;
    } catch (error) {
        console.log(error);
    }
}
