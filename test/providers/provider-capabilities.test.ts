/**
 * Tests for ProviderCapabilities and ProviderSetupInstructions types.
 *
 * ProviderCapabilities defines what features a provider supports (chat, embedding, modelDiscovery).
 * ProviderSetupInstructions defines setup instructions shown to users when configuring a provider.
 */
import { describe, expect, it } from "vitest";
import type { ProviderCapabilities, ProviderSetupInstructions } from "../../src/providers/types.ts";

describe("ProviderCapabilities", () => {
	it("should require chat, embedding, and modelDiscovery boolean properties", () => {
		const capabilities: ProviderCapabilities = {
			chat: true,
			embedding: true,
			modelDiscovery: true,
		};

		expect(capabilities.chat).toBe(true);
		expect(capabilities.embedding).toBe(true);
		expect(capabilities.modelDiscovery).toBe(true);
	});

	it("should allow all capabilities to be false", () => {
		const capabilities: ProviderCapabilities = {
			chat: false,
			embedding: false,
			modelDiscovery: false,
		};

		expect(capabilities.chat).toBe(false);
		expect(capabilities.embedding).toBe(false);
		expect(capabilities.modelDiscovery).toBe(false);
	});

	it("should support OpenAI-style providers (full capabilities)", () => {
		// OpenAI supports chat, embedding, and model discovery
		const openaiCapabilities: ProviderCapabilities = {
			chat: true,
			embedding: true,
			modelDiscovery: true,
		};

		expect(openaiCapabilities.chat).toBe(true);
		expect(openaiCapabilities.embedding).toBe(true);
		expect(openaiCapabilities.modelDiscovery).toBe(true);
	});

	it("should support Anthropic-style providers (chat only, no embedding)", () => {
		// Anthropic only supports chat models, no embeddings
		const anthropicCapabilities: ProviderCapabilities = {
			chat: true,
			embedding: false,
			modelDiscovery: false,
		};

		expect(anthropicCapabilities.chat).toBe(true);
		expect(anthropicCapabilities.embedding).toBe(false);
		expect(anthropicCapabilities.modelDiscovery).toBe(false);
	});

	it("should support Ollama-style providers (chat and embedding, with discovery)", () => {
		// Ollama supports chat, embedding, and model discovery
		const ollamaCapabilities: ProviderCapabilities = {
			chat: true,
			embedding: true,
			modelDiscovery: true,
		};

		expect(ollamaCapabilities.chat).toBe(true);
		expect(ollamaCapabilities.embedding).toBe(true);
		expect(ollamaCapabilities.modelDiscovery).toBe(true);
	});

	it("should be used to determine available provider features", () => {
		// Helper function to check if a feature is available
		const canUseFeature = (caps: ProviderCapabilities, feature: keyof ProviderCapabilities): boolean => {
			return caps[feature];
		};

		const capabilities: ProviderCapabilities = {
			chat: true,
			embedding: false,
			modelDiscovery: true,
		};

		expect(canUseFeature(capabilities, "chat")).toBe(true);
		expect(canUseFeature(capabilities, "embedding")).toBe(false);
		expect(canUseFeature(capabilities, "modelDiscovery")).toBe(true);
	});

	it("should have exactly three properties (no extra properties)", () => {
		const capabilities: ProviderCapabilities = {
			chat: true,
			embedding: true,
			modelDiscovery: true,
		};

		const keys = Object.keys(capabilities);
		expect(keys).toHaveLength(3);
		expect(keys).toContain("chat");
		expect(keys).toContain("embedding");
		expect(keys).toContain("modelDiscovery");
	});

	it("should be assignable to a provider definition", () => {
		// This test documents that ProviderCapabilities is used within
		// provider definitions to declare what a provider can do
		const capabilities: ProviderCapabilities = {
			chat: true,
			embedding: true,
			modelDiscovery: true,
		};

		// The capabilities object can be used to conditionally render UI
		// or enable/disable features based on provider support
		const showEmbeddingOptions = capabilities.embedding;
		const showModelDiscoveryButton = capabilities.modelDiscovery;
		const canStartChat = capabilities.chat;

		expect(showEmbeddingOptions).toBe(true);
		expect(showModelDiscoveryButton).toBe(true);
		expect(canStartChat).toBe(true);
	});
});

describe("ProviderSetupInstructions", () => {
	it("should require steps array property", () => {
		const instructions: ProviderSetupInstructions = {
			steps: ["Step 1: Create an API key", "Step 2: Paste it below"],
		};

		expect(instructions.steps).toEqual(["Step 1: Create an API key", "Step 2: Paste it below"]);
	});

	it("should allow empty steps array", () => {
		const instructions: ProviderSetupInstructions = {
			steps: [],
		};

		expect(instructions.steps).toEqual([]);
		expect(instructions.steps).toHaveLength(0);
	});

	it("should allow optional link property", () => {
		const instructions: ProviderSetupInstructions = {
			steps: ["Get your API key from the dashboard"],
			link: {
				url: "https://platform.openai.com/api-keys",
				text: "OpenAI Dashboard",
			},
		};

		expect(instructions.link).toBeDefined();
		expect(instructions.link?.url).toBe("https://platform.openai.com/api-keys");
		expect(instructions.link?.text).toBe("OpenAI Dashboard");
	});

	it("should work without optional link property", () => {
		const instructions: ProviderSetupInstructions = {
			steps: ["Just one step"],
		};

		expect(instructions.link).toBeUndefined();
	});

	it("should support OpenAI-style setup instructions", () => {
		// Example: OpenAI provider setup instructions
		const openaiInstructions: ProviderSetupInstructions = {
			steps: [
				"Create an API key from OpenAI's Dashboard",
				"Ensure your OpenAI account has credits loaded",
				"Paste the API key below (starts with 'sk-')",
			],
			link: {
				url: "https://platform.openai.com/api-keys",
				text: "OpenAI Dashboard",
			},
		};

		expect(openaiInstructions.steps).toHaveLength(3);
		expect(openaiInstructions.steps[0]).toContain("API key");
		expect(openaiInstructions.link?.url).toContain("openai.com");
	});

	it("should support Ollama-style setup instructions", () => {
		// Example: Ollama provider setup instructions (local server)
		const ollamaInstructions: ProviderSetupInstructions = {
			steps: [
				"Install Ollama on your machine",
				"Start the Ollama server (usually runs on localhost:11434)",
				"Enter the base URL below (default: http://localhost:11434)",
			],
			link: {
				url: "https://ollama.ai",
				text: "Ollama Website",
			},
		};

		expect(ollamaInstructions.steps).toHaveLength(3);
		expect(ollamaInstructions.steps[1]).toContain("localhost:11434");
		expect(ollamaInstructions.link?.url).toBe("https://ollama.ai");
	});

	it("should support Anthropic-style setup instructions (without link)", () => {
		// Example: Anthropic provider - simple instructions without dashboard link
		const anthropicInstructions: ProviderSetupInstructions = {
			steps: ["Create an API key from your Anthropic Console", "Paste the API key below"],
		};

		expect(anthropicInstructions.steps).toHaveLength(2);
		expect(anthropicInstructions.link).toBeUndefined();
	});

	it("should have link with both url and text properties when present", () => {
		const instructions: ProviderSetupInstructions = {
			steps: ["Follow the link below"],
			link: {
				url: "https://example.com",
				text: "Example Link",
			},
		};

		// Both url and text are required when link is present
		expect(instructions.link?.url).toBe("https://example.com");
		expect(instructions.link?.text).toBe("Example Link");
		expect(typeof instructions.link?.url).toBe("string");
		expect(typeof instructions.link?.text).toBe("string");
	});

	it("should be usable for rendering setup UI", () => {
		// This test documents that ProviderSetupInstructions is used
		// to render setup instructions in the provider settings UI
		const instructions: ProviderSetupInstructions = {
			steps: ["Step 1", "Step 2", "Step 3"],
			link: {
				url: "https://docs.example.com",
				text: "Documentation",
			},
		};

		// The steps array can be mapped to list items
		const listItems = instructions.steps.map((step: string, i: number) => `${i + 1}. ${step}`);
		expect(listItems).toEqual(["1. Step 1", "2. Step 2", "3. Step 3"]);

		// The link can be rendered as an anchor tag
		const hasLink = !!instructions.link;
		expect(hasLink).toBe(true);
	});

	it("should support multiline step instructions", () => {
		const instructions: ProviderSetupInstructions = {
			steps: [
				"First, navigate to the API settings page in your provider's dashboard",
				"Next, click 'Create new API key' and give it a descriptive name",
				"Finally, copy the key and paste it in the field below - you won't be able to see it again!",
			],
		};

		expect(instructions.steps).toHaveLength(3);
		expect(instructions.steps[2]).toContain("you won't be able to see it again");
	});
});
