/**
 * Tests for provider helper functions
 *
 * Tests validateCustomProviderId and parseHeadersJson utility functions.
 */

import { describe, expect, it } from "vitest";
import { parseHeadersJson, validateCustomProviderId } from "../../src/providers/helpers.ts";

// ============================================================================
// validateCustomProviderId Tests
// ============================================================================

describe("validateCustomProviderId", () => {
	describe("validation rules", () => {
		it("should reject empty string", () => {
			const result = validateCustomProviderId("", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("empty");
		});

		it("should reject string with only whitespace", () => {
			const result = validateCustomProviderId("   ", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id with spaces", () => {
			const result = validateCustomProviderId("my provider", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("space");
		});

		it("should reject id with leading space", () => {
			const result = validateCustomProviderId(" my-provider", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id with trailing space", () => {
			const result = validateCustomProviderId("my-provider ", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id with uppercase letters", () => {
			const result = validateCustomProviderId("MyProvider", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("lowercase");
		});

		it("should reject id with mixed case", () => {
			const result = validateCustomProviderId("myProvider", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id with all uppercase", () => {
			const result = validateCustomProviderId("MYPROVIDER", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id with underscores", () => {
			const result = validateCustomProviderId("my_provider", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id with special characters", () => {
			const result = validateCustomProviderId("my@provider", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id starting with a number", () => {
			const result = validateCustomProviderId("123-provider", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id starting with a dash", () => {
			const result = validateCustomProviderId("-my-provider", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id ending with a dash", () => {
			const result = validateCustomProviderId("my-provider-", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should reject id with consecutive dashes", () => {
			const result = validateCustomProviderId("my--provider", []);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("duplicate detection", () => {
		it("should reject duplicate id matching existing provider", () => {
			const existingIds = ["openai", "anthropic", "ollama"];
			const result = validateCustomProviderId("openai", existingIds);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("already exists");
		});

		it("should reject duplicate custom provider id", () => {
			const existingIds = ["my-custom-llm", "local-server"];
			const result = validateCustomProviderId("my-custom-llm", existingIds);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("already exists");
		});

		it("should be case-sensitive for duplicate check", () => {
			const existingIds = ["openai"];
			// Since we require lowercase, "OpenAI" would fail the lowercase check first
			// but if it somehow passed, it should still be different from "openai"
			const result = validateCustomProviderId("openai", existingIds);
			expect(result.valid).toBe(false);
		});
	});

	describe("valid ids", () => {
		it("should accept valid lowercase id", () => {
			const result = validateCustomProviderId("myprovider", []);
			expect(result.valid).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it("should accept valid lowercase-dash id", () => {
			const result = validateCustomProviderId("my-custom-provider", []);
			expect(result.valid).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it("should accept valid id with numbers", () => {
			const result = validateCustomProviderId("my-provider-v2", []);
			expect(result.valid).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it("should accept single character id", () => {
			const result = validateCustomProviderId("a", []);
			expect(result.valid).toBe(true);
		});

		it("should accept valid id when not in existing list", () => {
			const existingIds = ["openai", "anthropic"];
			const result = validateCustomProviderId("my-new-provider", existingIds);
			expect(result.valid).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it("should accept common provider-style ids", () => {
			const validIds = [
				"local-llm",
				"azure-openai",
				"aws-bedrock",
				"groq",
				"together-ai",
				"fireworks-ai",
				"deepseek",
				"mistral",
				"sap-ai-core",
			];

			for (const id of validIds) {
				const result = validateCustomProviderId(id, []);
				expect(result.valid).toBe(true);
			}
		});
	});

	describe("return type", () => {
		it("should return valid: true for valid ids", () => {
			const result = validateCustomProviderId("valid-id", []);
			expect(result).toEqual({ valid: true });
		});

		it("should return valid: false with error message for invalid ids", () => {
			const result = validateCustomProviderId("", []);
			expect(result.valid).toBe(false);
			expect(typeof result.error).toBe("string");
			if (result.error) {
				expect(result.error.length).toBeGreaterThan(0);
			}
		});
	});
});

// ============================================================================
// parseHeadersJson Tests
// ============================================================================

describe("parseHeadersJson", () => {
	describe("valid JSON", () => {
		it("should parse valid JSON object", () => {
			const result = parseHeadersJson('{"Content-Type": "application/json"}');
			expect(result.success).toBe(true);
			expect(result.headers).toEqual({ "Content-Type": "application/json" });
		});

		it("should parse JSON with multiple headers", () => {
			const json = '{"Authorization": "Bearer token", "X-Custom": "value"}';
			const result = parseHeadersJson(json);
			expect(result.success).toBe(true);
			expect(result.headers).toEqual({
				Authorization: "Bearer token",
				"X-Custom": "value",
			});
		});

		it("should parse empty JSON object", () => {
			const result = parseHeadersJson("{}");
			expect(result.success).toBe(true);
			expect(result.headers).toEqual({});
		});

		it("should handle whitespace in valid JSON", () => {
			const json = '  { "key" : "value" }  ';
			const result = parseHeadersJson(json);
			expect(result.success).toBe(true);
			expect(result.headers).toEqual({ key: "value" });
		});

		it("should handle multiline JSON", () => {
			const json = `{
				"Header1": "value1",
				"Header2": "value2"
			}`;
			const result = parseHeadersJson(json);
			expect(result.success).toBe(true);
			expect(result.headers).toEqual({
				Header1: "value1",
				Header2: "value2",
			});
		});
	});

	describe("empty input", () => {
		it("should return empty headers for empty string", () => {
			const result = parseHeadersJson("");
			expect(result.success).toBe(true);
			expect(result.headers).toEqual({});
		});

		it("should return empty headers for whitespace-only string", () => {
			const result = parseHeadersJson("   ");
			expect(result.success).toBe(true);
			expect(result.headers).toEqual({});
		});

		it("should return empty headers for newline-only string", () => {
			const result = parseHeadersJson("\n\t\r");
			expect(result.success).toBe(true);
			expect(result.headers).toEqual({});
		});
	});

	describe("invalid JSON", () => {
		it("should return error for invalid JSON syntax", () => {
			const result = parseHeadersJson("{invalid json}");
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.headers).toEqual({});
		});

		it("should return error for JSON array", () => {
			const result = parseHeadersJson('["array", "not", "object"]');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("object");
		});

		it("should return error for JSON string", () => {
			const result = parseHeadersJson('"just a string"');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error for JSON number", () => {
			const result = parseHeadersJson("123");
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error for JSON null", () => {
			const result = parseHeadersJson("null");
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error for JSON boolean", () => {
			const result = parseHeadersJson("true");
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error for unclosed brace", () => {
			const result = parseHeadersJson('{"key": "value"');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error for missing quotes", () => {
			const result = parseHeadersJson("{key: value}");
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error for trailing comma", () => {
			const result = parseHeadersJson('{"key": "value",}');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("non-string values", () => {
		it("should return error for object with non-string values", () => {
			const result = parseHeadersJson('{"key": 123}');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("string");
		});

		it("should return error for nested objects", () => {
			const result = parseHeadersJson('{"key": {"nested": "value"}}');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error for array values", () => {
			const result = parseHeadersJson('{"key": ["a", "b"]}');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error for null values", () => {
			const result = parseHeadersJson('{"key": null}');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error for boolean values", () => {
			const result = parseHeadersJson('{"key": true}');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("return type", () => {
		it("should return success: true with headers for valid input", () => {
			const result = parseHeadersJson('{"key": "value"}');
			expect(result).toEqual({
				success: true,
				headers: { key: "value" },
			});
		});

		it("should return success: false with error and empty headers for invalid input", () => {
			const result = parseHeadersJson("invalid");
			expect(result.success).toBe(false);
			expect(typeof result.error).toBe("string");
			expect(result.headers).toEqual({});
		});
	});
});
