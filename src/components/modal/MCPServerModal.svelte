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
import { confirmDelete } from "./ConfirmModal";
import SettingContainer from "../settings/SettingContainer.svelte";
import SettingGroup from "../settings/SettingGroup.svelte";
import TextArea from "../ui/TextArea.svelte";
import type {
	MCPServerAccessors,
	MCPServerModal,
	MCPServerModalCallback,
	MCPServerModalDeleteCallback,
} from "./MCPServerModal";

interface Props {
	modal: MCPServerModal;
	plugin: SecondBrainPlugin;
	serverId: string | null;
	existingConfig: MCPServerConfig | null;
	onSave: MCPServerModalCallback;
	onDelete: MCPServerModalDeleteCallback | null;
	accessors: MCPServerAccessors;
}

const {
	modal,
	plugin,
	serverId: capturedServerId,
	existingConfig: capturedExistingConfig,
	onSave,
	onDelete,
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
// Enabled is deliberately NOT edited here — the server list in the agent editor
// owns that toggle. Carry the existing value through so saving an edit to a
// disabled server doesn't silently re-enable it; new servers start enabled.
const enabled = (() => initialConfig?.enabled ?? true)();
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

// JSON import. There's no separate import UI: pasting a config snippet into any
// text field is detected and unpacked into the form, the same way the chat
// composer reacts to pasted files rather than hiding them behind a panel.
// Because that silently rewrites fields the user may have already filled, the
// pre-paste values are snapshotted so the banner can offer a one-click undo.
type FormSnapshot = {
	name: string;
	transport: MCPTransportType;
	command: string;
	args: string;
	envVars: string;
	url: string;
	headers: string;
};
let importNotice = $state<string | null>(null);
let importError = $state<string | null>(null);
let importUndo = $state<FormSnapshot | null>(null);

function snapshotForm(): FormSnapshot {
	return { name, transport, command, args, envVars, url, headers };
}

function restoreForm(snapshot: FormSnapshot) {
	name = snapshot.name;
	transport = snapshot.transport;
	command = snapshot.command;
	args = snapshot.args;
	envVars = snapshot.envVars;
	url = snapshot.url;
	headers = snapshot.headers;
}

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

/**
 * Populate the form from a pasted MCP config snippet.
 *
 * Servers publish their setup as a JSON block, but the schema differs by host:
 * Claude Desktop and Cursor nest under `mcpServers`, VS Code under `servers`
 * (or `mcp.servers`) and spells the transport `type` rather than `transport`.
 * A bare single-server object (no wrapper) is accepted too, since that's what
 * people often copy out of a README. Everything is normalised onto our own
 * `MCPServerConfig` shape.
 *
 * This only fills the fields — it doesn't save. The user still reviews and
 * confirms, so a malformed or hostile snippet can't configure a server behind
 * their back.
 */
function applyImportedJson(text: string): string | null {
	const raw = text.trim();
	if (!raw) return "Paste a configuration first";

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		return `Invalid JSON: ${err instanceof Error ? err.message : "could not parse"}`;
	}
	if (!parsed || typeof parsed !== "object") {
		return "Configuration must be a JSON object";
	}

	const root = parsed as Record<string, unknown>;
	// Unwrap `{ mcp: { servers: {...} } }` (VS Code settings.json) before
	// looking for the server map.
	const mcpWrapper = root.mcp;
	const scope = (
		mcpWrapper && typeof mcpWrapper === "object" ? (mcpWrapper as Record<string, unknown>) : root
	) as Record<string, unknown>;

	const serverMapCandidate = scope.mcpServers ?? scope.servers;
	let entryKey: string | null = null;
	let entry: Record<string, unknown>;

	if (serverMapCandidate && typeof serverMapCandidate === "object") {
		const entries = Object.entries(serverMapCandidate as Record<string, unknown>).filter(
			([, v]) => v && typeof v === "object",
		);
		if (entries.length === 0) {
			return "No server entries found in the configuration";
		}
		if (entries.length > 1) {
			return "Configuration contains multiple servers — paste one at a time";
		}
		entryKey = entries[0][0];
		entry = entries[0][1] as Record<string, unknown>;
	} else if (typeof scope.url === "string" || typeof scope.command === "string") {
		// Bare single-server object with no wrapper.
		entry = scope;
	} else {
		return "Could not find an MCP server definition (expected an `mcpServers` or `servers` object)";
	}

	// `transport` is ours, `type` is VS Code's; fall back to inferring from
	// whichever of url/command is present.
	const declared = typeof entry.transport === "string" ? entry.transport : entry.type;
	const hasUrl = typeof entry.url === "string" && entry.url.trim().length > 0;
	const hasCommand = typeof entry.command === "string" && entry.command.trim().length > 0;
	// sse is a remote transport we don't model separately; treat it as http so
	// the URL still lands somewhere useful rather than being dropped silently.
	const isStdio = declared === "stdio" || (!declared && !hasUrl && hasCommand);

	if (isStdio && !Platform.isDesktopApp) {
		return "This is a local (stdio) server, which is desktop-only";
	}
	if (!isStdio && !hasUrl) {
		return "Remote server entry is missing a `url`";
	}
	if (isStdio && !hasCommand) {
		return "Local server entry is missing a `command`";
	}

	// Only name an unnamed form — never clobber a name the user already typed.
	// A bare (unwrapped) entry has no key to derive a name from, so the field can
	// legitimately stay empty here; the caller prompts for it rather than letting
	// the user discover it via a validation error on save.
	if (!name.trim()) {
		const displayName = typeof entry.displayName === "string" ? entry.displayName : null;
		name = displayName ?? entryKey ?? "";
	}

	if (isStdio) {
		transport = "stdio";
		command = (entry.command as string).trim();
		args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string").join(" ") : "";
		envVars = stringifyRecord(entry.env, "=");
	} else {
		transport = "http";
		url = (entry.url as string).trim();
		headers = stringifyRecord(entry.headers, ": ");
	}

	// A pasted config describes a different server than the one just probed.
	testSuccess = false;
	testError = null;
	discoveredTools = [];
	return null;
}

/** Render a string-valued record back into the modal's one-per-line textarea format. */
function stringifyRecord(value: unknown, separator: string): string {
	if (!value || typeof value !== "object") return "";
	return Object.entries(value as Record<string, unknown>)
		.filter(([k, v]) => k && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
		.map(([k, v]) => `${k}${separator}${String(v)}`)
		.join("\n");
}

/**
 * Does this pasted text look like a config snippet rather than a field value?
 *
 * Deliberately narrow: only text that starts with `{` and parses as a JSON
 * object qualifies. A URL, a command, a bearer token or a stray brace all fail
 * this and paste through untouched, so the detection can never eat a normal
 * paste. Anything that passes is JSON the user could not have meant as the
 * literal contents of a single field.
 */
function looksLikeConfigJson(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{")) return false;
	try {
		const parsed = JSON.parse(trimmed);
		return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
	} catch {
		return false;
	}
}

/**
 * Intercept a paste of a whole config snippet into any field.
 *
 * Returns true when the paste was consumed as an import, in which case the
 * caller prevents the default paste so the raw JSON never lands in the field.
 */
function handleConfigPaste(event: ClipboardEvent): boolean {
	const text = event.clipboardData?.getData("text") ?? "";
	if (!looksLikeConfigJson(text)) return false;

	// It's a config snippet, so it never lands in the field as raw text.
	event.preventDefault();

	// Snapshot before the parse mutates anything, but only commit it as the undo
	// target once the import actually succeeds.
	const before = snapshotForm();
	const error = applyImportedJson(text);
	if (error) {
		// It was JSON, just not a config we understand — say so rather than
		// silently dropping the paste.
		importError = error;
		importNotice = null;
		importUndo = null;
		return true;
	}

	importError = null;
	importUndo = before;
	importNotice = name.trim()
		? "Imported from pasted JSON."
		: "Imported from pasted JSON — enter a name for this server.";
	return true;
}

function undoImport() {
	if (!importUndo) return;
	restoreForm(importUndo);
	importUndo = null;
	importNotice = null;
	importError = null;
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
	if (capturedServerId && capturedExistingConfig && onDelete) {
		if (!(await confirmDelete(plugin.app, capturedExistingConfig.displayName || capturedServerId))) return;
		onDelete(capturedServerId);
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

<!-- Paste is caught here rather than per-input: the event bubbles, so one
     listener covers every field (including ones added later) without threading
     an `onpaste` prop through the shared Text/TextArea primitives. Non-config
     pastes fall through untouched. -->
<div class="mcp-modal-content" onpastecapture={(e) => handleConfigPaste(e)}>
  <!-- Import feedback. Only ever shown as the result of a paste, so the modal
       carries no import affordance of its own when nothing was pasted. -->
  {#if importNotice}
    <div class="mcp-banner success">
      <Icon name="check-circle" />
      <span>{importNotice}</span>
      {#if importUndo}
        <button type="button" class="mcp-banner-action" onclick={undoImport}>Undo</button>
      {/if}
    </div>
  {:else if importError}
    <div class="mcp-banner error">
      <Icon name="alert-circle" />
      <span>{importError}</span>
      <button type="button" class="mcp-banner-action" onclick={() => (importError = null)}>
        Dismiss
      </button>
    </div>
  {/if}

  <!-- One card, one idiom: every field is a native settings row. Wide controls
       (URL, textareas) opt into `mcp-row--stacked`, which drops the control onto
       its own full-width line under the label instead of squeezing it into the
       right-hand column — the reason the old markup reached for ModalField,
       whose larger label weight made those fields read as headings. -->
  <SettingGroup>
    <SettingContainer name="Name" desc="A name for this MCP server">
      <Text
        id="mcp-server-name"
        inputType="text"
        value={name}
        placeholder="My MCP Server"
        onblur={(v) => (name = v)}
      />
    </SettingContainer>

    <!-- Only worth asking when there's a real choice: stdio is desktop-only, so
         on mobile this is a single-option dropdown. -->
    {#if transportOptions.length > 1}
      <SettingContainer name="Transport" desc="How to connect to this server">
        <Dropdown
          id="mcp-server-transport"
          type="options"
          dropdown={transportOptions}
          selected={transport}
          onchange={(v) => (transport = v)}
        />
      </SettingContainer>
    {/if}

    {#if transport === "stdio"}
      <SettingContainer
        class="mcp-row--stacked"
        name="Command"
        desc="The executable to run, plus its arguments — or paste the server's JSON config to fill this form"
      >
        <div class="mcp-command-row">
          <Text
            id="mcp-server-command"
            inputType="text"
            class="mcp-command-input"
            value={command}
            placeholder="npx"
            onblur={(v) => (command = v)}
          />
          <Text
            id="mcp-server-arguments"
            inputType="text"
            class="mcp-args-input"
            value={args}
            placeholder="-y @modelcontextprotocol/server-filesystem /path"
            onblur={(v) => (args = v)}
          />
        </div>
      </SettingContainer>

      <SettingContainer
        class="mcp-row--stacked"
        name="Environment variables"
        desc="Optional — one per line, KEY=VALUE"
      >
        <TextArea
          id="mcp-server-env"
          class="mcp-textarea"
          bind:value={envVars}
          placeholder={"API_KEY=your-key\nDEBUG=true"}
        />
      </SettingContainer>
    {:else}
      <!-- Import is advertised in the description rather than with a control:
           ⌘V into any field already does it, so a button would occupy permanent
           space to duplicate a shortcut people reach for by reflex. -->
      <SettingContainer
        class="mcp-row--stacked"
        name="Server URL"
        desc="The URL of the MCP server — or paste the server's JSON config to fill this form"
      >
        <Text
          id="mcp-server-url"
          inputType="text"
          value={url}
          placeholder="https://mcp.example.com/mcp"
          onblur={(v) => (url = v)}
        />
      </SettingContainer>

      <SettingContainer
        class="mcp-row--stacked"
        name="Headers"
        desc="Optional — one per line, Header-Name: value"
      >
        <TextArea
          id="mcp-server-headers"
          class="mcp-textarea"
          bind:value={headers}
          placeholder={"Authorization: Bearer token\nX-Custom-Header: value"}
        />
      </SettingContainer>
    {/if}
  </SettingGroup>

  <!-- Test sits directly above its own results, so the outcome appears where the
       user just clicked rather than at the far end of the modal. -->
  <div class="mcp-test-row">
    <Button
      buttonText={isTesting ? "Testing…" : "Test connection"}
      onClick={handleTestConnection}
      disabled={isTesting}
    />
  </div>

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
       sit where a core modal's buttons do. Only the three verbs that resolve the
       modal live here — Delete at the left edge, away from the confirm button so
       a destructive click isn't adjacent to the one people aim for. Testing is a
       form action, not a way out of the modal, so it sits with the fields above. -->
  <div class="modal-button-container mcp-actions">
    {#if isEditing}
      <Button buttonText="Delete" styles="mod-warning" onClick={handleDelete} />
    {/if}
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

  /* Import banner. Transient feedback for a paste — colour comes from Obsidian's
     own text vars so it tracks the theme. `color-mix` against a hex keeps the
     tint working in themes that leave the `-hsl` colour vars undefined. */
  .mcp-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-s);
    font-size: var(--font-ui-small);
  }

  .mcp-banner.success {
    background: color-mix(in srgb, var(--text-success, #4caf50) 12%, transparent);
    color: var(--text-success, #4caf50);
  }

  .mcp-banner.error {
    background: color-mix(in srgb, var(--text-error, #f44336) 12%, transparent);
    color: var(--text-error, #f44336);
  }

  .mcp-banner span {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* Inline text action — deliberately not a Button: it sits inside coloured
     text and should inherit that colour rather than render as a control. */
  .mcp-banner-action {
    flex: 0 0 auto;
    padding: 2px 6px;
    border: none;
    box-shadow: none;
    background: transparent;
    color: inherit;
    font-size: var(--font-ui-smaller);
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }

  .mcp-banner-action:hover {
    background: var(--background-modifier-hover);
  }

  .mcp-test-row {
    display: flex;
    justify-content: flex-start;
  }

  /* Wide-control settings row: keep the native label/description column, but let
     the control take the full width on its own line beneath it. Obsidian already
     does exactly this on phones; this opts specific desktop rows into the same
     shape so a URL or textarea isn't crushed into the right-hand column. */
  :global(.mcp-row--stacked) {
    display: block;
  }

  /* Fully global: `.setting-item-control` belongs to SettingContainer's scope,
     so a scoped descendant selector here would never match it. */
  :global(.mcp-row--stacked .setting-item-control) {
    width: 100%;
    justify-content: flex-start;
    margin-top: 8px;
    padding-top: 0;
  }

  /* Inputs default to their intrinsic width, which is what truncated the URL. */
  :global(.mcp-row--stacked .setting-item-control input[type="text"]) {
    width: 100%;
  }

  /* Command + args on one line: the executable is short and fixed-ish, the
     argument list is long, so give the args the remaining space. */
  .mcp-command-row {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .mcp-command-row :global(.mcp-command-input) {
    flex: 0 1 30%;
    min-width: 0;
  }

  .mcp-command-row :global(.mcp-args-input) {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* Phone: two inputs side by side get too narrow to read. */
  :global(.is-phone) .mcp-command-row {
    flex-direction: column;
  }

  :global(.is-phone) .mcp-command-row :global(.mcp-command-input) {
    flex: 1 1 auto;
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
