/**
 * Tests for Provider Registry
 *
 * Tests the registry functions that manage provider lookup and listing:
 * - getBuiltInProvider: Get a built-in provider by ID
 * - isBuiltInProvider: Check if an ID is a built-in provider
 * - getProvider: Get any provider (built-in or custom)
 * - listAllProviderIds: List all provider IDs
 */

import { describe, expect, it } from "vitest";
import {
	BUILT_IN_PROVIDER_IDS,
	anthropicProvider,
	builtInProviders,
	createCustomOpenAICompatibleProvider,
	getBuiltInProvider,
	getProvider,
	isBuiltInProvider,
	listAllProviderIds,
	ollamaProvider,
	openaiProvider,
	sapAiCoreProvider,
} from "../../src/providers/index.ts";
import type { CustomProviderDefinition } from "../../src/providers/types.ts";

// Helper to create minimal custom provider for tests
function createCustomProvider(id: string, displayName: string): CustomProviderDefinition {
	return {
		id,
		displayName,
		isBuiltIn: false,
		baseProviderId: "openai-compatible",
		createdAt: Date.now(),
		setupInstructions: { steps: [] },
		auth: { type: "field-based", fields: {} },
		capabilities: { chat: true, embedding: false, modelDiscovery: false },
		createRuntimeDefinition: async (_auth, modelIds) => ({
			chatModels: Object.fromEntries(modelIds.chat.map((modelId) => [modelId, async () => ({}) as unknown])),
			embeddingModels: {},
		}),
		validateAuth: async () => ({ valid: true }),
		discoverModels: async () => ({ chat: [], embedding: [] }),
	};
}

describe("Provider Registry", () => {
	describe("BUILT_IN_PROVIDER_IDS", () => {
		it("should be a readonly array of provider IDs", () => {
			expect(Array.isArray(BUILT_IN_PROVIDER_IDS)).toBe(true);
			expect(BUILT_IN_PROVIDER_IDS.length).toBeGreaterThan(0);
		});

		it("should include openai, anthropic, ollama, sap-ai-core", () => {
			expect(BUILT_IN_PROVIDER_IDS).toContain("openai");
			expect(BUILT_IN_PROVIDER_IDS).toContain("anthropic");
			expect(BUILT_IN_PROVIDER_IDS).toContain("ollama");
			expect(BUILT_IN_PROVIDER_IDS).toContain("sap-ai-core");
		});
	});

	describe("getBuiltInProvider", () => {
		it("should return provider for 'openai' id", () => {
			const provider = getBuiltInProvider("openai");
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("openai");
			expect(provider?.displayName).toBe("OpenAI");
			expect(provider?.isBuiltIn).toBe(true);
		});

		it("should return provider for 'anthropic' id", () => {
			const provider = getBuiltInProvider("anthropic");
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("anthropic");
			expect(provider?.displayName).toBe("Anthropic");
			expect(provider?.isBuiltIn).toBe(true);
		});

		it("should return provider for 'ollama' id", () => {
			const provider = getBuiltInProvider("ollama");
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("ollama");
			expect(provider?.displayName).toBe("Ollama");
			expect(provider?.isBuiltIn).toBe(true);
		});

		it("should return provider for 'sap-ai-core' id", () => {
			const provider = getBuiltInProvider("sap-ai-core");
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("sap-ai-core");
			expect(provider?.displayName).toBe("SAP AI Core");
			expect(provider?.isBuiltIn).toBe(true);
		});

		it("should return undefined for unknown provider ID", () => {
			const provider = getBuiltInProvider("unknown-provider");
			expect(provider).toBeUndefined();
		});

		it("should return undefined for empty string", () => {
			const provider = getBuiltInProvider("");
			expect(provider).toBeUndefined();
		});

		it("should return undefined for custom provider ID", () => {
			const provider = getBuiltInProvider("my-custom-provider");
			expect(provider).toBeUndefined();
		});
	});

	describe("isBuiltInProvider", () => {
		it("should return true for 'openai'", () => {
			expect(isBuiltInProvider("openai")).toBe(true);
		});

		it("should return true for 'anthropic'", () => {
			expect(isBuiltInProvider("anthropic")).toBe(true);
		});

		it("should return true for 'ollama'", () => {
			expect(isBuiltInProvider("ollama")).toBe(true);
		});

		it("should return true for 'sap-ai-core'", () => {
			expect(isBuiltInProvider("sap-ai-core")).toBe(true);
		});

		it("should return false for unknown provider ID", () => {
			expect(isBuiltInProvider("unknown")).toBe(false);
		});

		it("should return false for custom provider ID", () => {
			expect(isBuiltInProvider("my-custom-provider")).toBe(false);
		});

		it("should return false for empty string", () => {
			expect(isBuiltInProvider("")).toBe(false);
		});

		it("should be case-sensitive (return false for 'OpenAI')", () => {
			expect(isBuiltInProvider("OpenAI")).toBe(false);
			expect(isBuiltInProvider("OPENAI")).toBe(false);
		});
	});

	describe("getProvider", () => {
		it("should return built-in provider when no custom providers exist", () => {
			const provider = getProvider("openai", []);
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("openai");
			expect(provider?.isBuiltIn).toBe(true);
		});

		it("should return built-in provider when custom providers exist but ID is built-in", () => {
			const customProviders = [createCustomProvider("my-custom", "My Custom")];
			const provider = getProvider("openai", customProviders);
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("openai");
			expect(provider?.isBuiltIn).toBe(true);
		});

		it("should return custom provider when it exists", () => {
			const customProviders = [createCustomProvider("my-custom", "My Custom Provider")];
			const provider = getProvider("my-custom", customProviders);
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("my-custom");
			expect(provider?.displayName).toBe("My Custom Provider");
			expect(provider?.isBuiltIn).toBe(false);
		});

		it("should return correct custom provider from multiple custom providers", () => {
			const customProviders = [
				createCustomProvider("custom-1", "Custom One"),
				createCustomProvider("custom-2", "Custom Two"),
				createCustomProvider("custom-3", "Custom Three"),
			];
			const provider = getProvider("custom-2", customProviders);
			expect(provider?.id).toBe("custom-2");
			expect(provider?.displayName).toBe("Custom Two");
		});

		it("should return undefined for unknown provider ID", () => {
			const provider = getProvider("unknown", []);
			expect(provider).toBeUndefined();
		});

		it("should return undefined for unknown ID even with custom providers", () => {
			const customProviders = [createCustomProvider("my-custom", "My Custom")];
			const provider = getProvider("unknown", customProviders);
			expect(provider).toBeUndefined();
		});

		it("should prefer built-in provider if ID matches both (shouldn't happen in practice)", () => {
			// This tests the case where someone creates a custom provider with a built-in ID
			// The function should still return the built-in provider
			const customProviders = [createCustomProvider("openai", "Fake OpenAI")];
			const provider = getProvider("openai", customProviders);
			expect(provider?.isBuiltIn).toBe(true);
			expect(provider?.displayName).toBe("OpenAI"); // Should be built-in, not custom
		});
	});

	describe("listAllProviderIds", () => {
		it("should include all built-in provider IDs when no custom providers", () => {
			const ids = listAllProviderIds([]);
			expect(ids).toContain("openai");
			expect(ids).toContain("anthropic");
			expect(ids).toContain("ollama");
			expect(ids).toContain("sap-ai-core");
		});

		it("should include custom provider IDs", () => {
			const customProviders = [
				createCustomProvider("custom-1", "Custom One"),
				createCustomProvider("custom-2", "Custom Two"),
			];
			const ids = listAllProviderIds(customProviders);
			expect(ids).toContain("custom-1");
			expect(ids).toContain("custom-2");
		});

		it("should include both built-in and custom provider IDs", () => {
			const customProviders = [createCustomProvider("my-custom", "My Custom")];
			const ids = listAllProviderIds(customProviders);

			// Built-in providers
			expect(ids).toContain("openai");
			expect(ids).toContain("anthropic");
			expect(ids).toContain("ollama");
			expect(ids).toContain("sap-ai-core");

			// Custom provider
			expect(ids).toContain("my-custom");
		});

		it("should return unique IDs (no duplicates)", () => {
			const customProviders = [createCustomProvider("custom-1", "Custom One")];
			const ids = listAllProviderIds(customProviders);
			const uniqueIds = [...new Set(ids)];
			expect(ids.length).toBe(uniqueIds.length);
		});

		it("should handle empty custom providers array", () => {
			const ids = listAllProviderIds([]);
			expect(ids.length).toBe(BUILT_IN_PROVIDER_IDS.length);
		});

		it("should not include duplicate if custom provider has same ID as built-in (edge case)", () => {
			// Edge case: custom provider with same ID as built-in shouldn't duplicate
			const customProviders = [createCustomProvider("openai", "Fake OpenAI")];
			const ids = listAllProviderIds(customProviders);
			const openaiCount = ids.filter((id) => id === "openai").length;
			expect(openaiCount).toBe(1); // Should only appear once
		});
	});

	describe("Re-exported built-in providers", () => {
		it("should export builtInProviders record", () => {
			expect(builtInProviders).toBeDefined();
			expect(typeof builtInProviders).toBe("object");
		});

		it("builtInProviders should contain all built-in provider IDs", () => {
			expect(builtInProviders.openai).toBeDefined();
			expect(builtInProviders.anthropic).toBeDefined();
			expect(builtInProviders.ollama).toBeDefined();
			expect(builtInProviders["sap-ai-core"]).toBeDefined();
		});

		it("should export individual provider definitions", () => {
			expect(openaiProvider).toBeDefined();
			expect(openaiProvider.id).toBe("openai");
			expect(anthropicProvider).toBeDefined();
			expect(anthropicProvider.id).toBe("anthropic");
			expect(ollamaProvider).toBeDefined();
			expect(ollamaProvider.id).toBe("ollama");
			expect(sapAiCoreProvider).toBeDefined();
			expect(sapAiCoreProvider.id).toBe("sap-ai-core");
		});

		it("getBuiltInProvider should return real provider implementations (not stubs)", () => {
			const openai = getBuiltInProvider("openai");
			expect(openai).toBeDefined();
			// Real OpenAI provider has detailed setup instructions
			expect(openai?.setupInstructions.steps.length).toBeGreaterThan(1);
			// Real OpenAI provider has apiKey and baseUrl auth fields
			expect(openai?.auth.type).toBe("field-based");
			if (openai?.auth.type === "field-based") {
				expect(openai.auth.fields.apiKey).toBeDefined();
				expect(openai.auth.fields.baseUrl).toBeDefined();
			}
		});

		it("builtInProviders record should match getBuiltInProvider results", () => {
			expect(builtInProviders.openai).toBe(getBuiltInProvider("openai"));
			expect(builtInProviders.anthropic).toBe(getBuiltInProvider("anthropic"));
			expect(builtInProviders.ollama).toBe(getBuiltInProvider("ollama"));
			expect(builtInProviders["sap-ai-core"]).toBe(getBuiltInProvider("sap-ai-core"));
		});
	});

	describe("Re-exported custom provider factory", () => {
		it("should export createCustomOpenAICompatibleProvider factory", () => {
			expect(createCustomOpenAICompatibleProvider).toBeDefined();
			expect(typeof createCustomOpenAICompatibleProvider).toBe("function");
		});

		it("createCustomOpenAICompatibleProvider should create valid custom provider", () => {
			const customProvider = createCustomOpenAICompatibleProvider({
				id: "test-provider",
				displayName: "Test Provider",
				defaultBaseUrl: "https://api.test.com/v1",
			});

			expect(customProvider.id).toBe("test-provider");
			expect(customProvider.displayName).toBe("Test Provider");
			expect(customProvider.isBuiltIn).toBe(false);
			expect(customProvider.baseProviderId).toBe("openai");
		});
	});
});
