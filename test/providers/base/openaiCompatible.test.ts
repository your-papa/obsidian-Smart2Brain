/**
 * Tests for OpenAI-compatible base runtime
 *
 * Tests createOpenAIChatModel factory function.
 * All LangChain classes are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModelConfig, RuntimeFieldBasedAuthState } from "../../../src/providers/types.ts";

// Mock @langchain/openai
vi.mock("@langchain/openai", () => ({
	ChatOpenAI: vi.fn().mockImplementation((config) => ({
		_mockType: "ChatOpenAI",
		...config,
	})),
	OpenAIEmbeddings: vi.fn().mockImplementation((config) => ({
		_mockType: "OpenAIEmbeddings",
		...config,
	})),
}));

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
// Import after mock
import { createOpenAIChatModel, createOpenAIEmbeddingModel } from "../../../src/providers/base/openaiCompatible.ts";

// Type for mock ChatOpenAI instance
interface MockChatOpenAI {
	_mockType: string;
	model: string;
	apiKey: string;
	temperature?: number;
	configuration?: { baseURL: string };
}

// Type for mock OpenAIEmbeddings instance
interface MockOpenAIEmbeddings {
	_mockType: string;
	model: string;
	apiKey: string;
	configuration?: { baseURL: string };
}

describe("createOpenAIChatModel", () => {
	const mockChatOpenAI = ChatOpenAI as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("basic functionality", () => {
		it("should create a ChatOpenAI instance with model and apiKey", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key-123",
				},
			};

			const result = await createOpenAIChatModel("gpt-4o", auth);

			expect(mockChatOpenAI).toHaveBeenCalledTimes(1);
			expect(mockChatOpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "gpt-4o",
					apiKey: "sk-test-key-123",
				}),
			);
			expect(result).toBeDefined();
			expect((result as unknown as MockChatOpenAI)._mockType).toBe("ChatOpenAI");
		});

		it("should use different model IDs", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};

			await createOpenAIChatModel("gpt-4o-mini", auth);

			expect(mockChatOpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "gpt-4o-mini",
				}),
			);
		});
	});

	describe("temperature configuration", () => {
		it("should pass temperature when provided in options", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};
			const options: ChatModelConfig = {
				temperature: 0.7,
				contextWindow: 128000,
			};

			await createOpenAIChatModel("gpt-4o", auth, options);

			expect(mockChatOpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.7,
				}),
			);
		});

		it("should pass temperature of 0 when explicitly set", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};
			const options: ChatModelConfig = {
				temperature: 0,
				contextWindow: 128000,
			};

			await createOpenAIChatModel("gpt-4o", auth, options);

			expect(mockChatOpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0,
				}),
			);
		});

		it("should not pass temperature when undefined", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};
			const options: ChatModelConfig = {
				contextWindow: 128000,
			};

			await createOpenAIChatModel("gpt-4o", auth, options);

			const calledWith = mockChatOpenAI.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("temperature");
		});

		it("should not pass temperature when no options provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};

			await createOpenAIChatModel("gpt-4o", auth);

			const calledWith = mockChatOpenAI.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("temperature");
		});
	});

	describe("baseUrl configuration", () => {
		it("should configure baseUrl when provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "https://custom-endpoint.com/v1",
				},
			};

			await createOpenAIChatModel("gpt-4o", auth);

			expect(mockChatOpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						baseURL: "https://custom-endpoint.com/v1",
					}),
				}),
			);
		});

		it("should not configure baseUrl when not provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};

			await createOpenAIChatModel("gpt-4o", auth);

			const calledWith = mockChatOpenAI.mock.calls[0][0];
			expect(calledWith.configuration).toBeUndefined();
		});

		it("should not configure baseUrl when empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "",
				},
			};

			await createOpenAIChatModel("gpt-4o", auth);

			const calledWith = mockChatOpenAI.mock.calls[0][0];
			expect(calledWith.configuration).toBeUndefined();
		});

		it("should strip trailing slashes from baseUrl", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "https://custom-endpoint.com/v1///",
				},
			};

			await createOpenAIChatModel("gpt-4o", auth);

			expect(mockChatOpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						baseURL: "https://custom-endpoint.com/v1",
					}),
				}),
			);
		});
	});

	describe("combined configuration", () => {
		it("should handle all configuration options together", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-full-test-key",
					baseUrl: "https://api.example.com/v1",
				},
			};
			const options: ChatModelConfig = {
				temperature: 0.5,
				contextWindow: 128000,
			};

			await createOpenAIChatModel("gpt-4-turbo", auth, options);

			expect(mockChatOpenAI).toHaveBeenCalledWith({
				model: "gpt-4-turbo",
				apiKey: "sk-full-test-key",
				temperature: 0.5,
				configuration: {
					baseURL: "https://api.example.com/v1",
				},
			});
		});
	});

	describe("return value", () => {
		it("should return the created ChatOpenAI instance", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};

			const result = await createOpenAIChatModel("gpt-4o", auth);
			const mockResult = result as unknown as MockChatOpenAI;

			expect(result).toBeDefined();
			expect(mockResult.model).toBe("gpt-4o");
			expect(mockResult.apiKey).toBe("sk-test-key");
		});
	});
});

// Default base URL for testing
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

describe("createOpenAIEmbeddingModel", () => {
	const mockOpenAIEmbeddings = OpenAIEmbeddings as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("basic functionality", () => {
		it("should create an OpenAIEmbeddings instance with model and apiKey", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key-123",
				},
			};

			const result = await createOpenAIEmbeddingModel("text-embedding-3-small", auth);

			expect(mockOpenAIEmbeddings).toHaveBeenCalledTimes(1);
			expect(mockOpenAIEmbeddings).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "text-embedding-3-small",
					apiKey: "sk-test-key-123",
				}),
			);
			expect(result).toBeDefined();
			expect((result as unknown as MockOpenAIEmbeddings)._mockType).toBe("OpenAIEmbeddings");
		});

		it("should use different model IDs", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};

			await createOpenAIEmbeddingModel("text-embedding-ada-002", auth);

			expect(mockOpenAIEmbeddings).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "text-embedding-ada-002",
				}),
			);
		});
	});

	describe("baseUrl configuration", () => {
		it("should configure baseUrl when provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "https://custom-endpoint.com/v1",
				},
			};

			await createOpenAIEmbeddingModel("text-embedding-3-small", auth);

			expect(mockOpenAIEmbeddings).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						baseURL: "https://custom-endpoint.com/v1",
					}),
				}),
			);
		});

		it("should not configure baseUrl when not provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};

			await createOpenAIEmbeddingModel("text-embedding-3-small", auth);

			const calledWith = mockOpenAIEmbeddings.mock.calls[0][0];
			expect(calledWith.configuration).toBeUndefined();
		});

		it("should not configure baseUrl when empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "",
				},
			};

			await createOpenAIEmbeddingModel("text-embedding-3-small", auth);

			const calledWith = mockOpenAIEmbeddings.mock.calls[0][0];
			expect(calledWith.configuration).toBeUndefined();
		});

		it("should strip trailing slashes from baseUrl", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "https://custom-endpoint.com/v1///",
				},
			};

			await createOpenAIEmbeddingModel("text-embedding-3-small", auth);

			expect(mockOpenAIEmbeddings).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						baseURL: "https://custom-endpoint.com/v1",
					}),
				}),
			);
		});
	});

	describe("combined configuration", () => {
		it("should handle model and baseUrl together", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-full-test-key",
					baseUrl: "https://api.example.com/v1",
				},
			};

			await createOpenAIEmbeddingModel("text-embedding-3-large", auth);

			expect(mockOpenAIEmbeddings).toHaveBeenCalledWith({
				model: "text-embedding-3-large",
				apiKey: "sk-full-test-key",
				configuration: {
					baseURL: "https://api.example.com/v1",
				},
			});
		});
	});

	describe("return value", () => {
		it("should return the created OpenAIEmbeddings instance", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
				},
			};

			const result = await createOpenAIEmbeddingModel("text-embedding-3-small", auth);
			const mockResult = result as unknown as MockOpenAIEmbeddings;

			expect(result).toBeDefined();
			expect(mockResult.model).toBe("text-embedding-3-small");
			expect(mockResult.apiKey).toBe("sk-test-key");
		});
	});
});

describe("discoverOpenAIModels", () => {
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
	const callDiscoverOpenAIModels = async (auth: RuntimeFieldBasedAuthState) => {
		const { discoverOpenAIModels } = await import("../../../src/providers/base/openaiCompatible.ts");
		return discoverOpenAIModels(auth);
	};

	describe("successful model discovery", () => {
		it("should fetch models from OpenAI API with authorization header", async () => {
			const mockModels = {
				data: [
					{ id: "gpt-4o", object: "model" },
					{ id: "gpt-4o-mini", object: "model" },
				],
			};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key-123" },
			};

			await callDiscoverOpenAIModels(auth);

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenCalledWith(
				`${OPENAI_DEFAULT_BASE_URL}/models`,
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						Authorization: "Bearer sk-test-key-123",
						"Content-Type": "application/json",
					}),
				}),
			);
		});

		it("should separate chat models from embedding models", async () => {
			const mockModels = {
				data: [
					{ id: "gpt-4o", object: "model" },
					{ id: "gpt-4o-mini", object: "model" },
					{ id: "text-embedding-3-small", object: "model" },
					{ id: "text-embedding-3-large", object: "model" },
					{ id: "text-embedding-ada-002", object: "model" },
				],
			};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callDiscoverOpenAIModels(auth);

			expect(result.chat).toContain("gpt-4o");
			expect(result.chat).toContain("gpt-4o-mini");
			expect(result.chat).not.toContain("text-embedding-3-small");
			expect(result.embedding).toContain("text-embedding-3-small");
			expect(result.embedding).toContain("text-embedding-3-large");
			expect(result.embedding).toContain("text-embedding-ada-002");
			expect(result.embedding).not.toContain("gpt-4o");
		});

		it("should filter out excluded models (moderation, audio, whisper, tts)", async () => {
			const mockModels = {
				data: [
					{ id: "gpt-4o", object: "model" },
					{ id: "text-moderation-latest", object: "model" },
					{ id: "text-moderation-stable", object: "model" },
					{ id: "whisper-1", object: "model" },
					{ id: "tts-1", object: "model" },
					{ id: "tts-1-hd", object: "model" },
				],
			};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callDiscoverOpenAIModels(auth);

			expect(result.chat).toContain("gpt-4o");
			expect(result.chat).not.toContain("text-moderation-latest");
			expect(result.chat).not.toContain("text-moderation-stable");
			expect(result.chat).not.toContain("whisper-1");
			expect(result.chat).not.toContain("tts-1");
			expect(result.chat).not.toContain("tts-1-hd");
		});

		it("should handle models with embed in name as embedding models", async () => {
			const mockModels = {
				data: [
					{ id: "gpt-4o", object: "model" },
					{ id: "nomic-embed-text", object: "model" },
					{ id: "mxbai-embed-large", object: "model" },
				],
			};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callDiscoverOpenAIModels(auth);

			expect(result.embedding).toContain("nomic-embed-text");
			expect(result.embedding).toContain("mxbai-embed-large");
			expect(result.chat).not.toContain("nomic-embed-text");
		});

		it("should return empty arrays when no models match categories", async () => {
			const mockModels = {
				data: [
					{ id: "text-moderation-latest", object: "model" },
					{ id: "whisper-1", object: "model" },
				],
			};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callDiscoverOpenAIModels(auth);

			expect(result.chat).toEqual([]);
			expect(result.embedding).toEqual([]);
		});

		it("should skip models with empty or missing id", async () => {
			const mockModels = {
				data: [
					{ id: "gpt-4o", object: "model" },
					{ id: "", object: "model" },
					{ id: "   ", object: "model" },
					{ object: "model" }, // no id
					{ id: null, object: "model" },
				],
			};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callDiscoverOpenAIModels(auth);

			expect(result.chat).toEqual(["gpt-4o"]);
		});
	});

	describe("custom baseUrl configuration", () => {
		it("should use custom baseUrl when provided", async () => {
			const mockModels = {
				data: [{ id: "gpt-4o", object: "model" }],
			};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "https://custom-api.example.com/v1",
				},
			};

			await callDiscoverOpenAIModels(auth);

			expect(mockFetch).toHaveBeenCalledWith("https://custom-api.example.com/v1/models", expect.any(Object));
		});

		it("should strip trailing slashes from baseUrl", async () => {
			const mockModels = {
				data: [{ id: "gpt-4o", object: "model" }],
			};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "https://custom-api.example.com/v1///",
				},
			};

			await callDiscoverOpenAIModels(auth);

			expect(mockFetch).toHaveBeenCalledWith("https://custom-api.example.com/v1/models", expect.any(Object));
		});

		it("should use default baseUrl when baseUrl is empty string", async () => {
			const mockModels = {
				data: [{ id: "gpt-4o", object: "model" }],
			};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "",
				},
			};

			await callDiscoverOpenAIModels(auth);

			expect(mockFetch).toHaveBeenCalledWith(`${OPENAI_DEFAULT_BASE_URL}/models`, expect.any(Object));
		});
	});

	describe("authentication error handling", () => {
		it("should throw ProviderAuthError on 401 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: () =>
					Promise.resolve(JSON.stringify({ error: { code: "invalid_api_key", message: "Invalid API key" } })),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-invalid-key" },
			};

			await expect(callDiscoverOpenAIModels(auth)).rejects.toThrow("Authentication failed");
		});

		it("should throw ProviderAuthError on 403 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: () => Promise.resolve(JSON.stringify({ error: { message: "Forbidden" } })),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			await expect(callDiscoverOpenAIModels(auth)).rejects.toThrow("Authentication failed");
		});

		it("should throw ProviderAuthError when error code is invalid_api_key", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				text: () =>
					Promise.resolve(JSON.stringify({ error: { code: "invalid_api_key", message: "Bad request" } })),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			await expect(callDiscoverOpenAIModels(auth)).rejects.toThrow("Authentication failed");
		});
	});

	describe("other error handling", () => {
		it("should throw ProviderEndpointError on network failure", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Network error"));

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			await expect(callDiscoverOpenAIModels(auth)).rejects.toThrow("Endpoint error");
		});

		it("should throw error on non-auth HTTP errors", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: () => Promise.resolve("Internal server error"),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			await expect(callDiscoverOpenAIModels(auth)).rejects.toThrow("500");
		});

		it("should handle empty data array", async () => {
			const mockModels = { data: [] };
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callDiscoverOpenAIModels(auth);

			expect(result.chat).toEqual([]);
			expect(result.embedding).toEqual([]);
		});

		it("should handle missing data property", async () => {
			const mockModels = {};
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockModels),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callDiscoverOpenAIModels(auth);

			expect(result.chat).toEqual([]);
			expect(result.embedding).toEqual([]);
		});

		it("should throw error when apiKey is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};

			await expect(callDiscoverOpenAIModels(auth)).rejects.toThrow("API key");
		});
	});
});

describe("validateOpenAIAuth", () => {
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
	const callValidateOpenAIAuth = async (auth: RuntimeFieldBasedAuthState) => {
		const { validateOpenAIAuth } = await import("../../../src/providers/base/openaiCompatible.ts");
		return validateOpenAIAuth(auth);
	};

	describe("missing credentials", () => {
		it("should return invalid when apiKey is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};

			const result = await callValidateOpenAIAuth(auth);

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

			const result = await callValidateOpenAIAuth(auth);

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

			const result = await callValidateOpenAIAuth(auth);

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
				json: () => Promise.resolve({ data: [{ id: "gpt-4o" }] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-valid-key-123" },
			};

			const result = await callValidateOpenAIAuth(auth);

			expect(result.valid).toBe(true);
		});

		it("should make GET request to /models endpoint with Bearer token", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ data: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key-456" },
			};

			await callValidateOpenAIAuth(auth);

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenCalledWith(
				`${OPENAI_DEFAULT_BASE_URL}/models`,
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						Authorization: "Bearer sk-test-key-456",
					}),
				}),
			);
		});

		it("should use custom baseUrl when provided", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ data: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "https://custom-api.example.com/v1",
				},
			};

			await callValidateOpenAIAuth(auth);

			expect(mockFetch).toHaveBeenCalledWith("https://custom-api.example.com/v1/models", expect.any(Object));
		});

		it("should strip trailing slashes from custom baseUrl", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ data: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "https://custom-api.example.com/v1///",
				},
			};

			await callValidateOpenAIAuth(auth);

			expect(mockFetch).toHaveBeenCalledWith("https://custom-api.example.com/v1/models", expect.any(Object));
		});

		it("should use default baseUrl when baseUrl is empty string", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ data: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key",
					baseUrl: "",
				},
			};

			await callValidateOpenAIAuth(auth);

			expect(mockFetch).toHaveBeenCalledWith(`${OPENAI_DEFAULT_BASE_URL}/models`, expect.any(Object));
		});
	});

	describe("authentication errors", () => {
		it("should return invalid with error message on 401 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: () =>
					Promise.resolve(JSON.stringify({ error: { code: "invalid_api_key", message: "Invalid API key" } })),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-invalid-key" },
			};

			const result = await callValidateOpenAIAuth(auth);

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
				text: () => Promise.resolve(JSON.stringify({ error: { message: "Forbidden" } })),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callValidateOpenAIAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should return invalid when error code is invalid_api_key", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				text: () =>
					Promise.resolve(JSON.stringify({ error: { code: "invalid_api_key", message: "Bad request" } })),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callValidateOpenAIAuth(auth);

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
							error: { code: "invalid_api_key", message: "The API key is invalid or expired" },
						}),
					),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-invalid-key" },
			};

			const result = await callValidateOpenAIAuth(auth);

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
				values: { apiKey: "sk-test-key" },
			};

			const result = await callValidateOpenAIAuth(auth);

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
				values: { apiKey: "sk-test-key" },
			};

			const result = await callValidateOpenAIAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should return invalid on timeout", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const result = await callValidateOpenAIAuth(auth);

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
				values: { apiKey: "sk-test-key" },
			};

			const result = await callValidateOpenAIAuth(auth);

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
				json: () => Promise.resolve({ data: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-valid-key" },
			};

			const result = await callValidateOpenAIAuth(auth);

			expect(result).toEqual({ valid: true });
		});

		it("should return { valid: false, error: string } on failure", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};

			const result = await callValidateOpenAIAuth(auth);

			expect(result.valid).toBe(false);
			expect("error" in result).toBe(true);
			if (!result.valid) {
				expect(typeof result.error).toBe("string");
			}
		});
	});
});
