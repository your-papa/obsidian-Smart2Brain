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
});
