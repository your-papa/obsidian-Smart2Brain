import type { BaseMessage } from "@langchain/core/messages";
import { Notice, normalizePath, TFile } from "obsidian";
import { createObsidianFetch } from "../lib/obsidianFetch";
import { invalidateProviderState } from "../lib/query";
import type SecondBrainPlugin from "../main";
import type { ChatModel } from "../stores/chatStore.svelte";
import { getData } from "../stores/dataStore.svelte";
import type { BuiltInToolId } from "../types/plugin";
import { lookupModelInfo } from "../providers/modelsDevApi";
import { fetchOllamaModelsInfo } from "../providers/ollamaModels";
import { extractCapabilities as extractOpenRouterCapabilities, fetchOpenRouterModels } from "../providers/openrouterModels";

import {
	ProviderAuthError,
	ProviderEndpointError,
	ProviderRegistry,
	ProviderRegistryError,
	type AuthObject,
	getProviderDefinition,
} from "../providers/index";
import type { ChatAttachment } from "../types/shared";
import { createThreadId, NEW_CHAT_NAME } from "../utils/threadId";
import { Logger } from "../utils/logging";
import { Agent, type AgentStreamChunk, type CheckpointHistoryItem, type ChooseModelParams, type ThreadHistory } from "./Agent";
import { ObsidianChatManager } from "./ObsidianChatManager";
import type { ThreadSnapshot } from "./memory/ThreadStore";
import { BASE_SYSTEM_PROMPT } from "./prompts";
import { LangSmithTelemetry, type Telemetry } from "./telemetry";
import { createExecuteDataviewTool } from "./tools/executeDataview";
import { createGetAllTagsTool } from "./tools/getAllTags";
import { createGetPropertiesTool } from "./tools/getProperties";
import { createLoadSkillTool } from "./tools/loadSkill";
import { createReadContentTool } from "./tools/readContent";
import { createSearchNotesTool } from "./tools/searchNotes";

import { getRegistry } from "../providers/registry";

import type { StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
||||||| ancestor
/**
 * Legacy options type for built-in providers.
 * Used for backward compatibility with existing code.
 */
interface BuiltInProviderOptions {
	apiKey?: string;
	baseUrl?: string;
	headers?: string | Record<string, string>;
}
||||||| ancestor
/**
 * Legacy options type for built-in providers.
 * Used for backward compatibility with existing code.
 */
interface BuiltInProviderOptions {
	apiKey?: string;
	baseUrl?: string;
	headers?: string | Record<string, string>;
}
=======
>>>>>>> theirs

/** Result of provider authentication validation */
export type AuthValidationResult = { success: true } | { success: false; message: string };

/**
 * Chunk type yielded by AgentManager generator methods.
 * Derived from the canonical AgentStreamChunk to stay in sync automatically.
 */
export type AgentManagerStreamChunk =
	| { type: "token"; token: string }
	| Pick<Extract<AgentStreamChunk, { type: "tool_start" }>, "type" | "toolCallId" | "toolName" | "input" | "aiMessageId">
	| Pick<Extract<AgentStreamChunk, { type: "tool_end" }>, "type" | "toolCallId" | "toolName" | "output" | "aiMessageId">
	| { type: "result"; result: unknown };

const resolvedVisionSupportCache = new Map<string, boolean>();
const inflightVisionSupportRequests = new Map<string, Promise<boolean>>();

function getVisionSupportCacheKey(providerId: string, modelId: string): string {
	return `${providerId}::${modelId}`;
}
=======
||||||| ancestor
=======
/**
 * Legacy options type for built-in providers.
 * Used for backward compatibility with existing code.
 */
interface BuiltInProviderOptions {
	apiKey?: string;
	baseUrl?: string;
	headers?: string | Record<string, string>;
}
>>>>>>> theirs

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
>>>>>>> theirs

function persistResolvedVisionSupport(model: ChatModel, supportsVision: boolean): void {
	const data = getData();
	const selectedAgent = data.getSelectedAgent();
	const selectedModel = selectedAgent.chatModel;

	if (
		selectedModel?.provider === model.provider &&
		selectedModel.model === model.model &&
		selectedModel.modelConfig.supportsVision === undefined
	) {
		data.updateAgent(selectedAgent.id, {
			chatModel: {
				...selectedModel,
				modelConfig: {
					...selectedModel.modelConfig,
					supportsVision,
				},
			},
		});
	}
}

/**
 * Maps the UI ChatModel type to papa-ts ChooseModelParams.
 * Enriches supportsVision from provider-native APIs first (Ollama, OpenRouter),
 * then falls back to models.dev for other providers.
 */
async function toChooseModelParams(model: ChatModel): Promise<ChooseModelParams> {
	const options = { ...model.modelConfig };
	const cacheKey = getVisionSupportCacheKey(model.provider, model.model);

	if (options.supportsVision !== undefined) {
		resolvedVisionSupportCache.set(cacheKey, options.supportsVision);
	}

	// If supportsVision is not explicitly set, resolve it from provider APIs
	if (options.supportsVision === undefined) {
		try {
			const resolvedSupportsVision = await resolveVisionSupportCached(model.provider, model.model);
			options.supportsVision = resolvedSupportsVision;
			// Persist resolved capability via store update helper (avoid mutating model reference directly).
			persistResolvedVisionSupport(model, resolvedSupportsVision);
		} catch {
			// Non-critical: default to false if all lookups fail
		}
	}

	return {
		provider: model.provider,
		chatModel: model.model,
		options,
	};
}

async function resolveVisionSupportCached(providerId: string, modelId: string): Promise<boolean> {
	const cacheKey = getVisionSupportCacheKey(providerId, modelId);

	const cached = resolvedVisionSupportCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const inflight = inflightVisionSupportRequests.get(cacheKey);
	if (inflight) {
		return inflight;
	}

	const request = resolveVisionSupport(providerId, modelId)
		.then((supportsVision) => {
			resolvedVisionSupportCache.set(cacheKey, supportsVision);
			return supportsVision;
		})
		.finally(() => {
			inflightVisionSupportRequests.delete(cacheKey);
		});

	inflightVisionSupportRequests.set(cacheKey, request);
	return request;
}

/**
 * Resolves vision support from provider-native APIs.
 * Priority: Ollama /api/show → OpenRouter /api/v1/models → models.dev fallback
 */
async function resolveVisionSupport(providerId: string, modelId: string): Promise<boolean> {
	// 1. Ollama: use /api/show capabilities (cached)
	if (providerId === "ollama") {
		const data = getData();
		const auth = data.getResolvedAuthState("ollama");
		if (auth?.baseUrl) {
			const models = await fetchOllamaModelsInfo(auth.baseUrl, [modelId]);
			const info = models.get(modelId);
			if (info) return info.supportsVision ?? false;
		}
	}

	// 2. OpenRouter: derive vision from architecture.input_modalities (cached)
	if (providerId === "openrouter") {
		const models = await fetchOpenRouterModels();
		if (models) {
			const info = models.get(modelId);
			if (info) return extractOpenRouterCapabilities(info).supportsVision;
		}
	}

	// 3. Fallback: models.dev for other providers (OpenAI, Anthropic, etc.)
	const mdInfo = await lookupModelInfo(providerId, modelId);
	if (mdInfo) return mdInfo.attachment ?? false;

	return false;
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
	 * Check if an Obsidian community plugin is enabled (installed and active).
	 * Special case: "math-latex" is always considered enabled (built-in rendering).
	 */
	isPluginEnabled(pluginId: string): boolean {
		if (pluginId === "math-latex") return true; // Built-in capability
		// @ts-ignore - Obsidian plugin API
		return Boolean(this.plugin.app.plugins?.enabledPlugins?.has(pluginId));
	}

	/**
	 * Check if an Obsidian core (internal) plugin is enabled.
	 * Uses undocumented internal API - may need updates with Obsidian changes.
	 * @param pluginId - Core plugin ID (e.g., "canvas", "bases")
	 */
	isInternalPluginEnabled(pluginId: string): boolean {
		// @ts-ignore - Obsidian internal plugin API (not in official types)
		const internalPlugins = this.plugin.app.internalPlugins;
		return Boolean(internalPlugins?.plugins?.[pluginId]?.enabled);
	}

	/**
	 * Get list of enabled plugins from the supported skills.
	 */
	getEnabledPluginIds(): string[] {
		const pluginData = getData();
		const selectedAgent = pluginData.getSelectedAgent();
		return Object.keys(selectedAgent.skills)
			.filter((id) => selectedAgent.skills[id]?.enabled)
			.filter((id) => this.isPluginEnabled(id));
	}

	/**
	 * Assembles the full system prompt from base prompt + enabled skills.
	 * Uses the currently selected agent's configuration.
	 * Only includes skills for plugins that are both enabled AND installed.
	 */
	async assembleSystemPrompt(): Promise<string> {
		const pluginData = getData();
		const selectedAgent = pluginData.getSelectedAgent();

		let prompt = selectedAgent.systemPrompt || BASE_SYSTEM_PROMPT;

		const skillsService = this.plugin.skillsService;
		if (!skillsService?.isDiscovered()) {
			return prompt;
		}

		// Build enable state from agent's skill configuration
		// Skills default to enabled unless explicitly disabled by the agent
		const agentSkills = selectedAgent.skills;
		const enableState: Record<string, boolean> = {};
		for (const [name] of skillsService.getCachedSkills()) {
			// Check agent's skill settings, default to enabled if not specified
			enableState[name] = agentSkills[name]?.enabled ?? true;
		}

		// Add available skills context XML (for skill discovery via load_skill tool)
		const contextXml = skillsService.generateContextXml(enableState);
		if (contextXml) {
			prompt += `\n\n${contextXml}`;
			// Add instruction for dynamic skill loading
			prompt +=
				"\n\n# Skills\nThe above available_skills section lists skills that can help you with specific tasks. When you need detailed instructions for a skill, use the `load_skill` tool with the skill name to retrieve the full instructions. Only load skills when you actually need them for a task.";
		}

		Logger.log(`[AgentManager] Final system prompt length: ${prompt.length} chars`);
		return prompt;
	}

	/**
	 * Updates the agent's system prompt by reassembling from current settings.
	 * Call this after changing base prompt or skills.
	 */
	async updateSystemPrompt(): Promise<void> {
		const assembledPrompt = await this.assembleSystemPrompt();
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
					Logger.warn(`Model discovery failed for ${providerId}:`, error);
					return [];
				}
			}

			return [];
		} catch (error) {
			Logger.error("Error fetching available models", error);
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

<<<<<<< ours
	private buildRunMetadata(
		agentId: string,
		agentName: string,
		chatModel: ChatModel,
	): Record<string, unknown> {
		return {
			agent_id: agentId,
			agent_name: agentName,
			model_provider: chatModel.provider,
			model: chatModel.model,
		};
	}

	/**
||||||| ancestor
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
=======
	/**
>>>>>>> theirs
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
			if (error instanceof ProviderAuthError) {
				return { success: false, message: "Invalid API key" };
			}
			if (error instanceof ProviderEndpointError) {
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
				Logger.info("LangSmith telemetry enabled");
				return telemetry;
			} catch (e) {
				Logger.error("Failed to initialize LangSmith telemetry", e);
			}
		}
		return undefined;
	}

	private async bindTools(agent: Agent) {
		const data = getData();
		const selectedAgent = data.getSelectedAgent();
		const tools: StructuredToolInterface[] = [];

<<<<<<< ours
<<<<<<< ours
		// Helper to check if tool is enabled for the selected agent
		const isToolEnabled = (
			toolId: "search_notes" | "read_note" | "get_all_tags" | "get_properties" | "execute_dataview_query",
		): boolean => {
			return selectedAgent.toolsConfig[toolId]?.enabled ?? true;
||||||| ancestor
		// Helper to check if tool is enabled for the selected agent
		const isToolEnabled = (
			toolId: "search_notes" | "read_note" | "get_all_tags" | "get_properties" | "execute_dataview_query",
		): boolean => {
			// Check selected agent's tools config first, fallback to legacy
			if (selectedAgent?.toolsConfig) {
				return selectedAgent.toolsConfig[toolId]?.enabled ?? true;
			}
			return data.isToolEnabled(toolId);
=======
		const isToolEnabled = (toolId: BuiltInToolId): boolean => {
||||||| ancestor
		const isToolEnabled = (toolId: BuiltInToolId): boolean => {
=======
		// Helper to check if tool is enabled for the selected agent
<<<<<<< ours
		const isToolEnabled = (
			toolId: "search_notes" | "read_note" | "get_all_tags" | "get_properties" | "execute_dataview_query",
		): boolean => {
>>>>>>> theirs
			// Check selected agent's tools config first, fallback to legacy
			if (selectedAgent?.toolsConfig) {
				return selectedAgent.toolsConfig[toolId]?.enabled ?? true;
			}
			return data.isToolEnabled(toolId);
>>>>>>> theirs
||||||| ancestor
		const isToolEnabled = (
			toolId: "search_notes" | "read_note" | "get_all_tags" | "get_properties" | "execute_dataview_query",
		): boolean => {
			// Check selected agent's tools config first, fallback to legacy
			if (selectedAgent?.toolsConfig) {
				return selectedAgent.toolsConfig[toolId]?.enabled ?? true;
			}
			return data.isToolEnabled(toolId);
=======
		const isToolEnabled = (toolId: BuiltInToolId): boolean => {
			return selectedAgent.toolsConfig[toolId]?.enabled ?? true;
>>>>>>> theirs
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
		if (isToolEnabled("read_content")) {
			tools.push(createReadContentTool(this.plugin.app));
		}

		// Add load_skill tool if skillsService is available and has skills
		if (this.plugin.skillsService?.isDiscovered()) {
			const skillsCache = this.plugin.skillsService.getCachedSkills();
			if (skillsCache.size > 0) {
				tools.push(createLoadSkillTool(this.plugin.skillsService));
			}
		}

		const mcpServers = data.getAgentMCPServersForClient(selectedAgent.id);

		// Load MCP tools if configured (only enabled servers)
		if (mcpServers && Object.keys(mcpServers).length > 0) {
			try {
				// Type assertion needed as getMCPServersForClient returns Record<string, unknown>
				// but we know it produces the correct shape for MultiServerMCPClient
				const mcpConfig = { mcpServers } as ConstructorParameters<typeof MultiServerMCPClient>[0];
				Logger.log("Initializing MCP client...", mcpConfig);

				// HACK: Monkey patch the global fetch for the entire lifecycle
				const windowWithFetch = window as Window & { _originalFetch?: typeof fetch };
				if (!windowWithFetch._originalFetch) {
					windowWithFetch._originalFetch = window.fetch;
					window.fetch = createObsidianFetch(windowWithFetch._originalFetch);
				}

				try {
					const mcpClient = new MultiServerMCPClient(mcpConfig);
					const mcpTools = await mcpClient.getTools();
					Logger.log(`Loaded ${mcpTools.length} MCP tools`);
					tools.push(...mcpTools);
				} catch (e) {
					Logger.error("Failed to get MCP tools", e);
				}
			} catch (error) {
				Logger.error("Failed to load MCP tools", error);
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

		Logger.log("[AgentManager] Registry initialized with providers:", this.registry.list());

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

		// Set assembled prompt (base + enabled skills)
		this.agent.setPrompt(await this.assembleSystemPrompt());

<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
||||||| ancestor
		// Get model from selected agent or fallback to legacy default
=======
		// Get model from selected agent
>>>>>>> theirs
||||||| ancestor
		// Get model from selected agent
=======
		// Get model from selected agent or fallback to legacy default
>>>>>>> theirs
||||||| ancestor
		// Get model from selected agent or fallback to legacy default
=======
		// Get model from selected agent
>>>>>>> theirs
		const selectedAgent = pluginData.getSelectedAgent();
		const chatModel = selectedAgent.chatModel;
		if (chatModel) {
			await this.agent.chooseModel(await toChooseModelParams(chatModel));
		}

		// Bind tools
		await this.bindTools(this.agent);
	}

	async *streamQuery(
		query: string,
		threadId = "default-thread",
		checkpointId?: string,
		signal?: AbortSignal,
		attachments?: ChatAttachment[],
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		const agent = await this.ensureAgent();
		const pluginData = getData();

<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
||||||| ancestor
		// Get model from selected agent or fallback to legacy default
=======
		// Get model from selected agent
>>>>>>> theirs
||||||| ancestor
		// Get model from selected agent
=======
		// Get model from selected agent or fallback to legacy default
>>>>>>> theirs
||||||| ancestor
		// Get model from selected agent or fallback to legacy default
=======
		// Get model from selected agent
>>>>>>> theirs
		const selectedAgent = pluginData.getSelectedAgent();
		const chatModel = selectedAgent.chatModel;
		if (chatModel) {
			await agent.chooseModel(await toChooseModelParams(chatModel));
		} else {
			throw new Error("No chat model configured");
		}
		const runMetadata = this.buildRunMetadata(selectedAgent.id, selectedAgent.name, chatModel);

		try {
			for await (const chunk of agent.streamTokens({
				query,
				threadId,
				metadata: runMetadata,
				configurable: checkpointId ? { checkpoint_id: checkpointId } : undefined,
				signal,
				attachments,
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
							aiMessageId: chunk.aiMessageId,
						};
						break;
					case "tool_end":
						yield {
							type: "tool_end",
							toolCallId: chunk.toolCallId,
							toolName: chunk.toolName,
							output: chunk.output,
							aiMessageId: chunk.aiMessageId,
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

			Logger.error("Error streaming query", error);
			throw error;
		} finally {
			// Cleanup logging - stream completed or aborted
			if (signal?.aborted) {
				Logger.log("Stream aborted by user");
			}
		}
	}

	/**
	 * Edit a message by forking from a checkpoint with a new user message.
	 * This creates a new branch from the given checkpoint.
	 */
	async *editFromCheckpoint(
		query: string,
		threadId: string,
		checkpointId: string,
		signal?: AbortSignal,
		attachments?: ChatAttachment[],
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		const agent = await this.ensureAgent();
		const pluginData = getData();

		const selectedAgent = pluginData.getSelectedAgent();
		const chatModel = selectedAgent.chatModel;
		if (chatModel) {
			await agent.chooseModel(await toChooseModelParams(chatModel));
		} else {
			throw new Error("No chat model configured");
		}
		const runMetadata = this.buildRunMetadata(selectedAgent.id, selectedAgent.name, chatModel);

		try {
			const editOptions = {
				query,
				threadId,
				checkpointId,
				metadata: runMetadata,
				signal,
				attachments,
			} as Parameters<Agent["editFromCheckpoint"]>[0];

			for await (const chunk of agent.editFromCheckpoint(editOptions)) {
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
							aiMessageId: chunk.aiMessageId,
						};
						break;
					case "tool_end":
						yield {
							type: "tool_end",
							toolCallId: chunk.toolCallId,
							toolName: chunk.toolName,
							output: chunk.output,
							aiMessageId: chunk.aiMessageId,
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
			if (error instanceof Error && error.name === "AbortError") {
				return;
			}

			if (error instanceof ProviderEndpointError) {
				const provider = chatModel?.provider;
				if (provider) {
					invalidateProviderState(provider);
				}
				new Notice(error.message);
				throw error;
			}

			Logger.error("Error editing message", error);
			throw error;
		} finally {
			if (signal?.aborted) {
				Logger.log("Edit aborted by user");
			}
		}
	}

	/**
	 * Regenerate an AI response from a checkpoint without adding a new user message.
	 * This creates a new branch from the given checkpoint.
	 */
	async *regenerateFromCheckpoint(
		threadId: string,
		checkpointId: string,
		signal?: AbortSignal,
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		const agent = await this.ensureAgent();
		const pluginData = getData();

		const selectedAgent = pluginData.getSelectedAgent();
		const chatModel = selectedAgent.chatModel;
		if (chatModel) {
			await agent.chooseModel(await toChooseModelParams(chatModel));
		} else {
			throw new Error("No chat model configured");
		}
		const runMetadata = this.buildRunMetadata(selectedAgent.id, selectedAgent.name, chatModel);

		try {
			for await (const chunk of agent.regenerateFromCheckpoint({
				threadId,
				checkpointId,
				metadata: runMetadata,
				signal,
			})) {
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
							aiMessageId: chunk.aiMessageId,
						};
						break;
					case "tool_end":
						yield {
							type: "tool_end",
							toolCallId: chunk.toolCallId,
							toolName: chunk.toolName,
							output: chunk.output,
							aiMessageId: chunk.aiMessageId,
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
			if (error instanceof Error && error.name === "AbortError") {
				return;
			}

			if (error instanceof ProviderEndpointError) {
				const provider = chatModel?.provider;
				if (provider) {
					invalidateProviderState(provider);
				}
				new Notice(error.message);
				throw error;
			}

			Logger.error("Error regenerating response", error);
			throw error;
		} finally {
			if (signal?.aborted) {
				Logger.log("Regeneration aborted by user");
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
					Logger.warn("Failed to get history from agent", e);
				}
			}
			return null;
		} catch (error) {
			Logger.error("Error fetching thread history", error);
			return null;
		}
	}

	async getCheckpointHistory(threadId: string): Promise<CheckpointHistoryItem[]> {
		const agent = await this.ensureAgent();
		return agent.getCheckpointHistory(threadId);
	}

	async getCheckpointMessages(threadId: string, checkpointId: string): Promise<BaseMessage[]> {
		const agent = await this.ensureAgent();
		return agent.getCheckpointMessages(threadId, checkpointId);
	}

	async getLatestCheckpointId(threadId: string): Promise<string | undefined> {
		const agent = await this.ensureAgent();
		return agent.getLatestCheckpointId(threadId);
	}

	async getAllThreads(): Promise<ThreadSnapshot[]> {
		await this.chatManager.load();
		return this.chatManager.listThreads();
	}

	async deleteThread(threadId: string): Promise<void> {
		await this.chatManager.delete(threadId);
	}

	async setLastViewedCheckpoint(threadId: string, checkpointId: string): Promise<void> {
		const snapshot = await this.chatManager.read(threadId, true);
		if (!snapshot) return;

		const currentLastViewed = snapshot.metadata?.lastViewedCheckpointId;
		if (currentLastViewed === checkpointId) {
			return;
		}

		const metadata = {
			...(snapshot.metadata ?? {}),
			lastViewedCheckpointId: checkpointId,
		};

		await this.chatManager.write({
			threadId: snapshot.threadId,
			title: snapshot.title,
			metadata,
			createdAt: snapshot.createdAt,
			updatedAt: snapshot.updatedAt,
		});
	}

	/**
	 * Generate a title for a thread using only the user's first message.
	 * This can run in parallel with streaming since it doesn't need the AI response.
	 */
	async generateThreadTitleFromUserMessage(threadId: string, userMessage: string): Promise<void> {
		const agent = await this.ensureAgent().catch((e) => {
			Logger.warn("Agent not initialized, cannot generate title");
			return null;
		});

		if (!agent) return;

		try {
			const title = await agent.generateTitle(userMessage);
			if (title) {
				Logger.log(`Generated title for thread ${threadId}: "${title}"`);
				await this.chatManager.renameChatFile(threadId, title);
			}
		} catch (error) {
			Logger.error(`Error generating title for thread ${threadId}:`, error);
		}
	}

	/**
	 * Reinitialize the agent with updated settings.
	 * Call this when tool configuration or MCP servers change.
	 */
	async reinitialize(): Promise<void> {
		Logger.log("Reinitializing agent with updated settings...");
		await this.initialize();
		Logger.log("Agent reinitialized successfully");
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
		const defaultChatName = NEW_CHAT_NAME;

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

		const defaultPath = normalizePath(`${folder}/${defaultChatName}.chat`);

		// Initialize with valid thread data structure
		const draftThreadId = defaultChatName;
		const initialData = {
			threadId: draftThreadId,
			createdAt: now,
			updatedAt: now,
			checkpoints: {},
			writes: {},
		};

		if (await this.plugin.app.vault.adapter.exists(defaultPath)) {
			const existing = this.plugin.app.vault.getAbstractFileByPath(defaultPath);
			if (existing && existing instanceof TFile) {
				let shouldReplace = false;
				try {
					const raw = await this.plugin.app.vault.read(existing);
					const parsed = JSON.parse(raw) as {
						checkpoints?: Record<string, unknown>;
						writes?: Record<string, unknown>;
					};

					const checkpointCount = Object.keys(parsed.checkpoints ?? {}).length;
					const writeCount = Object.keys(parsed.writes ?? {}).length;
					shouldReplace = checkpointCount === 0 && writeCount === 0;
				} catch {
					shouldReplace = false;
				}

				if (shouldReplace) {
					await this.plugin.app.vault.modify(existing, `${JSON.stringify(initialData)}\n`);
					await this.chatManager.rebuildIndex();
					await this.plugin.app.workspace.getLeaf(false).openFile(existing);
					return;
				}
			}
		}

		const fallbackPath = normalizePath(`${folder}/${threadId}.chat`);
		const createPath = (await this.plugin.app.vault.adapter.exists(defaultPath)) ? fallbackPath : defaultPath;
		const createThreadIdValue = createPath === defaultPath ? draftThreadId : threadId;

		// Create file directly and open it
		const file = await this.plugin.app.vault.create(
			createPath,
			`${JSON.stringify({ ...initialData, threadId: createThreadIdValue })}\n`,
		);
		await this.chatManager.rebuildIndex();
		await this.plugin.app.workspace.getLeaf(false).openFile(file);
	}

	async promoteDraftThread(currentThreadId: string): Promise<string | null> {
		const nextThreadId = createThreadId();
		const reassigned = await this.chatManager.reassignThreadId(currentThreadId, nextThreadId);
		if (!reassigned) {
			return null;
		}
		return nextThreadId;
	}

	async getAttachmentDirectory(threadId: string): Promise<string> {
		return this.chatManager.getAttachmentDirectory(threadId);
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
