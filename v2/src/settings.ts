export interface SmartSecondBrainSettings {
	provider: "openai" | "anthropic" | "ollama" | "sap-ai-core" | "custom";
	apiKey: string;
	modelName: string;
	chatsFolder: string;
	readableLineLength?: boolean;
	langSmithApiKey?: string;
	langSmithProject?: string;
	langSmithEndpoint?: string;
	enableLangSmith?: boolean;
	mcpServers?: Record<string, any>;
}

export const DEFAULT_SETTINGS: SmartSecondBrainSettings = {
	provider: "openai",
	apiKey: "",
	modelName: "gpt-4o-mini",
	chatsFolder: "Chats",
	readableLineLength: false,
	langSmithApiKey: "",
	langSmithProject: "obsidian-agent",
	langSmithEndpoint: "https://api.smith.langchain.com",
	enableLangSmith: false,
	mcpServers: {}
};

