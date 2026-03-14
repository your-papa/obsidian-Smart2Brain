import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLUGIN, clearBuffers, getConsole, getErrors, isProviderConfigured, pollEval, sleep } from "./helpers/cli.ts";

const providerAvailable = (() => {
	try {
		return isProviderConfigured();
	} catch {
		return false;
	}
})();

describe.skipIf(!providerAvailable)("ai transport concurrency", () => {
	beforeAll(() => {
		clearBuffers();
	});

	afterAll(() => {
		clearBuffers();
	});

	it("should isolate buffered fallback to the downgraded run", async () => {
		const globalKey = "__s2bAiTransportConcurrency_" + Date.now();
		const downgradedThreadId = "transport-downgrade-" + Date.now();
		const defaultThreadId = "transport-default-" + Date.now();

		const raw = await pollEval(
			`(function(){
				window.${globalKey} = "pending";
				(async function(){
					var plugin = ${PLUGIN};
					var electron = window.require && window.require("electron");
					var remoteNet = electron && electron.remote && electron.remote.net;
					var originalFetch = remoteNet && remoteNet.fetch;
					if (!remoteNet || typeof originalFetch !== "function") {
						window.${globalKey} = JSON.stringify({ error: "electron.remote.net.fetch unavailable" });
						return;
					}

					var fetchLog = [];
					var simulatedFailures = [];
					var downgradedPrompt = "FORCE_DOWNGRADE_CONCURRENCY Reply with exactly: DOWNGRADE_OK";
					var defaultPrompt = "CONCURRENCY_DEFAULT Reply with exactly: DEFAULT_OK";
					var forcedFailureUsed = false;

					remoteNet.fetch = async function(input, init) {
						var body = init && typeof init.body === "string" ? init.body : "";
						fetchLog.push(body);

						if (!forcedFailureUsed && body.includes("FORCE_DOWNGRADE_CONCURRENCY")) {
							forcedFailureUsed = true;
							simulatedFailures.push("FORCE_DOWNGRADE_CONCURRENCY");
							throw new TypeError("Simulated transport failure for integration test");
						}

						return originalFetch.call(this, input, init);
					};

					try {
						var am = plugin.agentManager;
						var runStream = async function(query, threadId) {
							var tokens = "";
							for await (var chunk of am.streamQuery(query, threadId)) {
								if (chunk.type === "token" && chunk.token) tokens += chunk.token;
							}
							return tokens || "EMPTY";
						};

						var results = await Promise.all([
							runStream(downgradedPrompt, "${downgradedThreadId}"),
							(async function() {
								await new Promise(function(resolve) { setTimeout(resolve, 50); });
								return runStream(defaultPrompt, "${defaultThreadId}");
							})(),
						]);

						window.${globalKey} = JSON.stringify({
							downgradedResult: results[0],
							defaultResult: results[1],
							fetchLog: fetchLog,
							simulatedFailures: simulatedFailures,
							defaultUsedRemoteNetFetch: fetchLog.some(function(body) {
								return body.includes("CONCURRENCY_DEFAULT");
							}),
						});
					} catch (error) {
						window.${globalKey} = JSON.stringify({
							error: error instanceof Error ? error.message : String(error),
							fetchLog: fetchLog,
							simulatedFailures: simulatedFailures,
						});
					} finally {
						remoteNet.fetch = originalFetch;
					}
				})();
				return "started";
			})()`,
			globalKey,
			{ timeoutMs: 90_000, intervalMs: 2_000 },
		);

		const result = JSON.parse(raw) as {
			error?: string;
			downgradedResult?: string;
			defaultResult?: string;
			fetchLog?: string[];
			simulatedFailures?: string[];
			defaultUsedRemoteNetFetch?: boolean;
		};

		expect(result.error).toBeUndefined();
		expect(result.simulatedFailures).toEqual(["FORCE_DOWNGRADE_CONCURRENCY"]);
		expect(result.downgradedResult).toBeDefined();
		expect(result.downgradedResult).not.toBe("EMPTY");
		expect(result.downgradedResult).not.toContain("ERROR:");
		expect(result.defaultResult).toBeDefined();
		expect(result.defaultResult).not.toBe("EMPTY");
		expect(result.defaultResult).not.toContain("ERROR:");
		expect(result.defaultUsedRemoteNetFetch).toBe(true);
		expect(result.fetchLog?.some((body) => body.includes("FORCE_DOWNGRADE_CONCURRENCY"))).toBe(true);
	});

	it("should not emit transport mismatch warnings or runtime errors", async () => {
		await sleep(250);

		const warns = getConsole("warn");
		expect(warns).not.toContain("aiTransport.pop mismatch");
		expect(warns).not.toContain("aiTransport.pop called without active context");
		expect(getErrors()).toBe("");
	});
});
