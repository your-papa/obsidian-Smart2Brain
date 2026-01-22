import { normalizePath } from "obsidian";
import { BASE_SYSTEM_PROMPT, DEFAULT_PLUGIN_EXTENSIONS } from "../agent/prompts";
import { getSecret, listSecrets, setSecret } from "../lib/secretStorage";
import SecondBrainPlugin, { type PluginData, type PluginPromptExtension, type SearchAlgorithm } from "../main";
import type { ProviderConfigs } from "../types/plugin";
import type { UUIDv7 } from "../utils/uuid7Validator";
import type { ChatModel } from "./chatStore.svelte";

// Provider system types
import type {
	ChatModelConfig,
	EmbedModelConfig,
	RuntimeAuthState,
	StoredAuthState,
	StoredCustomProviderDefinition,
	StoredFieldBasedAuthState,
} from "../providers/index";
import {
	BUILT_IN_PROVIDER_IDS,
	type BuiltInProviderId,
	getBuiltInProvider,
	isBuiltInProvider,
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
// New Provider State Types (for unified provider system)
// ============================================================================

/**
 * State for a single provider stored in data.json.
 * This is the new unified structure for all providers.
 */
export interface StoredProviderState {
	/** Whether the provider is configured and enabled */
	isConfigured: boolean;
	/** Authentication state (field-based or OAuth) */
	auth: StoredAuthState;
	/** Chat model configurations keyed by model ID */
	chatModels: Record<string, ChatModelConfig>;
	/** Embedding model configurations keyed by model ID */
	embedModels: Record<string, EmbedModelConfig>;
}

/**
 * Storage structure for custom provider definitions + state.
 * Custom providers store both their definition and state together.
 */
export interface StoredCustomProvider {
	/** The custom provider definition (id, displayName, baseProviderId, etc.) */
	definition: StoredCustomProviderDefinition;
	/** The provider state (isConfigured, auth, models) */
	state: StoredProviderState;
}

/**
 * New provider configuration storage structure.
 * Separates built-in and custom providers.
 */
export interface StoredProvidersConfig {
	/** Built-in provider states keyed by provider ID */
	builtIn: Record<BuiltInProviderId, StoredProviderState>;
	/** Custom provider definitions and states */
	custom: StoredCustomProvider[];
}

// ============================================================================
// Default Provider States (New System)
// ============================================================================

/**
 * Creates default auth state for field-based authentication.
 * All fields start empty (no default values).
 */
function createDefaultFieldBasedAuth(): StoredFieldBasedAuthState {
	return {
		type: "field-based",
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
		auth: createDefaultFieldBasedAuth(),
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
		auth: createDefaultFieldBasedAuth(),
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
			type: "field-based",
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
	"sap-ai-core": {
		isConfigured: false,
		auth: createDefaultFieldBasedAuth(),
		chatModels: {
			"gpt-4o": { contextWindow: 128000, temperature: 0.7 },
			"gpt-4": { contextWindow: 8192, temperature: 0.7 },
			"gpt-35-turbo": { contextWindow: 16384, temperature: 0.7 },
		},
		embedModels: {
			"text-embedding-ada-002": { similarityThreshold: 0.75 },
			"text-embedding-3-small": { similarityThreshold: 0.5 },
			"text-embedding-3-large": { similarityThreshold: 0.5 },
		},
	},
};

/**
 * Default providers config for the new system.
 */
export const DEFAULT_PROVIDERS_CONFIG: StoredProvidersConfig = {
	builtIn: DEFAULT_BUILTIN_PROVIDER_STATES,
	custom: [],
};

export const DEFAULT_PROVIDER_CONFIGS: ProviderConfigs = {
	ollama: {
		isConfigured: false,
		providerAuth: {
			baseUrl: "http://localhost:11434",
		},
		embedModels: new Map([
			["nomic-embed-text", { similarityThreshold: 0.5 }],
			["mxbai-embed-large", { similarityThreshold: 0.5 }],
		]),
		genModels: new Map([
			["llama2", { temperature: 0.5, contextWindow: 4096 }],
			["llama2-uncensored", { temperature: 0.5, contextWindow: 4096 }],
			["mistral", { temperature: 0.5, contextWindow: 8000 }],
			["mistral-openorca", { temperature: 0.5, contextWindow: 8000 }],
			["gemma", { temperature: 0.5, contextWindow: 8000 }],
			["mixtral", { temperature: 0.5, contextWindow: 32000 }],
			["dolphin-mixtral", { temperature: 0.5, contextWindow: 32000 }],
			["phi", { temperature: 0.5, contextWindow: 2048 }],
			["llama3.1", { temperature: 0.5, contextWindow: 8192 }],
		]),
	},
	openai: {
		isConfigured: false,
		providerAuth: {
			apiKeyId: "",
		},
		embedModels: new Map([
			["text-embedding-ada-002", { similarityThreshold: 0.75 }],
			["text-embedding-3-large", { similarityThreshold: 0.5 }],
			["text-embedding-3-small", { similarityThreshold: 0.5 }],
		]),
		genModels: new Map([
			["chatgpt-4o-latest", { temperature: 0.4, contextWindow: 128000 }],
			["gpt-4.1-mini-2025-04-14", { temperature: 0.4, contextWindow: 1047576 }],
			["gpt-4.1", { temperature: 0.2, contextWindow: 1047576 }],
			["o4-mini", { temperature: 0.2, contextWindow: 200000 }],
			["o1", { temperature: 0.2, contextWindow: 200000 }],
		]),
	},
	anthropic: {
		isConfigured: false,
		providerAuth: {
			apiKeyId: "",
		},
		embedModels: new Map(),
		genModels: new Map([
			["claude-3-haiku-20240307", { temperature: 0.5, contextWindow: 200000 }],
			["claude-3-sonnet-20240229", { temperature: 0.5, contextWindow: 200000 }],
			["claude-3-opus-20240229", { temperature: 0.5, contextWindow: 200000 }],
			["claude-3-5-sonnet-20241022", { temperature: 0.5, contextWindow: 200000 }],
		]),
	},
	"sap-ai-core": {
		isConfigured: false,
		providerAuth: {
			apiKeyId: "",
			baseUrl: "",
		},
		embedModels: new Map([["text-embedding-ada-002", { similarityThreshold: 0.75 }]]),
		genModels: new Map([["gpt-4o", { temperature: 0.5, contextWindow: 128000 }]]),
	},
};

export const DEFAULT_SETTINGS: PluginData = {
	providerConfig: DEFAULT_PROVIDER_CONFIGS,
	systemPrompt: BASE_SYSTEM_PROMPT,
	pluginPromptExtensions: structuredClone(DEFAULT_PLUGIN_EXTENSIONS),
	isUsingRag: false,
	isGeneratingChatTitle: false,
	defaultChatModel: null,
	retrieveTopK: 100,
	assistantLanguage: "en",
	initialAssistantMessageContent: "Hi",
	defaultChatName: "New Chat",
	targetFolder: "Chats",
	excludeFF: ["Chats", ".excalidraw.md"],
	includeFF: [],
	isExcluding: true,
	isQuickSettingsOpen: true,
	isVerbose: false,
	hideIncognitoWarning: false,
	isAutostart: false,
	isChatComfy: false,
	isOnboarded: false,
	enableLangSmith: false,
	langSmithApiKey: "",
	langSmithProject: "obsidian-agent",
	langSmithEndpoint: "https://api.smith.langchain.com",
	mcpServers: {},
	debuggingLangchainKey: "",
	lastActiveChatId: null,
	searchAlgorithm: "grep",
};

export class PluginDataStore {
	#data: PluginData;
	#customProviders: StoredCustomProvider[];
	private _plugin: SecondBrainPlugin;

	constructor(plugin: SecondBrainPlugin, initialData: PluginData & { customProviders?: StoredCustomProvider[] }) {
		this._plugin = plugin;
		// Restore Maps from plain object shapes (after persistence serialization)
		for (const cfg of Object.values(initialData.providerConfig) as unknown as Record<string, unknown>[]) {
			if (cfg && "embedModels" in cfg && cfg.embedModels && !(cfg.embedModels instanceof Map)) {
				cfg.embedModels = new Map(Object.entries(cfg.embedModels as Record<string, unknown>));
			}
			if (cfg && "genModels" in cfg && cfg.genModels && !(cfg.genModels instanceof Map)) {
				cfg.genModels = new Map(Object.entries(cfg.genModels as Record<string, unknown>));
			}
		}
		this.#data = $state(initialData);
		// Initialize custom providers from saved data
		this.#customProviders = $state(initialData.customProviders ?? []);
	}

	/**
	 * Persist current settings.
	 * We need to serialize Maps (embedModels / genModels) because Obsidian (JSON) persistence
	 * will turn Map instances into empty objects `{}` otherwise, losing data.
	 * Also we always snapshot the $state to avoid saving reactive proxies.
	 */
	private async saveSettings() {
		const snap = $state.snapshot(this.#data);

		// Deep(ish) clone with Map -> plain object conversion
		const plain: Record<string, unknown> = {
			...snap,
			providerConfig: {},
			// Include custom providers in saved data
			customProviders: $state.snapshot(this.#customProviders),
		};

		for (const [provider, cfg] of Object.entries(snap.providerConfig)) {
			const cloned: Record<string, unknown> = { ...cfg };

			if ("embedModels" in cfg && cfg.embedModels instanceof Map) {
				cloned.embedModels = Object.fromEntries(cfg.embedModels);
			}
			if ("genModels" in cfg && cfg.genModels instanceof Map) {
				cloned.genModels = Object.fromEntries(cfg.genModels);
			}

			(plain.providerConfig as Record<string, unknown>)[provider] = cloned;
		}

		await this._plugin.saveData(plain);
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

	getConfiguredProviders(): string[] {
		return Object.entries(this.#data.providerConfig)
			.filter(([_, conf]) => conf.isConfigured)
			.map(([provider]) => provider);
	}

	getAllConfiguredModels(): string[] {
		return this.getConfiguredProviders().flatMap((provider) => {
			const config = this.#data.providerConfig[provider as BuiltInProviderId];
			return config ? Array.from(config.genModels.keys()) : [];
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

	get mcpServers() {
		return this.#data.mcpServers;
	}
	set mcpServers(val: Record<string, any>) {
		this.#data.mcpServers = val;
		this.saveSettings();
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
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		return config?.isConfigured ?? false;
	}

	toggleProviderIsConfigured(provider: string) {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
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
	 * Get stored provider auth params (contains apiKeyId, not actual apiKey)
	 */
	getStoredProviderAuthParams(provider: string): {
		apiKeyId?: string;
		baseUrl?: string;
		headers?: Record<string, string>;
	} {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		return config?.providerAuth ?? {};
	}

	/**
	 * Get resolved provider auth params with actual secrets from SecretStorage
	 */
	getResolvedProviderAuth(provider: string): { apiKey?: string; baseUrl?: string; headers?: Record<string, string> } {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		if (!config) return {};

		const stored = config.providerAuth;
		const resolved: { apiKey?: string; baseUrl?: string; headers?: Record<string, string> } = { ...stored };

		// Resolve apiKeyId to actual apiKey
		if (stored.apiKeyId) {
			const secret = getSecret(this._plugin.app, stored.apiKeyId);
			if (secret) {
				resolved.apiKey = secret;
			}
		}

		// Remove apiKeyId from resolved (it's not needed at runtime)
		// biome-ignore lint/performance/noDelete: Intentional cleanup of stored-only field
		delete (resolved as { apiKeyId?: string }).apiKeyId;

		return resolved;
	}

	/**
	 * Set a stored auth parameter (for non-secret fields like baseUrl)
	 */
	setStoredAuthParam(provider: string, key: string, value: unknown): void {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		if (!config) return;

		const newAuth = { ...config.providerAuth };
		(newAuth as Record<string, unknown>)[key] = value;
		config.providerAuth = newAuth;
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
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		if (!config) return null;

		const stored = config.providerAuth;
		if (!stored.apiKeyId) return null;
		return getSecret(this._plugin.app, stored.apiKeyId);
	}

	/**
	 * List all available secrets
	 */
	listAvailableSecrets(): string[] {
		return listSecrets(this._plugin.app);
	}

	// --- Embed Model Management (Map-based) ---

	getEmbedModels(provider: string): Map<string, EmbedModelConfig> {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		return config?.embedModels ?? new Map();
	}

	addEmbedModel(provider: string, modelName: string, conf: EmbedModelConfig) {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		if (!config) return;
		const current = config.embedModels;
		if (current.has(modelName)) throw new AddEmbedModelError(provider, modelName);
		// Reassign a new Map to ensure reactivity + easier change detection
		const next = new Map(current);
		next.set(modelName, conf);
		config.embedModels = next;
		this.saveSettings();
	}

	updateEmbedModel(provider: string, modelName: string, conf: EmbedModelConfig) {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		if (!config) return;
		const current = config.embedModels;
		if (!current.has(modelName)) throw new SetEmbedModelError(provider, modelName);
		const next = new Map(current);
		next.set(modelName, conf);
		config.embedModels = next;
		this.saveSettings();
	}

	deleteEmbedModel(provider: string, modelName: string) {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		if (!config) return;
		const current = config.embedModels;
		if (!current.has(modelName)) throw new SetEmbedModelError(provider, modelName);
		const next = new Map(current);
		next.delete(modelName);
		config.embedModels = next;
		this.saveSettings();
	}

	getGenModels(provider: string): Map<string, ChatModelConfig> {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		return config?.genModels ?? new Map();
	}

	addGenModel(provider: string, modelName: string, conf: ChatModelConfig) {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		if (!config) return;
		const current = config.genModels;
		if (current.has(modelName)) throw new AddGenModelError(provider, modelName);
		const next = new Map(current);
		next.set(modelName, conf);
		config.genModels = next;
		this.saveSettings();
	}

	updateGenModel(provider: string, modelName: string, conf: ChatModelConfig) {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		if (!config) return;
		const current = config.genModels;
		if (!current.has(modelName)) throw new SetGenModelError(provider, modelName);
		const next = new Map(current);
		next.set(modelName, conf);
		config.genModels = next;
		this.saveSettings();
	}

	deleteGenModel(provider: string, modelName: string) {
		const config = this.#data.providerConfig[provider as BuiltInProviderId];
		if (!config) return;
		const current = config.genModels;
		if (!current.has(modelName)) throw new SetGenModelError(provider, modelName);
		const next = new Map(current);
		next.delete(modelName);
		config.genModels = next;

		// Clear default model if the deleted model was the default
		const defaultModel = this.#data.defaultChatModel;
		if (defaultModel && defaultModel.provider === provider && defaultModel.model === modelName) {
			this.#data.defaultChatModel = null;
		}

		this.saveSettings();
	}

	// Get/set genModels (if present)
	getProviderGenModels<K extends keyof PluginData["providerConfig"]>(provider: K): Record<string, any> | undefined {
		return (this.#data.providerConfig[provider] as any).genModels;
	}
	setProviderGenModels<K extends keyof PluginData["providerConfig"]>(provider: K, value: Record<string, any>) {
		if ("genModels" in this.#data.providerConfig[provider]) {
			(this.#data.providerConfig[provider] as any).genModels = value;
			this.saveSettings();
		}
	}

	// ============================================================================
	// New Provider System Methods
	// ============================================================================

	/**
	 * Get list of configured provider IDs (new system).
	 * Returns IDs of both built-in and custom providers that are configured.
	 */
	getConfiguredProviderIds(): string[] {
		const result: string[] = [];

		// Check built-in providers
		for (const [providerId, config] of Object.entries(this.#data.providerConfig)) {
			if (config.isConfigured && this.isBuiltInProviderId(providerId)) {
				result.push(providerId);
			}
		}

		// Add configured custom providers
		for (const customProvider of this.#customProviders) {
			if (customProvider.state.isConfigured) {
				result.push(customProvider.definition.id);
			}
		}

		return result;
	}

	/**
	 * Validates if a provider ID is a built-in provider.
	 */
	private isBuiltInProviderId(providerId: string): providerId is BuiltInProviderId {
		return (BUILT_IN_PROVIDER_IDS as readonly string[]).includes(providerId);
	}

	/**
	 * Get stored auth state for a provider (new system).
	 * Returns the stored auth state with secret IDs (not resolved secrets).
	 *
	 * @param providerId - The provider ID (e.g., "openai", "anthropic")
	 * @returns The stored auth state, or undefined if provider not found
	 */
	getStoredAuthState(providerId: string): StoredAuthState | undefined {
		// Check if it's a built-in provider
		if (this.isBuiltInProviderId(providerId)) {
			const config = this.#data.providerConfig[providerId];
			if (!config) return undefined;
			return this.convertLegacyAuthToStoredState(config.providerAuth);
		}

		// Check custom providers
		const customProvider = this.#customProviders.find((p) => p.definition.id === providerId);
		if (customProvider) {
			return customProvider.state.auth;
		}

		return undefined;
	}

	/**
	 * Converts legacy provider auth to new StoredAuthState format.
	 */
	private convertLegacyAuthToStoredState(legacyAuth: {
		apiKeyId?: string;
		baseUrl?: string;
		headers?: Record<string, string>;
	}): StoredFieldBasedAuthState {
		const values: Record<string, string> = {};
		const secretIds: Record<string, string> = {};

		// Extract known fields from legacy auth
		const auth = legacyAuth as {
			apiKeyId?: string;
			baseUrl?: string;
			headers?: Record<string, string>;
		};

		if (auth.apiKeyId) {
			secretIds.apiKey = auth.apiKeyId;
		}

		if (auth.baseUrl) {
			values.baseUrl = auth.baseUrl;
		}

		if (auth.headers) {
			// Store headers as JSON string for backward compatibility
			values.headers = JSON.stringify(auth.headers);
		}

		return {
			type: "field-based",
			values,
			secretIds,
		};
	}

	/**
	 * Get resolved auth state for a provider (new system).
	 * Resolves secret IDs to actual secret values.
	 *
	 * @param providerId - The provider ID (e.g., "openai", "anthropic")
	 * @returns The resolved runtime auth state, or undefined if provider not found
	 */
	getResolvedAuthState(providerId: string): RuntimeAuthState | undefined {
		const stored = this.getStoredAuthState(providerId);
		if (!stored) return undefined;

		if (stored.type === "field-based") {
			// Resolve secret IDs to actual values
			const values: Record<string, string> = { ...stored.values };

			for (const [fieldName, secretId] of Object.entries(stored.secretIds)) {
				const secretValue = getSecret(this._plugin.app, secretId);
				if (secretValue) {
					values[fieldName] = secretValue;
				}
			}

			return {
				type: "field-based",
				values,
			};
		}

		// OAuth tokens are passed through as-is
		return stored;
	}

	/**
	 * Check if a provider is configured (new system).
	 *
	 * @param providerId - The provider ID (e.g., "openai", "anthropic")
	 * @returns true if the provider is configured, false otherwise
	 */
	isProviderConfigured(providerId: string): boolean {
		if (this.isBuiltInProviderId(providerId)) {
			return this.#data.providerConfig[providerId].isConfigured;
		}

		// Check custom providers
		const customProvider = this.#customProviders.find((p) => p.definition.id === providerId);
		if (customProvider) {
			return customProvider.state.isConfigured;
		}

		return false;
	}

	/**
	 * Set provider configured status (new system).
	 *
	 * @param providerId - The provider ID (e.g., "openai", "anthropic")
	 * @param isConfigured - Whether the provider should be marked as configured
	 */
	setProviderConfigured(providerId: string, isConfigured: boolean): void {
		if (this.isBuiltInProviderId(providerId)) {
			const wasConfigured = this.#data.providerConfig[providerId].isConfigured;
			this.#data.providerConfig[providerId].isConfigured = isConfigured;

			// If disabling and it was the default model's provider, clear default
			if (wasConfigured && !isConfigured) {
				const defaultModel = this.#data.defaultChatModel;
				if (defaultModel && defaultModel.provider === providerId) {
					this.#data.defaultChatModel = null;
				}
			}

			this.saveSettings();
			return;
		}

		// Handle custom providers
		const customProvider = this.#customProviders.find((p) => p.definition.id === providerId);
		if (customProvider) {
			customProvider.state.isConfigured = isConfigured;
			this.saveSettings();
		}
	}

	/**
	 * Set a stored auth field value (new system).
	 * For non-secret fields, stores the value directly.
	 * For secret fields, creates/updates the secret in SecretStorage.
	 *
	 * @param providerId - The provider ID
	 * @param fieldName - The field name (e.g., "apiKey", "baseUrl")
	 * @param value - The value to store
	 * @param isSecret - Whether this field should be stored as a secret
	 */
	setProviderAuthField(providerId: string, fieldName: string, value: string, isSecret: boolean): void {
		if (this.isBuiltInProviderId(providerId)) {
			if (isSecret) {
				// Store in SecretStorage and save the ID
				const secretId = `${providerId}-${fieldName}`;
				setSecret(this._plugin.app, secretId, value);
				this.setStoredAuthParam(providerId, "apiKeyId", secretId);
			} else {
				// Store directly in providerAuth
				this.setStoredAuthParam(providerId, fieldName, value);
			}
			return;
		}

		// Handle custom providers
		const customProvider = this.#customProviders.find((p) => p.definition.id === providerId);
		if (customProvider && customProvider.state.auth.type === "field-based") {
			if (isSecret) {
				const secretId = `${providerId}-${fieldName}`;
				setSecret(this._plugin.app, secretId, value);
				customProvider.state.auth.secretIds[fieldName] = secretId;
			} else {
				customProvider.state.auth.values[fieldName] = value;
			}
			this.saveSettings();
		}
	}

	/**
	 * Assign an existing secret ID to a provider field (new system).
	 * Unlike setProviderAuthField, this doesn't create a new secret - it just
	 * stores the reference to an existing secret.
	 *
	 * @param providerId - The provider ID (e.g., "openai", "anthropic")
	 * @param fieldName - The field name (e.g., "apiKey")
	 * @param secretId - The ID of the existing secret to assign
	 */
	assignSecretIdToProviderField(providerId: string, fieldName: string, secretId: string): void {
		if (this.isBuiltInProviderId(providerId)) {
			// For built-in providers, the apiKey secret ID is stored as apiKeyId
			this.setStoredAuthParam(providerId, "apiKeyId", secretId);
			return;
		}

		// Handle custom providers
		const customProvider = this.#customProviders.find((p) => p.definition.id === providerId);
		if (customProvider && customProvider.state.auth.type === "field-based") {
			customProvider.state.auth.secretIds[fieldName] = secretId;
			this.saveSettings();
		}
	}

	// ============================================================================
	// Custom Provider CRUD Methods
	// ============================================================================

	/**
	 * Get all custom providers.
	 *
	 * @returns Array of stored custom providers
	 */
	getCustomProviders(): StoredCustomProvider[] {
		return this.#customProviders;
	}

	/**
	 * Get a custom provider by ID.
	 *
	 * @param providerId - The provider ID
	 * @returns The custom provider, or undefined if not found
	 */
	getCustomProvider(providerId: string): StoredCustomProvider | undefined {
		return this.#customProviders.find((p) => p.definition.id === providerId);
	}

	/**
	 * Add a new custom provider.
	 *
	 * @param provider - The custom provider to add
	 * @throws Error if provider ID already exists or conflicts with built-in
	 */
	async addCustomProvider(provider: StoredCustomProvider): Promise<void> {
		const providerId = provider.definition.id;

		// Check if ID conflicts with built-in providers
		if (isBuiltInProvider(providerId)) {
			throw new Error(`Cannot use built-in provider ID "${providerId}" for custom provider`);
		}

		// Check if ID already exists in custom providers
		if (this.#customProviders.some((p) => p.definition.id === providerId)) {
			throw new Error(`Custom provider with ID "${providerId}" already exists`);
		}

		this.#customProviders.push(provider);
		await this.saveSettings();
	}

	/**
	 * Update an existing custom provider.
	 *
	 * @param providerId - The provider ID to update
	 * @param updates - Partial updates to apply
	 * @throws Error if provider not found
	 */
	async updateCustomProvider(providerId: string, updates: Partial<StoredCustomProvider>): Promise<void> {
		const index = this.#customProviders.findIndex((p) => p.definition.id === providerId);
		if (index === -1) {
			throw new Error(`Custom provider with ID "${providerId}" not found`);
		}

		const existing = this.#customProviders[index];

		// Update definition if provided (but preserve the original ID)
		if (updates.definition) {
			existing.definition = {
				...existing.definition,
				...updates.definition,
				id: providerId, // Preserve original ID
			};
		}

		// Update state if provided
		if (updates.state) {
			existing.state = {
				...existing.state,
				...updates.state,
			};
		}

		await this.saveSettings();
	}

	/**
	 * Delete a custom provider.
	 *
	 * @param providerId - The provider ID to delete
	 * @throws Error if provider not found
	 */
	async deleteCustomProvider(providerId: string): Promise<void> {
		const index = this.#customProviders.findIndex((p) => p.definition.id === providerId);
		if (index === -1) {
			throw new Error(`Custom provider with ID "${providerId}" not found`);
		}

		this.#customProviders.splice(index, 1);
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

	// Migration: if user has old full systemPrompt, reset to base prompt
	// (Their customizations are likely in the old format)
	if (!rawData?.systemPrompt) {
		mergedData.systemPrompt = BASE_SYSTEM_PROMPT;
	}

	_pluginDataStore = new PluginDataStore(plugin, mergedData);
	return _pluginDataStore;
}

export function getData(): PluginDataStore {
	if (!_pluginDataStore) throw Error("Plugin does not exist");
	return _pluginDataStore;
}
