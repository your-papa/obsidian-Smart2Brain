/**
 * Verify test setup is working correctly
 */

import { describe, it, expect, vi } from "vitest";

describe("Test Setup", () => {
	it("should run tests", () => {
		expect(true).toBe(true);
	});

	it("should have access to vitest utilities", () => {
		expect(vi.fn).toBeDefined();
		expect(vi.mock).toBeDefined();
	});

	it("should support async tests", async () => {
		const result = await Promise.resolve(42);
		expect(result).toBe(42);
	});

	it("should support mocking", () => {
		const mockFn = vi.fn(() => "mocked");
		expect(mockFn()).toBe("mocked");
		expect(mockFn).toHaveBeenCalledTimes(1);
	});
});
