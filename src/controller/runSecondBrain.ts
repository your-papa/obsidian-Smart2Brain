import { get } from 'svelte/store';
import { nanoid } from 'nanoid';
import { chatHistory as cH, isEditing, plugin as p, serializeChatHistory, papaState } from '../store';
import { Notice } from 'obsidian';

export const canRunSecondBrain = () => {
    if (get(papaState) === 'running') return new Notice('Please wait for the current query to finish', 4000) && false;
    else if (get(papaState) === 'indexing' || get(papaState) === 'indexing-paused' || get(papaState) === 'loading')
        return new Notice('Please wait for the indexing to finish', 4000) && false;
    else if (get(papaState) === 'error') return new Notice('Please wait for the error to resolve', 4000) && false;
    else if (get(papaState) !== 'idle') return new Notice('Please initialize your Smart Second Brain first', 4000) && false;
    return true;
};

export async function runSecondBrain(isRAG: boolean, userQuery: string) {
    papaState.set('running');
    const plugin = get(p);

    const responseStream = plugin.secondBrain.run({
        isRAG,
        userQuery,
        chatHistory: serializeChatHistory(get(cH)),
        lang: plugin.data.assistantLanguage,
    });
    let chatHistory = get(cH);

    if (get(isEditing)) {
        chatHistory.pop();
        isEditing.set(false);
    }
    cH.set([...chatHistory, { role: 'User', content: userQuery, id: nanoid() }]);
    chatHistory = get(cH);

    for await (const response of responseStream) {
        cH.set([...chatHistory, { role: 'Assistant', content: response.content, id: nanoid() }]);
        if (get(papaState) === 'running-stopped') {
            if (response.status !== 'Generating') cH.set([...chatHistory, { role: 'Assistant', content: 'Stopped', id: nanoid() }]);
            papaState.set('idle');
            plugin.chatView.save();
            return; // when used break it somehow returns the whole function
        }
    }
    plugin.chatView.save();
    papaState.set('idle');
}
