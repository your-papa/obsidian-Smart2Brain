import { get } from 'svelte/store';
import { nanoid } from 'nanoid';
import { chatHistory as cH, isEditing, plugin as p, serializeChatHistory } from '../globals/store';

export async function runSecondBrainFromChat(isRAG: boolean, userQuery: string) {
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
    }
    plugin.chatView.requestSave();
}
