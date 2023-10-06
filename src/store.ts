import { writable } from 'svelte/store';

export type Message = {
    user: boolean;
    text: string;
};

export const chatMessages = writable<Message[]>([
    { user: false, text: 'Hello' },
    { user: true, text: 'Hi' },
    { user: false, text: 'How are you?' },
    { user: true, text: 'Good, you?' },
    { user: false, text: "I'm good, thanks!" },
]);
export const chatUserInput = writable<string>('');
