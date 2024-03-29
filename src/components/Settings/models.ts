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

export const OpenAIGenModelNames = Object.keys(OpenAIGenModels);
export const OllamaGenModelNames = Object.keys(OllamaGenModels);
export const OpenAIEmbedModelNames = ['text-embedding-3-large', 'text-embedding-3-small', 'text-embedding-ada-002'];
export const OllamaEmbedModelNames = ['nomic-embed-text', 'mxbai-embed-large'];
