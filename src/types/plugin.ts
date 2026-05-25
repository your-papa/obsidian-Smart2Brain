import type { StoredProviderState } from "../stores/dataStore.svelte";
import type { ProviderInstanceMeta } from "../types/provider/index";
import type { UUIDv7 } from "../utils/uuid7Validator";
import type { SmartGraphSettings, Space } from "./graph";

export type SpaceImmersionMode = "global" | "per-surface";

export type SearchAlgorithm = "lexical" | "hybrid";

export interface RecentNoteEntry {
	path: string;
	lastOpenedAt: number;
}

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
	/** Documents per embedding request when indexing this model */
	batchSize?: number;
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
	| "list_directory"
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
	/** Whether to include note paths in results */
	showPath?: boolean;
	/** Whether to include note tags in results */
	showTags?: boolean;
	/** Whether to include match badges in results */
	showMatchBadges?: boolean;
	/** Whether to include content snippets and heading context in results */
	showMatchContext?: boolean;
}

/**
 * Tool-specific settings for read_content tool
 */
export interface ReadContentSettings {
	/** Maximum content length to return (0 = unlimited) */
	maxContentLength: number;
	/** Vision model for images: undefined = auto-derive from chat model, null = disabled, ChatModel = explicit */
	imageProcessor?: import("../stores/chatStore.svelte").ChatModel | null;
	/** Vision model for PDFs: undefined = auto-derive from chat model, null = disabled, ChatModel = explicit */
	pdfProcessor?: import("../stores/chatStore.svelte").ChatModel | null;
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
	| ReadContentSettings
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
export const DEFAULT_AGENT_ICON = "bot";

export interface AgentConfig {
	/** Unique identifier for the agent */
	id: string;
	/** Display name for the agent */
	name: string;
	/** Optional Obsidian icon ID or emoji/pictogram for visual identification */
	icon?: string;
	/** Selected chat model for this agent */
	chatModel: import("../stores/chatStore.svelte").ChatModel | null;
	/** Optional summarization model; null means auto-use the chat model */
	summarizationModel: import("../stores/chatStore.svelte").ChatModel | null;
	/** Optional title generation model; null means auto-use the chat model */
	titleModel: import("../stores/chatStore.svelte").ChatModel | null;
	/** Base system prompt for this agent */
	systemPrompt: string;
	/** Skill enable states for this agent (skill name -> state) */
	skills: Record<string, AgentSkillState>;
	/** Configuration for built-in tools */
	toolsConfig: ToolsConfig;
	/** MCP server configurations for this agent */
	mcpServers: MCPServersConfig;
}

/**
 * Record of agent configurations keyed by agent ID
 */
export type AgentsConfig = Record<string, AgentConfig>;

export type DiffViewMode = "word-diff" | "two-pane";

export type ChatOpenLocation = "tab" | "left" | "right";

export type PrivacyMode = "private-by-default" | "public-by-default";

export interface PluginData {
	/** All configured provider instances keyed by opaque provider instance ID */
	providerConfig: Record<string, StoredProviderState>;
	/** Persisted metadata for configured provider instances */
	providerMeta: Record<string, ProviderInstanceMeta>;

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

	targetFolder: string;
	attachmentFolder: string;

	// ============================================================================
	// Privacy
	// ============================================================================

	/** Controls whether listed files are exposed or private for untrusted providers. */
	privacyMode: PrivacyMode;
	/** Filter-backed private file set used to block files for untrusted providers. */
	privacyFilter: import("./graph").ViewFilter;

	// ============================================================================
	// UI State
	// ============================================================================

	chatOpenLocation: ChatOpenLocation;
	lastActiveChatId: UUIDv7 | null;

	// ============================================================================
	// Debugging & Telemetry
	// ============================================================================

	enableLangSmith: boolean;
	langSmithApiKey: string;
	langSmithProject: string;
	langSmithEndpoint: string;
	isVerbose: boolean;

	// ============================================================================
	// Other
	// ============================================================================

	searchAlgorithm: SearchAlgorithm;
	searchShowPath: boolean;
	searchShowTags: boolean;
	searchShowMatchBadges: boolean;
	searchShowMatchContext: boolean;
	searchShowKeyboardHints: boolean;
	recentNotes: RecentNoteEntry[];

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

	/**
	 * User's favorite models for quick access.
	 * Each entry is a {provider, model} pair.
	 */
	favoriteModels: Array<{ provider: string; model: string }>;

	// ============================================================================
	// Spaces (cross-cutting, used by graph, search, chat, agent)
	// ============================================================================

	/** All user-defined spaces */
	spaces: Space[];
	/** ID of the currently immersed space (global mode), or null */
	activeImmersedSpaceId: string | null;
	/** Whether immersion is shared across all surfaces or independent per surface */
	spaceImmersionMode: SpaceImmersionMode;
	/** Space ID used by chat when in per-surface mode */
	chatSpaceId: string | null;

	/**
	 * Settings for the Smart Graph View.
	 */
	smartGraphSettings: SmartGraphSettings;

	/**
	 * Diff visualization mode in reading view.
	 * - "two-pane": Stacked original/new with rendered markdown (default)
	 * - "word-diff": Inline word-level diff (plain text)
	 */
	diffViewMode: DiffViewMode;

	/**
	 * Stable slug derived from the vault name, used to scope IndexedDB database names.
	 * Computed once on first load and persisted so renaming the vault doesn't orphan indexes.
	 * e.g. "My Vault" → "my-vault" or "my-vault-2" if already taken by another vault.
	 */
	vaultSlug: string | null;
}

export type PluginDataKey = keyof PluginData;
