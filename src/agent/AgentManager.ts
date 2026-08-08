import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Notice, normalizePath, TFile } from "obsidian";
import { installObsidianFetch } from "../lib/obsidianFetch";
import { invalidateProviderState } from "../lib/query";
import type SecondBrainPlugin from "../main";
import type { ChatModel } from "../stores/chatStore.svelte";
import { getData } from "../stores/dataStore.svelte";
import { BUILT_IN_TOOL_IDS, type BuiltInToolId, type AgentConfig, type SkillMetadata } from "../types/plugin";
import { VIEW_TYPE_CHAT } from "../views/chat/Chat";
import { lookupModelInfo } from "../providers/modelsDevApi";
import { fetchOllamaModelsInfo } from "../providers/ollamaModels";
import { SystemPromptModal } from "../components/modal/SystemPromptModal";
import {
	extractCapabilities as extractOpenRouterCapabilities,
	fetchOpenRouterModels,
} from "../providers/openrouterModels";
import type { VisibleNoteRef } from "../hooks/useVisibleNotes.svelte";
import type { SelectionRef } from "../hooks/useSelection.svelte";
import type { GraphNoteRef } from "../stores/chatStore.svelte";

import {
	ProviderAuthError,
	ProviderEndpointError,
	ProviderNotFoundError,
	ProviderRegistry,
	ProviderRegistryError,
	type AuthObject,
	getProviderDefinition,
} from "../providers/index";
import type { ChatAttachment } from "../types/shared";
import { gzipSync } from "node:zlib";
import { Logger } from "../utils/logging";
import { memoriesDir } from "../utils/agentPaths";
import { StartupProfiler } from "../utils/startupProfiler";
import {
	Agent,
	NATIVE_PDF_PROVIDERS,
	type AgentStreamChunk,
	type CheckpointHistoryItem,
	type ChooseModelParams,
	type ResolvedRun,
	type SubAgentSpec,
	type ThreadHistory,
} from "./Agent";
import { ObsidianChatManager } from "./ObsidianChatManager";
import type { ThreadSnapshot } from "./memory/ThreadStore";
import { BASE_SYSTEM_PROMPT, DEFAULT_MEMORY_PROMPT, buildMemoryFolderHeader } from "./prompts";
import { LangSmithTelemetry, type Telemetry } from "./telemetry";
import { createExecuteJavaScriptTool } from "./tools/executeJavaScript";
import { createPluginApiExecTool } from "./tools/executePluginApi";
import { createFetchUrlTool } from "./tools/fetchUrl";
import { createGetAllTagsTool } from "./tools/getAllTags";
import { createWebSearchTool } from "./tools/webSearch";
import { createGetPropertiesTool } from "./tools/getProperties";
import { createGrepNotesTool } from "./tools/grepNotes";
import { createLoadSkillTool } from "./tools/loadSkill";
import { createListDirectoryTool } from "./tools/listDirectory";
import { createManageNotesTool } from "./tools/manageNotes";
import { createUpdateSkillTool } from "./tools/updateSkill";
import { createReadContentTool } from "./tools/readContent";
import { createSearchNotesTool } from "./tools/searchNotes";
import {
	CURATED_PLUGIN_INTEGRATIONS,
	type PluginIntegration,
	pluginExposesApi,
	isCommunityPluginEnabled,
	isInternalPluginEnabled,
	getPluginIcon,
	skillIcon,
	coreSkillRank,
	toExecToolId,
} from "./integrations/pluginIntegrations";

import { getRegistry } from "../providers/registry";

import type { StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const URL_REGEX = /https?:\/\/[^\s]+/g;
const LANGCHAIN_TROUBLESHOOT_REGEX = /\n*Troubleshooting URL: https:\/\/docs\.langchain\.com\S*/g;

/** Create a DocumentFragment with clickable links for any URLs in the text. */
function createNoticeFragment(text: string): DocumentFragment {
	const cleaned = text.replace(LANGCHAIN_TROUBLESHOOT_REGEX, "").trim();
	const frag = document.createDocumentFragment();
	let lastIndex = 0;
	for (const match of cleaned.matchAll(URL_REGEX)) {
		const url = match[0];
		const index = match.index;
		if (index > lastIndex) frag.appendText(cleaned.slice(lastIndex, index));
		const link = frag.createEl("a", { text: url, href: url });
		link.setAttr("target", "_blank");
		lastIndex = index + url.length;
	}
	if (lastIndex < cleaned.length) frag.appendText(cleaned.slice(lastIndex));
	return frag;
}

/** Result of provider authentication validation */
export type AuthValidationResult = { success: true } | { success: false; message: string };

/**
 * Chunk type yielded by AgentManager generator methods.
 * Derived from the canonical AgentStreamChunk to stay in sync automatically.
 */
export type AgentManagerStreamChunk =
	| { type: "token"; token: string; aiMessageId?: string }
	| Pick<
			Extract<AgentStreamChunk, { type: "tool_start" }>,
			| "type"
			| "toolCallId"
			| "toolName"
			| "input"
			| "preamble"
			| "aiMessageId"
			| "subAgentName"
			| "parentToolCallId"
	  >
	| Pick<
			Extract<AgentStreamChunk, { type: "tool_end" }>,
			"type" | "toolCallId" | "toolName" | "output" | "aiMessageId" | "subAgentName" | "parentToolCallId"
	  >
	| Pick<Extract<AgentStreamChunk, { type: "checkpoint_message" }>, "type" | "message">
	| { type: "result"; result: unknown };

const resolvedVisionSupportCache = new Map<string, boolean>();
const inflightVisionSupportRequests = new Map<string, Promise<boolean>>();

function getVisionSupportCacheKey(providerId: string, modelId: string): string {
	return `${providerId}::${modelId}`;
}

function persistResolvedVisionSupport(model: ChatModel, supportsVision: boolean): void {
	const data = getData();
	const selectedAgent = data.getSelectedAgent();
	const selectedModel = selectedAgent.chatModel;

	if (
		selectedModel?.provider === model.provider &&
		selectedModel.model === model.model &&
		selectedModel.modelConfig.supportsVision === undefined
	) {
		data.updateAgent(selectedAgent.id, {
			chatModel: {
				...selectedModel,
				modelConfig: {
					...selectedModel.modelConfig,
					supportsVision,
				},
			},
		});
	}
}

/**
 * Maps the UI ChatModel type to papa-ts ChooseModelParams.
 * Enriches supportsVision from provider-native APIs first (Ollama, OpenRouter),
 * then falls back to models.dev for other providers.
 */
async function toChooseModelParams(model: ChatModel): Promise<ChooseModelParams> {
	const options = { ...model.modelConfig };
	const cacheKey = getVisionSupportCacheKey(model.provider, model.model);

	if (options.supportsVision !== undefined) {
		resolvedVisionSupportCache.set(cacheKey, options.supportsVision);
	}

	// If supportsVision is not explicitly set, resolve it from provider APIs
	if (options.supportsVision === undefined) {
		try {
			const resolvedSupportsVision = await resolveVisionSupportCached(model.provider, model.model);
			options.supportsVision = resolvedSupportsVision;
			// Persist resolved capability via store update helper (avoid mutating model reference directly).
			persistResolvedVisionSupport(model, resolvedSupportsVision);
		} catch {
			// Non-critical: default to false if all lookups fail
		}
	}

	return {
		provider: model.provider,
		chatModel: model.model,
		options,
	};
}

function resolveSummarizationChatModel(chatModel: ChatModel, summarizationModel: ChatModel | null): ChatModel {
	return summarizationModel ?? chatModel;
}

function resolveTitleChatModel(chatModel: ChatModel, titleModel: ChatModel | null): ChatModel {
	return titleModel ?? chatModel;
}

async function resolveVisionSupportCached(providerId: string, modelId: string): Promise<boolean> {
	const cacheKey = getVisionSupportCacheKey(providerId, modelId);

	const cached = resolvedVisionSupportCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const inflight = inflightVisionSupportRequests.get(cacheKey);
	if (inflight) {
		return inflight;
	}

	const request = resolveVisionSupport(providerId, modelId)
		.then((supportsVision) => {
			resolvedVisionSupportCache.set(cacheKey, supportsVision);
			return supportsVision;
		})
		.finally(() => {
			inflightVisionSupportRequests.delete(cacheKey);
		});

	inflightVisionSupportRequests.set(cacheKey, request);
	return request;
}

/**
 * Resolves vision support from provider-native APIs.
 * Priority: Ollama /api/show → OpenRouter /api/v1/models → models.dev fallback
 */
async function resolveVisionSupport(providerId: string, modelId: string): Promise<boolean> {
	// 1. Ollama: use /api/show capabilities (cached)
	if (providerId === "ollama") {
		const data = getData();
		const auth = data.getResolvedAuthState("ollama");
		if (auth?.baseUrl) {
			const models = await fetchOllamaModelsInfo(auth.baseUrl, [modelId]);
			const info = models.get(modelId);
			if (info) return info.supportsVision ?? false;
		}
	}

	// 2. OpenRouter: derive vision from architecture.input_modalities (cached)
	if (providerId === "openrouter") {
		const models = await fetchOpenRouterModels();
		if (models) {
			const info = models.get(modelId);
			if (info) return extractOpenRouterCapabilities(info).supportsVision;
		}
	}

	// 3. Fallback: models.dev for other providers (OpenAI, Anthropic, etc.)
	const mdInfo = await lookupModelInfo(providerId, modelId);
	if (mdInfo) return mdInfo.attachment ?? false;

	return false;
}

export class AgentManager {
	private readonly plugin: SecondBrainPlugin;
	private agent: Agent | null = null;
	private deferredSetup: Promise<void> | null = null;
	/**
	 * In-flight `initialize()` run, if any. `ensureAgent()` (lazy init on first
	 * chat open) and the deferred `initialize()` in main.ts's `onLayoutReady` can
	 * fire concurrently on a cold start; without this guard both would run the
	 * full teardown-and-rebuild (`this.agent = null` + `registry.clear()`)
	 * interleaved, clobbering each other and possibly leaving a half-configured
	 * agent. Concurrent callers share this promise instead. */
	private initPromise: Promise<void> | null = null;
	/** Long-lived ref-counted global-fetch patch for MCP tool transport, held for
	 * the manager's lifetime and released in cleanup(). */
	private mcpFetchPatch: { release: () => void } | null = null;
	/** MCP tools memoized per agent id (network handshake — see ensureMCPToolsForAgent). */
	private readonly mcpToolsByAgent = new Map<string, StructuredToolInterface[]>();
	/** In-flight MCP handshake promises — deduplicates concurrent callers for the same agent. */
	private readonly mcpToolsInflight = new Map<string, Promise<StructuredToolInterface[]>>();
	/** Callbacks to invoke once after the next `initialize()` completes. Used to
	 *  reload chat sessions that opened before the deferred init finished. */
	private postInitCallbacks: Array<() => void> = [];
	private readonly chatManager: ObsidianChatManager;

	private sanitizeThreadFileName(threadId: string): string {
		return threadId
			.replace(/[<>:"/\\|?*]/g, "-")
			.replace(/\s+/g, " ")
			.trim()
			.substring(0, 100);
	}

	private normalizeThreadId(threadId: string): string {
		const normalized = normalizePath(threadId.trim() || "default-thread");
		if (normalized.endsWith(".chat")) {
			return normalized;
		}

		const fileName = `${this.sanitizeThreadFileName(normalized) || "default-thread"}.chat`;
		return normalizePath(`${getData().targetFolder}/${fileName}`);
	}

	constructor(plugin: SecondBrainPlugin) {
		this.plugin = plugin;
		this.chatManager = new ObsidianChatManager(plugin);
	}

	/** Get the singleton registry instance */
	private get registry(): ProviderRegistry {
		return getRegistry();
	}

	/**
	 * Check if an Obsidian plugin is installed (may or may not be enabled).
	 */
	isPluginInstalled(pluginId: string): boolean {
		// @ts-ignore - Obsidian plugin API
		// manifests contains all installed plugins, plugins only contains enabled ones
		return Boolean(this.plugin.app.plugins?.manifests?.[pluginId]);
	}

	/**
	 * Check if an Obsidian community plugin is enabled (installed and active).
	 */
	isPluginEnabled(pluginId: string): boolean {
		return isCommunityPluginEnabled(this.plugin.app, pluginId);
	}

	/**
	 * Check if an Obsidian core (internal) plugin is enabled.
	 * @param pluginId - Core plugin ID (e.g., "canvas", "bases")
	 */
	isInternalPluginEnabled(pluginId: string): boolean {
		return isInternalPluginEnabled(this.plugin.app, pluginId);
	}

	/**
	 * Get list of enabled plugins from the supported skills.
	 */
	getEnabledPluginIds(): string[] {
		const pluginData = getData();
		const selectedAgent = pluginData.getSelectedAgent();
		return Object.keys(selectedAgent.skills)
			.filter((id) => selectedAgent.skills[id]?.enabled)
			.filter((id) => this.isPluginEnabled(id));
	}

	/**
	 * Assembles the full system prompt from base prompt + enabled skills.
	 * Uses the currently selected agent's configuration.
	 * Only includes skills for plugins that are both enabled AND installed.
	 */
	async assembleSystemPrompt(agent?: AgentConfig): Promise<string> {
		const pluginData = getData();
		const selectedAgent = agent ?? pluginData.getSelectedAgent();

		let prompt = this.plugin.promptFilesService?.getBasePrompt(selectedAgent.id) ?? BASE_SYSTEM_PROMPT;
		const hasWriteTools = selectedAgent.toolsConfig.manage_notes?.enabled ?? false;

		// Memory: long-lived facts stored as notes in the shared memory folder. Gated on the
		// agent opting in AND manage_notes being enabled (recording a memory is a note
		// write). The guidance lives in the user-editable `memoryPrompt` and is placed
		// right after the base prompt — adjacent to it, NOT buried in the auto-appended
		// tool-guideline tail — so it reads as (and is tunable as) agent behavior.
		// Writes inside the folder auto-apply (see stageNoteOperations).
		if (selectedAgent.memoryEnabled && hasWriteTools) {
			const memoryFolder = normalizePath(memoriesDir());
			// Best-effort ensure the folder exists so search_notes/list_directory have
			// somewhere to look before the first memory is written.
			try {
				if (!this.plugin.app.vault.getFolderByPath(memoryFolder)) {
					void this.plugin.app.vault.createFolder(memoryFolder).catch(() => {});
				}
			} catch {
				// ignore — folder is created on first write anyway
			}
			// The live memory folder is named by a header we always prepend, so it tracks the
			// configurable agent folder. The editable `memoryPrompt` is path-agnostic instructions
			// (no baked-in path to go stale); absent falls back to the default instructions.
			const instructions = selectedAgent.memoryPrompt?.trim() || DEFAULT_MEMORY_PROMPT;
			prompt += `\n\n${buildMemoryFolderHeader(memoryFolder)}\n\n${instructions}`;
		}

		// Note: tool how-to and skill guidance are no longer injected eagerly here.
		// Every former capability is now a core *skill* (a SKILL.md with tools attached via
		// `allowed-tools`); its guidance is the skill body, advertised by description in
		// the `# Skills` section below and loaded on demand via `load_skill`. Anything that
		// must always be in front of the model belongs in the skill's description.

		// Honesty guard when no write tool is enabled (the write policy otherwise lives
		// inside the "edit-notes" core skill's body, loaded on demand).
		if (!hasWriteTools) {
			prompt +=
				"\n\n# Write Access\n- No write tools are currently enabled.\n- Do not claim you can modify notes.\n- If the user asks for edits, explain the change you would make instead.";
		}

		// Note: per-plugin code-exec integrations need no prompt block here — each enabled
		// `exec_<plugin>` tool already carries its usage guidance in the tool description
		// (see createPluginApiExecTool), and the linked skill is advertised in `# Skills`
		// with its api shape in the skill body, loaded on demand via `load_skill`.

		const skillsService = this.plugin.skillsService;
		if (!skillsService?.isDiscovered()) {
			return prompt;
		}

		// Build enable state from agent's skill configuration
		// Skills default to enabled unless explicitly disabled by the agent
		const agentSkills = selectedAgent.skills;
		const enableState: Record<string, boolean> = {};
		for (const [name] of skillsService.getCachedSkills()) {
			// Check agent's skill settings, default to enabled if not specified
			enableState[name] = agentSkills[name]?.enabled ?? true;
		}

		// Add available skills context XML (for skill discovery via load_skill tool).
		// Gate on plugin availability so skills for not-enabled plugins aren't advertised.
		const contextXml = skillsService.generateContextXml(
			enableState,
			(id) => this.isPluginEnabled(id),
			(id) => this.isInternalPluginEnabled(id),
		);
		if (contextXml) {
			prompt +=
				"\n\n# Skills\nThe following available_skills section lists skills that can help you with specific tasks. When you need detailed instructions for a skill, use the `load_skill` tool with the skill name to retrieve the full instructions. Only load skills when you actually need them for a task.";
			prompt += `\n\n${contextXml}`;
		}

		Logger.log(`[AgentManager] Final system prompt length: ${prompt.length} chars`);
		return prompt;
	}

	/**
	 * Invalidates cached runnables after a change to a global prompt input
	 * (e.g. loaded/unloaded skills). The system prompt is reassembled per-agent
	 * at stream time, so this only needs to drop stale cached runnables; also
	 * clears per-agent MCP tool caches so they are re-fetched next run.
	 */
	invalidateSystemPromptCaches(): void {
		this.mcpToolsByAgent.clear();
		this.mcpToolsInflight.clear();
		this.agent?.invalidateAllRunnables();
	}

	openSystemPromptDiff(agentId: string): void {
		const pluginData = getData();
		const agent = pluginData.agents[agentId];
		if (!agent) return;
		const promptFiles = this.plugin.promptFilesService;
		new SystemPromptModal(
			this.plugin,
			{
				getPrompt: () => promptFiles?.getBasePrompt(agentId) ?? BASE_SYSTEM_PROMPT,
				setPrompt: (prompt: string) => {
					void promptFiles?.writeBasePrompt(agentId, prompt).then(() => {
						this.invalidateSystemPromptCaches();
					});
				},
				defaultPrompt: BASE_SYSTEM_PROMPT,
			},
			{ title: `System Prompt — ${agent.name}`, showDiff: true },
		).open();
	}

	/**
	 * Get available models for a provider by discovering them from the API.
	 * @returns Array of available chat model names
	 */
	async getAvailableModels(providerId: string): Promise<string[]> {
		try {
			if (!providerId) return [];

			const pluginData = getData();
			const providerDef = getProviderDefinition(providerId, pluginData.getAllProviderMeta());

			if (providerDef) {
				const resolvedAuth = pluginData.getResolvedAuthState(providerId);
				if (!resolvedAuth) {
					return [];
				}

				try {
					const discovered = await providerDef.discoverModels(resolvedAuth);
					return discovered;
				} catch (error) {
					Logger.warn(`Model discovery failed for ${providerId}:`, error);
					return [];
				}
			}

			return [];
		} catch (error) {
			Logger.error("Error fetching available models", error);
			return [];
		}
	}

	/**
	 * Registers a provider on the registry with its auth state.
	 */
	private registerProvider(providerId: string, auth: AuthObject): void {
		const pluginData = getData();
		const providerDef = getProviderDefinition(providerId, pluginData.getAllProviderMeta());

		if (!providerDef) {
			throw new Error(`Unknown provider: ${providerId}`);
		}
		this.registry.register(providerId, providerDef, auth);
	}

	private buildRunMetadata(agentId: string, agentName: string, chatModel: ChatModel): Record<string, unknown> {
		return {
			agent_id: agentId,
			agent_name: agentName,
			model_provider: chatModel.provider,
			model: chatModel.model,
		};
	}

	/**
	 * Validates provider authentication using the new provider ID system.
	 *
	 * @param providerId - The provider ID (e.g., "openai", "anthropic", "ollama")
	 * @param auth - The runtime auth state with resolved secrets
	 * @returns AuthValidationResult indicating success or failure
	 */
	async validateProviderAuth(providerId: string, auth: AuthObject): Promise<AuthValidationResult> {
		const pluginData = getData();
		const providerDef = getProviderDefinition(providerId, pluginData.getAllProviderMeta());

		if (!providerDef) {
			return { success: false, message: `Unknown provider: ${providerId}` };
		}

		try {
			const validationResult = await providerDef.validateAuth(auth);

			if (!validationResult.valid) {
				return { success: false, message: validationResult.error };
			}

			return { success: true };
		} catch (error) {
			if (error instanceof ProviderAuthError) {
				return { success: false, message: "Invalid API key" };
			}
			if (error instanceof ProviderEndpointError) {
				return { success: false, message: "Invalid base URL or endpoint unreachable" };
			}
			if (error instanceof ProviderRegistryError) {
				return { success: false, message: error.message };
			}
			if (error instanceof Error) {
				return { success: false, message: error.message };
			}
			return { success: false, message: "Provider configuration failed" };
		}
	}

	private configureTelemetry(): Telemetry | undefined {
		const data = getData();
		if (data.enableLangSmith && data.langSmithApiKey) {
			try {
				const telemetry = new LangSmithTelemetry({
					projectName: data.langSmithProject || "obsidian-agent",
					apiKey: data.langSmithApiKey,
					endpoint: data.langSmithEndpoint || "https://api.smith.langchain.com",
					flushOnComplete: true,
				});
				Logger.info("LangSmith telemetry enabled");
				return telemetry;
			} catch (e) {
				Logger.error("Failed to initialize LangSmith telemetry", e);
			}
		}
		return undefined;
	}

	/**
	 * Returns the chat model as a processor candidate if it supports the requested capability.
	 * For "image": requires vision support. For "pdf": requires vision + native PDF provider.
	 */
	private autoProcessorFromChatModel(chatModel: ChatModel | null, kind: "image" | "pdf"): ChatModel | null {
		if (!chatModel?.modelConfig?.supportsVision) return null;
		if (kind === "pdf" && !NATIVE_PDF_PROVIDERS.has(chatModel.provider)) return null;
		return chatModel;
	}

	/**
	 * Assembles the full tool set for an agent config — its built-in tools plus any
	 * MCP tools (cached per agent so we don't re-handshake on every run). Used by
	 * `prepareAgentForStream` to build the per-run tool list handed to `resolveRun`.
	 */
	private async assembleToolsForAgent(agentCfg: AgentConfig): Promise<StructuredToolInterface[]> {
		const tools = this.buildToolsForAgent(agentCfg);
		const mcpTools = await this.ensureMCPToolsForAgent(agentCfg.id);
		return [...tools, ...mcpTools];
	}

	/**
	 * Loads (and memoizes) the MCP tools for a given agent. MCP handshakes are
	 * network round-trips, so the resolved tools are cached per agent id and only
	 * re-fetched after `invalidateAgentRunnable` clears the entry.
	 */
	private async ensureMCPToolsForAgent(agentId: string): Promise<StructuredToolInterface[]> {
		const cached = this.mcpToolsByAgent.get(agentId);
		if (cached) return cached;

		const inflight = this.mcpToolsInflight.get(agentId);
		if (inflight) return inflight;

		const data = getData();
		const mcpServers = data.getAgentMCPServersForClient(agentId);
		const promise = (async () => {
			const tools: StructuredToolInterface[] = [];
			// Only cache a SUCCESSFUL load. A transient handshake failure (server
			// down at warm-up) must NOT persist an empty tool set as success —
			// otherwise the agent runs the whole session with its MCP tools
			// silently missing and never retries. On failure we return the (empty)
			// tools for this run but leave the cache unset so the next call retries.
			const ok =
				!mcpServers || Object.keys(mcpServers).length === 0 || (await this.loadMCPTools(tools, mcpServers));
			if (ok) this.mcpToolsByAgent.set(agentId, tools);
			return tools;
		})();
		this.mcpToolsInflight.set(agentId, promise);
		try {
			return await promise;
		} finally {
			// Clear inflight on every path (success, empty result, or a future
			// throw) so a rejected promise can never poison the map.
			if (this.mcpToolsInflight.get(agentId) === promise) {
				this.mcpToolsInflight.delete(agentId);
			}
		}
	}

	/**
	 * The set of built-in tool ids an agent may use, derived from its *enabled* skills'
	 * `allowed-tools` frontmatter. A built-in tool is only bound if some enabled skill
	 * attaches it — this is what makes `allowed-tools` load-bearing (a "core skill" is a
	 * skill that carries tools). Unknown tool ids (not built-in) are ignored. `load_skill`
	 * is never attached this way — it is bound unconditionally when any skill exists.
	 */
	private attachedToolIds(agentCfg: AgentConfig): Set<BuiltInToolId> {
		const attached = new Set<BuiltInToolId>();
		const cache = this.plugin.skillsService?.getCachedSkills();
		if (!cache) return attached;
		const builtIn = new Set<string>(BUILT_IN_TOOL_IDS);
		for (const [name, meta] of cache) {
			if (!(agentCfg.skills[name]?.enabled ?? true)) continue;
			const spec = meta.frontmatter.allowedTools;
			if (!spec) continue;
			for (const raw of spec.split(/\s+/)) {
				const id = raw.trim();
				if (!id) continue;
				if (builtIn.has(id)) attached.add(id as BuiltInToolId);
				else
					Logger.warn(`[AgentManager] Skill "${name}" lists unknown tool "${id}" in allowed-tools; ignoring`);
			}
		}
		return attached;
	}

	/**
	 * Builds the built-in tool instances for a given agent config. A built-in tool binds
	 * iff (a) some enabled skill attaches it via `allowed-tools` AND (b) the per-tool
	 * override in `toolsConfig` hasn't disabled it (default enabled). Shared between the
	 * main agent (bindBuiltInTools) and subagent resolution (resolveSubAgentSpecs).
	 */
	private buildToolsForAgent(agentCfg: AgentConfig): StructuredToolInterface[] {
		const tools: StructuredToolInterface[] = [];

		// A tool must be attached by an enabled skill AND not vetoed by its per-tool override.
		const attached = this.attachedToolIds(agentCfg);
		const isToolEnabled = (toolId: BuiltInToolId): boolean => {
			return attached.has(toolId) && (agentCfg.toolsConfig[toolId]?.enabled ?? true);
		};

		// Instantiate vision processor models for read_content.
		// When not explicitly configured, auto-fallback to the chat model if it supports vision.
		let imageProcessorInstance: BaseChatModel | undefined;
		let pdfProcessorInstance: BaseChatModel | undefined;
		const readContentSettings = agentCfg.toolsConfig.read_content?.settings as
			| { imageProcessor?: ChatModel | null; pdfProcessor?: ChatModel | null }
			| undefined;

		// undefined = auto-derive from chat model, null = explicitly disabled, ChatModel = explicitly set
		const explicitImage = readContentSettings?.imageProcessor;
		const explicitPdf = readContentSettings?.pdfProcessor;
		const imageProcessorModel =
			explicitImage !== undefined ? explicitImage : this.autoProcessorFromChatModel(agentCfg.chatModel, "image");
		const pdfProcessorModel =
			explicitPdf !== undefined ? explicitPdf : this.autoProcessorFromChatModel(agentCfg.chatModel, "pdf");

		if (imageProcessorModel) {
			try {
				imageProcessorInstance = this.registry.createChatInstance(
					imageProcessorModel.provider,
					imageProcessorModel.model,
					imageProcessorModel.modelConfig,
				);
				Logger.log(
					"[AgentManager] Image processor initialized:",
					imageProcessorModel.provider,
					imageProcessorModel.model,
				);
			} catch (e) {
				Logger.error("[AgentManager] Failed to initialize image processor", e);
			}
		}
		if (pdfProcessorModel) {
			try {
				pdfProcessorInstance = this.registry.createChatInstance(
					pdfProcessorModel.provider,
					pdfProcessorModel.model,
					pdfProcessorModel.modelConfig,
				);
				Logger.log(
					"[AgentManager] PDF processor initialized:",
					pdfProcessorModel.provider,
					pdfProcessorModel.model,
				);
			} catch (e) {
				Logger.error("[AgentManager] Failed to initialize PDF processor", e);
			}
		}

		// Built-in tool registry: maps tool IDs to their factory functions
		const builtInTools: [BuiltInToolId, () => StructuredToolInterface][] = [
			["search_notes", () => createSearchNotesTool(this.plugin.app)],
			["list_directory", () => createListDirectoryTool(this.plugin.app)],
			["get_all_tags", () => createGetAllTagsTool(this.plugin.app)],
			["execute_javascript", () => createExecuteJavaScriptTool()],
			["get_properties", () => createGetPropertiesTool(this.plugin.app)],
			[
				"read_content",
				() => createReadContentTool(this.plugin.app, imageProcessorInstance, pdfProcessorInstance),
			],
			["grep_notes", () => createGrepNotesTool(this.plugin.app)],
			["manage_notes", () => createManageNotesTool(this.plugin.app, agentCfg.id)],
			["fetch_url", () => createFetchUrlTool()],
			["web_search", () => createWebSearchTool()],
			["update_skill", () => createUpdateSkillTool(this.plugin.skillsService, this.plugin.app, agentCfg.id)],
		];

		for (const [toolId, factory] of builtInTools) {
			if (isToolEnabled(toolId)) tools.push(factory());
		}

		// Per-plugin code-exec integrations: one tool per enabled+approved plugin
		// that exposes an `api`. Double-gated — the plugin must be enabled (so its
		// runtime api exists) AND the user must have approved the integration for
		// this agent (defaults off).
		for (const integ of this.resolvePluginIntegrations()) {
			if (!this.isPluginEnabled(integ.pluginId)) continue;
			if (!(agentCfg.pluginExecTools?.[toExecToolId(integ.pluginId)] ?? false)) continue;
			tools.push(createPluginApiExecTool(this.plugin.app, integ.pluginId, integ.displayName));
		}

		// Add load_skill tool if skillsService is available and has skills
		if (this.plugin.skillsService?.isDiscovered()) {
			const skillsCache = this.plugin.skillsService.getCachedSkills();
			if (skillsCache.size > 0) {
				tools.push(createLoadSkillTool(this.plugin.skillsService));
			}
		}

		return tools;
	}

	/**
	 * Resolves the list of plugin integrations offered as per-plugin code-exec
	 * tools: curated entries whose plugin is enabled and exposes an `api`, unioned
	 * with auto-discovered enabled plugins that expose an `api` but aren't curated.
	 * De-duped by pluginId. Only enabled plugins are considered — a disabled
	 * plugin has no runtime api to script against.
	 *
	 * Exposed publicly so the settings UI can render the same list users approve.
	 */
	resolvePluginIntegrations(): PluginIntegration[] {
		const app = this.plugin.app;
		const byId = new Map<string, PluginIntegration>();

		for (const integ of CURATED_PLUGIN_INTEGRATIONS) {
			if (this.isPluginEnabled(integ.pluginId) && pluginExposesApi(app, integ.pluginId)) {
				byId.set(integ.pluginId, integ);
			}
		}

		// @ts-ignore - Obsidian plugin API (not in official types)
		const enabledIds: string[] = Array.from(app.plugins?.enabledPlugins ?? []);
		// S2B exposes its own public `api`, so it would otherwise auto-discover itself
		// as a scriptable plugin. Agent self-scripting was removed, so skip our own id.
		const selfId = this.plugin.manifest.id;
		for (const pluginId of enabledIds) {
			if (pluginId === selfId) continue;
			if (byId.has(pluginId)) continue;
			if (!pluginExposesApi(app, pluginId)) continue;
			// @ts-ignore - Obsidian plugin API (not in official types)
			const displayName = app.plugins?.manifests?.[pluginId]?.name ?? pluginId;
			byId.set(pluginId, { pluginId, displayName });
		}

		// Attach a skillId to any integration a discovered skill links to (curated skills,
		// or a per-plugin skill generated when the user enabled an auto-discovered plugin),
		// so the prompt points the agent at the right skill to load.
		const skillsService = this.plugin.skillsService;
		if (skillsService?.isDiscovered()) {
			for (const [skillName, metadata] of skillsService.getCachedSkills()) {
				if (!metadata.linkedPluginId) continue;
				const integ = byId.get(metadata.linkedPluginId);
				if (integ && !integ.skillId) {
					byId.set(metadata.linkedPluginId, { ...integ, skillId: skillName });
				}
			}
		}

		return Array.from(byId.values());
	}

	/**
	 * The skills switched on for an agent, in a stable display order, each with a resolved
	 * icon id. Everything is a skill now, so this is:
	 *   - each enabled, available core / community / auto-discovered plugin skill (the 4 former
	 *     capabilities — explore-vault/edit-notes/web/update-skills — are core skills here);
	 *   - each api-plugin with no skill covering it yet whose exec tool is enabled;
	 *   - each enabled user-authored custom skill;
	 *   - each enabled MCP server.
	 *
	 * Single source of truth for both the count and the icon strip shown in the agents-list
	 * summary (and the editor's rail badge), so the two never drift.
	 */
	private collectEnabledSkills(agentId: string): { icon: string }[] {
		const agent = getData().agents[agentId];
		if (!agent) return [];

		const skillsService = this.plugin.skillsService;
		const cachedSkills = skillsService?.isDiscovered() ? skillsService.getCachedSkills() : new Map();

		const skillEnabled = (skillId: string) => agent.skills[skillId]?.enabled ?? true;
		const skillAvailable = (metadata: { corePluginId?: string; linkedPluginId?: string }) => {
			if (metadata.corePluginId) return this.isInternalPluginEnabled(metadata.corePluginId);
			if (metadata.linkedPluginId) return this.isPluginEnabled(metadata.linkedPluginId);
			return true;
		};
		const iconFor = (skillId: string, metadata: SkillMetadata) =>
			skillIcon({
				id: skillId,
				icon: metadata.frontmatter.metadata?.icon,
				linkedPluginId: metadata.linkedPluginId,
				corePluginId: metadata.corePluginId,
				category: metadata.category,
			});

		const result: { icon: string }[] = [];

		// Plugin / community / core skills: enabled + available, excluding user-authored custom.
		// Ordered so the S2B built-in core skills come first (fixed order), then core-plugin
		// skills — matching the editor's Core Skills list (see coreSkillRank).
		const coveredPluginIds = new Set<string>();
		const coreEntries: { icon: string; rank: number }[] = [];
		for (const [skillId, metadata] of cachedSkills) {
			if (metadata.linkedPluginId) coveredPluginIds.add(metadata.linkedPluginId);
			if (metadata.category === "custom") continue;
			if (skillEnabled(skillId) && skillAvailable(metadata))
				coreEntries.push({
					icon: iconFor(skillId, metadata),
					rank: coreSkillRank({ id: skillId, corePluginId: metadata.corePluginId }),
				});
		}
		coreEntries.sort((a, b) => a.rank - b.rank);
		for (const entry of coreEntries) result.push({ icon: entry.icon });

		// Plugin api-integration cards: an api-plugin with no skill covering it yet counts
		// when its exec tool is enabled (enabling it in the editor also seeds a skill). Covered
		// == a discovered skill links it; curated integrations are seeded on first enable, so
		// key off actual coverage rather than the static curated skillId.
		for (const integ of this.resolvePluginIntegrations()) {
			if (coveredPluginIds.has(integ.pluginId)) continue;
			if (agent.pluginExecTools?.[toExecToolId(integ.pluginId)] ?? false)
				result.push({ icon: getPluginIcon(integ.pluginId) });
		}

		// Custom skills.
		for (const [skillId, metadata] of cachedSkills) {
			if (metadata.category === "custom" && skillEnabled(skillId))
				result.push({ icon: iconFor(skillId, metadata) });
		}

		// MCP servers.
		for (const server of Object.values(agent.mcpServers)) {
			if (server.enabled) result.push({ icon: "server" });
		}

		return result;
	}

	/**
	 * Count the skills switched on for an agent (see `collectEnabledSkills`).
	 */
	countEnabledSkills(agentId: string): number {
		return this.collectEnabledSkills(agentId).length;
	}

	/**
	 * Icon ids for the skills switched on for an agent, in display order (see
	 * `collectEnabledSkills`). Used by the agents-list summary strip.
	 */
	getEnabledSkillIcons(agentId: string): string[] {
		return this.collectEnabledSkills(agentId).map((s) => s.icon);
	}

	/**
	 * Resolves an agent's subagent references into fully-built specs (own model,
	 * own tools, own prompt). Referenced agents without a configured chat model
	 * are skipped (they cannot run). Delegation is one level deep — a referenced
	 * subagent's own subAgentIds are ignored.
	 */
	private resolveSubAgentSpecs(parentAgent: AgentConfig): SubAgentSpec[] {
		const data = getData();
		const refs = data.resolveSubAgents(parentAgent.id);
		const specs: SubAgentSpec[] = [];

		for (const ref of refs) {
			if (!ref.chatModel) {
				Logger.log(`[AgentManager] Skipping subagent "${ref.name}" — no chat model configured.`);
				continue;
			}
			try {
				const model = this.registry.createSubAgentChatInstance(
					ref.chatModel.provider,
					ref.chatModel.model,
					ref.chatModel.modelConfig,
				);
				const tools = this.buildToolsForAgent(ref);
				const isSelf = ref.id === parentAgent.id;
				// A self-reference exposes an isolated-context copy of this agent.
				// Give it a distinct selector name so it never collides with a
				// sibling subagent, and describe it as a clean-context worker.
				const name = isSelf ? `${ref.name} (isolated)` : ref.name;
				const refBasePrompt = this.plugin.promptFilesService?.getBasePrompt(ref.id) ?? BASE_SYSTEM_PROMPT;
				const promptHint = refBasePrompt.trim().replace(/\s+/g, " ").slice(0, 160);
				let description: string;
				if (isSelf) {
					description = `Delegate a subtask to a fresh isolated-context copy of yourself ("${ref.name}"). Use this to keep the main conversation's context clean while handling a self-contained subtask.`;
				} else {
					description = promptHint
						? `Delegate to the "${ref.name}" agent. ${promptHint}`
						: `Delegate a task to the "${ref.name}" agent.`;
				}
				specs.push({
					name,
					description,
					// Subagents use their own base system prompt. We intentionally omit
					// the parent's skills-context XML — subagents run isolated and load
					// their own skills only if their tools include load_skill.
					systemPrompt: refBasePrompt,
					model,
					tools,
				});
			} catch (e) {
				Logger.error(`[AgentManager] Failed to build subagent "${ref.name}"`, e);
			}
		}

		return specs;
	}

	private async loadMCPTools(
		tools: StructuredToolInterface[],
		mcpServers: Record<string, unknown> | undefined,
	): Promise<boolean> {
		if (!mcpServers || Object.keys(mcpServers).length === 0) return true;

		try {
			const mcpConfig = { mcpServers } as ConstructorParameters<typeof MultiServerMCPClient>[0];
			Logger.log("Initializing MCP client...", mcpConfig);

			// Patch global fetch once for the manager's lifetime — MCP tools read
			// `globalThis.fetch` both here (getTools) and later at invocation time,
			// so the patch must outlive this call. Ref-counted so it composes
			// safely with other installers (e.g. the settings modal's probe) and
			// is released exactly once in cleanup().
			if (!this.mcpFetchPatch) {
				this.mcpFetchPatch = installObsidianFetch();
			}

			try {
				const mcpClient = new MultiServerMCPClient(mcpConfig);
				const mcpTools = await mcpClient.getTools();
				Logger.log(`Loaded ${mcpTools.length} MCP tools`);
				tools.push(...mcpTools);
				return true;
			} catch (e) {
				Logger.error("Failed to get MCP tools", e);
				return false;
			}
		} catch (error) {
			Logger.error("Failed to load MCP tools", error);
			return false;
		}
	}

	private async ensureAgent(): Promise<Agent> {
		if (!this.agent) {
			await this.initialize();
		}

		if (!this.agent) {
			throw new Error("Agent initialization failed.");
		}
		return this.agent;
	}

	private registerConfiguredProviders(): string[] {
		const pluginData = getData();
		const configuredProviders = pluginData.getConfiguredProviders();
		const unavailableProviders: string[] = [];
		for (const providerId of configuredProviders) {
			const auth = pluginData.getResolvedAuthState(providerId);
			if (!auth) continue;

			try {
				this.registerProvider(providerId, auth);
			} catch (error) {
				if (error instanceof ProviderEndpointError) {
					unavailableProviders.push(providerId);
					continue;
				}
				throw error;
			}
		}
		return unavailableProviders;
	}

	async initialize(): Promise<void> {
		// Dedupe concurrent callers (lazy `ensureAgent` vs. the deferred
		// onLayoutReady init) onto a single in-flight run. Without this the
		// teardown-and-rebuild below would interleave and corrupt agent/registry
		// state. `reinitialize()` deliberately runs a fresh pass after this one.
		if (this.initPromise) return this.initPromise;
		this.initPromise = this.runInitialize().finally(() => {
			this.initPromise = null;
		});
		return this.initPromise;
	}

	private async runInitialize(): Promise<void> {
		// Load chats
		await StartupProfiler.measure("agent:chatManager.load", () => this.chatManager.load());

		// Guarantee the base-prompt cache is seeded + loaded before we assemble any system
		// prompt. main.ts's deferred startup runs promptFiles:init before agent:init, but a chat
		// opened during cold startup can trigger lazy ensureAgent() → initialize() *first*; without
		// this, getBasePrompt() would read an empty cache and fall back to BASE_SYSTEM_PROMPT,
		// dropping the user's file-backed instructions for that request. Both calls are idempotent
		// and cheap (skip-if-exists writes over a bounded file set).
		const promptFiles = this.plugin.promptFilesService;
		if (promptFiles) {
			await promptFiles.migrateBasePromptFilenames(getData().agents);
			await promptFiles.seedDefaults(getData().agents);
			await promptFiles.refresh(getData().agents);
		}

		// Cleanup existing agent if any
		this.agent = null;
		this.deferredSetup = null;

		// Clear and re-register all configured providers
		this.registry.clear();

		const unavailableProviders = this.registerConfiguredProviders();

		if (unavailableProviders.length > 0) {
			new Notice(`Cannot connect to: ${unavailableProviders.join(", ")}. Check that the service is running.`);
		}

		Logger.log("[AgentManager] Registry initialized with providers:", this.registry.list());

		// Configure Telemetry (use getData())
		const telemetry = this.configureTelemetry();

		const pluginData = getData();
		const selectedAgent = pluginData.getSelectedAgent();

		this.agent = new Agent({
			registry: this.registry,
			checkpointer: this.chatManager,
			threadStore: this.chatManager.asThreadStore(),
			telemetry,
		});

		// Reset the per-agent MCP-tool cache; runnables are per-run resolved.
		this.mcpToolsByAgent.clear();
		this.mcpToolsInflight.clear();

		// Warm up network-dependent setup (vision resolution + MCP tools) for the
		// default agent in the background so the first run resolves fast. Model,
		// prompt, and tools are no longer eagerly bound — each run resolves its own
		// runnable via prepareAgentForStream, keyed by agent config.
		const chatModel = selectedAgent.chatModel;
		this.deferredSetup = this.performDeferredSetup(selectedAgent, chatModel ?? undefined);

		// Notify any sessions that opened before init completed (e.g. workspace restore).
		const callbacks = this.postInitCallbacks.splice(0);
		for (const cb of callbacks) cb();
	}

	/**
	 * Register a one-shot callback to be invoked once the next `initialize()` completes.
	 * Used by chat sessions that opened before the deferred init finished so they can
	 * reload their checkpoint history once the agent is ready.
	 */
	onNextInitialized(cb: () => void): void {
		this.postInitCallbacks.push(cb);
	}

	/**
	 * Performs network-dependent setup in the background to avoid blocking plugin startup.
	 * - Resolves vision support from external APIs (Ollama, OpenRouter, models.dev)
	 * - Warms the per-agent MCP tool cache
	 * These are awaited before the first agent invocation via awaitDeferredSetup().
	 */
	private async performDeferredSetup(agentCfg: AgentConfig, chatModel: ChatModel | undefined): Promise<void> {
		const promises: Promise<void>[] = [];

		// Deferred: resolve vision support and persist it
		if (chatModel && chatModel.modelConfig.supportsVision === undefined) {
			promises.push(
				resolveVisionSupportCached(chatModel.provider, chatModel.model)
					.then((supportsVision) => persistResolvedVisionSupport(chatModel, supportsVision))
					.catch(() => {
						// Non-critical: vision defaults to false
					}),
			);
		}

		// Deferred: warm the MCP tool cache for the default agent (non-fatal).
		promises.push(
			this.ensureMCPToolsForAgent(agentCfg.id)
				.then(() => undefined)
				.catch(() => undefined),
		);

		await Promise.all(promises);
	}

	private async awaitDeferredSetup(): Promise<void> {
		if (this.deferredSetup) {
			await this.deferredSetup;
			this.deferredSetup = null;
		}
	}

	private mapChunk(chunk: AgentStreamChunk): AgentManagerStreamChunk | null {
		switch (chunk.type) {
			case "token":
				return { type: "token", token: chunk.token, aiMessageId: chunk.aiMessageId };
			case "tool_start":
				return {
					type: "tool_start",
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					input: chunk.input,
					preamble: chunk.preamble,
					aiMessageId: chunk.aiMessageId,
					subAgentName: chunk.subAgentName,
					parentToolCallId: chunk.parentToolCallId,
				};
			case "tool_end":
				return {
					type: "tool_end",
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					output: chunk.output,
					aiMessageId: chunk.aiMessageId,
					subAgentName: chunk.subAgentName,
					parentToolCallId: chunk.parentToolCallId,
				};
			case "result":
				return { type: "result", result: chunk.result };
			case "checkpoint_message":
				return { type: "checkpoint_message", message: chunk.message };
			default:
				return null;
		}
	}

	private async *dispatchStream(
		stream: AsyncGenerator<AgentStreamChunk>,
		signal: AbortSignal | undefined,
		chatModel: ChatModel,
		errorContext: string,
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		try {
			for await (const chunk of stream) {
				if (signal?.aborted) break;
				const mapped = this.mapChunk(chunk);
				if (mapped) yield mapped;
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") return;

			if (error instanceof ProviderEndpointError) {
				const provider = chatModel?.provider;
				if (provider) invalidateProviderState(provider);
				new Notice(error.message);
				throw error;
			}

			const message = error instanceof Error ? error.message : String(error);
			Logger.error(errorContext, error);
			new Notice(createNoticeFragment(message));
			throw error;
		} finally {
			if (signal?.aborted) Logger.log(`${errorContext} - aborted by user`);
		}
	}

	/**
	 * Stable signature over everything in an agent config that feeds the runnable
	 * build (model + prompt + tools + subagents). Used as the runnable cache key so
	 * a config change produces a fresh runnable while unchanged configs reuse one.
	 * MCP tools are excluded here (loaded async) — those need explicit invalidation
	 * via `invalidateAgentRunnable`.
	 * Includes the resolved subagents' own revisions (not just their ids), so editing
	 * a subagent's model/prompt/tools also invalidates every parent that references it.
	 */
	private agentConfigRevision(agent: AgentConfig): string {
		const data = getData();
		const promptFiles = this.plugin.promptFilesService;
		const subAgentRevisions = (agent.subAgentIds ?? []).map((id) => {
			const sub = data.getAgent(id);
			if (!sub) return { id, missing: true };
			return {
				id,
				systemPrompt: promptFiles?.getBasePrompt(id) ?? null,
				chatModel: sub.chatModel ? `${sub.chatModel.provider}:${sub.chatModel.model}` : null,
				toolsConfig: sub.toolsConfig,
				pluginExecTools: sub.pluginExecTools ?? null,
			};
		});
		return JSON.stringify({
			systemPrompt: promptFiles?.getBasePrompt(agent.id) ?? null,
			skills: agent.skills,
			toolsConfig: agent.toolsConfig,
			pluginExecTools: agent.pluginExecTools ?? null,
			subAgentIds: agent.subAgentIds ?? null,
			subAgentRevisions,
		});
	}

	private buildRunnableCacheKey(agent: AgentConfig, chatModel: ChatModel, summarizationModel: ChatModel): string {
		return JSON.stringify({
			provider: chatModel.provider,
			model: chatModel.model,
			contextWindow: chatModel.modelConfig?.contextWindow ?? null,
			supportsVision: chatModel.modelConfig?.supportsVision ?? null,
			summ: `${summarizationModel.provider}:${summarizationModel.model}`,
			agentId: agent.id,
			agentRev: this.agentConfigRevision(agent),
		});
	}

	/** Drops cached runnables + MCP tools for an agent whose config changed in a way
	 *  the cache key can't see (e.g. async-loaded MCP tools, or subagent internals). */
	invalidateAgentRunnable(agentId: string): void {
		this.mcpToolsByAgent.delete(agentId);
		this.mcpToolsInflight.delete(agentId);
		this.agent?.invalidateRunnable(agentId);
	}

	private async prepareAgentForStream(agentId: string): Promise<{
		agent: Agent;
		resolved: ResolvedRun;
		chatModel: ChatModel;
		runMetadata: Record<string, unknown>;
		resolvedAgentId: string;
	}> {
		const agent = await this.ensureAgent();
		await this.awaitDeferredSetup();
		const pluginData = getData();
		// Empty agentId ("" default) → intentionally use global selection.
		// Non-empty but unknown agentId → agent was deleted; throw rather than silently
		// falling back to the global (which would mislabel metadata and risk clearing
		// the global agent's model on ProviderNotFoundError mid-run for another tab).
		let selectedAgent: ReturnType<typeof pluginData.getSelectedAgent>;
		if (!agentId) {
			selectedAgent = pluginData.getSelectedAgent();
		} else {
			const found = pluginData.getAgent(agentId);
			if (!found) throw new Error(`Agent "${agentId}" no longer exists — please select a different agent.`);
			selectedAgent = found;
		}
		const chatModel = selectedAgent.chatModel;
		if (!chatModel) throw new Error("No chat model configured");
		const summarizationModel = resolveSummarizationChatModel(chatModel, selectedAgent.summarizationModel);
		const titleModel = resolveTitleChatModel(chatModel, selectedAgent.titleModel);

		const systemPrompt = await this.assembleSystemPrompt(selectedAgent);
		const tools = await this.assembleToolsForAgent(selectedAgent);
		const subAgents = this.resolveSubAgentSpecs(selectedAgent);
		const cacheKey = this.buildRunnableCacheKey(selectedAgent, chatModel, summarizationModel);

		let resolved: ResolvedRun;
		try {
			resolved = await agent.resolveRun({
				...(await toChooseModelParams(chatModel)),
				summarizationModel: await toChooseModelParams(summarizationModel),
				titleModel: await toChooseModelParams(titleModel),
				cacheKey,
				systemPrompt,
				tools,
				subAgents,
			});
		} catch (error) {
			if (error instanceof ProviderNotFoundError) {
				pluginData.updateAgent(selectedAgent.id, { chatModel: null });
				new Notice(`Provider "${chatModel.provider}" is no longer available. Please select a new model.`);
			}
			throw error;
		}

		const runMetadata = this.buildRunMetadata(selectedAgent.id, selectedAgent.name, chatModel);
		return { agent, resolved, chatModel, runMetadata, resolvedAgentId: selectedAgent.id };
	}

	async *streamQuery(
		query: string,
		threadId: string,
		agentId: string,
		checkpointId?: string,
		signal?: AbortSignal,
		attachments?: ChatAttachment[],
		visibleNotes?: VisibleNoteRef[],
		selection?: SelectionRef,
		graphNotes?: GraphNoteRef[],
		lcSource?: string,
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		const resolvedThreadId = this.normalizeThreadId(threadId);
		const { agent, resolved, chatModel, runMetadata, resolvedAgentId } = await this.prepareAgentForStream(agentId);

		yield* this.dispatchStream(
			agent.streamTokens({
				query,
				resolved,
				threadId: resolvedThreadId,
				metadata: runMetadata,
				configurable: { agent_id: resolvedAgentId, ...(checkpointId ? { checkpoint_id: checkpointId } : {}) },
				signal,
				attachments,
				visibleNotes,
				selection,
				graphNotes,
				lcSource,
			}),
			signal,
			chatModel,
			"Error streaming query",
		);
	}

	/**
	 * Edit a message by forking from a checkpoint with a new user message.
	 * This creates a new branch from the given checkpoint.
	 */
	async *editFromCheckpoint(
		query: string,
		threadId: string,
		agentId: string,
		checkpointId: string,
		signal?: AbortSignal,
		attachments?: ChatAttachment[],
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		const resolvedThreadId = this.normalizeThreadId(threadId);
		const { agent, resolved, chatModel, runMetadata, resolvedAgentId } = await this.prepareAgentForStream(agentId);

		yield* this.dispatchStream(
			agent.editFromCheckpoint({
				query,
				resolved,
				threadId: resolvedThreadId,
				checkpointId,
				metadata: runMetadata,
				configurable: { agent_id: resolvedAgentId },
				signal,
				attachments,
			} as Parameters<Agent["editFromCheckpoint"]>[0]),
			signal,
			chatModel,
			"Error editing message",
		);
	}

	/**
	 * Regenerate an AI response from a checkpoint without adding a new user message.
	 * This creates a new branch from the given checkpoint.
	 */
	async *regenerateFromCheckpoint(
		threadId: string,
		agentId: string,
		checkpointId: string,
		signal?: AbortSignal,
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		const resolvedThreadId = this.normalizeThreadId(threadId);
		const { agent, resolved, chatModel, runMetadata, resolvedAgentId } = await this.prepareAgentForStream(agentId);

		yield* this.dispatchStream(
			agent.regenerateFromCheckpoint({
				resolved,
				threadId: resolvedThreadId,
				checkpointId,
				metadata: runMetadata,
				configurable: { agent_id: resolvedAgentId },
				signal,
			}),
			signal,
			chatModel,
			"Error regenerating response",
		);
	}

	async getThreadHistory(threadId: string): Promise<ThreadHistory | null> {
		const resolvedThreadId = this.normalizeThreadId(threadId);
		try {
			// Try to use agent if available to get history from checkpoint (more robust)
			if (this.agent) {
				try {
					const history = await this.agent.getThreadHistory(resolvedThreadId);
					if (history) {
						return history;
					}
				} catch (e) {
					Logger.warn("Failed to get history from agent", e);
				}
			}
			return null;
		} catch (error) {
			Logger.error("Error fetching thread history", error);
			return null;
		}
	}

	async getCheckpointHistory(threadId: string): Promise<CheckpointHistoryItem[]> {
		// Guard: don't force a full initialize() if the agent isn't ready yet.
		// This can be called during workspace restore (before onLayoutReady) when a chat
		// view is reopened from a previous session. Returning [] is safe — loadSession
		// treats an empty checkpoint history as an unloaded state and the view will
		// reload properly once the deferred init completes.
		if (!this.agent) return [];
		return this.agent.getCheckpointHistory(this.normalizeThreadId(threadId));
	}

	/**
	 * Whether a thread has no checkpoints yet (a brand-new, unsubmitted chat).
	 * Used to skip the loading skeleton when opening an empty chat.
	 */
	async isThreadEmpty(threadId: string): Promise<boolean> {
		return this.chatManager.isThreadEmpty(this.normalizeThreadId(threadId));
	}

	/**
	 * Reads a thread's checkpoints straight from its `.chat` file (no live agent
	 * required) as `CheckpointHistoryItem[]`. Used by the read-only `.chat` embed
	 * preview, which can render during workspace restore before the agent inits.
	 */
	async readCheckpointHistory(threadId: string): Promise<CheckpointHistoryItem[]> {
		return this.chatManager.readCheckpointHistory(this.normalizeThreadId(threadId));
	}

	/**
	 * Persists the thinking duration (ms) for a finished turn onto the checkpoint's
	 * final AI message, so the "Thought for Ns" label survives reload. Called from
	 * ChatSession after a run settles and the checkpoint graph has synced.
	 */
	async annotateThinkingDuration(threadId: string, checkpointId: string, durationMs: number): Promise<void> {
		await this.chatManager.annotateThinkingDuration(this.normalizeThreadId(threadId), checkpointId, durationMs);
	}

	async getCheckpointMessages(threadId: string, checkpointId: string): Promise<BaseMessage[]> {
		const agent = await this.ensureAgent();
		return agent.getCheckpointMessages(this.normalizeThreadId(threadId), checkpointId);
	}

	async getLatestCheckpointId(threadId: string): Promise<string | undefined> {
		const agent = await this.ensureAgent();
		return agent.getLatestCheckpointId(this.normalizeThreadId(threadId));
	}

	async getAllThreads(): Promise<ThreadSnapshot[]> {
		await this.chatManager.load();
		return this.chatManager.listThreads();
	}

	async deleteThread(threadId: string): Promise<void> {
		await this.chatManager.delete(this.normalizeThreadId(threadId));
	}

	/** Rename the chat thread's file to `title`. Returns the new vault path, or `undefined` on failure. */
	async renameThread(threadId: string, title: string): Promise<string | undefined> {
		return this.chatManager.renameChatFile(this.normalizeThreadId(threadId), title);
	}

	async setLastViewedCheckpoint(threadId: string, checkpointId: string): Promise<void> {
		const snapshot = await this.chatManager.read(this.normalizeThreadId(threadId), true);
		if (!snapshot) return;

		const currentLastViewed = snapshot.metadata?.lastViewedCheckpointId;
		if (currentLastViewed === checkpointId) {
			return;
		}

		const metadata = {
			...snapshot.metadata,
			lastViewedCheckpointId: checkpointId,
		};

		await this.chatManager.write({
			threadId: snapshot.threadId,
			title: snapshot.title,
			metadata,
			createdAt: snapshot.createdAt,
			updatedAt: snapshot.updatedAt,
		});
	}

	/**
	 * Generate a title for a thread using only the user's first message.
	 * This can run in parallel with streaming since it doesn't need the AI response.
	 */
	async generateThreadTitleFromUserMessage(
		threadId: string,
		agentId: string,
		userMessage: string,
	): Promise<string | undefined> {
		let resolved: ResolvedRun;
		let agent: Agent;
		try {
			({ agent, resolved } = await this.prepareAgentForStream(agentId));
		} catch (e) {
			Logger.warn("Agent not ready, cannot generate title", e);
			return undefined;
		}

		try {
			const title = await agent.generateTitle(userMessage, resolved);
			if (title) {
				Logger.log(`Generated title for thread ${threadId}: "${title}"`);
				return await this.chatManager.renameChatFile(threadId, title);
			}
		} catch (error) {
			Logger.error(`Error generating title for thread ${threadId}:`, error);
		}
		return undefined;
	}

	/**
	 * Reinitialize the agent with updated settings.
	 * Call this when tool configuration or MCP servers change.
	 */
	async reinitialize(): Promise<void> {
		Logger.log("Reinitializing agent with updated settings...");
		// Settings changed — we need a fresh pass, not a shared in-flight one that
		// may have started with stale settings. Wait for any current init to
		// settle, then run a guaranteed-fresh initialize().
		if (this.initPromise) {
			await this.initPromise.catch(() => {});
		}
		await this.initialize();
		Logger.log("Agent reinitialized successfully");
	}

	async cleanup(): Promise<void> {
		await this.chatManager.flush();

		// Release the MCP global-fetch patch (ref-counted; restores the original
		// fetch when the last holder releases).
		this.mcpFetchPatch?.release();
		this.mcpFetchPatch = null;

		// Cleanup if needed
		this.agent = null;
	}

	private async openInChatLeaf(file: TFile) {
		const location = getData().chatOpenLocation;
		const workspace = this.plugin.app.workspace;
		let leaf;
		if (location === "left" || location === "right") {
			const targetSplit = location === "left" ? workspace.leftSplit : workspace.rightSplit;
			leaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT).find((l) => l.getRoot() === targetSplit);
			if (!leaf) {
				leaf = location === "left" ? workspace.getLeftLeaf(false) : workspace.getRightLeaf(false);
			}
		} else {
			leaf = workspace.getLeaf("tab");
		}
		if (!leaf) return;
		await leaf.openFile(file);
		workspace.revealLeaf(leaf);
	}

	/** Open (and reveal) the chat leaf for a given thread path. Used to navigate
	 * to a backgrounded running chat from the busy hint and status-bar indicator. */
	async openChatByThreadId(threadId: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(threadId);
		if (file instanceof TFile) {
			await this.openInChatLeaf(file);
		}
	}

	async createNewChat(): Promise<string | null> {
		const now = Date.now();

		const data = getData();
		const folder = data.targetFolder;

		// Every new chat starts on the default agent. Each session captures its own
		// selectedAgentId at creation, so no agent rebuild is needed here.
		if (data.selectedAgentId !== data.defaultAgentId) {
			data.selectedAgentId = data.defaultAgentId;
		}

		// Only ever keep one unsubmitted "New Chat" around: if an empty new chat
		// already exists, reopen it instead of creating another.
		const existingNewChat = await this.chatManager.findEmptyNewChatThread();
		if (existingNewChat) {
			const existingFile = this.plugin.app.vault.getAbstractFileByPath(existingNewChat);
			if (existingFile instanceof TFile) {
				await this.openInChatLeaf(existingFile);
				return existingNewChat;
			}
		}

		// Ensure folder exists
		if (!(await this.plugin.app.vault.adapter.exists(folder))) {
			await this.plugin.app.vault.createFolder(folder);
		}

		const { path } = await this.chatManager.getUniqueTitlePath(folder, "New Chat", "");

		const initialData = {
			threadId: path,
			createdAt: now,
			updatedAt: now,
			checkpoints: {},
			writes: {},
		};

		const compressed = gzipSync(JSON.stringify(initialData));
		await this.plugin.app.vault.adapter.writeBinary(
			path,
			compressed.buffer.slice(
				compressed.byteOffset,
				compressed.byteOffset + compressed.byteLength,
			) as ArrayBuffer,
		);

		this.chatManager.registerNewThread(path);

		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.openInChatLeaf(file);
		}
		return path;
	}

	async getAttachmentDirectory(): Promise<string> {
		return this.chatManager.getAttachmentDirectory();
	}

	async openLatestChat(): Promise<void> {
		const threads = await this.chatManager.listThreads();

		if (threads.length === 0) {
			await this.createNewChat();
			return;
		}

		const latestThread = threads[0];
		const file = this.plugin.app.vault.getAbstractFileByPath(latestThread.threadId);

		if (file && file instanceof TFile) {
			await this.openInChatLeaf(file);
		} else {
			await this.createNewChat();
		}
	}
}
