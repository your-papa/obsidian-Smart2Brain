import { writable } from 'svelte/store';

export type Message = {
    role: 'system' | 'assistant' | 'user';
    content: string;
    context: string | null;
};

export let messages = writable<Message[]>([{ role: 'system', content: 'Hi, this is your Second Brain!', context: null }]);
