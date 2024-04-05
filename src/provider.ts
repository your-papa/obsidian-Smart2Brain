export const Providers = {
    OpenAI: {
        rcmdGenModel: 'gpt-4',
        otherGenModels: ['gpt-3.5-turbo', 'gpt-4-32k', 'gpt-4-turbo-preview'],
        rcmdEmbedModel: 'text-embedding-3-large',
        otherEmbedModels: ['text-embedding-ada-002', 'text-embedding-3-small'],
        isLocal: false,
    },
    Ollama: {
        rcmdGenModel: 'llama2',
        otherGenModels: ['llama2-uncensored', 'mistral', 'mistral-openorca', 'gemma', 'mixtral', 'dolphin-mixtral', 'phi'],
        rcmdEmbedModel: 'mxbai-embed-large',
        otherEmbedModels: ['nomic-embed-text'],
        isLocal: true,
    },
};

export type Provider = keyof typeof Providers;
