import { onDestroy } from 'svelte';
import { chatUserInput, chatMessages } from './store';

const unsubscribe = chatUserInput.subscribe(async (message) => {
    console.log(`message${message}`);
    message;
    chatMessages.update((messages) => [...messages, { user: true, text: message }]);
    const answer = await processMessage(message);
    chatMessages.update((messages) => [...messages, { user: false, text: answer }]);
    console.log(chatMessages);
});

function processMessage(message: string): Promise<string> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(message);
        });
    });
}

onDestroy(unsubscribe);
