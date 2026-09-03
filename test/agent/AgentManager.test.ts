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
import { getProviderDefinition } from "../../src/providers/index.ts";
import type { AuthValidationResult } from "../../src/types/provider/index.ts";

describe("AgentManager Provider Integration", () => {
	describe("Provider Registry Lookup", () => {
		it("should look up built-in providers by lowercase ID", () => {
			const provider = getProviderDefinition("openai", {});

			expect(provider).toBeDefined();
			expect(provider?.id).toBe("openai");
			expect(provider?.displayName).toBe("OpenAI");
		});

		it("should look up anthropic provider", () => {
			const provider = getProviderDefinition("anthropic", {});

			expect(provider).toBeDefined();
			expect(provider?.id).toBe("anthropic");
			expect(provider?.displayName).toBe("Anthropic");
		});

		it("should look up ollama provider", () => {
			const provider = getProviderDefinition("ollama", {});

			expect(provider).toBeDefined();
			expect(provider?.id).toBe("ollama");
			expect(provider?.displayName).toBe("Ollama");
		});

		it("should return undefined for unknown provider", () => {
			const provider = getProviderDefinition("unknown-provider", {});

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
			const customMeta = {
				"my-custom": { templateId: "openai-compatible" as const, displayName: "My Custom Provider" },
			};

			const found = getProviderDefinition("my-custom", customMeta);

			expect(found).toBeDefined();
			expect(found?.id).toBe("my-custom");
		});

		it("should prioritize built-in providers over custom with same ID", () => {
			const customMeta = {
				openai: { templateId: "openai-compatible" as const, displayName: "Fake OpenAI" },
			};

			const found = getProviderDefinition("openai", customMeta);

			// Built-in should win
			expect(found).toBeDefined();
			expect(found?.displayName).toBe("OpenAI");
		});
	});

	describe("Provider validateAuth", () => {
		it("should have validateAuth method on OpenAI provider", () => {
			const provider = getProviderDefinition("openai", {});
			expect(provider).toBeDefined();

			if (provider) {
				expect(typeof provider.validateAuth).toBe("function");
			}
		});

		it("should have validateAuth method on Ollama provider", () => {
			const provider = getProviderDefinition("ollama", {});
			expect(provider).toBeDefined();

			if (provider) {
				expect(typeof provider.validateAuth).toBe("function");
			}
		});
	});

	describe("Provider model discovery", () => {
		it("should have discoverModels method on OpenAI provider", () => {
			const provider = getProviderDefinition("openai", {});
			expect(provider).toBeDefined();
			expect(provider?.discoverModels).toBeDefined();
			expect(typeof provider?.discoverModels).toBe("function");
		});

		it("should have discoverModels method on Ollama provider", () => {
			const provider = getProviderDefinition("ollama", {});
			expect(provider).toBeDefined();
			expect(provider?.discoverModels).toBeDefined();
			expect(typeof provider?.discoverModels).toBe("function");
		});

		it("should have discoverModels on Anthropic provider", () => {
			const provider = getProviderDefinition("anthropic", {});
			expect(provider).toBeDefined();
			expect(provider?.discoverModels).toBeDefined();
			expect(typeof provider?.discoverModels).toBe("function");
		});
	});

	describe("Provider createChatInstance", () => {
		it("should have createChatInstance method on all built-in providers", () => {
			for (const id of ["openai", "anthropic", "ollama"] as const) {
				const provider = getProviderDefinition(id, {});
				expect(provider).toBeDefined();
				expect(typeof provider?.createChatInstance).toBe("function");
			}
		});
	});
});
