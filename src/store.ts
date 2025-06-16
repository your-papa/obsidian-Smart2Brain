import { get, writable } from "svelte/store";
import type SecondBrainPlugin from "./main";
import { type PluginData } from "./main";
import { nanoid } from "nanoid";
import {
	type AssistantResponseStatus,
	type RegisteredEmbedProvider,
	type RegisteredGenProvider,
	type RegisteredProvider,
} from "papa-ts";

export type ChatMessage = {
	role: "Assistant" | "User";
	content: string;
	id: string;
};

export const isEditing = writable<boolean>(false);
export const isEditingAssistantMessage = writable<boolean>();

export type ErrorState =
	| "ollama-gen-model-not-installed"
	| "ollama-embed-model-not-installed"
	| "ollama-not-running"
	| "ollama-origins-not-set"
	| "run-failed"
	| "failed-indexing";
export const errorState = writable<ErrorState>();

export const runState = writable<AssistantResponseStatus>("startup");
export const runContent = writable<string>("");

export type PapaState =
	| "idle"
	| "loading"
	| "indexing"
	| "indexing-pause"
	| "running"
	| "error"
	| "uninitialized"
	| "mode-change"
	| "settings-change";
export const papaState = writable<PapaState>("uninitialized");
export const papaIndexingProgress = writable<number>(0);
export const papaIndexingTimeLeft = writable<number>(0);

export const cancelPullModel = writable<boolean>(false);

export const serializeChatHistory = (cH: ChatMessage[]) =>
	cH
		.map((chatMessage: ChatMessage) => {
			if (chatMessage.role === "User") return `${chatMessage.role}: ${chatMessage.content}`;
			else if (chatMessage.role === "Assistant") return `${chatMessage.role}: ${chatMessage.content}`;
			return `${chatMessage.content}`;
		})
		.join("\n");

function createChatHistory() {
	const { subscribe, set, update } = writable<ChatMessage[]>();

	return {
		subscribe,
		set,
		update,
		reset: () => {
			set([
				{
					role: "Assistant",
					content: get(data).initialAssistantMessageContent,
					id: nanoid(),
				},
			]);
			get(plugin).chatView.save();
		},
	};
}

export const chatHistory = createChatHistory();
