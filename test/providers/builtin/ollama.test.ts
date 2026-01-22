/**
 * Tests for Ollama built-in provider definition
 *
 * Tests cover:
 * - Provider identity (id, displayName, isBuiltIn)
 * - Setup instructions (steps, link)
 * - Auth configuration (field-based with baseUrl only, no apiKey)
 * - Capabilities (chat: true, embedding: true, modelDiscovery: true)
 * - createRuntimeDefinition function
 * - validateAuth function
 * - discoverModels function (Ollama supports model discovery)
 *
 * NOTE: This test file uses manual spies on the imported base runtime functions
 * to avoid module mock pollution issues with bun's module caching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as baseRuntime from "../../../src/providers/base/ollamaRuntime.ts";
import { ollamaProvider } from "../../../src/providers/builtin/ollama.ts";
import type { FieldBasedAuth, RuntimeFieldBasedAuthState } from "../../../src/providers/types.ts";

// Type for spies
type SpyFn = ReturnType<typeof vi.spyOn>;

describe("Ollama Provider Definition", () => {
	// Spies for base runtime functions
	let spyCreateOllamaChatModel: SpyFn;
	let spyCreateOllamaEmbeddingModel: SpyFn;
	let spyValidateOllamaConnection: SpyFn;
	let spyDiscoverOllamaModels: SpyFn;

	beforeEach(() => {
		// Set up spies on the base runtime functions
		// Cast mock return values through unknown to avoid LangChain type requirements
		spyCreateOllamaChatModel = vi
			.spyOn(baseRuntime, "createOllamaChatModel")
			.mockResolvedValue({ invoke: vi.fn() } as unknown as Awaited<
				ReturnType<typeof baseRuntime.createOllamaChatModel>
			>);
		spyCreateOllamaEmbeddingModel = vi
			.spyOn(baseRuntime, "createOllamaEmbeddingModel")
			.mockResolvedValue({ embedQuery: vi.fn() } as unknown as Awaited<
				ReturnType<typeof baseRuntime.createOllamaEmbeddingModel>
			>);
		spyValidateOllamaConnection = vi
			.spyOn(baseRuntime, "validateOllamaConnection")
			.mockResolvedValue({ valid: true });
		spyDiscoverOllamaModels = vi.spyOn(baseRuntime, "discoverOllamaModels").mockResolvedValue({
			chat: ["llama3.1", "mistral"],
			embedding: ["nomic-embed-text"],
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// Identity Tests
	// =========================================================================
	describe("identity", () => {
		it('should have id "ollama"', () => {
			expect(ollamaProvider.id).toBe("ollama");
		});

		it('should have displayName "Ollama"', () => {
			expect(ollamaProvider.displayName).toBe("Ollama");
		});

		it("should be marked as built-in", () => {
			expect(ollamaProvider.isBuiltIn).toBe(true);
		});
	});

	// =========================================================================
	// Setup Instructions Tests
	// =========================================================================
	describe("setupInstructions", () => {
		it("should have steps array with at least 1 step", () => {
			expect(ollamaProvider.setupInstructions.steps.length).toBeGreaterThan(0);
		});

		it("should have link to Ollama website", () => {
			expect(ollamaProvider.setupInstructions.link).toBeDefined();
			expect(ollamaProvider.setupInstructions.link?.url).toContain("ollama");
		});

		it("should have text for the link", () => {
			expect(ollamaProvider.setupInstructions.link?.text).toBeDefined();
			expect(ollamaProvider.setupInstructions.link?.text.length).toBeGreaterThan(0);
		});
	});

	// =========================================================================
	// Auth Configuration Tests
	// =========================================================================
	describe("auth", () => {
		it("should be field-based auth", () => {
			expect(ollamaProvider.auth.type).toBe("field-based");
		});

		describe("baseUrl field", () => {
			it("should have baseUrl field", () => {
				const auth = ollamaProvider.auth as FieldBasedAuth;
				expect(auth.fields.baseUrl).toBeDefined();
			});

			it("should have baseUrl as required text field", () => {
				const auth = ollamaProvider.auth as FieldBasedAuth;
				expect(auth.fields.baseUrl.required).toBe(true);
				expect(auth.fields.baseUrl.kind).toBe("text");
			});

			it("should have label for baseUrl", () => {
				const auth = ollamaProvider.auth as FieldBasedAuth;
				expect(auth.fields.baseUrl.label).toBeDefined();
				expect(auth.fields.baseUrl.label.length).toBeGreaterThan(0);
			});

			it("should have placeholder showing default localhost URL", () => {
				const auth = ollamaProvider.auth as FieldBasedAuth;
				expect(auth.fields.baseUrl.placeholder).toContain("localhost");
				expect(auth.fields.baseUrl.placeholder).toContain("11434");
			});
		});

		describe("field count", () => {
			it("should only have baseUrl field (no apiKey)", () => {
				const auth = ollamaProvider.auth as FieldBasedAuth;
				const fieldKeys = Object.keys(auth.fields);
				expect(fieldKeys).toEqual(["baseUrl"]);
			});

			it("should NOT have apiKey field (Ollama does not require API key)", () => {
				const auth = ollamaProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey).toBeUndefined();
			});
		});
	});

	// =========================================================================
	// Capabilities Tests
	// =========================================================================
	describe("capabilities", () => {
		it("should support chat", () => {
			expect(ollamaProvider.capabilities.chat).toBe(true);
		});

		it("should support embedding", () => {
			expect(ollamaProvider.capabilities.embedding).toBe(true);
		});

		it("should support model discovery", () => {
			expect(ollamaProvider.capabilities.modelDiscovery).toBe(true);
		});
	});

	// =========================================================================
	// createRuntimeDefinition Tests
	// =========================================================================
	describe("createRuntimeDefinition", () => {
		const mockAuth: RuntimeFieldBasedAuthState = {
			type: "field-based",
			values: {
				baseUrl: "http://localhost:11434",
			},
		};

		const mockAuthEmpty: RuntimeFieldBasedAuthState = {
			type: "field-based",
			values: {},
		};

		const mockModelIds = {
			chat: ["llama3.1", "mistral"],
			embedding: ["nomic-embed-text"],
		};

		it("should return RuntimeProviderDefinition with chatModels", async () => {
			const runtime = await ollamaProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			expect(runtime.chatModels).toBeDefined();
			expect(typeof runtime.chatModels).toBe("object");
		});

		it("should return RuntimeProviderDefinition with embeddingModels", async () => {
			const runtime = await ollamaProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			expect(runtime.embeddingModels).toBeDefined();
			expect(typeof runtime.embeddingModels).toBe("object");
		});

		it("should have chat models for provided model IDs", async () => {
			const runtime = await ollamaProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			const modelIds = Object.keys(runtime.chatModels);
			expect(modelIds.length).toBeGreaterThan(0);
		});

		it("should have embedding models for provided model IDs", async () => {
			const runtime = await ollamaProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			const modelIds = Object.keys(runtime.embeddingModels);
			expect(modelIds.length).toBeGreaterThan(0);
		});

		it("should create chat model factories that call createOllamaChatModel", async () => {
			const runtime = await ollamaProvider.createRuntimeDefinition(mockAuth, mockModelIds);

			// The runtime should have chat model factories for provided model IDs
			const modelIds = Object.keys(runtime.chatModels);
			expect(modelIds.length).toBeGreaterThan(0);

			// Call the first factory
			const firstModelId = modelIds[0];
			await runtime.chatModels[firstModelId]({ temperature: 0.7, contextWindow: 8192 });

			expect(spyCreateOllamaChatModel).toHaveBeenCalled();
		});

		it("should create embedding model factories that call createOllamaEmbeddingModel", async () => {
			const runtime = await ollamaProvider.createRuntimeDefinition(mockAuth, mockModelIds);

			// The runtime should have embedding model factories for provided model IDs
			const modelIds = Object.keys(runtime.embeddingModels);
			expect(modelIds.length).toBeGreaterThan(0);

			// Call the first factory
			const firstModelId = modelIds[0];
			await runtime.embeddingModels[firstModelId]();

			expect(spyCreateOllamaEmbeddingModel).toHaveBeenCalled();
		});

		it("should work with empty baseUrl (uses localhost default)", async () => {
			const runtime = await ollamaProvider.createRuntimeDefinition(mockAuthEmpty, mockModelIds);
			expect(runtime.chatModels).toBeDefined();
			expect(runtime.embeddingModels).toBeDefined();
		});

		it("should throw error when auth type is not field-based", async () => {
			const oauthAuth = {
				type: "oauth" as const,
				tokens: { accessToken: "token" },
			};
			await expect(ollamaProvider.createRuntimeDefinition(oauthAuth, mockModelIds)).rejects.toThrow();
		});
	});

	// =========================================================================
	// validateAuth Tests
	// =========================================================================
	describe("validateAuth", () => {
		it("should reject when auth type is not field-based", async () => {
			const oauthAuth = {
				type: "oauth" as const,
				tokens: { accessToken: "token" },
			};
			const result = await ollamaProvider.validateAuth(oauthAuth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should accept empty baseUrl (uses localhost default)", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};
			await ollamaProvider.validateAuth(auth);
			// Should delegate to base runtime without error
			expect(spyValidateOllamaConnection).toHaveBeenCalled();
		});

		it("should accept valid baseUrl", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			await ollamaProvider.validateAuth(auth);
			expect(spyValidateOllamaConnection).toHaveBeenCalledWith(auth);
		});

		it("should return valid: true when validateOllamaConnection succeeds", async () => {
			spyValidateOllamaConnection.mockResolvedValueOnce({ valid: true });

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			const result = await ollamaProvider.validateAuth(auth);
			expect(result.valid).toBe(true);
		});

		it("should return valid: false with error when validateOllamaConnection fails", async () => {
			spyValidateOllamaConnection.mockResolvedValueOnce({
				valid: false,
				error: "Connection refused",
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			const result = await ollamaProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBe("Connection refused");
			}
		});
	});

	// =========================================================================
	// discoverModels Tests
	// =========================================================================
	describe("discoverModels", () => {
		it("should have discoverModels method (Ollama supports model discovery)", () => {
			expect(ollamaProvider.discoverModels).toBeDefined();
			expect(typeof ollamaProvider.discoverModels).toBe("function");
		});

		it("should throw error when auth type is not field-based", async () => {
			const oauthAuth = {
				type: "oauth" as const,
				tokens: { accessToken: "token" },
			};
			const discoverModels = ollamaProvider.discoverModels;
			expect(discoverModels).toBeDefined();
			if (discoverModels) {
				await expect(discoverModels(oauthAuth)).rejects.toThrow();
			}
		});

		it("should call discoverOllamaModels from base runtime", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			const discoverModels = ollamaProvider.discoverModels;
			expect(discoverModels).toBeDefined();
			if (discoverModels) {
				await discoverModels(auth);
			}
			expect(spyDiscoverOllamaModels).toHaveBeenCalledWith(auth);
		});

		it("should return discovered chat and embedding models", async () => {
			spyDiscoverOllamaModels.mockResolvedValueOnce({
				chat: ["llama3.1", "mistral", "codellama"],
				embedding: ["nomic-embed-text", "mxbai-embed-large"],
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { baseUrl: "http://localhost:11434" },
			};
			const discoverModels = ollamaProvider.discoverModels;
			expect(discoverModels).toBeDefined();
			if (discoverModels) {
				const result = await discoverModels(auth);
				expect(result.chat).toContain("llama3.1");
				expect(result.chat).toContain("mistral");
				expect(result.embedding).toContain("nomic-embed-text");
			}
		});

		it("should work with empty baseUrl (uses localhost default)", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};
			const discoverModels = ollamaProvider.discoverModels;
			expect(discoverModels).toBeDefined();
			if (discoverModels) {
				await discoverModels(auth);
			}
			expect(spyDiscoverOllamaModels).toHaveBeenCalledWith(auth);
		});
	});
});
