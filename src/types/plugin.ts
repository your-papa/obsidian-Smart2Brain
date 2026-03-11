import type { StoredProviderState } from "../stores/dataStore.svelte";
import type { CustomProviderMeta } from "../types/provider/index";
import type { UUIDv7 } from "../utils/uuid7Validator";
import type { GraphMode, SmartGraphSettings } from "./graph";

export type SearchAlgorithm = "lexical" | "hybrid";

/**
 * Configuration for the default embedding model used for vector search.
 */
export interface DefaultEmbedModel {
	/** Provider ID (e.g., "openai", "ollama") */
	provider: string;
	/** Model ID (e.g., "text-embedding-3-small") */
	model: string;
}

/**
 * Configuration for an embedding index.
 * Each index is uniquely identified by its provider:model combination.
 */
export interface EmbeddingIndexConfig {
	/** Composite key: "provider:model" */
	id: string;
	/** Provider ID (e.g., "openai", "ollama") */
	provider: string;
	/** Model ID (e.g., "text-embedding-3-small") */
	model: string;
	/** When this index config was first added (Unix timestamp ms) */
	createdAt: number;
	/** When this index was last fully built (Unix timestamp ms), null if never built */
	lastBuiltAt: number | null;
	/** Cached document count for UI display */
	documentCount: number;
}

// ============================================================================
// MCP Server Configuration Types
// ============================================================================

/**
 * Transport type for MCP servers
 * - stdio: Local processes (recommended)
 * - http: Streamable HTTP (recommended for remote servers)
 */
export type MCPTransportType = "stdio" | "http";

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
 * Union type for all MCP server configurations
 */
export type MCPServerConfig = MCPStdioServerConfig | MCPHTTPServerConfig;

/**
 * Record of MCP server configurations keyed by server ID
 */
export type MCPServersConfig = Record<string, MCPServerConfig>;

/**
 * Available built-in tool identifiers
 */
export type BuiltInToolId =
	| "search_notes"
	| "read_content"
	| "get_all_tags"
	| "get_properties"
	| "execute_javascript"
	| "execute_dataview_query"
	| "manage_notes";

/**
 * Tool-specific settings for search_notes tool
 */
export interface SearchNotesSettings {
	/** Maximum number of results to return */
	maxResults: number;
	/** Search algorithm to use */
	algorithm: SearchAlgorithm;
}

/**
 * Tool-specific settings for read_content tool
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
 * Tool-specific settings for manage_notes tool
 */
export interface ManageNotesSettings {
	/** Whether note creation operations are allowed */
	allowCreate: boolean;
	/** Whether note update operations are allowed */
	allowUpdate: boolean;
	/** Whether note deletion operations are allowed */
	allowDelete: boolean;
	/** Whether note move operations are allowed */
	allowMove: boolean;
}

/**
 * Union type of all tool-specific settings
 */
export type ToolSpecificSettings =
	| SearchNotesSettings
	| ReadNoteSettings
	| DataviewQuerySettings
	| ManageNotesSettings
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
	/** Optional prompt-only guidance injected into the assembled system prompt when this tool is enabled */
	promptGuidance?: string;
	/** Tool-specific settings */
	settings?: ToolSpecificSettings;
}

/**
 * Configuration for all built-in tools
 */
export type ToolsConfig = Record<BuiltInToolId, ToolConfig>;

/**
 * Agent's skill enable state. Only stores whether the skill is enabled.
 * Skill content and metadata come from file-based skills via SkillsService.
 */
export interface AgentSkillState {
	/** Whether this skill is enabled for the agent */
	enabled: boolean;
}

/**
 * Display information for a skill in the UI.
 * Combines metadata from SkillsService with enable state from agent config.
 */
export interface SkillDisplayInfo {
	/** Unique skill identifier (matches SKILL.md name) */
	id: string;
	/** Display name shown in settings */
	displayName: string;
	/** Description of the skill */
	description: string;
	/** Whether this skill is enabled */
	enabled: boolean;
	/** Skill category */
	category: SkillCategory;
	/** Linked community plugin ID (if any) */
	linkedPluginId?: string;
	/** Linked core plugin ID (if any) */
	corePluginId?: string;
}

// ============================================================================
// Agent Skills Specification Types (https://agentskills.io/specification)
// ============================================================================

/**
 * Skill category for organizing skills in the UI.
 * - "core": Based on Obsidian Core plugins (e.g., Canvas, Bases, Math/LaTeX)
 * - "plugin": Based on Obsidian Community plugins (e.g., Dataview, Charts)
 * - "custom": User-defined skills not tied to any plugin
 */
export type SkillCategory = "core" | "plugin" | "custom";

/**
 * YAML frontmatter for a SKILL.md file per Agent Skills spec.
 * @see https://agentskills.io/specification
 */
export interface SkillFrontmatter {
	/**
	 * Skill identifier. Must be 1-64 characters, lowercase alphanumeric + hyphens.
	 * Must not start/end with hyphen or contain consecutive hyphens.
	 * Must match the parent directory name.
	 */
	name: string;
	/**
	 * Description of what the skill does and when to use it.
	 * Must be 1-1024 characters. Used for skill matching/activation.
	 */
	description: string;
	/** Optional license name or reference to bundled LICENSE file */
	license?: string;
	/**
	 * Optional environment requirements (intended product, system packages, network access).
	 * Max 500 characters.
	 */
	compatibility?: string;
	/** Optional arbitrary key-value metadata */
	metadata?: Record<string, string>;
	/**
	 * Optional space-delimited list of pre-approved tools.
	 * Experimental per spec.
	 */
	allowedTools?: string;
}

/**
 * Skill metadata loaded during discovery phase.
 * Contains only frontmatter + path for efficient context usage (~50-100 tokens per skill).
 */
export interface SkillMetadata {
	/** Parsed frontmatter from SKILL.md */
	frontmatter: SkillFrontmatter;
	/** Absolute path to the skill directory */
	path: string;
	/**
	 * Whether this skill is linked to an Obsidian community plugin (e.g., "dataview").
	 * If set, skill is only active when the plugin is installed and enabled.
	 */
	linkedPluginId?: string;
	/**
	 * Skill category for UI grouping and behavior.
	 * Extracted from frontmatter.metadata.category or inferred from linkedPluginId/corePluginId.
	 */
	category?: SkillCategory;
	/**
	 * Obsidian Core plugin ID this skill is linked to (e.g., "canvas", "bases").
	 * If set, skill is only active when the core plugin is enabled.
	 */
	corePluginId?: string;
}

/**
 * Full skill loaded during activation phase.
 * Contains metadata + full markdown body content for injection into system prompt.
 */
export interface Skill extends SkillMetadata {
	/** Full markdown body content (after frontmatter) */
	content: string;
}

/**
 * Enable/disable state for skills per agent.
 * Stored in data.json - only boolean state, not full content.
 */
export type SkillEnableState = Record<string, boolean>;

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
	/** Skill enable states for this agent (skill name -> state) */
	skills: Record<string, AgentSkillState>;
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

export type DiffViewMode = "word-diff" | "two-pane";

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
	// Chat Settings
	// ============================================================================

	initialAssistantMessageContent: string;
	isUsingRag: boolean;
	retrieveTopK: number;
	assistantLanguage: "de" | "en";
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

	/**
	 * Default embedding model for vector-based search.
	 * When null, embeddings search is disabled.
	 * @deprecated Use embeddingIndexes + searchEmbedIndex/graphEmbedIndex instead.
	 * Kept for backward compatibility during migration.
	 */
	defaultEmbedModel: DefaultEmbedModel | null;

	/**
	 * Registry of all known embedding indexes.
	 * Each index is identified by "provider:model" and stored independently.
	 */
	embeddingIndexes: EmbeddingIndexConfig[];

	/**
	 * Index ID used by search ("provider:model"), or null if not configured.
	 */
	searchEmbedIndex: string | null;

	/**
	 * Index ID used by the graph view ("provider:model"), or null if not configured.
	 */
	graphEmbedIndex: string | null;

	/** @deprecated Kept for data migration. Always "hnsw". */
	vectorStoreBackend?: string;

	/**
	 * User's favorite models for quick access.
	 * Each entry is a {provider, model} pair.
	 */
	favoriteModels: Array<{ provider: string; model: string }>;

	/**
	 * Settings for the Smart Graph View.
	 */
	smartGraphSettings: SmartGraphSettings;

	/**
	 * Last selected graph mode (wiki or smart).
	 */
	lastGraphMode: GraphMode;

	/**
	 * Diff visualization mode in reading view.
	 * - "two-pane": Stacked original/new with rendered markdown (default)
	 * - "word-diff": Inline word-level diff (plain text)
	 */
	diffViewMode: DiffViewMode;
}

export type PluginDataKey = keyof PluginData;
