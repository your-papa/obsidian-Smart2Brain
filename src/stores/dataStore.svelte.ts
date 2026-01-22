import { normalizePath } from "obsidian";
import { BASE_SYSTEM_PROMPT, DEFAULT_PLUGIN_EXTENSIONS } from "../agent/prompts";
import SecondBrainPlugin, { type PluginData, type PluginPromptExtension, type SearchAlgorithm } from "../main";
import {
	AddEmbedModelError,
	AddGenModelError,
	type EmbedModelConfig,
	type EmbedProviders,
	type GenModelConfig,
	type GenProviders,
	type GetStoredProviderAuth,
	type ProviderAuth,
	type ProviderConfigs,
	SetEmbedModelError,
	SetGenModelError,
} from "../types/providers";
import type { RegisteredProvider } from "../types/providers";
import { getSecret, listSecrets, setSecret } from "../lib/secretStorage";
import type { UUIDv7 } from "../utils/uuid7Validator";
import type { ChatModel } from "./chatStore.svelte";

export const DEFAULT_PROVIDER_CONFIGS: ProviderConfigs = {
	Ollama: {
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
	OpenAI: {
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
	Anthropic: {
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
	CustomOpenAI: {
		isConfigured: false,
		providerAuth: {
			apiKeyId: "",
			baseUrl: "",
		},
		embedModels: new Map([["text-embedding-ada-002", { similarityThreshold: 0.75 }]]),
		genModels: new Map([["gpt-3.5-turbo", { temperature: 0.5, contextWindow: 16385 }]]),
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
	private _plugin: SecondBrainPlugin;

	constructor(plugin: SecondBrainPlugin, initialData: PluginData) {
		this._plugin = plugin;
		// Restore Maps from plain object shapes (after persistence serialization)
		for (const cfg of Object.values(initialData.providerConfig) as any[]) {
			if (cfg && "embedModels" in cfg && cfg.embedModels && !(cfg.embedModels instanceof Map)) {
				cfg.embedModels = new Map(Object.entries(cfg.embedModels));
			}
			if (cfg && "genModels" in cfg && cfg.genModels && !(cfg.genModels instanceof Map)) {
				cfg.genModels = new Map(Object.entries(cfg.genModels));
			}
		}
		this.#data = $state(initialData);
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
		const plain: any = {
			...snap,
			providerConfig: {},
		};

		for (const [provider, cfg] of Object.entries(snap.providerConfig)) {
			const cloned: any = { ...cfg };

			if ("embedModels" in cfg && cfg.embedModels instanceof Map) {
				cloned.embedModels = Object.fromEntries(cfg.embedModels);
			}
			if ("genModels" in cfg && cfg.genModels instanceof Map) {
				cloned.genModels = Object.fromEntries(cfg.genModels);
			}

			plain.providerConfig[provider] = cloned;
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

	getConfiguredProviders(): RegisteredProvider[] {
		return Object.entries(this.#data.providerConfig)
			.filter(([_, conf]) => conf.isConfigured)
			.map(([provider]) => provider as RegisteredProvider);
	}

	getAllConfiguredModels(): string[] {
		return this.getConfiguredProviders().flatMap((provider) =>
			Array.from(this.#data.providerConfig[provider].genModels.keys()),
		);
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
	getProviderIsConfigured(provider: RegisteredProvider): boolean {
		return this.#data.providerConfig[provider].isConfigured;
	}
	toggleProviderIsConfigured(provider: RegisteredProvider) {
		const wasConfigured = this.#data.providerConfig[provider].isConfigured;
		this.#data.providerConfig[provider].isConfigured = !wasConfigured;

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
	getStoredProviderAuthParams(provider: RegisteredProvider): GetStoredProviderAuth<typeof provider> {
		return this.#data.providerConfig[provider].providerAuth;
	}

	/**
	 * Get resolved provider auth params with actual secrets from SecretStorage
	 */
	getResolvedProviderAuth(provider: RegisteredProvider): ProviderAuth {
		const stored = this.#data.providerConfig[provider].providerAuth;
		const resolved: ProviderAuth = { ...stored };

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
	setStoredAuthParam<T extends RegisteredProvider, K extends keyof GetStoredProviderAuth<T>>(
		provider: T,
		key: K,
		value: GetStoredProviderAuth<T>[K],
	): void {
		const newAuth = { ...this.#data.providerConfig[provider].providerAuth };
		(newAuth as Record<string, unknown>)[key as string] = value;
		this.#data.providerConfig[provider].providerAuth = newAuth;
		this.saveSettings();
	}

	/**
	 * Create a new secret and assign it to a provider
	 * @param provider - The provider to assign the secret to
	 * @param secretId - The ID for the secret (lowercase alphanumeric with dashes, max 64 chars)
	 * @param secretValue - The actual secret value
	 */
	createAndAssignSecret(provider: RegisteredProvider, secretId: string, secretValue: string): void {
		setSecret(this._plugin.app, secretId, secretValue);
		this.setStoredAuthParam(
			provider,
			"apiKeyId" as keyof GetStoredProviderAuth<typeof provider>,
			secretId as never,
		);
	}

	/**
	 * Assign an existing secret to a provider
	 */
	assignSecretToProvider(provider: RegisteredProvider, secretId: string): void {
		this.setStoredAuthParam(
			provider,
			"apiKeyId" as keyof GetStoredProviderAuth<typeof provider>,
			secretId as never,
		);
	}

	/**
	 * Get the actual API key from SecretStorage
	 */
	getProviderApiKey(provider: RegisteredProvider): string | null {
		const stored = this.#data.providerConfig[provider].providerAuth;
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

	getEmbedModels<P extends EmbedProviders>(provider: P): Map<string, EmbedModelConfig> {
		return this.#data.providerConfig[provider].embedModels;
	}

	addEmbedModel<P extends EmbedProviders>(provider: P, modelName: string, conf: EmbedModelConfig) {
		const current = this.#data.providerConfig[provider].embedModels;
		if (current.has(modelName)) throw new AddEmbedModelError(provider, modelName);
		// Reassign a new Map to ensure reactivity + easier change detection
		const next = new Map(current);
		next.set(modelName, conf);
		this.#data.providerConfig[provider].embedModels = next;
		this.saveSettings();
	}

	updateEmbedModel<P extends EmbedProviders>(provider: P, modelName: string, conf: EmbedModelConfig) {
		const current = this.#data.providerConfig[provider].embedModels;
		if (!current.has(modelName)) throw new SetEmbedModelError(provider, modelName);
		const next = new Map(current);
		next.set(modelName, conf);
		this.#data.providerConfig[provider].embedModels = next;
		this.saveSettings();
	}

	deleteEmbedModel<P extends EmbedProviders>(provider: P, modelName: string) {
		const current = this.#data.providerConfig[provider].embedModels;
		if (!current.has(modelName)) throw new SetEmbedModelError(provider, modelName);
		const next = new Map(current);
		next.delete(modelName);
		this.#data.providerConfig[provider].embedModels = next;
		this.saveSettings();
	}

	getGenModels<P extends GenProviders>(provider: P): Map<string, GenModelConfig> {
		return this.#data.providerConfig[provider].genModels;
	}

	addGenModel<P extends GenProviders>(provider: P, modelName: string, conf: GenModelConfig) {
		const current = this.#data.providerConfig[provider].genModels;
		if (current.has(modelName)) throw new AddGenModelError(provider, modelName);
		const next = new Map(current);
		next.set(modelName, conf);
		this.#data.providerConfig[provider].genModels = next;
		this.saveSettings();
	}

	updateGenModel<P extends GenProviders>(provider: P, modelName: string, conf: GenModelConfig) {
		const current = this.#data.providerConfig[provider].genModels;
		if (!current.has(modelName)) throw new SetGenModelError(provider, modelName);
		const next = new Map(current);
		next.set(modelName, conf);
		this.#data.providerConfig[provider].genModels = next;
		this.saveSettings();
	}

	deleteGenModel<P extends GenProviders>(provider: P, modelName: string) {
		const current = this.#data.providerConfig[provider].genModels;
		if (!current.has(modelName)) throw new SetGenModelError(provider, modelName);
		const next = new Map(current);
		next.delete(modelName);
		this.#data.providerConfig[provider].genModels = next;

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
