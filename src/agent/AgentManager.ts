import { Agent, ProviderRegistry, type ThreadSnapshot, LangSmithTelemetry, type Telemetry } from "papa-ts";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import SmartSecondBrainPlugin from "../main";
import { ObsidianChatManager } from "./ObsidianChatManager";
import { createSearchNotesTool } from "../tools/searchNotes";
import { createGetAllTagsTool } from "../tools/getAllTags";
import { createExecuteDataviewTool } from "../tools/executeDataview";
import { createGetPropertiesTool } from "../tools/getProperties";
import { createReadNoteTool } from "../tools/readNote";
import { createSystemPrompt } from "./prompts";
import { createObsidianFetch } from "../utils/obsidianFetch";

export class AgentManager {
	private plugin: SmartSecondBrainPlugin;
	private agent: Agent | null = null;
	private chatManager: ObsidianChatManager;

	constructor(plugin: SmartSecondBrainPlugin) {
		this.plugin = plugin;
		this.chatManager = new ObsidianChatManager(plugin);
	}

	private async configureRegistry(registry: ProviderRegistry, provider: string, apiKey: string): Promise<{ providerName: string, modelOptions: Record<string, any> }> {
		let providerName: string = provider;
		let modelOptions: Record<string, any> = {};

		if (apiKey || provider === "ollama") {
			try {
				if (provider === "openai" && apiKey) {
					await registry.useOpenAI({ apiKey });
					modelOptions = { apiKey };
					providerName = "openai";
				} else if (provider === "anthropic" && apiKey) {
					await registry.useAnthropic({ apiKey });
					modelOptions = { apiKey };
					providerName = "anthropic";
				} else if (provider === "ollama") {
					const baseUrl = apiKey || "http://localhost:11434";
					await registry.useOllama({ baseUrl });
					modelOptions = { baseUrl };
					providerName = "ollama";
				} else if (provider === "sap-ai-core" && apiKey) {
					await registry.useSapAICore({ apiKey });
					modelOptions = { apiKey };
					providerName = "sap-ai-core";
				} else if (provider === "custom" && apiKey) {
					// Default to OpenAI structure for custom
					await registry.useOpenAI({ apiKey });
					modelOptions = { apiKey };
					providerName = "openai";
				}
			} catch (error) {
				console.error("Error configuring provider:", error);
				throw error;
			}
		}
		return { providerName, modelOptions };
	}

	private configureTelemetry(settings: any): Telemetry | undefined {
		const { enableLangSmith, langSmithApiKey, langSmithProject, langSmithEndpoint } = settings;
		if (enableLangSmith && langSmithApiKey) {
			try {
				const telemetry = new LangSmithTelemetry({
					projectName: langSmithProject || "obsidian-agent",
					apiKey: langSmithApiKey,
					endpoint: langSmithEndpoint || "https://api.smith.langchain.com",
					flushOnComplete: true
				});
				console.log("Smart Second Brain: LangSmith telemetry enabled");
				return telemetry;
			} catch (e) {
				console.error("Smart Second Brain: Failed to initialize LangSmith telemetry", e);
			}
		}
		return undefined;
	}

	private async bindTools(agent: Agent) {
		const searchNotesTool = createSearchNotesTool(this.plugin.app);
		const getAllTagsTool = createGetAllTagsTool(this.plugin.app);
		const executeDataviewTool = createExecuteDataviewTool(this.plugin.app);
		const getPropertiesTool = createGetPropertiesTool(this.plugin.app);
		const readNoteTool = createReadNoteTool(this.plugin.app);

		const tools: any[] = [
			searchNotesTool,
			getAllTagsTool,
			executeDataviewTool,
			getPropertiesTool,
			readNoteTool,
		];

		// Load MCP tools if configured
		if (this.plugin.settings.mcpServers && Object.keys(this.plugin.settings.mcpServers).length > 0) {
			try {
				console.log("Smart Second Brain: Initializing MCP client...", this.plugin.settings.mcpServers);

				// Use request via Obsidian proxy (obsidian-fetch) to avoid CORS issues
				// We need to monkey-patch the global fetch for this scope or pass it if supported
				// Currently mcp-adapters uses fetch or EventSource depending on transport

				// For SSE transport (which Tavily likely uses if http url), we need EventSource to work
				// Obsidian environment might block EventSource CORS too. 

				// However, the error above shows it failing on POST/GET fetch calls.
				// Let's try to pass a custom fetch if the library supports it, or we might need to polyfill.

				// NOTE: MultiServerMCPClient doesn't accept a fetch polyfill directly in constructor options in current version
				// But we can try to assign it to global scope temporarily if needed, OR
				// check if we can pass it in client options.

				// Looking at the error: "Access to fetch ... blocked by CORS"
				// Using Obsidian's requestUrl bypasses this.

				// MultiServerMCPClient expects a single argument (config object or server map).
				// clientInfo is not currently supported/exposed by the wrapper (it uses its own package info).
				const mcpClient = new MultiServerMCPClient(this.plugin.settings.mcpServers);

				// HACK: Monkey patch the global fetch for the entire lifecycle
				// This is necessary because mcp-adapters might use fetch internally in places
				// we can't easily wrap (e.g. connection maintenance, keep-alive, etc.)
				// Since this plugin runs inside Obsidian's Electron environment, 
				// replacing window.fetch with obsidianFetch is generally safe and desired for avoiding CORS.

				if (!(window as any)._originalFetch) {
					(window as any)._originalFetch = window.fetch;
					window.fetch = createObsidianFetch((window as any)._originalFetch) as any;
				}

				try {
					const mcpTools = await mcpClient.getTools();
					console.log(`Smart Second Brain: Loaded ${mcpTools.length} MCP tools`);
					tools.push(...mcpTools);
				} catch (e) {
					console.error("Failed to get MCP tools", e);
					// If it fails, we might want to restore fetch? 
					// But if we want persistent CORS bypass for retries, maybe keep it.
					// For safety, let's log.
				}
			} catch (error) {
				console.error("Smart Second Brain: Failed to load MCP tools", error);
			}
		}

		agent.bindTools(tools);
	}

	private async ensureAgent(): Promise<Agent> {
		if (!this.agent) {
			await this.initialize();
		}

		if (!this.agent) {
			throw new Error("Agent initialization failed.");
		}
		return this.agent;
	}

	async initialize(): Promise<void> {
		// Load chats
		await this.chatManager.load();

		// Cleanup existing agent if any
		if (this.agent) {
			this.agent = null;
		}

		const { provider, apiKey, modelName } = this.plugin.settings;

		console.log("Smart Second Brain: Initializing agent...");

		// Create provider registry
		const registry = new ProviderRegistry();

		let providerName: string;
		let modelOptions: Record<string, any>;

		try {
			const config = await this.configureRegistry(registry, provider, apiKey);
			providerName = config.providerName;
			modelOptions = config.modelOptions;
		} catch (error) {
			// Error is already logged in configureRegistry
			return;
		}

		// Configure Telemetry
		const telemetry = this.configureTelemetry(this.plugin.settings);

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
		await this.bindTools(agent);

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
		const agent = await this.ensureAgent();

		// Ensure model is selected (if api key was provided later or something)
		// Agent.run throws if no model.

		try {
			const result = await agent.run({
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
		const agent = await this.ensureAgent();

		try {
			for await (const chunk of agent.streamTokens({
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
			const { providerName } = await this.configureRegistry(registry, provider, apiKey);

			if (!providerName) return [];

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

	async generateThreadTitle(threadId: string): Promise<void> {
		const agent = await this.ensureAgent().catch(e => {
			console.warn("Agent not initialized, cannot generate title");
			return null;
		});

		if (!agent) return;

		try {
			await agent.generateTitle(threadId);
			console.log(`Generated title for thread ${threadId}`);

			// Wait a bit for the title to be persisted
			await new Promise(resolve => setTimeout(resolve, 200));

			// Try multiple ways to get the title:
			// 1. Read from thread store (may have it in cache)
			let snapshot = await this.chatManager.read(threadId, true);
			console.log(`Read snapshot for thread ${threadId}:`, snapshot);

			// 2. If not found, try reading directly from in-memory storage
			if (!snapshot?.title) {
				const threadData = await this.chatManager.ensureThreadLoaded(threadId);
				if (threadData?.title) {
					console.log(`Title found in threadData: "${threadData.title}"`);
					snapshot = {
						threadId: threadData.threadId,
						title: threadData.title,
						metadata: threadData.metadata,
						createdAt: threadData.createdAt,
						updatedAt: threadData.updatedAt
					};
				}
			}

			if (snapshot?.title) {
				console.log(`Title found: "${snapshot.title}", renaming file...`);
				await this.chatManager.renameChatFile(threadId, snapshot.title);
			} else {
				console.warn(`No title found for thread ${threadId} after generation. Waiting longer and retrying...`);
				// Wait longer and try again
				await new Promise(resolve => setTimeout(resolve, 1000));
				snapshot = await this.chatManager.read(threadId, true);
				if (snapshot?.title) {
					console.log(`Title found on retry: "${snapshot.title}", renaming file...`);
					await this.chatManager.renameChatFile(threadId, snapshot.title);
				} else {
					console.error(`Title still not found for thread ${threadId} after retry`);
				}
			}
		} catch (error) {
			console.error(`Error generating title for thread ${threadId}:`, error);
		}
	}

	cleanup(): void {
		// Restore original fetch if it was patched
		if ((window as any)._originalFetch) {
			window.fetch = (window as any)._originalFetch;
			delete (window as any)._originalFetch;
		}

		// Cleanup if needed
		this.agent = null;
	}
}
