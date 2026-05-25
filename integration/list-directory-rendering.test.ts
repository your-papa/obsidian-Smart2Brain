import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	deleteAllChatFiles,
	isProviderConfigured,
	pollEval,
	reloadPlugin,
	getErrors,
	sleep,
} from "./helpers/cli.ts";

const providerAvailable = (() => {
	try {
		return isProviderConfigured();
	} catch {
		return false;
	}
})();

describe("list_directory rendering", () => {
	beforeAll(async () => {
		clearBuffers();
		deleteAllChatFiles();
		reloadPlugin();
		await sleep(2000);
	});

	afterAll(() => {
		deleteAllChatFiles();
		clearBuffers();
	});

	it.skipIf(!providerAvailable)(
		"completes a list_directory tool call without runtime errors",
		async () => {
			const globalKey = `__s2bListDirectoryRender_${Date.now()}`;
			const threadId = `list-directory-render-${Date.now()}`;

			const result = await pollEval(
				`(function(){ var am = ${PLUGIN}.agentManager; window.${globalKey} = "pending"; (async function(){ try { var tools = []; var tokens = ""; for await (var chunk of am.streamQuery("Use the list_directory tool to inspect the vault root with max depth 2. After the tool call, reply with exactly: LIST_DIRECTORY_DONE", "${threadId}")) { if (chunk.type === "tool_start") tools.push(chunk.toolName); if (chunk.type === "token" && chunk.token) tokens += chunk.token; } window.${globalKey} = JSON.stringify({ tools: tools, tokens: tokens }); } catch(e) { window.${globalKey} = JSON.stringify({ error: e.message }); } })(); return "started"; })()`,
				globalKey,
				{ timeoutMs: 90_000, intervalMs: 2_000 },
			);

			expect(result).not.toContain("error");
			expect(result).toContain("list_directory");
			expect(result).toContain("LIST_DIRECTORY_DONE");
			expect(getErrors()).toBe("");
		},
		120_000,
	);
});
