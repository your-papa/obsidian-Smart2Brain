import { describe, expect, it } from "vitest";
import { executeJavaScriptSnippet } from "../../src/agent/tools/executeJavaScriptShared";

describe("executeJavaScriptSnippet", () => {
	it("returns the final value from the snippet", async () => {
		const result = await executeJavaScriptSnippet({
			code: "return input.values.reduce((sum, value) => sum + value, 0);",
			input: { values: [1, 2, 3, 4] },
		});

		expect(result.result).toBe(10);
		expect(result.logs).toEqual([]);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("captures console output alongside the return value", async () => {
		const result = await executeJavaScriptSnippet({
			code: `
				const doubled = input.map((value) => value * 2);
				console.log("doubled", doubled);
				return doubled;
			`,
			input: [2, 4, 6],
		});

		expect(result.result).toEqual([4, 8, 12]);
		expect(result.logs).toEqual(["[log] doubled [4,8,12]"]);
	});

	it("normalizes complex values to JSON-safe output", async () => {
		const result = await executeJavaScriptSnippet({
			code: `
				const circular = { name: "root" };
				circular.self = circular;
				return {
					map: new Map([["a", 1]]),
					set: new Set(["x", "y"]),
					circular,
					count: 2n,
				};
			`,
		});

		expect(result.result).toEqual({
			map: { __type: "Map", entries: [["a", 1]] },
			set: { __type: "Set", values: ["x", "y"] },
			circular: { name: "root", self: "[Circular]" },
			count: "2n",
		});
	});

	it("propagates runtime errors", async () => {
		await expect(
			executeJavaScriptSnippet({
				code: 'throw new Error("boom");',
			}),
		).rejects.toThrow("boom");
	});
});
