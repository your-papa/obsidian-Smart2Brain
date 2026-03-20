import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	deleteAllChatFiles,
	domCount,
	domText,
	executeCommand,
	isProviderConfigured,
	obsidianEval,
	pollEval,
	reloadPlugin,
	sleep,
	waitForSelector,
	getErrors,
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
		reloadPlugin();
		await sleep(2000);
	});

	afterAll(() => {
		deleteAllChatFiles();
		clearBuffers();
	});

	it.skipIf(!providerAvailable)(
		"renders a list_directory tool result as a tree in the live chat view",
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

			executeCommand("smart-second-brain:open-chat");
			obsidianEval(`${PLUGIN}.agentManager.openLatestChat(); \"opened\"`);
			await waitForSelector(".chat-root");
			await sleep(2500);
			obsidianEval(
				'document.querySelectorAll("details.tool-card").forEach((el) => { el.open = true; }); "expanded"',
			);
			await sleep(1000);

			expect(domCount(".tool-output-tree")).toBeGreaterThanOrEqual(1);
			expect(domCount(".tool-output-tree-row")).toBeGreaterThan(0);
			expect(domCount(".tool-output-metric-chip")).toBeGreaterThan(0);
			expect(domText(".tool-output-tree-row-folder .tool-output-tree-name")).not.toBe("");
			expect(getErrors()).toBe("");
		},
		120_000,
	);
});
