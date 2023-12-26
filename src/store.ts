import { writable } from 'svelte/store';
import type BrainPlugin from './main';

export type Message = {
    role: 'System' | 'Assistant' | 'User';
    content: string;
};

export let messages = writable<Message[]>([]);

export const plugin = writable<BrainPlugin>();
