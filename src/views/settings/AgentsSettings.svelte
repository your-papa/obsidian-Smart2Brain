<script lang="ts">
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { Notice } from "obsidian";
import { MCPServerModal } from "../../components/modal/MCPServerModal";
import { PluginExtensionModal } from "../../components/modal/PluginExtensionModal";
import { SystemPromptModal } from "../../components/modal/SystemPromptModal";
import { ToolConfigModal } from "../../components/modal/ToolConfigModal";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import Icon from "../../components/ui/Icon.svelte";
import IconButton from "../../components/ui/IconButton.svelte";
import SearchableDropdown from "../../components/ui/SearchableDropdown.svelte";
import Text from "../../components/ui/Text.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import { createObsidianFetch } from "../../lib/obsidianFetch";
import type { AgentColor, AgentConfig, BuiltInToolId, MCPServerConfig } from "../../main";
import { getProviderDefinition } from "../../providers/index";
import type { ChatModel } from "../../stores/chatStore.svelte";
import { DEFAULT_AGENT_ID, getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const pluginData = getData();
const plugin = getPlugin();
const models = useAvailableModels();

// Available agent colors matching Obsidian theme
const AGENT_COLORS: { value: AgentColor | "none"; label: string; cssVar: string }[] = [
	{ value: "none", label: "None", cssVar: "" },
	{ value: "red", label: "Red", cssVar: "--color-red" },
	{ value: "orange", label: "Orange", cssVar: "--color-orange" },
	{ value: "yellow", label: "Yellow", cssVar: "--color-yellow" },
	{ value: "green", label: "Green", cssVar: "--color-green" },
	{ value: "cyan", label: "Cyan", cssVar: "--color-cyan" },
	{ value: "blue", label: "Blue", cssVar: "--color-blue" },
	{ value: "purple", label: "Purple", cssVar: "--color-purple" },
	{ value: "pink", label: "Pink", cssVar: "--color-pink" },
];

// Currently selected agent for editing
let selectedAgentId = $state<string>(DEFAULT_AGENT_ID);

// Get agents object reactively (triggers when agents change)
let agents = $derived(pluginData.agents);

// Get all agent IDs reactively from the agents object
let agentIds = $derived(Object.keys(agents));

// Get selected agent config
let selectedAgent = $derived(agents[selectedAgentId]);

// Dropdown options for agent selector
const agentDropdownOptions = $derived(
	agentIds.map((id) => {
		const agent = agents[id];
		const isDefault = id === pluginData.defaultAgentId;
		return {
			value: id,
			display: agent ? `${agent.name}${isDefault ? " (Default)" : ""}` : id,
		};
	}),
);

// Auto-apply changes by reinitializing the agent
function applyChanges() {
	plugin.agentManager.reinitialize().catch((error) => {
		console.error("Failed to reinitialize agent:", error);
	});
}

// ============================================================================
// Agent List Functions
// ============================================================================

function createNewAgent() {
	const agent = pluginData.createAgent("New Agent");
	selectedAgentId = agent.id;
}

function deleteSelectedAgent() {
	if (selectedAgentId === DEFAULT_AGENT_ID) {
		new Notice("Cannot delete the built-in default agent");
		return;
	}
	try {
		pluginData.deleteAgent(selectedAgentId);
		selectedAgentId = pluginData.defaultAgentId ?? DEFAULT_AGENT_ID;
		applyChanges();
	} catch (err) {
		new Notice(err instanceof Error ? err.message : "Failed to delete agent");
	}
}

function duplicateAgent() {
	if (!selectedAgent) return;
	const newAgent = pluginData.duplicateAgent(selectedAgentId, `${selectedAgent.name} (Copy)`);
	selectedAgentId = newAgent.id;
}

function setAsDefaultAgent() {
	try {
		pluginData.setDefaultAgentId(selectedAgentId);
		new Notice(`${selectedAgent?.name} is now the default agent`);
	} catch (err) {
		new Notice(err instanceof Error ? err.message : "Failed to set default agent");
	}
}

function clearDefaultAgent() {
	pluginData.clearDefaultAgent();
	new Notice("Default cleared. New chats will use the last selected agent.");
}

// ============================================================================
// General Settings
// ============================================================================

function updateAgentName(name: string) {
	if (!selectedAgentId) return;
	pluginData.updateAgent(selectedAgentId, { name });
}

function updateAgentColor(color: AgentColor | "none") {
	if (!selectedAgentId) return;
	pluginData.updateAgent(selectedAgentId, { color: color === "none" ? undefined : color });
}

// Model dropdown options - grouped by provider
const modelOptions = $derived(
	models.modelOptions.map((opt) => ({
		label: opt.label,
		value: opt.value,
		group: opt.chatModel.provider,
		chatModel: opt.chatModel,
	})),
);

// Get selected model value for current agent
let selectedModelValue = $derived.by(() => {
	if (!selectedAgent?.chatModel) return "";
	return `${selectedAgent.chatModel.provider}:${selectedAgent.chatModel.model}`;
});

function handleModelSelect(value: string) {
	const opt = models.modelOptions.find((o) => o.value === value);
	if (opt && selectedAgentId) {
		pluginData.updateAgent(selectedAgentId, { chatModel: opt.chatModel as ChatModel });
		applyChanges();
	}
}

function getProviderId(value: string): string {
	const opt = models.modelOptions.find((o) => o.value === value);
	return opt?.chatModel.provider ?? "";
}

// ============================================================================
// System Prompt
// ============================================================================

function openSystemPromptModal() {
	if (!selectedAgent) return;
	// Create a custom modal that edits the agent's system prompt
	const modal = new SystemPromptModal(plugin, {
		getPrompt: () => selectedAgent?.systemPrompt ?? "",
		setPrompt: (prompt: string) => {
			pluginData.updateAgent(selectedAgentId, { systemPrompt: prompt });
			applyChanges();
		},
	});
	modal.open();
}

// ============================================================================
// Plugin Extensions
// ============================================================================

const pluginExtensions = $derived(selectedAgent ? Object.values(selectedAgent.pluginPromptExtensions) : []);

function openExtensionModal(pluginId: string) {
	if (!selectedAgent) return;
	const modal = new PluginExtensionModal(
		plugin,
		pluginId,
		() => {
			applyChanges();
		},
		{
			getExtension: () => selectedAgent?.pluginPromptExtensions[pluginId],
			updateExtension: (updates) => {
				pluginData.updateAgentPluginExtension(selectedAgentId, pluginId, updates);
			},
		},
	);
	modal.open();
}

function toggleExtension(pluginId: string, newEnabled: boolean) {
	const installed = plugin.agentManager?.isPluginInstalled(pluginId) ?? false;
	const enabled = plugin.agentManager?.isPluginEnabled(pluginId) ?? false;
	const ext = selectedAgent?.pluginPromptExtensions[pluginId];
	const displayName = ext?.displayName ?? pluginId;

	if (!installed) {
		new Notice(`Please install the ${displayName} plugin first.`);
		return;
	}
	if (!enabled) {
		new Notice(`Please enable the ${displayName} plugin in Obsidian settings first.`);
		return;
	}

	pluginData.setAgentPluginExtensionEnabled(selectedAgentId, pluginId, newEnabled);
	applyChanges();
}

function isPluginInstalled(pluginId: string): boolean {
	return plugin.agentManager?.isPluginInstalled(pluginId) ?? false;
}

function isPluginEnabled(pluginId: string): boolean {
	return plugin.agentManager?.isPluginEnabled(pluginId) ?? false;
}

function openPluginPage(pluginId: string) {
	if (pluginId === "math-latex") return;
	window.open(`obsidian://show-plugin?id=${pluginId}`);
}

// ============================================================================
// Built-in Tools
// ============================================================================

interface ToolInfo {
	id: BuiltInToolId;
	defaultName: string;
	defaultDescription: string;
	requiresPlugin?: {
		id: string;
		name: string;
	};
}

const TOOLS: ToolInfo[] = [
	{
		id: "search_notes",
		defaultName: "Search Notes",
		defaultDescription: "Search through your Obsidian notes by keyword. Returns matching file names and metadata.",
	},
	{
		id: "read_note",
		defaultName: "Read Note",
		defaultDescription: "Read the full content of a specific note by its file path.",
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
		id: "execute_dataview_query",
		defaultName: "Execute Dataview Query",
		defaultDescription: "Execute Obsidian Dataview queries (DQL) and return results.",
		requiresPlugin: {
			id: "dataview",
			name: "Dataview",
		},
	},
];

function getToolDisplayName(toolId: BuiltInToolId): string {
	const config = selectedAgent?.toolsConfig[toolId];
	const defaultTool = TOOLS.find((t) => t.id === toolId);
	const name = config?.name ?? defaultTool?.defaultName ?? toolId;
	if (name.includes("_")) {
		return name
			.split("_")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");
	}
	return name;
}

function getToolDescription(toolId: BuiltInToolId): string {
	const config = selectedAgent?.toolsConfig[toolId];
	const defaultTool = TOOLS.find((t) => t.id === toolId);
	return config?.description ?? defaultTool?.defaultDescription ?? "";
}

function handleToolToggle(toolId: BuiltInToolId) {
	pluginData.toggleAgentToolEnabled(selectedAgentId, toolId);
	applyChanges();
}

function getToolEnabled(toolId: BuiltInToolId): boolean {
	return pluginData.isAgentToolEnabled(selectedAgentId, toolId);
}

function openToolConfig(toolId: BuiltInToolId) {
	const modal = new ToolConfigModal(
		plugin,
		toolId,
		() => {
			applyChanges();
		},
		{
			agentId: selectedAgentId,
			getToolConfig: () => selectedAgent?.toolsConfig[toolId],
			updateToolConfig: (config) => {
				pluginData.updateAgentToolConfig(selectedAgentId, toolId, config);
			},
		},
	);
	modal.open();
}

// ============================================================================
// MCP Servers
// ============================================================================

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
	const modal = new MCPServerModal(
		plugin,
		null,
		null,
		(serverId: string, config: MCPServerConfig) => {
			pluginData.setAgentMCPServer(selectedAgentId, serverId, config);
			applyChanges();
		},
		{ skipGlobalSave: true },
	);
	modal.open();
}

function openEditMCPServer(serverId: string) {
	const config = selectedAgent?.mcpServers[serverId];
	if (config) {
		const modal = new MCPServerModal(
			plugin,
			serverId,
			config,
			(newServerId: string, updatedConfig: MCPServerConfig) => {
				// If ID changed, delete old entry
				if (newServerId !== serverId) {
					pluginData.deleteAgentMCPServer(selectedAgentId, serverId);
				}
				// Check if this is a deletion (enabled: false indicates deletion from handleDelete)
				if (!updatedConfig.enabled && newServerId === serverId) {
					pluginData.deleteAgentMCPServer(selectedAgentId, serverId);
				} else {
					pluginData.setAgentMCPServer(selectedAgentId, newServerId, updatedConfig);
				}
				applyChanges();
			},
			{ skipGlobalSave: true },
		);
		modal.open();
	}
}

function toggleMCPServer(serverId: string) {
	pluginData.toggleAgentMCPServerEnabled(selectedAgentId, serverId);
	applyChanges();
}

function getMCPServerConfig(serverId: string): MCPServerConfig | undefined {
	return selectedAgent?.mcpServers[serverId];
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
	if (config.transport === "http") {
		return {
			mcpServers: {
				[serverId]: {
					transport: "http" as const,
					url: config.url,
					headers: config.headers,
				},
			},
		};
	}
	return {
		mcpServers: {
			[serverId]: {
				transport: "sse" as const,
				url: config.url,
				headers: config.headers,
			},
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
			const mcpConfig = buildMCPConfig(serverId, config);
			const mcpClient = new MultiServerMCPClient(mcpConfig);
			const tools = await mcpClient.getTools();

			mcpServerTools[serverId] = {
				loading: false,
				error: null,
				tools: tools.map((t) => ({
					name: t.name,
					description: (t as { description?: string }).description,
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
			fetchServerTools(serverId);
		}
	}
}

function getServerToolsState(serverId: string): MCPServerToolsState | undefined {
	return mcpServerTools[serverId];
}
</script>

<div class="agents-settings">
	<!-- Agent Selector Header -->
	<div class="agent-selector-header">
		<div class="agent-selector-row">
			<div class="agent-dropdown-wrapper">
				<Dropdown
					type="options"
					dropdown={agentDropdownOptions}
					selected={selectedAgentId}
					onSelect={(id) => selectedAgentId = id}
				/>
			</div>
			<div class="agent-actions">
				<IconButton icon="plus" label="Add new agent" onclick={createNewAgent} />
				<IconButton icon="copy" label="Duplicate agent" onclick={duplicateAgent} />
				{#if selectedAgentId !== DEFAULT_AGENT_ID}
					<IconButton icon="trash-2" label="Delete agent" onclick={deleteSelectedAgent} />
				{/if}
			</div>
		</div>
	</div>

	<!-- Agent Editor Content -->
	<div class="agent-editor-content">
		{#if selectedAgent}

			<!-- General Settings -->
			<SettingGroup heading="General">
				<SettingItem name="Agent Name" desc="Display name for this agent">
					<Text
						inputType="text"
						placeholder="Agent name"
						value={selectedAgent.name}
						onblur={(value: string) => updateAgentName(value)}
					/>
				</SettingItem>

				<SettingItem name="Color" desc="Visual identifier for this agent">
					<div class="color-picker">
						{#each AGENT_COLORS as colorOption (colorOption.value)}
							{@const isSelected = (selectedAgent.color ?? "none") === colorOption.value}
							<button
								class="color-swatch"
								class:selected={isSelected}
								class:none={colorOption.value === "none"}
								style={colorOption.cssVar ? `--swatch-color: var(${colorOption.cssVar})` : ""}
								title={colorOption.label}
								onclick={() => updateAgentColor(colorOption.value)}
							>
								{#if isSelected}
									<Icon name="check" size="xs" />
								{/if}
							</button>
						{/each}
					</div>
				</SettingItem>

				<SettingItem
					name="Default Agent"
					desc={pluginData.defaultAgentId === null
						? "No default set. New chats use the last selected agent."
						: "The default agent is used for new chats."}
				>
					{#if selectedAgentId === pluginData.defaultAgentId}
						<Button buttonText="Clear Default" onClick={clearDefaultAgent} />
					{:else}
						<Button buttonText="Set as Default" onClick={setAsDefaultAgent} />
					{/if}
				</SettingItem>

				<SettingItem name="Chat Model" desc="AI model for this agent">
					{#if !models.hasProviders || !models.hasModels}
						<Button
							onClick={models.openSettings}
							buttonText={!models.hasProviders ? "Configure Provider" : "Configure Models"}
							iconId="settings"
						/>
					{:else}
						<SearchableDropdown
							options={modelOptions}
							selected={selectedModelValue}
							onSelect={handleModelSelect}
							placeholder="Select a model"
							searchPlaceholder="Search models..."
						>
						{#snippet renderGroupHeader({ group })}
							{@const providerDef = getProviderDefinition(group, pluginData.getAllCustomProviderMeta())}
							{@const Logo = (providerDef && "logo" in providerDef && providerDef.logo) ? providerDef.logo : GenericAIIcon}
							<div class="flex items-center gap-2">
								<Logo width={12} height={12} class="text-[--text-muted]" />
								<span>{providerDef?.displayName ?? group}</span>
							</div>
						{/snippet}

						{#snippet renderOption({ option, selected })}
							<span class="flex-1">{option.label}</span>
							{#if selected}
								<Icon name="check" size="xs" class="text-[--text-accent]" />
							{/if}
						{/snippet}

						{#snippet renderSelected({ option })}
							{@const providerId = getProviderId(option.value)}
							{@const providerDef = getProviderDefinition(providerId, pluginData.getAllCustomProviderMeta())}
							{@const Logo = (providerDef && "logo" in providerDef && providerDef.logo) ? providerDef.logo : GenericAIIcon}
							<Logo width={14} height={14} />
							<span>{option.label}</span>
						{/snippet}
						</SearchableDropdown>
					{/if}
				</SettingItem>
			</SettingGroup>

			<!-- System Prompt -->
			<SettingGroup heading="System Prompt">
				<SettingItem
					name="Base Prompt"
					desc="Customize the base system instructions for this agent"
				>
					<Button buttonText="Edit Base Prompt" onClick={openSystemPromptModal} />
				</SettingItem>
			</SettingGroup>

			<!-- Plugin Extensions -->
			<SettingGroup heading="Plugin Extensions">
				<div class="setting-item-description mb-3">
					Plugin-specific instructions are appended to the base prompt when the plugin is installed and enabled.
				</div>
				{#each pluginExtensions as ext (ext.pluginId)}
					{@const installed = isPluginInstalled(ext.pluginId)}
					{@const enabled = isPluginEnabled(ext.pluginId)}
					<div class="plugin-extension-item">
						<div class="plugin-extension-info">
							<div class="plugin-extension-header">
								<span class="plugin-extension-name">{ext.displayName}</span>
								{#if !installed}
									<button
										class="plugin-extension-badge not-installed clickable"
										onclick={() => openPluginPage(ext.pluginId)}
										title="Click to install"
									>
										Not installed
									</button>
								{:else if !enabled}
									<button
										class="plugin-extension-badge not-enabled clickable"
										onclick={() => openPluginPage(ext.pluginId)}
										title="Click to enable"
									>
										Not enabled
									</button>
								{/if}
							</div>
						</div>
						<div class="plugin-extension-controls">
							<Toggle
								isToggled={ext.enabled && enabled}
								changeFunc={() => toggleExtension(ext.pluginId, !ext.enabled)}
							/>
							<IconButton
								icon="pencil"
								label="Edit {ext.displayName} prompt"
								onclick={() => openExtensionModal(ext.pluginId)}
							/>
						</div>
					</div>
				{/each}
			</SettingGroup>

			<!-- Built-in Tools -->
			<SettingGroup heading="Built-in Tools">
				<div class="setting-item-description mb-3">
					Enable or disable specific tools that this agent can use. Click the settings icon to customize.
				</div>

				{#each TOOLS as tool (tool.id)}
					{@const enabled = getToolEnabled(tool.id)}
					{@const hasPluginDep = !!tool.requiresPlugin}
					{@const pluginAvailable = !tool.requiresPlugin || isPluginInstalled(tool.requiresPlugin.id)}
					{@const displayName = getToolDisplayName(tool.id)}
					{@const description = getToolDescription(tool.id)}

					<div class="tool-item">
						<div class="tool-info">
							<div class="tool-header">
								<span class="tool-name">{displayName}</span>
								{#if hasPluginDep && !pluginAvailable}
									<button
										class="tool-badge not-installed clickable"
										onclick={() => openPluginPage(tool.requiresPlugin!.id)}
										title="Click to install {tool.requiresPlugin!.name}"
									>
										Requires {tool.requiresPlugin!.name}
									</button>
								{/if}
							</div>
							<div class="tool-description">{description}</div>
						</div>
						<div class="tool-controls">
							<IconButton icon="settings" label="Configure {displayName}" onclick={() => openToolConfig(tool.id)} />
							<Toggle
								isToggled={enabled && pluginAvailable}
								changeFunc={() => handleToolToggle(tool.id)}
								disabled={!pluginAvailable}
							/>
						</div>
					</div>
				{/each}
			</SettingGroup>

			<!-- MCP Servers -->
			<SettingGroup heading="MCP Servers">
				<div class="setting-item-description mb-3">
					MCP (Model Context Protocol) servers extend this agent with external tools.
				</div>

				<div class="mcp-add-button">
					<Button buttonText="Add MCP Server" iconId="plus" onClick={openAddMCPServer} />
				</div>

				{#if mcpServerIds.length > 0}
					<div class="mcp-servers-list">
						{#each mcpServerIds as serverId (serverId)}
							{@const config = getMCPServerConfig(serverId)}
							{@const toolsState = getServerToolsState(serverId)}
							{@const isExpanded = expandedServerId === serverId}
							{#if config}
								<div class="mcp-server-item" class:expanded={isExpanded}>
									<div class="mcp-server-info">
										<div class="mcp-server-header">
											<span class="mcp-server-name">{config.displayName}</span>
											<span class="mcp-server-badge {config.transport}">
												{config.transport === "stdio" ? "Local" : config.transport === "http" ? "HTTP" : "SSE"}
											</span>
											<button
												class="mcp-tools-badge"
												class:loading={toolsState?.loading}
												class:error={toolsState?.error}
												class:has-tools={toolsState?.tools && toolsState.tools.length > 0}
												onclick={() => toggleToolsList(serverId)}
												title={toolsState?.error ?? (toolsState?.tools ? `${toolsState.tools.length} tools available` : "Click to load tools")}
											>
												{#if toolsState?.loading}
													<Icon name="loader" size="xs" />
													<span>...</span>
												{:else if toolsState?.error}
													<Icon name="alert-circle" size="xs" />
													<span>Error</span>
												{:else if toolsState?.tools}
													<Icon name="wrench" size="xs" />
													<span>{toolsState.tools.length} tools</span>
												{:else}
													<Icon name="wrench" size="xs" />
													<span>Load tools</span>
												{/if}
											</button>
										</div>
										<div class="mcp-server-details">
											{#if config.transport === "stdio"}
												<code>{config.command} {config.args.join(" ")}</code>
											{:else if config.transport === "http" || config.transport === "sse"}
												<code>{config.url}</code>
											{/if}
										</div>

										{#if isExpanded && toolsState}
											<div class="mcp-tools-list">
												{#if toolsState.loading}
													<div class="mcp-tools-loading">Loading tools...</div>
												{:else if toolsState.error}
													<div class="mcp-tools-error">
														<Icon name="alert-circle" size="s" />
														<span>{toolsState.error}</span>
														<button class="mcp-tools-retry" onclick={() => fetchServerTools(serverId)}>
															Retry
														</button>
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
									</div>
									<div class="mcp-server-controls">
										<IconButton
											icon="pencil"
											label="Edit {config.displayName}"
											onclick={() => openEditMCPServer(serverId)}
										/>
										<Toggle isToggled={config.enabled} changeFunc={() => toggleMCPServer(serverId)} />
									</div>
								</div>
							{/if}
						{/each}
					</div>
				{:else}
					<div class="mcp-empty-state">
						<p>No MCP servers configured for this agent.</p>
					</div>
				{/if}
			</SettingGroup>
		{:else}
			<div class="no-agent-selected">
				<p>No agent selected.</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.agents-settings {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* Agent Selector Header */
	.agent-selector-header {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.agent-selector-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.agent-dropdown-wrapper {
		min-width: 180px;
	}

	.agent-actions {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	/* Agent Editor Content */
	.agent-editor-content {
		flex: 1;
		min-width: 0;
	}

	.no-agent-selected {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 200px;
		color: var(--text-muted);
	}

	/* Color Picker */
	.color-picker {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.color-swatch {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 2px solid transparent;
		background-color: var(--swatch-color);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
		padding: 0;
		color: white;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	}

	.color-swatch:hover {
		transform: scale(1.1);
	}

	.color-swatch.selected {
		border-color: var(--text-normal);
		box-shadow: 0 0 0 2px var(--background-primary);
	}

	.color-swatch.none {
		background: linear-gradient(
			135deg,
			var(--background-secondary) 45%,
			var(--background-modifier-border) 45%,
			var(--background-modifier-border) 55%,
			var(--background-secondary) 55%
		);
		color: var(--text-muted);
	}

	/* Plugin Extensions */
	.plugin-extension-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 0;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.plugin-extension-item:last-child {
		border-bottom: none;
	}

	.plugin-extension-info {
		flex: 1;
	}

	.plugin-extension-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.plugin-extension-name {
		font-weight: 500;
	}

	.plugin-extension-badge {
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		font-weight: 500;
	}

	.plugin-extension-badge.not-enabled,
	.plugin-extension-badge.not-installed {
		background: var(--background-modifier-border);
		color: var(--text-muted);
	}

	.plugin-extension-badge.clickable {
		cursor: pointer;
		border: none;
		transition: opacity 0.15s ease;
	}

	.plugin-extension-badge.clickable:hover {
		opacity: 0.8;
		text-decoration: underline;
	}

	.plugin-extension-controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* Tools Styles */
	.tool-item {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 12px 0;
		border-bottom: 1px solid var(--background-modifier-border);
		gap: 16px;
	}

	.tool-item:last-child {
		border-bottom: none;
	}

	.tool-info {
		flex: 1;
		min-width: 0;
	}

	.tool-header {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.tool-name {
		font-weight: 500;
	}

	.tool-description {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-top: 4px;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.tool-badge {
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		font-weight: 500;
	}

	.tool-badge.not-installed {
		background: var(--background-modifier-border);
		color: var(--text-muted);
	}

	.tool-badge.clickable {
		cursor: pointer;
		border: none;
		transition: opacity 0.15s ease;
	}

	.tool-badge.clickable:hover {
		opacity: 0.8;
		text-decoration: underline;
	}

	.tool-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	/* MCP Servers Styles */
	.mcp-add-button {
		margin-bottom: 16px;
	}

	.mcp-servers-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.mcp-server-item {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 12px 0;
		border-bottom: 1px solid var(--background-modifier-border);
		gap: 16px;
	}

	.mcp-server-item:last-child {
		border-bottom: none;
	}

	.mcp-server-info {
		flex: 1;
		min-width: 0;
	}

	.mcp-server-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mcp-server-name {
		font-weight: 500;
	}

	.mcp-server-badge {
		font-size: 0.65rem;
		padding: 2px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		font-weight: 500;
	}

	.mcp-server-badge.stdio {
		background: rgba(var(--color-green-rgb, 76, 175, 80), 0.2);
		color: var(--text-success, #4caf50);
	}

	.mcp-server-badge.http {
		background: rgba(var(--color-blue-rgb, 33, 150, 243), 0.2);
		color: var(--text-accent, #2196f3);
	}

	.mcp-server-badge.sse {
		background: rgba(var(--color-yellow-rgb, 255, 193, 7), 0.2);
		color: var(--text-warning, #ffc107);
	}

	.mcp-server-details {
		margin-top: 4px;
	}

	.mcp-server-details code {
		font-size: 0.8rem;
		color: var(--text-muted);
		background: var(--background-secondary);
		padding: 2px 6px;
		border-radius: 4px;
		display: inline-block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mcp-server-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.mcp-empty-state {
		padding: 16px;
		text-align: center;
		color: var(--text-muted);
		background: var(--background-secondary);
		border-radius: 8px;
	}

	.mcp-empty-state p {
		margin: 0;
	}

	/* Tools badge */
	.mcp-tools-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.7rem;
		padding: 2px 8px;
		border-radius: 10px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.mcp-tools-badge:hover {
		background: var(--background-modifier-hover);
		border-color: var(--text-muted);
	}

	.mcp-tools-badge.loading {
		opacity: 0.7;
	}

	.mcp-tools-badge.has-tools {
		background: rgba(var(--color-green-rgb, 76, 175, 80), 0.15);
		border-color: var(--text-success, #4caf50);
		color: var(--text-success, #4caf50);
	}

	.mcp-tools-badge.error {
		background: rgba(var(--color-red-rgb, 244, 67, 54), 0.15);
		border-color: var(--text-error, #f44336);
		color: var(--text-error, #f44336);
	}

	/* Expanded tools list */
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

	.mcp-tools-retry:hover {
		background: var(--background-modifier-hover);
	}

	.mcp-tool-item {
		display: flex;
		flex-direction: column;
		padding: 8px;
		margin-bottom: 4px;
		background: var(--background-primary);
		border-radius: 4px;
	}

	.mcp-tool-item:last-child {
		margin-bottom: 0;
	}

	.mcp-tool-name {
		font-weight: 500;
		font-family: var(--font-monospace);
		font-size: 0.85rem;
	}

	.mcp-tool-desc {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-top: 2px;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* Utilities */
	.text-muted {
		color: var(--text-muted);
	}

	.text-sm {
		font-size: 0.85rem;
	}

	.mb-3 {
		margin-bottom: 12px;
	}
</style>
