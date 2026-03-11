import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	getErrors,
	isProviderConfigured,
	obsidianEval,
	pollEval,
	sleep,
} from "./helpers/cli.ts";

const providerAvailable = (() => {
	try {
		return isProviderConfigured();
	} catch {
		return false;
	}
})();

describe("agent interaction", () => {
	beforeAll(() => {
		clearBuffers();
	});

	afterAll(() => {
		clearBuffers();
	});

	it("should have a chat model configured", () => {
		const result = obsidianEval(
			`(function(){ var a = ${PLUGIN}.pluginData.getSelectedAgent(); return a.chatModel.provider + ":" + a.chatModel.model; })()`,
		);
		expect(result).toContain("=>");
		expect(result).not.toContain("undefined");
	});

	it("should have at least one configured provider", () => {
		const result = obsidianEval(
			`${PLUGIN}.pluginData.getConfiguredProviders().join(",")`,
		);
		expect(result).toContain("=>");
		// Should have at least one provider like ollama or openrouter
		const providers = result.replace("=> ", "");
		expect(providers.length).toBeGreaterThan(0);
	});

	it.skipIf(!providerAvailable)("should send a simple message and receive a response", async () => {
		const globalKey = "__s2bTestSimple";

		const result = await pollEval(
			`(function(){ var am = ${PLUGIN}.agentManager; window.${globalKey} = "pending"; (async function(){ try { var result = ""; for await (var chunk of am.streamQuery("Reply with exactly: PONG", "test-simple-e2e")) { if (chunk.type === "token" && chunk.token) result += chunk.token; } window.${globalKey} = result || "EMPTY"; } catch(e) { window.${globalKey} = "ERROR:" + e.message; } })(); return "started"; })()`,
			globalKey,
			{ timeoutMs: 60_000 },
		);

		expect(result).not.toContain("ERROR:");
		expect(result).not.toBe("EMPTY");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should not produce errors during agent interaction", () => {
		expect(getErrors()).toBe("");
	});
});

describe("agent with tool use", () => {
	let toolResult: string;

	beforeAll(() => {
		clearBuffers();
	});

	afterAll(() => {
		clearBuffers();
	});

	it.skipIf(!providerAvailable)("should invoke tools when asked to search vault content", async () => {
		const globalKey = "__s2bTestToolsIT";
		// Use a unique thread ID to avoid cached history
		const threadId = "test-tools-" + Date.now();

		const result = await pollEval(
			`(function(){ var am = ${PLUGIN}.agentManager; window.${globalKey} = "pending"; (async function(){ try { var tokens = ""; var tools = []; var toolOutputs = []; for await (var chunk of am.streamQuery("Use the search_notes tool to find notes about stories in my vault", "${threadId}")) { if (chunk.type === "token" && chunk.token) tokens += chunk.token; if (chunk.type === "tool_start") tools.push(chunk.toolName); if (chunk.type === "tool_end") toolOutputs.push({name: chunk.toolName, hasOutput: !!chunk.output}); } window.${globalKey} = JSON.stringify({tokens: tokens, tools: tools, toolOutputs: toolOutputs, tokenLen: tokens.length}); } catch(e) { window.${globalKey} = JSON.stringify({error: e.message}); } })(); return "started"; })()`,
			globalKey,
			{ timeoutMs: 90_000, intervalMs: 3_000 },
		);

		toolResult = result;
		const parsed = JSON.parse(result);
		expect(parsed.error).toBeUndefined();
		// The agent should produce some response
		expect(parsed.tokenLen).toBeGreaterThan(0);
		// With an explicit instruction to use tools, we expect tool usage
		expect(parsed.tools.length).toBeGreaterThan(0);
	});

	it.skipIf(!providerAvailable)("should have used a search-related tool", () => {
		const parsed = JSON.parse(toolResult);
		const hasSearchTool = parsed.tools.some(
			(t: string) => t && (t.includes("search") || t.includes("browse") || t.includes("read")),
		);
		expect(hasSearchTool).toBe(true);
	});

	it.skipIf(!providerAvailable)("should have received non-empty output from every tool", () => {
		const parsed = JSON.parse(toolResult);
		expect(parsed.toolOutputs.length).toBeGreaterThan(0);
		for (const tool of parsed.toolOutputs) {
			expect(tool.hasOutput).toBe(true);
		}
	});

	it("should not produce errors during tool use", () => {
		expect(getErrors()).toBe("");
	});
});
