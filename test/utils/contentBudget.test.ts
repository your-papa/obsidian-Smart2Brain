import { describe, expect, it } from "vitest";
import {
	CHARS_PER_TOKEN,
	contextWindowToCharBudget,
	DEFAULT_CONTEXT_WINDOW,
	READ_CONTENT_BUDGET_FRACTION,
	SELECTION_BUDGET_FRACTION,
	truncateToBudget,
} from "../../src/utils/contentBudget";

describe("contextWindowToCharBudget", () => {
	it("scales with the context window and fraction", () => {
		expect(contextWindowToCharBudget(128_000, 0.5)).toBe(128_000 * 0.5 * CHARS_PER_TOKEN);
		expect(contextWindowToCharBudget(200_000, 0.25)).toBe(200_000 * 0.25 * CHARS_PER_TOKEN);
	});

	it("falls back to the default window when unknown or zero", () => {
		const expected = DEFAULT_CONTEXT_WINDOW * 0.5 * CHARS_PER_TOKEN;
		expect(contextWindowToCharBudget(undefined, 0.5)).toBe(expected);
		expect(contextWindowToCharBudget(0, 0.5)).toBe(expected);
	});

	it("floors at the minimum budget for tiny windows", () => {
		// 2000 tokens * 0.25 * 4 = 2000 chars, below the 4000 floor.
		expect(contextWindowToCharBudget(2_000, SELECTION_BUDGET_FRACTION)).toBe(4_000);
	});

	it("gives read_content a larger slice than a selection", () => {
		const read = contextWindowToCharBudget(128_000, READ_CONTENT_BUDGET_FRACTION);
		const selection = contextWindowToCharBudget(128_000, SELECTION_BUDGET_FRACTION);
		expect(read).toBeGreaterThan(selection);
	});
});

describe("truncateToBudget", () => {
	it("leaves short text untouched", () => {
		const { text, truncated } = truncateToBudget("hello", 1000);
		expect(truncated).toBe(false);
		expect(text).toBe("hello");
	});

	it("truncates and marks over-budget text within the cap", () => {
		const input = "x".repeat(5000);
		const { text, truncated } = truncateToBudget(input, 1000);
		expect(truncated).toBe(true);
		expect(text.length).toBeLessThanOrEqual(1000);
		expect(text).toContain("[truncated at 1000 characters]");
	});

	it("is a no-op when maxChars is non-positive", () => {
		const { text, truncated } = truncateToBudget("anything", 0);
		expect(truncated).toBe(false);
		expect(text).toBe("anything");
	});
});
