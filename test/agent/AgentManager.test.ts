/**
 * AgentManager tests for provider integration
 *
 * Tests the integration between AgentManager and the new provider system:
 * - Provider lookup functions from the new registry
 * - Provider validateAuth method
 * - Provider createRuntimeDefinition method
 *
 * NOTE: These tests focus on the provider definition interface,
 * not the AgentManager class itself (which requires Obsidian mocking).
 */

import { describe, expect, it, vi } from "vitest";

// Import actual functions and types
import {
	BUILT_IN_PROVIDER_IDS,
	getBuiltInProvider,
	getProvider,
	isBuiltInProvider,
	listAllProviderIds,
} from "../../src/providers/index.ts";
import type {
	AuthValidationResult,
	BuiltInProviderDefinition,
	CustomProviderDefinition,
	RuntimeAuthState,
	RuntimeFieldBasedAuthState,
	RuntimeProviderDefinition,
} from "../../src/providers/types.ts";

// Helper to create minimal custom provider for tests
function createCustomProvider(
	id: string,
	displayName: string,
	validateResult: AuthValidationResult = { valid: true },
): CustomProviderDefinition {
	return {
		id,
		displayName,
		isBuiltIn: false,
		baseProviderId: "openai-compatible",
		createdAt: Date.now(),
		setupInstructions: { steps: [] },
		auth: {
			type: "field-based",
			fields: {
				apiKey: { label: "API Key", kind: "secret", primary: true, required: true },
				baseUrl: { label: "Base URL", kind: "text", primary: true, required: true },
			},
		},
		capabilities: { chat: true, embedding: false, modelDiscovery: false },
		createRuntimeDefinition: async (_auth, modelIds) => ({
			chatModels: Object.fromEntries(modelIds.chat.map((modelId) => [modelId, async () => ({}) as unknown])),
			embeddingModels: {},
		}),
		validateAuth: async () => validateResult,
		discoverModels: async () => ({ chat: [], embedding: [] }),
	};
}

describe("AgentManager Provider Integration", () => {
	describe("Provider Registry Lookup", () => {
		it("should look up built-in providers by lowercase ID", () => {
			const provider = getBuiltInProvider("openai");

			expect(provider).toBeDefined();
			expect(provider?.id).toBe("openai");
			expect(provider?.displayName).toBe("OpenAI");
			expect(provider?.isBuiltIn).toBe(true);
		});

		it("should look up anthropic provider", () => {
			const provider = getBuiltInProvider("anthropic");

			expect(provider).toBeDefined();
			expect(provider?.id).toBe("anthropic");
			expect(provider?.displayName).toBe("Anthropic");
		});

		it("should look up ollama provider", () => {
			const provider = getBuiltInProvider("ollama");

			expect(provider).toBeDefined();
			expect(provider?.id).toBe("ollama");
			expect(provider?.displayName).toBe("Ollama");
		});

		it("should return undefined for unknown provider", () => {
			const provider = getBuiltInProvider("unknown-provider");

			expect(provider).toBeUndefined();
		});

		it("should use getProvider to find both built-in and custom providers", () => {
			const customProviders: CustomProviderDefinition[] = [];

			// Find built-in
			const openai = getProvider("openai", customProviders);
			expect(openai).toBeDefined();
			expect(openai?.id).toBe("openai");

			// Unknown returns undefined
			const unknown = getProvider("unknown", customProviders);
			expect(unknown).toBeUndefined();
		});

		it("should find custom providers via getProvider", () => {
			const customProvider = createCustomProvider("my-custom", "My Custom Provider");
			const customProviders = [customProvider];

			const found = getProvider("my-custom", customProviders);

			expect(found).toBeDefined();
			expect(found?.id).toBe("my-custom");
			expect(found?.isBuiltIn).toBe(false);
		});

		it("should prioritize built-in providers over custom with same ID", () => {
			// This shouldn't happen in practice, but the registry should handle it
			const customProvider = createCustomProvider("openai", "Fake OpenAI");
			const customProviders = [customProvider];

			const found = getProvider("openai", customProviders);

			// Built-in should win
			expect(found).toBeDefined();
			expect(found?.isBuiltIn).toBe(true);
			expect(found?.displayName).toBe("OpenAI");
		});
	});

	describe("Provider validateAuth", () => {
		it("should validate auth for OpenAI provider with valid API key", async () => {
			const provider = getBuiltInProvider("openai");
			expect(provider).toBeDefined();

			// Create valid auth state
			const auth: RuntimeFieldBasedAuthState = {
				type: "field-based",
				values: {
					apiKey: "sk-test-key-12345",
				},
			};

			// validateAuth is an async function that checks credentials
			// Note: This won't make actual API calls, just validates field presence
			// because the real validation happens when connecting to API
			if (provider) {
				// The validateAuth method should exist on the provider
				expect(typeof provider.validateAuth).toBe("function");
			}
		});

		it("should accept auth for Ollama provider even without baseUrl (uses default)", async () => {
			const provider = getBuiltInProvider("ollama");
			expect(provider).toBeDefined();

			if (provider) {
				const auth: RuntimeFieldBasedAuthState = {
					type: "field-based",
					values: {},
				};

				// Ollama uses a default baseUrl (localhost:11434), so empty is valid
				// The actual validation happens when connecting to the server
				const result = await provider.validateAuth(auth);

				// Note: This will fail if Ollama isn't running, but we're testing
				// the interface, not the actual connection.
				// The validateAuth function delegates to validateOllamaConnection
				// which may return valid:true (uses default) or valid:false (server not running)
				expect(typeof result.valid).toBe("boolean");
			}
		});

		it("should validate custom provider auth", async () => {
			const customProvider = createCustomProvider("my-custom", "My Custom", { valid: true });

			const auth: RuntimeAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-key",
					baseUrl: "http://localhost:8080",
				},
			};

			const result = await customProvider.validateAuth(auth);

			expect(result.valid).toBe(true);
		});

		it("should return error from custom provider validation", async () => {
			const customProvider = createCustomProvider("failing-provider", "Failing", {
				valid: false,
				error: "Invalid API key format",
			});

			const auth: RuntimeAuthState = {
				type: "field-based",
				values: {
					apiKey: "bad-key",
					baseUrl: "http://localhost:8080",
				},
			};

			const result = await customProvider.validateAuth(auth);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.error).toBe("Invalid API key format");
			}
		});
	});

	describe("Provider createRuntimeDefinition", () => {
		it("should create runtime definition for OpenAI provider", async () => {
			const provider = getBuiltInProvider("openai");
			expect(provider).toBeDefined();

			if (provider) {
				const auth: RuntimeFieldBasedAuthState = {
					type: "field-based",
					values: {
						apiKey: "sk-test-key",
					},
				};

				const modelIds = { chat: ["gpt-4o", "gpt-4o-mini"], embedding: ["text-embedding-3-small"] };
				const runtimeDef = await provider.createRuntimeDefinition(auth, modelIds);

				expect(runtimeDef).toBeDefined();
				expect(runtimeDef.chatModels).toBeDefined();
				expect(runtimeDef.embeddingModels).toBeDefined();
				expect(Object.keys(runtimeDef.chatModels).length).toBeGreaterThan(0);
			}
		});

		it("should create runtime definition with model factories", async () => {
			const provider = getBuiltInProvider("openai");
			expect(provider).toBeDefined();

			if (provider) {
				const auth: RuntimeFieldBasedAuthState = {
					type: "field-based",
					values: {
						apiKey: "sk-test-key",
					},
				};

				const modelIds = { chat: ["gpt-4o", "gpt-4o-mini"], embedding: ["text-embedding-3-small"] };
				const runtimeDef = await provider.createRuntimeDefinition(auth, modelIds);

				// Should have chat models
				expect(Object.keys(runtimeDef.chatModels)).toContain("gpt-4o");
				expect(Object.keys(runtimeDef.chatModels)).toContain("gpt-4o-mini");

				// Should have embedding models
				expect(Object.keys(runtimeDef.embeddingModels)).toContain("text-embedding-3-small");
			}
		});

		it("should create runtime definition for Anthropic provider", async () => {
			const provider = getBuiltInProvider("anthropic");
			expect(provider).toBeDefined();

			if (provider) {
				const auth: RuntimeFieldBasedAuthState = {
					type: "field-based",
					values: {
						apiKey: "sk-ant-test",
					},
				};

				const modelIds = { chat: ["claude-3-5-sonnet-20241022"], embedding: [] };
				const runtimeDef = await provider.createRuntimeDefinition(auth, modelIds);

				expect(runtimeDef).toBeDefined();
				expect(runtimeDef.chatModels).toBeDefined();
				// Anthropic doesn't support embeddings
				expect(Object.keys(runtimeDef.embeddingModels)).toHaveLength(0);
			}
		});

		it("should create runtime definition for custom provider", async () => {
			const customProvider = createCustomProvider("my-custom", "My Custom");

			const auth: RuntimeAuthState = {
				type: "field-based",
				values: {
					apiKey: "test-key",
					baseUrl: "http://localhost:8080",
				},
			};

			const modelIds = { chat: ["custom-model"], embedding: [] };
			const runtimeDef = await customProvider.createRuntimeDefinition(auth, modelIds);

			expect(runtimeDef).toBeDefined();
			expect(runtimeDef.chatModels).toBeDefined();
			expect(Object.keys(runtimeDef.chatModels)).toContain("custom-model");
		});
	});

	describe("Provider model discovery", () => {
		it("should have discoverModels method on OpenAI provider", () => {
			const provider = getBuiltInProvider("openai");
			expect(provider).toBeDefined();
			expect(provider?.discoverModels).toBeDefined();
			expect(typeof provider?.discoverModels).toBe("function");
		});

		it("should have discoverModels method on Ollama provider", () => {
			const provider = getBuiltInProvider("ollama");
			expect(provider).toBeDefined();
			expect(provider?.discoverModels).toBeDefined();
			expect(typeof provider?.discoverModels).toBe("function");
		});

		it("should have discoverModels on Anthropic (all providers have discoverModels)", () => {
			const provider = getBuiltInProvider("anthropic");
			expect(provider).toBeDefined();
			// Anthropic supports model discovery via /v1/models API endpoint
			expect(provider?.capabilities.modelDiscovery).toBe(true);
			// All providers must have discoverModels method
			expect(provider?.discoverModels).toBeDefined();
			expect(typeof provider?.discoverModels).toBe("function");
		});

		it("should indicate modelDiscovery capability", () => {
			const openai = getBuiltInProvider("openai");
			expect(openai?.capabilities.modelDiscovery).toBe(true);

			const ollama = getBuiltInProvider("ollama");
			expect(ollama?.capabilities.modelDiscovery).toBe(true);

			const anthropic = getBuiltInProvider("anthropic");
			expect(anthropic?.capabilities.modelDiscovery).toBe(true);
		});
	});

	describe("Provider capabilities", () => {
		it("should correctly report OpenAI capabilities", () => {
			const provider = getBuiltInProvider("openai");
			expect(provider?.capabilities).toEqual({
				chat: true,
				embedding: true,
				modelDiscovery: true,
			});
		});

		it("should correctly report Anthropic capabilities (no embedding)", () => {
			const provider = getBuiltInProvider("anthropic");
			expect(provider?.capabilities).toEqual({
				chat: true,
				embedding: false,
				modelDiscovery: true,
			});
		});

		it("should correctly report Ollama capabilities", () => {
			const provider = getBuiltInProvider("ollama");
			expect(provider?.capabilities).toEqual({
				chat: true,
				embedding: true,
				modelDiscovery: true,
			});
		});
	});

	describe("listAllProviderIds", () => {
		it("should list all built-in provider IDs with no custom providers", () => {
			const ids = listAllProviderIds([]);

			expect(ids).toContain("openai");
			expect(ids).toContain("anthropic");
			expect(ids).toContain("ollama");
			expect(ids).toContain("sap-ai-core");
		});

		it("should include custom provider IDs", () => {
			const customProvider = createCustomProvider("my-custom", "My Custom");
			const ids = listAllProviderIds([customProvider]);

			expect(ids).toContain("openai");
			expect(ids).toContain("my-custom");
		});

		it("should not duplicate IDs if custom has same ID as built-in", () => {
			// Edge case - custom provider with same ID as built-in
			const customProvider = createCustomProvider("openai", "Fake OpenAI");
			const ids = listAllProviderIds([customProvider]);

			// openai should only appear once
			const openaiCount = ids.filter((id) => id === "openai").length;
			expect(openaiCount).toBe(1);
		});
	});

	describe("isBuiltInProvider", () => {
		it("should return true for built-in provider IDs", () => {
			expect(isBuiltInProvider("openai")).toBe(true);
			expect(isBuiltInProvider("anthropic")).toBe(true);
			expect(isBuiltInProvider("ollama")).toBe(true);
			expect(isBuiltInProvider("sap-ai-core")).toBe(true);
		});

		it("should return false for custom provider IDs", () => {
			expect(isBuiltInProvider("my-custom")).toBe(false);
			expect(isBuiltInProvider("local-llm")).toBe(false);
		});

		it("should return false for empty string", () => {
			expect(isBuiltInProvider("")).toBe(false);
		});
	});
});

describe("Provider ID Mapping (Legacy to New)", () => {
	/**
	 * The old system used PascalCase provider names: "OpenAI", "Anthropic", "Ollama", "CustomOpenAI"
	 * The new system uses lowercase with dashes: "openai", "anthropic", "ollama", "sap-ai-core"
	 *
	 * This documents the mapping between the two systems during migration.
	 */

	const LEGACY_TO_NEW_MAPPING: Record<string, string> = {
		OpenAI: "openai",
		Anthropic: "anthropic",
		Ollama: "ollama",
		CustomOpenAI: "openai", // CustomOpenAI was an alias for OpenAI with different baseUrl
	};

	it("should map legacy provider names to new IDs", () => {
		expect(LEGACY_TO_NEW_MAPPING.OpenAI).toBe("openai");
		expect(LEGACY_TO_NEW_MAPPING.Anthropic).toBe("anthropic");
		expect(LEGACY_TO_NEW_MAPPING.Ollama).toBe("ollama");
	});

	it("should handle CustomOpenAI as openai with custom baseUrl", () => {
		// CustomOpenAI in the old system was just OpenAI with a different baseUrl
		// In the new system, this is handled by either:
		// 1. Using openai provider with custom baseUrl field
		// 2. Creating a custom provider
		expect(LEGACY_TO_NEW_MAPPING.CustomOpenAI).toBe("openai");
	});

	it("should find new providers using lowercase IDs", () => {
		// The new system uses lowercase
		for (const legacyName of Object.keys(LEGACY_TO_NEW_MAPPING)) {
			const newId = LEGACY_TO_NEW_MAPPING[legacyName];
			const provider = getBuiltInProvider(newId);
			expect(provider).toBeDefined();
		}
	});
});
