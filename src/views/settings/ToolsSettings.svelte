<script lang="ts">
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { MCPServerModal } from "../../components/modal/MCPServerModal";
import { ToolConfigModal } from "../../components/modal/ToolConfigModal";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import Button from "../../components/ui/Button.svelte";
import Icon from "../../components/ui/Icon.svelte";
import IconButton from "../../components/ui/IconButton.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { createObsidianFetch } from "../../lib/obsidianFetch";
import type { BuiltInToolId, MCPServerConfig } from "../../main";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const pluginData = getData();
const plugin = getPlugin();

// Auto-apply changes by reinitializing the agent
function applyChanges() {
	// Fire and forget - reinitialize in background
	plugin.agentManager.reinitialize().catch((error) => {
		console.error("Failed to reinitialize agent:", error);
	});
}

// Force reactivity on MCP servers
let mcpServerIds = $derived(pluginData.getMCPServerIds());

// MCP server tools cache
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

/**
 * Tool metadata for display in settings
 */
interface ToolInfo {
	id: BuiltInToolId;
	defaultName: string;
	defaultDescription: string;
	/** Optional plugin dependency - if set, tool requires this Obsidian plugin */
	requiresPlugin?: {
		id: string;
		name: string;
	};
}

/**
 * All available built-in tools with their metadata
 */
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

// Check if plugins are installed/enabled
function isPluginInstalled(pluginId: string): boolean {
	// @ts-ignore - Obsidian plugin API
	return !!plugin.app.plugins?.getPlugin?.(pluginId);
}

// Get tool display name (custom or default)
function getToolDisplayName(toolId: BuiltInToolId): string {
	const config = pluginData.getToolConfig(toolId);
	const defaultTool = TOOLS.find((t) => t.id === toolId);
	// Convert snake_case to Title Case for display
	const name = config?.name ?? defaultTool?.defaultName ?? toolId;
	if (name.includes("_")) {
		return name
			.split("_")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");
	}
	return name;
}

// Get tool description (custom or default)
function getToolDescription(toolId: BuiltInToolId): string {
	const config = pluginData.getToolConfig(toolId);
	const defaultTool = TOOLS.find((t) => t.id === toolId);
	return config?.description ?? defaultTool?.defaultDescription ?? "";
}

// Handle tool toggle
function handleToolToggle(toolId: BuiltInToolId) {
	pluginData.toggleToolEnabled(toolId);
	applyChanges();
}

// Get tool enabled state (reactive)
function getToolEnabled(toolId: BuiltInToolId): boolean {
	return pluginData.isToolEnabled(toolId);
}

// Open plugin page in Obsidian
function openPluginPage(pluginId: string) {
	window.open(`obsidian://show-plugin?id=${pluginId}`);
}

// Open tool configuration modal
function openToolConfig(toolId: BuiltInToolId) {
	const modal = new ToolConfigModal(plugin, toolId, () => {
		// Tool config saved - apply changes
		applyChanges();
	});
	modal.open();
}

// MCP Server functions
function openAddMCPServer() {
	const modal = new MCPServerModal(plugin, null, null, () => {
		// Trigger reactivity
		mcpServerIds = pluginData.getMCPServerIds();
		applyChanges();
	});
	modal.open();
}

function openEditMCPServer(serverId: string) {
	const config = pluginData.getMCPServer(serverId);
	if (config) {
		const modal = new MCPServerModal(plugin, serverId, config, () => {
			// Trigger reactivity
			mcpServerIds = pluginData.getMCPServerIds();
			applyChanges();
		});
		modal.open();
	}
}

function toggleMCPServer(serverId: string) {
	pluginData.toggleMCPServerEnabled(serverId);
	applyChanges();
}

function getMCPServerConfig(serverId: string): MCPServerConfig | undefined {
	return pluginData.getMCPServer(serverId);
}

// Build MCP config for a single server
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

// Fetch tools for an MCP server
async function fetchServerTools(serverId: string) {
	const config = pluginData.getMCPServer(serverId);
	if (!config) return;

	// Set loading state
	mcpServerTools[serverId] = { loading: true, error: null, tools: [] };

	try {
		// Patch fetch for CORS bypass
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

// Toggle expanded state and fetch tools if needed
function toggleToolsList(serverId: string) {
	if (expandedServerId === serverId) {
		expandedServerId = null;
	} else {
		expandedServerId = serverId;
		// Fetch tools if not already loaded
		if (!mcpServerTools[serverId] || mcpServerTools[serverId].error) {
			fetchServerTools(serverId);
		}
	}
}

// Get tools state for a server
function getServerToolsState(serverId: string): MCPServerToolsState | undefined {
	return mcpServerTools[serverId];
}
</script>

<!-- Built-in Tools -->
<SettingGroup heading="Built-in Tools">
	<div class="setting-item-description mb-3">
		Enable or disable specific tools that the AI agent can use. Click the settings icon to customize tool name,
		description, and options.
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

<!-- MCP Tools -->
<SettingGroup heading="MCP Servers">
	<div class="setting-item-description mb-3">
		MCP (Model Context Protocol) servers extend the agent with external tools.
		Add servers running locally via command or connect to remote SSE servers.
	</div>

	<!-- Add Server Button -->
	<div class="mcp-add-button">
		<Button buttonText="Add MCP Server" iconId="plus" onClick={openAddMCPServer} />
	</div>

	<!-- Server List -->
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
								<!-- Tools badge -->
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

							<!-- Expanded tools list -->
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
			<p>No MCP servers configured. Click "Add MCP Server" to get started.</p>
		</div>
	{/if}
</SettingGroup>

<style>
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
		background: var(--color-green-rgb, 76, 175, 80);
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
</style>
