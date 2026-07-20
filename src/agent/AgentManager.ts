import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Notice, normalizePath, TFile } from "obsidian";
import { createObsidianFetch } from "../lib/obsidianFetch";
import { invalidateProviderState } from "../lib/query";
import type SecondBrainPlugin from "../main";
import type { ChatModel } from "../stores/chatStore.svelte";
import { READ_CONTENT_GUIDANCE_DEFAULTS, getData, getReadContentGuidance } from "../stores/dataStore.svelte";
import { VAULT_TOOL_IDS, WEB_TOOL_IDS, type BuiltInToolId, type AgentConfig } from "../types/plugin";
import { VIEW_TYPE_CHAT } from "../views/chat/Chat";
import { lookupModelInfo } from "../providers/modelsDevApi";
import { fetchOllamaModelsInfo } from "../providers/ollamaModels";
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
import { StartupProfiler } from "../utils/startupProfiler";
import {
	Agent,
	NATIVE_PDF_PROVIDERS,
	type AgentStreamChunk,
	type CheckpointHistoryItem,
	type ChooseModelParams,
	type SubAgentSpec,
	type ThreadHistory,
} from "./Agent";
import { ObsidianChatManager } from "./ObsidianChatManager";
import type { ThreadSnapshot } from "./memory/ThreadStore";
import { BASE_SYSTEM_PROMPT } from "./prompts";
import { LangSmithTelemetry, type Telemetry } from "./telemetry";
import { createExecuteJavaScriptTool } from "./tools/executeJavaScript";
import { createPluginApiExecTool } from "./tools/executePluginApi";
import { createFetchUrlTool } from "./tools/fetchUrl";
import { createGetAllTagsTool } from "./tools/getAllTags";
import { createWebSearchTool } from "./tools/webSearch";
import { createGetPropertiesTool } from "./tools/getProperties";
import { createLoadSkillTool } from "./tools/loadSkill";
import { createListDirectoryTool } from "./tools/listDirectory";
import { createManageNotesTool } from "./tools/manageNotes";
import { createReadContentTool } from "./tools/readContent";
import { createSearchNotesTool } from "./tools/searchNotes";
import { setCurrentThreadId } from "./tools/runContext";
import {
	CURATED_PLUGIN_INTEGRATIONS,
	type PluginIntegration,
	pluginExposesApi,
	toExecToolId,
	toRuntimeToolName,
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

/**
 * Resolves the effective image/PDF processors for read_content.
 * - undefined: auto-derive from chat model (never explicitly configured)
 * - null: explicitly disabled by the user
 * - ChatModel: explicitly set by the user
 */
function resolveEffectiveProcessors(
	settings: { imageProcessor?: ChatModel | null; pdfProcessor?: ChatModel | null } | undefined,
	chatModel: ChatModel | null,
): { hasImageProcessor: boolean; hasPdfProcessor: boolean } {
	const imageProc = settings?.imageProcessor;
	const pdfProc = settings?.pdfProcessor;

	const chatModelSupportsVision = !!chatModel?.modelConfig?.supportsVision;
	const chatModelSupportsPdf = chatModelSupportsVision && !!chatModel && NATIVE_PDF_PROVIDERS.has(chatModel.provider);

	return {
		// undefined = auto-derive, null = explicitly off, ChatModel = explicitly set
		hasImageProcessor: imageProc !== undefined ? !!imageProc : chatModelSupportsVision,
		hasPdfProcessor: pdfProc !== undefined ? !!pdfProc : chatModelSupportsPdf,
	};
}

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

/**
 * Non-blocking variant of toChooseModelParams for use during initialization.
 * Uses cached vision support if available, otherwise defaults to false.
 * Vision support will be properly resolved before actual agent invocation
 * via the async toChooseModelParams in prepareAgentForStream().
 */
function toChooseModelParamsImmediate(model: ChatModel): ChooseModelParams {
	const options = { ...model.modelConfig };
	const cacheKey = getVisionSupportCacheKey(model.provider, model.model);

	if (options.supportsVision !== undefined) {
		resolvedVisionSupportCache.set(cacheKey, options.supportsVision);
	} else {
		const cached = resolvedVisionSupportCache.get(cacheKey);
		options.supportsVision = cached ?? false;
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
		// @ts-ignore - Obsidian plugin API
		return Boolean(this.plugin.app.plugins?.enabledPlugins?.has(pluginId));
	}

	/**
	 * Check if an Obsidian core (internal) plugin is enabled.
	 * Uses undocumented internal API - may need updates with Obsidian changes.
	 * @param pluginId - Core plugin ID (e.g., "canvas", "bases")
	 */
	isInternalPluginEnabled(pluginId: string): boolean {
		// @ts-ignore - Obsidian internal plugin API (not in official types)
		const internalPlugins = this.plugin.app.internalPlugins;
		if (!internalPlugins) return false;

		// @ts-ignore - internal API
		const pluginById = internalPlugins.getPluginById?.(pluginId);
		if (pluginById) {
			// @ts-ignore - internal API
			return Boolean(pluginById.enabled);
		}

		// @ts-ignore - internal API
		return Boolean(internalPlugins.plugins?.[pluginId]?.enabled);
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

		let prompt = selectedAgent.systemPrompt || BASE_SYSTEM_PROMPT;
		const enabledTools = Object.entries(selectedAgent.toolsConfig).filter(([, config]) => config.enabled);
		const hasWriteTools = enabledTools.some(([toolId]) => toolId === "manage_notes");
		const toolGuidelines = enabledTools
			.map(([toolId, config]) => {
				let guidance = config.promptGuidance?.trim() ?? "";

				// Select the appropriate read_content guidance based on effective processors
				// (explicit config OR auto-derived from chat model). Only override if
				// guidance matches one of the 4 defaults (user hasn't customized it).
				if (toolId === "read_content" && guidance.length > 0) {
					const settings = config.settings as
						| { imageProcessor?: ChatModel | null; pdfProcessor?: ChatModel | null }
						| undefined;
					const { hasImageProcessor, hasPdfProcessor } = resolveEffectiveProcessors(
						settings,
						selectedAgent.chatModel,
					);

					if (READ_CONTENT_GUIDANCE_DEFAULTS.has(guidance)) {
						guidance = getReadContentGuidance(hasImageProcessor, hasPdfProcessor);
					}
				}

				return {
					toolId,
					name: config.name,
					guidance,
				};
			})
			.filter((tool) => tool.guidance.length > 0);

		if (hasWriteTools) {
			prompt +=
				"\n\n# Write Tool Guidelines\n- All write operations (create, update, delete, move) are staged for user approval. Never say a change has already been applied.\n- Modify only what the user asked for and preserve surrounding content.\n- Prefer batching related write operations so the user can review them together.\n- Prefer targeted edits over full rewrites unless a full rewrite is clearly necessary.";
		} else {
			prompt +=
				"\n\n# Capabilities\n- No write tools are currently enabled.\n- Do not claim you can modify notes.\n- If the user asks for edits, explain the change you would make instead.";
		}

		if (toolGuidelines.length > 0) {
			const guidelinesSection = toolGuidelines
				.map(
					(tool) =>
						`## ${tool.name}\n- Tool ID: \`${tool.toolId}\`\n- ${tool.guidance.split("\n").join("\n- ")}`,
				)
				.join("\n\n");
			prompt += `\n\n# Tool Guidelines\n${guidelinesSection}`;
		}

		// Per-plugin code-exec integrations the user has approved for this agent.
		const enabledIntegrations = this.resolvePluginIntegrations().filter(
			(integ) =>
				this.isPluginEnabled(integ.pluginId) &&
				(selectedAgent.pluginExecTools?.[toExecToolId(integ.pluginId)] ?? false),
		);
		if (enabledIntegrations.length > 0) {
			const integrationsSection = enabledIntegrations
				.map(
					(integ) =>
						`## ${integ.displayName}\n- Tool: \`${toRuntimeToolName(integ.pluginId)}\` runs JavaScript against this plugin's \`api\` on the main thread.\n- ${
							integ.skillId
								? `Load the "${integ.skillId}" skill first to learn the API's shape.`
								: `Introspect this plugin's \`api\` (e.g. \`return Object.keys(api)\`) before calling it.`
						}\n- Not sandboxed and awaited work times out — keep snippets simple and prefer read-only calls unless the user asked to modify data.`,
				)
				.join("\n\n");
			prompt += `\n\n# Plugin Integrations\nYou can script these installed plugins via their public API:\n\n${integrationsSection}`;
		}

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
	 * Updates the agent's system prompt by reassembling from current settings.
	 * Call this after changing base prompt or skills.
	 */
	async updateSystemPrompt(): Promise<void> {
		const assembledPrompt = await this.assembleSystemPrompt();
		this.agent?.setPrompt(assembledPrompt);
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

	private bindBuiltInTools(agent: Agent): StructuredToolInterface[] {
		const data = getData();
		const selectedAgent = data.getSelectedAgent();
		const tools = this.buildToolsForAgent(selectedAgent);
		agent.bindTools(tools);
		agent.bindSubAgents(this.resolveSubAgentSpecs(selectedAgent));
		return tools;
	}

	/**
	 * Builds the built-in tool instances for a given agent config, gated by that
	 * agent's `toolsConfig`. Shared between the main agent (bindBuiltInTools) and
	 * subagent resolution (resolveSubAgentSpecs), so a referenced subagent gets
	 * its own tool set rather than inheriting the parent's.
	 */
	private buildToolsForAgent(agentCfg: AgentConfig): StructuredToolInterface[] {
		const tools: StructuredToolInterface[] = [];

		// Helper to check if tool is enabled for this agent
		const isToolEnabled = (toolId: BuiltInToolId): boolean => {
			return agentCfg.toolsConfig[toolId]?.enabled ?? true;
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
			["manage_notes", () => createManageNotesTool(this.plugin.app)],
			["fetch_url", () => createFetchUrlTool()],
			["web_search", () => createWebSearchTool()],
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
	 * Count the capabilities switched on for an agent, using the "one capability card =
	 * one capability" model the agent editor renders:
	 *   - the Core · Vault exploration card counts as 1 when any built-in tool is enabled;
	 *   - each core / community / auto-discovered plugin card counts as 1 when its skill
	 *     (or, for an uncurated auto-discovered plugin, its exec tool) is enabled and the
	 *     linked plugin is available;
	 *   - each user-authored custom skill and each enabled MCP server counts as 1.
	 *
	 * This is the single source of truth for the count shown in both the editor's rail
	 * badge and the agents-list summary, so the two never drift.
	 */
	countEnabledCapabilities(agentId: string): number {
		const agent = getData().agents[agentId];
		if (!agent) return 0;

		// Core card: any vault-exploration tool on.
		const anyVaultToolOn = VAULT_TOOL_IDS.some((toolId) => agent.toolsConfig[toolId]?.enabled ?? true);
		// Web card (separate capability): any web tool on.
		const anyWebToolOn = WEB_TOOL_IDS.some((toolId) => agent.toolsConfig[toolId]?.enabled ?? true);
		const skillsService = this.plugin.skillsService;
		const cachedSkills = skillsService?.isDiscovered() ? skillsService.getCachedSkills() : new Map();

		const skillEnabled = (skillId: string) => agent.skills[skillId]?.enabled ?? true;
		const skillAvailable = (metadata: { corePluginId?: string; linkedPluginId?: string }) => {
			if (metadata.corePluginId) return this.isInternalPluginEnabled(metadata.corePluginId);
			if (metadata.linkedPluginId) return this.isPluginEnabled(metadata.linkedPluginId);
			return true;
		};

		let count = anyVaultToolOn ? 1 : 0;
		if (anyWebToolOn) count++;

		// Plugin / community cards: enabled + available skills, excluding user-authored
		// custom skills.
		const coveredPluginIds = new Set<string>();
		for (const [skillId, metadata] of cachedSkills) {
			if (metadata.linkedPluginId) coveredPluginIds.add(metadata.linkedPluginId);
			if (metadata.category === "custom") continue;
			if (skillEnabled(skillId) && skillAvailable(metadata)) count++;
		}

		// Auto-discovered plugin cards: an api-plugin with no skill covering it yet counts
		// when its exec tool is enabled (enabling it in the editor also generates a skill).
		for (const integ of this.resolvePluginIntegrations()) {
			if (integ.skillId) continue;
			if (coveredPluginIds.has(integ.pluginId)) continue;
			if (agent.pluginExecTools?.[toExecToolId(integ.pluginId)] ?? false) count++;
		}

		// Custom skills.
		for (const [skillId, metadata] of cachedSkills) {
			if (metadata.category === "custom" && skillEnabled(skillId)) count++;
		}

		// MCP servers.
		count += Object.values(agent.mcpServers).filter((server) => server.enabled).length;

		return count;
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
				const promptHint = (ref.systemPrompt || "").trim().replace(/\s+/g, " ").slice(0, 160);
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
					systemPrompt: ref.systemPrompt || BASE_SYSTEM_PROMPT,
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
	): Promise<void> {
		if (!mcpServers || Object.keys(mcpServers).length === 0) return;

		try {
			const mcpConfig = { mcpServers } as ConstructorParameters<typeof MultiServerMCPClient>[0];
			Logger.log("Initializing MCP client...", mcpConfig);

			const globalWithFetch = globalThis as typeof globalThis & { _originalFetch?: typeof fetch };
			if (!globalWithFetch._originalFetch) {
				globalWithFetch._originalFetch = globalThis.fetch;
				globalThis.fetch = createObsidianFetch(globalWithFetch._originalFetch);
			}

			try {
				const mcpClient = new MultiServerMCPClient(mcpConfig);
				const mcpTools = await mcpClient.getTools();
				Logger.log(`Loaded ${mcpTools.length} MCP tools`);
				tools.push(...mcpTools);
			} catch (e) {
				Logger.error("Failed to get MCP tools", e);
			}
		} catch (error) {
			Logger.error("Failed to load MCP tools", error);
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
		// Load chats
		await StartupProfiler.measure("agent:chatManager.load", () => this.chatManager.load());

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

		// Set assembled prompt (base + enabled skills)
		this.agent.setPrompt(await this.assembleSystemPrompt());

		const chatModel = selectedAgent.chatModel;
		if (chatModel) {
			try {
				const summarizationModel = resolveSummarizationChatModel(chatModel, selectedAgent.summarizationModel);
				const titleModel = resolveTitleChatModel(chatModel, selectedAgent.titleModel);
				await this.agent.chooseModel({
					...toChooseModelParamsImmediate(chatModel),
					summarizationModel: toChooseModelParamsImmediate(summarizationModel),
					titleModel: toChooseModelParamsImmediate(titleModel),
				});
			} catch (error) {
				if (error instanceof ProviderNotFoundError) {
					Logger.warn(
						`[AgentManager] Provider "${chatModel.provider}" not registered, skipping model selection`,
					);
				} else {
					throw error;
				}
			}
		}

		// Bind built-in tools synchronously
		const tools = this.bindBuiltInTools(this.agent);

		// Start deferred network operations (vision resolution + MCP tools) in background
		this.deferredSetup = this.performDeferredSetup(this.agent, chatModel ?? undefined, tools);

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
	 * - Loads MCP tools from configured MCP servers
	 * These are awaited before the first agent invocation via awaitDeferredSetup().
	 */
	private async performDeferredSetup(
		agent: Agent,
		chatModel: ChatModel | undefined,
		tools: StructuredToolInterface[],
	): Promise<void> {
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

		// Deferred: load MCP tools and rebind
		const data = getData();
		const selectedAgent = data.getSelectedAgent();
		const mcpServers = data.getAgentMCPServersForClient(selectedAgent.id);
		if (mcpServers && Object.keys(mcpServers).length > 0) {
			promises.push(
				this.loadMCPTools(tools, mcpServers).then(() => {
					agent.bindTools(tools);
				}),
			);
		}

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

	private async prepareAgentForStream(): Promise<{
		agent: Agent;
		chatModel: ChatModel;
		runMetadata: Record<string, unknown>;
	}> {
		const agent = await this.ensureAgent();
		await this.awaitDeferredSetup();
		const pluginData = getData();
		const selectedAgent = pluginData.getSelectedAgent();
		const chatModel = selectedAgent.chatModel;
		if (!chatModel) throw new Error("No chat model configured");
		const summarizationModel = resolveSummarizationChatModel(chatModel, selectedAgent.summarizationModel);
		const titleModel = resolveTitleChatModel(chatModel, selectedAgent.titleModel);
		await agent.chooseModel({
			...(await toChooseModelParams(chatModel)),
			summarizationModel: await toChooseModelParams(summarizationModel),
			titleModel: await toChooseModelParams(titleModel),
		});
		const runMetadata = this.buildRunMetadata(selectedAgent.id, selectedAgent.name, chatModel);
		return { agent, chatModel, runMetadata };
	}

	async *streamQuery(
		query: string,
		threadId = "default-thread",
		checkpointId?: string,
		signal?: AbortSignal,
		attachments?: ChatAttachment[],
		visibleNotes?: VisibleNoteRef[],
		selection?: SelectionRef,
		graphNotes?: GraphNoteRef[],
		lcSource?: string,
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		const resolvedThreadId = this.normalizeThreadId(threadId);
		setCurrentThreadId(resolvedThreadId);
		try {
			const { agent, chatModel, runMetadata } = await this.prepareAgentForStream();

			yield* this.dispatchStream(
				agent.streamTokens({
					query,
					threadId: resolvedThreadId,
					metadata: runMetadata,
					configurable: checkpointId ? { checkpoint_id: checkpointId } : undefined,
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
		} finally {
			setCurrentThreadId(null);
		}
	}

	/**
	 * Edit a message by forking from a checkpoint with a new user message.
	 * This creates a new branch from the given checkpoint.
	 */
	async *editFromCheckpoint(
		query: string,
		threadId: string,
		checkpointId: string,
		signal?: AbortSignal,
		attachments?: ChatAttachment[],
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		const resolvedThreadId = this.normalizeThreadId(threadId);
		setCurrentThreadId(resolvedThreadId);
		try {
			const { agent, chatModel, runMetadata } = await this.prepareAgentForStream();

			yield* this.dispatchStream(
				agent.editFromCheckpoint({
					query,
					threadId: resolvedThreadId,
					checkpointId,
					metadata: runMetadata,
					signal,
					attachments,
				} as Parameters<Agent["editFromCheckpoint"]>[0]),
				signal,
				chatModel,
				"Error editing message",
			);
		} finally {
			setCurrentThreadId(null);
		}
	}

	/**
	 * Regenerate an AI response from a checkpoint without adding a new user message.
	 * This creates a new branch from the given checkpoint.
	 */
	async *regenerateFromCheckpoint(
		threadId: string,
		checkpointId: string,
		signal?: AbortSignal,
	): AsyncGenerator<AgentManagerStreamChunk, void, unknown> {
		const resolvedThreadId = this.normalizeThreadId(threadId);
		setCurrentThreadId(resolvedThreadId);
		try {
			const { agent, chatModel, runMetadata } = await this.prepareAgentForStream();

			yield* this.dispatchStream(
				agent.regenerateFromCheckpoint({
					threadId: resolvedThreadId,
					checkpointId,
					metadata: runMetadata,
					signal,
				}),
				signal,
				chatModel,
				"Error regenerating response",
			);
		} finally {
			setCurrentThreadId(null);
		}
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
	async generateThreadTitleFromUserMessage(threadId: string, userMessage: string): Promise<string | undefined> {
		const agent = await this.ensureAgent().catch((e) => {
			Logger.warn("Agent not initialized, cannot generate title");
			return null;
		});

		if (!agent) return undefined;

		try {
			const title = await agent.generateTitle(userMessage);
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
		await this.initialize();
		Logger.log("Agent reinitialized successfully");
	}

	async cleanup(): Promise<void> {
		await this.chatManager.flush();

		// Restore original fetch if it was patched
		const globalWithFetch = globalThis as typeof globalThis & { _originalFetch?: typeof fetch };
		if (globalWithFetch._originalFetch) {
			globalThis.fetch = globalWithFetch._originalFetch;
			globalWithFetch._originalFetch = undefined;
		}

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
			leaf = workspace.getLeaf(false);
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

	async createNewChat(): Promise<void> {
		const now = Date.now();

		const data = getData();
		const folder = data.targetFolder;

		// Reset to default agent if one is set
		if (data.defaultAgentId && data.selectedAgentId !== data.defaultAgentId) {
			data.selectedAgentId = data.defaultAgentId;
			await this.reinitialize();
		}

		// Only ever keep one unsubmitted "New Chat" around: if an empty new chat
		// already exists, reopen it instead of creating another.
		const existingNewChat = await this.chatManager.findEmptyNewChatThread();
		if (existingNewChat) {
			const existingFile = this.plugin.app.vault.getAbstractFileByPath(existingNewChat);
			if (existingFile instanceof TFile) {
				await this.openInChatLeaf(existingFile);
				return;
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
	}

	async getAttachmentDirectory(): Promise<string> {
		return this.chatManager.getAttachmentDirectory();
	}

	async exportChatAsJson(threadId: string): Promise<void> {
		await this.chatManager.exportThreadAsJson(threadId);
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
