import { writable } from 'svelte/store';
import { SecondBrain } from 'second-brain-ts';
import type BrainPlugin from './main';

export type Message = {
    role: 'System' | 'Assistant' | 'User';
    content: string;
};

export let messages = writable<Message[]>([]);

export let secondBrain = writable<SecondBrain>();

export const plugin = writable<BrainPlugin>();
