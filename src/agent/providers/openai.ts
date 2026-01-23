import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ProviderAuthError, ProviderEndpointError, ProviderImportError } from "./errors";
import { createChatFactories, createEmbeddingFactories, firstKey } from "./helpers";
import type {
	BuiltInProviderModelMap,
	BuiltInProviderModelMapEntry,
	BuiltInProviderOptions,
	ChatModelFactory,
	EmbeddingModelFactory,
	ProviderDefinition,
} from "./types";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export async function createOpenAIProviderDefinition(options?: BuiltInProviderOptions): Promise<ProviderDefinition> {
	const { chatEntries, embeddingEntries } = await resolveOpenAIModelEntries(options);

	return {
		chatModels: createChatFactories(chatEntries, (descriptor) => createOpenAIChatFactory(descriptor, options)),
		embeddingModels: createEmbeddingFactories(embeddingEntries, (descriptor) =>
			createOpenAIEmbeddingFactory(descriptor, options),
		),
		defaultChatModel: options?.defaultChatModel ?? firstKey(chatEntries),
		defaultEmbeddingModel: options?.defaultEmbeddingModel ?? firstKey(embeddingEntries),
	};
}

function createOpenAIChatFactory(
	descriptor: BuiltInProviderModelMapEntry,
	providerOptions?: BuiltInProviderOptions,
): ChatModelFactory {
	return async (options) => {
		try {
			return new ChatOpenAI({
				model: descriptor.model,
				...buildOpenAIClientOptions(providerOptions),
				...(descriptor.options ?? {}),
				...(options ?? {}),
			});
		} catch (error) {
			throw new ProviderImportError("openai", "@langchain/openai", error);
		}
	};
}

function createOpenAIEmbeddingFactory(
	descriptor: BuiltInProviderModelMapEntry,
	providerOptions?: BuiltInProviderOptions,
): EmbeddingModelFactory {
	return async (options) => {
		try {
			return new OpenAIEmbeddings({
				model: descriptor.model,
				...buildOpenAIClientOptions(providerOptions),
				...(descriptor.options ?? {}),
				...(options ?? {}),
			});
		} catch (error) {
			throw new ProviderImportError("openai", "@langchain/openai", error);
		}
	};
}

async function resolveOpenAIModelEntries(options?: BuiltInProviderOptions): Promise<{
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

	const discovered = await fetchOpenAIModels(options);
	return {
		chatEntries: providedChatModels ?? discovered.chatModels,
		embeddingEntries: providedEmbeddingModels ?? discovered.embeddingModels,
	};
}

async function fetchOpenAIModels(options?: BuiltInProviderOptions): Promise<{
	chatModels: BuiltInProviderModelMap;
	embeddingModels: BuiltInProviderModelMap;
}> {
	const apiKey = options?.apiKey;
	if (!apiKey) {
		throw new Error("OpenAI model discovery requires an API key. Pass options.apiKey.");
	}

	const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) {
		throw new Error(
			"Global fetch implementation missing. Provide options.fetchImpl to createOpenAIProviderDefinition.",
		);
	}

	const baseUrl = sanitizeBaseUrl(options?.baseUrl ?? OPENAI_DEFAULT_BASE_URL);
	let response: Response;
	try {
		response = await fetchImpl(`${baseUrl}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				...(options?.organization ? { "OpenAI-Organization": options.organization } : {}),
				...(options?.project ? { "OpenAI-Project": options.project } : {}),
				...(options?.headers ?? {}),
			},
		});
	} catch (error) {
		throw toEndpointError("openai", error);
	}

	if (!response.ok) {
		const errorBody = await safeReadText(response);
		let errorCode: string | undefined;
		let errorMessage: string | undefined;
		try {
			const parsed = errorBody
				? (JSON.parse(errorBody) as {
						error?: { code?: string; message?: string };
					})
				: undefined;
			errorCode = parsed?.error?.code;
			errorMessage = parsed?.error?.message;
		} catch {
			// ignore parse errors
		}
		if (response.status === 401 || response.status === 403 || errorCode === "invalid_api_key") {
			throw new ProviderAuthError("openai", response.status, errorCode, errorMessage);
		}
		throw new Error(
			`OpenAI model discovery failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
		);
	}

	const payload = (await response.json()) as OpenAIModelResponse;
	const resources = Array.isArray(payload.data) ? payload.data : [];

	if (resources.length === 0) {
		throw new Error("OpenAI did not return any models for the provided credentials.");
	}

	const models: BuiltInProviderModelMap = {};

	for (const resource of resources) {
		const id = typeof resource?.id === "string" ? resource.id.trim() : undefined;
		if (!id) {
			continue;
		}

		models[id] = id;
	}

	if (!Object.keys(models).length) {
		throw new Error("OpenAI did not return any models. Specify options.chatModels to override.");
	}

	// Return all models in both maps - let users choose which model to use for each purpose
	return { chatModels: models, embeddingModels: models };
}

function sanitizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

function buildOpenAIClientOptions(options?: BuiltInProviderOptions): Record<string, unknown> {
	const clientOptions: Record<string, unknown> = {};
	if (options?.apiKey) {
		clientOptions.apiKey = options.apiKey;
	}
	if (options?.baseUrl) {
		clientOptions.configuration = { baseURL: options.baseUrl };
	}
	if (options?.organization) {
		clientOptions.organization = options.organization;
	}
	if (options?.project) {
		clientOptions.project = options.project;
	}
	return clientOptions;
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

interface OpenAIModelResponse {
	data?: OpenAIModelResource[];
}

interface OpenAIModelResource {
	id?: string;
	object?: string;
}
