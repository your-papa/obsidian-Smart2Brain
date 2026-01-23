/**
 * Tests for Ollama base runtime
 *
 * Tests createOllamaChatModel, createOllamaEmbeddingModel, discoverOllamaModels,
 * and validateOllamaConnection functions.
 * All LangChain classes are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModelConfig, RuntimeFieldBasedAuthState } from "../../../src/providers/types.ts";

// Mock @langchain/ollama
vi.mock("@langchain/ollama", () => ({
	ChatOllama: vi.fn().mockImplementation((config) => ({
		_mockType: "ChatOllama",
		...config,
	})),
	OllamaEmbeddings: vi.fn().mockImplementation((config) => ({
		_mockType: "OllamaEmbeddings",
		...config,
	})),
}));

import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
// Import after mock
import {
	createOllamaChatModel,
	createOllamaEmbeddingModel,
	discoverOllamaModels,
	validateOllamaConnection,
} from "../../../src/providers/base/ollamaRuntime.ts";

// Type for mock ChatOllama instance
interface MockChatOllama {
	_mockType: string;
	model: string;
	baseUrl?: string;
	temperature?: number;
	numCtx?: number;
}

// Type for mock OllamaEmbeddings instance
interface MockOllamaEmbeddings {
	_mockType: string;
	model: string;
	baseUrl?: string;
}

// Test base URL for Ollama
const TEST_OLLAMA_BASE_URL = "http://localhost:11434";

describe("createOllamaChatModel", () => {
	const mockChatOllama = ChatOllama as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("basic functionality", () => {
		it("should create a ChatOllama instance with model", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await createOllamaChatModel("llama3.1", auth);

			expect(mockChatOllama).toHaveBeenCalledTimes(1);
			expect(mockChatOllama).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "llama3.1",
				}),
			);
			expect(result).toBeDefined();
			expect((result as unknown as MockChatOllama)._mockType).toBe("ChatOllama");
		});

		it("should use different model IDs", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await createOllamaChatModel("mistral", auth);

			expect(mockChatOllama).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "mistral",
				}),
			);
		});

		it("should not require API key (local service)", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await createOllamaChatModel("llama3.1", auth);

			expect(result).toBeDefined();
			const calledWith = mockChatOllama.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("apiKey");
		});
	});

	describe("baseUrl configuration", () => {
		it("should use custom baseUrl when provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "http://custom-ollama:11434",
				},
			};

			await createOllamaChatModel("llama3.1", auth);

			expect(mockChatOllama).toHaveBeenCalledWith(
				expect.objectContaining({
					baseUrl: "http://custom-ollama:11434",
				}),
			);
		});

		it("should include baseUrl when provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await createOllamaChatModel("llama3.1", auth);

			const calledWith = mockChatOllama.mock.calls[0][0];
			expect(calledWith).toHaveProperty("baseUrl", "http://localhost:11434");
		});

		it("should not include baseUrl when empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "",
				},
			};

			await createOllamaChatModel("llama3.1", auth);

			const calledWith = mockChatOllama.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("baseUrl");
		});

		it("should strip trailing slashes from baseUrl", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "http://custom-ollama:11434///",
				},
			};

			await createOllamaChatModel("llama3.1", auth);

			expect(mockChatOllama).toHaveBeenCalledWith(
				expect.objectContaining({
					baseUrl: "http://custom-ollama:11434",
				}),
			);
		});
	});

	describe("temperature configuration", () => {
		it("should pass temperature when provided in options", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			const options: ChatModelConfig = {
				temperature: 0.7,
				contextWindow: 8192,
			};

			await createOllamaChatModel("llama3.1", auth, options);

			expect(mockChatOllama).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.7,
				}),
			);
		});

		it("should pass temperature of 0 when explicitly set", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			const options: ChatModelConfig = {
				temperature: 0,
				contextWindow: 8192,
			};

			await createOllamaChatModel("llama3.1", auth, options);

			expect(mockChatOllama).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0,
				}),
			);
		});

		it("should not pass temperature when undefined", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			const options: ChatModelConfig = {
				contextWindow: 8192,
			};

			await createOllamaChatModel("llama3.1", auth, options);

			const calledWith = mockChatOllama.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("temperature");
		});

		it("should not pass temperature when no options provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await createOllamaChatModel("llama3.1", auth);

			const calledWith = mockChatOllama.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("temperature");
		});
	});

	describe("contextWindow as numCtx", () => {
		it("should pass contextWindow as numCtx", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			const options: ChatModelConfig = {
				contextWindow: 32768,
			};

			await createOllamaChatModel("llama3.1", auth, options);

			expect(mockChatOllama).toHaveBeenCalledWith(
				expect.objectContaining({
					numCtx: 32768,
				}),
			);
		});

		it("should handle small contextWindow values", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			const options: ChatModelConfig = {
				contextWindow: 2048,
			};

			await createOllamaChatModel("llama3.1", auth, options);

			expect(mockChatOllama).toHaveBeenCalledWith(
				expect.objectContaining({
					numCtx: 2048,
				}),
			);
		});

		it("should not pass numCtx when contextWindow is not provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await createOllamaChatModel("llama3.1", auth);

			const calledWith = mockChatOllama.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("numCtx");
		});
	});

	describe("combined configuration", () => {
		it("should handle all options together", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "http://remote-ollama:11434",
				},
			};
			const options: ChatModelConfig = {
				temperature: 0.5,
				contextWindow: 16384,
			};

			await createOllamaChatModel("codellama", auth, options);

			expect(mockChatOllama).toHaveBeenCalledWith({
				model: "codellama",
				baseUrl: "http://remote-ollama:11434",
				temperature: 0.5,
				numCtx: 16384,
			});
		});
	});

	describe("return value", () => {
		it("should return the created ChatOllama instance", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await createOllamaChatModel("llama3.1", auth);
			const mockResult = result as unknown as MockChatOllama;

			expect(result).toBeDefined();
			expect(mockResult.model).toBe("llama3.1");
		});
	});
});

describe("createOllamaEmbeddingModel", () => {
	const mockOllamaEmbeddings = OllamaEmbeddings as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("basic functionality", () => {
		it("should create an OllamaEmbeddings instance with model", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await createOllamaEmbeddingModel("nomic-embed-text", auth);

			expect(mockOllamaEmbeddings).toHaveBeenCalledTimes(1);
			expect(mockOllamaEmbeddings).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "nomic-embed-text",
				}),
			);
			expect(result).toBeDefined();
			expect((result as unknown as MockOllamaEmbeddings)._mockType).toBe("OllamaEmbeddings");
		});

		it("should use different embedding model IDs", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await createOllamaEmbeddingModel("mxbai-embed-large", auth);

			expect(mockOllamaEmbeddings).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "mxbai-embed-large",
				}),
			);
		});

		it("should not require API key (local service)", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await createOllamaEmbeddingModel("nomic-embed-text", auth);

			expect(result).toBeDefined();
			const calledWith = mockOllamaEmbeddings.mock.calls[0][0];
			expect(calledWith).not.toHaveProperty("apiKey");
		});
	});

	describe("baseUrl configuration", () => {
		it("should use custom baseUrl when provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "http://custom-ollama:11434",
				},
			};

			await createOllamaEmbeddingModel("nomic-embed-text", auth);

			expect(mockOllamaEmbeddings).toHaveBeenCalledWith(
				expect.objectContaining({
					baseUrl: "http://custom-ollama:11434",
				}),
			);
		});

		it("should include baseUrl when provided", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await createOllamaEmbeddingModel("nomic-embed-text", auth);

			const calledWith = mockOllamaEmbeddings.mock.calls[0][0];
			expect(calledWith).toHaveProperty("baseUrl", "http://localhost:11434");
		});

		it("should strip trailing slashes from baseUrl", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "http://custom-ollama:11434//",
				},
			};

			await createOllamaEmbeddingModel("nomic-embed-text", auth);

			expect(mockOllamaEmbeddings).toHaveBeenCalledWith(
				expect.objectContaining({
					baseUrl: "http://custom-ollama:11434",
				}),
			);
		});
	});

	describe("return value", () => {
		it("should return the created OllamaEmbeddings instance", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await createOllamaEmbeddingModel("nomic-embed-text", auth);
			const mockResult = result as unknown as MockOllamaEmbeddings;

			expect(result).toBeDefined();
			expect(mockResult.model).toBe("nomic-embed-text");
		});
	});
});

describe("discoverOllamaModels", () => {
	const mockFetch = vi.fn();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe("missing baseUrl", () => {
		it("should throw error when baseUrl is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};

			await expect(discoverOllamaModels(auth)).rejects.toThrow("Ollama base URL is required");
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("should throw error when baseUrl is empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "" },
			};

			await expect(discoverOllamaModels(auth)).rejects.toThrow("Ollama base URL is required");
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe("successful discovery", () => {
		it("should fetch models from /api/tags endpoint", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						models: [{ name: "llama3.1" }, { name: "mistral" }],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await discoverOllamaModels(auth);

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenCalledWith(`${TEST_OLLAMA_BASE_URL}/api/tags`, expect.any(Object));
		});

		it("should use custom baseUrl when provided", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						models: [{ name: "llama3.1" }],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "http://remote-ollama:11434",
				},
			};

			await discoverOllamaModels(auth);

			expect(mockFetch).toHaveBeenCalledWith("http://remote-ollama:11434/api/tags", expect.any(Object));
		});

		it("should strip trailing slashes from baseUrl", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						models: [{ name: "llama3.1" }],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "http://remote-ollama:11434///",
				},
			};

			await discoverOllamaModels(auth);

			expect(mockFetch).toHaveBeenCalledWith("http://remote-ollama:11434/api/tags", expect.any(Object));
		});

		it("should return chat models", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						models: [{ name: "llama3.1" }, { name: "mistral" }, { name: "codellama" }],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await discoverOllamaModels(auth);

			expect(result.chat).toContain("llama3.1");
			expect(result.chat).toContain("mistral");
			expect(result.chat).toContain("codellama");
		});

		it("should categorize embedding models by name", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						models: [
							{ name: "llama3.1" },
							{ name: "nomic-embed-text" },
							{ name: "mxbai-embed-large" },
							{ name: "all-minilm-embedding" },
						],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await discoverOllamaModels(auth);

			expect(result.chat).toContain("llama3.1");
			expect(result.chat).not.toContain("nomic-embed-text");
			expect(result.embedding).toContain("nomic-embed-text");
			expect(result.embedding).toContain("mxbai-embed-large");
			expect(result.embedding).toContain("all-minilm-embedding");
		});

		it("should return empty arrays when no models are available", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ models: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await discoverOllamaModels(auth);

			expect(result.chat).toEqual([]);
			expect(result.embedding).toEqual([]);
		});

		it("should handle models with tags (e.g., llama3.1:70b)", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						models: [{ name: "llama3.1:latest" }, { name: "llama3.1:70b" }],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await discoverOllamaModels(auth);

			expect(result.chat).toContain("llama3.1:latest");
			expect(result.chat).toContain("llama3.1:70b");
		});

		it("should skip models with empty or missing names", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						models: [{ name: "llama3.1" }, { name: "" }, { name: "  " }, {}],
					}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await discoverOllamaModels(auth);

			expect(result.chat).toEqual(["llama3.1"]);
		});
	});

	describe("error handling", () => {
		it("should throw ProviderEndpointError on network failure", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await expect(discoverOllamaModels(auth)).rejects.toThrow();
		});

		it("should throw ProviderAuthError on 401 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: () => Promise.resolve("Unauthorized"),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await expect(discoverOllamaModels(auth)).rejects.toThrow();
		});

		it("should throw ProviderAuthError on 403 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: () => Promise.resolve("Forbidden"),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await expect(discoverOllamaModels(auth)).rejects.toThrow();
		});

		it("should throw error on other non-ok responses", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: () => Promise.resolve("Internal server error"),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await expect(discoverOllamaModels(auth)).rejects.toThrow();
		});

		it("should handle malformed response gracefully", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({}),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await discoverOllamaModels(auth);

			expect(result.chat).toEqual([]);
			expect(result.embedding).toEqual([]);
		});
	});
});

describe("validateOllamaConnection", () => {
	const mockFetch = vi.fn();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe("missing baseUrl", () => {
		it("should return error when baseUrl is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};

			const result = await validateOllamaConnection(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBe("Server URL is required");
			}
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("should return error when baseUrl is empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "" },
			};

			const result = await validateOllamaConnection(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBe("Server URL is required");
			}
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("should return error when baseUrl is whitespace only", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "   " },
			};

			const result = await validateOllamaConnection(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBe("Server URL is required");
			}
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe("successful validation", () => {
		it("should return valid when server responds", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ models: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await validateOllamaConnection(auth);

			expect(result.valid).toBe(true);
		});

		it("should make GET request to /api/tags endpoint", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ models: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			await validateOllamaConnection(auth);

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenCalledWith(
				`${TEST_OLLAMA_BASE_URL}/api/tags`,
				expect.objectContaining({
					method: "GET",
				}),
			);
		});

		it("should use custom baseUrl when provided", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ models: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "http://remote-ollama:11434",
				},
			};

			await validateOllamaConnection(auth);

			expect(mockFetch).toHaveBeenCalledWith("http://remote-ollama:11434/api/tags", expect.any(Object));
		});

		it("should strip trailing slashes from baseUrl", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ models: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "http://remote-ollama:11434//",
				},
			};

			await validateOllamaConnection(auth);

			expect(mockFetch).toHaveBeenCalledWith("http://remote-ollama:11434/api/tags", expect.any(Object));
		});
	});

	describe("connection failures", () => {
		it("should return invalid on network failure", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await validateOllamaConnection(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
				expect(result.error.length).toBeGreaterThan(0);
			}
		});

		it("should return invalid on timeout", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await validateOllamaConnection(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should return invalid on 401 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: () => Promise.resolve("Unauthorized"),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await validateOllamaConnection(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should return invalid on 403 status", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: () => Promise.resolve("Forbidden"),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await validateOllamaConnection(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
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
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await validateOllamaConnection(auth);

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
				json: () => Promise.resolve({ models: [] }),
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await validateOllamaConnection(auth);

			expect(result).toEqual({ valid: true });
		});

		it("should return { valid: false, error: string } on failure", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};

			const result = await validateOllamaConnection(auth);

			expect(result.valid).toBe(false);
			expect("error" in result).toBe(true);
			if (!result.valid) {
				expect(typeof result.error).toBe("string");
			}
		});
	});
});
