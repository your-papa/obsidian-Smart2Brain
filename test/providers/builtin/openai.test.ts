/**
 * Tests for OpenAI built-in provider definition
 *
 * Tests cover:
 * - Provider identity (id, displayName, isBuiltIn)
 * - Setup instructions (steps, link)
 * - Auth configuration (field-based with apiKey, baseUrl, headers)
 * - Capabilities (chat, embedding, modelDiscovery)
 * - createRuntimeDefinition function
 * - validateAuth function
 * - discoverModels function
 *
 * NOTE: This test file uses manual spies on the imported base runtime functions
 * to avoid module mock pollution issues with bun's module caching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as baseRuntime from "../../../src/providers/base/openaiCompatible.ts";
import { openaiProvider } from "../../../src/providers/builtin/openai.ts";
import type { FieldBasedAuth, RuntimeFieldBasedAuthState } from "../../../src/providers/types.ts";

// Type for spies
type SpyFn = ReturnType<typeof vi.spyOn>;

describe("OpenAI Provider Definition", () => {
	// Spies for base runtime functions
	let spyCreateOpenAIChatModel: SpyFn;
	let spyCreateOpenAIEmbeddingModel: SpyFn;
	let spyValidateOpenAIAuth: SpyFn;
	let spyDiscoverOpenAIModels: SpyFn;

	beforeEach(() => {
		// Set up spies on the base runtime functions
		// Cast mock return values through unknown to avoid LangChain type requirements
		spyCreateOpenAIChatModel = vi
			.spyOn(baseRuntime, "createOpenAIChatModel")
			.mockResolvedValue({ invoke: vi.fn() } as unknown as Awaited<
				ReturnType<typeof baseRuntime.createOpenAIChatModel>
			>);
		spyCreateOpenAIEmbeddingModel = vi
			.spyOn(baseRuntime, "createOpenAIEmbeddingModel")
			.mockResolvedValue({ embedQuery: vi.fn() } as unknown as Awaited<
				ReturnType<typeof baseRuntime.createOpenAIEmbeddingModel>
			>);
		spyValidateOpenAIAuth = vi.spyOn(baseRuntime, "validateOpenAIAuth").mockResolvedValue({ valid: true });
		spyDiscoverOpenAIModels = vi.spyOn(baseRuntime, "discoverOpenAIModels").mockResolvedValue({
			chat: ["gpt-4o", "gpt-4o-mini"],
			embedding: ["text-embedding-3-small"],
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// Identity Tests
	// =========================================================================
	describe("identity", () => {
		it('should have id "openai"', () => {
			expect(openaiProvider.id).toBe("openai");
		});

		it('should have displayName "OpenAI"', () => {
			expect(openaiProvider.displayName).toBe("OpenAI");
		});

		it("should be marked as built-in", () => {
			expect(openaiProvider.isBuiltIn).toBe(true);
		});
	});

	// =========================================================================
	// Setup Instructions Tests
	// =========================================================================
	describe("setupInstructions", () => {
		it("should have steps array with at least 1 step", () => {
			expect(openaiProvider.setupInstructions.steps.length).toBeGreaterThan(0);
		});

		it("should have link to OpenAI dashboard", () => {
			expect(openaiProvider.setupInstructions.link).toBeDefined();
			expect(openaiProvider.setupInstructions.link?.url).toContain("openai.com");
		});

		it("should have text for the link", () => {
			expect(openaiProvider.setupInstructions.link?.text).toBeDefined();
			expect(openaiProvider.setupInstructions.link?.text.length).toBeGreaterThan(0);
		});
	});

	// =========================================================================
	// Auth Configuration Tests
	// =========================================================================
	describe("auth", () => {
		it("should be field-based auth", () => {
			expect(openaiProvider.auth.type).toBe("field-based");
		});

		describe("apiKey field", () => {
			it("should have apiKey as required secret field", () => {
				const auth = openaiProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey).toBeDefined();
				expect(auth.fields.apiKey.required).toBe(true);
				expect(auth.fields.apiKey.kind).toBe("secret");
			});

			it("should have label for apiKey", () => {
				const auth = openaiProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey.label).toBeDefined();
				expect(auth.fields.apiKey.label.length).toBeGreaterThan(0);
			});

			it("should have placeholder for apiKey", () => {
				const auth = openaiProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey.placeholder).toBeDefined();
				expect(auth.fields.apiKey.placeholder).toContain("sk-");
			});
		});

		describe("baseUrl field", () => {
			it("should have baseUrl as optional text field", () => {
				const auth = openaiProvider.auth as FieldBasedAuth;
				expect(auth.fields.baseUrl).toBeDefined();
				expect(auth.fields.baseUrl.required).toBe(false);
				expect(auth.fields.baseUrl.kind).toBe("text");
			});

			it("should have label for baseUrl", () => {
				const auth = openaiProvider.auth as FieldBasedAuth;
				expect(auth.fields.baseUrl.label).toBeDefined();
			});
		});

		describe("headers field", () => {
			it("should have headers as optional textarea field", () => {
				const auth = openaiProvider.auth as FieldBasedAuth;
				expect(auth.fields.headers).toBeDefined();
				expect(auth.fields.headers.required).toBe(false);
				expect(auth.fields.headers.kind).toBe("textarea");
			});
		});
	});

	// =========================================================================
	// Capabilities Tests
	// =========================================================================
	describe("capabilities", () => {
		it("should support chat", () => {
			expect(openaiProvider.capabilities.chat).toBe(true);
		});

		it("should support embedding", () => {
			expect(openaiProvider.capabilities.embedding).toBe(true);
		});

		it("should support model discovery", () => {
			expect(openaiProvider.capabilities.modelDiscovery).toBe(true);
		});
	});

	// =========================================================================
	// createRuntimeDefinition Tests
	// =========================================================================
	describe("createRuntimeDefinition", () => {
		const mockAuth: RuntimeFieldBasedAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-test-key",
				baseUrl: "",
				headers: "",
			},
		};

		const mockModelIds = {
			chat: ["gpt-4o", "gpt-4o-mini"],
			embedding: ["text-embedding-3-small"],
		};

		it("should return RuntimeProviderDefinition with chatModels", async () => {
			const runtime = await openaiProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			expect(runtime.chatModels).toBeDefined();
			expect(typeof runtime.chatModels).toBe("object");
		});

		it("should return RuntimeProviderDefinition with embeddingModels", async () => {
			const runtime = await openaiProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			expect(runtime.embeddingModels).toBeDefined();
			expect(typeof runtime.embeddingModels).toBe("object");
		});

		it("should create chat model factories that call createOpenAIChatModel", async () => {
			const runtime = await openaiProvider.createRuntimeDefinition(mockAuth, mockModelIds);

			// The runtime should have chat model factories for the provided model IDs
			const modelIds = Object.keys(runtime.chatModels);
			expect(modelIds.length).toBeGreaterThan(0);

			// Call the first factory
			const firstModelId = modelIds[0];
			await runtime.chatModels[firstModelId]({ temperature: 0.7, contextWindow: 128000 });

			expect(spyCreateOpenAIChatModel).toHaveBeenCalled();
		});

		it("should create embedding model factories that call createOpenAIEmbeddingModel", async () => {
			const runtime = await openaiProvider.createRuntimeDefinition(mockAuth, mockModelIds);

			// The runtime should have embedding model factories for the provided model IDs
			const modelIds = Object.keys(runtime.embeddingModels);
			expect(modelIds.length).toBeGreaterThan(0);

			// Call the first factory
			const firstModelId = modelIds[0];
			await runtime.embeddingModels[firstModelId]();

			expect(spyCreateOpenAIEmbeddingModel).toHaveBeenCalled();
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
			const result = await openaiProvider.validateAuth(oauthAuth);
			expect(result.valid).toBe(false);
			if (result.valid === false) {
				expect(result.error).toBeDefined();
			}
		});

		it("should reject when apiKey is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};
			const result = await openaiProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (result.valid === false) {
				expect(result.error.toLowerCase()).toContain("api key");
			}
		});

		it("should reject when apiKey is empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "" },
			};
			const result = await openaiProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
		});

		it("should reject when apiKey is whitespace only", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "   " },
			};
			const result = await openaiProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
		});

		it("should call validateOpenAIAuth from base runtime for valid input", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};
			await openaiProvider.validateAuth(auth);
			expect(spyValidateOpenAIAuth).toHaveBeenCalledWith(auth);
		});

		it("should return valid: true when validateOpenAIAuth succeeds", async () => {
			spyValidateOpenAIAuth.mockResolvedValueOnce({ valid: true });

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};
			const result = await openaiProvider.validateAuth(auth);
			expect(result.valid).toBe(true);
		});

		it("should return valid: false with error when validateOpenAIAuth fails", async () => {
			spyValidateOpenAIAuth.mockResolvedValueOnce({
				valid: false,
				error: "Invalid API key",
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-invalid-key" },
			};
			const result = await openaiProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (result.valid === false) {
				expect(result.error).toBe("Invalid API key");
			}
		});
	});

	// =========================================================================
	// discoverModels Tests
	// =========================================================================
	describe("discoverModels", () => {
		it("should be defined (built-in provider with modelDiscovery capability)", () => {
			expect(openaiProvider.discoverModels).toBeDefined();
		});

		it("should call discoverOpenAIModels from base runtime", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const discoverFn = openaiProvider.discoverModels;
			expect(discoverFn).toBeDefined();
			if (discoverFn) {
				await discoverFn(auth);
				expect(spyDiscoverOpenAIModels).toHaveBeenCalledWith(auth);
			}
		});

		it("should return DiscoveredModels with chat array", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const discoverFn = openaiProvider.discoverModels;
			expect(discoverFn).toBeDefined();
			if (discoverFn) {
				const result = await discoverFn(auth);
				expect(result.chat).toBeDefined();
				expect(Array.isArray(result.chat)).toBe(true);
			}
		});

		it("should return DiscoveredModels with embedding array", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const discoverFn = openaiProvider.discoverModels;
			expect(discoverFn).toBeDefined();
			if (discoverFn) {
				const result = await discoverFn(auth);
				expect(result.embedding).toBeDefined();
				expect(Array.isArray(result.embedding)).toBe(true);
			}
		});

		it("should pass through results from discoverOpenAIModels", async () => {
			const customMockModels = {
				chat: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
				embedding: ["text-embedding-3-small", "text-embedding-3-large"],
			};
			spyDiscoverOpenAIModels.mockResolvedValueOnce(customMockModels);

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-test-key" },
			};

			const discoverFn = openaiProvider.discoverModels;
			expect(discoverFn).toBeDefined();
			if (discoverFn) {
				const result = await discoverFn(auth);
				expect(result).toEqual(customMockModels);
			}
		});
	});
});
