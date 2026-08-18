import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const VAULT_NAME = "Smart2Brain Test Vault";
const CHAT_FILES_DIR = fileURLToPath(new URL("../Smart2Brain Test Vault/Chats/", import.meta.url));

interface PersistedCheckpointRecord {
	checkpoint?: {
		ts?: string;
		channel_values?: {
			messages?: PersistedLangChainMessage[];
		};
	};
	metadata?: {
		step?: number;
	};
}

interface PersistedLangChainMessage {
	kwargs?: {
		content?: unknown;
		tool_calls?: Array<{ name?: string }>;
	};
	id?: string[];
	type?: string;
}

export interface PersistedChatSummary {
	filePath: string;
	title: string;
	threadId: string;
	updatedAt: number;
	humanContents: string[];
	assistantContents: string[];
	toolCallNames: string[];
	toolOutputCount: number;
	checkpointCount: number;
}

interface PersistedChatFile {
	threadId?: string;
	title?: string;
	updatedAt?: number;
	checkpoints?: Record<string, PersistedCheckpointRecord>;
}

function parsePersistedChatFile(path: string): PersistedChatFile | null {
	try {
		const raw = readFileSync(path);
		return JSON.parse(gunzipSync(raw).toString("utf8")) as PersistedChatFile;
	} catch {
		return null;
	}
}

function getLatestCheckpointRecord(chat: PersistedChatFile): PersistedCheckpointRecord | null {
	const records = Object.values(chat.checkpoints ?? {});
	if (records.length === 0) return null;

	return (
		records
			.sort((left, right) => {
				const leftStep = left.metadata?.step ?? Number.MIN_SAFE_INTEGER;
				const rightStep = right.metadata?.step ?? Number.MIN_SAFE_INTEGER;
				if (leftStep !== rightStep) return leftStep - rightStep;

				const leftTs = Date.parse(left.checkpoint?.ts ?? "");
				const rightTs = Date.parse(right.checkpoint?.ts ?? "");
				return leftTs - rightTs;
			})
			.at(-1) ?? null
	);
}

function stringifyMessageContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") return part;
				if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
					return part.text;
				}
				return "";
			})
			.join("")
			.trim();
	}
	return "";
}

function summarizePersistedChat(path: string): PersistedChatSummary | null {
	const chat = parsePersistedChatFile(path);
	if (!chat) return null;

	const checkpoint = getLatestCheckpointRecord(chat);
	const messages = checkpoint?.checkpoint?.channel_values?.messages ?? [];
	const humanContents: string[] = [];
	const assistantContents: string[] = [];
	const toolCallNames: string[] = [];
	let toolOutputCount = 0;

	for (const message of messages) {
		const messageName = message.id?.at(-1) ?? message.type ?? "";
		const content = stringifyMessageContent(message.kwargs?.content).trim();
		if (messageName === "HumanMessage" && content.length > 0) {
			humanContents.push(content);
		}
		if ((messageName === "AIMessage" || messageName === "AIMessageChunk") && content.length > 0) {
			assistantContents.push(content);
		}
		for (const toolCall of message.kwargs?.tool_calls ?? []) {
			if (typeof toolCall?.name === "string" && toolCall.name.length > 0) {
				toolCallNames.push(toolCall.name);
			}
		}
		if (messageName === "ToolMessage") {
			toolOutputCount += 1;
		}
	}

	return {
		filePath: path,
		title: chat.title ?? "",
		threadId: chat.threadId ?? "",
		updatedAt: chat.updatedAt ?? 0,
		humanContents,
		assistantContents,
		toolCallNames,
		toolOutputCount,
		checkpointCount: Object.keys(chat.checkpoints ?? {}).length,
	};
}

export function listPersistedChatSummaries(): PersistedChatSummary[] {
	try {
		return readdirSync(CHAT_FILES_DIR)
			.filter((name) => name.endsWith(".chat"))
			.map((name) => summarizePersistedChat(`${CHAT_FILES_DIR}${name}`))
			.filter((summary): summary is PersistedChatSummary => summary !== null)
			.sort((left, right) => left.updatedAt - right.updatedAt);
	} catch {
		return [];
	}
}

export function getLatestPersistedChatSummary(): PersistedChatSummary | null {
	const summaries = listPersistedChatSummaries();
	return summaries.at(-1) ?? null;
}

export function getPersistedChatSummary(filePath: string): PersistedChatSummary | null {
	return summarizePersistedChat(filePath);
}

/**
 * Helper to execute obsidian CLI commands and return trimmed output.
 * Always targets the test vault by placing vault= before the command.
 * Throws on non-zero exit code unless `ignoreError` is true.
 */
export function obsidian(cmd: string, { ignoreError = false } = {}): string {
	try {
		return execSync(`obsidian vault="${VAULT_NAME}" ${cmd}`, {
			encoding: "utf-8",
			timeout: 30_000,
		}).trim();
	} catch (e) {
		if (ignoreError) return "";
		throw e;
	}
}

/**
 * Query a DOM element in Obsidian and return text content.
 */
export function domText(selector: string): string {
	return obsidian(`dev:dom selector='${selector}' text`, { ignoreError: true });
}

/**
 * Count DOM elements matching a CSS selector.
 */
export function domCount(selector: string): number {
	const result = obsidian(`dev:dom selector='${selector}' total`, { ignoreError: true });
	return Number.parseInt(result, 10) || 0;
}

/**
 * Get innerHTML of a DOM element.
 */
export function domInner(selector: string): string {
	return obsidian(`dev:dom selector='${selector}' inner`, { ignoreError: true });
}

/**
 * Get an attribute value from a DOM element.
 */
export function domAttr(selector: string, attr: string): string {
	return obsidian(`dev:dom selector='${selector}' attr=${attr}`, { ignoreError: true });
}

/**
 * Get captured errors from the Obsidian console.
 * Returns empty string when no errors are captured.
 * Filters out benign browser noise (e.g. ResizeObserver warnings).
 */
export function getErrors(): string {
	const result = obsidian("dev:errors", { ignoreError: true });
	if (result === "No errors captured.") return "";
	// Filter out benign ResizeObserver loop notifications
	const lines = result
		.split("\n")
		.filter(
			(line) =>
				line.trim() !== "" && !line.includes("ResizeObserver loop completed with undelivered notifications"),
		);
	return lines.join("\n").trim();
}

/**
 * Get console messages, optionally filtered by level.
 */
export function getConsole(level?: "log" | "warn" | "error" | "info" | "debug"): string {
	const cmd = level ? `dev:console level=${level}` : "dev:console";
	return obsidian(cmd, { ignoreError: true });
}

/**
 * Clear error and console buffers for a clean test run.
 */
export function clearBuffers(): void {
	obsidian("dev:errors clear", { ignoreError: true });
	obsidian("dev:console clear", { ignoreError: true });
}

/**
 * Close any open modals, including search modals that do not expose a close button.
 * Repeatedly clicks explicit close buttons and sends Escape until no modal containers remain.
 */
export function closeAllModals({ maxPasses = 24 } = {}): void {
	for (let pass = 0; pass < maxPasses; pass += 1) {
		if (domCount(".modal-container") === 0) {
			return;
		}

		obsidianEval(`(() => {
			const containers = Array.from(document.querySelectorAll(".modal-container"));
			const activeContainer = containers[containers.length - 1];
			if (!(activeContainer instanceof HTMLElement)) return "missing-modal";

			const closeButton = activeContainer.querySelector(".modal-close-button");
			if (closeButton instanceof HTMLElement) {
				closeButton.click();
				return "clicked-close-button";
			}

			const target = activeContainer.querySelector(".prompt-input")
				?? activeContainer.querySelector(".modal")
				?? activeContainer;
			if (target instanceof HTMLElement) {
				target.focus();
				target.dispatchEvent(new KeyboardEvent("keydown", {
					key: "Escape",
					code: "Escape",
					bubbles: true,
					cancelable: true,
				}));
				target.dispatchEvent(new KeyboardEvent("keyup", {
					key: "Escape",
					code: "Escape",
					bubbles: true,
					cancelable: true,
				}));
				return "dispatched-escape";
			}

			return "no-close-target";
		})()`);

		obsidian(`dev:cdp method=Input.dispatchKeyEvent params='{"type":"keyDown","key":"Escape","code":"Escape"}'`, {
			ignoreError: true,
		});
		obsidian(`dev:cdp method=Input.dispatchKeyEvent params='{"type":"keyUp","key":"Escape","code":"Escape"}'`, {
			ignoreError: true,
		});
	}
}

/**
 * Take a screenshot and save to the given path.
 */
export function screenshot(path: string): void {
	obsidian(`dev:screenshot path="${path}"`);
}

/**
 * Execute an Obsidian command by ID.
 */
export function executeCommand(commandId: string): string {
	return obsidian(`command id=${commandId}`);
}

/**
 * Create a file in the vault.
 */
export function createNote(name: string, content: string): string {
	return obsidian(`create name="${name}" content="${content}" overwrite`);
}

/**
 * Read a file from the vault.
 */
export function readNote(name: string): string {
	return obsidian(`read file="${name}"`);
}

/**
 * Delete a file from the vault (to trash).
 */
export function deleteNote(name: string): void {
	obsidian(`delete file="${name}"`, { ignoreError: true });
}

/**
 * Delete all .chat files created during tests.
 */
export function deleteAllChatFiles(): void {
	const files = obsidian("files ext=chat", { ignoreError: true });
	if (!files) return;
	for (const line of files.split("\n")) {
		const path = line.trim();
		if (path && path.endsWith(".chat")) {
			obsidian(`delete path="${path}"`, { ignoreError: true });
		}
	}
}

/**
 * Reload the plugin after a build.
 */
export function reloadPlugin(): string {
	return obsidian("plugin:reload id=smart-second-brain");
}

/**
 * Check if the plugin is enabled.
 */
export function isPluginEnabled(): boolean {
	const info = obsidian("plugin id=smart-second-brain");
	return info.includes("enabled\ttrue") || info.includes("enabled true");
}

/**
 * Enable the plugin.
 */
export function enablePlugin(): string {
	return obsidian("plugin:enable id=smart-second-brain");
}

/**
 * Disable the plugin.
 */
export function disablePlugin(): string {
	return obsidian("plugin:disable id=smart-second-brain");
}

/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until a CSS selector matches at least one element in Obsidian DOM.
 * Throws if not found within timeoutMs.
 */
export async function waitForSelector(selector: string, { timeoutMs = 15_000, intervalMs = 500 } = {}): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (domCount(selector) > 0) return;
		await sleep(intervalMs);
	}
	throw new Error(`waitForSelector timed out waiting for: ${selector}`);
}

/**
 * Poll until a condition function returns true.
 * Throws if the condition is not met within timeoutMs.
 */
export async function waitForCondition(
	fn: () => boolean,
	label: string,
	{ timeoutMs = 15_000, intervalMs = 500 } = {},
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fn()) return;
		await sleep(intervalMs);
	}
	throw new Error(`waitForCondition timed out: ${label}`);
}

/** The plugin accessor used in eval expressions. */
export const PLUGIN = 'app.plugins.plugins["smart-second-brain"]';

/**
 * Check if a chat model provider is configured and reachable.
 * Returns true if the plugin has at least one configured provider.
 */
export function isProviderConfigured(): boolean {
	const result = obsidianEval(`${PLUGIN}.pluginData.getConfiguredProviders().length > 0`);
	return result.includes("true");
}

/**
 * Wait until the lexical MiniSearch index used by SearchModal/search_notes
 * has finished indexing vault files. Call this before lexical search tests.
 */
export async function waitForStandaloneMiniSearch({ timeoutMs = 30_000, intervalMs = 500 } = {}): Promise<void> {
	await waitForCondition(
		() => {
			const raw = obsidianEval(`${PLUGIN}.lexicalSearchService?.documentCount ?? 0`);
			const value = raw.startsWith("=> ") ? raw.slice(3) : raw;
			return Number.parseInt(value, 10) > 0;
		},
		"lexical MiniSearch to be populated",
		{ timeoutMs, intervalMs },
	);
}

/**
 * Execute JavaScript in the Obsidian renderer process.
 * Returns the string result of the expression.
 */
export function obsidianEval(code: string): string {
	return obsidian(`eval code='${code}'`, { ignoreError: true });
}

/**
 * Fire-and-forget an async JS expression in Obsidian and poll a window global
 * for the result. Returns the final value once the global is set.
 *
 * Checks before each sleep, so work that finishes quickly returns after a single CLI
 * round-trip. Sleeping first cost every call a full interval however fast it completed:
 * the search benchmark runs 45 queries whose real latency is ~5ms (lexical) to ~400ms
 * (hybrid, nearly all of it the embedding call), so a sleep-first 2s interval put a 90s
 * floor under a run needing ~20s of work. Measured end to end: 210s -> 67s.
 *
 * Slow call sites that poll for LLM responses pass a larger `intervalMs` explicitly.
 *
 * @param fireCode  JS that runs async work and eventually sets `window[globalKey]`
 * @param globalKey The window property to poll
 * @param timeoutMs Maximum time to wait (default 60s)
 * @param intervalMs Polling interval (default 250ms)
 */
export async function pollEval(
	fireCode: string,
	globalKey: string,
	{ timeoutMs = 60_000, intervalMs = 250 } = {},
): Promise<string> {
	// Fire the async work
	obsidianEval(fireCode);

	const deadline = Date.now() + timeoutMs;
	while (true) {
		const raw = obsidianEval(`window.${globalKey}`);
		// eval returns "=> value", strip the prefix
		const value = raw.startsWith("=> ") ? raw.slice(3) : raw;
		if (value && value !== "undefined" && value !== "pending") {
			return value;
		}
		if (Date.now() >= deadline) break;
		await sleep(intervalMs);
	}
	throw new Error(`pollEval timed out waiting for window.${globalKey}`);
}

/**
 * Submit a chat message through the real chat editor UI and send button.
 */
export async function submitChatMessageViaUi(message: string): Promise<string> {
	const globalKey = `__s2bSubmitChat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	return pollEval(
		`(function(){ window.${globalKey} = "pending"; (async function(){ try {
			const inputRoot = document.getElementById("chat-view-user-input-element");
			const content = inputRoot?.querySelector(".cm-content");
			if (content instanceof HTMLElement) {
				content.focus();
				content.click();
				content.dispatchEvent(new Event("focusin", { bubbles: true }));
			}

			let editor = null;
			for (let attempt = 0; attempt < 20; attempt += 1) {
				const candidate = app.workspace.activeEditor?.editor;
				if (candidate && typeof candidate.setValue === "function" && typeof candidate.getValue === "function") {
					editor = candidate;
					break;
				}
				await new Promise((resolve) => window.setTimeout(resolve, 50));
			}

			if (!editor) {
				window.${globalKey} = "missing-editor-api";
				return;
			}

			editor.setValue(${JSON.stringify(message)});

			let send = null;
			for (let attempt = 0; attempt < 20; attempt += 1) {
				send = Array.from(document.querySelectorAll("button")).find(
					(element) => element.getAttribute("data-testid") === "send-message-button",
				);
				if (send instanceof HTMLButtonElement && !send.disabled) {
					break;
				}
				await new Promise((resolve) => window.setTimeout(resolve, 50));
			}

			if (!(send instanceof HTMLButtonElement)) {
				window.${globalKey} = "missing-send-button";
				return;
			}
			if (send.disabled) {
				window.${globalKey} = "send-disabled";
				return;
			}

			send.click();
			window.${globalKey} = JSON.stringify({ value: editor.getValue(), clicked: true });
		} catch (e) {
			window.${globalKey} = "ERROR:" + (e instanceof Error ? e.message : String(e));
		} })(); return "started"; })()`,
		globalKey,
		{ timeoutMs: 15_000, intervalMs: 250 },
	);
}

/**
 * Delete a persisted agent thread by id or path through the plugin runtime.
 */
export async function deleteAgentThread(threadId: string): Promise<void> {
	const globalKey = `__s2bDeleteThread_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	const result = await pollEval(
		`(function(){ var am = ${PLUGIN}.agentManager; window.${globalKey} = "pending"; (async function(){ try { await am.deleteThread(${JSON.stringify(threadId)}); window.${globalKey} = "deleted"; } catch(e) { window.${globalKey} = "ERROR:" + (e instanceof Error ? e.message : String(e)); } })(); return "started"; })()`,
		globalKey,
		{ timeoutMs: 15_000, intervalMs: 250 },
	);

	if (result.startsWith("ERROR:")) {
		throw new Error(result);
	}
}
