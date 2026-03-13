import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatOpenAI } from "@langchain/openai";

// LangChain ships the Responses model internally but does not export it from the
// package root yet. Keep the unstable import isolated to this wrapper.
// @ts-ignore Direct node_modules file import is intentionally local to this wrapper.
import { ChatOpenAIResponses as InternalChatOpenAIResponses } from "../../node_modules/@langchain/openai/dist/chat_models/responses.js";

type ChatOpenAIResponsesConfig = ConstructorParameters<typeof ChatOpenAI>[0];

export const ChatOpenAIResponses = InternalChatOpenAIResponses as unknown as new (
	fields?: ChatOpenAIResponsesConfig,
) => BaseChatModel;

export type { ChatOpenAIResponsesConfig };
