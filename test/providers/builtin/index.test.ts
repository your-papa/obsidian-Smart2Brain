/**
 * Tests for built-in providers barrel export
 *
 * Tests verify:
 * - All built-in providers are exported individually
 * - builtInProviders record contains all providers mapped by id
 * - Type safety of exports
 */

import { describe, expect, it } from "vitest";
import {
	anthropicProvider,
	builtInProviders,
	ollamaProvider,
	openaiProvider,
} from "../../../src/providers/builtin/index.ts";
import type { BuiltInProviderDefinition } from "../../../src/providers/types.ts";

describe("builtin/index barrel export", () => {
	describe("individual provider exports", () => {
		it("exports openaiProvider", () => {
			expect(openaiProvider).toBeDefined();
			expect(openaiProvider.id).toBe("openai");
			expect(openaiProvider.isBuiltIn).toBe(true);
		});

		it("exports anthropicProvider", () => {
			expect(anthropicProvider).toBeDefined();
			expect(anthropicProvider.id).toBe("anthropic");
			expect(anthropicProvider.isBuiltIn).toBe(true);
		});

		it("exports ollamaProvider", () => {
			expect(ollamaProvider).toBeDefined();
			expect(ollamaProvider.id).toBe("ollama");
			expect(ollamaProvider.isBuiltIn).toBe(true);
		});
	});

	describe("builtInProviders record", () => {
		it("is a Record<string, BuiltInProviderDefinition>", () => {
			expect(typeof builtInProviders).toBe("object");
			expect(builtInProviders).not.toBeNull();
		});

		it("contains all built-in providers", () => {
			expect(Object.keys(builtInProviders)).toHaveLength(3);
			expect(Object.keys(builtInProviders).sort()).toEqual(["anthropic", "ollama", "openai"]);
		});

		it("maps provider ids to provider definitions", () => {
			expect(builtInProviders.openai).toBe(openaiProvider);
			expect(builtInProviders.anthropic).toBe(anthropicProvider);
			expect(builtInProviders.ollama).toBe(ollamaProvider);
		});

		it("each provider id matches the key", () => {
			for (const [key, provider] of Object.entries(builtInProviders)) {
				expect(provider.id).toBe(key);
			}
		});

		it("all providers have isBuiltIn set to true", () => {
			for (const provider of Object.values(builtInProviders)) {
				expect(provider.isBuiltIn).toBe(true);
			}
		});

		it("all providers implement BuiltInProviderDefinition interface", () => {
			for (const provider of Object.values(builtInProviders)) {
				// Required properties from BaseProviderDefinition
				expect(typeof provider.id).toBe("string");
				expect(typeof provider.displayName).toBe("string");
				expect(typeof provider.auth).toBe("object");
				expect(typeof provider.capabilities).toBe("object");
				expect(typeof provider.createRuntimeDefinition).toBe("function");
				expect(typeof provider.validateAuth).toBe("function");

				// isBuiltIn must be true for BuiltInProviderDefinition
				expect(provider.isBuiltIn).toBe(true);

				// setupInstructions must be present for built-in providers
				expect(provider.setupInstructions).toBeDefined();
				expect(Array.isArray(provider.setupInstructions?.steps)).toBe(true);

				// Type assertion to verify it's a valid BuiltInProviderDefinition
				const _typeCheck: BuiltInProviderDefinition = provider;
				expect(_typeCheck).toBe(provider);
			}
		});
	});

	describe("provider capabilities", () => {
		it("openai supports chat, embedding, and modelDiscovery", () => {
			expect(builtInProviders.openai.capabilities.chat).toBe(true);
			expect(builtInProviders.openai.capabilities.embedding).toBe(true);
			expect(builtInProviders.openai.capabilities.modelDiscovery).toBe(true);
		});

		it("anthropic supports chat and modelDiscovery (no embedding)", () => {
			expect(builtInProviders.anthropic.capabilities.chat).toBe(true);
			expect(builtInProviders.anthropic.capabilities.embedding).toBe(false);
			expect(builtInProviders.anthropic.capabilities.modelDiscovery).toBe(true);
		});

		it("ollama supports chat, embedding, and modelDiscovery", () => {
			expect(builtInProviders.ollama.capabilities.chat).toBe(true);
			expect(builtInProviders.ollama.capabilities.embedding).toBe(true);
			expect(builtInProviders.ollama.capabilities.modelDiscovery).toBe(true);
		});
	});

	describe("provider lookup by id", () => {
		it("can look up openai provider by id", () => {
			const provider = builtInProviders.openai;
			expect(provider.displayName).toBe("OpenAI");
		});

		it("can look up anthropic provider by id", () => {
			const provider = builtInProviders.anthropic;
			expect(provider.displayName).toBe("Anthropic");
		});

		it("can look up ollama provider by id", () => {
			const provider = builtInProviders.ollama;
			expect(provider.displayName).toBe("Ollama");
		});

		it("returns undefined for non-existent provider id", () => {
			// Use type assertion to test runtime behavior with invalid key
			const provider = (builtInProviders as Record<string, unknown>)["non-existent"];
			expect(provider).toBeUndefined();
		});
	});
});
