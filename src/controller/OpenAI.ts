import { requestUrl } from 'obsidian';

export async function isAPIKeyValid(openAIApiKey: string) {
    try {
        const response = await requestUrl({
            method: 'GET',
            url: `https://api.openai.com/v1/models`,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${openAIApiKey}`,
            },
        });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}
