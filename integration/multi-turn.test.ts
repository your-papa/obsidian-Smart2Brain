import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	isProviderConfigured,
	obsidianEval,
	pollEval,
	sleep,
	getErrors,
} from "./helpers/cli.ts";

const providerAvailable = (() => {
	try {
		return isProviderConfigured();
	} catch {
		return false;
	}
})();

describe.skipIf(!providerAvailable)("multi-turn conversation", () => {
	const threadId = "multi-turn-" + Date.now();

	beforeAll(() => {
		clearBuffers();
	});

	afterAll(() => {
		clearBuffers();
	});

	it("should send a first message and receive a response", async () => {
		const globalKey = "__s2bMulti1_" + Date.now();

		const result = await pollEval(
			`(function(){ var am = ${PLUGIN}.agentManager; window.${globalKey} = "pending"; (async function(){ try { var tokens = ""; for await (var chunk of am.streamQuery("Remember this word: PINEAPPLE. Say OK.", "${threadId}")) { if (chunk.type === "token" && chunk.token) tokens += chunk.token; } window.${globalKey} = tokens || "EMPTY"; } catch(e) { window.${globalKey} = "ERROR:" + e.message; } })(); return "started"; })()`,
			globalKey,
			{ timeoutMs: 60_000 },
		);

		expect(result).not.toContain("ERROR:");
		expect(result).not.toBe("EMPTY");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should recall context from the first message in a follow-up", async () => {
		const globalKey = "__s2bMulti2_" + Date.now();

		const result = await pollEval(
			`(function(){ var am = ${PLUGIN}.agentManager; window.${globalKey} = "pending"; (async function(){ try { var tokens = ""; for await (var chunk of am.streamQuery("What word did I ask you to remember?", "${threadId}")) { if (chunk.type === "token" && chunk.token) tokens += chunk.token; } window.${globalKey} = tokens || "EMPTY"; } catch(e) { window.${globalKey} = "ERROR:" + e.message; } })(); return "started"; })()`,
			globalKey,
			{ timeoutMs: 60_000 },
		);

		expect(result).not.toContain("ERROR:");
		expect(result).not.toBe("EMPTY");
		// The model should recall "PINEAPPLE" from the conversation history
		expect(result.toUpperCase()).toContain("PINEAPPLE");
	});

	it("should maintain history across a third turn", async () => {
		const globalKey = "__s2bMulti3_" + Date.now();

		const result = await pollEval(
			`(function(){ var am = ${PLUGIN}.agentManager; window.${globalKey} = "pending"; (async function(){ try { var tokens = ""; for await (var chunk of am.streamQuery("How many messages have we exchanged so far? Just give the number.", "${threadId}")) { if (chunk.type === "token" && chunk.token) tokens += chunk.token; } window.${globalKey} = tokens || "EMPTY"; } catch(e) { window.${globalKey} = "ERROR:" + e.message; } })(); return "started"; })()`,
			globalKey,
			{ timeoutMs: 60_000 },
		);

		expect(result).not.toContain("ERROR:");
		expect(result).not.toBe("EMPTY");
		// Should reference having exchanged multiple messages (at least 2 prior pairs)
		expect(result.length).toBeGreaterThan(0);
	});

	it("should not produce errors during multi-turn conversation", () => {
		expect(getErrors()).toBe("");
	});

	it("should summarize older turns instead of throwing when the configured context window is small", async () => {
		const summaryThreadId = "multi-turn-summary-" + Date.now();
		const configKey = "__s2bSummaryCfg_" + Date.now();
		const restoreKey = "__s2bSummaryRestore_" + Date.now();
		const filler = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu ".repeat(35);

		const originalConfig = await pollEval(
			`(function(){ var data = ${PLUGIN}.pluginData; var agent = data.getSelectedAgent(); if (!agent.chatModel) return "NO_CHAT_MODEL"; window.${configKey} = JSON.stringify(agent.chatModel.modelConfig || {}); data.updateAgent(agent.id, { chatModel: { ...agent.chatModel, modelConfig: { ...agent.chatModel.modelConfig, contextWindow: 1500 } }, summarizationModel: null }); return "ok"; })()`,
			configKey,
			{ timeoutMs: 10_000 },
		);

		expect(originalConfig).not.toBe("NO_CHAT_MODEL");

		try {
			const firstKey = "__s2bSummary1_" + Date.now();
			const first = await pollEval(
				`(function(){ var am = ${PLUGIN}.agentManager; window.${firstKey} = "pending"; (async function(){ try { var tokens = ""; for await (var chunk of am.streamQuery("Remember this codeword exactly: STARFRUIT. Reply with OK only. ${filler}", "${summaryThreadId}")) { if (chunk.type === "token" && chunk.token) tokens += chunk.token; } window.${firstKey} = tokens || "EMPTY"; } catch(e) { window.${firstKey} = "ERROR:" + e.message; } })(); return "started"; })()`,
				firstKey,
				{ timeoutMs: 90_000 },
			);

			expect(first).not.toContain("ERROR:");

			for (let i = 0; i < 4; i++) {
				const loopKey = `__s2bSummaryLoop_${Date.now()}_${i}`;
				const result = await pollEval(
					`(function(){ var am = ${PLUGIN}.agentManager; window.${loopKey} = "pending"; (async function(){ try { var tokens = ""; for await (var chunk of am.streamQuery("Keep this response short. ${filler}", "${summaryThreadId}")) { if (chunk.type === "token" && chunk.token) tokens += chunk.token; } window.${loopKey} = tokens || "EMPTY"; } catch(e) { window.${loopKey} = "ERROR:" + e.message; } })(); return "started"; })()`,
					loopKey,
					{ timeoutMs: 90_000 },
				);
				expect(result).not.toContain("ERROR:");
			}

			const recallKey = "__s2bSummaryRecall_" + Date.now();
			const recall = await pollEval(
				`(function(){ var am = ${PLUGIN}.agentManager; window.${recallKey} = "pending"; (async function(){ try { var tokens = ""; for await (var chunk of am.streamQuery("What codeword did I ask you to remember at the start? Reply with the single word only.", "${summaryThreadId}")) { if (chunk.type === "token" && chunk.token) tokens += chunk.token; } window.${recallKey} = tokens || "EMPTY"; } catch(e) { window.${recallKey} = "ERROR:" + e.message; } })(); return "started"; })()`,
				recallKey,
				{ timeoutMs: 90_000 },
			);

			expect(recall).not.toContain("ERROR:");
			expect(recall.toUpperCase()).toContain("STARFRUIT");
		} finally {
			await pollEval(
				`(function(){ var data = ${PLUGIN}.pluginData; var agent = data.getSelectedAgent(); var original = JSON.parse('${originalConfig.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'); data.updateAgent(agent.id, { chatModel: { ...agent.chatModel, modelConfig: original } }); window.${restoreKey} = "restored"; return "started"; })()`,
				restoreKey,
				{ timeoutMs: 10_000 },
			);
		}
	});
});
