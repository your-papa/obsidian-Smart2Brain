import { get } from 'svelte/store';
import { messages, plugin as p } from './store';
import type { Message } from './store';
import { nanoid } from 'nanoid';

export default async function runSecondBrain(isRAG: boolean, userQuery: string) {
    let prevMessages = get(messages);
    const plugin = get(p);

    const chatHistory = prevMessages
        .map((chatMessage: Message) => {
            if (chatMessage.role === 'System') return;
            else if (chatMessage.role === 'User') return `${chatMessage.role}: ${chatMessage.content}`;
            else if (chatMessage.role === 'Assistant') return `${chatMessage.role}: ${chatMessage.content}`;
            return `${chatMessage.content}`;
        })
        .join('\n');

    messages.set([...prevMessages, { role: 'User', content: userQuery, id: nanoid() }]);
    prevMessages = get(messages);
    messages.set([...prevMessages, { role: 'Assistant', content: '...', id: nanoid() }]);

    const responseStream = plugin.secondBrain.run({ isRAG, userQuery, chatHistory, lang: plugin.data.assistantLanguage });

    for await (const response of responseStream) {
        messages.set([...prevMessages, { role: 'Assistant', content: response.content, id: nanoid() }]);
    }
    plugin.chatView.requestSave();
}
