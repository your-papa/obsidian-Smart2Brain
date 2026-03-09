/**
 * AgentManager tests for provider integration
 *
 * Tests the integration between AgentManager and the new provider system:
 * - Provider lookup functions from the new registry
 * - Provider validateAuth method
 * - Provider discoverModels method
 *
 * NOTE: These tests focus on the provider definition interface,
 * not the AgentManager class itself (which requires Obsidian mocking).
 */

import { describe, expect, it, vi } from "vitest";

// Import actual functions and types
import {
	BUILT_IN_PROVIDER_IDS,
	getBuiltInProvider,
	getProviderDefinition,
	isBuiltInProvider,
} from "../../src/providers/index.ts";
import type { AuthValidationResult } from "../../src/types/provider/index.ts";

describe("AgentManager Provider Integration", () => {
	describe("Provider Registry Lookup", () => {
		it("should look up built-in providers by lowercase ID", () => {
			const provider = getBuiltInProvider("openai");

			expect(provider).toBeDefined();
			expect(provider?.id).toBe("openai");
			expect(provider?.displayName).toBe("OpenAI");
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

		it("should use getProviderDefinition to find both built-in and custom providers", () => {
			// Find built-in
			const openai = getProviderDefinition("openai", {});
			expect(openai).toBeDefined();
			expect(openai?.id).toBe("openai");

			// Unknown returns undefined
			const unknown = getProviderDefinition("unknown", {});
			expect(unknown).toBeUndefined();
		});

		it("should find custom providers via getProviderDefinition", () => {
			const customMeta = { "my-custom": { displayName: "My Custom Provider", supportsEmbeddings: false } };

			const found = getProviderDefinition("my-custom", customMeta);

			expect(found).toBeDefined();
			expect(found?.id).toBe("my-custom");
		});

		it("should prioritize built-in providers over custom with same ID", () => {
			const customMeta = { openai: { displayName: "Fake OpenAI", supportsEmbeddings: false } };

			const found = getProviderDefinition("openai", customMeta);

			// Built-in should win
			expect(found).toBeDefined();
			expect(found?.displayName).toBe("OpenAI");
		});
	});

	describe("Provider validateAuth", () => {
		it("should have validateAuth method on OpenAI provider", () => {
			const provider = getBuiltInProvider("openai");
			expect(provider).toBeDefined();

			if (provider) {
				expect(typeof provider.validateAuth).toBe("function");
			}
		});

		it("should have validateAuth method on Ollama provider", () => {
			const provider = getBuiltInProvider("ollama");
			expect(provider).toBeDefined();

			if (provider) {
				expect(typeof provider.validateAuth).toBe("function");
			}
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

		it("should have discoverModels on Anthropic provider", () => {
			const provider = getBuiltInProvider("anthropic");
			expect(provider).toBeDefined();
			expect(provider?.discoverModels).toBeDefined();
			expect(typeof provider?.discoverModels).toBe("function");
		});
	});

	describe("Provider createChatInstance", () => {
		it("should have createChatInstance method on all built-in providers", () => {
			for (const id of BUILT_IN_PROVIDER_IDS) {
				const provider = getBuiltInProvider(id);
				expect(provider).toBeDefined();
				expect(typeof provider?.createChatInstance).toBe("function");
			}
		});
	});

	describe("isBuiltInProvider", () => {
		it("should return true for built-in provider IDs", () => {
			expect(isBuiltInProvider("openai")).toBe(true);
			expect(isBuiltInProvider("anthropic")).toBe(true);
			expect(isBuiltInProvider("ollama")).toBe(true);
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
	 * The new system uses lowercase with dashes: "openai", "anthropic", "ollama"
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
		expect(LEGACY_TO_NEW_MAPPING.CustomOpenAI).toBe("openai");
	});

	it("should find new providers using lowercase IDs", () => {
		for (const legacyName of Object.keys(LEGACY_TO_NEW_MAPPING)) {
			const newId = LEGACY_TO_NEW_MAPPING[legacyName];
			const provider = getBuiltInProvider(newId);
			expect(provider).toBeDefined();
		}
	});
});
