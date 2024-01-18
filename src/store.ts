import { writable } from 'svelte/store';
import type SecondBrainPlugin from './main';

export type ChatMessage = {
    role: 'Assistant' | 'User';
    content: string;
    id: string;
};
export const plugin = writable<SecondBrainPlugin>();
export const chatHistory = writable<ChatMessage[]>([]);
export const isEditing = writable<boolean>(false);
export const isEditingAssistantMessage = writable<boolean>(false);
export const chatInput = writable<string>('');

// Does this work? / refactoring
export const serializeChatHistory = (cH: ChatMessage[]) =>
    cH
        .map((chatMessage: ChatMessage) => {
            if (chatMessage.role === 'User') return `${chatMessage.role}: ${chatMessage.content}`;
            else if (chatMessage.role === 'Assistant') return `${chatMessage.role}: ${chatMessage.content}`;
            return `${chatMessage.content}`;
        })
        .join('\n');
