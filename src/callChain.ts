import { get } from 'svelte/store';
import { messages, plugin as p } from './store';
import type { Message } from './store';
import { applyPatch } from 'fast-json-patch';
import { nanoid } from 'nanoid';

export default async function callChainfromChat(isRAG: boolean, userQuery: string) {
    const prevMessages = get(messages);
    const plugin = get(p);

    const chatHistory = prevMessages
        .map((chatMessage: Message) => {
            if (chatMessage.role === 'System') return;
            else if (chatMessage.role === 'User') return `${chatMessage.role}: ${chatMessage.content}`;
            else if (chatMessage.role === 'Assistant') return `${chatMessage.role}: ${chatMessage.content}`;
            return `${chatMessage.content}`;
        })
        .join('\n');

    messages.set([...prevMessages, { role: 'User', content: userQuery, id: nanoid() }, { role: 'System', content: '...', id: nanoid() }]);

    const responseStream = plugin.secondBrain.runRAG({ isRAG, userQuery, chatHistory, lang: plugin.data.assistantLanguage });

    let testObject = {
        streamed_output: [],
    };
    for await (const response of responseStream) {
        testObject = applyPatch(testObject, response.ops).newDocument;
        // console.log('Stream', testObject.streamed_output.join(''));
        if (testObject.streamed_output.join('') !== '') {
            const prevMessages = get(messages);
            prevMessages[prevMessages.length - 1].content = testObject.streamed_output.join('');
            prevMessages[prevMessages.length - 1].id = nanoid();
            messages.set([...prevMessages]);
        }
    }
    plugin.chatView.requestSave();
}
