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

export interface PluginData {
	/** All provider states - built-in (pre-populated) + custom (user-created) */
	providerConfig: Record<string, StoredProviderState>;
	/** Extra metadata ONLY for custom providers (displayName, supportsEmbeddings) */
	customProviderMeta: Record<string, CustomProviderMeta>;
	/** Configuration for built-in agent tools */
	toolsConfig: ToolsConfig;
	systemPrompt: string;
	pluginPromptExtensions: Record<string, PluginPromptExtension>;
	initialAssistantMessageContent: string;
	isUsingRag: boolean;
	isGeneratingChatTitle: boolean;
	defaultChatModel: ChatModel | null;
	retrieveTopK: number;
	assistantLanguage: "de" | "en";
	excludeFF: Array<string>;
	includeFF: Array<string>;
	isExcluding: boolean;
	defaultChatName: string;
	targetFolder: string;
	isChatComfy: boolean;
	isOnboarded: boolean;
	debuggingLangchainKey: string;
	enableLangSmith: boolean;
	langSmithApiKey: string;
	langSmithProject: string;
	langSmithEndpoint: string;
	mcpServers: MCPServersConfig;
	isQuickSettingsOpen: boolean;
	isVerbose: boolean;
	hideIncognitoWarning: boolean;
	isAutostart: boolean;
	lastActiveChatId: UUIDv7 | null;
	searchAlgorithm: SearchAlgorithm;
}

export type PluginDataKey = keyof PluginData;
