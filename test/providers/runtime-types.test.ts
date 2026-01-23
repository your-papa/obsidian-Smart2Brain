/**
 * Runtime Types Tests
 *
 * Tests for runtime-related type definitions:
 * - DiscoveredModels: Model discovery results from providers
 * - RuntimeProviderDefinition: Runtime provider with factory functions for model instantiation
 */
import { describe, expect, it } from "vitest";

import type { DiscoveredModels, RuntimeAuthState, RuntimeProviderDefinition } from "../../src/providers/types.ts";

describe("DiscoveredModels", () => {
	it("should require chat and embedding arrays", () => {
		const discovered: DiscoveredModels = {
			chat: ["gpt-4o", "gpt-4o-mini"],
			embedding: ["text-embedding-3-small", "text-embedding-3-large"],
		};

		expect(discovered.chat).toEqual(["gpt-4o", "gpt-4o-mini"]);
		expect(discovered.embedding).toEqual(["text-embedding-3-small", "text-embedding-3-large"]);
	});

	it("should allow empty arrays for both chat and embedding", () => {
		const emptyDiscovered: DiscoveredModels = {
			chat: [],
			embedding: [],
		};

		expect(emptyDiscovered.chat).toEqual([]);
		expect(emptyDiscovered.embedding).toEqual([]);
		expect(emptyDiscovered.chat).toHaveLength(0);
		expect(emptyDiscovered.embedding).toHaveLength(0);
	});

	it("should allow chat-only providers (empty embedding array)", () => {
		// Example: Anthropic only has chat models
		const anthropicDiscovered: DiscoveredModels = {
			chat: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
			embedding: [],
		};

		expect(anthropicDiscovered.chat).toHaveLength(2);
		expect(anthropicDiscovered.embedding).toHaveLength(0);
	});

	it("should contain model ID strings only (not full config)", () => {
		// DiscoveredModels returns just IDs - config is set by user
		const discovered: DiscoveredModels = {
			chat: ["gpt-4o"],
			embedding: ["text-embedding-3-small"],
		};

		// Verify the arrays contain strings
		expect(typeof discovered.chat[0]).toBe("string");
		expect(typeof discovered.embedding[0]).toBe("string");

		// Model IDs should be strings like "gpt-4o", not objects with config
		expect(discovered.chat[0]).toBe("gpt-4o");
	});

	it("should support OpenAI-style discovery results", () => {
		// Example: OpenAI model discovery result
		const openaiDiscovered: DiscoveredModels = {
			chat: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "o1-preview", "o1-mini"],
			embedding: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"],
		};

		expect(openaiDiscovered.chat).toContain("gpt-4o");
		expect(openaiDiscovered.chat).toContain("o1-preview");
		expect(openaiDiscovered.embedding).toContain("text-embedding-3-small");
		expect(openaiDiscovered.chat.length).toBeGreaterThan(0);
		expect(openaiDiscovered.embedding.length).toBeGreaterThan(0);
	});

	it("should support Ollama-style discovery results", () => {
		// Example: Ollama model discovery result (local models)
		const ollamaDiscovered: DiscoveredModels = {
			chat: ["llama3.1", "llama3.1:70b", "mistral", "codellama"],
			embedding: ["nomic-embed-text", "mxbai-embed-large"],
		};

		expect(ollamaDiscovered.chat).toContain("llama3.1");
		expect(ollamaDiscovered.embedding).toContain("nomic-embed-text");
	});

	it("should be returned by provider discoverModels method", async () => {
		// Example: Mock discoverModels function
		const mockDiscoverModels = async (): Promise<DiscoveredModels> => {
			return {
				chat: ["model-a", "model-b"],
				embedding: ["embed-model-1"],
			};
		};

		const result = await mockDiscoverModels();
		expect(result.chat).toEqual(["model-a", "model-b"]);
		expect(result.embedding).toEqual(["embed-model-1"]);
	});

	it("should have exactly two properties (chat and embedding)", () => {
		const discovered: DiscoveredModels = {
			chat: ["model-1"],
			embedding: ["embed-1"],
		};

		const keys = Object.keys(discovered);
		expect(keys).toHaveLength(2);
		expect(keys).toContain("chat");
		expect(keys).toContain("embedding");
	});

	it("should be used by providers with modelDiscovery capability", () => {
		// This test documents that DiscoveredModels is used by providers
		// that have capabilities.modelDiscovery = true

		// Mock provider with model discovery capability
		const provider = {
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: true,
			},
			discoverModels: async (): Promise<DiscoveredModels> => ({
				chat: ["discovered-chat-model"],
				embedding: ["discovered-embed-model"],
			}),
		};

		expect(provider.capabilities.modelDiscovery).toBe(true);
		expect(typeof provider.discoverModels).toBe("function");
	});

	it("should allow large arrays of discovered models", () => {
		// Some providers may return many models
		const manyModels: DiscoveredModels = {
			chat: Array.from({ length: 50 }, (_, i) => `model-${i}`),
			embedding: Array.from({ length: 10 }, (_, i) => `embed-${i}`),
		};

		expect(manyModels.chat).toHaveLength(50);
		expect(manyModels.embedding).toHaveLength(10);
		expect(manyModels.chat[0]).toBe("model-0");
		expect(manyModels.chat[49]).toBe("model-49");
	});

	it("should support model IDs with various formats", () => {
		// Model IDs can have various formats depending on the provider
		const discovered: DiscoveredModels = {
			chat: [
				"gpt-4o", // Simple dash-separated
				"claude-3-5-sonnet-20241022", // Date-versioned
				"llama3.1:70b", // Ollama format with tag
				"accounts/fireworks/models/llama-v3-70b-instruct", // Full path
				"meta-llama/Meta-Llama-3-8B-Instruct", // HuggingFace format
			],
			embedding: [
				"text-embedding-3-small",
				"nomic-embed-text:latest", // Ollama with tag
			],
		};

		expect(discovered.chat).toContain("gpt-4o");
		expect(discovered.chat).toContain("llama3.1:70b");
		expect(discovered.embedding).toContain("nomic-embed-text:latest");
	});
});

describe("RuntimeProviderDefinition", () => {
	it("should require chatModels property as Record of factory functions", () => {
		// RuntimeProviderDefinition contains factory functions that create LangChain model instances
		const runtime: RuntimeProviderDefinition = {
			chatModels: {
				"gpt-4o": async () => ({}) as unknown,
				"gpt-4o-mini": async () => ({}) as unknown,
			},
			embeddingModels: {},
		};

		expect(runtime.chatModels).toBeDefined();
		expect(typeof runtime.chatModels).toBe("object");
		expect(Object.keys(runtime.chatModels)).toContain("gpt-4o");
		expect(Object.keys(runtime.chatModels)).toContain("gpt-4o-mini");
	});

	it("should require embeddingModels property as Record of factory functions", () => {
		const runtime: RuntimeProviderDefinition = {
			chatModels: {},
			embeddingModels: {
				"text-embedding-3-small": async () => ({}) as unknown,
				"text-embedding-3-large": async () => ({}) as unknown,
			},
		};

		expect(runtime.embeddingModels).toBeDefined();
		expect(typeof runtime.embeddingModels).toBe("object");
		expect(Object.keys(runtime.embeddingModels)).toContain("text-embedding-3-small");
		expect(Object.keys(runtime.embeddingModels)).toContain("text-embedding-3-large");
	});

	it("should allow empty chatModels and embeddingModels records", () => {
		// Some providers may not have any models configured yet
		const emptyRuntime: RuntimeProviderDefinition = {
			chatModels: {},
			embeddingModels: {},
		};

		expect(Object.keys(emptyRuntime.chatModels)).toHaveLength(0);
		expect(Object.keys(emptyRuntime.embeddingModels)).toHaveLength(0);
	});

	it("should work with minimal required properties", () => {
		// Minimal RuntimeProviderDefinition
		const runtime: RuntimeProviderDefinition = {
			chatModels: {
				"gpt-4o": async () => ({}) as unknown,
			},
			embeddingModels: {
				"text-embedding-3-small": async () => ({}) as unknown,
			},
		};

		expect(runtime.chatModels).toBeDefined();
		expect(runtime.embeddingModels).toBeDefined();
	});

	it("should have chatModels with async factory functions", async () => {
		// Factory functions are async and return model instances
		let factoryCalled = false;
		const mockChatModel = { modelName: "gpt-4o", invoke: () => {} };

		const runtime: RuntimeProviderDefinition = {
			chatModels: {
				"gpt-4o": async (_options?: Record<string, unknown>) => {
					factoryCalled = true;
					return mockChatModel as unknown;
				},
			},
			embeddingModels: {},
		};

		// Call the factory function
		const factory = runtime.chatModels["gpt-4o"];
		expect(typeof factory).toBe("function");

		const model = await factory();
		expect(factoryCalled).toBe(true);
		expect(model).toBe(mockChatModel);
	});

	it("should have embeddingModels with async factory functions", async () => {
		// Factory functions for embeddings are also async
		let factoryCalled = false;
		const mockEmbeddingModel = { modelName: "text-embedding-3-small", embedDocuments: () => {} };

		const runtime: RuntimeProviderDefinition = {
			chatModels: {},
			embeddingModels: {
				"text-embedding-3-small": async (_options?: Record<string, unknown>) => {
					factoryCalled = true;
					return mockEmbeddingModel as unknown;
				},
			},
		};

		// Call the factory function
		const factory = runtime.embeddingModels["text-embedding-3-small"];
		expect(typeof factory).toBe("function");

		const model = await factory();
		expect(factoryCalled).toBe(true);
		expect(model).toBe(mockEmbeddingModel);
	});

	it("should pass options to factory functions", async () => {
		// Factory functions receive optional ModelOptions
		let receivedOptions: Record<string, unknown> | undefined;

		const runtime: RuntimeProviderDefinition = {
			chatModels: {
				"gpt-4o": async (options?: Record<string, unknown>) => {
					receivedOptions = options;
					return {} as unknown;
				},
			},
			embeddingModels: {},
		};

		const testOptions = { temperature: 0.7, maxTokens: 1000 };
		await runtime.chatModels["gpt-4o"](testOptions);

		expect(receivedOptions).toEqual(testOptions);
	});

	it("should support OpenAI-style provider runtime definition", () => {
		// Example: OpenAI provider with chat and embedding models
		const openaiRuntime: RuntimeProviderDefinition = {
			chatModels: {
				"gpt-4o": async () => ({ modelName: "gpt-4o" }) as unknown,
				"gpt-4o-mini": async () => ({ modelName: "gpt-4o-mini" }) as unknown,
				"gpt-4-turbo": async () => ({ modelName: "gpt-4-turbo" }) as unknown,
			},
			embeddingModels: {
				"text-embedding-3-small": async () => ({ modelName: "text-embedding-3-small" }) as unknown,
				"text-embedding-3-large": async () => ({ modelName: "text-embedding-3-large" }) as unknown,
			},
		};

		expect(Object.keys(openaiRuntime.chatModels)).toHaveLength(3);
		expect(Object.keys(openaiRuntime.embeddingModels)).toHaveLength(2);
	});

	it("should support Anthropic-style provider runtime definition (chat only)", () => {
		// Example: Anthropic provider - chat only, no embeddings
		const anthropicRuntime: RuntimeProviderDefinition = {
			chatModels: {
				"claude-3-5-sonnet-20241022": async () => ({ modelName: "claude-3-5-sonnet" }) as unknown,
				"claude-3-5-haiku-20241022": async () => ({ modelName: "claude-3-5-haiku" }) as unknown,
			},
			embeddingModels: {},
		};

		expect(Object.keys(anthropicRuntime.chatModels)).toHaveLength(2);
		expect(Object.keys(anthropicRuntime.embeddingModels)).toHaveLength(0);
	});

	it("should support Ollama-style provider runtime definition", () => {
		// Example: Ollama provider - local models
		const ollamaRuntime: RuntimeProviderDefinition = {
			chatModels: {
				"llama3.1": async () => ({ modelName: "llama3.1" }) as unknown,
				"llama3.1:70b": async () => ({ modelName: "llama3.1:70b" }) as unknown,
				mistral: async () => ({ modelName: "mistral" }) as unknown,
			},
			embeddingModels: {
				"nomic-embed-text": async () => ({ modelName: "nomic-embed-text" }) as unknown,
			},
		};

		expect(ollamaRuntime.chatModels["llama3.1"]).toBeDefined();
		expect(ollamaRuntime.embeddingModels["nomic-embed-text"]).toBeDefined();
	});

	it("should be created by provider createRuntimeDefinition method", async () => {
		// Example: Mock createRuntimeDefinition function
		// createRuntimeDefinition takes two arguments: auth and modelIds
		const createRuntimeDefinition = async (
			auth: RuntimeAuthState,
			modelIds: { chat: string[]; embedding: string[] },
		): Promise<RuntimeProviderDefinition> => {
			// In real code, this creates factories that capture the auth credentials
			const chatModels: Record<string, (options?: Record<string, unknown>) => Promise<unknown>> = {};
			for (const modelId of modelIds.chat) {
				chatModels[modelId] = async () =>
					({
						modelName: modelId,
						// Auth captured in closure
						apiKey: auth.type === "field-based" ? auth.values.apiKey : undefined,
					}) as unknown;
			}
			return {
				chatModels,
				embeddingModels: {},
			};
		};

		const auth: RuntimeAuthState = {
			type: "field-based",
			values: { apiKey: "sk-test-key" },
		};

		const modelIds = { chat: ["gpt-4o"], embedding: [] };

		const runtime = await createRuntimeDefinition(auth, modelIds);

		expect(runtime.chatModels["gpt-4o"]).toBeDefined();
		expect(typeof runtime.chatModels["gpt-4o"]).toBe("function");
	});

	it("should have factory functions that return LangChain-compatible model instances", async () => {
		// The factory functions return LangChain model instances
		// We test the interface shape, not actual LangChain classes

		// Mock BaseChatModel interface
		interface MockChatModel {
			invoke: (input: string) => Promise<string>;
			modelName: string;
		}

		// Mock EmbeddingsInterface
		interface MockEmbeddings {
			embedDocuments: (documents: string[]) => Promise<number[][]>;
			embedQuery: (query: string) => Promise<number[]>;
		}

		const mockChatModel: MockChatModel = {
			invoke: async (input) => `Response to: ${input}`,
			modelName: "gpt-4o",
		};

		const mockEmbeddings: MockEmbeddings = {
			embedDocuments: async () => [[0.1, 0.2, 0.3]],
			embedQuery: async () => [0.1, 0.2, 0.3],
		};

		const runtime: RuntimeProviderDefinition = {
			chatModels: {
				"gpt-4o": async () => mockChatModel as unknown,
			},
			embeddingModels: {
				"text-embedding-3-small": async () => mockEmbeddings as unknown,
			},
		};

		const chatModel = (await runtime.chatModels["gpt-4o"]()) as MockChatModel;
		const embedModel = (await runtime.embeddingModels["text-embedding-3-small"]()) as MockEmbeddings;

		expect(typeof chatModel.invoke).toBe("function");
		expect(typeof embedModel.embedDocuments).toBe("function");
		expect(typeof embedModel.embedQuery).toBe("function");
	});

	it("should be used by ProviderRegistry to instantiate models", () => {
		// This test documents that RuntimeProviderDefinition is used by
		// ProviderRegistry to get model instances at runtime

		// Mock ProviderRegistry usage pattern
		const registry = {
			providers: {} as Record<string, RuntimeProviderDefinition>,

			registerProvider(id: string, runtime: RuntimeProviderDefinition) {
				this.providers[id] = runtime;
			},

			async getChatModel(providerId: string, modelId: string) {
				const provider = this.providers[providerId];
				if (!provider) throw new Error(`Provider ${providerId} not found`);
				const factory = provider.chatModels[modelId];
				if (!factory) throw new Error(`Model ${modelId} not found`);
				return factory();
			},
		};

		const runtime: RuntimeProviderDefinition = {
			chatModels: {
				"gpt-4o": async () => ({ modelName: "gpt-4o" }) as unknown,
			},
			embeddingModels: {},
		};

		registry.registerProvider("openai", runtime);

		expect(registry.providers.openai).toBe(runtime);
		expect(registry.providers.openai.chatModels["gpt-4o"]).toBeDefined();
	});

	it("should have exactly two required properties", () => {
		// Required: chatModels, embeddingModels
		const minimalRuntime: RuntimeProviderDefinition = {
			chatModels: {},
			embeddingModels: {},
		};

		// Minimal has only required properties
		expect("chatModels" in minimalRuntime).toBe(true);
		expect("embeddingModels" in minimalRuntime).toBe(true);
	});
});
