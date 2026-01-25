import { Notice, normalizePath } from "obsidian";
import { createObsidianFetch } from "../lib/obsidianFetch";
import { invalidateProviderState } from "../lib/query";
import type SecondBrainPlugin from "../main";
import type { ChatModel } from "../stores/chatStore.svelte";
import { getData } from "../stores/dataStore.svelte";

import { ProviderAuthError, ProviderEndpointError, ProviderRegistry, ProviderRegistryError } from "../providers/index";
import { createThreadId } from "../utils/threadId";
import { Agent, type ChooseModelParams, type ThreadHistory } from "./Agent";
import { ObsidianChatManager } from "./ObsidianChatManager";
import type { ThreadSnapshot } from "./memory/ThreadStore";
import { BASE_SYSTEM_PROMPT } from "./prompts";
import { LangSmithTelemetry, type Telemetry } from "./telemetry";
import { createExecuteDataviewTool } from "./tools/executeDataview";
import { createGetAllTagsTool } from "./tools/getAllTags";
import { createGetPropertiesTool } from "./tools/getProperties";
import { createReadNoteTool } from "./tools/readNote";
import { createSearchNotesTool } from "./tools/searchNotes";

// New provider system imports
import {
	type AuthObject,
	ProviderAuthError as NewProviderAuthError,
	ProviderEndpointError as NewProviderEndpointError,
	getProviderDefinition,
} from "../providers/index";
import { getRegistry } from "../providers/registry";

import type { StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { TFile } from "obsidian";

/**
 * Legacy options type for built-in providers.
 * Used for backward compatibility with existing code.
 */
interface BuiltInProviderOptions {
	apiKey?: string;
	baseUrl?: string;
	headers?: string | Record<string, string>;
}

/**
 * Converts BuiltInProviderOptions to AuthObject.
 */
function convertToAuthObject(options: BuiltInProviderOptions): AuthObject {
	const auth: AuthObject = {};

	if (options.apiKey) {
		auth.apiKey = options.apiKey;
	}
	if (options.baseUrl) {
		auth.baseUrl = options.baseUrl;
	}
	if (options.headers) {
		auth.headers = typeof options.headers === "string" ? JSON.parse(options.headers) : options.headers;
	}

	return auth;
}

/** Result of provider authentication validation */
export type AuthValidationResult = { success: true } | { success: false; message: string };

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

	constructor(plugin: SecondBrainPlugin) {
		this.plugin = plugin;
		this.chatManager = new ObsidianChatManager(plugin);
	}

	/** Get the singleton registry instance */
	private get registry(): ProviderRegistry {
		return getRegistry();
	}

	/**
	 * Check if an Obsidian plugin is installed (may or may not be enabled).
	 * Special case: "math-latex" is always considered installed (built-in rendering).
	 */
	isPluginInstalled(pluginId: string): boolean {
		if (pluginId === "math-latex") return true; // Built-in capability
		// @ts-ignore - Obsidian plugin API
		// manifests contains all installed plugins, plugins only contains enabled ones
		return Boolean(this.plugin.app.plugins?.manifests?.[pluginId]);
	}

	/**
	 * Check if an Obsidian plugin is enabled (installed and active).
	 * Special case: "math-latex" is always considered enabled (built-in rendering).
	 */
	isPluginEnabled(pluginId: string): boolean {
		if (pluginId === "math-latex") return true; // Built-in capability
		// @ts-ignore - Obsidian plugin API
		return Boolean(this.plugin.app.plugins?.enabledPlugins?.has(pluginId));
	}

	/**
	 * Get list of enabled plugins from the supported extensions.
	 */
	getEnabledPluginIds(): string[] {
		const pluginData = getData();
		return Object.keys(pluginData.pluginPromptExtensions).filter((id) => this.isPluginEnabled(id));
	}

	/**
	 * Assembles the full system prompt from base prompt + enabled plugin extensions.
	 * Uses the currently selected agent's configuration.
	 * Only includes extensions for plugins that are both enabled AND installed.
	 */
	assembleSystemPrompt(): string {
		const pluginData = getData();
		const selectedAgent = pluginData.getSelectedAgent();

		// Use selected agent's prompt, fallback to legacy data, then default
		let prompt = selectedAgent?.systemPrompt || pluginData.systemPrompt || BASE_SYSTEM_PROMPT;

		// Get plugin extensions from the selected agent or legacy data
		const extensions = selectedAgent?.pluginPromptExtensions ?? pluginData.pluginPromptExtensions;

		// Append enabled extensions for enabled plugins
		for (const [pluginId, ext] of Object.entries(extensions)) {
			if (ext.enabled && this.isPluginEnabled(pluginId) && ext.prompt?.trim()) {
				prompt += `\n\n${ext.prompt}`;
			}
		}

		return prompt;
	}

	/**
	 * Updates the agent's system prompt by reassembling from current settings.
	 * Call this after changing base prompt or plugin extensions.
	 */
	updateSystemPrompt(): void {
		const assembledPrompt = this.assembleSystemPrompt();
		this.agent?.setPrompt(assembledPrompt);
	}

	/**
	 * Get available models for a provider by discovering them from the API.
	 * @returns Array of available chat model names
	 */
	async getAvailableModels(providerId: string): Promise<string[]> {
		try {
			if (!providerId) return [];

			const pluginData = getData();
			const providerDef = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta());

			if (providerDef) {
				const resolvedAuth = pluginData.getResolvedAuthState(providerId);
				if (!resolvedAuth) {
					return [];
				}

				try {
					const discovered = await providerDef.discoverModels(resolvedAuth);
					return discovered;
				} catch (error) {
					console.warn(`Model discovery failed for ${providerId}:`, error);
					return [];
				}
			}

			return [];
		} catch (error) {
			console.error("Smart Second Brain: Error fetching available models", error);
			return [];
		}
	}

	/**
	 * Registers a provider on the registry with its auth state.
	 */
	private registerProvider(providerId: string, auth: AuthObject): void {
		const pluginData = getData();
		const providerDef = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta());

		if (!providerDef) {
			throw new Error(`Unknown provider: ${providerId}`);
		}

		// Check if it's a custom provider
		const customMeta = pluginData.getCustomProviderMeta(providerId);
		if (customMeta) {
			this.registry.registerCustom(providerId, customMeta, auth);
		} else {
			this.registry.register(providerId, providerDef, auth);
		}
	}

	/**
	 * Tests and registers a provider on the actual registry.
	 * Returns an AuthValidationResult indicating success or failure with a message.
	 *
	 * @deprecated Use validateProviderAuth() with new provider IDs instead.
	 */
	async testProviderConfig(providerId: string, options: BuiltInProviderOptions): Promise<AuthValidationResult> {
		const pluginData = getData();
		const providerDef = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta());

		if (!providerDef) {
			return { success: false, message: `Unknown provider: ${providerId}` };
		}

		const auth = convertToAuthObject(options);

		try {
			const validationResult = await providerDef.validateAuth(auth);

			if (!validationResult.valid) {
				return { success: false, message: validationResult.error };
			}

			this.registerProvider(providerId, auth);
			return { success: true };
		} catch (error) {
			if (error instanceof NewProviderAuthError || error instanceof ProviderAuthError) {
				return { success: false, message: "Invalid API key" };
			}
			if (error instanceof NewProviderEndpointError || error instanceof ProviderEndpointError) {
				return {
					success: false,
					message: "Invalid base URL or endpoint unreachable",
				};
			}
			if (error instanceof ProviderRegistryError) {
				return { success: false, message: error.message };
			}
			if (error instanceof Error) {
				return { success: false, message: error.message };
			}
			return {
				success: false,
				message: "Provider configuration failed",
			};
		}
	}

	/**
	 * Validates provider authentication using the new provider ID system.
	 *
	 * @param providerId - The provider ID (e.g., "openai", "anthropic", "ollama")
	 * @param auth - The runtime auth state with resolved secrets
	 * @returns AuthValidationResult indicating success or failure
	 */
	async validateProviderAuth(providerId: string, auth: AuthObject): Promise<AuthValidationResult> {
		const pluginData = getData();
		const providerDef = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta());

		if (!providerDef) {
			return { success: false, message: `Unknown provider: ${providerId}` };
		}

		try {
			const validationResult = await providerDef.validateAuth(auth);

			if (!validationResult.valid) {
				return { success: false, message: validationResult.error };
			}

			return { success: true };
		} catch (error) {
			if (error instanceof NewProviderAuthError || error instanceof ProviderAuthError) {
				return { success: false, message: "Invalid API key" };
			}
			if (error instanceof NewProviderEndpointError || error instanceof ProviderEndpointError) {
				return { success: false, message: "Invalid base URL or endpoint unreachable" };
			}
			if (error instanceof ProviderRegistryError) {
				return { success: false, message: error.message };
			}
			if (error instanceof Error) {
				return { success: false, message: error.message };
			}
			return { success: false, message: "Provider configuration failed" };
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
		const data = getData();
		const selectedAgent = data.getSelectedAgent();
		const tools: StructuredToolInterface[] = [];

		// Helper to check if tool is enabled for the selected agent
		const isToolEnabled = (
			toolId: "search_notes" | "read_note" | "get_all_tags" | "get_properties" | "execute_dataview_query",
		): boolean => {
			// Check selected agent's tools config first, fallback to legacy
			if (selectedAgent?.toolsConfig) {
				return selectedAgent.toolsConfig[toolId]?.enabled ?? true;
			}
			return data.isToolEnabled(toolId);
		};

		// Add built-in tools based on configuration
		if (isToolEnabled("search_notes")) {
			tools.push(createSearchNotesTool(this.plugin.app));
		}
		if (isToolEnabled("get_all_tags")) {
			tools.push(createGetAllTagsTool(this.plugin.app));
		}
		if (isToolEnabled("execute_dataview_query")) {
			tools.push(createExecuteDataviewTool(this.plugin.app));
		}
		if (isToolEnabled("get_properties")) {
			tools.push(createGetPropertiesTool(this.plugin.app));
		}
		if (isToolEnabled("read_note")) {
			tools.push(createReadNoteTool(this.plugin.app));
		}

		// Get MCP servers from selected agent or legacy data
		const mcpServers = selectedAgent?.mcpServers
			? data.getAgentMCPServersForClient(selectedAgent.id)
			: data.getMCPServersForClient();

		// Load MCP tools if configured (only enabled servers)
		if (mcpServers && Object.keys(mcpServers).length > 0) {
			try {
				// Type assertion needed as getMCPServersForClient returns Record<string, unknown>
				// but we know it produces the correct shape for MultiServerMCPClient
				const mcpConfig = { mcpServers } as ConstructorParameters<typeof MultiServerMCPClient>[0];
				console.log("Smart Second Brain: Initializing MCP client...", mcpConfig);

				// HACK: Monkey patch the global fetch for the entire lifecycle
				const windowWithFetch = window as Window & { _originalFetch?: typeof fetch };
				if (!windowWithFetch._originalFetch) {
					windowWithFetch._originalFetch = window.fetch;
					window.fetch = createObsidianFetch(windowWithFetch._originalFetch);
				}

				try {
					const mcpClient = new MultiServerMCPClient(mcpConfig);
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

		// Clear and re-register all configured providers
		this.registry.clear();

		const pluginData = getData();

		// Register all configured providers
		const configuredProviders = pluginData.getConfiguredProviders();
		const unavailableProviders: string[] = [];
		for (const providerId of configuredProviders) {
			// Resolve secrets from SecretStorage to get actual auth
			const auth = pluginData.getResolvedAuthState(providerId);
			if (!auth) continue;

			try {
				this.registerProvider(providerId, auth);
			} catch (error) {
				if (error instanceof ProviderEndpointError) {
					unavailableProviders.push(providerId);
					continue;
				}
				throw error;
			}
		}

		if (unavailableProviders.length > 0) {
			new Notice(`Cannot connect to: ${unavailableProviders.join(", ")}. Check that the service is running.`);
		}

		console.log("[AgentManager] Registry initialized with providers:", this.registry.list());

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

		// Set assembled prompt (base + enabled plugin extensions)
		this.agent.setPrompt(this.assembleSystemPrompt());

		// Get model from selected agent or fallback to legacy default
		const selectedAgent = pluginData.getSelectedAgent();
		const chatModel = selectedAgent?.chatModel ?? pluginData.getDefaultChatModel();
		if (chatModel) {
			await this.agent.chooseModel(toChooseModelParams(chatModel));
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
		| { type: "result"; result: unknown },
		void,
		unknown
	> {
		const agent = await this.ensureAgent();
		const pluginData = getData();

		// Get model from selected agent or fallback to legacy default
		const selectedAgent = pluginData.getSelectedAgent();
		const chatModel = selectedAgent?.chatModel ?? pluginData.getDefaultChatModel();
		if (chatModel) {
			await agent.chooseModel(toChooseModelParams(chatModel));
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
				const provider = chatModel?.provider;
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

	/**
	 * Reinitialize the agent with updated settings.
	 * Call this when tool configuration or MCP servers change.
	 */
	async reinitialize(): Promise<void> {
		console.log("Smart Second Brain: Reinitializing agent with updated settings...");
		await this.initialize();
		console.log("Smart Second Brain: Agent reinitialized successfully");
	}

	cleanup(): void {
		// Restore original fetch if it was patched
		const windowWithFetch = window as Window & { _originalFetch?: typeof fetch };
		if (windowWithFetch._originalFetch) {
			window.fetch = windowWithFetch._originalFetch;
			windowWithFetch._originalFetch = undefined;
		}

		// Cleanup if needed
		this.agent = null;
	}

	async createNewChat(): Promise<void> {
		const threadId = createThreadId();
		const now = Date.now();

		const data = getData();
		const folder = data.targetFolder;

		// Reset to default agent if one is set
		if (data.defaultAgentId && data.selectedAgentId !== data.defaultAgentId) {
			data.selectedAgentId = data.defaultAgentId;
			// Reinitialize with the default agent's configuration
			await this.reinitialize();
		}

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

		if (file && file instanceof TFile) {
			await this.plugin.app.workspace.getLeaf(false).openFile(file);
		} else {
			await this.createNewChat();
		}
	}
}
