import { describe, expect, it } from "vitest";

import { stripVendorPrefix } from "../../src/lib/modelMetadataNormalizer";

describe("stripVendorPrefix", () => {
	it("drops the catalogue's leading vendor segment", () => {
		expect(stripVendorPrefix("Qwen: Qwen3.8 Max")).toBe("Qwen3.8 Max");
		expect(stripVendorPrefix("Anthropic: Claude 4.5 Sonnet")).toBe("Claude 4.5 Sonnet");
	});

	it("leaves names without a vendor prefix alone", () => {
		expect(stripVendorPrefix("gpt-5.5")).toBe("gpt-5.5");
		expect(stripVendorPrefix("Claude 4.5 Sonnet")).toBe("Claude 4.5 Sonnet");
	});

	it("requires the space after the colon, so `a:b` model ids survive", () => {
		expect(stripVendorPrefix("qwen3:8b")).toBe("qwen3:8b");
		expect(stripVendorPrefix("llama3.1:70b-instruct")).toBe("llama3.1:70b-instruct");
	});

	it("only strips a short leading segment, so a colon inside the name survives", () => {
		const longLead = "A very long marketing lead in of over 24 chars: Model";
		expect(stripVendorPrefix(longLead)).toBe(longLead);
	});

	it("strips only the first segment when several colons are present", () => {
		expect(stripVendorPrefix("Qwen: Qwen3.8: Max")).toBe("Qwen3.8: Max");
	});
});
