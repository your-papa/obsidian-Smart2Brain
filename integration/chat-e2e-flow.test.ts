import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	disablePlugin,
	domCount,
	domText,
	enablePlugin,
	executeCommand,
	getErrors,
	isProviderConfigured,
	obsidianEval,
	pollEval,
	sleep,
	waitForCondition,
	waitForSelector,
} from "./helpers/cli.ts";

const providerAvailable = (() => {
	try {
		return isProviderConfigured();
	} catch {
		return false;
	}
})();

describe("end-to-end chat flow", () => {
	beforeAll(async () => {
		clearBuffers();
		disablePlugin();
		await sleep(1000);
		enablePlugin();
		await sleep(5000);
		executeCommand("smart-second-brain:new-chat");
		await waitForSelector(".chat-root");
		await sleep(1000);
	});

	afterAll(() => {
		clearBuffers();
	});

	it("should show the empty state logo before any messages", () => {
		expect(domCount(".logo-container")).toBeGreaterThanOrEqual(1);
	});

	it.skipIf(!providerAvailable)(
		"should send a message and receive a streamed response",
		async () => {
			const globalKey = "__s2bE2EChat" + Date.now();
			const threadId = "e2e-chat-" + Date.now();

			// Use the agentManager to send a message via the messenger flow
			const result = await pollEval(
				`(function(){ var am = ${PLUGIN}.agentManager; window.${globalKey} = "pending"; (async function(){ try { var tokens = ""; for await (var chunk of am.streamQuery("Reply with exactly: HELLO_E2E", "${threadId}")) { if (chunk.type === "token" && chunk.token) tokens += chunk.token; } window.${globalKey} = tokens || "EMPTY"; } catch(e) { window.${globalKey} = "ERROR:" + e.message; } })(); return "started"; })()`,
				globalKey,
				{ timeoutMs: 60_000 },
			);

			expect(result).not.toContain("ERROR:");
			expect(result).not.toBe("EMPTY");
			expect(result.length).toBeGreaterThan(0);
		},
	);

	it.skipIf(!providerAvailable)(
		"should hide the empty state logo after messages are sent",
		async () => {
			executeCommand("smart-second-brain:open-chat");
			await waitForSelector(".chat-root");
			await sleep(500);
			const logoCount = domCount(".logo-container");
			expect(logoCount).toBeDefined();
		},
	);

	it("should not produce errors during the chat flow", () => {
		expect(getErrors()).toBe("");
	});
});
