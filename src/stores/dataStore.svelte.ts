import { normalizePath } from "obsidian";
import { BASE_SYSTEM_PROMPT } from "../agent/prompts";
import { getSecret, listSecrets, setSecret } from "../lib/secretStorage";
import type SecondBrainPlugin from "../main";
import type {
	AgentConfig,
	AgentSkillState,
	AgentsConfig,
	BuiltInToolId,
	DefaultEmbedModel,
	MCPServerConfig,
	MCPServersConfig,
	PluginData,
	SearchAlgorithm,
	ToolConfig,
	ToolsConfig,
} from "../types/plugin";
import { genUUIDv7, type UUIDv7 } from "../utils/uuid7Validator";
import type { VectorStoreBackend } from "../vectorstore/types";

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

export class AddChatModelError extends Error {
	constructor(provider: string, modelName: string) {
		super(`Chat model "${modelName}" already exists for provider "${provider}"`);
		this.name = "AddChatModelError";
	}
}

export class SetEmbedModelError extends Error {
	constructor(provider: string, modelName: string) {
		super(`Embed model "${modelName}" not found for provider "${provider}"`);
		this.name = "SetEmbedModelError";
	}
}

export class SetChatModelError extends Error {
	constructor(provider: string, modelName: string) {
		super(`Chat model "${modelName}" not found for provider "${provider}"`);
		this.name = "SetChatModelError";
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
			maxResults: 10,
		},
	},
	read_content: {
		enabled: true,
		name: "read_content",
		description:
			"Read the full content of notes and vault files by path or wiki link (e.g., [[Daily Note]] or ![[report.pdf]]). Supports markdown/text files (.md, .txt, .csv, .json), extracts text from PDFs, and reads Excalidraw drawings (.excalidraw.md) including all elements with their types, positions, dimensions, text content, and connections. Images must be attached directly in chat.",
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
		skills: {},
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
		skills: {},
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

	// Chat settings
	isUsingRag: false,
	retrieveTopK: 100,
	assistantLanguage: "en",
	initialAssistantMessageContent: "Hi",
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
	searchAlgorithm: "lexical",
	defaultEmbedModel: null,
	vectorStoreBackend: "hnsw",
	favoriteModels: [],
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
				this._plugin.app.vault.createFolder(normalized).catch(() => { });
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
			} else {
				result[id] = {
					transport: "http",
					url: config.url,
					...(config.headers && Object.keys(config.headers).length > 0 && { headers: config.headers }),
				};
			}
		}

		return result;
	}

	// --- Agent-specific Skills ---

	/**
	 * Get skill enable states for a specific agent.
	 */
	getAgentSkills(agentId: string): Record<string, AgentSkillState> {
		return this.#data.agents[agentId]?.skills ?? {};
	}

	/**
	 * Set skill enabled state for an agent.
	 * Creates a minimal skill entry if it doesn't exist.
	 */
	setAgentSkillEnabled(agentId: string, skillId: string, enabled: boolean): void {
		const agent = this.#data.agents[agentId];
		if (!agent) return;

		agent.skills[skillId] = { enabled };
		this.saveSettings();
	}

	/**
	 * Delete a skill entry from an agent (only removes enable state, file-based skills remain).
	 */
	deleteAgentSkillEntry(agentId: string, skillId: string): boolean {
		const agent = this.#data.agents[agentId];
		if (!agent?.skills[skillId]) return false;

		delete agent.skills[skillId];
		this.saveSettings();
		return true;
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

	get defaultEmbedModel() {
		return this.#data.defaultEmbedModel;
	}
	set defaultEmbedModel(val: DefaultEmbedModel | null) {
		this.#data.defaultEmbedModel = val;
		this.saveSettings();
	}

	get vectorStoreBackend(): VectorStoreBackend {
		return this.#data.vectorStoreBackend ?? "hnsw";
	}
	set vectorStoreBackend(val: VectorStoreBackend) {
		this.#data.vectorStoreBackend = val;
		this.saveSettings();
	}

	// --- Favorite Models ---

	get favoriteModels(): Array<{ provider: string; model: string }> {
		return this.#data.favoriteModels ?? [];
	}

	isFavoriteModel(provider: string, model: string): boolean {
		return this.#data.favoriteModels?.some((f) => f.provider === provider && f.model === model) ?? false;
	}

	toggleFavoriteModel(provider: string, model: string): void {
		if (!this.#data.favoriteModels) {
			this.#data.favoriteModels = [];
		}
		const idx = this.#data.favoriteModels.findIndex((f) => f.provider === provider && f.model === model);
		if (idx >= 0) {
			this.#data.favoriteModels.splice(idx, 1);
		} else {
			this.#data.favoriteModels.push({ provider, model });
		}
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

	// --- Embedding Model Management (Record-based) ---

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
		if (modelName in config.chatModels) throw new AddChatModelError(provider, modelName);
		config.chatModels = { ...config.chatModels, [modelName]: conf };
		this.saveSettings();
	}

	updateChatModel(provider: string, modelName: string, conf: ChatModelConfig) {
		const config = this.#data.providerConfig[provider];
		if (!config) return;
		if (!(modelName in config.chatModels)) throw new SetChatModelError(provider, modelName);
		config.chatModels = { ...config.chatModels, [modelName]: conf };
		this.saveSettings();
	}

	deleteChatModel(provider: string, modelName: string) {
		const config = this.#data.providerConfig[provider];
		if (!config) return;
		if (!(modelName in config.chatModels)) throw new SetChatModelError(provider, modelName);
		const { [modelName]: _, ...rest } = config.chatModels;
		config.chatModels = rest;

<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
		for (const agent of Object.values(this.#data.agents)) {
			if (
				agent.chatModel &&
				agent.chatModel.provider === provider &&
				agent.chatModel.model === modelName
			) {
				agent.chatModel = null;
			}
		}

||||||| ancestor
		for (const agent of Object.values(this.#data.agents)) {
			if (
				agent.chatModel &&
				agent.chatModel.provider === provider &&
				agent.chatModel.name === modelName
			) {
				agent.chatModel = null;
			}
		}

=======
>>>>>>> theirs
		this.saveSettings();
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
||||||| ancestor
		this.saveSettings();
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
=======
		for (const agent of Object.values(this.#data.agents)) {
			if (
				agent.chatModel &&
				agent.chatModel.provider === provider &&
				agent.chatModel.name === modelName
			) {
				agent.chatModel = null;
			}
>>>>>>> theirs
		}

||||||| ancestor
		for (const agent of Object.values(this.#data.agents)) {
			if (
				agent.chatModel &&
				agent.chatModel.provider === provider &&
				agent.chatModel.name === modelName
			) {
				agent.chatModel = null;
			}
		}

=======
>>>>>>> theirs
		this.saveSettings();
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

		// If disabling, clear any agent chat model using that provider
		if (wasConfigured && !isConfigured) {
			for (const agent of Object.values(this.#data.agents)) {
				if (agent.chatModel?.provider === providerId) {
					agent.chatModel = null;
				}
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

		if (!secretId.trim()) {
			delete config.auth.secretIds[fieldName];
		} else {
			config.auth.secretIds[fieldName] = secretId;
		}
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

	// Ensure at least one agent exists
	if (!rawData?.agents || Object.keys(rawData.agents).length === 0) {
		mergedData.agents = {
			[DEFAULT_AGENT_ID]: createDefaultAgent(),
		};
		mergedData.defaultAgentId = DEFAULT_AGENT_ID;
		mergedData.selectedAgentId = DEFAULT_AGENT_ID;
	} else {
		// Ensure the built-in default agent key always exists
		if (!mergedData.agents[DEFAULT_AGENT_ID]) {
			mergedData.agents[DEFAULT_AGENT_ID] = createDefaultAgent();
		}

		// Normalize all agents to include required fields
		for (const agentId of Object.keys(mergedData.agents)) {
			const agent = mergedData.agents[agentId];
			const legacyTools = (agent.toolsConfig ?? {}) as Record<string, ToolConfig | undefined>;
			const legacyReadNote = legacyTools.read_note;
			const legacyReadAttachment = legacyTools.read_attachment;

			// Ensure toolsConfig exists and has all tools
			if (!agent.toolsConfig) {
				agent.toolsConfig = structuredClone(DEFAULT_TOOLS_CONFIG);
			} else {
				agent.toolsConfig = {
					...structuredClone(DEFAULT_TOOLS_CONFIG),
					...agent.toolsConfig,
				};
			}

			const currentReadContent = agent.toolsConfig.read_content;
			const legacyMaxContentLength =
				(legacyReadNote?.settings as { maxContentLength?: number } | undefined)?.maxContentLength ??
				(currentReadContent.settings as { maxContentLength?: number } | undefined)?.maxContentLength ??
				0;

			let mergedReadContentEnabled = currentReadContent.enabled ?? true;
			if (legacyReadNote && legacyReadAttachment) {
				mergedReadContentEnabled = (legacyReadNote.enabled ?? true) && (legacyReadAttachment.enabled ?? true);
			} else if (legacyReadNote) {
				mergedReadContentEnabled = legacyReadNote.enabled ?? true;
			} else if (legacyReadAttachment) {
				mergedReadContentEnabled = legacyReadAttachment.enabled ?? true;
			}

			const mergedReadContentName =
				currentReadContent.name === DEFAULT_TOOLS_CONFIG.read_content.name
					? legacyReadNote?.name || legacyReadAttachment?.name || currentReadContent.name
					: currentReadContent.name;

			const mergedReadContentDescription =
				currentReadContent.description === DEFAULT_TOOLS_CONFIG.read_content.description
					? legacyReadNote?.description || legacyReadAttachment?.description || currentReadContent.description
					: currentReadContent.description;

			agent.toolsConfig.read_content = {
				...currentReadContent,
				enabled: mergedReadContentEnabled,
				name: mergedReadContentName,
				description: mergedReadContentDescription,
				settings: {
					maxContentLength: legacyMaxContentLength,
				},
			};

			delete (agent.toolsConfig as Record<string, ToolConfig | undefined>).read_note;
			delete (agent.toolsConfig as Record<string, ToolConfig | undefined>).read_attachment;

			// Ensure skills exists
			if (!agent.skills) {
				agent.skills = {};
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
