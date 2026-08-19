import type { StoredProviderState } from "../stores/dataStore.svelte";
import type { ProviderInstanceMeta } from "../types/provider/index";
import type { UUIDv7 } from "../utils/uuid7Validator";
import type { SmartGraphSettings } from "./graph";

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
/**
 * All built-in tool ids. This array is the single source of truth — `BuiltInToolId` is
 * derived from it, so adding an id here extends the type automatically (and a runtime
 * loop over every tool, e.g. skill counting, can never fall out of sync with it).
 */
export const BUILT_IN_TOOL_IDS = [
	"search_notes",
	"list_directory",
	"read_content",
	"grep_notes",
	"get_all_tags",
	"get_properties",
	"execute_javascript",
	"manage_notes",
	"fetch_url",
	"web_search",
	"manage_skills",
] as const;

export type BuiltInToolId = (typeof BUILT_IN_TOOL_IDS)[number];

/**
 * Reader for the file-backed prompt surface (per-agent base prompt). Returns the current
 * cached file content, or null when the file is absent. Implemented by the prompt-file layer
 * and injected into the data store so staleness detection stays synchronous inside the
 * reactive `staleGuidance` getter.
 */
export interface PromptFileReader {
	/** Cached content of `System Prompts/<Agent Name>/Base.md`, or null if absent. */
	getBasePrompt(agentId: string): string | null;
	/** Cached content of `System Prompts/<Agent Name>/Memory.md`, or null if absent. */
	getMemoryPrompt(agentId: string): string | null;
}

/**
 * A built-in prompt default that changed in a plugin update while the user had a customized
 * version, so it couldn't be auto-migrated. Surfaced as a dismissable "updated" notice in the
 * new-chat recommendations surface (issue #356). Only the per-agent base system prompt is
 * tracked this way now — skill/tool guidance moved into skill bodies (edited via the note).
 */
export interface StaleGuidance {
	/** Owning agent for the base system prompt. */
	agentId?: string;
	agentName?: string;
	/** Which surface is stale. */
	kind: "system-prompt";
	/** Human-readable label for the notice, e.g. "system prompt". */
	label: string;
}

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
 * Tool-specific settings for grep_notes tool
 */
export interface GrepNotesSettings {
	/** Lines of surrounding context to show on each side of a match */
	contextLines: number;
}

/**
 * Tool-specific settings for fetch_url tool
 */
export interface FetchUrlSettings {
	/** Maximum content length to return after cleaning (0 = unlimited) */
	maxContentLength: number;
}

/**
 * Tool-specific settings for web_search tool
 */
export interface WebSearchSettings {
	/** Maximum number of results to return */
	maxResults: number;
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
	| GrepNotesSettings
	| ManageNotesSettings
	| FetchUrlSettings
	| WebSearchSettings
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
	/** Skill enable states for this agent (skill name -> state) */
	skills: Record<string, AgentSkillState>;
	/** Configuration for built-in tools */
	toolsConfig: ToolsConfig;
	/**
	 * Per-plugin code-exec integration enable state, keyed by `exec:<pluginId>`.
	 * Defaults to disabled (absent = off) — the agent may only run code against a
	 * plugin's public API once the user has explicitly approved that integration.
	 */
	pluginExecTools?: Record<string, boolean>;
	/** MCP server configurations for this agent */
	mcpServers: MCPServersConfig;
	/**
	 * IDs of other agents exposed to this agent as callable subagents via the
	 * `task` delegation tool. Each referenced agent runs with its own model,
	 * tools, and prompt. Delegation is one level deep — a referenced subagent's
	 * own `subAgentIds` are ignored.
	 */
	subAgentIds?: string[];
	/**
	 * Whether this agent records and recalls long-lived facts in the shared memory folder.
	 * Absent = disabled. When enabled (and `manage_notes` is on), the memory guidance is
	 * interpolated into the assembled system prompt and note writes inside the global
	 * `Agents/Memories/` folder auto-apply.
	 *
	 * The folder is global (remembered facts belong to the user, not to one agent); the
	 * guidance injected here is per-agent, living in
	 * `Agents/System Prompts/<Agent Name>/Memory.md` (see `PromptFilesService`), because how
	 * eagerly to read/record is agent behavior.
	 */
	memoryEnabled?: boolean;
}

/**
 * Record of agent configurations keyed by agent ID
 */
export type AgentsConfig = Record<string, AgentConfig>;

export type DiffViewMode = "word-diff" | "two-pane";

export type ChatOpenLocation = "tab" | "left" | "right";

export type PrivacyMode = "private-by-default" | "public-by-default";

export interface PluginData {
	/** Incremented whenever a breaking schema change is made; drives runMigrations(). Absent on pre-versioning data ⇒ treated as 0. */
	schemaVersion: number;

	/** All configured provider instances keyed by opaque provider instance ID */
	providerConfig: Record<string, StoredProviderState>;
	/** Persisted metadata for configured provider instances */
	providerMeta: Record<string, ProviderInstanceMeta>;

	// ============================================================================
	// Agent Configuration (New)
	// ============================================================================

	/** All agent configurations keyed by agent ID */
	agents: AgentsConfig;
	/** ID of the default agent every new chat starts on. Always a valid agent ID. */
	defaultAgentId: string;
	/** ID of the currently selected/active agent */
	selectedAgentId: string;

	// ============================================================================
	// Chat Settings
	// ============================================================================

	targetFolder: string;
	attachmentFolder: string;
	/**
	 * Configurable root vault folder for all agent context (default "Agents"). Holds three
	 * fixed subdirectories: `Memories/` (shared memory notes), `Skills/` (skill
	 * `<name>/SKILL.md` dirs, core skills included), and `System Prompts/` (one
	 * `<Agent Name>/` subfolder per agent, holding that agent's `Base.md` and `Memory.md`).
	 * The whole tree is plugin machinery, excluded from indexing/search/graph via
	 * `isAgentFilePath`.
	 */
	agentFolder: string;
	/**
	 * One-time flag: agent context has been consolidated under the vault `Agents/` folder
	 * (skills moved from the top-level `Skills/` folder or legacy `<configDir>/skills` into
	 * `Agents/Skills/`). Set by `SkillsService.migrateAgentFolder` on first init.
	 */
	agentFolderMigrated: boolean;
	/**
	 * One-time flag: the capability→core-skill migration has run. The 4 former capabilities
	 * (vault/notes/web/update) are now bundled core skills (`Skills/<id>/SKILL.md` with
	 * tools attached via `allowed-tools`). On first init after upgrade, the orphaned
	 * `Skills/<id>/GUIDANCE.md` files are removed so `bootstrapDefaultSkills` can seed the
	 * new SKILL.md into the same dirs. Set by `SkillsService.migrateCoreSkills` on success.
	 */
	coreSkillsSeeded: boolean;
	/**
	 * One-time flag: the `update-skills` → `manage-skills` core-skill folder rename has run
	 * (schema v8, tool renamed `update_skill` → `manage_skills`). Set by
	 * `SkillsService.migrateManageSkillsFolder` on success; a no-op when no legacy folder exists.
	 */
	manageSkillsFolderMigrated: boolean;

	// ============================================================================
	// Privacy
	// ============================================================================

	/** Controls whether listed files are exposed or private for untrusted providers. */
	privacyMode: PrivacyMode;
	/** Filter-backed private file set used to block files for untrusted providers. */
	privacyFilter: import("./viewFilter").ViewFilter;

	// ============================================================================
	// UI State
	// ============================================================================

	chatOpenLocation: ChatOpenLocation;
	lastActiveChatId: UUIDv7 | null;
	/** Whether the user has completed (or dismissed) the first-run onboarding flow. */
	onboardingComplete: boolean;
	/** Whether the onboarding splash intro animation has already played (so it plays only once). */
	onboardingSplashSeen: boolean;
	/** IDs of new-chat recommendations the user has dismissed. Includes the well-known block id to dismiss the whole surface. */
	dismissedRecommendations: string[];
	/**
	 * Default collapse state of a chat turn's thinking process when the user hasn't
	 * toggled that turn individually: expanded (true) or collapsed (false). Persisted
	 * so the choice survives reloads. Default expanded.
	 */
	thinkingProcessExpanded: boolean;

	/**
	 * Whether to show the running-agent indicator in the status bar. When enabled,
	 * each streaming chat surfaces a clickable chip that jumps to that chat.
	 * Persisted; default enabled.
	 */
	showActiveAgentsInStatusBar: boolean;

	/**
	 * Mobile only: make the search button in Obsidian's bottom navbar open S2B
	 * search instead of core's global search. Overriding a core control is a
	 * visible change to host behaviour, so it is opt-in rather than silent.
	 * Core search stays reachable from the command palette.
	 */
	overrideMobileNavbarSearch: boolean;

	/**
	 * Suppresses the warning shown before enabling a plugin integration's `exec_<plugin>`
	 * tool (unsandboxed main-thread `app` access that bypasses per-provider privacy rules).
	 * Global across all integrations. Off by default; reset from Developer settings.
	 */
	suppressIntegrationPrivacyWarning: boolean;

	// ============================================================================
	// Web Search
	// ============================================================================

	/** Selected web search provider ("firecrawl" | "brave" | "tavily" | "") */
	webSearchProvider: string;
	/**
	 * Secret IDs for web search API keys, keyed by provider id. Per-provider so a key
	 * entered for one provider is never transmitted to another when the provider changes.
	 */
	webSearchApiKeyIds: Record<string, string>;

	// ============================================================================
	// Debugging & Telemetry
	// ============================================================================

	enableLangSmith: boolean;
	langSmithApiKeyId: string;
	langSmithProject: string;
	langSmithEndpoint: string;
	isVerbose: boolean;

	/**
	 * Show raw tool input/output (arg key-values + raw output blob) in the chat
	 * tool-call rows. Off by default: users see only the plain-language summary and
	 * the friendly structured result. A developer escape hatch for inspecting the
	 * exact I/O; surfaced only in the DEV-only Developer settings tab.
	 */
	showToolIODetails: boolean;

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
