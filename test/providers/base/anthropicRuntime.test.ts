/**
 * Tests for Anthropic base runtime
 *
 * Tests createAnthropicChatModel factory function and validateAnthropicAuth.
 * All LangChain classes are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModelConfig, RuntimeFieldBasedAuthState } from "../../../src/providers/types.ts";

// Mock @langchain/anthropic
vi.mock("@langchain/anthropic", () => ({
	ChatAnthropic: vi.fn().mockImplementation((config) => ({
		_mockType: "ChatAnthropic",
		...config,
	})),
}));

import { ChatAnthropic } from "@langchain/anthropic";
// Import after mock
import {
	createAnthropicChatModel,
	discoverAnthropicModels,
	validateAnthropicAuth,
} from "../../../src/providers/base/anthropicRuntime.ts";

// Type for mock ChatAnthropic instance
interface MockChatAnthropic {
	_mockType: string;
	model: string;
	apiKey: string;
	temperature?: number;
}

// Default base URL for Anthropic API
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

describe("createAnthropicChatModel", () => {
	const mockChatAnthropic = ChatAnthropic as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("basic functionality", () => {
		it("should create a ChatAnthropic instance with model and apiKey", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-ant-test-key-123",
				},
			};

			const result = await createAnthropicChatModel("claude-3-5-sonnet-20241022", auth);

			expect(mockChatAnthropic).toHaveBeenCalledTimes(1);
			expect(mockChatAnthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "claude-3-5-sonnet-20241022",
					apiKey: "sk-ant-test-key-123",
				}),
			);
			expect(result).toBeDefined();
			expect((result as unknown as MockChatAnthropic)._mockType).toBe("ChatAnthropic");
		});

		it("should use different model IDs", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-ant-test-key",
				},
			};

			await createAnthropicChatModel("claude-3-5-haiku-20241022", auth);

			expect(mockChatAnthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "claude-3-5-haiku-20241022",
				}),
			);
		});
	});

	describe("temperature configuration", () => {
		it("should pass temperature when provided in options", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-ant-test-key",
				},
			};
			const options: ChatModelConfig = {
				temperature: 0.7,
				contextWindow: 200000,
			};

			await createAnthropicChatModel("claude-3-5-sonnet-20241022", auth, options);

			expect(mockChatAnthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.7,
				}),
			);
		});

		it("should pass temperature of 0 when explicitly set", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-ant-test-key",
				},
			};
			const options: ChatModelConfig = {
				temperature: 0,
				contextWindow: 200000,
			};

			await createAnthropicChatModel("claude-3-5-sonnet-20241022", auth, options);

			expect(mockChatAnthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0,
				}),
			);
		});

		it("should not pass temperature when undefined", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-ant-test-key",
				},
			};
			const options: ChatModelConfig = {
				contextWindow: 200000,
			};

			await createAnthropicChatModel("claude-3-5-sonnet-20241022", auth, options);

			const calledWith = mockChatAnthropic.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("temperature");
		});

		it("should not pass temperature when no options provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-ant-test-key",
				},
			};

			await createAnthropicChatModel("claude-3-5-sonnet-20241022", auth);

			const calledWith = mockChatAnthropic.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("temperature");
		});
	});

	describe("combined configuration", () => {
		it("should handle model and temperature together", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-ant-full-test-key",
				},
			};
			const options: ChatModelConfig = {
				temperature: 0.5,
				contextWindow: 200000,
			};

			await createAnthropicChatModel("claude-3-opus-20240229", auth, options);

			expect(mockChatAnthropic).toHaveBeenCalledWith({
				model: "claude-3-opus-20240229",
				apiKey: "sk-ant-full-test-key",
				temperature: 0.5,
			});
		});
	});

	describe("return value", () => {
		it("should return the created ChatAnthropic instance", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-ant-test-key",
				},
			};

			const result = await createAnthropicChatModel("claude-3-5-sonnet-20241022", auth);
			const mockResult = result as unknown as MockChatAnthropic;

			expect(result).toBeDefined();
			expect(mockResult.model).toBe("claude-3-5-sonnet-20241022");
			expect(mockResult.apiKey).toBe("sk-ant-test-key");
		});
	});
});

describe("validateAnthropicAuth", () => {
	const mockFetch = vi.fn();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	// Helper to call the function - dynamically import to get latest version
	const callValidateAnthropicAuth = async (auth: RuntimeFieldBasedAuthState) => {
		const { validateAnthropicAuth } = await import("../../../src/providers/base/anthropicRuntime.ts");
		return validateAnthropicAuth(auth);
	};

	describe("missing credentials", () => {
		it("should return invalid when apiKey is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toContain("API key");
			}
		});

		it("should return invalid when apiKey is empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toContain("API key");
			}
		});

		it("should return invalid when apiKey is whitespace only", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "   " },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toContain("API key");
			}
		});
	});

	describe("successful validation", () => {
		it("should return valid when API responds with 200", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ id: "msg_123", content: [], model: "claude-3-5-sonnet-20241022" }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-valid-key-123" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(true);
		});

		it("should make POST request to /v1/messages endpoint with correct headers", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ id: "msg_123", content: [], model: "claude-3-5-sonnet-20241022" }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key-456" },
			};

			await callValidateAnthropicAuth(auth);

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenCalledWith(
				`${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`,
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"x-api-key": "sk-ant-test-key-456",
						"anthropic-version": "2023-06-01",
						"Content-Type": "application/json",
					}),
				}),
			);
		});

		it("should send minimal validation request body", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ id: "msg_123", content: [], model: "claude-3-5-sonnet-20241022" }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			await callValidateAnthropicAuth(auth);

			const callArgs = mockFetch.mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body as string);

			expect(requestBody).toEqual({
				model: "claude-3-5-sonnet-20241022",
				max_tokens: 1,
				messages: [{ role: "user", content: "hi" }],
			});
		});
	});

	describe("authentication errors", () => {
		it("should return invalid with error message on 401 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: () =>
					Promise.resolve(
						JSON.stringify({ error: { type: "authentication_error", message: "Invalid API key" } }),
					),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-invalid-key" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
				expect(result.error.length).toBeGreaterThan(0);
			}
		});

		it("should return invalid with error message on 403 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: () =>
					Promise.resolve(JSON.stringify({ error: { type: "permission_error", message: "Forbidden" } })),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should return invalid when error type is authentication_error", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				text: () =>
					Promise.resolve(
						JSON.stringify({ error: { type: "authentication_error", message: "Bad request" } }),
					),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should include provider error message when available", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: () =>
					Promise.resolve(
						JSON.stringify({
							error: { type: "authentication_error", message: "The API key is invalid or expired" },
						}),
					),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-invalid-key" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toContain("invalid");
			}
		});
	});

	describe("network and endpoint errors", () => {
		it("should return invalid on network failure", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Network error: connection refused"));

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
				expect(result.error.length).toBeGreaterThan(0);
			}
		});

		it("should return invalid on server error (500)", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: () => Promise.resolve("Internal server error"),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should return invalid on timeout", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should handle response.text() failure gracefully", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: () => Promise.reject(new Error("Failed to read response")),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});
	});

	describe("return type structure", () => {
		it("should return { valid: true } on success", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ id: "msg_123" }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-valid-key" },
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result).toEqual({ valid: true });
		});

		it("should return { valid: false, error: string } on failure", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};

			const result = await callValidateAnthropicAuth(auth);

			expect(result.valid).toBe(false);
			expect("error" in result).toBe(true);
			if (!result.valid) {
				expect(typeof result.error).toBe("string");
			}
		});
	});
});

describe("discoverAnthropicModels", () => {
	const mockFetch = vi.fn();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe("missing credentials", () => {
		it("should throw error when apiKey is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};

			await expect(discoverAnthropicModels(auth)).rejects.toThrow("API key");
		});

		it("should throw error when apiKey is empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "" },
			};

			await expect(discoverAnthropicModels(auth)).rejects.toThrow("API key");
		});

		it("should throw error when apiKey is whitespace only", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "   " },
			};

			await expect(discoverAnthropicModels(auth)).rejects.toThrow("API key");
		});
	});

	describe("successful discovery", () => {
		it("should return discovered chat models", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						data: [
							{ id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet" },
							{ id: "claude-3-5-haiku-20241022", display_name: "Claude 3.5 Haiku" },
							{ id: "claude-3-opus-20240229", display_name: "Claude 3 Opus" },
						],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-valid-key" },
			};

			const result = await discoverAnthropicModels(auth);

			expect(result.chat).toEqual([
				"claude-3-5-sonnet-20241022",
				"claude-3-5-haiku-20241022",
				"claude-3-opus-20240229",
			]);
			expect(result.embedding).toEqual([]);
		});

		it("should make GET request to /v1/models endpoint with correct headers", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ data: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key-456" },
			};

			await discoverAnthropicModels(auth);

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenCalledWith(
				`${ANTHROPIC_DEFAULT_BASE_URL}/v1/models`,
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						"x-api-key": "sk-ant-test-key-456",
						"anthropic-version": "2023-06-01",
						"Content-Type": "application/json",
					}),
				}),
			);
		});

		it("should handle empty model list", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ data: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-valid-key" },
			};

			const result = await discoverAnthropicModels(auth);

			expect(result.chat).toEqual([]);
			expect(result.embedding).toEqual([]);
		});

		it("should skip models with missing or invalid id", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						data: [
							{ id: "claude-3-5-sonnet-20241022" },
							{ id: null },
							{ id: "" },
							{ display_name: "No ID" },
							{ id: "claude-3-opus-20240229" },
						],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-valid-key" },
			};

			const result = await discoverAnthropicModels(auth);

			expect(result.chat).toEqual(["claude-3-5-sonnet-20241022", "claude-3-opus-20240229"]);
		});

		it("should always return empty embedding array (Anthropic has no embeddings)", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						data: [{ id: "claude-3-5-sonnet-20241022" }, { id: "text-embedding-model" }],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-valid-key" },
			};

			const result = await discoverAnthropicModels(auth);

			// All models go to chat, Anthropic doesn't have embeddings
			expect(result.chat).toContain("claude-3-5-sonnet-20241022");
			expect(result.chat).toContain("text-embedding-model");
			expect(result.embedding).toEqual([]);
		});
	});

	describe("authentication errors", () => {
		it("should throw ProviderAuthError on 401 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: () =>
					Promise.resolve(
						JSON.stringify({ error: { type: "authentication_error", message: "Invalid API key" } }),
					),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-invalid-key" },
			};

			await expect(discoverAnthropicModels(auth)).rejects.toThrow(/Authentication failed/);
		});

		it("should throw ProviderAuthError on 403 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: () =>
					Promise.resolve(JSON.stringify({ error: { type: "permission_error", message: "Forbidden" } })),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			await expect(discoverAnthropicModels(auth)).rejects.toThrow(/Authentication failed/);
		});

		it("should throw ProviderAuthError when error type is authentication_error", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				text: () =>
					Promise.resolve(
						JSON.stringify({ error: { type: "authentication_error", message: "Bad request" } }),
					),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			await expect(discoverAnthropicModels(auth)).rejects.toThrow(/Authentication failed/);
		});
	});

	describe("network and endpoint errors", () => {
		it("should throw ProviderEndpointError on network failure", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Network error: connection refused"));

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			await expect(discoverAnthropicModels(auth)).rejects.toThrow(/Endpoint error.*connection refused/);
		});

		it("should throw error on server error (500)", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: () => Promise.resolve("Internal server error"),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};

			await expect(discoverAnthropicModels(auth)).rejects.toThrow(/status 500/);
		});
	});
});
