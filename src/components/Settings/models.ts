// TODO translate model descriptions
export const OpenAIGenModels = {
    'gpt-3.5-turbo': {
        contextWindow: 4096,
        description: 'GPT-3.5 Turbo (4096 Tokens)',
    },
    'gpt-3.5-turbo-1106': {
        contextWindow: 16385,
        description: 'Latest GPT-3.5 Turbo (16385 Tokens)',
    },
    'gpt-4': {
        contextWindow: 8192,
        description: 'GPT-4 (8192 Tokens)',
    },
    'gpt-4-32k': {
        contextWindow: 32768,
        description: 'GPT-4 (32768 Tokens)',
    },
    'gpt-4-1106-preview': {
        contextWindow: 128000,
        description: 'Latest GPT-4 (128000 Tokens)',
    },
};

export const OllamaGenModels = {
    llama2: {
        contextWindow: 4096,
        description: 'Llama 2 is a collection of foundation language models ranging from 7B to 70B parameters.',
    },
    'llama2-uncensored': {
        contextWindow: 4096,
        description: 'Uncensored Llama 2 model by George Sung and Jarrad Hope.',
    },
    mistral: {
        contextWindow: 8000,
        description: 'The 7B model released by Mistral AI, updated to version 0.2.',
    },
    'mistral-openorca': {
        contextWindow: 8000,
        description: 'Mistral OpenOrca is a 7 billion parameter model, fine-tuned on top of the Mistral 7B model using the OpenOrca dataset.',
    },
    gemma: {
        contextWindow: 8000,
        description: 'Gemma is a family of lightweight, state-of-the-art open models built by Google DeepMind.',
    },
    mixtral: {
        contextWindow: 32000,
        description: 'A high-quality Mixture of Experts (MoE) model with open weights by Mistral AI.',
    },
    'dolphin-mixtral': {
        contextWindow: 32000,
        description: 'Dolphin Mixtral (32000 Tokens)',
    },
    phi: {
        contextWindow: 2048,
        description: 'Phi-2: a 2.7B language model by Microsoft Research that demonstrates outstanding reasoning and language understanding capabilities.',
    },
};

export const OpenAIEmbedModels = {
    'text-embedding-ada-002': {
        contextWindow: 8191,
        description: 'Text Embedding ADA 002',
    },
};

export const OllamaEmbedModels = {
    'nomic-embed-text': {
        description: 'A high-performing open embedding model with a large token context window.',
        contextWindow: 8192,
    },
};

export const OpenAIGenModelNames = Object.keys(OpenAIGenModels);
export const OllamaGenModelNames = Object.keys(OllamaGenModels);
export const OpenAIEmbedModelNames = Object.keys(OpenAIEmbedModels);
export const OllamaEmbedModelNames = Object.keys(OllamaEmbedModels);
