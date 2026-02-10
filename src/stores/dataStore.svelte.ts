import { normalizePath } from "obsidian";
import { BASE_SYSTEM_PROMPT, DEFAULT_PLUGIN_EXTENSIONS } from "../agent/prompts";
import { getSecret, listSecrets, setSecret } from "../lib/secretStorage";
import SecondBrainPlugin, {
	type AgentConfig,
	type AgentsConfig,
	type BuiltInToolId,
	type MCPServerConfig,
	type MCPServersConfig,
	type PluginData,
	type PluginPromptExtension,
	type SearchAlgorithm,
	type ToolConfig,
	type ToolsConfig,
} from "../main";
import { genUUIDv7, type UUIDv7 } from "../utils/uuid7Validator";
import type { ChatModel } from "./chatStore.svelte";

// Provider system types
import type { AuthObject, ChatModelConfig, CustomProviderMeta, EmbedModelConfig } from "../providers/index";
import { BUILT_IN_PROVIDER_IDS, type BuiltInProviderId } from "../providers/index";

// ============================================================================
// Error Classes
// ============================================================================

export class AddEmbedModelError extends Error {
	constructor(provider: string, modelName: string) {
		super(`Embed model "${modelName}" already exists for provider "${provider}"`);
		this.name = "AddEmbedModelError";
	}
}

export class AddGenModelError extends Error {
	constructor(provider: string, modelName: string) {
		super(`Gen model "${modelName}" already exists for provider "${provider}"`);
		this.name = "AddGenModelError";
	}
}

export class SetEmbedModelError extends Error {
	constructor(provider: string, modelName: string) {
		super(`Embed model "${modelName}" not found for provider "${provider}"`);
		this.name = "SetEmbedModelError";
	}
}

export class SetGenModelError extends Error {
	constructor(provider: string, modelName: string) {
		super(`Gen model "${modelName}" not found for provider "${provider}"`);
		this.name = "SetGenModelError";
	}
}

// ============================================================================
// Provider State Types (Unified)
// ============================================================================

/**
 * Stored auth state with secret IDs (not resolved secrets).
 * Secret values are stored in SecretStorage, we only keep IDs here.
 */
export interface StoredAuthState {
	/** Non-secret auth values (e.g., baseUrl) */
	values: Record<string, string>;
	/** Secret IDs for fields stored in SecretStorage (e.g., apiKey) */
	secretIds: Record<string, string>;
}

/**
 * State for a single provider stored in data.json.
 * Unified structure for ALL providers (built-in and custom).
 */
export interface StoredProviderState {
	/** Whether the provider is configured and enabled */
	isConfigured: boolean;
	/** Authentication state with secret IDs */
	auth: StoredAuthState;
	/** Chat model configurations keyed by model ID */
	chatModels: Record<string, ChatModelConfig>;
	/** Embedding model configurations keyed by model ID */
	embedModels: Record<string, EmbedModelConfig>;
}

// ============================================================================
// Default Provider States (New System)
// ============================================================================

/**
 * Creates default auth state.
 * All fields start empty (no default values).
 */
function createDefaultAuth(): StoredAuthState {
	return {
		values: {},
		secretIds: {},
	};
}

/**
 * Default states for all built-in providers.
 * These are used when initializing new installations or migrating.
 */
export const DEFAULT_BUILTIN_PROVIDER_STATES: Record<BuiltInProviderId, StoredProviderState> = {
	openai: {
		isConfigured: false,
		auth: createDefaultAuth(),
		chatModels: {
			"chatgpt-4o-latest": { contextWindow: 128000, temperature: 0.4 },
			"gpt-4.1-mini-2025-04-14": { contextWindow: 1047576, temperature: 0.4 },
			"gpt-4.1": { contextWindow: 1047576, temperature: 0.2 },
			"o4-mini": { contextWindow: 200000, temperature: 0.2 },
			o1: { contextWindow: 200000, temperature: 0.2 },
		},
		embedModels: {
			"text-embedding-ada-002": { similarityThreshold: 0.75 },
			"text-embedding-3-large": { similarityThreshold: 0.5 },
			"text-embedding-3-small": { similarityThreshold: 0.5 },
		},
	},
	anthropic: {
		isConfigured: false,
		auth: createDefaultAuth(),
		chatModels: {
			"claude-3-haiku-20240307": { contextWindow: 200000, temperature: 0.5 },
			"claude-3-sonnet-20240229": { contextWindow: 200000, temperature: 0.5 },
			"claude-3-opus-20240229": { contextWindow: 200000, temperature: 0.5 },
			"claude-3-5-sonnet-20241022": { contextWindow: 200000, temperature: 0.5 },
		},
		embedModels: {},
	},
	ollama: {
		isConfigured: false,
		auth: {
			values: {
				baseUrl: "http://localhost:11434",
			},
			secretIds: {},
		},
		chatModels: {
			llama2: { contextWindow: 4096, temperature: 0.5 },
			"llama2-uncensored": { contextWindow: 4096, temperature: 0.5 },
			mistral: { contextWindow: 8000, temperature: 0.5 },
			"mistral-openorca": { contextWindow: 8000, temperature: 0.5 },
			gemma: { contextWindow: 8000, temperature: 0.5 },
			mixtral: { contextWindow: 32000, temperature: 0.5 },
			"dolphin-mixtral": { contextWindow: 32000, temperature: 0.5 },
			phi: { contextWindow: 2048, temperature: 0.5 },
			"llama3.1": { contextWindow: 8192, temperature: 0.5 },
		},
		embedModels: {
			"nomic-embed-text": { similarityThreshold: 0.5 },
			"mxbai-embed-large": { similarityThreshold: 0.5 },
		},
	},
	openrouter: {
		isConfigured: false,
		auth: createDefaultAuth(),
		chatModels: {},
		embedModels: {},
	},
};

// ============================================================================
// Default Agent Configuration
// ============================================================================

/**
 * ID for the default agent that is always present.
 * This agent cannot be deleted.
 */
export const DEFAULT_AGENT_ID = "default-agent";

/**
 * Default configuration for all built-in tools.
 * All tools are enabled by default with standard names and descriptions.
 */
export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
	search_notes: {
		enabled: true,
		name: "search_notes",
		description:
			"Search through your Obsidian notes by keyword. Returns matching file names and metadata (properties/frontmatter) but NO content. Use this to identify relevant notes before using other tools.",
		settings: {
			algorithm: "grep",
			maxResults: 10,
		},
	},
	read_note: {
		enabled: true,
		name: "read_note",
		description:
			"Read the full content of a specific note by its file path. Use this after finding a relevant note with search_notes.",
		settings: {
			maxContentLength: 0,
		},
	},
	get_all_tags: {
		enabled: true,
		name: "get_all_tags",
		description: "Retrieve a list of all tags used in the Obsidian vault. Returns a sorted list of unique tags.",
	},
	get_properties: {
		enabled: true,
		name: "get_properties",
		description:
			"Retrieve properties (frontmatter) from Obsidian. Omit 'note_name' to list all available property keys in the vault.",
	},
	execute_dataview_query: {
		enabled: true,
		name: "execute_dataview_query",
		description:
			"Execute an Obsidian Dataview query (DQL) and return the results in Markdown format. Use this to query notes, metadata, tags, and more using the Dataview Query Language.",
		settings: {
			includeMetadata: true,
		},
	},
};

/**
 * Creates a new agent configuration with default values.
 * @param id - The unique ID for the agent (defaults to a new UUID)
 * @param name - The display name for the agent (defaults to "New Agent")
 */
export function createDefaultAgentConfig(id?: string, name?: string): AgentConfig {
	return {
		id: id ?? genUUIDv7(),
		name: name ?? "New Agent",
		chatModel: null,
		systemPrompt: BASE_SYSTEM_PROMPT,
		pluginPromptExtensions: structuredClone(DEFAULT_PLUGIN_EXTENSIONS),
		toolsConfig: structuredClone(DEFAULT_TOOLS_CONFIG),
		mcpServers: {},
	};
}

/**
 * Creates the default agent that is always present.
 */
function createDefaultAgent(): AgentConfig {
	return {
		id: DEFAULT_AGENT_ID,
		name: "Default Agent",
		chatModel: null,
		systemPrompt: BASE_SYSTEM_PROMPT,
		pluginPromptExtensions: structuredClone(DEFAULT_PLUGIN_EXTENSIONS),
		toolsConfig: structuredClone(DEFAULT_TOOLS_CONFIG),
		mcpServers: {},
	};
}

export const DEFAULT_SETTINGS: PluginData = {
	// Unified provider config - all providers keyed by ID (built-in pre-populated)
	providerConfig: DEFAULT_BUILTIN_PROVIDER_STATES as Record<string, StoredProviderState>,
	// Custom provider metadata - only for custom providers
	customProviderMeta: {},

	// Agent configuration (new)
	agents: {
		[DEFAULT_AGENT_ID]: createDefaultAgent(),
	},
	defaultAgentId: DEFAULT_AGENT_ID,
	selectedAgentId: DEFAULT_AGENT_ID,

	// Legacy fields (kept for migration compatibility)
	toolsConfig: structuredClone(DEFAULT_TOOLS_CONFIG),
	systemPrompt: BASE_SYSTEM_PROMPT,
	pluginPromptExtensions: structuredClone(DEFAULT_PLUGIN_EXTENSIONS),
	defaultChatModel: null,
	mcpServers: {},

	// Chat settings
	isUsingRag: false,
	isGeneratingChatTitle: false,
	retrieveTopK: 100,
	assistantLanguage: "en",
	initialAssistantMessageContent: "Hi",
	defaultChatName: "New Chat",
	targetFolder: "Chats",

	// File filtering
	excludeFF: ["Chats", ".excalidraw.md"],
	includeFF: [],
	isExcluding: true,

	// UI state
	isQuickSettingsOpen: true,
	isVerbose: false,
	hideIncognitoWarning: false,
	isAutostart: false,
	isChatComfy: false,
	isOnboarded: false,
	lastActiveChatId: null,

	// Debugging & telemetry
	enableLangSmith: false,
	langSmithApiKey: "",
	langSmithProject: "obsidian-agent",
	langSmithEndpoint: "https://api.smith.langchain.com",
	debuggingLangchainKey: "",

	// Other
	searchAlgorithm: "grep",
};

export class PluginDataStore {
	#data: PluginData;
	private _plugin: SecondBrainPlugin;

	constructor(plugin: SecondBrainPlugin, initialData: PluginData) {
		this._plugin = plugin;
		this.#data = $state(initialData);
	}

	/**
	 * Persist current settings.
	 * Snapshots the $state to avoid saving reactive proxies.
	 */
	private async saveSettings() {
		const snap = $state.snapshot(this.#data);
		await this._plugin.saveData(snap);
	}

	getLastActiveChatId(): UUIDv7 | null {
		return this.#data.lastActiveChatId;
	}

	setLastActiveChatId(id: UUIDv7 | null) {
		this.#data.lastActiveChatId = id;
		this.saveSettings();
	}

	deleteData() {
		this.#data = DEFAULT_SETTINGS;
		this.saveSettings();
	}

	/**
	 * Get all configured provider IDs.
	 * Returns IDs of providers where isConfigured is true.
	 */
	getConfiguredProviders(): string[] {
		return Object.entries(this.#data.providerConfig)
			.filter(([_, state]) => state.isConfigured)
			.map(([id]) => id);
	}

	/**
	 * Get all available provider IDs (configured or not).
	 * This is simply all keys in providerConfig.
	 */
	getAllProviderIds(): string[] {
		return Object.keys(this.#data.providerConfig);
	}

	/**
	 * Get all configured models across all configured providers.
	 */
	getAllConfiguredModels(): string[] {
		return this.getConfiguredProviders().flatMap((providerId) => {
			const config = this.#data.providerConfig[providerId];
			return config ? Object.keys(config.chatModels) : [];
		});
	}

	get initialAssistantMessageContent() {
		return this.#data.initialAssistantMessageContent;
	}
	set initialAssistantMessageContent(val: string) {
		this.#data.initialAssistantMessageContent = val;
		this.saveSettings();
	}

	get systemPrompt() {
		return this.#data.systemPrompt;
	}
	set systemPrompt(val: string) {
		this.#data.systemPrompt = val;
		this.saveSettings();
	}

	// --- Plugin Prompt Extensions ---

	get pluginPromptExtensions(): Record<string, PluginPromptExtension> {
		return this.#data.pluginPromptExtensions;
	}

	getPluginExtension(pluginId: string): PluginPromptExtension | undefined {
		return this.#data.pluginPromptExtensions[pluginId];
	}

	setPluginExtensionEnabled(pluginId: string, enabled: boolean): void {
		if (this.#data.pluginPromptExtensions[pluginId]) {
			this.#data.pluginPromptExtensions[pluginId].enabled = enabled;
			this.saveSettings();
		}
	}

	setPluginExtensionPrompt(pluginId: string, prompt: string): void {
		if (this.#data.pluginPromptExtensions[pluginId]) {
			this.#data.pluginPromptExtensions[pluginId].prompt = prompt;
			this.saveSettings();
		}
	}

	updatePluginExtension(pluginId: string, updates: Partial<PluginPromptExtension>): void {
		if (this.#data.pluginPromptExtensions[pluginId]) {
			this.#data.pluginPromptExtensions[pluginId] = {
				...this.#data.pluginPromptExtensions[pluginId],
				...updates,
			};
			this.saveSettings();
		}
	}

	resetPluginExtensionToDefault(pluginId: string): void {
		if (DEFAULT_PLUGIN_EXTENSIONS[pluginId]) {
			this.#data.pluginPromptExtensions[pluginId] = structuredClone(DEFAULT_PLUGIN_EXTENSIONS[pluginId]);
			this.saveSettings();
		}
	}

	get isUsingRag() {
		return this.#data.isUsingRag;
	}
	set isUsingRag(val: boolean) {
		this.#data.isUsingRag = val;
		this.saveSettings();
	}

	get retrieveTopK() {
		return this.#data.retrieveTopK;
	}
	set retrieveTopK(val: number) {
		this.#data.retrieveTopK = val;
		this.saveSettings();
	}

	get assistantLanguage() {
		return this.#data.assistantLanguage;
	}
	set assistantLanguage(val: "de" | "en") {
		this.#data.assistantLanguage = val;
		this.saveSettings();
	}

	get isExcluding(): boolean {
		return this.#data.isExcluding;
	}

	toggleIsExcluding() {
		this.#data.isExcluding = !this.#data.isExcluding;
	}

	toggleGeneratingChatTitle() {
		this.#data.isGeneratingChatTitle = !this.#data.isGeneratingChatTitle;
		this.saveSettings();
	}

	get isGeneratingChatTitle(): boolean {
		return this.#data.isGeneratingChatTitle;
	}

	get indexList() {
		if (this.#data.isExcluding) return this.#data.excludeFF;
		return this.#data.includeFF;
	}
	removeIndexList(val: string) {
		if (this.#data.isExcluding) {
			if (!this.#data.excludeFF.includes(val)) return;
			this.#data.excludeFF.remove(val);
		} else {
			if (!this.#data.includeFF.includes(val)) return;
			this.#data.includeFF.remove(val);
		}
		this.saveSettings();
	}

	addIndexList(val: string) {
		if (this.#data.isExcluding) {
			if (this.#data.excludeFF.includes(val)) return;
			this.#data.excludeFF.push(val);
		} else {
			if (this.#data.includeFF.includes(val)) return;
			this.#data.includeFF.push(val);
		}
		this.saveSettings();
	}

	get defaultChatName() {
		return this.#data.defaultChatName;
	}
	set defaultChatName(val: string) {
		this.#data.defaultChatName = val;
		this.saveSettings();
	}

	get targetFolder() {
		return this.#data.targetFolder;
	}
	set targetFolder(val: string) {
		const normalized = normalizePath(val || "Chats");
		this.#data.targetFolder = normalized;
		// Best-effort ensure the folder exists
		try {
			const exists = !!this._plugin.app.vault.getFolderByPath(normalized);
			if (!exists) {
				// Fire and forget; persistence updated regardless
				this._plugin.app.vault.createFolder(normalized).catch(() => {});
			}
		} catch (_) {
			// ignore
		}
		this.saveSettings();
	}

	get isChatComfy() {
		return this.#data.isChatComfy;
	}
	set isChatComfy(val: boolean) {
		this.#data.isChatComfy = val;
		this.saveSettings();
	}

	get isOnboarded() {
		return this.#data.isOnboarded;
	}
	set isOnboarded(val: boolean) {
		this.#data.isOnboarded = val;
		this.saveSettings();
	}

	get enableLangSmith() {
		return this.#data.enableLangSmith;
	}
	set enableLangSmith(val: boolean) {
		this.#data.enableLangSmith = val;
		this.saveSettings();
	}

	get langSmithApiKey() {
		return this.#data.langSmithApiKey;
	}
	set langSmithApiKey(val: string) {
		this.#data.langSmithApiKey = val;
		this.saveSettings();
	}

	get langSmithProject() {
		return this.#data.langSmithProject;
	}
	set langSmithProject(val: string) {
		this.#data.langSmithProject = val;
		this.saveSettings();
	}

	get langSmithEndpoint() {
		return this.#data.langSmithEndpoint;
	}
	set langSmithEndpoint(val: string) {
		this.#data.langSmithEndpoint = val;
		this.saveSettings();
	}

	// --- MCP Servers Configuration ---

	get mcpServers(): MCPServersConfig {
		return this.#data.mcpServers;
	}

	set mcpServers(val: MCPServersConfig) {
		this.#data.mcpServers = val;
		this.saveSettings();
	}

	/**
	 * Get all MCP server IDs.
	 */
	getMCPServerIds(): string[] {
		return Object.keys(this.#data.mcpServers);
	}

	/**
	 * Get configuration for a specific MCP server.
	 */
	getMCPServer(serverId: string): MCPServerConfig | undefined {
		return this.#data.mcpServers[serverId];
	}

	/**
	 * Add or update an MCP server configuration.
	 */
	setMCPServer(serverId: string, config: MCPServerConfig): void {
		this.#data.mcpServers = {
			...this.#data.mcpServers,
			[serverId]: config,
		};
		this.saveSettings();
	}

	/**
	 * Delete an MCP server configuration.
	 */
	deleteMCPServer(serverId: string): void {
		const { [serverId]: _, ...rest } = this.#data.mcpServers;
		this.#data.mcpServers = rest;
		this.saveSettings();
	}

	/**
	 * Toggle enabled state for an MCP server.
	 */
	toggleMCPServerEnabled(serverId: string): void {
		const server = this.#data.mcpServers[serverId];
		if (server) {
			this.#data.mcpServers = {
				...this.#data.mcpServers,
				[serverId]: { ...server, enabled: !server.enabled },
			};
			this.saveSettings();
		}
	}

	/**
	 * Convert typed MCP config to the format expected by MultiServerMCPClient.
	 * Only includes enabled servers.
	 */
	getMCPServersForClient(): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		for (const [id, config] of Object.entries(this.#data.mcpServers)) {
			if (!config.enabled) continue;

			if (config.transport === "stdio") {
				result[id] = {
					transport: "stdio",
					command: config.command,
					args: config.args,
					...(config.env && Object.keys(config.env).length > 0 && { env: config.env }),
				};
			} else if (config.transport === "http") {
				result[id] = {
					transport: "http",
					url: config.url,
					...(config.headers && Object.keys(config.headers).length > 0 && { headers: config.headers }),
				};
			} else if (config.transport === "sse") {
				result[id] = {
					transport: "sse",
					url: config.url,
					...(config.headers && Object.keys(config.headers).length > 0 && { headers: config.headers }),
				};
			}
		}

		return result;
	}

	// ============================================================================
	// Agent Configuration Methods
	// ============================================================================

	/**
	 * Get all agent configurations.
	 */
	get agents(): AgentsConfig {
		return this.#data.agents;
	}

	/**
	 * Get all agent IDs.
	 */
	getAgentIds(): string[] {
		return Object.keys(this.#data.agents);
	}

	/**
	 * Get a specific agent configuration by ID.
	 */
	getAgent(agentId: string): AgentConfig | undefined {
		return this.#data.agents[agentId];
	}

	/**
	 * Get the default agent ID, or null if using "last selected" behavior.
	 */
	get defaultAgentId(): string | null {
		return this.#data.defaultAgentId;
	}

	/**
	 * Get the currently selected agent ID.
	 */
	get selectedAgentId(): string {
		return this.#data.selectedAgentId;
	}

	/**
	 * Set the currently selected agent ID.
	 */
	set selectedAgentId(agentId: string) {
		if (this.#data.agents[agentId]) {
			this.#data.selectedAgentId = agentId;
			this.saveSettings();
		}
	}

	/**
	 * Get the currently selected agent configuration.
	 */
	getSelectedAgent(): AgentConfig {
		const agent = this.#data.agents[this.#data.selectedAgentId];
		// Fallback to default agent if selected agent doesn't exist
		return agent ?? this.#data.agents[DEFAULT_AGENT_ID];
	}

	/**
	 * Get the default agent configuration.
	 * If no default is set (null), returns the built-in default agent.
	 */
	getDefaultAgent(): AgentConfig {
		if (this.#data.defaultAgentId) {
			return this.#data.agents[this.#data.defaultAgentId];
		}
		// Fallback to built-in default agent when no default is set
		return this.#data.agents[DEFAULT_AGENT_ID];
	}

	/**
	 * Set the default agent ID, or null to use "last selected" behavior.
	 * @param agentId - The ID of the agent to set as default, or null to clear
	 * @throws Error if agent doesn't exist (when agentId is not null)
	 */
	setDefaultAgentId(agentId: string | null): void {
		if (agentId !== null && !this.#data.agents[agentId]) {
			throw new Error(`Agent with ID "${agentId}" not found`);
		}
		this.#data.defaultAgentId = agentId;
		this.saveSettings();
	}

	/**
	 * Clear the default agent, enabling "last selected" behavior.
	 */
	clearDefaultAgent(): void {
		this.#data.defaultAgentId = null;
		this.saveSettings();
	}

	/**
	 * Create a new agent with default configuration.
	 * @param name - Display name for the agent
	 * @returns The created agent configuration
	 */
	createAgent(name: string): AgentConfig {
		const agent = createDefaultAgentConfig(undefined, name);
		this.#data.agents = {
			...this.#data.agents,
			[agent.id]: agent,
		};
		this.saveSettings();
		return agent;
	}

	/**
	 * Update an existing agent configuration.
	 * @param agentId - The ID of the agent to update
	 * @param updates - Partial agent configuration to merge
	 * @throws Error if agent doesn't exist
	 */
	updateAgent(agentId: string, updates: Partial<Omit<AgentConfig, "id">>): void {
		const agent = this.#data.agents[agentId];
		if (!agent) {
			throw new Error(`Agent with ID "${agentId}" not found`);
		}

		this.#data.agents = {
			...this.#data.agents,
			[agentId]: {
				...agent,
				...updates,
			},
		};
		this.saveSettings();
	}

	/**
	 * Delete an agent.
	 * Cannot delete the default agent.
	 * @param agentId - The ID of the agent to delete
	 * @throws Error if agent doesn't exist or is the default agent
	 */
	deleteAgent(agentId: string): void {
		if (agentId === DEFAULT_AGENT_ID) {
			throw new Error("Cannot delete the built-in default agent");
		}
		if (!this.#data.agents[agentId]) {
			throw new Error(`Agent with ID "${agentId}" not found`);
		}

		const { [agentId]: _, ...rest } = this.#data.agents;
		this.#data.agents = rest;

		// If deleted agent was selected, switch to the default agent (or built-in default)
		if (this.#data.selectedAgentId === agentId) {
			this.#data.selectedAgentId = this.#data.defaultAgentId ?? DEFAULT_AGENT_ID;
		}

		// If deleted agent was the user's default, clear the default (use last selected)
		if (this.#data.defaultAgentId === agentId) {
			this.#data.defaultAgentId = null;
		}

		this.saveSettings();
	}

	/**
	 * Duplicate an existing agent with a new name.
	 * @param agentId - The ID of the agent to duplicate
	 * @param newName - Name for the duplicated agent
	 * @returns The newly created agent configuration
	 */
	duplicateAgent(agentId: string, newName: string): AgentConfig {
		const sourceAgent = this.#data.agents[agentId];
		if (!sourceAgent) {
			throw new Error(`Agent with ID "${agentId}" not found`);
		}

		// Use JSON parse/stringify for deep copy (safe for serializable config data)
		const clonedAgent = JSON.parse(JSON.stringify(sourceAgent)) as AgentConfig;
		const newAgent: AgentConfig = {
			...clonedAgent,
			id: genUUIDv7(),
			name: newName,
		};

		this.#data.agents = {
			...this.#data.agents,
			[newAgent.id]: newAgent,
		};
		this.saveSettings();
		return newAgent;
	}

	// --- Agent-specific Tool Configuration ---

	/**
	 * Check if a specific tool is enabled for an agent.
	 */
	isAgentToolEnabled(agentId: string, toolId: BuiltInToolId): boolean {
		const agent = this.#data.agents[agentId];
		return agent?.toolsConfig[toolId]?.enabled ?? true;
	}

	/**
	 * Toggle tool enabled state for an agent.
	 */
	toggleAgentToolEnabled(agentId: string, toolId: BuiltInToolId): void {
		const agent = this.#data.agents[agentId];
		if (agent?.toolsConfig[toolId]) {
			agent.toolsConfig[toolId].enabled = !agent.toolsConfig[toolId].enabled;
			this.saveSettings();
		}
	}

	/**
	 * Update tool configuration for an agent.
	 */
	updateAgentToolConfig(agentId: string, toolId: BuiltInToolId, config: Partial<ToolConfig>): void {
		const agent = this.#data.agents[agentId];
		if (agent?.toolsConfig[toolId]) {
			agent.toolsConfig[toolId] = {
				...agent.toolsConfig[toolId],
				...config,
			};
			this.saveSettings();
		}
	}

	// --- Agent-specific MCP Server Configuration ---

	/**
	 * Get MCP servers for a specific agent.
	 */
	getAgentMCPServers(agentId: string): MCPServersConfig {
		return this.#data.agents[agentId]?.mcpServers ?? {};
	}

	/**
	 * Set MCP server for an agent.
	 */
	setAgentMCPServer(agentId: string, serverId: string, config: MCPServerConfig): void {
		const agent = this.#data.agents[agentId];
		if (agent) {
			agent.mcpServers = {
				...agent.mcpServers,
				[serverId]: config,
			};
			this.saveSettings();
		}
	}

	/**
	 * Delete MCP server from an agent.
	 */
	deleteAgentMCPServer(agentId: string, serverId: string): void {
		const agent = this.#data.agents[agentId];
		if (agent) {
			const { [serverId]: _, ...rest } = agent.mcpServers;
			agent.mcpServers = rest;
			this.saveSettings();
		}
	}

	/**
	 * Toggle MCP server enabled state for an agent.
	 */
	toggleAgentMCPServerEnabled(agentId: string, serverId: string): void {
		const agent = this.#data.agents[agentId];
		const server = agent?.mcpServers[serverId];
		if (agent && server) {
			agent.mcpServers = {
				...agent.mcpServers,
				[serverId]: { ...server, enabled: !server.enabled },
			};
			this.saveSettings();
		}
	}

	/**
	 * Convert agent's MCP config to the format expected by MultiServerMCPClient.
	 * Only includes enabled servers.
	 */
	getAgentMCPServersForClient(agentId: string): Record<string, unknown> {
		const agent = this.#data.agents[agentId];
		if (!agent) return {};

		const result: Record<string, unknown> = {};

		for (const [id, config] of Object.entries(agent.mcpServers)) {
			if (!config.enabled) continue;

			if (config.transport === "stdio") {
				result[id] = {
					transport: "stdio",
					command: config.command,
					args: config.args,
					...(config.env && Object.keys(config.env).length > 0 && { env: config.env }),
				};
			} else if (config.transport === "http") {
				result[id] = {
					transport: "http",
					url: config.url,
					...(config.headers && Object.keys(config.headers).length > 0 && { headers: config.headers }),
				};
			} else if (config.transport === "sse") {
				result[id] = {
					transport: "sse",
					url: config.url,
					...(config.headers && Object.keys(config.headers).length > 0 && { headers: config.headers }),
				};
			}
		}

		return result;
	}

	// --- Agent-specific Plugin Prompt Extensions ---

	/**
	 * Get plugin prompt extensions for a specific agent.
	 */
	getAgentPluginExtensions(agentId: string): Record<string, PluginPromptExtension> {
		return this.#data.agents[agentId]?.pluginPromptExtensions ?? {};
	}

	/**
	 * Set plugin extension enabled state for an agent.
	 */
	setAgentPluginExtensionEnabled(agentId: string, pluginId: string, enabled: boolean): void {
		const agent = this.#data.agents[agentId];
		if (agent?.pluginPromptExtensions[pluginId]) {
			agent.pluginPromptExtensions[pluginId].enabled = enabled;
			this.saveSettings();
		}
	}

	/**
	 * Update plugin extension for an agent.
	 */
	updateAgentPluginExtension(agentId: string, pluginId: string, updates: Partial<PluginPromptExtension>): void {
		const agent = this.#data.agents[agentId];
		if (agent?.pluginPromptExtensions[pluginId]) {
			agent.pluginPromptExtensions[pluginId] = {
				...agent.pluginPromptExtensions[pluginId],
				...updates,
			};
			this.saveSettings();
		}
	}

	get debuggingLangchainKey() {
		return this.#data.debuggingLangchainKey;
	}
	set debuggingLangchainKey(val: string) {
		this.#data.debuggingLangchainKey = val;
		this.saveSettings();
	}

	get isQuickSettingsOpen() {
		return this.#data.isQuickSettingsOpen;
	}
	set isQuickSettingsOpen(val: boolean) {
		this.#data.isQuickSettingsOpen = val;
		this.saveSettings();
	}

	get isVerbose() {
		return this.#data.isVerbose;
	}
	set isVerbose(val: boolean) {
		this.#data.isVerbose = val;
		this.saveSettings();
	}

	get hideIncognitoWarning() {
		return this.#data.hideIncognitoWarning;
	}
	set hideIncognitoWarning(val: boolean) {
		this.#data.hideIncognitoWarning = val;
		this.saveSettings();
	}

	get isAutostart() {
		return this.#data.isAutostart;
	}
	toggleAutostart() {
		this.#data.isAutostart = !this.isAutostart;
		this.saveSettings();
	}

	get searchAlgorithm() {
		return this.#data.searchAlgorithm;
	}
	set searchAlgorithm(val: SearchAlgorithm) {
		this.#data.searchAlgorithm = val;
		this.saveSettings();
	}

	// --- Tools Configuration ---

	get toolsConfig(): ToolsConfig {
		return this.#data.toolsConfig;
	}

	/**
	 * Check if a specific tool is enabled.
	 */
	isToolEnabled(toolId: BuiltInToolId): boolean {
		return this.#data.toolsConfig[toolId]?.enabled ?? true;
	}

	/**
	 * Set the enabled state for a specific tool.
	 */
	setToolEnabled(toolId: BuiltInToolId, enabled: boolean): void {
		if (this.#data.toolsConfig[toolId]) {
			this.#data.toolsConfig[toolId].enabled = enabled;
			this.saveSettings();
		}
	}

	/**
	 * Toggle the enabled state for a specific tool.
	 */
	toggleToolEnabled(toolId: BuiltInToolId): void {
		if (this.#data.toolsConfig[toolId]) {
			this.#data.toolsConfig[toolId].enabled = !this.#data.toolsConfig[toolId].enabled;
			this.saveSettings();
		}
	}

	/**
	 * Get the configuration for a specific tool.
	 */
	getToolConfig(toolId: BuiltInToolId): ToolConfig | undefined {
		return this.#data.toolsConfig[toolId];
	}

	/**
	 * Update the configuration for a specific tool.
	 */
	updateToolConfig(toolId: BuiltInToolId, config: Partial<ToolConfig>): void {
		if (this.#data.toolsConfig[toolId]) {
			this.#data.toolsConfig[toolId] = {
				...this.#data.toolsConfig[toolId],
				...config,
			};
			this.saveSettings();
		}
	}

	getDefaultChatModel(): ChatModel | null {
		return this.#data.defaultChatModel;
	}

	//TODO some check here?
	setDefaultChatModel(model: ChatModel | null) {
		this.#data.defaultChatModel = model;
		this.saveSettings();
	}

	// Get/set isConfigured for a provider
	getProviderIsConfigured(provider: string): boolean {
		const config = this.#data.providerConfig[provider];
		return config?.isConfigured ?? false;
	}

	toggleProviderIsConfigured(provider: string) {
		const config = this.#data.providerConfig[provider];
		if (!config) return;

		const wasConfigured = config.isConfigured;
		config.isConfigured = !wasConfigured;

		// If disabling this provider and it's the default model's provider, clear default model
		if (wasConfigured) {
			const defaultModel = this.#data.defaultChatModel;
			if (defaultModel && defaultModel.provider === provider) {
				this.#data.defaultChatModel = null;
			}
		}

		this.saveSettings();
	}

	/**
	 * Get stored provider auth params.
	 * Returns auth values and secret IDs (not resolved secrets).
	 */
	getStoredProviderAuthParams(provider: string): {
		apiKeyId?: string;
		baseUrl?: string;
		headers?: Record<string, string>;
	} {
		const config = this.#data.providerConfig[provider];
		if (!config) return {};

		const auth = config.auth;
		const result: { apiKeyId?: string; baseUrl?: string; headers?: Record<string, string> } = {};

		if (auth.secretIds.apiKey) {
			result.apiKeyId = auth.secretIds.apiKey;
		}
		if (auth.values.baseUrl) {
			result.baseUrl = auth.values.baseUrl;
		}
		if (auth.values.headers) {
			try {
				result.headers = JSON.parse(auth.values.headers);
			} catch {
				// ignore parse errors
			}
		}
		return result;
	}

	/**
	 * Get resolved provider auth params with actual secrets from SecretStorage
	 */
	getResolvedProviderAuth(provider: string): { apiKey?: string; baseUrl?: string; headers?: Record<string, string> } {
		const config = this.#data.providerConfig[provider];
		if (!config) return {};

		const auth = config.auth;
		const resolved: { apiKey?: string; baseUrl?: string; headers?: Record<string, string> } = {};

		// Resolve apiKey secret
		if (auth.secretIds.apiKey) {
			const secret = getSecret(this._plugin.app, auth.secretIds.apiKey);
			if (secret) {
				resolved.apiKey = secret;
			}
		}

		// Copy baseUrl
		if (auth.values.baseUrl) {
			resolved.baseUrl = auth.values.baseUrl;
		}

		// Parse headers
		if (auth.values.headers) {
			try {
				resolved.headers = JSON.parse(auth.values.headers);
			} catch {
				// ignore parse errors
			}
		}

		return resolved;
	}

	/**
	 * Set a stored auth parameter (for non-secret fields like baseUrl)
	 */
	setStoredAuthParam(provider: string, key: string, value: unknown): void {
		const config = this.#data.providerConfig[provider];
		if (!config) return;

		if (key === "apiKeyId") {
			// Store as secret ID
			config.auth.secretIds.apiKey = value as string;
		} else {
			// Store as value
			config.auth.values[key] = value as string;
		}
		this.saveSettings();
	}

	/**
	 * Create a new secret and assign it to a provider
	 */
	createAndAssignSecret(provider: string, secretId: string, secretValue: string): void {
		setSecret(this._plugin.app, secretId, secretValue);
		this.setStoredAuthParam(provider, "apiKeyId", secretId);
	}

	/**
	 * Assign an existing secret to a provider
	 */
	assignSecretToProvider(provider: string, secretId: string): void {
		this.setStoredAuthParam(provider, "apiKeyId", secretId);
	}

	/**
	 * Get the actual API key from SecretStorage
	 */
	getProviderApiKey(provider: string): string | null {
		const config = this.#data.providerConfig[provider];
		if (!config) return null;

		const secretId = config.auth.secretIds.apiKey;
		if (!secretId) return null;
		return getSecret(this._plugin.app, secretId);
	}

	/**
	 * List all available secrets
	 */
	listAvailableSecrets(): string[] {
		return listSecrets(this._plugin.app);
	}

	// --- Embed Model Management (Record-based) ---

	getEmbedModels(provider: string): Record<string, EmbedModelConfig> {
		const config = this.#data.providerConfig[provider];
		return config?.embedModels ?? {};
	}

	addEmbedModel(provider: string, modelName: string, conf: EmbedModelConfig) {
		const config = this.#data.providerConfig[provider];
		if (!config) return;
		if (modelName in config.embedModels) throw new AddEmbedModelError(provider, modelName);
		config.embedModels = { ...config.embedModels, [modelName]: conf };
		this.saveSettings();
	}

	updateEmbedModel(provider: string, modelName: string, conf: EmbedModelConfig) {
		const config = this.#data.providerConfig[provider];
		if (!config) return;
		if (!(modelName in config.embedModels)) throw new SetEmbedModelError(provider, modelName);
		config.embedModels = { ...config.embedModels, [modelName]: conf };
		this.saveSettings();
	}

	deleteEmbedModel(provider: string, modelName: string) {
		const config = this.#data.providerConfig[provider];
		if (!config) return;
		if (!(modelName in config.embedModels)) throw new SetEmbedModelError(provider, modelName);
		const { [modelName]: _, ...rest } = config.embedModels;
		config.embedModels = rest;
		this.saveSettings();
	}

	// --- Chat Model Management (Record-based) ---

	getChatModels(provider: string): Record<string, ChatModelConfig> {
		const config = this.#data.providerConfig[provider];
		return config?.chatModels ?? {};
	}

	addChatModel(provider: string, modelName: string, conf: ChatModelConfig) {
		const config = this.#data.providerConfig[provider];
		if (!config) return;
		if (modelName in config.chatModels) throw new AddGenModelError(provider, modelName);
		config.chatModels = { ...config.chatModels, [modelName]: conf };
		this.saveSettings();
	}

	updateChatModel(provider: string, modelName: string, conf: ChatModelConfig) {
		const config = this.#data.providerConfig[provider];
		if (!config) return;
		if (!(modelName in config.chatModels)) throw new SetGenModelError(provider, modelName);
		config.chatModels = { ...config.chatModels, [modelName]: conf };
		this.saveSettings();
	}

	deleteChatModel(provider: string, modelName: string) {
		const config = this.#data.providerConfig[provider];
		if (!config) return;
		if (!(modelName in config.chatModels)) throw new SetGenModelError(provider, modelName);
		const { [modelName]: _, ...rest } = config.chatModels;
		config.chatModels = rest;

		// Clear default model if the deleted model was the default
		const defaultModel = this.#data.defaultChatModel;
		if (defaultModel && defaultModel.provider === provider && defaultModel.model === modelName) {
			this.#data.defaultChatModel = null;
		}

		this.saveSettings();
	}

	// Legacy aliases for backward compatibility
	getGenModels(provider: string): Record<string, ChatModelConfig> {
		return this.getChatModels(provider);
	}

	addGenModel(provider: string, modelName: string, conf: ChatModelConfig) {
		return this.addChatModel(provider, modelName, conf);
	}

	updateGenModel(provider: string, modelName: string, conf: ChatModelConfig) {
		return this.updateChatModel(provider, modelName, conf);
	}

	deleteGenModel(provider: string, modelName: string) {
		return this.deleteChatModel(provider, modelName);
	}

	// Get/set chatModels
	getProviderChatModels(provider: string): Record<string, ChatModelConfig> | undefined {
		const config = this.#data.providerConfig[provider];
		return config?.chatModels;
	}

	setProviderChatModels(provider: string, value: Record<string, ChatModelConfig>) {
		const config = this.#data.providerConfig[provider];
		if (config) {
			config.chatModels = value;
			this.saveSettings();
		}
	}

	// Legacy aliases
	getProviderGenModels(provider: string): Record<string, ChatModelConfig> | undefined {
		return this.getProviderChatModels(provider);
	}

	setProviderGenModels(provider: string, value: Record<string, ChatModelConfig>) {
		return this.setProviderChatModels(provider, value);
	}

	// ============================================================================
	// Provider System Methods
	// ============================================================================

	/**
	 * Validates if a provider ID is a built-in provider.
	 */
	isBuiltInProviderId(providerId: string): providerId is BuiltInProviderId {
		return (BUILT_IN_PROVIDER_IDS as readonly string[]).includes(providerId);
	}

	/**
	 * Check if a provider ID is a custom provider.
	 */
	isCustomProvider(providerId: string): boolean {
		return providerId in this.#data.customProviderMeta;
	}

	/**
	 * Get stored auth state for a provider.
	 * Returns the stored auth state with secret IDs (not resolved secrets).
	 */
	getStoredAuthState(providerId: string): StoredAuthState | undefined {
		const config = this.#data.providerConfig[providerId];
		return config?.auth;
	}

	/**
	 * Get resolved auth state for a provider.
	 * Resolves secret IDs to actual secret values and returns AuthObject.
	 */
	getResolvedAuthState(providerId: string): AuthObject | undefined {
		const stored = this.getStoredAuthState(providerId);
		if (!stored) return undefined;

		const result: AuthObject = {};

		// Copy non-secret values
		if (stored.values.baseUrl) {
			result.baseUrl = stored.values.baseUrl;
		}

		// Parse headers if present
		if (stored.values.headers) {
			try {
				result.headers = JSON.parse(stored.values.headers);
			} catch {
				// ignore parse errors
			}
		}

		// Resolve secret IDs to actual values
		for (const [fieldName, secretId] of Object.entries(stored.secretIds)) {
			const secretValue = getSecret(this._plugin.app, secretId as string);
			if (secretValue) {
				if (fieldName === "apiKey") {
					result.apiKey = secretValue;
				}
			}
		}

		return result;
	}

	/**
	 * Check if a provider is configured.
	 */
	isProviderConfigured(providerId: string): boolean {
		const config = this.#data.providerConfig[providerId];
		return config?.isConfigured ?? false;
	}

	/**
	 * Set provider configured status.
	 */
	setProviderConfigured(providerId: string, isConfigured: boolean): void {
		const config = this.#data.providerConfig[providerId];
		if (!config) return;

		const wasConfigured = config.isConfigured;
		config.isConfigured = isConfigured;

		// If disabling and it was the default model's provider, clear default
		if (wasConfigured && !isConfigured) {
			const defaultModel = this.#data.defaultChatModel;
			if (defaultModel && defaultModel.provider === providerId) {
				this.#data.defaultChatModel = null;
			}
		}

		this.saveSettings();
	}

	/**
	 * Set a stored auth field value.
	 * For non-secret fields, stores the value directly.
	 * For secret fields, creates/updates the secret in SecretStorage.
	 */
	setProviderAuthField(providerId: string, fieldName: string, value: string, isSecret: boolean): void {
		const config = this.#data.providerConfig[providerId];
		if (!config) return;

		if (isSecret) {
			// Store in SecretStorage and save the ID
			const secretId = `${providerId}-${fieldName}`;
			setSecret(this._plugin.app, secretId, value);
			config.auth.secretIds[fieldName] = secretId;
		} else {
			// Store directly
			config.auth.values[fieldName] = value;
		}
		this.saveSettings();
	}

	/**
	 * Assign an existing secret ID to a provider field.
	 * Unlike setProviderAuthField, this doesn't create a new secret - it just
	 * stores the reference to an existing secret.
	 */
	assignSecretIdToProviderField(providerId: string, fieldName: string, secretId: string): void {
		const config = this.#data.providerConfig[providerId];
		if (!config) return;

		config.auth.secretIds[fieldName] = secretId;
		this.saveSettings();
	}

	// ============================================================================
	// Custom Provider Meta Methods
	// ============================================================================

	/**
	 * Get custom provider metadata.
	 */
	getCustomProviderMeta(providerId: string): CustomProviderMeta | undefined {
		return this.#data.customProviderMeta[providerId];
	}

	/**
	 * Get all custom provider metadata.
	 */
	getAllCustomProviderMeta(): Record<string, CustomProviderMeta> {
		return this.#data.customProviderMeta;
	}

	/**
	 * Get all custom provider IDs.
	 */
	getCustomProviderIds(): string[] {
		return Object.keys(this.#data.customProviderMeta);
	}

	/**
	 * Add a new custom provider.
	 * Creates both the metadata entry and the provider state.
	 *
	 * @param id - Unique provider ID
	 * @param meta - Provider metadata (displayName, supportsEmbeddings)
	 * @throws Error if provider ID already exists or conflicts with built-in
	 */
	async addCustomProvider(id: string, meta: CustomProviderMeta): Promise<void> {
		// Check if ID conflicts with built-in providers
		if (this.isBuiltInProviderId(id)) {
			throw new Error(`Cannot use built-in provider ID "${id}" for custom provider`);
		}

		// Check if ID already exists
		if (id in this.#data.providerConfig) {
			throw new Error(`Provider with ID "${id}" already exists`);
		}

		// Add metadata
		this.#data.customProviderMeta[id] = meta;

		// Add provider state (custom providers are created as configured)
		this.#data.providerConfig[id] = {
			isConfigured: true,
			auth: { values: {}, secretIds: {} },
			chatModels: {},
			embedModels: {},
		};

		await this.saveSettings();
	}

	/**
	 * Update custom provider metadata.
	 *
	 * @throws Error if provider not found or not a custom provider
	 */
	async updateCustomProviderMeta(providerId: string, updates: Partial<CustomProviderMeta>): Promise<void> {
		if (!this.isCustomProvider(providerId)) {
			throw new Error(`Custom provider with ID "${providerId}" not found`);
		}

		this.#data.customProviderMeta[providerId] = {
			...this.#data.customProviderMeta[providerId],
			...updates,
		};

		await this.saveSettings();
	}

	/**
	 * Delete a custom provider.
	 * Removes both the metadata and provider state.
	 *
	 * @throws Error if provider not found or not a custom provider
	 */
	async deleteCustomProvider(providerId: string): Promise<void> {
		if (!this.isCustomProvider(providerId)) {
			throw new Error(`Custom provider with ID "${providerId}" not found`);
		}

		// Remove metadata
		delete this.#data.customProviderMeta[providerId];

		// Remove provider state
		delete this.#data.providerConfig[providerId];

		// Clear default model if it was from this provider
		const defaultModel = this.#data.defaultChatModel;
		if (defaultModel && defaultModel.provider === providerId) {
			this.#data.defaultChatModel = null;
		}

		await this.saveSettings();
	}
}

let _pluginDataStore: PluginDataStore | null = null;

export async function createData(plugin: SecondBrainPlugin): Promise<PluginDataStore> {
	if (_pluginDataStore) return _pluginDataStore;

	const rawData = await plugin.loadData();

	// Merge raw data with defaults (no validation during active development)
	const mergedData: PluginData = {
		...DEFAULT_SETTINGS,
		...rawData,
	};

	// Migration: if user has no pluginPromptExtensions, use defaults
	if (!rawData?.pluginPromptExtensions) {
		mergedData.pluginPromptExtensions = structuredClone(DEFAULT_PLUGIN_EXTENSIONS);
	} else {
		// Merge with defaults to pick up any new plugins added in updates
		mergedData.pluginPromptExtensions = {
			...structuredClone(DEFAULT_PLUGIN_EXTENSIONS),
			...rawData.pluginPromptExtensions,
		};
	}

	// Migration: if user has no toolsConfig, use defaults
	if (!rawData?.toolsConfig) {
		mergedData.toolsConfig = structuredClone(DEFAULT_TOOLS_CONFIG);
	} else {
		// Merge with defaults to pick up any new tools added in updates
		mergedData.toolsConfig = {
			...structuredClone(DEFAULT_TOOLS_CONFIG),
			...rawData.toolsConfig,
		};
	}

	// Migration: if user has old full systemPrompt, reset to base prompt
	// (Their customizations are likely in the old format)
	if (!rawData?.systemPrompt) {
		mergedData.systemPrompt = BASE_SYSTEM_PROMPT;
	}

	// ============================================================================
	// Agent Migration: Migrate legacy fields to agents system
	// ============================================================================

	// If user has no agents configured, create default agent from legacy fields
	if (!rawData?.agents || Object.keys(rawData.agents).length === 0) {
		// Create default agent with user's existing configuration
		const defaultAgent: AgentConfig = {
			id: DEFAULT_AGENT_ID,
			name: "Default Agent",
			chatModel: rawData?.defaultChatModel ?? null,
			systemPrompt: mergedData.systemPrompt,
			pluginPromptExtensions: structuredClone(mergedData.pluginPromptExtensions),
			toolsConfig: structuredClone(mergedData.toolsConfig),
			mcpServers: rawData?.mcpServers ? structuredClone(rawData.mcpServers) : {},
		};

		mergedData.agents = {
			[DEFAULT_AGENT_ID]: defaultAgent,
		};
		mergedData.defaultAgentId = DEFAULT_AGENT_ID;
		mergedData.selectedAgentId = DEFAULT_AGENT_ID;
	} else {
		// Ensure default agent exists (in case it was somehow deleted)
		if (!mergedData.agents[DEFAULT_AGENT_ID]) {
			mergedData.agents[DEFAULT_AGENT_ID] = createDefaultAgent();
		}

		// Ensure all agents have the required fields (migration for new agent fields)
		for (const agentId of Object.keys(mergedData.agents)) {
			const agent = mergedData.agents[agentId];

			// Ensure toolsConfig exists and has all tools
			if (!agent.toolsConfig) {
				agent.toolsConfig = structuredClone(DEFAULT_TOOLS_CONFIG);
			} else {
				agent.toolsConfig = {
					...structuredClone(DEFAULT_TOOLS_CONFIG),
					...agent.toolsConfig,
				};
			}

			// Ensure pluginPromptExtensions exists and has all plugins
			if (!agent.pluginPromptExtensions) {
				agent.pluginPromptExtensions = structuredClone(DEFAULT_PLUGIN_EXTENSIONS);
			} else {
				agent.pluginPromptExtensions = {
					...structuredClone(DEFAULT_PLUGIN_EXTENSIONS),
					...agent.pluginPromptExtensions,
				};
			}

			// Ensure mcpServers exists
			if (!agent.mcpServers) {
				agent.mcpServers = {};
			}

			// Ensure systemPrompt exists
			if (!agent.systemPrompt) {
				agent.systemPrompt = BASE_SYSTEM_PROMPT;
			}
		}

		// Ensure defaultAgentId is valid (null is valid for "last selected" behavior)
		if (mergedData.defaultAgentId !== null && !mergedData.agents[mergedData.defaultAgentId]) {
			// Default agent was deleted, clear it (use last selected)
			mergedData.defaultAgentId = null;
		}
		// Ensure selectedAgentId is valid
		if (!mergedData.selectedAgentId || !mergedData.agents[mergedData.selectedAgentId]) {
			mergedData.selectedAgentId = mergedData.defaultAgentId ?? DEFAULT_AGENT_ID;
		}
	}

	_pluginDataStore = new PluginDataStore(plugin, mergedData);
	return _pluginDataStore;
}

export function getData(): PluginDataStore {
	if (!_pluginDataStore) throw Error("Plugin does not exist");
	return _pluginDataStore;
}
