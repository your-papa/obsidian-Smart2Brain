import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import type {
	BuiltInProviderModelMap,
	BuiltInProviderModelMapEntry,
	BuiltInProviderOptions,
	ChatModelFactory,
	EmbeddingModelFactory,
	ProviderDefinition,
} from "./types";
import { ProviderAuthError, ProviderEndpointError, ProviderImportError } from "./errors";
import { createChatFactories, createEmbeddingFactories, firstKey } from "./helpers";

const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";

export async function createOllamaProviderDefinition(options?: BuiltInProviderOptions): Promise<ProviderDefinition> {
	const { chatEntries, embeddingEntries } = await resolveOllamaEntries(options);

	return {
		chatModels: createChatFactories(chatEntries, (descriptor) => createOllamaChatFactory(descriptor, options)),
		embeddingModels: createEmbeddingFactories(embeddingEntries, (descriptor) =>
			createOllamaEmbeddingFactory(descriptor, options),
		),
		defaultChatModel: options?.defaultChatModel ?? firstKey(chatEntries),
		defaultEmbeddingModel: options?.defaultEmbeddingModel ?? firstKey(embeddingEntries),
	};
}

function createOllamaChatFactory(
	descriptor: BuiltInProviderModelMapEntry,
	providerOptions?: BuiltInProviderOptions,
): ChatModelFactory {
	return async (options) => {
		try {
			return new ChatOllama({
				model: descriptor.model,
				...buildOllamaClientOptions(providerOptions),
				...(descriptor.options ?? {}),
				...(options ?? {}),
			});
		} catch (error) {
			throw new ProviderImportError("ollama", "@langchain/ollama", error);
		}
	};
}

function createOllamaEmbeddingFactory(
	descriptor: BuiltInProviderModelMapEntry,
	providerOptions?: BuiltInProviderOptions,
): EmbeddingModelFactory {
	return async (options) => {
		try {
			return new OllamaEmbeddings({
				model: descriptor.model,
				...buildOllamaClientOptions(providerOptions),
				...(descriptor.options ?? {}),
				...(options ?? {}),
			});
		} catch (error) {
			throw new ProviderImportError("ollama", "@langchain/ollama", error);
		}
	};
}

async function resolveOllamaEntries(options?: BuiltInProviderOptions): Promise<{
	chatEntries: BuiltInProviderModelMap;
	embeddingEntries: BuiltInProviderModelMap;
}> {
	const providedChatModels = options?.chatModels;
	const providedEmbeddingModels = options?.embeddingModels;

	if (providedChatModels && providedEmbeddingModels) {
		return {
			chatEntries: providedChatModels,
			embeddingEntries: providedEmbeddingModels,
		};
	}

	const discovered = await fetchOllamaModels(options);
	return {
		chatEntries: providedChatModels ?? discovered.chatModels,
		embeddingEntries: providedEmbeddingModels ?? discovered.embeddingModels,
	};
}

async function fetchOllamaModels(options?: BuiltInProviderOptions): Promise<{
	chatModels: BuiltInProviderModelMap;
	embeddingModels: BuiltInProviderModelMap;
}> {
	const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) {
		throw new Error(
			"Provide options.fetchImpl when running outside environments with global fetch (e.g., Node <18).",
		);
	}

	const baseUrl = sanitizeBaseUrl(options?.baseUrl ?? OLLAMA_DEFAULT_BASE_URL);
	let response: Response;
	try {
		response = await fetchImpl(`${baseUrl}/api/tags`, {
			headers: {
				...(options?.headers ?? {}),
			},
		});
	} catch (error) {
		throw toEndpointError("ollama", error);
	}
	if (!response.ok) {
		const errorBody = await safeReadText(response);
		if (response.status === 401 || response.status === 403) {
			throw new ProviderAuthError("ollama", response.status, undefined, errorBody);
		}
		throw new Error(
			`Failed to list Ollama models via ${baseUrl}/api/tags (status ${response.status}${errorBody ? `: ${errorBody}` : ""})`,
		);
	}

	const payload = (await response.json()) as OllamaTagsResponse;
	const models = Array.isArray(payload.models) ? payload.models : [];

	if (!models.length && !options?.chatModels) {
		throw new Error(
			"Ollama did not return any locally available models. Run `ollama pull <model>` or provide options.chatModels.",
		);
	}

	const chatModels: BuiltInProviderModelMap = {};
	const embeddingModels: BuiltInProviderModelMap = {};

	for (const model of models) {
		const name = typeof model?.name === "string" ? model.name.trim() : undefined;
		if (!name) {
			continue;
		}

		if (isEmbeddingCandidate(name)) {
			embeddingModels[name] = name;
			continue;
		}

		chatModels[name] = name;
	}

	return { chatModels, embeddingModels };
}

function buildOllamaClientOptions(options?: BuiltInProviderOptions): Record<string, unknown> {
	if (!options?.baseUrl) {
		return {};
	}
	return { baseUrl: options.baseUrl };
}

function sanitizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

function isEmbeddingCandidate(name: string): boolean {
	const normalized = name.toLowerCase();
	return normalized.includes("embed") || normalized.includes("embedding");
}

async function safeReadText(response: Response): Promise<string | undefined> {
	try {
		return await response.text();
	} catch {
		return undefined;
	}
}

function toEndpointError(provider: string, error: unknown): Error {
	if (error instanceof ProviderEndpointError) {
		return error;
	}
	const message = error instanceof Error ? error.message : String(error);
	return new ProviderEndpointError(provider, message);
}

interface OllamaTagsResponse {
	models?: Array<{ name?: string }>;
}
