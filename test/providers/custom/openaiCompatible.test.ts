/**
 * Tests for createCustomOpenAICompatibleProvider factory
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomOpenAICompatibleProvider } from "../../../src/providers/custom/openaiCompatible.ts";
import type { CustomProviderDefinition, RuntimeFieldBasedAuthState } from "../../../src/providers/types.ts";

// Mock LangChain to avoid actual API calls
vi.mock("@langchain/openai", () => ({
	ChatOpenAI: vi.fn().mockImplementation((config) => ({
		config,
		invoke: vi.fn().mockResolvedValue({ content: "mocked response" }),
	})),
	OpenAIEmbeddings: vi.fn().mockImplementation((config) => ({
		config,
		embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
	})),
}));

describe("createCustomOpenAICompatibleProvider", () => {
	// Mock fetch for validation tests
	const mockFetch = vi.fn();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ data: [] }),
		});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	// =========================================================================
	// Factory Basics
	// =========================================================================

	describe("factory basics", () => {
		it("creates a custom provider with required fields", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "my-provider",
				displayName: "My Custom Provider",
			});

			expect(provider.id).toBe("my-provider");
			expect(provider.displayName).toBe("My Custom Provider");
			expect(provider.isBuiltIn).toBe(false);
			expect(provider.baseProviderId).toBe("openai");
		});

		it("sets createdAt timestamp", () => {
			const before = Date.now();
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});
			const after = Date.now();

			expect(provider.createdAt).toBeGreaterThanOrEqual(before);
			expect(provider.createdAt).toBeLessThanOrEqual(after);
		});

		it("allows custom createdAt timestamp", () => {
			const customTimestamp = 1700000000000;
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
				createdAt: customTimestamp,
			});

			expect(provider.createdAt).toBe(customTimestamp);
		});

		it("returns a CustomProviderDefinition type", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "typed-provider",
				displayName: "Typed Provider",
			});

			// TypeScript type check - isBuiltIn must be literal false
			const definition: CustomProviderDefinition = provider;
			expect(definition.isBuiltIn).toBe(false);
		});
	});

	// =========================================================================
	// ID Validation
	// =========================================================================

	describe("ID validation", () => {
		it("throws error for empty ID", () => {
			expect(() =>
				createCustomOpenAICompatibleProvider({
					id: "",
					displayName: "Test",
				}),
			).toThrow("Provider ID cannot be empty");
		});

		it("throws error for ID with spaces", () => {
			expect(() =>
				createCustomOpenAICompatibleProvider({
					id: "my provider",
					displayName: "Test",
				}),
			).toThrow("Provider ID cannot contain spaces");
		});

		it("throws error for uppercase ID", () => {
			expect(() =>
				createCustomOpenAICompatibleProvider({
					id: "MyProvider",
					displayName: "Test",
				}),
			).toThrow("Provider ID must be lowercase");
		});

		it("throws error for ID starting with dash", () => {
			expect(() =>
				createCustomOpenAICompatibleProvider({
					id: "-my-provider",
					displayName: "Test",
				}),
			).toThrow("Provider ID cannot start with a dash");
		});

		it("throws error for ID ending with dash", () => {
			expect(() =>
				createCustomOpenAICompatibleProvider({
					id: "my-provider-",
					displayName: "Test",
				}),
			).toThrow("Provider ID cannot end with a dash");
		});

		it("throws error for ID with consecutive dashes", () => {
			expect(() =>
				createCustomOpenAICompatibleProvider({
					id: "my--provider",
					displayName: "Test",
				}),
			).toThrow("Provider ID cannot contain consecutive dashes");
		});

		it("throws error for ID starting with number", () => {
			expect(() =>
				createCustomOpenAICompatibleProvider({
					id: "123-provider",
					displayName: "Test",
				}),
			).toThrow("Provider ID must start with a letter");
		});

		it("throws error for ID with underscores", () => {
			expect(() =>
				createCustomOpenAICompatibleProvider({
					id: "my_provider",
					displayName: "Test",
				}),
			).toThrow("Provider ID cannot contain underscores");
		});

		it("throws error for duplicate ID", () => {
			expect(() =>
				createCustomOpenAICompatibleProvider({
					id: "openai",
					displayName: "Test",
					existingIds: ["openai", "anthropic"],
				}),
			).toThrow('Provider ID "openai" already exists');
		});

		it("accepts valid lowercase ID with dashes", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "my-custom-provider",
				displayName: "Test",
			});
			expect(provider.id).toBe("my-custom-provider");
		});

		it("accepts valid ID with numbers", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "provider-v2",
				displayName: "Test",
			});
			expect(provider.id).toBe("provider-v2");
		});
	});

	// =========================================================================
	// Setup Instructions
	// =========================================================================

	describe("setup instructions", () => {
		it("uses default setup instructions when not provided", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			expect(provider.setupInstructions.steps).toContain("Enter your API key and endpoint URL");
			expect(provider.setupInstructions.steps.length).toBeGreaterThan(0);
		});

		it("allows custom setup instructions", () => {
			const customSteps = ["Step 1: Do this", "Step 2: Do that"];
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
				setupInstructions: {
					steps: customSteps,
					link: {
						url: "https://example.com",
						text: "Example",
					},
				},
			});

			expect(provider.setupInstructions.steps).toEqual(customSteps);
			expect(provider.setupInstructions.link?.url).toBe("https://example.com");
			expect(provider.setupInstructions.link?.text).toBe("Example");
		});
	});

	// =========================================================================
	// Auth Configuration
	// =========================================================================

	describe("auth configuration", () => {
		it("includes apiKey field by default", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			expect(provider.auth.type).toBe("field-based");
			if (provider.auth.type === "field-based") {
				expect(provider.auth.fields.apiKey).toBeDefined();
				expect(provider.auth.fields.apiKey.kind).toBe("secret");
				expect(provider.auth.fields.apiKey.required).toBe(true);
			}
		});

		it("includes baseUrl field by default", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			if (provider.auth.type === "field-based") {
				expect(provider.auth.fields.baseUrl).toBeDefined();
				expect(provider.auth.fields.baseUrl.kind).toBe("text");
				expect(provider.auth.fields.baseUrl.required).toBe(true);
			}
		});

		it("includes headers field by default", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			if (provider.auth.type === "field-based") {
				expect(provider.auth.fields.headers).toBeDefined();
				expect(provider.auth.fields.headers.kind).toBe("textarea");
				expect(provider.auth.fields.headers.required).toBe(false);
			}
		});

		it("makes apiKey optional when apiKeyRequired is false", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
				apiKeyRequired: false,
			});

			if (provider.auth.type === "field-based") {
				expect(provider.auth.fields.apiKey.required).toBe(false);
			}
		});
	});

	// =========================================================================
	// Capabilities
	// =========================================================================

	describe("capabilities", () => {
		it("has chat capability enabled by default", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			expect(provider.capabilities.chat).toBe(true);
		});

		it("has embedding capability enabled by default", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			expect(provider.capabilities.embedding).toBe(true);
		});

		it("has modelDiscovery enabled by default", () => {
			// Custom OpenAI-compatible providers support model discovery via the /models endpoint
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			expect(provider.capabilities.modelDiscovery).toBe(true);
		});

		it("allows custom capabilities", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
				capabilities: {
					chat: true,
					embedding: false,
					modelDiscovery: false,
				},
			});

			expect(provider.capabilities.chat).toBe(true);
			expect(provider.capabilities.embedding).toBe(false);
			expect(provider.capabilities.modelDiscovery).toBe(false);
		});
	});

	// =========================================================================
	// createRuntimeDefinition
	// =========================================================================

	describe("createRuntimeDefinition", () => {
		const mockAuth: RuntimeFieldBasedAuthState = {
			type: "field-based",
			values: {
				apiKey: "test-api-key",
				baseUrl: "https://api.example.com/v1",
			},
		};

		const mockModelIds = {
			chat: ["gpt-4o"],
			embedding: ["text-embedding-3-small"],
		};

		it("returns runtime definition structure (factories created at ProviderRegistry level)", async () => {
			// Note: Custom providers don't create model factories at the definition level.
			// The ProviderRegistry is responsible for creating factories using base runtime functions.
			// This method returns an empty structure that will be populated by the registry.
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			const runtime = await provider.createRuntimeDefinition(mockAuth, mockModelIds);

			expect(runtime).toBeDefined();
			expect(runtime.chatModels).toBeDefined();
			expect(runtime.embeddingModels).toBeDefined();
		});

		it("accepts any auth type (validation happens in validateAuth)", async () => {
			// Note: createRuntimeDefinition doesn't validate auth type.
			// Auth validation is handled by the validateAuth method.
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			const oauthAuth = {
				type: "oauth" as const,
				tokens: { accessToken: "test" },
			};

			// Should not throw - auth validation is separate
			const runtime = await provider.createRuntimeDefinition(oauthAuth, mockModelIds);
			expect(runtime).toBeDefined();
		});
	});

	// =========================================================================
	// validateAuth
	// =========================================================================

	describe("validateAuth", () => {
		it("returns valid for correct auth when API key is required", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: [] }),
			});

			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-api-key",
					baseUrl: "https://api.example.com/v1",
				},
			};

			const result = await provider.validateAuth(auth);
			expect(result.valid).toBe(true);
		});

		it("returns invalid when API key is missing and required", async () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "https://api.example.com/v1",
				},
			};

			const result = await provider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toContain("API key is required");
			}
		});

		it("returns valid when API key is missing but not required", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: [] }),
			});

			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
				apiKeyRequired: false,
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					baseUrl: "https://api.example.com/v1",
				},
			};

			const result = await provider.validateAuth(auth);
			expect(result.valid).toBe(true);
		});

		it("returns invalid for wrong auth type", async () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			const oauthAuth = {
				type: "oauth" as const,
				tokens: { accessToken: "test" },
			};

			const result = await provider.validateAuth(oauthAuth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toContain("field-based");
			}
		});

		it("returns invalid when baseUrl is missing", async () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-api-key",
				},
			};

			const result = await provider.validateAuth(auth);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toContain("Base URL is required");
			}
		});

		it("handles API validation failure", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
				text: () => Promise.resolve('{"error": {"code": "invalid_api_key", "message": "Invalid API key"}}'),
			});

			const provider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
			});

			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "invalid-key",
					baseUrl: "https://api.example.com/v1",
				},
			};

			const result = await provider.validateAuth(auth);
			expect(result.valid).toBe(false);
		});
	});

	// =========================================================================
	// Type Safety
	// =========================================================================

	describe("type safety", () => {
		it("returns CustomProviderDefinition with correct discriminator", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "type-test",
				displayName: "Type Test",
			});

			// Verify discriminator
			expect(provider.isBuiltIn).toBe(false);

			// Verify custom provider fields exist
			expect(provider.baseProviderId).toBe("openai");
			expect(typeof provider.createdAt).toBe("number");

			// Custom providers now have discoverModels (required by BaseProviderDefinition)
			expect("discoverModels" in provider).toBe(true);
			expect(typeof provider.discoverModels).toBe("function");
		});
	});
});
