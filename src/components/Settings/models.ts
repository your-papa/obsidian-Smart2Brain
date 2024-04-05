export const OpenAIGenModels = {
    'gpt-3.5-turbo': {
        contextWindow: 16385,
    },
    'gpt-4': {
        contextWindow: 8192,
    },
    'gpt-4-32k': {
        contextWindow: 32768,
    },
    'gpt-4-turbo-preview': {
        contextWindow: 128000,
    },
};

export const OllamaGenModels = {
    llama2: {
        contextWindow: 4096,
    },
    'llama2-uncensored': {
        contextWindow: 4096,
    },
    mistral: {
        contextWindow: 8000,
    },
    'mistral-openorca': {
        contextWindow: 8000,
    },
    gemma: {
        contextWindow: 8000,
    },
    mixtral: {
        contextWindow: 32000,
    },
    'dolphin-mixtral': {
        contextWindow: 32000,
    },
    phi: {
        contextWindow: 2048,
    },
};

export const Providers = {
    Ollama: {
        embeddingModelNames: ['nomic-embed-text', 'mxbai-embed-large'] as const,
        genModelNames: ['llama2', 'llama2-uncensored', 'mistral', 'mistral-openorca', 'gemma', 'mixtral', 'dolphin-mixtral', 'phi'] as const,
        isLocal: true,
    },
    OpenAI: {
        embeddingModelNames: ['text-embedding-3-large', 'text-embedding-3-small', 'text-embedding-ada-002'] as const,
        genModelNames: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-32k', 'gpt-4-turbo-preview'] as const,
        isLocal: false,
    },
    Anthropic: {
        embeddingModelNames: [] as const,
        genModelNames: ['claude3'] as const,
        isLocal: false,
    },
};

export type ProviderName = keyof typeof Providers;

export const ProviderNames = Object.keys(Providers);

export type EmbedModelName = (typeof Providers)[keyof typeof Providers]['embeddingModelNames'][number];
export type GenModelName = (typeof Providers)[keyof typeof Providers]['genModelNames'][number];
