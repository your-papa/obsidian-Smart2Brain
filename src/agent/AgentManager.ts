import { Agent, ProviderRegistry, type ThreadSnapshot, LangSmithTelemetry, type Telemetry } from "papa-ts";
import SmartSecondBrainPlugin from "../main";
import { ObsidianChatManager } from "./ObsidianChatManager";
import { createSearchNotesTool } from "../tools/searchNotes";
import { createGetAllTagsTool } from "../tools/getAllTags";
import { createExecuteDataviewTool } from "../tools/executeDataview";
import { createGetPropertiesTool } from "../tools/getProperties";
import { createReadNoteTool } from "../tools/readNote";
import { createSystemPrompt } from "./prompts";

export class AgentManager {
	private plugin: SmartSecondBrainPlugin;
	private agent: Agent | null = null;
	private chatManager: ObsidianChatManager;

	constructor(plugin: SmartSecondBrainPlugin) {
		this.plugin = plugin;
		this.chatManager = new ObsidianChatManager(plugin);
	}

	async initialize(): Promise<void> {
		// Load chats
		await this.chatManager.load();

		// Cleanup existing agent if any
		if (this.agent) {
			this.agent = null;
		}

		const { provider, apiKey, modelName, enableLangSmith, langSmithApiKey, langSmithProject, langSmithEndpoint } = this.plugin.settings;

		console.log("Smart Second Brain: Initializing agent...");

		// Create provider registry
		const registry = new ProviderRegistry();
		let providerName: string = provider;
		let modelOptions: Record<string, any> = {};

		if (apiKey || provider === "ollama") {
			try {
				if (provider === "openai" && apiKey) {
					await registry.useOpenAI({ apiKey });
					modelOptions = { apiKey };
				} else if (provider === "anthropic" && apiKey) {
					await registry.useAnthropic({ apiKey });
					modelOptions = { apiKey };
				} else if (provider === "ollama") {
					const baseUrl = apiKey || "http://localhost:11434";
					await registry.useOllama({ baseUrl });
					modelOptions = { baseUrl };
				} else if (provider === "sap-ai-core" && apiKey) {
					await registry.useSapAICore({ apiKey });
					modelOptions = { apiKey };
				} else if (provider === "custom" && apiKey) {
					// Default to OpenAI structure for custom
					await registry.useOpenAI({ apiKey });
					modelOptions = { apiKey };
					providerName = "openai";
				}
			} catch (error) {
				console.error("Error configuring provider:", error);
			}
		}

		// Configure Telemetry
		let telemetry: Telemetry | undefined;
		if (enableLangSmith && langSmithApiKey) {
			try {
				telemetry = new LangSmithTelemetry({
					projectName: langSmithProject || "obsidian-agent",
					apiKey: langSmithApiKey,
					endpoint: langSmithEndpoint || "https://api.smith.langchain.com",
					flushOnComplete: true
				});
				console.log("Smart Second Brain: LangSmith telemetry enabled");
			} catch (e) {
				console.error("Smart Second Brain: Failed to initialize LangSmith telemetry", e);
			}
		}

		// Create agent with checkpoint storage
		// The chatManager acts as both checkpointer and thread store
		const agent = new Agent({
			registry,
			checkpointer: this.chatManager,
			threadStore: this.chatManager.asThreadStore(),
			telemetry
		});

		// Check for available plugins to adjust prompt capabilities
		// @ts-ignore - Dynamic access to plugins
		const hasChartsPlugin = this.plugin.app.plugins?.enabledPlugins?.has("obsidian-charts");

		// Set prompt
		agent.setPrompt(createSystemPrompt(hasChartsPlugin));

		// Bind tools
		const searchNotesTool = createSearchNotesTool(this.plugin.app);
		const getAllTagsTool = createGetAllTagsTool(this.plugin.app);
		const executeDataviewTool = createExecuteDataviewTool(this.plugin.app);
		const getPropertiesTool = createGetPropertiesTool(this.plugin.app);
		const readNoteTool = createReadNoteTool(this.plugin.app);
		agent.bindTools([
			searchNotesTool,
			getAllTagsTool,
			executeDataviewTool,
			getPropertiesTool,
			readNoteTool,
		]);

		// If we have configuration, try to choose the model
		if ((apiKey || provider === "ollama") && modelName) {
			try {
				console.log("Smart Second Brain: Choosing model...", { provider: providerName, chatModel: modelName });
				await agent.chooseModel({
					provider: providerName,
					chatModel: modelName,
					options: modelOptions,
				});
				console.log("Smart Second Brain: Model chosen successfully");
			} catch (chooseModelError) {
				console.error("Smart Second Brain: Error choosing model:", chooseModelError);
			}
		} else {
			console.warn("Smart Second Brain: API key or model name not configured. Agent initialized for history reading only.");
		}

		this.agent = agent;
	}

	async runQuery(query: string, threadId: string = "default-thread"): Promise<string> {
		if (!this.agent) {
			await this.initialize();
		}

		if (!this.agent) {
			throw new Error("Agent initialization failed.");
		}

		// Ensure model is selected (if api key was provided later or something)
		// Agent.run throws if no model.

		try {
			const result = await this.agent.run({
				query,
				threadId,
			});

			if (typeof result.response === "string") {
				return result.response;
			} else if (result.response !== undefined && result.response !== null) {
				return String(result.response);
			} else {
				return "No response received from agent.";
			}
		} catch (error) {
			console.error("Smart Second Brain: Error running query", error);
			throw error;
		}
	}

	async *streamQuery(
		query: string,
		threadId: string = "default-thread"
	): AsyncGenerator<{ type: "token" | "result"; token?: string; result?: any; messages?: any[] }, void, unknown> {
		if (!this.agent) {
			await this.initialize();
		}

		if (!this.agent) {
			throw new Error("Agent initialization failed.");
		}

		try {
			for await (const chunk of this.agent.streamTokens({
				query,
				threadId,
			})) {
				switch (chunk.type) {
					case "token":
						yield { type: "token", token: chunk.token, messages: (chunk as any).messages };
						break;
					case "result":
						yield { type: "result", result: chunk.result };
						break;
					default:
						break;
				}
			}
		} catch (error) {
			console.error("Smart Second Brain: Error streaming query", error);
			throw error;
		}
	}

	async getAvailableModels(provider: string, apiKey: string): Promise<string[]> {
		try {
			const registry = new ProviderRegistry();
			let providerName: string;

			if (provider === "openai") {
				providerName = "openai";
				await registry.useOpenAI({
					apiKey: apiKey,
				});
			} else if (provider === "anthropic") {
				providerName = "anthropic";
				await registry.useAnthropic({
					apiKey: apiKey,
				});
			} else if (provider === "ollama") {
				providerName = "ollama";
				const baseUrl = apiKey || "http://localhost:11434";
				await registry.useOllama({
					baseUrl: baseUrl,
				});
			} else if (provider === "sap-ai-core") {
				providerName = "sap-ai-core";
				await registry.useSapAICore({
					apiKey: apiKey,
				});
			} else {
				return [];
			}

			return registry.listChatModels(providerName);
		} catch (error) {
			console.error("Smart Second Brain: Error fetching available models", error);
			return [];
		}
	}

	async getThreadMessages(threadId: string): Promise<any[]> {
		try {
			// Try to use agent if available to get history from checkpoint (more robust)
			if (this.agent) {
				try {
					const history = await this.agent.getThreadHistory(threadId);
					if (history && history.messages) {
						// v2.4.1 returns normalized ThreadMessage[] directly
						return history.messages;
					}
				} catch (e) {
					console.warn("Failed to get history from agent", e);
				}
			}
			return [];
		} catch (error) {
			console.error("Smart Second Brain: Error fetching thread messages", error);
			return [];
		}
	}

	async getAllThreads(): Promise<ThreadSnapshot[]> {
		await this.chatManager.load();
		return this.chatManager.listThreads();
	}

	async deleteThread(threadId: string): Promise<void> {
		await this.chatManager.delete(threadId);
	}

	cleanup(): void {
		// Cleanup if needed
		this.agent = null;
	}
}
