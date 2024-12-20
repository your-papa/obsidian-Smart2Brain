import { get, writable } from 'svelte/store';
import type SecondBrainPlugin from './main';
import { type PluginData } from './main';
import { nanoid } from 'nanoid';
import { type PapaResponseStatus, BaseProvider, type OllamaSettings, type OpenAISettings, GenProvider, EmbedProvider, type ProviderName } from 'papa-ts';

type SetupStatus = {
    [key in ProviderName]: boolean;
};

export type ChatMessage = {
    role: 'Assistant' | 'User';
    content: string;
    id: string;
};
export const plugin = writable<SecondBrainPlugin>();

export const providers = writable<{ [key: string]: BaseProvider<OllamaSettings | OpenAISettings> }>({});

function createSetupStatus() {
    const { subscribe, set, update } = writable<SetupStatus>({
        OpenAI: false,
        Ollama: false,
    });
    return {
        subscribe,
        set,
        sync: (providerName: ProviderName, value: boolean) => {
            update((d) => {
                d[providerName] = value;
                return d;
            });
        },
    };
}

export const setupStatus = createSetupStatus();

function createSelGenProvider() {
    const { subscribe, set } = writable<ProviderName>();

    return {
        subscribe,
        set,
        update: async (value: ProviderName) => {
            set(value);
            data.update((d) => {
                d.selGenProvider = value;
                return d;
            });
            await get(plugin).saveSettings();
        },
    };
}

export const selGenProvider = createSelGenProvider();

function createSelEmbedProvider() {
    const { subscribe, set } = writable<ProviderName>();

    return {
        subscribe,
        set,
        update: async (value: ProviderName) => {
            set(value);
            data.update((d) => {
                d.selEmbedProvider = value;
                return d;
            });
            await get(plugin).saveSettings();
        },
    };
}

export const selEmbedProvider = createSelEmbedProvider();

export const genProvider = writable<GenProvider>();

selGenProvider.subscribe((selGenProv) => {
    genProvider.set(new GenProvider(get(providers)[selGenProv]));
});

export const embedProvider = writable<EmbedProvider>();

selEmbedProvider.subscribe((selEmbedProv) => {
    embedProvider.set(new EmbedProvider(get(providers)[selEmbedProv]));
});

export const isEditing = writable<boolean>(false);
export const isEditingAssistantMessage = writable<boolean>();
export const chatInput = writable<string>('');
export const isChatInSidebar = writable<boolean>(true);

export type ErrorState =
    | 'ollama-gen-model-not-installed'
    | 'ollama-embed-model-not-installed'
    | 'ollama-not-running'
    | 'ollama-origins-not-set'
    | 'run-failed'
    | 'failed-indexing';
export const errorState = writable<ErrorState>();

export const runState = writable<PapaResponseStatus>('startup');
export const runContent = writable<string>('');

export type PapaState = 'idle' | 'loading' | 'indexing' | 'indexing-pause' | 'running' | 'error' | 'uninitialized' | 'mode-change' | 'settings-change';
export const papaState = writable<PapaState>('uninitialized');
export const papaIndexingProgress = writable<number>(0);
export const papaIndexingTimeLeft = writable<number>(0);

export const cancelPullModel = writable<boolean>(false);

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
                    content: get(data).initialAssistantMessageContent,
                    id: nanoid(),
                },
            ]);
            get(plugin).chatView.save();
        },
    };
}

export const chatHistory = createChatHistory();

function createData() {
    const { subscribe, set, update } = writable<PluginData>();

    return {
        subscribe,
        set,
        update,
        warningOff: (value) => {
            update((d) => {
                d[value] = true;
                return d;
            });
            get(plugin).saveSettings();
        },
    };
}

export const data = createData();
