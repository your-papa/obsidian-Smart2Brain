import { normalizePath } from "obsidian";
import { SHIPPED_BASE_PROMPTS, SHIPPED_MEMORY_PROMPTS } from "../agent/prompts";
import {
	createEmptyPrivacyFilter,
	matchesPrivacyMembershipDraftPath,
	parsePrivacyMembershipFilter,
	resolveViewFilter,
	rewriteViewFilterForRename,
} from "../lib/views";
import { getSecret, listSecrets, removeSecret, setSecret } from "../lib/secretStorage";
import { isAgentFilePath } from "../utils/fileFiltering";
import { sanitizeAgentFileName } from "../utils/agentPaths";
import { type ShippedHistory, currentShippedVersion, isShippedDefault, shippedVersion } from "../utils/shippedDefaults";
import { currentSkillVersion } from "../skills/shippedSkills";
import type SecondBrainPlugin from "../main";
import { DEFAULT_AGENT_ICON } from "../types/plugin";
import type {
	AgentConfig,
	AgentSkillState,
	AgentsConfig,
	BuiltInToolId,
	DefaultEmbedModel,
	ChatOpenLocation,
	DiffViewMode,
	EmbeddingIndexConfig,
	GrepNotesSettings,
	MCPServerConfig,
	MCPServersConfig,
	PluginData,
	PrivacyMode,
	PromptFileReader,
	PromptKindId,
	RecentNoteEntry,
	SearchAlgorithm,
	StaleGuidance,
	ToolConfig,
	ToolsConfig,
} from "../types/plugin";
import { RECENT_NOTE_WINDOW_MS } from "../types/plugin";
import { getDefaultEmbeddingBatchSize, normalizeEmbeddingBatchSize } from "../vectorstore/batchSize";
import { genUUIDv7, type UUIDv7 } from "../utils/uuid7Validator";

import { type SmartGraphSettings, DEFAULT_SMART_GRAPH_SETTINGS } from "../types/graph";
import { applyVerboseLogging } from "../utils/logging";

// Provider system types
import {
	type AuthObject,
	type ChatModelConfig,
	type EmbedModelConfig,
	type OpenAIAuthMode,
	type ProviderInstanceMeta,
	type ProviderTemplateId,
} from "../providers/index";
import { syncAllProviders, syncProvider, unsyncProvider } from "../providers/registrySync";

const LANGSMITH_API_KEY_SECRET_ID = buildManagedSecretId("langsmith", "apiKey");
/** Managed secret id for a web-search provider's API key, e.g. "web-search-brave-api-key". */
function webSearchSecretId(provider: string): string {
	return buildManagedSecretId(`web-search-${provider}`, "apiKey");
}

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
	/** Selected auth mode for providers that support multiple login routes */
	authMode?: OpenAIAuthMode;
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
	/** Whether this provider is trusted to process private/sensitive files */
	trustedForPrivateData?: boolean;
}

// ============================================================================
// Default Provider States (New System)
// ============================================================================

/**
 * Creates default auth state.
 * All fields start empty (no default values).
 */
function createDefaultAuth(authMode: OpenAIAuthMode = "apiKey"): StoredAuthState {
	return {
		values: {},
		secretIds: {},
		authMode,
	};
}

function toSecretIdSegment(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

function buildManagedSecretId(providerId: string, fieldName: string): string {
	return `${toSecretIdSegment(providerId)}-${toSecretIdSegment(fieldName)}`;
}

function createProviderState(templateId: ProviderTemplateId): StoredProviderState {
	// Base URL pre-seed. Only local providers (Ollama, oMLX) are seeded: their baseUrl is a
	// REQUIRED field (shown in the main section) pointing at a well-known local default, so
	// filling it in saves the user typing without side effects.
	//
	// Anthropic is intentionally NOT seeded even though it has a default endpoint: its
	// baseUrl is an OPTIONAL (Advanced) field, and a stored value there forces the Advanced
	// section open on a fresh provider. The provider falls back to its default at runtime
	// (auth.baseUrl || DEFAULT) and the field placeholder shows it, so seeding adds nothing.
	// openai-compatible ("Custom") is likewise not seeded — a generic endpoint shouldn't
	// bias toward one vendor.
	const baseUrlByTemplate: Partial<Record<ProviderTemplateId, string>> = {
		ollama: "http://localhost:11434",
		omlx: "http://localhost:8000",
	};
	const authMode = templateId === "openai-codex" ? "codex" : "apiKey";

	return {
		isConfigured: false,
		auth: {
			...createDefaultAuth(authMode),
			values: baseUrlByTemplate[templateId] ? { baseUrl: baseUrlByTemplate[templateId] } : {},
		},
		chatModels: {},
		embedModels: {},
		trustedForPrivateData: templateId === "ollama" || templateId === "omlx",
	};
}

// ============================================================================
// Default Agent Configuration
// ============================================================================

/**
 * ID for the default agent that is always present.
 * This agent cannot be deleted.
 */
export const DEFAULT_AGENT_ID = "default-agent";

const READ_CONTENT_GUIDANCE_SHARED = `When reading a note that contains embedded PDFs (\`![[doc.pdf]]\`) or text files (\`![[notes.md]]\`, \`![[data.csv]]\`), use \`read_content\` to read them.
When the user attaches files directly in the chat (PDFs, images, or text files), they are included automatically in the message — no need to call \`read_content\` for those. Attached PDFs and images are processed natively by the model, which is more capable than text extraction.
Text files (.md, .txt, .csv, .json) are returned as-is.
PDF page references are supported: \`[[report.pdf#page=3]]\` for a single page, \`[[report.pdf#page=1-3,5]]\` for multiple pages or ranges. Only the requested pages are returned.
For large text files, use \`offset\` and \`length\` to read in chunks. When a response ends with a 'characters remaining' notice, call \`read_content\` again with the indicated \`offset\` to continue reading.`;

/** No processors: images can't be read, PDFs use text extraction */
export const READ_CONTENT_GUIDANCE_NONE = `${READ_CONTENT_GUIDANCE_SHARED}
For images (\`![[image.png]]\` or \`![alt](image.png)\`), \`read_content\` cannot process them visually. Ask the user to attach images directly in the chat input instead.
PDFs accessed via \`read_content\` are converted to plain text locally. This works for any model but loses layout, images, and formatting. If precise visual understanding matters, suggest the user attach the PDF directly instead.`;

/** Image processor only: images analyzed by vision model, PDFs use text extraction */
export const READ_CONTENT_GUIDANCE_IMAGE = `${READ_CONTENT_GUIDANCE_SHARED}
For images (\`![[image.png]]\` or \`![alt](image.png)\`), \`read_content\` analyzes them using a vision model. Use it to read and understand images in notes.
PDFs accessed via \`read_content\` are converted to plain text locally. This works for any model but loses layout, images, and formatting. If precise visual understanding matters, suggest the user attach the PDF directly instead.`;

/** PDF processor only: images can't be read, PDFs analyzed by vision model */
export const READ_CONTENT_GUIDANCE_PDF = `${READ_CONTENT_GUIDANCE_SHARED}
For images (\`![[image.png]]\` or \`![alt](image.png)\`), \`read_content\` cannot process them visually. Ask the user to attach images directly in the chat input instead.
PDFs accessed via \`read_content\` are analyzed by a vision model with full understanding of charts, tables, diagrams, and visual layout.`;

/** Both processors: images and PDFs analyzed by vision model */
export const READ_CONTENT_GUIDANCE_BOTH = `${READ_CONTENT_GUIDANCE_SHARED}
For images (\`![[image.png]]\` or \`![alt](image.png)\`), \`read_content\` analyzes them using a vision model. Use it to read and understand images in notes.
PDFs accessed via \`read_content\` are analyzed by a vision model with full understanding of charts, tables, diagrams, and visual layout.`;

/** All 4 default guidance variants for matching against user config */
export const READ_CONTENT_GUIDANCE_DEFAULTS = new Set([
	READ_CONTENT_GUIDANCE_NONE,
	READ_CONTENT_GUIDANCE_IMAGE,
	READ_CONTENT_GUIDANCE_PDF,
	READ_CONTENT_GUIDANCE_BOTH,
]);

/**
 * Returns the appropriate read_content prompt guidance based on processor configuration.
 */
export function getReadContentGuidance(hasImageProcessor: boolean, hasPdfProcessor: boolean): string {
	if (hasImageProcessor && hasPdfProcessor) return READ_CONTENT_GUIDANCE_BOTH;
	if (hasImageProcessor) return READ_CONTENT_GUIDANCE_IMAGE;
	if (hasPdfProcessor) return READ_CONTENT_GUIDANCE_PDF;
	return READ_CONTENT_GUIDANCE_NONE;
}

// --- read_content tool description variants ---

const READ_CONTENT_DESC_SHARED = "Read content of vault files by path or wiki link.";

/** No processors: images can't be read */
export const READ_CONTENT_DESC_NONE = `${READ_CONTENT_DESC_SHARED} Supports text, PDFs, and Excalidraw. Images must be attached directly in chat.`;

/** Image processor only */
export const READ_CONTENT_DESC_IMAGE = `${READ_CONTENT_DESC_SHARED} Supports text, PDFs, images, and Excalidraw.`;

/** PDF processor only */
export const READ_CONTENT_DESC_PDF = `${READ_CONTENT_DESC_SHARED} Supports text, PDFs (analyzed via vision model), and Excalidraw. Images must be attached directly in chat.`;

/** Both processors */
export const READ_CONTENT_DESC_BOTH = `${READ_CONTENT_DESC_SHARED} Supports text, PDFs (analyzed via vision model), images, and Excalidraw.`;

/**
 * Returns the appropriate read_content description based on processor configuration.
 */
export function getReadContentDescription(hasImageProcessor: boolean, hasPdfProcessor: boolean): string {
	if (hasImageProcessor && hasPdfProcessor) return READ_CONTENT_DESC_BOTH;
	if (hasImageProcessor) return READ_CONTENT_DESC_IMAGE;
	if (hasPdfProcessor) return READ_CONTENT_DESC_PDF;
	return READ_CONTENT_DESC_NONE;
}

const SEARCH_NOTES_DESC_SHARED =
	"Search through your Obsidian notes, or return recently opened notes. Returns structured JSON with matching file names, paths, tags, match reasons, short match snippets or headings, privacy flags, and metadata (properties/frontmatter). Use this to identify relevant notes before using other tools.";

/** An embedding index exists, so all three retrieval strategies are usable. */
export const SEARCH_NOTES_DESC_EMBEDDINGS = `${SEARCH_NOTES_DESC_SHARED} Pick the retrieval strategy with \`algorithm\`: \`lexical\` (default, fast, exact keyword matching) is usually the right first attempt — escalate to \`semantic\` or \`hybrid\` when wording rather than content is the obstacle.`;

/** No embedding index — semantic and hybrid will fall back to lexical. */
export const SEARCH_NOTES_DESC_LEXICAL_ONLY = `${SEARCH_NOTES_DESC_SHARED} This vault has no embedding index configured, so only \`algorithm: "lexical"\` is available; \`semantic\` and \`hybrid\` fall back to it and say so. Vary your search *terms* rather than the algorithm.`;

/** Returns the search_notes description matching the vault's embedding-index state. */
export function getSearchNotesDescription(hasEmbeddingIndex: boolean): string {
	return hasEmbeddingIndex ? SEARCH_NOTES_DESC_EMBEDDINGS : SEARCH_NOTES_DESC_LEXICAL_ONLY;
}

/**
 * Default configuration for all built-in tools.
 * All tools are enabled by default with standard names and descriptions.
 */
export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
	search_notes: {
		enabled: true,
		name: "search_notes",
		// Seeded with the embeddings variant; `createSearchNotesTool` derives the live text
		// (embeddings vs lexical-only) at build time, so this is only a placeholder for the
		// stored config, never what the model actually sees.
		description: SEARCH_NOTES_DESC_EMBEDDINGS,
		// No settings: retrieval algorithm and result count are per-call tool parameters
		// the model picks, and the result-detail flags are hardcoded on for the agent.
		settings: {},
	},
	list_directory: {
		enabled: true,
		name: "list_directory",
		description:
			"List directories and files in the vault. Use this to understand folder structure before searching or editing notes. The 'path' parameter must be an actual vault folder path (e.g. 'Projects/research').",
	},
	read_content: {
		enabled: true,
		name: "read_content",
		description: READ_CONTENT_DESC_NONE,
	},
	grep_notes: {
		enabled: true,
		name: "grep_notes",
		description:
			"Find an exact text substring or regex pattern across your notes, returning matching lines with line numbers and surrounding context. Unlike search_notes (which ranks notes by relevance and cannot match literal strings), this does exact/regex line-level matching. Provide 'path' to scope the search to a single note. Use it to find literal strings (e.g. 'TODO(fix)', '#deprecated', a wiki link), or to locate exact positions before editing.",
		settings: {
			contextLines: 2,
		} satisfies GrepNotesSettings,
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
	execute_javascript: {
		enabled: true,
		name: "execute_javascript",
		description:
			"Execute isolated JavaScript for calculations and data transformation. Pass structured data via the input field, use return for the final value, and use console.log for intermediate output.",
	},
	manage_notes: {
		enabled: true,
		name: "manage_notes",
		description:
			"Create, update, delete, move, or find-and-replace across markdown notes in one staged batch. For a single note, use 'update' with targeted search-and-replace edits (add is_regex/replace_all to match by regex or replace every occurrence). For vault-wide or folder-scoped find-and-replace, use the 'replace' operation (find/replace, optional is_regex/case_sensitive/path_prefix) — preview its blast radius first with grep_notes. Batch related note operations together.",
		settings: {
			allowCreate: true,
			allowUpdate: true,
			allowDelete: true,
			allowMove: true,
		},
	},
	fetch_url: {
		enabled: false,
		name: "fetch_url",
		description:
			"Fetch a public web page or text resource over HTTP(S) and return its main content. HTML is converted to markdown with scripts, styles, and navigation chrome removed while headings, lists, tables, code blocks, and links are preserved. JSON, plain text, and other text-based responses are returned as-is. Use this when the user asks about a specific URL or when external information is needed that the vault does not contain.",
	},
	web_search: {
		enabled: true,
		name: "web_search",
		description:
			"Search the web and return a list of relevant results (title, URL, snippet). Use this when the user asks about current events, external topics, or anything that cannot be in the vault. Always prefer searching the vault first with search_notes.",
		settings: {
			maxResults: 10,
		},
	},
	manage_skills: {
		enabled: false,
		name: "manage_skills",
		description:
			"Create new skills, revise your own attached skills, or delete skills you created. Changes apply immediately. A skill's name and plugin link are locked once created; only the body and description can change.",
	},
};

/**
 * Safety cap only — it bounds the size of the plugin data file. What actually
 * decides whether a note counts as recent is its age (`RECENT_NOTE_WINDOW_MS`),
 * applied at read time in `search/recentNotes.ts`. The cap is deliberately far
 * above a normal week of note-opening so that a heavy day cannot evict notes
 * that are still inside the window.
 */
const MAX_RECENT_NOTES = 200;

/**
 * Creates a new agent configuration with default values.
 * @param id - The unique ID for the agent (defaults to a new UUID)
 * @param name - The display name for the agent (defaults to "New Agent")
 */
export function createDefaultAgentConfig(id?: string, name?: string): AgentConfig {
	return {
		id: id ?? genUUIDv7(),
		name: name ?? "New Agent",
		icon: DEFAULT_AGENT_ICON,
		chatModel: null,
		summarizationModel: null,
		titleModel: null,
		skills: {},
		toolsConfig: structuredClone(DEFAULT_TOOLS_CONFIG),
		mcpServers: {},
		subAgentIds: [],
		memoryEnabled: false,
	};
}

/**
 * Creates the default agent that is always present.
 */
function createDefaultAgent(): AgentConfig {
	return {
		id: DEFAULT_AGENT_ID,
		name: "S2B Agent",
		icon: DEFAULT_AGENT_ICON,
		chatModel: null,
		summarizationModel: null,
		titleModel: null,
		skills: {},
		toolsConfig: structuredClone(DEFAULT_TOOLS_CONFIG),
		mcpServers: {},
		subAgentIds: [],
		memoryEnabled: false,
	};
}

// ---------------------------------------------------------------------------
// Settings schema versioning
// ---------------------------------------------------------------------------

/** Increment this when making any breaking change to PluginData. Add a corresponding entry to MIGRATIONS. */
const CURRENT_SCHEMA_VERSION = 9;

type Migration = (data: PluginData) => void;

/**
 * One entry per version step. MIGRATIONS[v] upgrades data from version v → v+1.
 * Keep entries in order; never remove them.
 */
const MIGRATIONS: Migration[] = [
	// v0 → v1: first versioned release — no structural changes needed
	(_data) => {},
	// v1 → v2: prompt auto-migration added — logic lives in normalizeAgent() which
	//           runs on every load; the version bump marks that the tracking fields exist
	(_data) => {},
	// v2 → v3: per-capability / per-tool guidance version stamps were added here (issue #356) on
	//          loosely-typed old data. Those fields (capabilityPrompts/promptGuidance and their
	//          version stamps) were all later removed — capability guidance and per-tool how-to now
	//          live in skill bodies (v6, "everything is a skill"). This step is now a historical
	//          no-op; the removed fields are stripped in later migrations / normalizeAgent.
	(_data) => {},
	// v3 → v4: skills relocated from `<configDir>/skills` into a vault folder ("Skills").
	//          Existing installs have skills under the config dir, so mark the async move as
	//          pending (SkillsService.migrateSkillsLocation runs it on next init). The actual
	//          file I/O cannot happen here — migrations are synchronous and data-only.
	(data) => {
		(data as unknown as { skillsRelocated: boolean }).skillsRelocated = false;
	},
	// v4 → v5: all agent context consolidated under one configurable vault root `Agent/`
	//          (Memories/ + Skills/{GUIDANCE.md,skills} + Base Prompts/<id>.md). Guidance
	//          and the base system prompt become files (global guidance; per-agent base prompt),
	//          so the per-agent config fields that used to hold them are dropped, along with the
	//          per-agent memory folder (memory is now the global Agent/Memories/). The async file
	//          move (Skills/ or legacy <configDir>/skills → Agent/Skills/) is marked pending
	//          for SkillsService.migrateAgentFolder to run on next init.
	(data) => {
		data.agentFolder ??= "Agents";
		data.agentFolderMigrated = false;
		// Drop removed top-level fields (superseded by agentFolder).
		const loose = data as unknown as Record<string, unknown>;
		loose.skillsFolder = undefined;
		loose.skillsRelocated = undefined;
		// Drop removed per-agent fields — their content is now file-backed or global.
		for (const agent of Object.values(data.agents ?? {})) {
			const a = agent as unknown as Record<string, unknown>;
			// The base system prompt moves from this config field to a file (Base Prompts/<id>.md).
			// If the user CUSTOMIZED it (not equal to any shipped default), stash it in a transient so
			// the async seed writes it to the new file instead of clobbering it with the factory
			// default. A recognized/absent default is dropped — the file seeds fresh from the default.
			const oldPrompt = typeof a.systemPrompt === "string" ? (a.systemPrompt as string) : "";
			const recognized = !oldPrompt.trim() || isShippedDefault(oldPrompt, SHIPPED_BASE_PROMPTS);
			if (!recognized) a.migratedBasePrompt = oldPrompt;
			a.systemPrompt = undefined;
			a.systemPromptVersion = undefined;
			a.capabilityPrompts = undefined;
			a.capabilityPromptsVersion = undefined;
			a.memoryFolder = undefined;
		}
	},
	// v5 → v6: "everything is a skill". The 4 former capabilities (vault/notes/web/update) become
	//          bundled core skills (`Skills/<id>/SKILL.md`, tools attached via `allowed-tools`); the
	//          eager capability-guidance sections and per-capability GUIDANCE.md files are gone.
	//          Mark the async seed/cleanup pending — SkillsService.migrateCoreSkills runs it on next
	//          init (delete orphan GUIDANCE.md, then bootstrap seeds the new SKILL.md). Also strip the
	//          removed per-tool guidance fields (promptGuidance/promptGuidanceVersion) — per-tool
	//          how-to now lives in the core skill body, not a config field.
	(data) => {
		data.coreSkillsSeeded = false;
		for (const agent of Object.values(data.agents ?? {})) {
			for (const toolCfg of Object.values(agent.toolsConfig ?? {})) {
				const t = toolCfg as unknown as Record<string, unknown>;
				t.promptGuidance = undefined;
				t.promptGuidanceVersion = undefined;
			}
		}
	},
	// v6 → v7: the memory prompt moves from this config field to a file
	//          (Memory Prompts/<Agent Name>.md), same treatment as the v4→v5 base-prompt move.
	//          If the user CUSTOMIZED it (non-empty and not any memory prompt we ever shipped),
	//          stash it in a transient so the async seed (PromptFilesService.seedDefaults)
	//          writes it to the new file instead of clobbering it with the factory default.
	//          A recognized/absent default is dropped — the file seeds fresh from the default.
	(data) => {
		for (const agent of Object.values(data.agents ?? {})) {
			const a = agent as unknown as Record<string, unknown>;
			const oldPrompt = typeof a.memoryPrompt === "string" ? (a.memoryPrompt as string) : "";
			const recognized = !oldPrompt.trim() || isShippedDefault(oldPrompt, SHIPPED_MEMORY_PROMPTS);
			if (!recognized) a.migratedMemoryPrompt = oldPrompt;
			a.memoryPrompt = undefined;
		}
	},
	// v7 → v8: `update_skill` renamed to `manage_skills` (tool now also creates/deletes skills,
	//          not just edits them) and its bundled skill folder renamed `update-skills` →
	//          `manage-skills`. Two independent keyspaces reference the old names and must both
	//          move, preserving any `enabled: false` veto — otherwise a disabled tool/skill would
	//          silently read as enabled again under the new key (toolsConfig via its own default,
	//          agent.skills via the `?? true` fallback in AgentManager.collectEnabledSkills /
	//          attachedToolIds). The on-disk skill folder itself is renamed by
	//          SkillsService.migrateCoreSkills, not here — migrations are synchronous and data-only.
	(data) => {
		for (const agent of Object.values(data.agents ?? {})) {
			const toolsConfig = agent.toolsConfig as unknown as Record<string, unknown>;
			if (toolsConfig && "update_skill" in toolsConfig) {
				toolsConfig.manage_skills = toolsConfig.update_skill;
				toolsConfig.update_skill = undefined;
			}
			const skills = agent.skills as unknown as Record<string, unknown>;
			if (skills && "update-skills" in skills) {
				skills["manage-skills"] = skills["update-skills"];
				skills["update-skills"] = undefined;
			}
		}
	},
	// v8 → v9: clear `authMode: "codex"` from non-OpenAI providers. ProviderSetup's API-key
	//          toggle writes the literal "codex" to mean "not the API-key path" for ANY
	//          OAuth-capable provider, so simply signing in to OpenRouter persisted an OpenAI
	//          ChatGPT-auth flag onto it. isProviderUsingCodexAuth then read that as real codex
	//          auth and suppressed every embedding model the provider offers. The predicate is
	//          now template-scoped, but stored data keeps the bogus flag — and it would still
	//          reopen ProviderSetup with the API-key field hidden — so strip it here.
	(data) => {
		for (const [providerId, config] of Object.entries(data.providerConfig ?? {})) {
			const templateId = data.providerMeta?.[providerId]?.templateId;
			if (templateId === "openai" || templateId === "openai-codex") continue;
			const auth = config?.auth as unknown as Record<string, unknown> | undefined;
			if (auth && auth.authMode === "codex") {
				auth.authMode = "apiKey";
			}
		}
	},
];

function runMigrations(data: PluginData): void {
	const from = data.schemaVersion ?? 0;
	// If data was written by a newer plugin, leave schemaVersion untouched so the
	// correct migrations run again when the user upgrades back to the newer version.
	if (from > CURRENT_SCHEMA_VERSION) return;
	for (let v = from; v < CURRENT_SCHEMA_VERSION; v++) {
		MIGRATIONS[v]?.(data);
	}
	data.schemaVersion = CURRENT_SCHEMA_VERSION;
}

// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: PluginData = {
	schemaVersion: CURRENT_SCHEMA_VERSION,
	// Configured provider instances keyed by opaque provider instance ID
	providerConfig: {},
	// Persisted metadata for configured provider instances
	providerMeta: {},

	// Agent configuration (new)
	agents: {
		[DEFAULT_AGENT_ID]: createDefaultAgent(),
	},
	defaultAgentId: DEFAULT_AGENT_ID,
	selectedAgentId: DEFAULT_AGENT_ID,

	// Chat settings
	targetFolder: "Chats",
	attachmentFolder: "",
	agentFolder: "Agents",
	agentFolderMigrated: false,
	coreSkillsSeeded: false,
	manageSkillsFolderMigrated: false,

	// Privacy
	privacyMode: "private-by-default",
	privacyFilter: createEmptyPrivacyFilter(),

	// UI state
	isVerbose: false,
	showToolIODetails: false,
	chatOpenLocation: "tab" as ChatOpenLocation,
	lastActiveChatId: null,
	onboardingComplete: false,
	onboardingSplashSeen: false,
	dismissedRecommendations: [],
	thinkingProcessExpanded: true,
	showActiveAgentsInStatusBar: true,
	overrideMobileNavbarSearch: false,
	suppressIntegrationPrivacyWarning: false,

	// Debugging & telemetry
	enableLangSmith: false,
	langSmithApiKeyId: "",
	langSmithProject: "obsidian-agent",
	langSmithEndpoint: "https://api.smith.langchain.com",

	// Web search
	webSearchProvider: "firecrawl",
	webSearchApiKeyIds: {},

	// Other
	searchShowPath: true,
	searchShowTags: true,
	searchShowMatchBadges: true,
	searchShowMatchContext: true,
	searchShowKeyboardHints: true,
	recentNotes: [],
	embeddingIndexes: [],
	searchEmbedIndex: null,
	graphEmbedIndex: null,
	favoriteModels: [],

	// Smart Graph View
	smartGraphSettings: DEFAULT_SMART_GRAPH_SETTINGS,

	// Diff view
	diffViewMode: "two-pane",

	vaultSlug: null,
};

export class PluginDataStore {
	#data: PluginData;
	private readonly _plugin: SecondBrainPlugin;

	/**
	 * Guidance surfaces whose built-in default changed while the user had a customization
	 * that couldn't be auto-updated. Now driven by file content (the per-agent base prompt is
	 * file-backed), so the store needs a reader for the file-backed surface — injected via
	 * {@link setPromptFileReader}. Until a reader is set (early startup), nothing is reported.
	 * The moment a user re-aligns a surface, its notice disappears on the next recompute (#356).
	 */
	get staleGuidance(): readonly StaleGuidance[] {
		return computeStaleGuidance(this.#data.agents, this.#promptFileReader, this.#staleSkills);
	}

	/** Reader for file-backed prompt surfaces, injected by the prompt-file store once ready. */
	#promptFileReader: PromptFileReader | null = null;
	setPromptFileReader(reader: PromptFileReader | null): void {
		this.#promptFileReader = reader;
	}

	/**
	 * Bundled skills whose on-disk body is neither the current shipped version nor any older
	 * one — i.e. the user edited them, so seeding couldn't update them in place. Reported by
	 * SkillsService after each bootstrap. `$state` so the reactive `staleGuidance` getter
	 * re-runs when bootstrap finishes (it completes well after the first render).
	 */
	#staleSkills: string[] = $state([]);
	setStaleSkills(skillNames: readonly string[]): void {
		this.#staleSkills = [...skillNames];
	}

	constructor(plugin: SecondBrainPlugin, initialData: PluginData) {
		this._plugin = plugin;
		this.#data = $state(initialData);

		// Keep the privacy filter following renames instead of silently going stale.
		// Under `public-by-default` a stale entry drops out of the *private* set —
		// a note the user marked private would then be readable by untrusted
		// providers with no corresponding edit — so this isn't just UI hygiene.
		// Obsidian fires a `rename` event for every renamed file AND folder
		// (including each descendant folder of a renamed parent), so a single
		// exact-match rewrite per event is sufficient; see `rewriteViewFilterForRename`.
		this._plugin.registerEvent(
			this._plugin.app.vault.on("rename", (file, oldPath) => {
				const rewritten = rewriteViewFilterForRename(this.#data.privacyFilter, oldPath, file.path);
				if (rewritten !== this.#data.privacyFilter) {
					this.#data.privacyFilter = rewritten;
					this.saveSettings();
				}
			}),
		);
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

	async deleteData(): Promise<void> {
		this.#data = structuredClone(DEFAULT_SETTINGS);
		await this.saveSettings();
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

	// ============================================================================
	// Privacy Methods
	// ============================================================================

	get privacyFilter() {
		return this.#data.privacyFilter;
	}

	get privacyMode(): PrivacyMode {
		return this.#data.privacyMode;
	}

	setPrivacyMode(mode: PrivacyMode) {
		this.#data.privacyMode = mode;
		this.saveSettings();
	}

	setPrivacyFilter(filter: PluginData["privacyFilter"]) {
		this.#data.privacyFilter = filter;
		this.saveSettings();
	}

	isFilePrivate(filePath: string): boolean {
		const listed = this.isFileListedInPrivacyFilter(filePath);
		if (this.#data.privacyMode === "private-by-default") {
			return !listed;
		}
		return listed;
	}

	private isFileListedInPrivacyFilter(filePath: string): boolean {
		const parsed = parsePrivacyMembershipFilter(this.#data.privacyFilter);
		if (parsed.isAdvanced) {
			return resolveViewFilter(this._plugin.app, this.#data.privacyFilter, this.getAllVaultPaths()).paths.has(
				filePath,
			);
		}
		return matchesPrivacyMembershipDraftPath(this._plugin.app, parsed.draft, filePath);
	}

	/** Check whether a provider is trusted to process private/sensitive files. */
	isProviderTrusted(providerId: string): boolean {
		return this.#data.providerConfig[providerId]?.trustedForPrivateData ?? false;
	}

	/** Set whether a provider is trusted to process private/sensitive files. */
	setProviderTrusted(providerId: string, trusted: boolean) {
		const config = this.#data.providerConfig[providerId];
		if (!config) return;
		config.trustedForPrivateData = trusted;
		this.saveSettings();
	}

	private getAllVaultPaths(): Set<string> {
		return new Set(
			this._plugin.app.vault
				.getFiles()
				.map((file) => file.path)
				.filter((p) => !isAgentFilePath(p)),
		);
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
		} catch {
			// ignore
		}
		this.saveSettings();
	}

	get attachmentFolder() {
		return this.#data.attachmentFolder;
	}
	set attachmentFolder(val: string) {
		this.#data.attachmentFolder = val;
		this.saveSettings();
	}

	get agentFolder() {
		return this.#data.agentFolder || "Agents";
	}
	set agentFolder(val: string) {
		const normalized = normalizePath(val || "Agents");
		this.#data.agentFolder = normalized;
		// Best-effort ensure the folder exists
		try {
			const exists = !!this._plugin.app.vault.getFolderByPath(normalized);
			if (!exists) {
				this._plugin.app.vault.createFolder(normalized).catch(() => {});
			}
		} catch {
			// ignore
		}
		this.saveSettings();
	}

	get agentFolderMigrated() {
		return this.#data.agentFolderMigrated ?? false;
	}
	set agentFolderMigrated(val: boolean) {
		this.#data.agentFolderMigrated = val;
		this.saveSettings();
	}

	get coreSkillsSeeded() {
		return this.#data.coreSkillsSeeded ?? false;
	}
	set coreSkillsSeeded(val: boolean) {
		this.#data.coreSkillsSeeded = val;
		this.saveSettings();
	}

	get manageSkillsFolderMigrated() {
		return this.#data.manageSkillsFolderMigrated ?? false;
	}
	set manageSkillsFolderMigrated(val: boolean) {
		this.#data.manageSkillsFolderMigrated = val;
		this.saveSettings();
	}

	/**
	 * Resolves the effective attachment folder:
	 * 1. User override (`attachmentFolder` setting) if non-empty
	 * 2. Obsidian's native attachment folder if it's an absolute vault path
	 * 3. Fallback: `{targetFolder}/attachments`
	 */
	get resolvedAttachmentFolder(): string {
		const userOverride = this.#data.attachmentFolder?.trim();
		if (userOverride) return normalizePath(userOverride);

		try {
			// @ts-expect-error — internal Obsidian API
			const obsidianPath: unknown = this._plugin.app.vault.getConfig("attachmentFolderPath");
			if (
				typeof obsidianPath === "string" &&
				obsidianPath.length > 0 &&
				obsidianPath !== "." &&
				!obsidianPath.startsWith("./")
			) {
				return normalizePath(obsidianPath);
			}
		} catch {
			// ignore — API may not exist
		}

		return normalizePath(`${this.#data.targetFolder}/attachments`);
	}

	get enableLangSmith() {
		return this.#data.enableLangSmith;
	}
	set enableLangSmith(val: boolean) {
		this.#data.enableLangSmith = val;
		this.saveSettings();
	}

	get langSmithApiKey() {
		if (!this.#data.langSmithApiKeyId) return "";
		return getSecret(this._plugin.app, this.#data.langSmithApiKeyId) ?? "";
	}
	set langSmithApiKey(val: string) {
		const trimmedValue = val.trim();
		if (trimmedValue) {
			setSecret(this._plugin.app, LANGSMITH_API_KEY_SECRET_ID, trimmedValue);
			this.#data.langSmithApiKeyId = LANGSMITH_API_KEY_SECRET_ID;
		} else {
			if (this.#data.langSmithApiKeyId) {
				setSecret(this._plugin.app, this.#data.langSmithApiKeyId, "");
			}
			this.#data.langSmithApiKeyId = "";
		}
		this.saveSettings();
	}

	get langSmithApiKeyId() {
		return this.#data.langSmithApiKeyId;
	}
	set langSmithApiKeyId(val: string) {
		this.#data.langSmithApiKeyId = val.trim();
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
	// Web Search
	// ============================================================================

	get webSearchProvider() {
		return this.#data.webSearchProvider;
	}
	set webSearchProvider(val: string) {
		this.#data.webSearchProvider = val;
		this.saveSettings();
	}

	/** Resolve the API key for the currently selected provider (empty string if none). */
	get webSearchApiKey() {
		const secretId = this.#data.webSearchApiKeyIds[this.#data.webSearchProvider];
		if (!secretId) return "";
		return getSecret(this._plugin.app, secretId) ?? "";
	}
	/** Store (or clear) the API key for the currently selected provider only. */
	set webSearchApiKey(val: string) {
		const provider = this.#data.webSearchProvider;
		if (!provider) return;
		const trimmedValue = val.trim();
		if (trimmedValue) {
			const secretId = webSearchSecretId(provider);
			setSecret(this._plugin.app, secretId, trimmedValue);
			this.#data.webSearchApiKeyIds[provider] = secretId;
		} else {
			const existing = this.#data.webSearchApiKeyIds[provider];
			if (existing) setSecret(this._plugin.app, existing, "");
			delete this.#data.webSearchApiKeyIds[provider];
		}
		this.saveSettings();
	}

	/** Secret id bound to the current provider's key field in the UI (empty if unset). */
	get webSearchApiKeyId() {
		return this.#data.webSearchApiKeyIds[this.#data.webSearchProvider] ?? "";
	}
	/** Bind an existing secret to the current provider (used by the SecretSelect picker). */
	set webSearchApiKeyId(val: string) {
		const provider = this.#data.webSearchProvider;
		if (!provider) return;
		const trimmed = val.trim();
		if (trimmed) {
			this.#data.webSearchApiKeyIds[provider] = trimmed;
		} else {
			delete this.#data.webSearchApiKeyIds[provider];
		}
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
	 * Get the default agent ID that every new chat starts on. Always valid.
	 */
	get defaultAgentId(): string {
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
	 */
	getDefaultAgent(): AgentConfig {
		// Fall back to the built-in agent if the pointer ever goes stale.
		return this.#data.agents[this.#data.defaultAgentId] ?? this.#data.agents[DEFAULT_AGENT_ID];
	}

	/**
	 * Set the default agent every new chat starts on.
	 * @param agentId - The ID of the agent to set as default
	 * @throws Error if the agent doesn't exist
	 */
	setDefaultAgentId(agentId: string): void {
		if (!this.#data.agents[agentId]) {
			throw new Error(`Agent with ID "${agentId}" not found`);
		}
		this.#data.defaultAgentId = agentId;
		this.saveSettings();
	}

	/**
	 * Create a new agent with default configuration.
	 * @param name - Display name for the agent
	 * @returns The created agent configuration
	 */
	createAgent(name: string): AgentConfig {
		const agent = createDefaultAgentConfig(undefined, this.uniqueAgentName(name));
		this.#data.agents = {
			...this.#data.agents,
			[agent.id]: agent,
		};
		this.saveSettings();
		return agent;
	}

	/**
	 * Ensure an agent's name yields a UNIQUE base-prompt filename. Display names drive each
	 * agent's note filename (via {@link sanitizeAgentFileName}), so uniqueness is enforced on
	 * the *sanitized* form — otherwise two distinct raw names that sanitize to the same file
	 * (e.g. "A/B" and "A B") could still share/orphan a note. Appends " 2", " 3", … until the
	 * sanitized filename is free. `exceptId` excludes the agent being renamed so it can keep
	 * its own name.
	 */
	private uniqueAgentName(desired: string, exceptId?: string): string {
		const base = desired.trim() || "Agent";
		const takenFiles = new Set(
			Object.values(this.#data.agents)
				.filter((agent) => agent.id !== exceptId)
				.map((agent) => sanitizeAgentFileName(agent.name)),
		);
		if (!takenFiles.has(sanitizeAgentFileName(base))) return base;
		for (let n = 2; ; n++) {
			const candidate = `${base} ${n}`;
			if (!takenFiles.has(sanitizeAgentFileName(candidate))) return candidate;
		}
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

		// Keep display names unique (they drive the base-prompt filename). Renaming to your
		// own current name is a no-op; a clash with another agent gets a numeric suffix.
		const normalizedUpdates =
			updates.name !== undefined ? { ...updates, name: this.uniqueAgentName(updates.name, agentId) } : updates;

		this.#data.agents = {
			...this.#data.agents,
			[agentId]: {
				...agent,
				...normalizedUpdates,
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

		// Scrub the deleted agent from any other agent's subagent references, so a
		// dangling ID can't linger in `subAgentIds` (which would show as an enabled
		// subagent in settings while being silently dropped at resolution time).
		for (const other of Object.values(this.#data.agents)) {
			if (other.subAgentIds?.includes(agentId)) {
				other.subAgentIds = other.subAgentIds.filter((id) => id !== agentId);
			}
		}

		// If deleted agent was the default, fall back to the built-in default
		if (this.#data.defaultAgentId === agentId) {
			this.#data.defaultAgentId = DEFAULT_AGENT_ID;
		}

		// If deleted agent was selected, switch to the (now-valid) default agent
		if (this.#data.selectedAgentId === agentId) {
			this.#data.selectedAgentId = this.#data.defaultAgentId;
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

		// Use $state.snapshot to unwrap Svelte proxies, then structuredClone for deep copy
		const clonedAgent = structuredClone($state.snapshot(sourceAgent));
		const newId = genUUIDv7();
		// Preserve self-reference semantics: if the source delegated to itself, the
		// duplicate should delegate to ITSELF (its own isolated copy), not back to the
		// source agent. Remap the source id in subAgentIds to the new id.
		const remappedSubAgentIds = (clonedAgent.subAgentIds ?? []).map((id) => (id === agentId ? newId : id));
		const newAgent: AgentConfig = {
			...clonedAgent,
			id: newId,
			name: this.uniqueAgentName(newName),
			subAgentIds: remappedSubAgentIds,
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

	// --- Per-plugin Code-Exec Integrations ---

	/**
	 * Check whether a per-plugin code-exec integration is enabled for an agent.
	 * Defaults to `false` — integrations are disabled until the user approves them
	 * (contrast built-in tools, which default enabled).
	 */
	isAgentPluginExecEnabled(agentId: string, toolId: string): boolean {
		const agent = this.#data.agents[agentId];
		return agent?.pluginExecTools?.[toolId] ?? false;
	}

	/**
	 * Set the enabled state of a per-plugin code-exec integration for an agent.
	 */
	setAgentPluginExecEnabled(agentId: string, toolId: string, enabled: boolean): void {
		const agent = this.#data.agents[agentId];
		if (!agent) return;
		(agent.pluginExecTools ??= {})[toolId] = enabled;
		this.saveSettings();
	}

	// --- Agent-specific Subagent References ---

	/**
	 * Get the list of subagent (referenced agent) IDs for an agent.
	 */
	getSubAgentIds(agentId: string): string[] {
		return this.#data.agents[agentId]?.subAgentIds ?? [];
	}

	/**
	 * Enable or disable another agent as a subagent of this agent.
	 * Self-reference is allowed: an agent may delegate to an isolated-context
	 * copy of itself. Nesting is capped at one level (the self-copy has no
	 * `task` tool), so this cannot recurse.
	 */
	setSubAgentEnabled(agentId: string, refId: string, enabled: boolean): void {
		const agent = this.#data.agents[agentId];
		if (!agent) return;
		const current = agent.subAgentIds ?? [];
		const has = current.includes(refId);
		if (enabled && !has) {
			agent.subAgentIds = [...current, refId];
		} else if (!enabled && has) {
			agent.subAgentIds = current.filter((id) => id !== refId);
		} else {
			return;
		}
		this.saveSettings();
	}

	/**
	 * Toggle another agent's enabled state as a subagent of this agent.
	 */
	toggleSubAgentRef(agentId: string, refId: string): void {
		const enabled = this.getSubAgentIds(agentId).includes(refId);
		this.setSubAgentEnabled(agentId, refId, !enabled);
	}

	/**
	 * Resolve an agent's subagent references to the live AgentConfig objects.
	 * Self-reference is allowed (isolated-context copy of the same agent);
	 * only IDs of agents that no longer exist are filtered out.
	 */
	resolveSubAgents(agentId: string): AgentConfig[] {
		const ids = this.getSubAgentIds(agentId);
		const resolved: AgentConfig[] = [];
		for (const refId of ids) {
			const ref = this.#data.agents[refId];
			if (ref) resolved.push(ref);
		}
		return resolved;
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

	get isVerbose() {
		return this.#data.isVerbose;
	}
	set isVerbose(val: boolean) {
		this.#data.isVerbose = val;
		applyVerboseLogging(val);
		this.saveSettings();
	}

	get showToolIODetails() {
		return this.#data.showToolIODetails ?? false;
	}
	set showToolIODetails(val: boolean) {
		this.#data.showToolIODetails = val;
		this.saveSettings();
	}

	get thinkingProcessExpanded() {
		return this.#data.thinkingProcessExpanded ?? true;
	}
	set thinkingProcessExpanded(val: boolean) {
		this.#data.thinkingProcessExpanded = val;
		this.saveSettings();
	}

	get showActiveAgentsInStatusBar() {
		return this.#data.showActiveAgentsInStatusBar ?? true;
	}
	set showActiveAgentsInStatusBar(val: boolean) {
		this.#data.showActiveAgentsInStatusBar = val;
		this.saveSettings();
	}

	get overrideMobileNavbarSearch() {
		return this.#data.overrideMobileNavbarSearch ?? false;
	}
	set overrideMobileNavbarSearch(val: boolean) {
		this.#data.overrideMobileNavbarSearch = val;
		this.saveSettings();
	}

	get suppressIntegrationPrivacyWarning() {
		return this.#data.suppressIntegrationPrivacyWarning ?? false;
	}
	set suppressIntegrationPrivacyWarning(val: boolean) {
		this.#data.suppressIntegrationPrivacyWarning = val;
		this.saveSettings();
	}

	get onboardingComplete() {
		return this.#data.onboardingComplete;
	}
	set onboardingComplete(val: boolean) {
		this.#data.onboardingComplete = val;
		this.saveSettings();
	}

	get onboardingSplashSeen() {
		return this.#data.onboardingSplashSeen;
	}
	set onboardingSplashSeen(val: boolean) {
		this.#data.onboardingSplashSeen = val;
		this.saveSettings();
	}

	get dismissedRecommendations() {
		return this.#data.dismissedRecommendations;
	}
	isRecommendationDismissed(id: string) {
		return this.#data.dismissedRecommendations.includes(id);
	}
	dismissRecommendation(id: string) {
		if (!this.#data.dismissedRecommendations.includes(id)) {
			// Reassign (not push) so $state reactivity fires.
			this.#data.dismissedRecommendations = [...this.#data.dismissedRecommendations, id];
			this.saveSettings();
		}
	}
	/** Brings every dismissed recommendation back. Exposed in Developer settings. */
	restoreDismissedRecommendations() {
		this.#data.dismissedRecommendations = [];
		this.saveSettings();
	}

	get searchShowPath() {
		return this.#data.searchShowPath;
	}
	set searchShowPath(val: boolean) {
		this.#data.searchShowPath = val;
		this.saveSettings();
	}

	get searchShowTags() {
		return this.#data.searchShowTags;
	}
	set searchShowTags(val: boolean) {
		this.#data.searchShowTags = val;
		this.saveSettings();
	}

	get searchShowMatchBadges() {
		return this.#data.searchShowMatchBadges;
	}
	set searchShowMatchBadges(val: boolean) {
		this.#data.searchShowMatchBadges = val;
		this.saveSettings();
	}

	get searchShowMatchContext() {
		return this.#data.searchShowMatchContext;
	}
	set searchShowMatchContext(val: boolean) {
		this.#data.searchShowMatchContext = val;
		this.saveSettings();
	}

	get searchShowKeyboardHints() {
		return this.#data.searchShowKeyboardHints;
	}
	set searchShowKeyboardHints(val: boolean) {
		this.#data.searchShowKeyboardHints = val;
		this.saveSettings();
	}

	get recentNotes(): RecentNoteEntry[] {
		return [...(this.#data.recentNotes ?? [])].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
	}

	async clearRecentNotes(): Promise<void> {
		this.#data.recentNotes = [];
		await this.saveSettings();
	}

	recordRecentlyOpenedNote(path: string): void {
		const normalizedPath = normalizePath(path);
		const now = Date.now();
		const existing = (this.#data.recentNotes ?? []).filter(
			// Drop the re-opened note (it is re-added at the front with a fresh
			// timestamp) and anything that has aged out of the recency window, so
			// the persisted list does not accumulate entries no reader can use.
			(entry) => entry.path !== normalizedPath && now - entry.lastOpenedAt < RECENT_NOTE_WINDOW_MS,
		);
		this.#data.recentNotes = [{ path: normalizedPath, lastOpenedAt: now }, ...existing].slice(0, MAX_RECENT_NOTES);
		this.saveSettings();
	}

	// --- Embedding Indexes (Multi-Index) ---

	get embeddingIndexes(): EmbeddingIndexConfig[] {
		return this.#data.embeddingIndexes ?? [];
	}

	get searchEmbedIndex(): string | null {
		return this.#data.searchEmbedIndex;
	}

	get graphEmbedIndex(): string | null {
		return this.#data.graphEmbedIndex;
	}

	/**
	 * Get the index config for the search embed index.
	 */
	getSearchEmbedModel(): DefaultEmbedModel | null {
		const indexId = this.#data.searchEmbedIndex;
		if (!indexId) return null;
		const config = this.#data.embeddingIndexes.find((i) => i.id === indexId);
		return config ? { provider: config.provider, model: config.model } : null;
	}

	/**
	 * Get the index config for the graph embed index.
	 */
	getGraphEmbedModel(): DefaultEmbedModel | null {
		const indexId = this.#data.graphEmbedIndex;
		if (!indexId) return null;
		const config = this.#data.embeddingIndexes.find((i) => i.id === indexId);
		return config ? { provider: config.provider, model: config.model } : null;
	}

	/**
	 * Set or create the embedding index for search or graph.
	 * If no index exists for the given provider:model, creates one.
	 */
	setEmbedIndex(
		purpose: "search" | "graph",
		provider: string,
		model: string,
		options?: { batchSize?: number },
	): void {
		const indexId = `${provider}:${model}`;
		const configuredBatchSize =
			options?.batchSize !== undefined ? normalizeEmbeddingBatchSize(options.batchSize, provider) : undefined;

		// Ensure index config exists
		const existing = this.#data.embeddingIndexes.find((i) => i.id === indexId);
		if (!existing) {
			this.#data.embeddingIndexes.push({
				id: indexId,
				provider,
				model,
				createdAt: Date.now(),
				lastBuiltAt: null,
				documentCount: 0,
				batchSize: configuredBatchSize ?? getDefaultEmbeddingBatchSize(provider),
			});
		} else if (configuredBatchSize !== undefined) {
			existing.batchSize = configuredBatchSize;
		} else if (existing.batchSize === undefined) {
			existing.batchSize = getDefaultEmbeddingBatchSize(provider);
		}

		// Set the index for the requested purpose
		if (purpose === "search") {
			this.#data.searchEmbedIndex = indexId;
		} else {
			this.#data.graphEmbedIndex = indexId;
		}

		this.saveSettings();
	}

	/**
	 * Clear the embedding index for a specific purpose.
	 */
	clearEmbedIndex(purpose: "search" | "graph"): void {
		if (purpose === "search") {
			this.#data.searchEmbedIndex = null;
		} else {
			this.#data.graphEmbedIndex = null;
		}

		this.saveSettings();
	}

	/**
	 * Update cached stats for an embedding index.
	 */
	updateEmbeddingIndexStats(indexId: string, stats: { lastBuiltAt?: number; documentCount?: number }): void {
		const config = this.#data.embeddingIndexes.find((i) => i.id === indexId);
		if (!config) return;
		if (stats.lastBuiltAt !== undefined) config.lastBuiltAt = stats.lastBuiltAt;
		if (stats.documentCount !== undefined) config.documentCount = stats.documentCount;
		this.saveSettings();
	}

	/**
	 * Remove an embedding index config and its references.
	 * Returns false if the index is currently used by the other feature.
	 */
	removeEmbeddingIndex(indexId: string): boolean {
		const usedBySearch = this.#data.searchEmbedIndex === indexId;
		const usedByGraph = this.#data.graphEmbedIndex === indexId;

		if (usedBySearch) this.#data.searchEmbedIndex = null;
		if (usedByGraph) this.#data.graphEmbedIndex = null;

		this.#data.embeddingIndexes = this.#data.embeddingIndexes.filter((i) => i.id !== indexId);

		this.saveSettings();
		return true;
	}

	/**
	 * Get the EmbeddingIndexConfig for a given index ID.
	 */
	getEmbeddingIndex(indexId: string): EmbeddingIndexConfig | undefined {
		return this.#data.embeddingIndexes.find((i) => i.id === indexId);
	}

	// --- Smart Graph Settings ---

	get smartGraphSettings(): SmartGraphSettings {
		return this.#data.smartGraphSettings ?? DEFAULT_SMART_GRAPH_SETTINGS;
	}
	set smartGraphSettings(val: SmartGraphSettings) {
		this.#data.smartGraphSettings = val;
		this.saveSettings();
	}

	// --- Diff View Mode ---

	get diffViewMode(): DiffViewMode {
		return this.#data.diffViewMode ?? "two-pane";
	}
	set diffViewMode(val: DiffViewMode) {
		this.#data.diffViewMode = val;
		this.saveSettings();
	}

	get vaultSlug(): string {
		// Always non-null after createData() resolves it; fallback for safety
		return this.#data.vaultSlug ?? "vault";
	}

	// --- Chat Open Location ---

	get chatOpenLocation(): ChatOpenLocation {
		return this.#data.chatOpenLocation ?? "tab";
	}
	set chatOpenLocation(val: ChatOpenLocation) {
		this.#data.chatOpenLocation = val;
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

		for (const agent of Object.values(this.#data.agents)) {
			if (agent.chatModel?.provider === provider && agent.chatModel.model === modelName) {
				agent.chatModel = null;
			}
			if (agent.summarizationModel?.provider === provider && agent.summarizationModel.model === modelName) {
				agent.summarizationModel = null;
			}
			if (agent.titleModel?.provider === provider && agent.titleModel.model === modelName) {
				agent.titleModel = null;
			}
		}

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

	getProviderMeta(providerId: string): ProviderInstanceMeta | undefined {
		return this.#data.providerMeta[providerId];
	}

	getAllProviderMeta(): Record<string, ProviderInstanceMeta> {
		return this.#data.providerMeta;
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

		if (stored.authMode) {
			result.authMode = stored.authMode;
		}

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
			const secretValue = getSecret(this._plugin.app, secretId);
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

		// If disabling, clear every agent model slot pointing at this provider — not just
		// the chat model. A dangling summarization/title reference would still be handed to
		// the LLM path at runtime, and a dangling chatModel makes the chat view read as
		// "model selected" and hide the provider CTA. Same cleanup as deleteProvider.
		// (Favorites are deliberately kept: disabling is reversible, and an inert favorite
		// is harmless while the provider is off.)
		if (wasConfigured && !isConfigured) {
			for (const agent of Object.values(this.#data.agents)) {
				if (agent.chatModel?.provider === providerId) agent.chatModel = null;
				if (agent.summarizationModel?.provider === providerId) agent.summarizationModel = null;
				if (agent.titleModel?.provider === providerId) agent.titleModel = null;
			}
		}

		// This is the commit point for a newly added provider (ProviderSetup flips it on a
		// successful connection). Registering here is what makes the provider usable in chat
		// immediately, instead of only after the next Obsidian reload.
		if (isConfigured) {
			syncProvider(this, providerId);
		} else {
			unsyncProvider(providerId);
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
			const secretId = buildManagedSecretId(providerId, fieldName);
			setSecret(this._plugin.app, secretId, value);
			config.auth.secretIds[fieldName] = secretId;
		} else {
			// Store directly
			config.auth.values[fieldName] = value;
		}
		// Refresh the registry's cached auth — it snapshots the resolved AuthObject at
		// registration, so an edited key/baseUrl would otherwise keep using the old value.
		this.syncProviderIfConfigured(providerId);
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

		if (secretId.trim()) {
			config.auth.secretIds[fieldName] = secretId;
		} else {
			delete config.auth.secretIds[fieldName];
		}
		this.syncProviderIfConfigured(providerId);
		this.saveSettings();
	}

	getProviderAuthMode(providerId: string): OpenAIAuthMode {
		const config = this.#data.providerConfig[providerId];
		const meta = this.#data.providerMeta[providerId];
		if (!config) return "apiKey";
		if (meta?.templateId === "openai-codex") {
			return "codex";
		}
		if (config.auth.authMode !== undefined) {
			return config.auth.authMode;
		}
		return "apiKey";
	}

	setProviderAuthMode(providerId: string, authMode: OpenAIAuthMode): void {
		const config = this.#data.providerConfig[providerId];
		if (!config) return;
		config.auth.authMode = authMode;
		this.syncProviderIfConfigured(providerId);
		this.saveSettings();
	}

	/**
	 * Refreshes the runtime registry entry for a provider after its auth changed, but only
	 * once it's configured. Drafts are deliberately skipped: an unconfigured provider is a
	 * half-filled Setup modal, and registering it would expose a provider the user hasn't
	 * committed (and that onClose may delete).
	 */
	private syncProviderIfConfigured(providerId: string): void {
		if (!this.isProviderConfigured(providerId)) return;
		syncProvider(this, providerId);
	}

	isProviderUsingCodexAuth(providerId: string): boolean {
		// Covers both the legacy "openai-codex" template and the first-class "openai"
		// template switched to ChatGPT sign-in (auth.authMode === "codex"). A template-only
		// check would miss the latter, letting codex-mode providers be offered for
		// embeddings — which they don't support (createEmbeddingInstance throws).
		//
		// Scoped to OpenAI-family templates on purpose. `authMode` is a two-value flag
		// ("apiKey" | "codex") shared by every OAuth-capable provider, and ProviderSetup's
		// API-key toggle writes the literal "codex" to mean "not the API-key path" — so a
		// non-OpenAI OAuth provider (OpenRouter) ends up stored as authMode: "codex" merely
		// by signing in. Matching on the string alone then read that as ChatGPT auth and hid
		// every embedding model the provider offers (OpenRouter serves 32 via its dedicated
		// /embeddings/models endpoint). Codex auth only actually exists for OpenAI.
		const templateId = this.#data.providerMeta[providerId]?.templateId;
		if (templateId !== "openai" && templateId !== "openai-codex") {
			return false;
		}
		return this.getProviderAuthMode(providerId) === "codex";
	}

	isProviderEmbeddingAvailable(providerId: string): boolean {
		return !this.isProviderUsingCodexAuth(providerId);
	}

	getProviderTemplateId(providerId: string): ProviderTemplateId | undefined {
		return this.#data.providerMeta[providerId]?.templateId;
	}

	getProviderIdsByTemplate(templateId: ProviderTemplateId): string[] {
		return Object.entries(this.#data.providerMeta)
			.filter(([_, meta]) => meta.templateId === templateId)
			.map(([providerId]) => providerId);
	}

	async addProviderInstance(
		id: string,
		meta: ProviderInstanceMeta,
		{ configured = false }: { configured?: boolean } = {},
	): Promise<void> {
		if (id in this.#data.providerConfig || id in this.#data.providerMeta) {
			throw new Error(`Provider with ID "${id}" already exists`);
		}

		const duplicate = Object.values(this.#data.providerMeta).find(
			(m) => m.displayName.trim().toLowerCase() === meta.displayName.trim().toLowerCase(),
		);
		if (duplicate) {
			throw new Error(`A provider named "${meta.displayName}" already exists`);
		}

		this.#data.providerMeta[id] = meta;
		this.#data.providerConfig[id] = {
			...createProviderState(meta.templateId),
			isConfigured: configured,
		};

		await this.saveSettings();
	}

	async updateProviderMeta(providerId: string, updates: Partial<ProviderInstanceMeta>): Promise<void> {
		const existing = this.#data.providerMeta[providerId];
		if (!existing) {
			throw new Error(`Provider with ID "${providerId}" not found`);
		}

		if (updates.displayName !== undefined && updates.displayName !== existing.displayName) {
			const duplicate = Object.entries(this.#data.providerMeta).find(
				([id, m]) =>
					id !== providerId &&
					m.displayName.trim().toLowerCase() === updates.displayName?.trim().toLowerCase(),
			);
			if (duplicate) {
				throw new Error(`A provider named "${updates.displayName}" already exists`);
			}
		}

		const nextMeta = { ...existing, ...updates };
		this.#data.providerMeta[providerId] = nextMeta;

		if (updates.templateId && updates.templateId !== existing.templateId) {
			this.#data.providerConfig[providerId] = {
				...createProviderState(nextMeta.templateId),
				isConfigured: this.#data.providerConfig[providerId]?.isConfigured ?? false,
			};
		}

		await this.saveSettings();
	}

	/**
	 * Re-key a provider from oldId to newId, updating all references across plugin data.
	 * Used when the provider's display name changes and the ID should stay in sync.
	 */
	async renameProvider(oldId: string, newId: string): Promise<void> {
		if (oldId === newId) return;

		if (!(oldId in this.#data.providerMeta)) {
			throw new Error(`Provider with ID "${oldId}" not found`);
		}
		if (newId in this.#data.providerMeta || newId in this.#data.providerConfig) {
			throw new Error(`Provider with ID "${newId}" already exists`);
		}

		// Re-key providerMeta + providerConfig
		this.#data.providerMeta[newId] = this.#data.providerMeta[oldId];
		this.#data.providerConfig[newId] = this.#data.providerConfig[oldId];
		delete this.#data.providerMeta[oldId];
		delete this.#data.providerConfig[oldId];

		// Update embeddingIndexes: both .provider and composite .id
		for (const index of this.#data.embeddingIndexes) {
			if (index.provider === oldId) {
				index.provider = newId;
				index.id = `${newId}:${index.model}`;
			}
		}

		// Update searchEmbedIndex / graphEmbedIndex (composite "provider:model")
		if (this.#data.searchEmbedIndex?.startsWith(`${oldId}:`)) {
			this.#data.searchEmbedIndex = `${newId}:${this.#data.searchEmbedIndex.slice(oldId.length + 1)}`;
		}
		if (this.#data.graphEmbedIndex?.startsWith(`${oldId}:`)) {
			this.#data.graphEmbedIndex = `${newId}:${this.#data.graphEmbedIndex.slice(oldId.length + 1)}`;
		}

		// Update agent chatModel / summarizationModel provider references
		for (const agent of Object.values(this.#data.agents)) {
			if (agent.chatModel?.provider === oldId) {
				agent.chatModel = { ...agent.chatModel, provider: newId };
			}
			if (agent.summarizationModel?.provider === oldId) {
				agent.summarizationModel = { ...agent.summarizationModel, provider: newId };
			}
			if (agent.titleModel?.provider === oldId) {
				agent.titleModel = { ...agent.titleModel, provider: newId };
			}
		}

		// Update favoriteModels
		if (this.#data.favoriteModels) {
			for (const fav of this.#data.favoriteModels) {
				if (fav.provider === oldId) fav.provider = newId;
			}
		}

		// A rename touches two IDs (drop the old entry, add the new), so reconcile the whole
		// registry rather than syncing a single ID.
		syncAllProviders(this);

		await this.saveSettings();
	}

	/**
	 * Delete a provider and every reference to it across plugin data.
	 *
	 * Returns the IDs of embedding indexes that belonged to this provider. Their config
	 * records are gone, but their vectors are intentionally left on disk (see below) so
	 * they can be reused. Pass these IDs to `VectorStoreService.deleteIndex` only when
	 * the user has explicitly opted into discarding the embeddings; ignoring the return
	 * value is the correct default, and drafts never own indexes anyway.
	 */
	async deleteProvider(providerId: string): Promise<string[]> {
		if (!(providerId in this.#data.providerMeta)) {
			throw new Error(`Provider with ID "${providerId}" not found`);
		}

		// Collect this provider's secret IDs before dropping its config, so we can
		// clear the raw values from the (cross-plugin) SecretStorage instead of
		// orphaning API keys there after the provider is gone.
		const config = this.#data.providerConfig[providerId];
		const secretIdsToConsider = config ? Object.values(config.auth.secretIds ?? {}) : [];

		delete this.#data.providerMeta[providerId];
		delete this.#data.providerConfig[providerId];

		// Drop every reference to the provider that just went away. Without this the
		// selections survive as dangling pointers to a provider that no longer exists:
		// an agent keeps a `chatModel` whose provider is gone, so the chat view still
		// reads as "a model is selected" and shows suggestions instead of the "Add an
		// AI provider" CTA, and the composer offers a model it can never run.
		// `renameProvider` re-points these same fields; deletion clears them.
		for (const agent of Object.values(this.#data.agents)) {
			if (agent.chatModel?.provider === providerId) agent.chatModel = null;
			if (agent.summarizationModel?.provider === providerId) agent.summarizationModel = null;
			if (agent.titleModel?.provider === providerId) agent.titleModel = null;
		}

		if (this.#data.favoriteModels) {
			this.#data.favoriteModels = this.#data.favoriteModels.filter((fav) => fav.provider !== providerId);
		}

		// Embedding indexes are keyed "provider:model", so the provider's indexes go
		// too — along with the search/graph assignments pointing at them, which would
		// otherwise keep naming an index whose provider can no longer embed anything.
		//
		// Only the config *records* are dropped; the vectors themselves are deliberately
		// left in IndexedDB, because they are expensive to recompute. This does not
		// strand them: the IndexedDB name is derived from the same "provider:model" id,
		// and `setEmbedIndex` recreates the config record from that id — so re-adding
		// this provider and selecting the same model reopens the existing database
		// instead of re-embedding the vault. Purging is a separate, opt-in action, and
		// the orphaned IDs are returned so a caller holding the vector store can do it.
		const orphanedIndexIds = this.#data.embeddingIndexes
			.filter((index) => index.provider === providerId)
			.map((index) => index.id);
		if (orphanedIndexIds.length > 0) {
			this.#data.embeddingIndexes = this.#data.embeddingIndexes.filter((index) => index.provider !== providerId);
			if (this.#data.searchEmbedIndex && orphanedIndexIds.includes(this.#data.searchEmbedIndex)) {
				this.#data.searchEmbedIndex = null;
			}
			if (this.#data.graphEmbedIndex && orphanedIndexIds.includes(this.#data.graphEmbedIndex)) {
				this.#data.graphEmbedIndex = null;
			}
		}

		// A secret ID can be shared (assignSecretIdToProviderField lets one field
		// point at an existing secret). Only remove secrets no remaining provider
		// still references, so we never clear a key another provider depends on.
		const stillReferenced = new Set<string>();
		for (const cfg of Object.values(this.#data.providerConfig)) {
			for (const id of Object.values(cfg.auth.secretIds ?? {})) stillReferenced.add(id);
		}
		for (const secretId of secretIdsToConsider) {
			if (secretId && !stillReferenced.has(secretId)) {
				removeSecret(this._plugin.app, secretId);
			}
		}

		// Drop the runtime registry entry. Without this the deleted provider stays live and
		// fully usable in memory — holding the resolved API key we just cleared from
		// SecretStorage — until the next Obsidian reload.
		unsyncProvider(providerId);

		await this.saveSettings();

		return orphanedIndexIds;
	}
}

let _pluginDataStore: PluginDataStore | null = null;

/**
 * The two file-backed prompt surfaces under `System Prompts/<Agent Name>/`, each paired with
 * the history it is checked against and how its notice reads.
 */
const PROMPT_SURFACES = [
	{
		id: "base",
		kind: "system-prompt",
		label: "system prompt",
		history: SHIPPED_BASE_PROMPTS,
		read: (reader: PromptFileReader, agentId: string) => reader.getBasePrompt(agentId),
	},
	{
		id: "memory",
		kind: "memory-prompt",
		label: "memory instructions",
		history: SHIPPED_MEMORY_PROMPTS,
		read: (reader: PromptFileReader, agentId: string) => reader.getMemoryPrompt(agentId),
	},
] as const satisfies readonly {
	/** Key into `AgentConfig.promptBaseVersions` for this surface. */
	id: PromptKindId;
	kind: StaleGuidance["kind"];
	label: string;
	history: ShippedHistory;
	read: (reader: PromptFileReader, agentId: string) => string | null;
}[];

/**
 * Per-agent staleness for the file-backed prompts (`System Prompts/<Agent Name>/Base.md` and
 * `Memory.md`): stale when the file holds an OLD shipped default — i.e. the shipped default
 * moved since the user's copy was written, but the user never touched it, so we could not
 * silently update it either (the file is theirs to edit).
 *
 * A customization we don't recognize is deliberately NOT flagged: the user wrote it on
 * purpose, and nagging about it would be noise. Absence ⇒ the live default is used.
 *
 * Skill staleness is collected separately (skills are files under `Skills/`, not per-agent)
 * and folded in by {@link computeStaleGuidance}.
 */
function detectStaleGuidance(agent: AgentConfig, reader: PromptFileReader | null): StaleGuidance[] {
	if (!reader) return [];
	const stale: StaleGuidance[] = [];

	for (const surface of PROMPT_SURFACES) {
		const content = surface.read(reader, agent.id);
		if (content === null) continue;
		const current = currentShippedVersion(surface.history);
		const version = shippedVersion(content, surface.history);

		if (version === null) {
			// The user's own text. It matches no shipped fingerprint, so the content alone
			// can't say whether the default has moved since they wrote it — that's what the
			// stamp recorded. Only flag when we have a baseline AND it has been superseded;
			// an absent stamp stays silent rather than asserting drift we can't substantiate.
			const stamp = agent.promptBaseVersions?.[surface.id];
			if (stamp === undefined || stamp === current) continue;
			stale.push({
				agentId: agent.id,
				agentName: agent.name,
				kind: surface.kind,
				label: surface.label,
				currentVersion: current,
				// Their edit is intact — we never touch a customized file.
				customized: true,
			});
			continue;
		}

		// An OLD shipped default, verbatim: PromptFilesService.seedDefaults rewrites these
		// silently at startup, so reaching here means that rewrite failed (or hasn't run
		// against this file yet). Surface it — but not as a "customization".
		if (version === current) continue;
		stale.push({
			agentId: agent.id,
			agentName: agent.name,
			kind: surface.kind,
			label: surface.label,
			currentVersion: current,
			customized: false,
		});
	}

	return stale;
}

/**
 * Aggregates staleness across all surfaces (pure, no mutation): the per-agent file-backed
 * prompts, plus the bundled skills whose shipped body moved while the user held an edited
 * copy. `reader` is null before the prompt-file layer is ready; `staleSkills` is empty until
 * skill bootstrap has run.
 *
 * Skill records carry no agentId — a skill is a single vault file shared by every agent, not
 * per-agent state — so their notice keys off `global` (see `updateNoticeId`).
 */
function computeStaleGuidance(
	agents: AgentsConfig,
	reader: PromptFileReader | null,
	staleSkills: readonly string[],
): StaleGuidance[] {
	const stale: StaleGuidance[] = [];
	for (const agent of Object.values(agents)) stale.push(...detectStaleGuidance(agent, reader));
	for (const skillName of staleSkills) {
		stale.push({
			kind: "skill",
			label: `${skillName} skill`,
			skillName,
			currentVersion: currentSkillVersion(skillName),
			// A skill is only reported when its body matches NO shipped version — the user
			// edited it, and the edit was preserved.
			customized: true,
		});
	}
	return stale;
}

/**
 * Normalizes an agent in place: fills defaults. The base system prompt is file-backed now
 * (not agent config), so its auto-migration/staleness lives in the prompt-file layer; per-tool
 * and per-skill guidance moved into skill bodies, so there is no per-agent guidance to
 * migrate here anymore.
 */
function normalizeAgent(agent: AgentConfig): void {
	// Ensure toolsConfig exists and has all tools
	if (agent.toolsConfig) {
		agent.toolsConfig = { ...structuredClone(DEFAULT_TOOLS_CONFIG), ...agent.toolsConfig };
	} else {
		agent.toolsConfig = structuredClone(DEFAULT_TOOLS_CONFIG);
	}

	// Ensure read_content settings have processor fields
	const readSettings = agent.toolsConfig.read_content?.settings as
		| { imageProcessor?: unknown; pdfProcessor?: unknown }
		| undefined;
	if (readSettings) {
		// Do NOT default imageProcessor/pdfProcessor — undefined means "auto-derive
		// from chat model", null means "explicitly disabled by user".
	}

	agent.skills ??= {};
	agent.mcpServers ??= {};
	agent.pluginExecTools ??= {};

	agent.summarizationModel ??= null;
	agent.titleModel ??= null;
}

function normalizeAgents(mergedData: PluginData): void {
	if (!mergedData.agents[DEFAULT_AGENT_ID]) {
		mergedData.agents[DEFAULT_AGENT_ID] = createDefaultAgent();
	}
	for (const agentId of Object.keys(mergedData.agents)) {
		normalizeAgent(mergedData.agents[agentId]);
	}
	// Repair any persisted name clashes: two agents whose names sanitize to the same
	// base-prompt filename would share/overwrite one note. Uniqueness is normally enforced
	// on write (uniqueAgentName), but a vault could predate that or be hand-edited — so
	// de-duplicate on load too. The built-in default agent is processed first so it keeps
	// its name; later clashers get a numeric suffix (matching uniqueAgentName's scheme).
	dedupeAgentNames(mergedData.agents);
	// Ensure defaultAgentId points at a real agent; fall back to the built-in default
	if (!mergedData.defaultAgentId || !mergedData.agents[mergedData.defaultAgentId]) {
		mergedData.defaultAgentId = DEFAULT_AGENT_ID;
	}
	if (!mergedData.selectedAgentId || !mergedData.agents[mergedData.selectedAgentId]) {
		mergedData.selectedAgentId = mergedData.defaultAgentId;
	}
}

/**
 * Force every agent's name to yield a unique sanitized base-prompt filename, mutating
 * clashing names in place. Deterministic: the built-in default agent is claimed first,
 * then the rest in insertion order; each later clash is suffixed " 2", " 3", … until its
 * sanitized filename is free. Mirrors {@link PluginDataStore.uniqueAgentName} for load time.
 */
function dedupeAgentNames(agents: AgentsConfig): void {
	const taken = new Set<string>();
	const order = Object.keys(agents).sort((a, b) => {
		if (a === DEFAULT_AGENT_ID) return -1;
		if (b === DEFAULT_AGENT_ID) return 1;
		return 0;
	});
	for (const id of order) {
		const agent = agents[id];
		const base = agent.name?.trim() || "Agent";
		let candidate = base;
		for (let n = 2; taken.has(sanitizeAgentFileName(candidate)); n++) {
			candidate = `${base} ${n}`;
		}
		if (candidate !== agent.name) agent.name = candidate;
		taken.add(sanitizeAgentFileName(candidate));
	}
}

export async function createData(plugin: SecondBrainPlugin): Promise<PluginDataStore> {
	if (_pluginDataStore) return _pluginDataStore;

	const rawData = await plugin.loadData();

	const mergedData: PluginData = {
		...DEFAULT_SETTINGS,
		...rawData,
	};

	runMigrations(mergedData);

	// If the data was written by a newer plugin, skip normalizeAgents() too — it
	// would rewrite prompt fields using this plugin's older defaults and those
	// mutations would be persisted on the next save, corrupting the newer state.
	const fromNewerPlugin = (rawData?.schemaVersion ?? 0) > CURRENT_SCHEMA_VERSION;

	if (fromNewerPlugin) {
		// Leave agents untouched; just ensure the bare minimum so the UI doesn't crash.
		if (!mergedData.agents || Object.keys(mergedData.agents).length === 0) {
			mergedData.agents = { [DEFAULT_AGENT_ID]: createDefaultAgent() };
			mergedData.defaultAgentId = DEFAULT_AGENT_ID;
			mergedData.selectedAgentId = DEFAULT_AGENT_ID;
		}
	} else if (!rawData?.agents || Object.keys(rawData.agents).length === 0) {
		mergedData.agents = { [DEFAULT_AGENT_ID]: createDefaultAgent() };
		mergedData.defaultAgentId = DEFAULT_AGENT_ID;
		mergedData.selectedAgentId = DEFAULT_AGENT_ID;
	} else {
		normalizeAgents(mergedData);
	}

	// Resolve vault slug once on first load; persisted so vault renames don't orphan indexes
	if (!mergedData.vaultSlug) {
		mergedData.vaultSlug = await resolveVaultSlug(plugin.app.vault.getName());
	}

	_pluginDataStore = new PluginDataStore(plugin, mergedData);

	return _pluginDataStore;
}

export function getData(): PluginDataStore {
	if (!_pluginDataStore) throw new Error("Plugin does not exist");
	return _pluginDataStore;
}

/**
 * Test-only: clear the module-level singleton so a subsequent `createData` runs migrations +
 * normalization on fresh input. `createData` memoizes its result, which is correct at runtime
 * (one store per session) but makes per-test fixtures leak across tests. Not used in production.
 */
export function __resetPluginDataStoreForTests(): void {
	_pluginDataStore = null;
}

/**
 * Resolve a stable slug for the vault, derived from its current name.
 * Checks existing IndexedDB databases to avoid collisions with other vaults
 * that may share the same origin. Increments a numeric suffix if needed.
 * e.g. "My Vault" → "my-vault", or "my-vault-2" if already taken.
 */
async function resolveVaultSlug(vaultName: string): Promise<string> {
	const base =
		vaultName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "vault";

	const dbs =
		typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function"
			? []
			: ((await Promise.resolve(indexedDB.databases()).catch(() => [] as IDBDatabaseInfo[])) ?? []);
	const existingNames = new Set(dbs.map((d) => d.name ?? ""));

	// A slug is "taken by another vault" if any s2b- DB exists with that prefix
	// but our data.json doesn't have it yet (handled by caller).
	const isTaken = (slug: string) =>
		[`s2b-hnsw-${slug}`, `s2b-minisearch-${slug}`].some((prefix) =>
			[...existingNames].some((name) => name === prefix || name.startsWith(`${prefix}-`)),
		);

	if (!isTaken(base)) return base;
	let n = 2;
	while (isTaken(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

/**
 * Convert a provider display name to a stable, URL-safe ID.
 * "LM Studio" → "lm-studio", "My OpenAI" → "my-openai"
 */
export function slugifyProviderName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
