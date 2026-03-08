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
	createOpenAICompatibleProvider,
	getBuiltInProvider,
	getProviderDefinition,
	isBuiltInProvider,
	ollamaProvider,
	openaiProvider,
} from "../../src/providers/index.ts";

describe("Provider Registry", () => {
	describe("BUILT_IN_PROVIDER_IDS", () => {
		it("should be a readonly array of provider IDs", () => {
			expect(Array.isArray(BUILT_IN_PROVIDER_IDS)).toBe(true);
			expect(BUILT_IN_PROVIDER_IDS.length).toBeGreaterThan(0);
		});

		it("should include openai, anthropic, ollama", () => {
			expect(BUILT_IN_PROVIDER_IDS).toContain("openai");
			expect(BUILT_IN_PROVIDER_IDS).toContain("anthropic");
			expect(BUILT_IN_PROVIDER_IDS).toContain("ollama");
		});
	});

	describe("getBuiltInProvider", () => {
		it("should return provider for 'openai' id", () => {
			const provider = getBuiltInProvider("openai");
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("openai");
			expect(provider?.displayName).toBe("OpenAI");
		});

		it("should return provider for 'anthropic' id", () => {
			const provider = getBuiltInProvider("anthropic");
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("anthropic");
			expect(provider?.displayName).toBe("Anthropic");
		});

		it("should return provider for 'ollama' id", () => {
			const provider = getBuiltInProvider("ollama");
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("ollama");
			expect(provider?.displayName).toBe("Ollama");
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

	describe("getProviderDefinition", () => {
		it("should return built-in provider when no custom providers exist", () => {
			const provider = getProviderDefinition("openai", {});
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("openai");
		});

		it("should return undefined for unknown provider ID", () => {
			const provider = getProviderDefinition("unknown", {});
			expect(provider).toBeUndefined();
		});

		it("should return custom provider when it exists", () => {
			const customMeta = { "my-custom": { displayName: "My Custom", supportsEmbeddings: false } };
			const provider = getProviderDefinition("my-custom", customMeta);
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("my-custom");
			expect(provider?.displayName).toBe("My Custom");
		});

		it("should prefer built-in provider if ID matches both", () => {
			const customMeta = { openai: { displayName: "Fake OpenAI", supportsEmbeddings: false } };
			const provider = getProviderDefinition("openai", customMeta);
			expect(provider?.displayName).toBe("OpenAI");
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
		});

		it("should export individual provider definitions", () => {
			expect(openaiProvider).toBeDefined();
			expect(openaiProvider.id).toBe("openai");
			expect(anthropicProvider).toBeDefined();
			expect(anthropicProvider.id).toBe("anthropic");
			expect(ollamaProvider).toBeDefined();
			expect(ollamaProvider.id).toBe("ollama");
		});

		it("getBuiltInProvider should return real provider implementations (not stubs)", () => {
			const openai = getBuiltInProvider("openai");
			expect(openai).toBeDefined();
			// Real OpenAI provider has detailed setup instructions
			expect(openai?.setupInstructions.steps.length).toBeGreaterThan(1);
			// Real OpenAI provider has apiKey and baseUrl auth fields
			expect(openai?.auth.apiKey).toBeDefined();
			expect(openai?.auth.baseUrl).toBeDefined();
		});

		it("builtInProviders record should match getBuiltInProvider results", () => {
			expect(builtInProviders.openai).toBe(getBuiltInProvider("openai"));
			expect(builtInProviders.anthropic).toBe(getBuiltInProvider("anthropic"));
			expect(builtInProviders.ollama).toBe(getBuiltInProvider("ollama"));
		});
	});

	describe("Re-exported custom provider factory", () => {
		it("should export createOpenAICompatibleProvider factory", () => {
			expect(createOpenAICompatibleProvider).toBeDefined();
			expect(typeof createOpenAICompatibleProvider).toBe("function");
		});
	});
});
