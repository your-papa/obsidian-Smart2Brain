import type { RegisteredEmbedProvider } from "papa-ts";

export type ChatMessage = {
	role: "Assistant" | "User";
	content: string;
	model: { provider: RegisteredEmbedProvider; model: string };
	id: string;
};
