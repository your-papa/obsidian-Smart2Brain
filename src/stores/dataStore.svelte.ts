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
	ChatOpenLocation,
	DiffViewMode,
	EmbeddingIndexConfig,
	MCPServerConfig,
	MCPServersConfig,
	PluginData,
	RecentNoteEntry,
	SearchAlgorithm,
	ToolConfig,
	ToolsConfig,
} from "../types/plugin";
import { genUUIDv7, type UUIDv7 } from "../utils/uuid7Validator";

import { type GraphMode, type SmartGraphSettings, DEFAULT_SMART_GRAPH_SETTINGS } from "../types/graph";

// Provider system types
import {
	type AuthObject,
	type ChatModelConfig,
	type EmbedModelConfig,
	type OpenAIAuthMode,
	type ProviderInstanceMeta,
	type ProviderTemplateId,
} from "../providers/index";

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
	const baseUrlByTemplate: Partial<Record<ProviderTemplateId, string>> = {
		anthropic: "https://api.anthropic.com",
		"openai-compatible": "https://api.openai.com",
		ollama: "http://localhost:11434",
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
		trustedForPrivateData: templateId === "ollama",
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
PDF page references are supported: \`[[report.pdf#page=3]]\` for a single page, \`[[report.pdf#page=1-3,5]]\` for multiple pages or ranges. Only the requested pages are returned.`;

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

/** All 4 default description variants for matching */
export const READ_CONTENT_DESC_DEFAULTS = new Set([
	READ_CONTENT_DESC_NONE,
	READ_CONTENT_DESC_IMAGE,
	READ_CONTENT_DESC_PDF,
	READ_CONTENT_DESC_BOTH,
]);

/**
 * Returns the appropriate read_content description based on processor configuration.
 */
export function getReadContentDescription(hasImageProcessor: boolean, hasPdfProcessor: boolean): string {
	if (hasImageProcessor && hasPdfProcessor) return READ_CONTENT_DESC_BOTH;
	if (hasImageProcessor) return READ_CONTENT_DESC_IMAGE;
	if (hasPdfProcessor) return READ_CONTENT_DESC_PDF;
	return READ_CONTENT_DESC_NONE;
}

/**
 * Default configuration for all built-in tools.
 * All tools are enabled by default with standard names and descriptions.
 */
export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
	search_notes: {
		enabled: true,
		name: "search_notes",
		description:
			"Search through your Obsidian notes by keyword. Returns structured JSON with matching note names plus optional paths, tags, match badges, and short match snippets depending on settings. Use this to identify relevant notes before reading them.",
		settings: {
			maxResults: 10,
			algorithm: "lexical" as SearchAlgorithm,
		},
	},
	list_directory: {
		enabled: true,
		name: "list_directory",
		description:
			"List directories and files in the vault. Use this to understand folder structure before searching or editing notes.",
	},
	read_content: {
		enabled: true,
		name: "read_content",
		description: READ_CONTENT_DESC_NONE,
		promptGuidance: READ_CONTENT_GUIDANCE_NONE,
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
	execute_javascript: {
		enabled: true,
		name: "execute_javascript",
		description:
			"Execute isolated JavaScript for calculations and data transformation. Pass structured data via the input field, use return for the final value, and use console.log for intermediate output.",
		promptGuidance:
			"Use this for calculations, reshaping JSON, filtering arrays, parsing structured text, or other logic-heavy transformations. The code runs in an isolated worker without Obsidian APIs, so do not use it for note edits or vault access.",
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
	manage_notes: {
		enabled: true,
		name: "manage_notes",
		description:
			"Create, update, delete, or move markdown notes in one staged batch. Use targeted search-and-replace edits for updates and batch related note operations together.",
		settings: {
			allowCreate: true,
			allowUpdate: true,
			allowDelete: true,
			allowMove: true,
		},
	},
};

const MAX_RECENT_NOTES = 20;

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
		summarizationModel: null,
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
		summarizationModel: null,
		systemPrompt: BASE_SYSTEM_PROMPT,
		skills: {},
		toolsConfig: structuredClone(DEFAULT_TOOLS_CONFIG),
		mcpServers: {},
	};
}

export const DEFAULT_SETTINGS: PluginData = {
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
	isUsingRag: false,
	retrieveTopK: 100,
	assistantLanguage: "en",
	initialAssistantMessageContent: "Hi",
	targetFolder: "Chats",
	attachmentFolder: "",

	// Privacy
	privacyListExclude: [],
	privacyListInclude: [],
	privacyIsExcluding: true,

	// UI state
	isQuickSettingsOpen: true,
	isVerbose: false,
	hideIncognitoWarning: false,
	isAutostart: false,
	isChatComfy: false,
	isOnboarded: false,
	chatOpenLocation: "tab" as ChatOpenLocation,
	lastActiveChatId: null,

	// Debugging & telemetry
	enableLangSmith: false,
	langSmithApiKey: "",
	langSmithProject: "obsidian-agent",
	langSmithEndpoint: "https://api.smith.langchain.com",
	debuggingLangchainKey: "",

	// Other
	searchAlgorithm: "lexical",
	searchShowPath: true,
	searchShowTags: true,
	searchShowMatchBadges: true,
	searchShowMatchContext: true,
	recentNotes: [],
	defaultEmbedModel: null,
	embeddingIndexes: [],
	searchEmbedIndex: null,
	graphEmbedIndex: null,
	favoriteModels: [],

	// Smart Graph View
	smartGraphSettings: DEFAULT_SMART_GRAPH_SETTINGS,
	lastGraphMode: "wiki" as GraphMode,

	// Diff view
	diffViewMode: "two-pane",
};

export class PluginDataStore {
	#data: PluginData;
	private readonly _plugin: SecondBrainPlugin;

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

	// ============================================================================
	// Privacy List Methods
	// ============================================================================

	get privacyIsExcluding(): boolean {
		return this.#data.privacyIsExcluding;
	}

	togglePrivacyIsExcluding() {
		this.#data.privacyIsExcluding = !this.#data.privacyIsExcluding;
		this.saveSettings();
	}

	get privacyList(): string[] {
		if (this.#data.privacyIsExcluding) return this.#data.privacyListExclude;
		return this.#data.privacyListInclude;
	}

	removePrivacyList(val: string) {
		if (this.#data.privacyIsExcluding) {
			if (!this.#data.privacyListExclude.includes(val)) return;
			this.#data.privacyListExclude.remove(val);
		} else {
			if (!this.#data.privacyListInclude.includes(val)) return;
			this.#data.privacyListInclude.remove(val);
		}
		this.saveSettings();
	}

	addPrivacyList(val: string) {
		if (this.#data.privacyIsExcluding) {
			if (this.#data.privacyListExclude.includes(val)) return;
			this.#data.privacyListExclude.push(val);
		} else {
			if (this.#data.privacyListInclude.includes(val)) return;
			this.#data.privacyListInclude.push(val);
		}
		this.saveSettings();
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

		// Use $state.snapshot to unwrap Svelte proxies, then structuredClone for deep copy
		const clonedAgent = structuredClone($state.snapshot(sourceAgent));
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

	get recentNotes(): RecentNoteEntry[] {
		return [...(this.#data.recentNotes ?? [])].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
	}

	recordRecentlyOpenedNote(path: string): void {
		const normalizedPath = normalizePath(path);
		const existing = (this.#data.recentNotes ?? []).filter((entry) => entry.path !== normalizedPath);
		this.#data.recentNotes = [{ path: normalizedPath, lastOpenedAt: Date.now() }, ...existing].slice(
			0,
			MAX_RECENT_NOTES,
		);
		this.saveSettings();
	}

	get defaultEmbedModel() {
		// Backward-compat: derive from searchEmbedIndex
		const indexId = this.#data.searchEmbedIndex;
		if (!indexId) return this.#data.defaultEmbedModel;
		const config = this.#data.embeddingIndexes.find((i) => i.id === indexId);
		if (!config) return this.#data.defaultEmbedModel;
		return { provider: config.provider, model: config.model };
	}
	set defaultEmbedModel(val: DefaultEmbedModel | null) {
		this.#data.defaultEmbedModel = val;
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
	 * If the other feature has no index set, auto-shares this one.
	 */
	setEmbedIndex(purpose: "search" | "graph", provider: string, model: string): void {
		const indexId = `${provider}:${model}`;

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
			});
		}

		// Set the index for the requested purpose
		if (purpose === "search") {
			this.#data.searchEmbedIndex = indexId;
			// Auto-share: if graph has no index, use this one
			if (!this.#data.graphEmbedIndex) {
				this.#data.graphEmbedIndex = indexId;
			}
		} else {
			this.#data.graphEmbedIndex = indexId;
			// Auto-share: if search has no index, use this one
			if (!this.#data.searchEmbedIndex) {
				this.#data.searchEmbedIndex = indexId;
			}
		}

		// Keep legacy field in sync for backward compat
		const searchModel = this.getSearchEmbedModel();
		this.#data.defaultEmbedModel = searchModel;

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

		// Keep legacy field in sync
		this.#data.defaultEmbedModel = this.getSearchEmbedModel();

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

	get lastGraphMode(): GraphMode {
		return this.#data.lastGraphMode ?? "wiki";
	}
	set lastGraphMode(val: GraphMode) {
		this.#data.lastGraphMode = val;
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
			const secretId = buildManagedSecretId(providerId, fieldName);
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

		if (secretId.trim()) {
			config.auth.secretIds[fieldName] = secretId;
		} else {
			delete config.auth.secretIds[fieldName];
		}
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
		this.saveSettings();
	}

	isProviderUsingCodexAuth(providerId: string): boolean {
		return this.getProviderMeta(providerId)?.templateId === "openai-codex";
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

	async deleteProvider(providerId: string): Promise<void> {
		if (!(providerId in this.#data.providerMeta)) {
			throw new Error(`Provider with ID "${providerId}" not found`);
		}

		delete this.#data.providerMeta[providerId];
		delete this.#data.providerConfig[providerId];
		await this.saveSettings();
	}
}

let _pluginDataStore: PluginDataStore | null = null;

function normalizeAgent(agent: AgentConfig): void {
	// Ensure toolsConfig exists and has all tools
	if (agent.toolsConfig) {
		agent.toolsConfig = { ...structuredClone(DEFAULT_TOOLS_CONFIG), ...agent.toolsConfig };
	} else {
		agent.toolsConfig = structuredClone(DEFAULT_TOOLS_CONFIG);
	}

	// Ensure read_content settings have processor fields
	const readSettings = agent.toolsConfig.read_content?.settings as
		| { maxContentLength?: number; imageProcessor?: unknown; pdfProcessor?: unknown }
		| undefined;
	if (readSettings) {
		// Do NOT default imageProcessor/pdfProcessor — undefined means "auto-derive
		// from chat model", null means "explicitly disabled by user".
	}

	agent.skills ??= {};
	agent.mcpServers ??= {};
	agent.systemPrompt ??= BASE_SYSTEM_PROMPT;
	agent.summarizationModel ??= null;
}

function normalizeAgents(mergedData: PluginData): void {
	if (!mergedData.agents[DEFAULT_AGENT_ID]) {
		mergedData.agents[DEFAULT_AGENT_ID] = createDefaultAgent();
	}
	for (const agentId of Object.keys(mergedData.agents)) {
		normalizeAgent(mergedData.agents[agentId]);
	}
	// Ensure defaultAgentId is valid
	if (mergedData.defaultAgentId !== null && !mergedData.agents[mergedData.defaultAgentId]) {
		mergedData.defaultAgentId = null;
	}
	if (!mergedData.selectedAgentId || !mergedData.agents[mergedData.selectedAgentId]) {
		mergedData.selectedAgentId = mergedData.defaultAgentId ?? DEFAULT_AGENT_ID;
	}
}

function inferTemplateIdFromLegacyProvider(providerId: string, state?: StoredProviderState): ProviderTemplateId {
	if (providerId === "openai" && state?.auth.authMode === "codex") {
		return "openai-codex";
	}
	if (providerId === "openai") {
		return "openai-compatible";
	}
	if (providerId === "anthropic" || providerId === "ollama" || providerId === "openrouter") {
		return providerId;
	}
	return "openai-compatible";
}

function migrateLegacyProviders(rawData: unknown): Pick<PluginData, "providerConfig" | "providerMeta"> {
	const record = (rawData && typeof rawData === "object" ? rawData : {}) as {
		providerConfig?: Record<string, StoredProviderState>;
		providerMeta?: Record<string, ProviderInstanceMeta>;
		customProviderMeta?: Record<string, { displayName?: string }>;
	};

	if (record.providerMeta) {
		return {
			providerConfig: record.providerConfig ?? {},
			providerMeta: record.providerMeta,
		};
	}

	const providerConfig = record.providerConfig ?? {};
	const legacyMeta = record.customProviderMeta ?? {};
	const providerMeta: Record<string, ProviderInstanceMeta> = {};

	for (const [providerId, state] of Object.entries(providerConfig)) {
		const templateId = inferTemplateIdFromLegacyProvider(providerId, state);
		providerMeta[providerId] = {
			templateId,
			displayName:
				legacyMeta[providerId]?.displayName ??
				(templateId === "openai-compatible"
					? "OpenAI"
					: templateId === "openai-codex"
						? "OpenAI Codex"
						: templateId[0]?.toUpperCase() + templateId.slice(1)),
		};
	}

	return {
		providerConfig,
		providerMeta,
	};
}

export async function createData(plugin: SecondBrainPlugin): Promise<PluginDataStore> {
	if (_pluginDataStore) return _pluginDataStore;

	const rawData = await plugin.loadData();
	const migratedProviders = migrateLegacyProviders(rawData);

	const mergedData: PluginData = {
		...DEFAULT_SETTINGS,
		...rawData,
		providerConfig: migratedProviders.providerConfig,
		providerMeta: migratedProviders.providerMeta,
	};
	delete (mergedData as PluginData & { excludeFF?: unknown }).excludeFF;
	delete (mergedData as PluginData & { includeFF?: unknown }).includeFF;
	delete (mergedData as PluginData & { isExcluding?: unknown }).isExcluding;

	if (!rawData?.agents || Object.keys(rawData.agents).length === 0) {
		mergedData.agents = { [DEFAULT_AGENT_ID]: createDefaultAgent() };
		mergedData.defaultAgentId = DEFAULT_AGENT_ID;
		mergedData.selectedAgentId = DEFAULT_AGENT_ID;
	} else {
		normalizeAgents(mergedData);
	}

	// Migrate from single defaultEmbedModel to multi-index
	if (mergedData.defaultEmbedModel && (!mergedData.embeddingIndexes || mergedData.embeddingIndexes.length === 0)) {
		const { provider, model } = mergedData.defaultEmbedModel;
		const indexId = `${provider}:${model}`;
		mergedData.embeddingIndexes = [
			{
				id: indexId,
				provider,
				model,
				createdAt: Date.now(),
				lastBuiltAt: Date.now(), // Assume existing index was built
				documentCount: 0,
			},
		];
		mergedData.searchEmbedIndex = indexId;
		mergedData.graphEmbedIndex = indexId;
	}

	// Migrate removed "embeddings" search algorithm to "hybrid"
	if ((mergedData.searchAlgorithm as string) === "embeddings") {
		mergedData.searchAlgorithm = "hybrid";
	}

	_pluginDataStore = new PluginDataStore(plugin, mergedData);
	return _pluginDataStore;
}

export function getData(): PluginDataStore {
	if (!_pluginDataStore) throw new Error("Plugin does not exist");
	return _pluginDataStore;
}
