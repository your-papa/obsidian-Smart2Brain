/**
 * Tests for SAP AI Core built-in provider definition
 *
 * Tests cover:
 * - Provider identity (id, displayName, isBuiltIn)
 * - Setup instructions (steps, link)
 * - Auth configuration (field-based with apiKey/token, baseUrl)
 * - Capabilities (chat: true, embedding: true, modelDiscovery: true)
 * - createRuntimeDefinition function
 * - validateAuth function
 * - discoverModels function
 *
 * NOTE: SAP AI Core uses the @sap-ai-sdk/langchain package which provides
 * AzureOpenAiChatClient and AzureOpenAiEmbeddingClient. This package is optional
 * and must be installed separately by users.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as baseRuntime from "../../../src/providers/base/sapAiCoreRuntime.ts";
import { sapAiCoreProvider } from "../../../src/providers/builtin/sapAiCore.ts";
import type { FieldBasedAuth, RuntimeFieldBasedAuthState } from "../../../src/providers/types.ts";

// Type for spies
type SpyFn = ReturnType<typeof vi.spyOn>;

describe("SAP AI Core Provider Definition", () => {
	// Spies for base runtime functions
	let spyCreateSapAiCoreChatModel: SpyFn;
	let spyCreateSapAiCoreEmbeddingModel: SpyFn;
	let spyValidateSapAiCoreAuth: SpyFn;
	let spyDiscoverSapAiCoreModels: SpyFn;

	beforeEach(() => {
		// Set up spies on the base runtime functions
		// Cast mock return values through unknown to avoid LangChain type requirements
		spyCreateSapAiCoreChatModel = vi
			.spyOn(baseRuntime, "createSapAiCoreChatModel")
			.mockResolvedValue({ invoke: vi.fn() } as unknown as Awaited<
				ReturnType<typeof baseRuntime.createSapAiCoreChatModel>
			>);
		spyCreateSapAiCoreEmbeddingModel = vi
			.spyOn(baseRuntime, "createSapAiCoreEmbeddingModel")
			.mockResolvedValue({ embedQuery: vi.fn() } as unknown as Awaited<
				ReturnType<typeof baseRuntime.createSapAiCoreEmbeddingModel>
			>);
		spyValidateSapAiCoreAuth = vi.spyOn(baseRuntime, "validateSapAiCoreAuth").mockResolvedValue({ valid: true });
		spyDiscoverSapAiCoreModels = vi.spyOn(baseRuntime, "discoverSapAiCoreModels").mockResolvedValue({
			chat: ["gpt-4o", "gpt-4o-mini"],
			embedding: ["text-embedding-ada-002"],
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// Identity Tests
	// =========================================================================
	describe("identity", () => {
		it('should have id "sap-ai-core"', () => {
			expect(sapAiCoreProvider.id).toBe("sap-ai-core");
		});

		it('should have displayName "SAP AI Core"', () => {
			expect(sapAiCoreProvider.displayName).toBe("SAP AI Core");
		});

		it("should be marked as built-in", () => {
			expect(sapAiCoreProvider.isBuiltIn).toBe(true);
		});
	});

	// =========================================================================
	// Setup Instructions Tests
	// =========================================================================
	describe("setupInstructions", () => {
		it("should have steps array with at least 1 step", () => {
			expect(sapAiCoreProvider.setupInstructions.steps.length).toBeGreaterThan(0);
		});

		it("should have link to SAP documentation", () => {
			expect(sapAiCoreProvider.setupInstructions.link).toBeDefined();
			expect(sapAiCoreProvider.setupInstructions.link?.url).toContain("sap");
		});

		it("should have text for the link", () => {
			expect(sapAiCoreProvider.setupInstructions.link?.text).toBeDefined();
			expect(sapAiCoreProvider.setupInstructions.link?.text.length).toBeGreaterThan(0);
		});
	});

	// =========================================================================
	// Auth Configuration Tests
	// =========================================================================
	describe("auth", () => {
		it("should be field-based auth", () => {
			expect(sapAiCoreProvider.auth.type).toBe("field-based");
		});

		describe("apiKey field (token)", () => {
			it("should have apiKey as required secret field", () => {
				const auth = sapAiCoreProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey).toBeDefined();
				expect(auth.fields.apiKey.required).toBe(true);
				expect(auth.fields.apiKey.kind).toBe("secret");
			});

			it("should have label for apiKey", () => {
				const auth = sapAiCoreProvider.auth as FieldBasedAuth;
				expect(auth.fields.apiKey.label).toBeDefined();
				expect(auth.fields.apiKey.label.length).toBeGreaterThan(0);
			});
		});

		describe("baseUrl field", () => {
			it("should have baseUrl as required text field", () => {
				const auth = sapAiCoreProvider.auth as FieldBasedAuth;
				expect(auth.fields.baseUrl).toBeDefined();
				expect(auth.fields.baseUrl.required).toBe(true);
				expect(auth.fields.baseUrl.kind).toBe("text");
			});

			it("should have label for baseUrl", () => {
				const auth = sapAiCoreProvider.auth as FieldBasedAuth;
				expect(auth.fields.baseUrl.label).toBeDefined();
			});
		});

		describe("resourceGroup field", () => {
			it("should have resourceGroup field for SAP resource group", () => {
				const auth = sapAiCoreProvider.auth as FieldBasedAuth;
				expect(auth.fields.resourceGroup).toBeDefined();
			});

			it("should have resourceGroup as optional text field", () => {
				const auth = sapAiCoreProvider.auth as FieldBasedAuth;
				expect(auth.fields.resourceGroup.kind).toBe("text");
				expect(auth.fields.resourceGroup.required).toBe(false);
			});
		});
	});

	// =========================================================================
	// Capabilities Tests
	// =========================================================================
	describe("capabilities", () => {
		it("should support chat", () => {
			expect(sapAiCoreProvider.capabilities.chat).toBe(true);
		});

		it("should support embedding", () => {
			expect(sapAiCoreProvider.capabilities.embedding).toBe(true);
		});

		it("should support model discovery", () => {
			expect(sapAiCoreProvider.capabilities.modelDiscovery).toBe(true);
		});
	});

	// =========================================================================
	// createRuntimeDefinition Tests
	// =========================================================================
	describe("createRuntimeDefinition", () => {
		const mockAuth: RuntimeFieldBasedAuthState = {
			type: "field-based",
			values: {
				apiKey: "test-token",
				baseUrl: "https://api.ai.sap.com/v1",
				resourceGroup: "default",
			},
		};

		const mockModelIds = {
			chat: ["gpt-4o", "gpt-4o-mini"],
			embedding: ["text-embedding-ada-002"],
		};

		it("should return RuntimeProviderDefinition with chatModels", async () => {
			const runtime = await sapAiCoreProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			expect(runtime.chatModels).toBeDefined();
			expect(typeof runtime.chatModels).toBe("object");
		});

		it("should return RuntimeProviderDefinition with embeddingModels", async () => {
			const runtime = await sapAiCoreProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			expect(runtime.embeddingModels).toBeDefined();
			expect(typeof runtime.embeddingModels).toBe("object");
		});

		it("should have chat models for provided model IDs", async () => {
			const runtime = await sapAiCoreProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			const modelIds = Object.keys(runtime.chatModels);
			expect(modelIds.length).toBeGreaterThan(0);
		});

		it("should have embedding models for provided model IDs", async () => {
			const runtime = await sapAiCoreProvider.createRuntimeDefinition(mockAuth, mockModelIds);
			const modelIds = Object.keys(runtime.embeddingModels);
			expect(modelIds.length).toBeGreaterThan(0);
		});

		it("should create chat model factories that call createSapAiCoreChatModel", async () => {
			const runtime = await sapAiCoreProvider.createRuntimeDefinition(mockAuth, mockModelIds);

			// The runtime should have chat model factories for provided model IDs
			const modelIds = Object.keys(runtime.chatModels);
			expect(modelIds.length).toBeGreaterThan(0);

			// Call the first factory
			const firstModelId = modelIds[0];
			await runtime.chatModels[firstModelId]({ temperature: 0.7, contextWindow: 128000 });

			expect(spyCreateSapAiCoreChatModel).toHaveBeenCalled();
		});

		it("should create embedding model factories that call createSapAiCoreEmbeddingModel", async () => {
			const runtime = await sapAiCoreProvider.createRuntimeDefinition(mockAuth, mockModelIds);

			// The runtime should have embedding model factories for provided model IDs
			const modelIds = Object.keys(runtime.embeddingModels);
			expect(modelIds.length).toBeGreaterThan(0);

			// Call the first factory
			const firstModelId = modelIds[0];
			await runtime.embeddingModels[firstModelId]();

			expect(spyCreateSapAiCoreEmbeddingModel).toHaveBeenCalled();
		});

		it("should throw error when auth type is not field-based", async () => {
			const oauthAuth = {
				type: "oauth" as const,
				tokens: { accessToken: "token" },
			};
			await expect(sapAiCoreProvider.createRuntimeDefinition(oauthAuth, mockModelIds)).rejects.toThrow();
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
			const result = await sapAiCoreProvider.validateAuth(oauthAuth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBeDefined();
			}
		});

		it("should reject when apiKey is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "https://api.ai.sap.com/v1",
				},
			};
			const result = await sapAiCoreProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error.toLowerCase()).toContain("token");
			}
		});

		it("should reject when apiKey is empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "",
					baseUrl: "https://api.ai.sap.com/v1",
				},
			};
			const result = await sapAiCoreProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
		});

		it("should reject when baseUrl is missing", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-token",
				},
			};
			const result = await sapAiCoreProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error.toLowerCase()).toContain("url");
			}
		});

		it("should reject when baseUrl is empty string", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-token",
					baseUrl: "",
				},
			};
			const result = await sapAiCoreProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
		});

		it("should call validateSapAiCoreAuth from base runtime for valid input", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-token",
					baseUrl: "https://api.ai.sap.com/v1",
				},
			};
			await sapAiCoreProvider.validateAuth(auth);
			expect(spyValidateSapAiCoreAuth).toHaveBeenCalledWith(auth);
		});

		it("should return valid: true when validateSapAiCoreAuth succeeds", async () => {
			spyValidateSapAiCoreAuth.mockResolvedValueOnce({ valid: true });

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-token",
					baseUrl: "https://api.ai.sap.com/v1",
				},
			};
			const result = await sapAiCoreProvider.validateAuth(auth);
			expect(result.valid).toBe(true);
		});

		it("should return valid: false with error when validateSapAiCoreAuth fails", async () => {
			spyValidateSapAiCoreAuth.mockResolvedValueOnce({
				valid: false,
				error: "Invalid API token",
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "invalid-token",
					baseUrl: "https://api.ai.sap.com/v1",
				},
			};
			const result = await sapAiCoreProvider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBe("Invalid API token");
			}
		});
	});

	// =========================================================================
	// discoverModels Tests
	// =========================================================================
	describe("discoverModels", () => {
		it("should have discoverModels method (SAP AI Core supports model discovery)", () => {
			expect(sapAiCoreProvider.discoverModels).toBeDefined();
			expect(typeof sapAiCoreProvider.discoverModels).toBe("function");
		});

		it("should throw error when auth type is not field-based", async () => {
			const oauthAuth = {
				type: "oauth" as const,
				tokens: { accessToken: "token" },
			};
			const discoverModels = sapAiCoreProvider.discoverModels;
			expect(discoverModels).toBeDefined();
			if (discoverModels) {
				await expect(discoverModels(oauthAuth)).rejects.toThrow();
			}
		});

		it("should call discoverSapAiCoreModels from base runtime", async () => {
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-token",
					baseUrl: "https://api.ai.sap.com/v1",
				},
			};
			const discoverModels = sapAiCoreProvider.discoverModels;
			expect(discoverModels).toBeDefined();
			if (discoverModels) {
				await discoverModels(auth);
			}
			expect(spyDiscoverSapAiCoreModels).toHaveBeenCalledWith(auth);
		});

		it("should return discovered chat and embedding models", async () => {
			spyDiscoverSapAiCoreModels.mockResolvedValueOnce({
				chat: ["gpt-4o", "gpt-4o-mini", "gpt-35-turbo"],
				embedding: ["text-embedding-ada-002", "text-embedding-3-small"],
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-token",
					baseUrl: "https://api.ai.sap.com/v1",
				},
			};
			const discoverModels = sapAiCoreProvider.discoverModels;
			expect(discoverModels).toBeDefined();
			if (discoverModels) {
				const result = await discoverModels(auth);
				expect(result.chat).toContain("gpt-4o");
				expect(result.chat).toContain("gpt-4o-mini");
				expect(result.embedding).toContain("text-embedding-ada-002");
			}
		});
	});
});
