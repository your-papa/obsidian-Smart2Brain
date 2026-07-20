import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "../../src/utils/errorMessage";

describe("extractErrorMessage", () => {
	it("returns a plain error message unchanged", () => {
		expect(extractErrorMessage(new Error("Connection refused"))).toBe("Connection refused");
	});

	it("unwraps a raw JSON error envelope", () => {
		const err = new Error('{"error":{"message":"Model does not fit","type":"server_error"}}');
		expect(extractErrorMessage(err)).toBe("Model does not fit");
	});

	it("unwraps a status-prefixed JSON envelope (the 507 memory-ceiling case)", () => {
		const err = new Error(
			`507 {"error":{"message":"Model 'gemma-4-26b-a4b-it-4bit' (15.26GB) does not fit under the memory ceiling (14.40GB). Free system memory or lower memory_guard_tier.","type":"server_error","param":null,"code":null}}`,
		);
		expect(extractErrorMessage(err)).toBe(
			"Model 'gemma-4-26b-a4b-it-4bit' (15.26GB) does not fit under the memory ceiling (14.40GB). Free system memory or lower memory_guard_tier.",
		);
	});

	it("keeps a message with no JSON envelope but a leading status", () => {
		const err = new Error("507 Model does not fit under the memory ceiling.");
		expect(extractErrorMessage(err)).toBe("507 Model does not fit under the memory ceiling.");
	});

	it("unwraps a JSON envelope with trailing text after the closing brace", () => {
		const err = new Error('507 {"error":{"message":"out of memory"}} (request id abc)');
		expect(extractErrorMessage(err)).toBe("out of memory");
	});

	it("returns the original message when the inner error.message is empty", () => {
		const err = new Error('{"error":{"message":""}}');
		expect(extractErrorMessage(err)).toBe('{"error":{"message":""}}');
	});

	it("prefers the deepest cause message in a wrapped chain", () => {
		const root = new Error("Underlying provider failure");
		const wrapper = new Error("Agent run failed") as Error & { cause?: unknown };
		wrapper.cause = root;
		expect(extractErrorMessage(wrapper)).toBe("Underlying provider failure");
	});

	it("accepts a bare string", () => {
		expect(extractErrorMessage("something broke")).toBe("something broke");
	});

	it("falls back for non-error, empty, and nullish values", () => {
		expect(extractErrorMessage(undefined)).toBe("The model request failed.");
		expect(extractErrorMessage(null)).toBe("The model request failed.");
		expect(extractErrorMessage(new Error(""))).toBe("The model request failed.");
		expect(extractErrorMessage({})).toBe("The model request failed.");
	});
});
