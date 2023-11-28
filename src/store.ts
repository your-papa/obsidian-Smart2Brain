import { writable } from 'svelte/store';
import { SecondBrain } from 'second-brain-ts';
import type BrainPlugin from './main';

export type Message = {
    role: 'system' | 'assistant' | 'user';
    content: string;
    context?: string;
};

export let messages = writable<Message[]>([{ role: 'system', content: 'Hi, this is your Second Brain!', context: null }]);

export let secondBrain = writable<SecondBrain>();

export const plugin = writable<BrainPlugin>();
