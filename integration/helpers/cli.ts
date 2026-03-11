import { execSync } from "node:child_process";

/**
 * Helper to execute obsidian CLI commands and return trimmed output.
 * Throws on non-zero exit code unless `ignoreError` is true.
 */
export function obsidian(cmd: string, { ignoreError = false } = {}): string {
	try {
		return execSync(`obsidian ${cmd}`, {
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
	const lines = result.split("\n").filter(
		(line) => line.trim() !== "" && !line.includes("ResizeObserver loop completed with undelivered notifications"),
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
export async function waitForSelector(
	selector: string,
	{ timeoutMs = 15_000, intervalMs = 500 } = {},
): Promise<void> {
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
	const result = obsidianEval(
		`${PLUGIN}.pluginData.getConfiguredProviders().length > 0`,
	);
	return result.includes("true");
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
 * @param fireCode  JS that runs async work and eventually sets `window[globalKey]`
 * @param globalKey The window property to poll
 * @param timeoutMs Maximum time to wait (default 60s)
 * @param intervalMs Polling interval (default 2s)
 */
export async function pollEval(
	fireCode: string,
	globalKey: string,
	{ timeoutMs = 60_000, intervalMs = 2_000 } = {},
): Promise<string> {
	// Fire the async work
	obsidianEval(fireCode);

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await sleep(intervalMs);
		const raw = obsidianEval(`window.${globalKey}`);
		// eval returns "=> value", strip the prefix
		const value = raw.startsWith("=> ") ? raw.slice(3) : raw;
		if (value && value !== "undefined" && value !== "pending") {
			return value;
		}
	}
	throw new Error(`pollEval timed out waiting for window.${globalKey}`);
}
