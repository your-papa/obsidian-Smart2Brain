<script lang="ts">
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { Notice } from "obsidian";
import { onMount } from "svelte";
import { createObsidianFetch } from "../../lib/obsidianFetch";
import type SecondBrainPlugin from "../../main";
import type {
	MCPHTTPServerConfig,
	MCPServerConfig,
	MCPSSEServerConfig,
	MCPStdioServerConfig,
	MCPTransportType,
} from "../../main";
import { getData } from "../../stores/dataStore.svelte";
import Button from "../ui/Button.svelte";
import Dropdown from "../ui/Dropdown.svelte";
import Icon from "../ui/Icon.svelte";
import Text from "../ui/Text.svelte";
import Toggle from "../ui/Toggle.svelte";
import type { MCPServerModal, MCPServerModalCallback } from "./MCPServerModal";

interface Props {
	modal: MCPServerModal;
	plugin: SecondBrainPlugin;
	serverId: string | null;
	existingConfig: MCPServerConfig | null;
	onSave: MCPServerModalCallback;
	skipGlobalSave?: boolean;
}

const { modal, plugin, serverId, existingConfig, onSave, skipGlobalSave = false }: Props = $props();
const pluginData = getData();

const isEditing = !!serverId && !!existingConfig;

// Form state - just use name, derive ID from it
let name = $state(existingConfig?.displayName ?? "");
let enabled = $state(existingConfig?.enabled ?? true);

// Generate server ID from name (lowercase, replace spaces/special chars with dashes)
function generateServerId(input: string): string {
	return input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
let transport = $state<MCPTransportType>(existingConfig?.transport ?? "http");

// stdio-specific fields
let command = $state((existingConfig as MCPStdioServerConfig)?.command ?? "");
let args = $state((existingConfig as MCPStdioServerConfig)?.args?.join(" ") ?? "");
let envVars = $state(
	Object.entries((existingConfig as MCPStdioServerConfig)?.env ?? {})
		.map(([k, v]) => `${k}=${v}`)
		.join("\n"),
);

// HTTP/SSE-specific fields (shared URL and headers)
let url = $state((existingConfig as MCPHTTPServerConfig | MCPSSEServerConfig)?.url ?? "");
let headers = $state(
	Object.entries((existingConfig as MCPHTTPServerConfig | MCPSSEServerConfig)?.headers ?? {})
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n"),
);

// Test connection state
let isTesting = $state(false);
let testError = $state<string | null>(null);
let discoveredTools = $state<{ name: string; description?: string }[]>([]);
let testSuccess = $state(false);

// Transport options
const transportOptions = [
	{ display: "Remote Server (HTTP)", value: "http" as MCPTransportType },
	{ display: "Local Command (stdio)", value: "stdio" as MCPTransportType },
	{ display: "Remote Server (SSE) - Legacy", value: "sse" as MCPTransportType },
];

onMount(() => {
	modal.setTitle(isEditing ? `Edit MCP Server: ${existingConfig?.displayName}` : "Add MCP Server");
});

function parseArgs(input: string): string[] {
	// Split by spaces, but respect quoted strings
	const result: string[] = [];
	let current = "";
	let inQuote = false;
	let quoteChar = "";

	for (const char of input) {
		if ((char === '"' || char === "'") && !inQuote) {
			inQuote = true;
			quoteChar = char;
		} else if (char === quoteChar && inQuote) {
			inQuote = false;
			quoteChar = "";
		} else if (char === " " && !inQuote) {
			if (current) {
				result.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}
	if (current) {
		result.push(current);
	}
	return result;
}

function parseEnvVars(input: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of input.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || !trimmed.includes("=")) continue;
		const eqIndex = trimmed.indexOf("=");
		const key = trimmed.slice(0, eqIndex).trim();
		const value = trimmed.slice(eqIndex + 1).trim();
		if (key) {
			result[key] = value;
		}
	}
	return result;
}

function parseHeaders(input: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of input.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || !trimmed.includes(":")) continue;
		const colonIndex = trimmed.indexOf(":");
		const key = trimmed.slice(0, colonIndex).trim();
		const value = trimmed.slice(colonIndex + 1).trim();
		if (key) {
			result[key] = value;
		}
	}
	return result;
}

function validateForm(): string | null {
	if (!name.trim()) {
		return "Name is required";
	}

	const newServerId = generateServerId(name);
	if (!newServerId) {
		return "Name must contain at least one letter or number";
	}

	// Check for duplicate ID (only when creating new or changing name)
	if (!isEditing || newServerId !== serverId) {
		if (pluginData.getMCPServer(newServerId)) {
			return "A server with this name already exists";
		}
	}

	if (transport === "stdio") {
		if (!command.trim()) {
			return "Command is required for stdio transport";
		}
	} else if (transport === "http" || transport === "sse") {
		if (!url.trim()) {
			return "URL is required for HTTP/SSE transport";
		}
		try {
			new URL(url.trim());
		} catch {
			return "Invalid URL format";
		}
	}

	return null;
}

function handleSave() {
	const error = validateForm();
	if (error) {
		new Notice(error);
		return;
	}

	const newServerId = generateServerId(name);

	let config: MCPServerConfig;
	if (transport === "stdio") {
		config = {
			displayName: name.trim(),
			transport: "stdio",
			enabled,
			command: command.trim(),
			args: parseArgs(args),
			env: parseEnvVars(envVars),
		};
	} else if (transport === "http") {
		config = {
			displayName: name.trim(),
			transport: "http",
			enabled,
			url: url.trim(),
			headers: parseHeaders(headers),
		};
	} else {
		config = {
			displayName: name.trim(),
			transport: "sse",
			enabled,
			url: url.trim(),
			headers: parseHeaders(headers),
		};
	}

	// If not skipping global save, handle the data store operations
	if (!skipGlobalSave) {
		// If editing and ID changed, delete old entry
		if (isEditing && serverId && newServerId !== serverId) {
			pluginData.deleteMCPServer(serverId);
		}
		pluginData.setMCPServer(newServerId, config);
	}

	onSave(newServerId, config);
	modal.close();
}

function handleDelete() {
	if (serverId && existingConfig) {
		if (!skipGlobalSave) {
			pluginData.deleteMCPServer(serverId);
		}
		// Pass the deleted server info to callback with enabled: false to indicate deletion
		onSave(serverId, { ...existingConfig, enabled: false });
		modal.close();
	}
}

/**
 * Build a config object for testing from current form state
 */
function buildTestConfig() {
	const testServerId = "test-server";

	if (transport === "stdio") {
		return {
			mcpServers: {
				[testServerId]: {
					transport: "stdio" as const,
					command: command.trim(),
					args: parseArgs(args),
					env: parseEnvVars(envVars),
				},
			},
		};
	}
	if (transport === "http") {
		return {
			mcpServers: {
				[testServerId]: {
					transport: "http" as const,
					url: url.trim(),
					headers: parseHeaders(headers),
				},
			},
		};
	}
	// SSE (legacy)
	return {
		mcpServers: {
			[testServerId]: {
				transport: "sse" as const,
				url: url.trim(),
				headers: parseHeaders(headers),
			},
		},
	};
}

/**
 * Test the MCP server connection and discover tools
 */
async function handleTestConnection() {
	// Validate form first
	const error = validateForm();
	if (error) {
		new Notice(error);
		return;
	}

	// Reset state
	isTesting = true;
	testError = null;
	discoveredTools = [];
	testSuccess = false;

	try {
		// Patch fetch for CORS bypass (same as in AgentManager)
		const windowWithFetch = window as Window & { _originalFetch?: typeof fetch };
		const needsPatch = !windowWithFetch._originalFetch;

		if (needsPatch) {
			windowWithFetch._originalFetch = window.fetch;
			window.fetch = createObsidianFetch(windowWithFetch._originalFetch);
		}

		try {
			const config = buildTestConfig();
			console.log("Testing MCP connection with config:", config);

			const mcpClient = new MultiServerMCPClient(config);
			const tools = await mcpClient.getTools();

			discoveredTools = tools.map((t) => ({
				name: t.name,
				description: (t as { description?: string }).description,
			}));
			testSuccess = true;

			new Notice(`Connection successful! Found ${tools.length} tool(s).`);
		} finally {
			// Restore original fetch if we patched it
			if (needsPatch && windowWithFetch._originalFetch) {
				window.fetch = windowWithFetch._originalFetch;
				windowWithFetch._originalFetch = undefined;
			}
		}
	} catch (err) {
		console.error("MCP connection test failed:", err);
		testError = err instanceof Error ? err.message : "Connection failed";
		new Notice(`Connection failed: ${testError}`);
	} finally {
		isTesting = false;
	}
}
</script>

<div class="mcp-modal-content">
	<!-- Name -->
	<div class="mcp-field">
		<label class="mcp-label">Name</label>
		<p class="mcp-description">A name for this MCP server</p>
		<Text inputType="text" value={name} placeholder="My MCP Server" onblur={(v) => (name = v)} />
	</div>

	<!-- Enabled Toggle -->
	<div class="mcp-field mcp-field-row">
		<div>
			<label class="mcp-label">Enabled</label>
			<p class="mcp-description">Whether this server is active and provides tools</p>
		</div>
		<Toggle isToggled={enabled} changeFunc={() => (enabled = !enabled)} />
	</div>

	<!-- Transport Type -->
	<div class="mcp-field">
		<label class="mcp-label">Transport Type</label>
		<p class="mcp-description">How to connect to the MCP server</p>
		<Dropdown type="options" dropdown={transportOptions} selected={transport} onSelect={(v) => (transport = v)} />
	</div>

	<!-- stdio-specific fields -->
	{#if transport === "stdio"}
		<div class="mcp-section">
			<h4 class="mcp-section-title">Command Configuration</h4>

			<div class="mcp-field">
				<label class="mcp-label">Command</label>
				<p class="mcp-description">The executable to run (e.g., npx, node, python)</p>
				<Text inputType="text" value={command} placeholder="npx" onblur={(v) => (command = v)} />
			</div>

			<div class="mcp-field">
				<label class="mcp-label">Arguments</label>
				<p class="mcp-description">Command arguments, space-separated (use quotes for args with spaces)</p>
				<Text
					inputType="text"
					value={args}
					placeholder="-y @anthropic/mcp-server-filesystem /path/to/dir"
					onblur={(v) => (args = v)}
				/>
			</div>

			<div class="mcp-field">
				<label class="mcp-label">Environment Variables (optional)</label>
				<p class="mcp-description">One per line in KEY=VALUE format</p>
				<textarea class="mcp-textarea" bind:value={envVars} placeholder="API_KEY=your-key&#10;DEBUG=true"></textarea>
			</div>
		</div>
	{/if}

	<!-- HTTP/SSE-specific fields -->
	{#if transport === "http" || transport === "sse"}
		<div class="mcp-section">
			<h4 class="mcp-section-title">Server Configuration</h4>

			{#if transport === "sse"}
				<div class="mcp-warning">
					SSE transport may have CORS issues in Obsidian. Consider using HTTP transport instead.
				</div>
			{/if}

			<div class="mcp-field">
				<label class="mcp-label">Server URL</label>
				<p class="mcp-description">The URL of the MCP server</p>
				<Text inputType="text" value={url} placeholder="https://mcp.example.com/mcp" onblur={(v) => (url = v)} />
			</div>

			<div class="mcp-field">
				<label class="mcp-label">Headers (optional)</label>
				<p class="mcp-description">One per line in Header-Name: value format</p>
				<textarea
					class="mcp-textarea"
					bind:value={headers}
					placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
				></textarea>
			</div>
		</div>
	{/if}

	<!-- Test Results -->
	{#if testSuccess && discoveredTools.length > 0}
		<div class="mcp-test-results success">
			<div class="mcp-test-header">
				<Icon name="check-circle" />
				<span>Connection successful - {discoveredTools.length} tool(s) available</span>
			</div>
			<div class="mcp-tools-list">
				{#each discoveredTools as tool (tool.name)}
					<div class="mcp-tool-item">
						<span class="mcp-tool-name">{tool.name}</span>
						{#if tool.description}
							<span class="mcp-tool-desc">{tool.description}</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{:else if testSuccess && discoveredTools.length === 0}
		<div class="mcp-test-results warning">
			<div class="mcp-test-header">
				<Icon name="alert-triangle" />
				<span>Connected but no tools found</span>
			</div>
		</div>
	{:else if testError}
		<div class="mcp-test-results error">
			<div class="mcp-test-header">
				<Icon name="x-circle" />
				<span>Connection failed</span>
			</div>
			<p class="mcp-test-error">{testError}</p>
		</div>
	{/if}

	<!-- Actions -->
	<div class="mcp-actions">
		{#if isEditing}
			<Button buttonText="Delete" styles="mod-warning" onClick={handleDelete} />
		{/if}
		<Button
			buttonText={isTesting ? "Testing..." : "Test Connection"}
			onClick={handleTestConnection}
			disabled={isTesting}
		/>
		<div class="flex-1"></div>
		<Button buttonText="Cancel" onClick={() => modal.close()} />
		<Button buttonText={isEditing ? "Save" : "Add Server"} cta={true} onClick={handleSave} />
	</div>
</div>

<style>
	.mcp-modal-content {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 8px 0;
	}

	.mcp-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.mcp-field-row {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	.mcp-label {
		font-weight: 500;
		font-size: 0.95rem;
	}

	.mcp-description {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin: 0 0 4px 0;
	}

	.mcp-section {
		border-top: 1px solid var(--background-modifier-border);
		padding-top: 16px;
	}

	.mcp-section-title {
		font-weight: 600;
		font-size: 0.9rem;
		margin: 0 0 12px 0;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.mcp-warning {
		padding: 8px 12px;
		margin-bottom: 12px;
		border-radius: 4px;
		background: rgba(var(--color-yellow-rgb, 255, 193, 7), 0.15);
		border: 1px solid var(--text-warning, #ffc107);
		color: var(--text-warning, #ffc107);
		font-size: 0.85rem;
	}

	.mcp-textarea {
		width: 100%;
		min-height: 80px;
		padding: 8px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-secondary);
		color: var(--text-normal);
		font-family: var(--font-monospace);
		font-size: 0.9rem;
		resize: vertical;
	}

	.mcp-textarea:focus {
		outline: none;
		border-color: var(--interactive-accent);
		box-shadow: 0 0 0 1px var(--interactive-accent);
	}

	.mcp-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		border-top: 1px solid var(--background-modifier-border);
		padding-top: 16px;
		margin-top: 8px;
	}

	/* Test Results Styles */
	.mcp-test-results {
		padding: 12px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
	}

	.mcp-test-results.success {
		background: rgba(var(--color-green-rgb, 76, 175, 80), 0.1);
		border-color: var(--text-success, #4caf50);
	}

	.mcp-test-results.warning {
		background: rgba(var(--color-yellow-rgb, 255, 193, 7), 0.1);
		border-color: var(--text-warning, #ffc107);
	}

	.mcp-test-results.error {
		background: rgba(var(--color-red-rgb, 244, 67, 54), 0.1);
		border-color: var(--text-error, #f44336);
	}

	.mcp-test-header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 500;
	}

	.mcp-test-results.success .mcp-test-header {
		color: var(--text-success, #4caf50);
	}

	.mcp-test-results.warning .mcp-test-header {
		color: var(--text-warning, #ffc107);
	}

	.mcp-test-results.error .mcp-test-header {
		color: var(--text-error, #f44336);
	}

	.mcp-test-error {
		margin: 8px 0 0 0;
		font-size: 0.85rem;
		color: var(--text-muted);
		font-family: var(--font-monospace);
	}

	.mcp-tools-list {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 200px;
		overflow-y: auto;
	}

	.mcp-tool-item {
		display: flex;
		flex-direction: column;
		padding: 8px;
		background: var(--background-secondary);
		border-radius: 4px;
	}

	.mcp-tool-name {
		font-weight: 500;
		font-family: var(--font-monospace);
		font-size: 0.9rem;
	}

	.mcp-tool-desc {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-top: 2px;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
