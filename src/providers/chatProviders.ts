import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	AIMessage,
	AIMessageChunk,
	type BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { createAiProviderFetch } from "../lib/aiTransport";
import { createObsidianFetch } from "../lib/obsidianFetch";
import { ChatOpenAIResponses, type ChatOpenAIResponsesConfig } from "./langchainOpenAIResponses";

function parseToolArgs(args: unknown): Record<string, unknown> {
	if (typeof args === "string") {
		try {
			return JSON.parse(args) as Record<string, unknown>;
		} catch {
			return {};
		}
	}
	if (args && typeof args === "object" && !Array.isArray(args)) {
		return args as Record<string, unknown>;
	}
	return {};
}

function parseAdditionalToolCalls(
	additionalKwargs: unknown,
): { id: string; name: string; args: Record<string, unknown> }[] | undefined {
	if (!additionalKwargs || typeof additionalKwargs !== "object" || Array.isArray(additionalKwargs)) {
		return undefined;
	}

	const rawToolCalls = (additionalKwargs as { tool_calls?: unknown }).tool_calls;
	if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) {
		return undefined;
	}

	return rawToolCalls
		.filter((tc): tc is Record<string, unknown> => tc && typeof tc === "object")
		.map((tc) => {
			const functionPayload =
				tc.function && typeof tc.function === "object" ? (tc.function as Record<string, unknown>) : undefined;

			return {
				id: typeof tc.id === "string" ? tc.id : "",
				name:
					typeof tc.name === "string"
						? tc.name
						: typeof functionPayload?.name === "string"
							? functionPayload.name
							: "",
				args: parseToolArgs(tc.args ?? tc.arguments ?? functionPayload?.arguments),
			};
		})
		.filter((tc) => tc.id || tc.name);
}

function normalizeToolCallMessage<TMessage>(message: TMessage): TMessage {
	if (!message || typeof message !== "object") {
		return message;
	}

	const baseMessage = message as unknown as BaseMessage & {
		tool_calls?: unknown;
		additional_kwargs?: unknown;
		response_metadata?: unknown;
	};
	const messageType = typeof baseMessage._getType === "function" ? baseMessage._getType() : undefined;
	if (messageType !== "generic") {
		return message;
	}

	const toolCalls = parseAdditionalToolCalls(baseMessage.additional_kwargs);
	if (!toolCalls?.length) {
		return message;
	}

	const payload = {
		content: toolCalls.length > 0 ? "" : baseMessage.content,
		id: baseMessage.id,
		tool_calls: toolCalls,
		additional_kwargs:
			baseMessage.additional_kwargs && typeof baseMessage.additional_kwargs === "object"
				? (() => {
						const nextAdditionalKwargs = {
							...(baseMessage.additional_kwargs as Record<string, unknown>),
						};
						delete nextAdditionalKwargs.tool_calls;
						return nextAdditionalKwargs;
					})()
				: {},
		response_metadata:
			baseMessage.response_metadata && typeof baseMessage.response_metadata === "object"
				? { ...(baseMessage.response_metadata as Record<string, unknown>) }
				: {},
	};

	if (typeof (message as { concat?: unknown }).concat === "function") {
		return new AIMessageChunk(payload) as TMessage;
	}

	return new AIMessage(payload) as TMessage;
}

function normalizeInputMessage<TMessage>(message: TMessage): TMessage {
	if (!message || typeof message !== "object") {
		return message;
	}

	const normalizedGeneric = normalizeToolCallMessage(message);
	if (!normalizedGeneric || typeof normalizedGeneric !== "object") {
		return normalizedGeneric;
	}

	const baseMessage = normalizedGeneric as unknown as BaseMessage & {
		tool_calls?: unknown;
		tool_call_id?: unknown;
		additional_kwargs?: unknown;
		response_metadata?: unknown;
	};
	const messageType = typeof baseMessage._getType === "function" ? baseMessage._getType() : undefined;
	const additionalKwargs =
		baseMessage.additional_kwargs && typeof baseMessage.additional_kwargs === "object"
			? { ...(baseMessage.additional_kwargs as Record<string, unknown>) }
			: {};
	const responseMetadata =
		baseMessage.response_metadata && typeof baseMessage.response_metadata === "object"
			? { ...(baseMessage.response_metadata as Record<string, unknown>) }
			: {};

	switch (messageType) {
		case "ai_chunk":
		case "AIMessageChunk": {
			return new AIMessage({
				content: baseMessage.content,
				id: baseMessage.id,
				tool_calls: Array.isArray(baseMessage.tool_calls) ? baseMessage.tool_calls : [],
				additional_kwargs: additionalKwargs,
				response_metadata: responseMetadata,
			}) as TMessage;
		}
		case "tool": {
			return new ToolMessage({
				content: baseMessage.content,
				id: baseMessage.id,
				tool_call_id: typeof baseMessage.tool_call_id === "string" ? baseMessage.tool_call_id : "",
				additional_kwargs: additionalKwargs,
				response_metadata: responseMetadata,
			}) as TMessage;
		}
		case "human": {
			return new HumanMessage({
				content: baseMessage.content,
				id: baseMessage.id,
				additional_kwargs: additionalKwargs,
				response_metadata: responseMetadata,
			}) as TMessage;
		}
		case "system": {
			return new SystemMessage({
				content: baseMessage.content,
				id: baseMessage.id,
				additional_kwargs: additionalKwargs,
				response_metadata: responseMetadata,
			}) as TMessage;
		}
		default:
			return normalizedGeneric;
	}
}

function normalizeInputPayload<TInput>(input: TInput): TInput {
	if (Array.isArray(input)) {
		return input.map((entry) => normalizeInputPayload(entry)) as TInput;
	}

	return normalizeInputMessage(input);
}

function wrapAsyncIterable<T>(iterable: AsyncIterable<T>, normalize: (value: T) => T): AsyncIterable<T> {
	return {
		[Symbol.asyncIterator]: async function* () {
			for await (const value of iterable) {
				yield normalize(value);
			}
		},
	};
}

function createNormalizedChatModel<TModel extends BaseChatModel>(model: TModel): TModel {
	return new Proxy(model, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);

			if (prop === "bindTools" && typeof value === "function") {
				return (...args: unknown[]) => createNormalizedChatModel(value.apply(target, args) as TModel);
			}

			if (prop === "withConfig" && typeof value === "function") {
				return (...args: unknown[]) => createNormalizedChatModel(value.apply(target, args) as TModel);
			}

			if (prop === "invoke" && typeof value === "function") {
				return async (...args: unknown[]) => {
					const normalizedArgs = args.length > 0 ? [normalizeInputPayload(args[0]), ...args.slice(1)] : args;
					return normalizeToolCallMessage(await value.apply(target, normalizedArgs));
				};
			}

			if (prop === "stream" && typeof value === "function") {
				return async (...args: unknown[]) => {
					const normalizedArgs = args.length > 0 ? [normalizeInputPayload(args[0]), ...args.slice(1)] : args;
					return wrapAsyncIterable(await value.apply(target, normalizedArgs), normalizeToolCallMessage);
				};
			}

			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as TModel;
}

export function createTransportedChatOpenAI(
	providerId: string,
	config: ConstructorParameters<typeof ChatOpenAI>[0],
): ChatOpenAI {
	const baseConfig = config ?? {};
	const nextConfig = {
		...baseConfig,
		configuration: {
			...(baseConfig.configuration ?? {}),
			fetch: baseConfig.configuration?.fetch ?? createAiProviderFetch(providerId),
		},
	};

	return createNormalizedChatModel(new ChatOpenAI(nextConfig));
}

export function createTransportedChatOpenAIResponses(
	providerId: string,
	config: ChatOpenAIResponsesConfig,
): BaseChatModel {
	const baseConfig = config ?? {};
	const nextConfig = {
		...baseConfig,
		configuration: {
			...(baseConfig.configuration ?? {}),
			fetch: baseConfig.configuration?.fetch ?? createAiProviderFetch(providerId),
		},
	};

	return createNormalizedChatModel(new ChatOpenAIResponses(nextConfig));
}

export function createTransportedChatAnthropic(
	providerId: string,
	config: ConstructorParameters<typeof ChatAnthropic>[0],
): ChatAnthropic {
	const baseConfig = config ?? {};
	const nextConfig = {
		...baseConfig,
		clientOptions: {
			...(baseConfig.clientOptions ?? {}),
			fetch: baseConfig.clientOptions?.fetch ?? createAiProviderFetch(providerId),
		},
	};

	return createNormalizedChatModel(new ChatAnthropic(nextConfig));
}

export function createTransportedChatOllama(
	providerId: string,
	config: ConstructorParameters<typeof ChatOllama>[0],
): ChatOllama {
	const baseConfig = config ?? {};
	return createNormalizedChatModel(
		new ChatOllama({
			...baseConfig,
			fetch: baseConfig.fetch ?? createAiProviderFetch(providerId),
		}),
	);
}

export function createTransportedOpenAIEmbeddings(
	providerId: string,
	config: ConstructorParameters<typeof OpenAIEmbeddings>[0],
): OpenAIEmbeddings {
	const baseConfig = config ?? {};
	const configuration = (baseConfig.configuration as Record<string, unknown>) ?? {};
	return new OpenAIEmbeddings({
		...baseConfig,
		configuration: {
			...configuration,
			fetch: (configuration.fetch as typeof fetch | undefined) ?? createObsidianFetch(),
		},
	});
}

export function createTransportedOllamaEmbeddings(
	providerId: string,
	config: ConstructorParameters<typeof OllamaEmbeddings>[0],
): OllamaEmbeddings {
	const baseConfig = config ?? {};
	return new OllamaEmbeddings({
		...baseConfig,
		fetch: baseConfig.fetch ?? createObsidianFetch(),
	});
}
