import type { App } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
	executeJavaScriptSnippetWithScope,
	formatExecutionResult,
	MAX_OUTPUT_CHARS,
	truncateOutput,
} from "./executeJavaScriptShared";
import { toRuntimeToolName } from "../integrations/pluginIntegrations";

const EXECUTION_TIMEOUT_MS = 5_000;

/**
 * Creates a per-plugin code-exec tool that runs a JavaScript snippet on the
 * **main thread** with the target plugin's public `api` object (and `app`) in
 * scope. This is the only way to reach `app.plugins.plugins[...].api` — a worker
 * has no `app` — so it runs unsandboxed. Safety comes from the per-plugin
 * approval gate (the tool is only bound when the user enables the integration),
 * a timeout on awaited work, output truncation, and error-to-string. This is NOT
 * a sandbox: a call into a plugin's api can do anything that plugin can.
 */
export function createPluginApiExecTool(app: App, pluginId: string, displayName: string) {
	const execFn = async ({ code, input }: { code: string; input?: unknown }): Promise<string> => {
		// Re-resolve at call time — the plugin may have reloaded since bind.
		// @ts-ignore - Obsidian plugin API (not in official types)
		const plugin = app.plugins?.plugins?.[pluginId];
		if (!plugin) {
			return `Error: the "${displayName}" plugin (${pluginId}) is not enabled or installed. Ask the user to enable it.`;
		}

		let api: unknown;
		try {
			api = plugin.api;
		} catch (error) {
			return `Error: could not access the "${displayName}" plugin's API: ${error instanceof Error ? error.message : String(error)}`;
		}
		if (typeof api !== "object" || api === null) {
			return `Error: the "${displayName}" plugin does not expose an "api" object, so it cannot be scripted.`;
		}

		try {
			const timeout = new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error(`Execution timed out after ${EXECUTION_TIMEOUT_MS}ms.`)),
					EXECUTION_TIMEOUT_MS,
				);
			});
			const result = await Promise.race([
				executeJavaScriptSnippetWithScope({ code, input }, { api, app }),
				timeout,
			]);
			return truncateOutput(formatExecutionResult(result), MAX_OUTPUT_CHARS);
		} catch (error) {
			return `Error executing against ${displayName} API: ${error instanceof Error ? error.message : String(error)}`;
		}
	};

	return tool(execFn, {
		name: toRuntimeToolName(pluginId),
		description: `Run JavaScript against the "${displayName}" plugin's public API on the main thread. The plugin's api object is in scope as \`api\`, and the Obsidian \`app\` is available. Use \`return\` for the final value and \`console.log\` for intermediate output. Awaited work times out after ${EXECUTION_TIMEOUT_MS}ms; this is not sandboxed, so keep snippets simple and read-only unless the user asked otherwise. Load the "${displayName}" skill (if available) to learn the API's shape before calling it.`,
		schema: z.object({
			code: z
				.string()
				.min(1)
				.describe(
					`JavaScript to execute against the ${displayName} plugin. \`api\` and \`app\` are in scope; use \`input\` for structured data and \`return\` for the final value.`,
				),
			input: z.unknown().optional().describe("Optional JSON-serializable input exposed to the code as `input`."),
		}),
	});
}
