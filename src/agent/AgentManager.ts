import { Notice, normalizePath } from "obsidian";
import type SecondBrainPlugin from "../main";
import type { ChatModel } from "../stores/chatStore.svelte";
import { getData } from "../stores/dataStore.svelte";
import { createExecuteDataviewTool } from "../tools/executeDataview";
import { createGetAllTagsTool } from "../tools/getAllTags";
import { createGetPropertiesTool } from "../tools/getProperties";
import { createReadNoteTool } from "../tools/readNote";
import { createSearchNotesTool } from "../tools/searchNotes";
import type { RegisteredProvider } from "../types/providers";
import { createObsidianFetch } from "../utils/obsidianFetch";
import { invalidateProviderState } from "../utils/query";
import { createThreadId } from "../utils/threadId";
import { Agent, type ChooseModelParams, type ThreadHistory } from "./Agent";
import { ObsidianChatManager } from "./ObsidianChatManager";
import type { ThreadSnapshot } from "./memory/ThreadStore";
import { createSystemPrompt } from "./prompts";
import {
	type BuiltInProviderOptions,
	ProviderAuthError,
	ProviderEndpointError,
	ProviderRegistryError,
} from "./providers";
import { ProviderRegistry } from "./providers/ProviderRegistry";
import { LangSmithTelemetry, type Telemetry } from "./telemetry";

export type ValidationResult = { success: true } | { success: false; message: string };

declare const MultiServerMCPClient: any;

/**
 * Maps the UI ChatModel type to papa-ts ChooseModelParams.
 */
function toChooseModelParams(model: ChatModel): ChooseModelParams {
	return {
		provider: model.provider,
		chatModel: model.model,
		options: model.modelConfig,
	};
}

export class AgentManager {
	private plugin: SecondBrainPlugin;
	private agent: Agent | null = null;
	private chatManager: ObsidianChatManager;
	private registry: ProviderRegistry;

	constructor(plugin: SecondBrainPlugin) {
		this.plugin = plugin;
		this.chatManager = new ObsidianChatManager(plugin);
		this.registry = new ProviderRegistry();
	}

	/**
	 * Configures a specific provider on the given registry.
	 */
	private async configureProviderOnRegistry(
		registry: ProviderRegistry,
		provider: RegisteredProvider,
		options: BuiltInProviderOptions,
	): Promise<void> {
		switch (provider) {
			case "OpenAI":
				await registry.useOpenAI(options);
				break;
			case "CustomOpenAI":
				await registry.useOpenAI(options);
				break;
			case "Anthropic":
				await registry.useAnthropic(options);
				break;
			case "Ollama":
				await registry.useOllama(options);
				break;
			default:
				throw new Error(`Unsupported provider: ${provider}`);
		}
	}

	/**
	 * Configures a provider on the main registry.
	 */
	private async configureRegistry(provider: RegisteredProvider, options: BuiltInProviderOptions): Promise<void> {
		await this.configureProviderOnRegistry(this.registry, provider, options);
	}

	/**
	 * Tests and configures a provider on the actual registry.
	 * Returns a ValidationResult indicating success or failure with a message.
	 */
	async testProviderConfig(provider: RegisteredProvider, options: BuiltInProviderOptions): Promise<ValidationResult> {
		try {
			await this.configureProviderOnRegistry(this.registry, provider, options);
			return { success: true };
		} catch (error) {
			if (error instanceof ProviderAuthError) {
				return { success: false, message: "Invalid API key" };
			}
			if (error instanceof ProviderEndpointError) {
				return {
					success: false,
					message: "Invalid base URL or endpoint unreachable",
				};
			}
			if (error instanceof ProviderRegistryError) {
				return { success: false, message: error.message };
			}
			return {
				success: false,
				message: "Provider configuration failed",
			};
		}
	}

	private configureTelemetry(): Telemetry | undefined {
		const data = getData();
		if (data.enableLangSmith && data.langSmithApiKey) {
			try {
				const telemetry = new LangSmithTelemetry({
					projectName: data.langSmithProject || "obsidian-agent",
					apiKey: data.langSmithApiKey,
					endpoint: data.langSmithEndpoint || "https://api.smith.langchain.com",
					flushOnComplete: true,
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

		const tools: any[] = [searchNotesTool, getAllTagsTool, executeDataviewTool, getPropertiesTool, readNoteTool];

		// Load MCP tools if configured (use getData())
		const data = getData();
		if (data.mcpServers && Object.keys(data.mcpServers).length > 0) {
			try {
				console.log("Smart Second Brain: Initializing MCP client...", data.mcpServers);

				// HACK: Monkey patch the global fetch for the entire lifecycle
				if (!(window as any)._originalFetch) {
					(window as any)._originalFetch = window.fetch;
					window.fetch = createObsidianFetch((window as any)._originalFetch) as any;
				}

				try {
					const mcpClient = new MultiServerMCPClient(data.mcpServers);
					const mcpTools = await mcpClient.getTools();
					console.log(`Smart Second Brain: Loaded ${mcpTools.length} MCP tools`);
					tools.push(...mcpTools);
				} catch (e) {
					console.error("Failed to get MCP tools", e);
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
		this.agent = null;

		// Reset registry for fresh configuration
		this.registry = new ProviderRegistry();

		const pluginData = getData();

		// Configure all providers - use for...of to properly await each
		const configuredProviders = pluginData.getConfiguredProviders();
		const unavailableProviders: string[] = [];
		for (const provider of configuredProviders) {
			// Resolve secrets from SecretStorage to get actual API keys
			const options = pluginData.getResolvedProviderAuth(provider);
			try {
				await this.configureRegistry(provider, options);
			} catch (error) {
				if (error instanceof ProviderEndpointError) {
					unavailableProviders.push(provider);
					continue;
				}
				throw error;
			}
		}

		if (unavailableProviders.length > 0) {
			new Notice(`Cannot connect to: ${unavailableProviders.join(", ")}. Check that the service is running.`);
		}

		console.log(this.registry);

		// Configure Telemetry (use getData())
		const telemetry = this.configureTelemetry();

		// Create agent with checkpoint storage
		// The chatManager acts as both checkpointer and thread store
		this.agent = new Agent({
			registry: this.registry,
			checkpointer: this.chatManager,
			threadStore: this.chatManager.asThreadStore(),
			telemetry,
		});

		// Check for available plugins to adjust prompt capabilities
		// @ts-ignore - Dynamic access to plugins
		const hasChartsPlugin = this.plugin.app.plugins?.enabledPlugins?.has("obsidian-charts");

		// Set prompt
		this.agent.setPrompt(createSystemPrompt(hasChartsPlugin));

		const defaultModel = pluginData.getDefaultChatModel();
		if (defaultModel) {
			await this.agent.chooseModel(toChooseModelParams(defaultModel));
		}

		// Bind tools
		await this.bindTools(this.agent);
	}

	async *streamQuery(
		query: string,
		threadId = "default-thread",
		signal?: AbortSignal,
	): AsyncGenerator<
		| { type: "token"; token: string }
		| {
				type: "tool_start";
				toolCallId: string;
				toolName: string;
				input: unknown;
		  }
		| {
				type: "tool_end";
				toolCallId: string;
				toolName: string;
				output: unknown;
		  }
		| { type: "result"; result: any },
		void,
		unknown
	> {
		const agent = await this.ensureAgent();

		const defaultModel = getData().getDefaultChatModel();
		if (defaultModel) {
			await agent.chooseModel(toChooseModelParams(defaultModel));
		} else {
			throw new Error("No chat model configured");
		}

		try {
			for await (const chunk of agent.streamTokens({
				query,
				threadId,
				signal,
			})) {
				// Check if aborted before yielding
				if (signal?.aborted) {
					break;
				}
				switch (chunk.type) {
					case "token":
						yield { type: "token", token: chunk.token };
						break;
					case "tool_start":
						yield {
							type: "tool_start",
							toolCallId: chunk.toolCallId,
							toolName: chunk.toolName,
							input: chunk.input,
						};
						break;
					case "tool_end":
						yield {
							type: "tool_end",
							toolCallId: chunk.toolCallId,
							toolName: chunk.toolName,
							output: chunk.output,
						};
						break;
					case "result":
						yield { type: "result", result: chunk.result };
						break;
					default:
						break;
				}
			}
		} catch (error) {
			// Don't log abort errors as they're expected during cancellation
			if (error instanceof Error && error.name === "AbortError") {
				return;
			}

			// Handle connection errors (e.g., Ollama server not running)
			if (error instanceof ProviderEndpointError) {
				const model = getData().getDefaultChatModel();
				const provider = model?.provider;
				if (provider) {
					invalidateProviderState(provider);
				}
				new Notice(error.message);
				throw error;
			}

			console.error("Smart Second Brain: Error streaming query", error);
			throw error;
		} finally {
			// Cleanup logging - stream completed or aborted
			if (signal?.aborted) {
				console.log("Smart Second Brain: Stream aborted by user");
			}
		}
	}

	async getAvailableModels(providerName: RegisteredProvider): Promise<string[]> {
		try {
			if (!providerName) return [];

			// Provider might be configured but not connected (e.g., Ollama not running)
			if (!this.registry.hasProvider(providerName)) {
				return [];
			}

			return this.registry.listChatModels(providerName);
		} catch (error) {
			console.error("Smart Second Brain: Error fetching available models", error);
			return [];
		}
	}

	async getThreadHistory(threadId: string): Promise<ThreadHistory | null> {
		try {
			// Try to use agent if available to get history from checkpoint (more robust)
			if (this.agent) {
				try {
					const history = await this.agent.getThreadHistory(threadId);
					if (history) {
						return history;
					}
				} catch (e) {
					console.warn("Failed to get history from agent", e);
				}
			}
			return null;
		} catch (error) {
			console.error("Smart Second Brain: Error fetching thread history", error);
			return null;
		}
	}

	async getAllThreads(): Promise<ThreadSnapshot[]> {
		await this.chatManager.load();
		return this.chatManager.listThreads();
	}

	async deleteThread(threadId: string): Promise<void> {
		await this.chatManager.delete(threadId);
	}

	/**
	 * Generate a title for a thread using only the user's first message.
	 * This can run in parallel with streaming since it doesn't need the AI response.
	 */
	async generateThreadTitleFromUserMessage(threadId: string, userMessage: string): Promise<void> {
		const agent = await this.ensureAgent().catch((e) => {
			console.warn("Agent not initialized, cannot generate title");
			return null;
		});

		if (!agent) return;

		try {
			const title = await agent.generateTitle(userMessage);
			if (title) {
				console.log(`Generated title for thread ${threadId}: "${title}"`);
				await this.chatManager.renameChatFile(threadId, title);
			}
		} catch (error) {
			console.error(`Error generating title for thread ${threadId}:`, error);
		}
	}

	cleanup(): void {
		// Restore original fetch if it was patched
		if ((window as any)._originalFetch) {
			window.fetch = (window as any)._originalFetch;
			(window as any)._originalFetch = undefined;
		}

		// Cleanup if needed
		this.agent = null;
	}

	async createNewChat(): Promise<void> {
		const threadId = createThreadId();
		const now = Date.now();

		const folder = getData().targetFolder;

		// Ensure folder exists
		if (!(await this.plugin.app.vault.adapter.exists(folder))) {
			await this.plugin.app.vault.createFolder(folder);
		}

		const path = normalizePath(`${folder}/${threadId}.chat`);

		// Initialize with valid thread data structure
		const initialData = {
			threadId,
			createdAt: now,
			updatedAt: now,
			checkpoints: {},
			writes: {},
		};

		// Create file directly and open it
		const file = await this.plugin.app.vault.create(path, JSON.stringify(initialData, null, 2));
		await this.plugin.app.workspace.getLeaf(false).openFile(file);
	}

	async openLatestChat(): Promise<void> {
		const threads = await this.chatManager.listThreads();

		if (threads.length === 0) {
			await this.createNewChat();
			return;
		}

		const latestThread = threads[0];
		const folder = getData().targetFolder;
		const path = normalizePath(`${folder}/${latestThread.threadId}.chat`);
		const file = this.plugin.app.vault.getAbstractFileByPath(path);

		if (file) {
			await this.plugin.app.workspace.getLeaf(false).openFile(file as any);
		} else {
			await this.createNewChat();
		}
	}
}
