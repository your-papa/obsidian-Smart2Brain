import { get, writable } from 'svelte/store';
import type SecondBrainPlugin from './main';
import { DEFAULT_SETTINGS, type PluginData } from './main';
import { nanoid } from 'nanoid';

export type ChatMessage = {
    role: 'Assistant' | 'User';
    content: string;
    id: string;
};
export const plugin = writable<SecondBrainPlugin>();
export const data = writable<PluginData>();

export const isEditing = writable<boolean>(false);
export const isEditingAssistantMessage = writable<boolean>();
export const chatInput = writable<string>('');
export const isChatInSidebar = writable<boolean>(true);

export type ErrorState = 'ollama-model-not-installed' | 'ollama-not-running' | 'ollama-origins-not-set';
export const errorState = writable<ErrorState>();

export type PapaState =
    | 'idle'
    | 'loading'
    | 'indexing'
    | 'indexing-pause'
    | 'running'
    | 'running-stop'
    | 'error'
    | 'uninitialized'
    | 'mode-change'
    | 'settings-change';
export const papaState = writable<PapaState>('uninitialized');
export const papaIndexingProgress = writable<number>(0);

// Does this work? / refactoring
export const serializeChatHistory = (cH: ChatMessage[]) =>
    cH
        .map((chatMessage: ChatMessage) => {
            if (chatMessage.role === 'User') return `${chatMessage.role}: ${chatMessage.content}`;
            else if (chatMessage.role === 'Assistant') return `${chatMessage.role}: ${chatMessage.content}`;
            return `${chatMessage.content}`;
        })
        .join('\n');

function createChatHistory() {
    const { subscribe, set, update } = writable<ChatMessage[]>();

    return {
        subscribe,
        set,
        update,
        reset: () => {
            set([
                {
                    role: 'Assistant',
                    content: DEFAULT_SETTINGS.initialAssistantMessageContent,
                    id: nanoid(),
                },
            ]);
            get(plugin).chatView.save();
        },
    };
}

export const chatHistory = createChatHistory();
