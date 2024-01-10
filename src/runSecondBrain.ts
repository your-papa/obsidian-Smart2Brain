import { get } from 'svelte/store';
import { nanoid } from 'nanoid';
import { type ChatMessage, chatHistory as cH, plugin as p } from './main';

export default async function runSecondBrain(isRAG: boolean, userQuery: string) {
    const plugin = get(p);

    const serializedChatHistory = get(cH)
        .map((chatMessage: ChatMessage) => {
            if (chatMessage.role === 'User') return `${chatMessage.role}: ${chatMessage.content}`;
            else if (chatMessage.role === 'Assistant') return `${chatMessage.role}: ${chatMessage.content}`;
            return `${chatMessage.content}`;
        })
        .join('\n');
    const responseStream = plugin.secondBrain.run({ isRAG, userQuery, chatHistory: serializedChatHistory, lang: plugin.data.assistantLanguage });

    let chatHistory = get(cH);
    cH.set([...chatHistory, { role: 'User', content: userQuery, id: nanoid() }]);
    chatHistory = get(cH);

    for await (const response of responseStream) {
        cH.set([...chatHistory, { role: 'Assistant', content: response.content, id: nanoid() }]);
    }
    plugin.chatView.requestSave();
}
