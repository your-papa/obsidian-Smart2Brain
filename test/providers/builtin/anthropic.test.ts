/**
 * Tests for Anthropic built-in provider definition
 *
 * Tests cover:
 * - Provider identity (id, displayName, isBuiltIn)
 * - Setup instructions (steps, link)
 * - Auth configuration (field-based with apiKey required, baseUrl/headers optional)
 * - Capabilities (chat: true, embedding: false, modelDiscovery: true)
 * - createRuntimeDefinition function
 * - validateAuth function
 * - discoverModels function
 *
 * NOTE: This test file uses manual spies on the imported base runtime functions
 * to avoid module mock pollution issues with bun's module caching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as baseRuntime from "../../../src/providers/base/anthropicRuntime.ts";
import { anthropicProvider } from "../../../src/providers/builtin/anthropic.ts";
import type { FieldBasedAuth, RuntimeFieldBasedAuthState } from "../../../src/providers/types.ts";

// Type for spies
type SpyFn = ReturnType<typeof vi.spyOn>;

describe("Anthropic Provider Definition", () => {
	// Spies for base runtime functions
	let spyCreateAnthropicChatModel: SpyFn;
	let spyValidateAnthropicAuth: SpyFn;
	let spyDiscoverAnthropicModels: SpyFn;

	beforeEach(() => {
		// Set up spies on the base runtime functions
		// Cast mock return values through unknown to avoid LangChain type requirements
		spyCreateAnthropicChatModel = vi
			.spyOn(baseRuntime, "createAnthropicChatModel")
			.mockResolvedValue({ invoke: vi.fn() } as unknown as Awaited<
				ReturnType<typeof baseRuntime.createAnthropicChatModel>
			>);
		spyValidateAnthropicAuth = vi.spyOn(baseRuntime, "validateAnthropicAuth").mockResolvedValue({ valid: true });
		spyDiscoverAnthropicModels = vi.spyOn(baseRuntime, "discoverAnthropicModels").mockResolvedValue({
			chat: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
			embedding: [],
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// Identity Tests
	// =========================================================================
	describe("identity", () => {
		it('should have id "anthropic"', () => {
			expect(anthropicProvider.id).toBe("anthropic");
		});

		it('should have displayName "Anthropic"', () => {
			expect(anthropicProvider.displayName).toBe("Anthropic");
		});

		it("should be marked as built-in", () => {
			expect(anthropicProvider.isBuiltIn).toBe(true);
		});
	});

	// =========================================================================
	// Setup Instructions Tests
	// =========================================================================
	describe("setupInstructions", () => {
		it("should have steps array with at least 1 step", () => {
			expect(anthropicProvider.setupInstructions.steps.length).toBeGreaterThan(0);
		});

		it("should have link to Anthropic console", () => {
			expect(anthropicProvider.setupInstructions.link).toBeDefined();
			expect(anthropicProvider.setupInstructions.link?.url).toContain("anthropic.com");
		});

		it("should have text for the link", () => {
			expect(anthropicProvider.setupInstructions.link?.text).toBeDefined();
			expect(anthropicProvider.setupInstructions.link?.text.length).toBeGreaterThan(0);
		});
	});

	// =========================================================================
	// Auth Configuration Tests
	// =========================================================================
	describe("auth", () => {
		it("should be field-based auth", () => {
			expect(anthropicProvider.auth.type).toBe("field-based");
		});

		describe("apiKey field", () => {
			it("should have apiKey as required secret field", () => {
				const auth = anthropicProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey).toBeDefined();
				expect(auth.fields.apiKey.required).toBe(true);
				expect(auth.fields.apiKey.kind).toBe("secret");
			});

			it("should have label for apiKey", () => {
				const auth = anthropicProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey.label).toBeDefined();
				expect(auth.fields.apiKey.label.length).toBeGreaterThan(0);
			});

			it("should have placeholder for apiKey", () => {
				const auth = anthropicProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey.placeholder).toBeDefined();
				expect(auth.fields.apiKey.placeholder).toContain("sk-ant");
			});
		});

		describe("field count", () => {
			it("should have all three standard auth fields", () => {
				const auth = anthropicProvider.auth as FieldBasedAuth;
				const fieldKeys = Object.keys(auth.fields);
				expect(fieldKeys).toContain("apiKey");
				expect(fieldKeys).toContain("baseUrl");
				expect(fieldKeys).toContain("headers");
				expect(fieldKeys).toHaveLength(3);
			});

			it("should have apiKey as required, baseUrl and headers as optional", () => {
				const auth = anthropicProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey.required).toBe(true);
				expect(auth.fields.baseUrl.required).toBe(false);
				expect(auth.fields.headers.required).toBe(false);
			});
		});
	});

	// =========================================================================
	// Capabilities Tests
	// =========================================================================
	describe("capabilities", () => {
		it("should support chat", () => {
			expect(anthropicProvider.capabilities.chat).toBe(true);
		});

		it("should NOT support embedding", () => {
			expect(anthropicProvider.capabilities.embedding).toBe(false);
		});

		it("should support model discovery", () => {
			expect(anthropicProvider.capabilities.modelDiscovery).toBe(true);
		});
	});

	// =========================================================================
	// createRuntimeDefinition Tests
	// =========================================================================
	describe("createRuntimeDefinition", () => {
		const mockAuth: RuntimeFieldBasedAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-ant-test-key",
			},
		};

		const mockModelIds = {
			chat: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
			embedding: [],
		};

		it("should return RuntimeProviderDefinition with chatModels", async () => {
			const runtime = await anthropicProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			expect(runtime.chatModels).toBeDefined();
			expect(typeof runtime.chatModels).toBe("object");
		});

		it("should return RuntimeProviderDefinition with empty embeddingModels", async () => {
			const runtime = await anthropicProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			expect(runtime.embeddingModels).toBeDefined();
			expect(Object.keys(runtime.embeddingModels)).toHaveLength(0);
		});

		it("should have chat models for provided model IDs", async () => {
			const runtime = await anthropicProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			const modelIds = Object.keys(runtime.chatModels);
			expect(modelIds.length).toBeGreaterThan(0);
			expect(modelIds.some((id) => id.includes("claude-3"))).toBe(true);
		});

		it("should create chat model factories that call createAnthropicChatModel", async () => {
			const runtime = await anthropicProvider.createRuntimeDefinition(mockAuth, mockModelIds);

			// The runtime should have chat model factories for provided model IDs
			const modelIds = Object.keys(runtime.chatModels);
			expect(modelIds.length).toBeGreaterThan(0);

			// Call the first factory
			const firstModelId = modelIds[0];
			await runtime.chatModels[firstModelId]({ temperature: 0.7, contextWindow: 200000 });

			expect(spyCreateAnthropicChatModel).toHaveBeenCalled();
		});

		it("should throw error when auth type is not field-based", async () => {
			const oauthAuth = {
				type: "oauth" as const,
				tokens: { accessToken: "token" },
			};
			await expect(anthropicProvider.createRuntimeDefinition(oauthAuth, mockModelIds)).rejects.toThrow();
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
			const result = await anthropicProvider.validateAuth(oauthAuth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should reject when apiKey is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {},
			};
			const result = await anthropicProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error.toLowerCase()).toContain("api key");
			}
		});

		it("should reject when apiKey is empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "" },
			};
			const result = await anthropicProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
		});

		it("should reject when apiKey is whitespace only", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "   " },
			};
			const result = await anthropicProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
		});

		it("should call validateAnthropicAuth from base runtime for valid input", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};
			await anthropicProvider.validateAuth(auth);
			expect(spyValidateAnthropicAuth).toHaveBeenCalledWith(auth);
		});

		it("should return valid: true when validateAnthropicAuth succeeds", async () => {
			spyValidateAnthropicAuth.mockResolvedValueOnce({ valid: true });

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-test-key" },
			};
			const result = await anthropicProvider.validateAuth(auth);
			expect(result.valid).toBe(true);
		});

		it("should return valid: false with error when validateAnthropicAuth fails", async () => {
			spyValidateAnthropicAuth.mockResolvedValueOnce({
				valid: false,
				error: "Invalid API key",
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: { apiKey: "sk-ant-invalid-key" },
			};
			const result = await anthropicProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBe("Invalid API key");
			}
		});
	});

	// =========================================================================
	// discoverModels Tests
	// =========================================================================
	describe("discoverModels", () => {
		const mockAuth: RuntimeFieldBasedAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-ant-test-key",
			},
		};

		it("should have discoverModels method", () => {
			expect(anthropicProvider.discoverModels).toBeDefined();
			expect(typeof anthropicProvider.discoverModels).toBe("function");
		});

		it("should call discoverAnthropicModels from base runtime", async () => {
			if (!anthropicProvider.discoverModels) {
				throw new Error("discoverModels should be defined");
			}
			await anthropicProvider.discoverModels(mockAuth);
			expect(spyDiscoverAnthropicModels).toHaveBeenCalledWith(mockAuth);
		});

		it("should return DiscoveredModels with chat array", async () => {
			if (!anthropicProvider.discoverModels) {
				throw new Error("discoverModels should be defined");
			}
			const result = await anthropicProvider.discoverModels(mockAuth);
			expect(result.chat).toBeDefined();
			expect(Array.isArray(result.chat)).toBe(true);
			expect(result.chat.length).toBeGreaterThan(0);
		});

		it("should return DiscoveredModels with empty embedding array", async () => {
			if (!anthropicProvider.discoverModels) {
				throw new Error("discoverModels should be defined");
			}
			const result = await anthropicProvider.discoverModels(mockAuth);
			expect(result.embedding).toBeDefined();
			expect(Array.isArray(result.embedding)).toBe(true);
			expect(result.embedding).toHaveLength(0);
		});

		it("should throw error when auth type is not field-based", async () => {
			if (!anthropicProvider.discoverModels) {
				throw new Error("discoverModels should be defined");
			}
			const oauthAuth = {
				type: "oauth" as const,
				tokens: { accessToken: "token" },
			};
			await expect(anthropicProvider.discoverModels(oauthAuth)).rejects.toThrow();
		});
	});
});
