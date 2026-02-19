import type { ChatModel } from "../stores/chatStore.svelte";
import type { StoredProviderState } from "../stores/dataStore.svelte";
import type { CustomProviderMeta } from "../types/provider/index";
import type { UUIDv7 } from "../utils/uuid7Validator";

export type SearchAlgorithm = "grep" | "omnisearch" | "embeddings";

// ============================================================================
// MCP Server Configuration Types
// ============================================================================

/**
 * Transport type for MCP servers
 * - stdio: Local processes (recommended)
 * - http: Streamable HTTP (recommended for remote servers)
 * - sse: Server-Sent Events (legacy, may have CORS issues in Obsidian)
 */
export type MCPTransportType = "stdio" | "http" | "sse";

/**
 * Base configuration shared by all MCP server types
 */
export interface MCPServerBaseConfig {
	/** Human-readable name for display */
	displayName: string;
	/** Transport type */
	transport: MCPTransportType;
	/** Whether the server is enabled */
	enabled: boolean;
}

/**
 * Configuration for stdio-based MCP servers (local processes)
 */
export interface MCPStdioServerConfig extends MCPServerBaseConfig {
	transport: "stdio";
	/** Command to execute */
	command: string;
	/** Arguments to pass to the command */
	args: string[];
	/** Environment variables */
	env?: Record<string, string>;
}

/**
 * Configuration for HTTP-based MCP servers (Streamable HTTP - recommended for remote)
 */
export interface MCPHTTPServerConfig extends MCPServerBaseConfig {
	transport: "http";
	/** URL of the HTTP server */
	url: string;
	/** Optional headers for authentication */
	headers?: Record<string, string>;
}

/**
 * Configuration for SSE-based MCP servers (legacy, may have CORS issues)
 */
export interface MCPSSEServerConfig extends MCPServerBaseConfig {
	transport: "sse";
	/** URL of the SSE server */
	url: string;
	/** Optional headers for authentication */
	headers?: Record<string, string>;
}

/**
 * Union type for all MCP server configurations
 */
export type MCPServerConfig = MCPStdioServerConfig | MCPHTTPServerConfig | MCPSSEServerConfig;

/**
 * Record of MCP server configurations keyed by server ID
 */
export type MCPServersConfig = Record<string, MCPServerConfig>;

/**
 * Available built-in tool identifiers
 */
export type BuiltInToolId = "search_notes" | "read_note" | "get_all_tags" | "get_properties" | "execute_dataview_query";

/**
 * Tool-specific settings for search_notes tool
 */
export interface SearchNotesSettings {
	/** Search algorithm to use */
	algorithm: SearchAlgorithm;
	/** Maximum number of results to return */
	maxResults: number;
}

/**
 * Tool-specific settings for read_note tool
 */
export interface ReadNoteSettings {
	/** Maximum content length to return (0 = unlimited) */
	maxContentLength: number;
}

/**
 * Tool-specific settings for execute_dataview_query tool
 */
export interface DataviewQuerySettings {
	/** Whether to include file metadata in results */
	includeMetadata: boolean;
}

/**
 * Union type of all tool-specific settings
 */
export type ToolSpecificSettings =
	| SearchNotesSettings
	| ReadNoteSettings
	| DataviewQuerySettings
	| Record<string, never>;

/**
 * Configuration for an individual tool
 */
export interface ToolConfig {
	/** Whether the tool is enabled and available for the agent to use */
	enabled: boolean;
	/** Custom name for the tool (shown to the AI agent) */
	name: string;
	/** Custom description for the tool (shown to the AI agent) */
	description: string;
	/** Tool-specific settings */
	settings?: ToolSpecificSettings;
}

/**
 * Configuration for all built-in tools
 */
export type ToolsConfig = Record<BuiltInToolId, ToolConfig>;

/**
 * Configuration for a plugin-specific prompt extension.
 * These are appended to the base system prompt when the plugin is installed and enabled.
 */
export interface PluginPromptExtension {
	/** Internal plugin ID (e.g., "dataview", "obsidian-charts") */
	pluginId: string;
	/** Display name shown in settings (e.g., "Dataview") */
	displayName: string;
	/** Whether this extension is enabled by the user */
	enabled: boolean;
	/** The prompt content for this plugin */
	prompt: string;
}

// ============================================================================
// Agent Configuration Types
// ============================================================================

/**
 * Configuration for an individual agent.
 * Each agent can have its own model, prompts, and tool configurations.
 */
export interface AgentConfig {
	/** Unique identifier for the agent */
	id: string;
	/** Display name for the agent */
	name: string;
	/** Selected chat model for this agent */
	chatModel: import("../stores/chatStore.svelte").ChatModel | null;
	/** Base system prompt for this agent */
	systemPrompt: string;
	/** Plugin-specific prompt extensions for this agent */
	pluginPromptExtensions: Record<string, PluginPromptExtension>;
	/** Configuration for built-in tools */
	toolsConfig: ToolsConfig;
	/** MCP server configurations for this agent */
	mcpServers: MCPServersConfig;
	/** Optional color for visual identification (uses Obsidian theme colors) */
	color?: AgentColor;
}

/**
 * Available colors for agents, matching Obsidian's theme color variables.
 */
export type AgentColor = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "pink";

/**
 * Record of agent configurations keyed by agent ID
 */
export type AgentsConfig = Record<string, AgentConfig>;

export interface PluginData {
	/** All provider states - built-in (pre-populated) + custom (user-created) */
	providerConfig: Record<string, StoredProviderState>;
	/** Extra metadata ONLY for custom providers (displayName, supportsEmbeddings) */
	customProviderMeta: Record<string, CustomProviderMeta>;

	// ============================================================================
	// Agent Configuration (New)
	// ============================================================================

	/** All agent configurations keyed by agent ID */
	agents: AgentsConfig;
	/** ID of the default agent, or null if using "last selected" behavior */
	defaultAgentId: string | null;
	/** ID of the currently selected/active agent */
	selectedAgentId: string;

	// ============================================================================
	// Legacy fields (kept for migration, will be migrated to default agent)
	// ============================================================================

	/** @deprecated Use agents[agentId].toolsConfig instead */
	toolsConfig: ToolsConfig;
	/** @deprecated Use agents[agentId].systemPrompt instead */
	systemPrompt: string;
	/** @deprecated Use agents[agentId].pluginPromptExtensions instead */
	pluginPromptExtensions: Record<string, PluginPromptExtension>;
	/** @deprecated Use agents[agentId].chatModel instead */
	defaultChatModel: ChatModel | null;
	/** @deprecated Use agents[agentId].mcpServers instead */
	mcpServers: MCPServersConfig;

	// ============================================================================
	// Chat Settings
	// ============================================================================

	initialAssistantMessageContent: string;
	isUsingRag: boolean;
	isGeneratingChatTitle: boolean;
	retrieveTopK: number;
	assistantLanguage: "de" | "en";
	defaultChatName: string;
	targetFolder: string;

	// ============================================================================
	// File Filtering
	// ============================================================================

	excludeFF: Array<string>;
	includeFF: Array<string>;
	isExcluding: boolean;

	// ============================================================================
	// UI State
	// ============================================================================

	isChatComfy: boolean;
	isOnboarded: boolean;
	isQuickSettingsOpen: boolean;
	hideIncognitoWarning: boolean;
	isAutostart: boolean;
	lastActiveChatId: UUIDv7 | null;

	// ============================================================================
	// Debugging & Telemetry
	// ============================================================================

	debuggingLangchainKey: string;
	enableLangSmith: boolean;
	langSmithApiKey: string;
	langSmithProject: string;
	langSmithEndpoint: string;
	isVerbose: boolean;

	// ============================================================================
	// Other
	// ============================================================================

	searchAlgorithm: SearchAlgorithm;
}

export type PluginDataKey = keyof PluginData;
