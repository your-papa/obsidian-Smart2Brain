<script lang="ts">
import type { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { Notice, Platform } from "obsidian";
import { onMount } from "svelte";
import { installObsidianFetch } from "../../lib/obsidianFetch";
import type SecondBrainPlugin from "../../main";
import type { MCPHTTPServerConfig, MCPServerConfig, MCPStdioServerConfig, MCPTransportType } from "../../types/plugin";
import { getData } from "../../stores/dataStore.svelte";
import { Logger } from "../../utils/logging";
import Button from "../ui/Button.svelte";
import Dropdown from "../ui/Dropdown.svelte";
import Icon from "../ui/Icon.svelte";
import Text from "../ui/Text.svelte";
import Toggle from "../ui/Toggle.svelte";
import { confirmDelete } from "./ConfirmModal";
import ModalField from "../settings/ModalField.svelte";
import SettingContainer from "../settings/SettingContainer.svelte";
import SettingGroup from "../settings/SettingGroup.svelte";
import TextArea from "../ui/TextArea.svelte";
import type { MCPServerAccessors, MCPServerModal, MCPServerModalCallback } from "./MCPServerModal";

interface Props {
	modal: MCPServerModal;
	plugin: SecondBrainPlugin;
	serverId: string | null;
	existingConfig: MCPServerConfig | null;
	onSave: MCPServerModalCallback;
	accessors: MCPServerAccessors;
}

const {
	modal,
	plugin,
	serverId: capturedServerId,
	existingConfig: capturedExistingConfig,
	onSave,
	accessors,
}: Props = $props();

// Capture initial values at component creation (props don't change for modals)
const isEditing = (() => !!capturedServerId && !!capturedExistingConfig)();
const initialConfig = (() => capturedExistingConfig)();

// Generate server ID from name (lowercase, replace spaces/special chars with dashes)
function generateServerId(input: string): string {
	return input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// Form state - initialized from captured initial values
let name = $state(initialConfig?.displayName ?? "");
let enabled = $state(initialConfig?.enabled ?? true);
// stdio is desktop-only; if a mobile user opens an existing stdio server
// (e.g. synced from desktop), fall back to http so the dropdown selection
// stays valid rather than showing an absent option.
let transport = $state<MCPTransportType>(Platform.isDesktopApp ? (initialConfig?.transport ?? "http") : "http");

// stdio-specific fields
let command = $state((initialConfig as MCPStdioServerConfig)?.command ?? "");
let args = $state((initialConfig as MCPStdioServerConfig)?.args?.join(" ") ?? "");
let envVars = $state(
	Object.entries((initialConfig as MCPStdioServerConfig)?.env ?? {})
		.map(([k, v]) => `${k}=${v}`)
		.join("\n"),
);

// HTTP-specific fields
let url = $state((initialConfig as MCPHTTPServerConfig)?.url ?? "");
let headers = $state(
	Object.entries((initialConfig as MCPHTTPServerConfig)?.headers ?? {})
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n"),
);

// Test connection state
let isTesting = $state(false);
let testError = $state<string | null>(null);
let discoveredTools = $state<{ name: string; description?: string }[]>([]);
let testSuccess = $state(false);

// Transport options. stdio spawns a local process (Node child_process), which
// is desktop-only — AgentManager skips all MCP loading on mobile, so don't let
// mobile users configure a transport that would silently never load.
const transportOptions = [
	{ display: "Remote Server (HTTP)", value: "http" as MCPTransportType },
	...(Platform.isDesktopApp ? [{ display: "Local Command (stdio)", value: "stdio" as MCPTransportType }] : []),
];

onMount(() => {
	modal.setTitle(isEditing ? `Edit MCP Server: ${capturedExistingConfig?.displayName}` : "Add MCP Server");
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
	if (!isEditing || newServerId !== capturedServerId) {
		if (accessors.hasServer(newServerId)) {
			return "A server with this name already exists";
		}
	}

	if (transport === "stdio") {
		if (!command.trim()) {
			return "Command is required for stdio transport";
		}
	} else {
		if (!url.trim()) {
			return "URL is required for HTTP transport";
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
	} else {
		config = {
			displayName: name.trim(),
			transport: "http",
			enabled,
			url: url.trim(),
			headers: parseHeaders(headers),
		};
	}

	onSave(newServerId, config);
	modal.close();
}

async function handleDelete() {
	if (capturedServerId && capturedExistingConfig) {
		if (!(await confirmDelete(plugin.app, capturedExistingConfig.displayName || capturedServerId))) return;
		// Pass the deleted server info to callback with enabled: false to indicate deletion
		onSave(capturedServerId, { ...capturedExistingConfig, enabled: false });
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
		// Ref-counted global-fetch patch for CORS bypass — safe under concurrency
		// (unlike the old _originalFetch flag + finally-restore, which corrupted
		// when two probes overlapped).
		const patch = installObsidianFetch();
		let mcpClient: MultiServerMCPClient | undefined;
		try {
			const config = buildTestConfig();
			Logger.log("Testing MCP connection with config:", config);

			const { MultiServerMCPClient } = await import("@langchain/mcp-adapters");
			mcpClient = new MultiServerMCPClient(config);
			const tools = await mcpClient.getTools();

			discoveredTools = tools.map((t) => ({
				name: t.name,
				description: (t as { description?: string }).description,
			}));
			testSuccess = true;

			new Notice(`Connection successful! Found ${tools.length} tool(s).`);
		} finally {
			// Close the client so a stdio server's spawned child process / open
			// session doesn't dangle after a one-off connection test.
			try {
				await mcpClient?.close();
			} catch (closeErr) {
				Logger.debug("MCP client close failed after test:", closeErr);
			}
			patch.release();
		}
	} catch (err) {
		Logger.error("MCP connection test failed:", err);
		testError = err instanceof Error ? err.message : "Connection failed";
		new Notice(`Connection failed: ${testError}`);
	} finally {
		isTesting = false;
	}
}
</script>

<div class="mcp-modal-content">
  <!-- Short controls use the native horizontal settings row (name/desc left,
       control right). The wide inputs below stay on ModalField's stacked
       variant, which exists because a URL or a KEY=VALUE textarea needs the
       full modal width rather than the right-hand column. -->
  <SettingGroup heading="Server">
    <SettingContainer name="Name" desc="A name for this MCP server">
      <Text
        id="mcp-server-name"
        inputType="text"
        value={name}
        placeholder="My MCP Server"
        onblur={(v) => (name = v)}
      />
    </SettingContainer>

    <SettingContainer name="Enabled" desc="Whether this server is active and provides tools">
      <Toggle checked={enabled} onchange={(checked) => (enabled = checked)} />
    </SettingContainer>

    <SettingContainer name="Transport type" desc="How to connect to the MCP server">
      <Dropdown
        id="mcp-server-transport"
        type="options"
        dropdown={transportOptions}
        selected={transport}
        onchange={(v) => (transport = v)}
      />
    </SettingContainer>
  </SettingGroup>

  {#if transport === "stdio"}
    <SettingGroup heading="Command Configuration">
      <ModalField
        label="Command"
        desc="The executable to run (e.g., npx, node, python)"
        for="mcp-server-command"
      >
        <Text
          id="mcp-server-command"
          inputType="text"
          value={command}
          placeholder="npx"
          onblur={(v) => (command = v)}
        />
      </ModalField>

      <ModalField
        label="Arguments"
        desc="Command arguments, space-separated (use quotes for args with spaces)"
        for="mcp-server-arguments"
      >
        <Text
          id="mcp-server-arguments"
          inputType="text"
          value={args}
          placeholder="-y @anthropic/mcp-server-filesystem /path/to/dir"
          onblur={(v) => (args = v)}
        />
      </ModalField>

      <ModalField
        label="Environment Variables (optional)"
        desc="One per line in KEY=VALUE format"
        for="mcp-server-env"
      >
        <TextArea
          id="mcp-server-env"
          class="mcp-textarea"
          bind:value={envVars}
          placeholder={"API_KEY=your-key\nDEBUG=true"}
        />
      </ModalField>
    </SettingGroup>
  {/if}

  {#if transport === "http"}
    <SettingGroup heading="Server Configuration">
      <ModalField label="Server URL" desc="The URL of the MCP server" for="mcp-server-url">
        <Text
          id="mcp-server-url"
          inputType="text"
          value={url}
          placeholder="https://mcp.example.com/mcp"
          onblur={(v) => (url = v)}
        />
      </ModalField>

      <ModalField
        label="Headers (optional)"
        desc="One per line in Header-Name: value format"
        for="mcp-server-headers"
      >
        <TextArea
          id="mcp-server-headers"
          class="mcp-textarea"
          bind:value={headers}
          placeholder={"Authorization: Bearer token\nX-Custom-Header: value"}
        />
      </ModalField>
    </SettingGroup>
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

  <!-- Actions. `modal-button-container` is Obsidian's own footer class, so these
       sit where a core modal's buttons do. Delete/Test are pushed to the left
       edge since they are not the confirm action. -->
  <div class="modal-button-container mcp-actions">
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

  :global(.mcp-textarea) {
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

  :global(.mcp-textarea):focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--interactive-accent);
  }

  /* `modal-button-container` supplies the border, padding and spacing; this only
     adds what it doesn't: a flex row so the `.flex-1` spacer can push Cancel/Save
     right while Delete/Test stay left, and wrapping for narrow panes. */
  .mcp-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* Phone: core stacks `.modal-button-container` into a column; the row-oriented
     `align-items: center` above would shrink each button to its label width.
     Stretch restores the native full-width stacked footer buttons. */
  :global(.is-phone) .mcp-actions {
    align-items: stretch;
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
