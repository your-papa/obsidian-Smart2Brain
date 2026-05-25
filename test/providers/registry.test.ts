/**
 * Tests for Provider Registry
 *
 * Tests the registry functions that manage provider lookup.
 */

import { describe, expect, it } from "vitest";
import {
	anthropicProvider,
	createOpenAICompatibleProvider,
	getProviderDefinition,
	ollamaProvider,
	openaiProvider,
} from "../../src/providers/index.ts";

describe("Provider Registry", () => {
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
			const customMeta = {
				"my-custom": { templateId: "openai-compatible" as const, displayName: "My Custom" },
			};
			const provider = getProviderDefinition("my-custom", customMeta);
			expect(provider).toBeDefined();
			expect(provider?.id).toBe("my-custom");
			expect(provider?.displayName).toBe("My Custom");
		});

		it("should prefer built-in provider if ID matches both", () => {
			const customMeta = {
				openai: { templateId: "openai-compatible" as const, displayName: "Fake OpenAI" },
			};
			const provider = getProviderDefinition("openai", customMeta);
			expect(provider?.displayName).toBe("OpenAI");
		});
	});

	describe("Built-in provider exports", () => {
		it("should export individual provider definitions", () => {
			expect(openaiProvider).toBeDefined();
			expect(openaiProvider.id).toBe("openai");
			expect(anthropicProvider).toBeDefined();
			expect(anthropicProvider.id).toBe("anthropic");
			expect(ollamaProvider).toBeDefined();
			expect(ollamaProvider.id).toBe("ollama");
		});

		it("getProviderDefinition should return real built-in provider implementations", () => {
			const openai = getProviderDefinition("openai", {});
			expect(openai).toBeDefined();
			expect(openai?.setupInstructions.steps.length).toBeGreaterThan(1);
			expect(openai?.auth.apiKey).toBeDefined();
			expect(openai?.auth.baseUrl).toBeDefined();
		});
	});

	describe("Re-exported custom provider factory", () => {
		it("should export createOpenAICompatibleProvider factory", () => {
			expect(createOpenAICompatibleProvider).toBeDefined();
			expect(typeof createOpenAICompatibleProvider).toBe("function");
		});
	});
});
