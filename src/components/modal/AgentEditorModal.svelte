<script lang="ts">
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { Notice, getIconIds, type Modal } from "obsidian";
import { onMount } from "svelte";
import { AddSkillModal } from "./AddSkillModal";
import { MCPServerModal } from "./MCPServerModal";
import { ModelSelectionModal } from "./ModelSelectionModal";
import { SkillModal } from "./SkillModal";
import { SystemPromptModal } from "./SystemPromptModal";
import { ToolConfigModal } from "./ToolConfigModal";
import ManagedEntityItem from "../settings/ManagedEntityItem.svelte";
import ModelSettingControl from "../settings/ModelSettingControl.svelte";
import SettingGroup from "../settings/SettingGroup.svelte";
import SettingItem from "../settings/SettingItem.svelte";
import Badge from "../ui/Badge.svelte";
import Button from "../ui/Button.svelte";
import CapabilityCard from "../ui/CapabilityCard.svelte";
import Icon from "../ui/Icon.svelte";
import PickerOptionRow from "../ui/PickerOptionRow.svelte";
import PickerPopover from "../ui/PickerPopover.svelte";
import Search from "../ui/Search.svelte";
import SlidingTabs from "../ui/SlidingTabs.svelte";
import Text from "../ui/Text.svelte";
import Toggle from "../ui/Toggle.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import { createObsidianFetch } from "../../lib/obsidianFetch";
import type SecondBrainPlugin from "../../main";
import { type PluginIntegration, getPluginIcon, toExecToolId } from "../../agent/integrations/pluginIntegrations";
import { buildPluginApiSkill } from "../../skills/templates/pluginApiScripting";
import {
	DEFAULT_AGENT_ICON,
	VAULT_TOOL_IDS,
	WEB_TOOL_IDS,
	type AgentConfig,
	type BuiltInToolId,
	type MCPServerConfig,
	type SkillDisplayInfo,
} from "../../types/plugin";
import { getProviderDefinition } from "../../providers/index";
import type { ChatModel } from "../../stores/chatStore.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { Logger } from "../../utils/logging";

interface Props {
	modal: Modal;
	plugin: SecondBrainPlugin;
	agentId: string;
}

let { modal, plugin, agentId }: Props = $props();

const pluginData = getData();
const models = useAvailableModels();

const POPULAR_AGENT_ICONS = [
	"bot",
	"brain",
	"sparkles",
	"search",
	"book-open",
	"briefcase",
	"messages-square",
	"lightbulb",
	"compass",
	"folders",
	"file-text",
	"workflow",
] as const;

const AGENT_PICTOGRAM_OPTIONS = ["🤖", "🧠", "📚", "💡", "🧭", "🛠️"] as const;

const BUILT_IN_AGENT_ICONS = getIconIds()
	.slice()
	.sort((left, right) => left.localeCompare(right));

let agents = $derived(pluginData.agents);
let selectedAgent = $derived(agents[agentId]);
let agentIconQuery = $state("");
let isAgentIconPickerOpen = $state(false);

type SectionId = "general" | "capabilities" | "subagents";

let activeSection = $state<SectionId>("general");

interface SectionDef {
	id: SectionId;
	label: string;
	icon: string;
}

const SECTIONS: SectionDef[] = [
	{ id: "general", label: "General", icon: "sliders-horizontal" },
	{ id: "capabilities", label: "Capabilities", icon: "blocks" },
	{ id: "subagents", label: "Subagents", icon: "git-branch" },
];

async function applyChanges() {
	try {
		await plugin.agentManager.reinitialize();
	} catch (error) {
		Logger.error("Failed to reinitialize agent:", error);
	}
}

function updateAgentName(name: string) {
	pluginData.updateAgent(agentId, { name });
	modal.setTitle(`Edit Agent: ${name || "Untitled"}`);
}

function updateAgentIcon(icon: string) {
	const nextIcon = icon.trim() || DEFAULT_AGENT_ICON;
	pluginData.updateAgent(agentId, { icon: nextIcon });
}

const selectedAgentIcon = $derived(selectedAgent?.icon?.trim() || DEFAULT_AGENT_ICON);

const matchingAgentIcons = $derived.by(() => {
	const query = agentIconQuery.trim().toLowerCase();
	if (!query) {
		return Array.from(POPULAR_AGENT_ICONS);
	}

	return BUILT_IN_AGENT_ICONS.filter((iconName) => iconName.toLowerCase().includes(query)).slice(0, 72);
});

const matchingAgentIconCount = $derived.by(() => {
	const query = agentIconQuery.trim().toLowerCase();
	if (!query) {
		return POPULAR_AGENT_ICONS.length;
	}

	return BUILT_IN_AGENT_ICONS.reduce((count, iconName) => {
		return iconName.toLowerCase().includes(query) ? count + 1 : count;
	}, 0);
});

const currentModelDisplay = $derived.by(() => {
	if (!selectedAgent?.chatModel) return null;
	const providerDef = getProviderDefinition(selectedAgent.chatModel.provider, pluginData.getAllProviderMeta());
	return {
		model: selectedAgent.chatModel.model,
		logo: providerDef && "logo" in providerDef && providerDef.logo ? providerDef.logo : GenericAIIcon,
	};
});

const currentSummarizationModelDisplay = $derived.by(() => {
	if (!selectedAgent?.summarizationModel) return null;
	const providerDef = getProviderDefinition(
		selectedAgent.summarizationModel.provider,
		pluginData.getAllProviderMeta(),
	);
	return {
		model: selectedAgent.summarizationModel.model,
		logo: providerDef && "logo" in providerDef && providerDef.logo ? providerDef.logo : GenericAIIcon,
	};
});

const currentTitleModelDisplay = $derived.by(() => {
	if (!selectedAgent?.titleModel) return null;
	const providerDef = getProviderDefinition(selectedAgent.titleModel.provider, pluginData.getAllProviderMeta());
	return {
		model: selectedAgent.titleModel.model,
		logo: providerDef && "logo" in providerDef && providerDef.logo ? providerDef.logo : GenericAIIcon,
	};
});

function formatContextWindowLabel(tokens: number): string {
	if (tokens >= 1000) {
		const rounded = Number.isInteger(tokens / 1000) ? String(tokens / 1000) : (tokens / 1000).toFixed(1);
		return `${rounded}k`;
	}
	return `${tokens}`;
}

const summarizationContextWindowWarning = $derived.by(() => {
	const chatContextWindow = selectedAgent?.chatModel?.modelConfig?.contextWindow;
	const summarizationContextWindow = selectedAgent?.summarizationModel?.modelConfig?.contextWindow;
	if (!chatContextWindow || !summarizationContextWindow) return null;
	if (summarizationContextWindow >= chatContextWindow) return null;
	return `This summarization model has a smaller context window (${formatContextWindowLabel(summarizationContextWindow)}) than the chat model (${formatContextWindowLabel(chatContextWindow)}), so history compaction may fail earlier.`;
});

function buildPersistedChatModel(provider: string, model: string, existing?: ChatModel | null): ChatModel {
	const hydrated = models.hydratedChatModelsByKey.get(`${provider}:${model}`);
	return {
		provider,
		model,
		modelConfig: {
			contextWindow: hydrated?.contextWindow ?? existing?.modelConfig?.contextWindow ?? 128000,
			supportsVision: hydrated?.capabilities.vision ?? existing?.modelConfig?.supportsVision,
			temperature: existing?.modelConfig?.temperature,
		},
	};
}

function openModelSelectionModal() {
	const currentSelection = selectedAgent?.chatModel
		? { provider: selectedAgent.chatModel.provider, model: selectedAgent.chatModel.model }
		: null;
	new ModelSelectionModal(plugin, "chat", currentSelection, (selected) => {
		if (!selected) return;
		pluginData.updateAgent(agentId, {
			chatModel: buildPersistedChatModel(selected.provider, selected.model, selectedAgent?.chatModel),
		});
		void applyChanges();
	}).open();
}

function openSummarizationModelSelectionModal() {
	const currentSelection = selectedAgent?.summarizationModel
		? {
				provider: selectedAgent.summarizationModel.provider,
				model: selectedAgent.summarizationModel.model,
			}
		: null;
	new ModelSelectionModal(plugin, "chat", currentSelection, (selected) => {
		if (!selected) return;
		pluginData.updateAgent(agentId, {
			summarizationModel: buildPersistedChatModel(
				selected.provider,
				selected.model,
				selectedAgent?.summarizationModel,
			),
		});
		void applyChanges();
	}).open();
}

function resetSummarizationModel() {
	pluginData.updateAgent(agentId, { summarizationModel: null });
	void applyChanges();
}

function openTitleModelSelectionModal() {
	const currentSelection = selectedAgent?.titleModel
		? {
				provider: selectedAgent.titleModel.provider,
				model: selectedAgent.titleModel.model,
			}
		: null;
	new ModelSelectionModal(plugin, "chat", currentSelection, (selected) => {
		if (!selected) return;
		pluginData.updateAgent(agentId, {
			titleModel: buildPersistedChatModel(selected.provider, selected.model, selectedAgent?.titleModel),
		});
		void applyChanges();
	}).open();
}

function resetTitleModel() {
	pluginData.updateAgent(agentId, { titleModel: null });
	void applyChanges();
}

function openSystemPromptModal() {
	if (!selectedAgent) return;
	const promptModal = new SystemPromptModal(plugin, {
		getPrompt: () => selectedAgent?.systemPrompt ?? "",
		setPrompt: (prompt: string) => {
			pluginData.updateAgent(agentId, { systemPrompt: prompt });
			void applyChanges();
		},
		viewFinalPrompt: () => {
			promptModal.close();
			openRenderedSystemPromptModal();
		},
	});
	promptModal.open();
}

function openRenderedSystemPromptModal() {
	if (!selectedAgent) return;
	new SystemPromptModal(
		plugin,
		{ getPrompt: async () => plugin.agentManager.assembleSystemPrompt() },
		{
			title: "Final System Prompt",
			description:
				"Preview the fully assembled system prompt after dynamic tool guidance and skills are injected.",
			readOnly: true,
		},
	).open();
}

let skillsRefreshCounter = $state(0);

// Controls the "+ Add" dropdown on the Custom capabilities card.
let isAddCapabilityMenuOpen = $state(false);

const skills = $derived.by(() => {
	const _refresh = skillsRefreshCounter;
	const skillsService = plugin.skillsService;
	if (!skillsService?.isDiscovered()) return [];
	const cachedSkills = skillsService.getCachedSkills();
	const agentSkills = selectedAgent?.skills ?? {};
	const result: SkillDisplayInfo[] = [];
	for (const [skillName, metadata] of cachedSkills) {
		const displayName = metadata.frontmatter.metadata?.displayName ?? metadata.frontmatter.name;
		result.push({
			id: skillName,
			displayName,
			description: metadata.frontmatter.description,
			enabled: agentSkills[skillName]?.enabled ?? true,
			category: metadata.category ?? "custom",
			corePluginId: metadata.corePluginId,
			linkedPluginId: metadata.linkedPluginId,
		});
	}
	return result;
});

const coreSkills = $derived(skills.filter((skill) => skill.category === "core"));
// Community-plugin skills are only shown when their linked plugin is actually installed
// in this vault. A skill for an uninstalled plugin has no working exec tool and nothing
// the user can act on, so it is hidden entirely (installed-but-disabled still shows,
// with a "Not enabled" affordance).
const pluginSkills = $derived(skills.filter((skill) => skill.category === "plugin" && isSkillPluginInstalled(skill)));
const customSkills = $derived(skills.filter((skill) => skill.category === "custom"));

async function refreshSkillsList() {
	await plugin.skillsService?.discoverSkills();
	skillsRefreshCounter++;
}

onMount(() => {
	modal.setTitle(`Edit Agent: ${selectedAgent?.name ?? "Agent"}`);
	void refreshSkillsList();

	// A plugin installed/enabled in Obsidian's settings while this modal is open won't
	// show up until we re-resolve integrations (resolvePluginIntegrations reads live
	// app.plugins state, not a Svelte signal). Obsidian's community-plugin manager emits
	// an untyped "changed" event on install/enable/disable — subscribe to it so new
	// api-plugins auto-discover here immediately, not only after an Obsidian reload.
	const refresh = () => {
		void refreshSkillsList();
	};
	// @ts-ignore - app.plugins is not in the official Obsidian types
	const pluginManager = plugin.app.plugins as
		| { on?: (name: string, cb: () => void) => unknown; offref?: (ref: unknown) => void }
		| undefined;
	const changeRef = pluginManager?.on?.("changed", refresh);
	// Fallback for returning from an external window; harmless duplicate refresh otherwise.
	window.addEventListener("focus", refresh);
	return () => {
		if (changeRef) pluginManager?.offref?.(changeRef);
		window.removeEventListener("focus", refresh);
	};
});

function openSkillModal(skillId: string) {
	new SkillModal(plugin, skillId, () => {
		void refreshSkillsList();
		void applyChanges();
	}).open();
}

function openAddSkillModal() {
	new AddSkillModal(plugin, agentId, async () => {
		await refreshSkillsList();
		await applyChanges();
	}).open();
}

function isPluginInstalled(pluginId: string): boolean {
	return plugin.agentManager?.isPluginInstalled(pluginId) ?? false;
}

function isPluginEnabled(pluginId: string): boolean {
	return plugin.agentManager?.isPluginEnabled(pluginId) ?? false;
}

function isInternalPluginEnabled(pluginId: string): boolean {
	const checker = plugin.agentManager?.isInternalPluginEnabled;
	return typeof checker === "function" ? checker.call(plugin.agentManager, pluginId) : false;
}

function isSkillPluginAvailable(skill: SkillDisplayInfo): boolean {
	if (skill.corePluginId) return isInternalPluginEnabled(skill.corePluginId);
	if (skill.linkedPluginId) return isPluginEnabled(skill.linkedPluginId);
	return true;
}

function isSkillPluginInstalled(skill: SkillDisplayInfo): boolean {
	if (skill.corePluginId) return true;
	if (skill.linkedPluginId) return isPluginInstalled(skill.linkedPluginId);
	return true;
}

function toggleSkill(skillId: string, newEnabled: boolean) {
	const skill = skills.find((entry) => entry.id === skillId);
	if (!skill) return;
	if (skill.category !== "custom") {
		const linkedPlugin = plugin.skillsService?.getCachedSkills().get(skillId)?.linkedPluginId;
		if (linkedPlugin) {
			if (!plugin.agentManager?.isPluginInstalled(linkedPlugin)) {
				new Notice(`Please install the ${skill.displayName} plugin first.`);
				return;
			}
			if (!plugin.agentManager?.isPluginEnabled(linkedPlugin)) {
				new Notice(`Please enable the ${skill.displayName} plugin in Obsidian settings first.`);
				return;
			}
		}
	}
	pluginData.setAgentSkillEnabled(agentId, skillId, newEnabled);
	// Bundle code-exec with the skill: if the linked plugin exposes a callable `.api`,
	// enabling the skill also grants API scripting, and disabling revokes it.
	const integration = skillExecIntegration(skill);
	if (integration) {
		pluginData.setAgentPluginExecEnabled(agentId, toExecToolId(integration.pluginId), newEnabled);
	}
	void applyChanges();
}

async function deleteSkill(skillId: string) {
	const skill = skills.find((entry) => entry.id === skillId);
	if (!skill || skill.category !== "custom") return;
	await plugin.skillsService?.deleteSkill(skillId);
	await refreshSkillsList();
	await applyChanges();
}

function openPluginPage(pluginId: string) {
	window.open(`obsidian://show-plugin?id=${pluginId}`);
}

// --- Per-plugin code-exec integrations (bundled with the linked skill's toggle) ---

// Map of pluginId → integration, for plugins that currently expose a callable `.api`.
// A plugin skill whose linkedPluginId is present here gains code-exec scripting when
// the skill is enabled (see toggleSkill), so the two capabilities share one switch.
const execIntegrationsByPlugin = $derived.by<Map<string, PluginIntegration>>(() => {
	// resolvePluginIntegrations() reads live app.plugins state, which is not a Svelte
	// signal — depend on skillsRefreshCounter so newly installed/enabled plugins get
	// picked up when we refresh (e.g. on window focus after returning from Obsidian's
	// plugin settings), not only after a full modal recreation / Obsidian reload.
	const _refresh = skillsRefreshCounter;
	const resolved = plugin.agentManager?.resolvePluginIntegrations() ?? [];
	return new Map(resolved.map((integ) => [integ.pluginId, integ]));
});

function skillExecIntegration(skill: SkillDisplayInfo): PluginIntegration | undefined {
	if (!skill.linkedPluginId) return undefined;
	return execIntegrationsByPlugin.get(skill.linkedPluginId);
}

// Auto-discovered api-plugins that have NO skill covering them yet. These render as
// inline rows in the Plugin Skills list. Enabling one generates a plugin-specific
// "API scripting" skill (seeded from a template) linked to it, then enables that skill
// plus its own exec_<plugin> tool — after which the plugin renders as a normal curated
// Plugin Skills row (editable/deletable) and drops out of this list.
interface AutoIntegrationDisplay {
	pluginId: string;
	displayName: string;
	execEnabled: boolean;
}

const autoDiscoveredIntegrations = $derived.by<AutoIntegrationDisplay[]>(() => {
	const execState = selectedAgent?.pluginExecTools ?? {};
	// A plugin is "covered" by a skill if any discovered skill links to it.
	const coveredPluginIds = new Set(
		skills.map((skill) => skill.linkedPluginId).filter((id): id is string => Boolean(id)),
	);
	const result: AutoIntegrationDisplay[] = [];
	for (const integ of execIntegrationsByPlugin.values()) {
		if (integ.skillId) continue; // curated + documented → shown as its own skill row
		if (coveredPluginIds.has(integ.pluginId)) continue; // a skill already covers it
		result.push({
			pluginId: integ.pluginId,
			displayName: integ.displayName,
			execEnabled: execState[toExecToolId(integ.pluginId)] ?? false,
		});
	}
	return result;
});

async function toggleAutoIntegration(pluginId: string, displayName: string, newEnabled: boolean) {
	if (newEnabled) {
		// Generate a plugin-specific skill from the template (unless one already links
		// to this plugin), then enable it alongside the exec tool. Re-discover so the
		// new skill enters the cache and the row re-renders as a curated Plugin Skill.
		let skillId = skills.find((skill) => skill.linkedPluginId === pluginId)?.id;
		if (!skillId) {
			const generated = buildPluginApiSkill(pluginId, displayName);
			const result = await plugin.skillsService?.saveSkill(generated);
			if (result && !result.valid) {
				new Notice(`Could not create skill for ${displayName}: ${result.errors[0]?.message ?? "invalid"}`);
				return;
			}
			await refreshSkillsList();
			skillId = generated.frontmatter.name;
		}
		pluginData.setAgentSkillEnabled(agentId, skillId, true);
		pluginData.setAgentPluginExecEnabled(agentId, toExecToolId(pluginId), true);
	} else {
		// Only revoke the exec tool; leave any generated skill file in place for reuse.
		pluginData.setAgentPluginExecEnabled(agentId, toExecToolId(pluginId), false);
	}
	void applyChanges();
}

function getMCPToolsBadgeLabel(serverId: string, toolsState?: MCPServerToolsState): string {
	if (toolsState?.loading) return "Loading tools";
	if (toolsState?.error) return "Tool load error";
	if (toolsState?.tools) return `${toolsState.tools.length} tools`;
	return "Load tools";
}

interface ToolInfo {
	id: BuiltInToolId;
	defaultName: string;
	defaultDescription: string;
	requiresPlugin?: { id: string; name: string };
}

const TOOLS: ToolInfo[] = [
	{
		id: "search_notes",
		defaultName: "Search Notes",
		defaultDescription: "Search through your Obsidian notes by keyword. Returns matching file names and metadata.",
	},
	{
		id: "list_directory",
		defaultName: "List Directory",
		defaultDescription:
			"List directories and files in the vault to understand folder structure before searching or editing notes.",
	},
	{
		id: "read_content",
		defaultName: "Read Content",
		defaultDescription:
			"Read notes and vault files by path or wiki link. Supports markdown/text files and PDF text extraction. Images must be attached in chat.",
	},
	{
		id: "get_all_tags",
		defaultName: "Get All Tags",
		defaultDescription: "Retrieve a list of all tags used in the vault.",
	},
	{
		id: "get_properties",
		defaultName: "Get Properties",
		defaultDescription: "Retrieve frontmatter properties from notes or list all property keys in the vault.",
	},
	{
		id: "execute_javascript",
		defaultName: "Execute JavaScript",
		defaultDescription:
			"Run isolated JavaScript for calculations and data transformation. Use return for the final value and console.log for intermediate output.",
	},
	{
		id: "manage_notes",
		defaultName: "Manage Notes",
		defaultDescription:
			"Create, update, or delete markdown notes in one staged batch. Related note operations can be proposed together for user approval.",
	},
	{
		id: "fetch_url",
		defaultName: "Fetch URL",
		defaultDescription:
			"Fetch a public web page or text resource over HTTP(S) and return its main content as cleaned markdown. Use only with URLs the user provided or clearly public references.",
	},
	{
		id: "web_search",
		defaultName: "Web Search",
		defaultDescription:
			"Search the web and return results (title, URL, snippet). Configure the provider and API key in the tool's Configure panel. Prefer vault search first.",
	},
];

function getToolDisplayName(toolId: BuiltInToolId): string {
	const config = selectedAgent?.toolsConfig[toolId];
	const defaultTool = TOOLS.find((tool) => tool.id === toolId);
	const name = config?.name ?? defaultTool?.defaultName ?? toolId;
	return name.includes("_")
		? name
				.split("_")
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join(" ")
		: name;
}

function getToolDescription(toolId: BuiltInToolId): string {
	const config = selectedAgent?.toolsConfig[toolId];
	const defaultTool = TOOLS.find((tool) => tool.id === toolId);
	return config?.description ?? defaultTool?.defaultDescription ?? "";
}

function handleToolToggle(toolId: BuiltInToolId) {
	pluginData.toggleAgentToolEnabled(agentId, toolId);
	void applyChanges();
}

function getToolEnabled(toolId: BuiltInToolId): boolean {
	return pluginData.isAgentToolEnabled(agentId, toolId);
}

// --- Core · Vault exploration + Web capability cards (bulk-toggle their built-in tools) ---

const vaultTools = $derived(TOOLS.filter((tool) => (VAULT_TOOL_IDS as readonly string[]).includes(tool.id)));
const webTools = $derived(TOOLS.filter((tool) => (WEB_TOOL_IDS as readonly string[]).includes(tool.id)));

// Each card's master is a plain on/off switch: OFF turns every tool in the card off; ON turns
// every (installable) tool in the card on. `checked` reflects "any tool in the card is on".
// Tools whose required plugin isn't installed can't be enabled, so they're excluded from the
// numerator and the "turn everything on" loop (otherwise the summary can't reach N of N).
function availableToolsIn(tools: ToolInfo[]): ToolInfo[] {
	return tools.filter((tool) => !tool.requiresPlugin || isPluginInstalled(tool.requiresPlugin.id));
}
function enabledCountIn(tools: ToolInfo[]): number {
	return availableToolsIn(tools).filter((tool) => getToolEnabled(tool.id)).length;
}
function toggleAllTools(tools: ToolInfo[], next: boolean) {
	for (const tool of availableToolsIn(tools)) {
		if (getToolEnabled(tool.id) !== next) {
			pluginData.toggleAgentToolEnabled(agentId, tool.id);
		}
	}
	void applyChanges();
}

const vaultAvailableCount = $derived(availableToolsIn(vaultTools).length);
const vaultEnabledCount = $derived(enabledCountIn(vaultTools));
const vaultAnyOn = $derived(vaultEnabledCount > 0);

const webAvailableCount = $derived(availableToolsIn(webTools).length);
const webEnabledCount = $derived(enabledCountIn(webTools));
const webAnyOn = $derived(webEnabledCount > 0);

// --- Subagents (references to other agents) ---

const subAgentIds = $derived(selectedAgent?.subAgentIds ?? []);

/**
 * Agents that can be enabled as subagents. Includes this agent itself (an
 * isolated-context copy is a valid delegation target); self is sorted first.
 */
const subAgentCandidates = $derived(
	Object.values(agents).sort((l, r) => {
		if (l.id === agentId) return -1;
		if (r.id === agentId) return 1;
		return l.name.localeCompare(r.name);
	}),
);

function isSubAgentEnabled(refId: string): boolean {
	return subAgentIds.includes(refId);
}

function handleSubAgentToggle(refId: string) {
	pluginData.toggleSubAgentRef(agentId, refId);
	void applyChanges();
}

function getSubAgentModelLabel(agent: AgentConfig): string {
	const model = agent.chatModel ? agent.chatModel.model : "No model configured";
	return agent.id === agentId ? `${model} · isolated copy of this agent` : model;
}

function openToolConfig(toolId: BuiltInToolId) {
	new ToolConfigModal(
		plugin,
		toolId,
		() => {
			void applyChanges();
		},
		{
			agentId,
			getToolConfig: () => selectedAgent?.toolsConfig[toolId],
			updateToolConfig: (config) => pluginData.updateAgentToolConfig(agentId, toolId, config),
		},
	).open();
}

let mcpServerIds = $derived(selectedAgent ? Object.keys(selectedAgent.mcpServers) : []);

interface MCPToolInfo {
	name: string;
	description?: string;
}

interface MCPServerToolsState {
	loading: boolean;
	error: string | null;
	tools: MCPToolInfo[];
}

let mcpServerTools = $state<Record<string, MCPServerToolsState>>({});
let expandedServerId = $state<string | null>(null);

function openAddMCPServer() {
	new MCPServerModal(
		plugin,
		null,
		null,
		(serverId: string, config: MCPServerConfig) => {
			pluginData.setAgentMCPServer(agentId, serverId, config);
			void applyChanges();
		},
		{ hasServer: (serverId: string) => Boolean(selectedAgent?.mcpServers[serverId]) },
	).open();
}

function openEditMCPServer(serverId: string) {
	const config = selectedAgent?.mcpServers[serverId];
	if (!config) return;
	new MCPServerModal(
		plugin,
		serverId,
		config,
		(newServerId: string, updatedConfig: MCPServerConfig) => {
			if (newServerId !== serverId) {
				pluginData.deleteAgentMCPServer(agentId, serverId);
			}
			if (!updatedConfig.enabled && newServerId === serverId) {
				pluginData.deleteAgentMCPServer(agentId, serverId);
			} else {
				pluginData.setAgentMCPServer(agentId, newServerId, updatedConfig);
			}
			void applyChanges();
		},
		{ hasServer: (candidateId: string) => Boolean(selectedAgent?.mcpServers[candidateId]) },
	).open();
}

function toggleMCPServer(serverId: string) {
	pluginData.toggleAgentMCPServerEnabled(agentId, serverId);
	void applyChanges();
}

function buildMCPConfig(serverId: string, config: MCPServerConfig) {
	if (config.transport === "stdio") {
		return {
			mcpServers: {
				[serverId]: {
					transport: "stdio" as const,
					command: config.command,
					args: config.args,
					env: config.env,
				},
			},
		};
	}
	return {
		mcpServers: {
			[serverId]: { transport: "http" as const, url: config.url, headers: config.headers },
		},
	};
}

async function fetchServerTools(serverId: string) {
	const config = selectedAgent?.mcpServers[serverId];
	if (!config) return;
	mcpServerTools[serverId] = { loading: true, error: null, tools: [] };
	try {
		const windowWithFetch = window as Window & { _originalFetch?: typeof fetch };
		const needsPatch = !windowWithFetch._originalFetch;
		if (needsPatch) {
			windowWithFetch._originalFetch = window.fetch;
			window.fetch = createObsidianFetch(windowWithFetch._originalFetch);
		}
		try {
			const mcpClient = new MultiServerMCPClient(buildMCPConfig(serverId, config));
			const tools = await mcpClient.getTools();
			mcpServerTools[serverId] = {
				loading: false,
				error: null,
				tools: tools.map((tool) => ({
					name: tool.name,
					description: (tool as { description?: string }).description,
				})),
			};
		} finally {
			if (needsPatch && windowWithFetch._originalFetch) {
				window.fetch = windowWithFetch._originalFetch;
				windowWithFetch._originalFetch = undefined;
			}
		}
	} catch (err) {
		mcpServerTools[serverId] = {
			loading: false,
			error: err instanceof Error ? err.message : "Failed to fetch tools",
			tools: [],
		};
	}
}

function toggleToolsList(serverId: string) {
	if (expandedServerId === serverId) {
		expandedServerId = null;
	} else {
		expandedServerId = serverId;
		if (!mcpServerTools[serverId] || mcpServerTools[serverId].error) {
			void fetchServerTools(serverId);
		}
	}
}

function getServerToolsState(serverId: string): MCPServerToolsState | undefined {
	return mcpServerTools[serverId];
}

// --- Live counts for the section nav rail ---

// The Capabilities count is "how many capability CARDS are switched on", not how many
// individual items — one card = one capability. AgentManager.countEnabledCapabilities is
// the single source of truth (shared with the agents-list summary so the two never drift).
// Reference the reactive signals it reads under the hood so the derived recomputes: the
// selected agent's config (toggling any tool/skill/server), and skillsRefreshCounter
// (skill discovery / plugin install/enable while the modal is open).
const capabilitiesCount = $derived.by(() => {
	void skillsRefreshCounter;
	void selectedAgent?.toolsConfig;
	void selectedAgent?.skills;
	void selectedAgent?.mcpServers;
	void selectedAgent?.pluginExecTools;
	return plugin.agentManager?.countEnabledCapabilities(agentId) ?? 0;
});
// Each card's header shows how many of its tools are on, over the tools that can actually be
// enabled here (uninstalled-plugin tools are excluded from both the numerator and denominator).
const vaultSummary = $derived(`${vaultEnabledCount} of ${vaultAvailableCount} on`);
const webSummary = $derived(`${webEnabledCount} of ${webAvailableCount} on`);

const sectionCounts = $derived<Partial<Record<SectionId, number>>>({
	capabilities: capabilitiesCount,
	subagents: subAgentIds.length,
});
</script>

{#if selectedAgent}
  <div class="agent-editor-container">
    <SlidingTabs bind:value={activeSection} tabs={SECTIONS} class="agent-editor-layout">
      {#snippet trailing(section)}
        {#if sectionCounts[section.id] !== undefined && sectionCounts[section.id]! > 0}
          <span class="agent-tab-count"><Badge label={String(sectionCounts[section.id])} tone="muted" /></span>
        {/if}
      {/snippet}

    <div class="agent-editor-pane">
      <!-- Shared per-tool row (used by the Core · Vault and Web capability cards). Declared at
           the pane level so it isn't mistaken for a prop of an enclosing component. -->
      {#snippet toolRow(tool: ToolInfo)}
        {@const enabled = getToolEnabled(tool.id)}
        {@const pluginAvailable = !tool.requiresPlugin || isPluginInstalled(tool.requiresPlugin.id)}
        <ManagedEntityItem
          class="tool-entity"
          name={getToolDisplayName(tool.id)}
          desc={getToolDescription(tool.id)}
          disabled={!pluginAvailable}
        >
          {#snippet badges()}
            {#if tool.requiresPlugin && !pluginAvailable}
              <Badge
                label={`Requires ${tool.requiresPlugin.name}`}
                tone="warning"
                interactive
                onclick={() => openPluginPage(tool.requiresPlugin!.id)}
              />
            {/if}
          {/snippet}

          {#snippet actions()}
            <Button
              iconId="settings"
              ariaLabel={`Configure ${getToolDisplayName(tool.id)}`}
              tooltip={`Configure ${getToolDisplayName(tool.id)}`}
              onClick={() => openToolConfig(tool.id)}
            />
            <Toggle
              checked={enabled && pluginAvailable}
              onchange={() => handleToolToggle(tool.id)}
              disabled={!pluginAvailable}
            />
          {/snippet}
        </ManagedEntityItem>
      {/snippet}

      {#if activeSection === "general"}
        <SettingGroup heading="General">
          <div class="agent-overview-identity">
            <PickerPopover
              bind:open={isAgentIconPickerOpen}
              triggerClass="agent-icon-trigger"
              contentClass="agent-icon-popover"
              side="bottom"
              align="start"
              sideOffset={8}
            >
              {#snippet trigger(open)}
                <span class="agent-icon-trigger-preview">
                  <Icon name={selectedAgentIcon} size="m" />
                </span>
                <Icon name={open ? "chevron-up" : "chevron-down"} size="xs" />
              {/snippet}

              <div class="agent-icon-browser">
                <Search
                  class="agent-icon-search"
                  value={agentIconQuery}
                  placeholder="Search built-in icons"
                  onchange={(value: string) => (agentIconQuery = value)}
                />

                <div class="agent-icon-pictograms">
                  {#each AGENT_PICTOGRAM_OPTIONS as pictogram}
                    <button
                      type="button"
                      class="agent-icon-chip"
                      class:selected={selectedAgentIcon === pictogram}
                      onclick={() => {
                        updateAgentIcon(pictogram);
                        isAgentIconPickerOpen = false;
                      }}
                    >
                      <span class="agent-icon-chip-glyph">{pictogram}</span>
                    </button>
                  {/each}
                </div>

                <div class="agent-icon-results-header">
                  <span>{agentIconQuery.trim() ? `Built-in icons (${matchingAgentIconCount})` : "Popular icons"}</span>
                </div>

                <div class="agent-icon-grid">
                  {#if matchingAgentIcons.length > 0}
                    {#each matchingAgentIcons as iconName}
                      <button
                        type="button"
                        class="agent-icon-option"
                        class:selected={selectedAgentIcon === iconName}
                        title={iconName}
                        onclick={() => {
                          updateAgentIcon(iconName);
                          isAgentIconPickerOpen = false;
                        }}
                      >
                        <span class="agent-icon-option-preview">
                          <Icon name={iconName} size="s" />
                        </span>
                        <span class="agent-icon-option-label">{iconName}</span>
                      </button>
                    {/each}
                  {:else}
                    <div class="agent-icon-empty-state">
                      No built-in icons match this search. Use the text field for a custom icon ID or emoji.
                    </div>
                  {/if}
                </div>
              </div>
            </PickerPopover>

            <div class="agent-overview-name">
              <Text
                inputType="text"
                class="agent-overview-name-input"
                placeholder="Agent name"
                value={selectedAgent.name}
                onblur={(value: string) => updateAgentName(value)}
              />
              <div class="agent-overview-name-hint">
                Search built-in Obsidian icons or type any icon ID or emoji directly.
                <button
                  type="button"
                  class="agent-icon-inline-edit"
                  onclick={() => (isAgentIconPickerOpen = true)}
                >
                  Change icon
                </button>
              </div>
            </div>
          </div>

          <SettingItem name="Chat Model" desc="Primary model this agent uses for conversation">
            <ModelSettingControl
              available={models.hasProviders && models.hasModels}
              loading={models.hasProviders && models.isLoadingModels}
              configureLabel={!models.hasProviders ? "Configure Provider" : "Configure Models"}
              onConfigure={models.openSettings}
              placeholder="Select a model"
              selectedLabel={currentModelDisplay?.model ?? null}
              selectedLogo={currentModelDisplay?.logo ?? null}
              onSelect={openModelSelectionModal}
            />
          </SettingItem>

          <SettingItem
            name="Base System Prompt"
            desc="Customize the base system instructions for this agent"
          >
            <div class="flex items-center gap-2 justify-end">
              <Button buttonText="Edit Prompt" onClick={openSystemPromptModal} />
              <Button buttonText="View Final Prompt" onClick={openRenderedSystemPromptModal} />
            </div>
          </SettingItem>

          <SettingItem
            name="Summarization Model"
            desc="Model used to compress older chat history when the context window fills up"
          >
            <div class="agent-model-setting">
              <ModelSettingControl
                available={models.hasProviders && models.hasModels}
                loading={models.hasProviders && models.isLoadingModels}
                configureLabel={!models.hasProviders ? "Configure Provider" : "Configure Models"}
                onConfigure={models.openSettings}
                placeholder="Auto (same as chat model)"
                selectedLabel={currentSummarizationModelDisplay?.model ?? null}
                selectedLogo={currentSummarizationModelDisplay?.logo ?? null}
                onSelect={openSummarizationModelSelectionModal}
                secondaryLabel={selectedAgent.summarizationModel ? "Reset" : undefined}
                onSecondary={selectedAgent.summarizationModel ? resetSummarizationModel : undefined}
              />
              {#if summarizationContextWindowWarning}
                <div class="agent-model-warning text-sm">{summarizationContextWindowWarning}</div>
              {/if}
            </div>
          </SettingItem>

          <SettingItem
            name="Title Generation Model"
            desc="Model used to generate conversation titles from the first user message"
          >
            <ModelSettingControl
              available={models.hasProviders && models.hasModels}
              loading={models.hasProviders && models.isLoadingModels}
              configureLabel={!models.hasProviders ? "Configure Provider" : "Configure Models"}
              onConfigure={models.openSettings}
              placeholder="Auto (same as chat model)"
              selectedLabel={currentTitleModelDisplay?.model ?? null}
              selectedLogo={currentTitleModelDisplay?.logo ?? null}
              onSelect={openTitleModelSelectionModal}
              secondaryLabel={selectedAgent.titleModel ? "Reset" : undefined}
              onSecondary={selectedAgent.titleModel ? resetTitleModel : undefined}
            />
          </SettingItem>
        </SettingGroup>
      {:else if activeSection === "capabilities"}
        <SettingGroup heading="Capabilities">
          <div class="setting-item-description mb-3">
            Everything this agent can do — built-in tools, skills loaded on demand, plugin integrations,
            and MCP servers. Expand a capability to configure the individual items inside it.
          </div>

          <!-- Card 1: Core · Vault exploration — the built-in vault tools. -->
          <CapabilityCard
            title="Core · Vault exploration"
            description="Search, read, edit, and explore your vault with the built-in tools."
            icon="compass"
            summary={vaultSummary}
            masterEnabled={vaultAnyOn}
            onToggleMaster={(next) => toggleAllTools(vaultTools, next)}
          >
            {#snippet body()}
              {#each vaultTools as tool (tool.id)}
                {@render toolRow(tool)}
              {/each}
            {/snippet}
          </CapabilityCard>

          <!-- Card 1b: Web — tools that reach the public internet (fetch URL, web search). -->
          <CapabilityCard
            title="Web"
            description="Reach the public internet: fetch web pages and run web searches."
            icon="globe"
            summary={webSummary}
            masterEnabled={webAnyOn}
            onToggleMaster={(next) => toggleAllTools(webTools, next)}
          >
            {#snippet body()}
              {#each webTools as tool (tool.id)}
                {@render toolRow(tool)}
              {/each}
            {/snippet}
          </CapabilityCard>


          <!-- Cards 2: one flat card per Obsidian core-plugin skill (Canvas, Bases, …). -->
          {#each coreSkills as ext (ext.id)}
            {@const pluginAvailable = isSkillPluginAvailable(ext)}
            <CapabilityCard
              title={ext.displayName}
              description={ext.description}
              icon={getPluginIcon(ext.corePluginId, "sparkles")}
              expandable={false}
              masterEnabled={ext.enabled && pluginAvailable}
              masterDisabled={!pluginAvailable}
              onToggleMaster={() => toggleSkill(ext.id, !ext.enabled)}
            >
              {#snippet badges()}
                <Badge label="Core plugin" tone="muted" />
                {#if !pluginAvailable}
                  <Badge label="Core plugin disabled" tone="warning" />
                {/if}
              {/snippet}

              {#snippet headerActions()}
                <Button
                  iconId="pencil"
                  ariaLabel={`Edit ${ext.displayName} prompt`}
                  tooltip={`Edit ${ext.displayName} prompt`}
                  onClick={() => openSkillModal(ext.id)}
                />
              {/snippet}
            </CapabilityCard>
          {/each}

          <!-- Cards 3: one flat card per community-plugin skill (Dataview, Tasks, …). -->
          {#each pluginSkills as ext (ext.id)}
            {@const pluginAvailable = isSkillPluginAvailable(ext)}
            {@const execIntegration = skillExecIntegration(ext)}
            <CapabilityCard
              title={ext.displayName}
              description={ext.description}
              icon={getPluginIcon(ext.linkedPluginId)}
              expandable={false}
              masterEnabled={ext.enabled && pluginAvailable}
              masterDisabled={!pluginAvailable}
              onToggleMaster={() => toggleSkill(ext.id, !ext.enabled)}
            >
              {#snippet badges()}
                <Badge label="Community plugin" tone="muted" />
                {#if !pluginAvailable}
                  <Badge
                    label="Not enabled"
                    tone="warning"
                    interactive
                    onclick={() => openPluginPage(ext.linkedPluginId ?? ext.id)}
                  />
                {:else if execIntegration && ext.enabled}
                  <Badge label="API scripting" tone="muted" />
                {/if}
              {/snippet}

              {#snippet headerActions()}
                <Button
                  iconId="pencil"
                  ariaLabel={`Edit ${ext.displayName} prompt`}
                  tooltip={`Edit ${ext.displayName} prompt`}
                  onClick={() => openSkillModal(ext.id)}
                />
              {/snippet}
            </CapabilityCard>
          {/each}

          <!-- Cards 4: auto-discovered api-plugins with no skill yet. Enabling generates one. -->
          {#each autoDiscoveredIntegrations as integ (integ.pluginId)}
            <CapabilityCard
              title={integ.displayName}
              description="Auto-discovered plugin exposing a public API. Enabling creates an editable API-scripting skill — the agent introspects the API before calling it. Runs on the main thread (not sandboxed)."
              icon={getPluginIcon(integ.pluginId)}
              expandable={false}
              masterEnabled={integ.execEnabled}
              onToggleMaster={(next) => void toggleAutoIntegration(integ.pluginId, integ.displayName, next)}
            >
              {#snippet badges()}
                <Badge label="Auto-discovered" tone="muted" />
                {#if integ.execEnabled}
                  <Badge label="API scripting" tone="muted" />
                {/if}
              {/snippet}
            </CapabilityCard>
          {/each}

          <!-- Card 5: Custom capabilities — the user's own skills + MCP servers, with a "+ Add" menu. -->
          <CapabilityCard
            title="Custom capabilities"
            description="Your own skills and MCP servers."
            icon="wand-sparkles"
            summary={`${customSkills.length} ${customSkills.length === 1 ? "skill" : "skills"} · ${mcpServerIds.length} ${mcpServerIds.length === 1 ? "server" : "servers"}`}
            defaultExpanded
          >
            {#snippet headerActions()}
              <PickerPopover
                bind:open={isAddCapabilityMenuOpen}
                side="bottom"
                align="end"
                sideOffset={6}
              >
                {#snippet trigger(open)}
                  <Icon name="plus" size="xs" />
                  <span>Add</span>
                  <Icon name={open ? "chevron-up" : "chevron-down"} size="xs" />
                {/snippet}

                <PickerOptionRow
                  onClick={() => {
                    isAddCapabilityMenuOpen = false;
                    openAddSkillModal();
                  }}
                >
                  {#snippet leading()}
                    <Icon name="sparkles" size="s" />
                  {/snippet}
                  {#snippet content()}
                    Custom Skill
                  {/snippet}
                </PickerOptionRow>

                <PickerOptionRow
                  onClick={() => {
                    isAddCapabilityMenuOpen = false;
                    openAddMCPServer();
                  }}
                >
                  {#snippet leading()}
                    <Icon name="server" size="s" />
                  {/snippet}
                  {#snippet content()}
                    MCP Server
                  {/snippet}
                </PickerOptionRow>
              </PickerPopover>
            {/snippet}

            {#snippet body()}
              <div class="skill-category-header">
                <span class="skill-category-title">Skills</span>
                <Badge label="User-defined" pill={false} uppercase />
              </div>
              {#each customSkills as ext (ext.id)}
                <ManagedEntityItem
                  class="skill-entity"
                  name={ext.displayName}
                  desc={ext.description}
                  meta="Stored as a custom skill in the vault configuration."
                >
                  {#snippet actions()}
                    <Button
                      iconId="trash"
                      ariaLabel={`Delete ${ext.displayName}`}
                      tooltip={`Delete ${ext.displayName}`}
                      onClick={() => void deleteSkill(ext.id)}
                    />
                    <Button
                      iconId="pencil"
                      ariaLabel={`Edit ${ext.displayName} prompt`}
                      tooltip={`Edit ${ext.displayName} prompt`}
                      onClick={() => openSkillModal(ext.id)}
                    />
                    <Toggle checked={ext.enabled} onchange={() => toggleSkill(ext.id, !ext.enabled)} />
                  {/snippet}
                </ManagedEntityItem>
              {/each}
              {#if customSkills.length === 0}
                <div class="skill-empty-state">No custom skills yet</div>
              {/if}

              <div class="skill-category-header capability-subgroup-header">
                <span class="skill-category-title">MCP Servers</span>
                <Badge label="External tools" pill={false} uppercase />
              </div>
              {#if mcpServerIds.length > 0}
                <div class="mcp-servers-list">
                  {#each mcpServerIds as serverId (serverId)}
                    {@const config = selectedAgent.mcpServers[serverId]}
                    {@const toolsState = getServerToolsState(serverId)}
                    {@const isExpanded = expandedServerId === serverId}
                    <ManagedEntityItem
                      class="mcp-entity"
                      name={config.displayName}
                      desc={config.transport === "stdio"
                        ? `${config.command} ${config.args.join(" ")}`
                        : config.url}
                      meta={config.transport === "stdio"
                        ? "Local stdio MCP server"
                        : "Remote HTTP MCP server"}
                    >
                      {#snippet badges()}
                        <Badge
                          label={config.transport === "stdio" ? "Local" : "HTTP"}
                          tone={config.transport === "stdio" ? "success" : "accent"}
                        />
                        <Badge
                          interactive
                          onclick={() => toggleToolsList(serverId)}
                          class={`mcp-tools-badge ${toolsState?.error ? "error" : ""} ${toolsState?.tools && toolsState.tools.length > 0 ? "has-tools" : ""}`}
                        >
                          {#if toolsState?.loading}
                            <Icon name="loader" size="xs" />
                          {:else if toolsState?.error}
                            <Icon name="alert-circle" size="xs" />
                          {:else}
                            <Icon name="wrench" size="xs" />
                          {/if}
                          <span>{getMCPToolsBadgeLabel(serverId, toolsState)}</span>
                        </Badge>
                      {/snippet}

                      {#snippet children()}
                        {#if isExpanded && toolsState}
                          <div class="mcp-tools-list">
                            {#if toolsState.loading}
                              <div class="mcp-tools-loading">Loading tools...</div>
                            {:else if toolsState.error}
                              <div class="mcp-tools-error">
                                <Icon name="alert-circle" size="s" />
                                <span>{toolsState.error}</span>
                                <button
                                  class="mcp-tools-retry"
                                  onclick={() => void fetchServerTools(serverId)}>Retry</button
                                >
                              </div>
                            {:else if toolsState.tools.length === 0}
                              <div class="mcp-tools-empty">No tools available</div>
                            {:else}
                              {#each toolsState.tools as tool (tool.name)}
                                <div class="mcp-tool-item">
                                  <span class="mcp-tool-name">{tool.name}</span>
                                  {#if tool.description}
                                    <span class="mcp-tool-desc">{tool.description}</span>
                                  {/if}
                                </div>
                              {/each}
                            {/if}
                          </div>
                        {/if}
                      {/snippet}

                      {#snippet actions()}
                        <Button
                          iconId="pencil"
                          ariaLabel={`Edit ${config.displayName}`}
                          tooltip={`Edit ${config.displayName}`}
                          onClick={() => openEditMCPServer(serverId)}
                        />
                        <Toggle checked={config.enabled} onchange={() => toggleMCPServer(serverId)} />
                      {/snippet}
                    </ManagedEntityItem>
                  {/each}
                </div>
              {:else}
                <div class="mcp-empty-state"><p>No MCP servers configured for this agent.</p></div>
              {/if}
            {/snippet}
          </CapabilityCard>
        </SettingGroup>
      {:else if activeSection === "subagents"}
        <SettingGroup heading="Subagents">
          <div class="setting-item-description mb-3">
            Enable agents as subagents. This agent can delegate tasks to them via the
            <code>task</code> tool — each subagent runs with its own model, tools, and prompt. Enabling
            this agent itself delegates to a fresh, isolated-context copy of it (useful for keeping the
            main conversation clean). Delegation is one level deep (a subagent's own subagents are ignored).
          </div>
          {#each subAgentCandidates as candidate (candidate.id)}
            {@const hasModel = !!candidate.chatModel}
            {@const isEnabled = isSubAgentEnabled(candidate.id)}
            <ManagedEntityItem
              class="subagent-entity"
              name={candidate.id === agentId ? `${candidate.name} (this agent)` : candidate.name}
              desc={hasModel
                ? getSubAgentModelLabel(candidate)
                : "No chat model configured — cannot be used as a subagent"}
            >
              {#snippet actions()}
                <Toggle
                  checked={isEnabled}
                  disabled={!hasModel && !isEnabled}
                  onchange={() => handleSubAgentToggle(candidate.id)}
                />
              {/snippet}
            </ManagedEntityItem>
          {/each}
        </SettingGroup>
      {/if}
    </div>
    </SlidingTabs>
  </div>
{/if}

<style>
  .agent-editor-container {
    height: 100%;
    min-height: 0;
    container-type: inline-size;
  }

  /* bits-ui forwards this class to the rendered Tabs.Root element, so it must be
     :global (Svelte can't see it statically through the component boundary). */
  :global(.agent-editor-layout) {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  /* Tab label + icon, matching the main S2B settings tab bar. */
  .agent-tab-count {
    flex-shrink: 0;
  }

  /* On the accent-filled active tab, make the count chip read as on-accent. */
  :global([data-tabs-trigger][data-state="active"]) .agent-tab-count :global(.badge) {
    background: color-mix(in srgb, var(--text-on-accent) 22%, transparent);
    border-color: color-mix(in srgb, var(--text-on-accent) 35%, transparent);
    color: var(--text-on-accent);
  }

  .agent-editor-pane {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    padding-bottom: 12px;
  }

  .agent-overview-identity {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 0 12px;
  }

  .agent-overview-name {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .agent-overview-name :global(.agent-overview-name-input) {
    width: 100%;
    font-size: var(--font-ui-medium);
  }

  .agent-overview-name-hint {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .agent-icon-inline-edit {
    border: 0;
    background: transparent;
    color: var(--text-accent);
    cursor: pointer;
    padding: 0;
    font-size: inherit;
  }

  .agent-icon-inline-edit:hover {
    text-decoration: underline;
  }

  :global(.agent-icon-trigger) {
    min-width: 0;
    width: 54px;
    justify-content: center;
    padding: 2px 6px;
  }

  .agent-icon-trigger-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  :global(.agent-icon-popover) {
    width: min(380px, calc(100vw - 48px));
    max-width: min(380px, calc(100vw - 48px));
    z-index: calc(var(--layer-popover) + 20);
  }

  .agent-icon-browser {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .agent-icon-browser :global(.agent-icon-search) {
    width: 100%;
  }

  .agent-icon-pictograms {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .agent-icon-chip,
  .agent-icon-option {
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .agent-icon-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    height: 34px;
    padding: 0 8px;
    border-radius: 10px;
  }

  .agent-icon-chip-glyph {
    font-size: 1rem;
    line-height: 1;
  }

  .agent-icon-chip:hover,
  .agent-icon-option:hover {
    background: var(--background-modifier-hover);
  }

  .agent-icon-chip.selected,
  .agent-icon-option.selected {
    border-color: color-mix(in srgb, var(--interactive-accent) 55%, var(--background-modifier-border));
    background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-primary));
  }

  .agent-icon-results-header {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .agent-icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 6px;
    max-height: 220px;
    overflow: auto;
    padding-right: 2px;
  }

  .agent-icon-option {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 8px 10px;
    border-radius: 12px;
    text-align: left;
  }

  .agent-icon-option-preview {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .agent-icon-option-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-ui-smaller);
  }

  .agent-icon-empty-state {
    padding: 10px 12px;
    border: 1px dashed var(--background-modifier-border);
    border-radius: 12px;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .skill-category-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  /* Space the second sub-group (MCP Servers) away from the first inside a card body. */
  .capability-subgroup-header {
    margin-top: 20px;
  }
  .skill-category-title {
    font-weight: 600;
    font-size: 0.95rem;
  }
  .mcp-tool-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-top: 4px;
  }
  .skill-empty-state,
  .mcp-empty-state {
    padding: 16px;
    text-align: center;
    color: var(--text-muted);
    background: var(--background-secondary);
    border-radius: 8px;
  }
  :global(.skill-entity),
  :global(.tool-entity),
  :global(.mcp-entity) {
    padding-left: 0;
    padding-right: 0;
  }
  :global(.mcp-tools-badge) {
    min-height: 22px;
  }
  :global(.mcp-tools-badge.has-tools) {
    background: rgba(var(--color-green-rgb, 76, 175, 80), 0.15);
    border-color: var(--text-success, #4caf50);
    color: var(--text-success, #4caf50);
  }
  :global(.mcp-tools-badge.error) {
    background: rgba(var(--color-red-rgb, 244, 67, 54), 0.15);
    border-color: var(--text-error, #f44336);
    color: var(--text-error, #f44336);
  }
  .mcp-tools-list {
    margin-top: 12px;
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 6px;
    max-height: 300px;
    overflow-y: auto;
  }
  .mcp-tools-loading,
  .mcp-tools-empty {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
    padding: 8px;
  }
  .mcp-tools-error {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-error, #f44336);
    font-size: 0.85rem;
    padding: 8px;
  }
  .mcp-tools-retry {
    margin-left: auto;
    padding: 4px 12px;
    font-size: 0.75rem;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
  }
  .mcp-tool-item {
    display: flex;
    flex-direction: column;
    padding: 8px;
    margin-bottom: 4px;
    background: var(--background-primary);
    border-radius: 4px;
  }
  .mcp-tool-name {
    font-weight: 500;
    font-family: var(--font-monospace);
    font-size: 0.85rem;
  }
  .agent-model-warning {
    color: var(--text-warning, #ffc107);
    max-width: 520px;
    width: 100%;
    text-align: right;
  }
  .agent-model-setting {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    width: 100%;
  }
</style>
