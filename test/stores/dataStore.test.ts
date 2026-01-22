/**
 * Tests for PluginDataStore custom provider CRUD methods and migration
 *
 * Note: These tests rely on the vitest.config.ts alias to resolve 'obsidian'.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock obsidian before importing dataStore (it's only available at runtime in Obsidian)
vi.mock("obsidian", () => import("../__mocks__/obsidian.ts"));

// Mock secretStorage before importing dataStore
vi.mock("../../src/lib/secretStorage.ts", () => ({
	getSecret: vi.fn().mockReturnValue(null),
	setSecret: vi.fn(),
	listSecrets: vi.fn().mockReturnValue([]),
}));

// Mock i18n
vi.mock("../../src/lib/i18n.ts", () => ({
	locale: { subscribe: vi.fn() },
	_: { subscribe: vi.fn((cb: (value: (key: string) => string) => void) => cb((key: string) => key)) },
	t: (key: string) => key,
}));

// Mock SAP AI SDK (dynamically imported)
vi.mock("@sap-ai-sdk/langchain", () => ({
	AzureOpenAiChatClient: vi.fn(),
	AzureOpenAiEmbeddingClient: vi.fn(),
}));

// Mock LangChain providers
vi.mock("@langchain/openai", () => ({
	ChatOpenAI: vi.fn().mockImplementation(() => ({ invoke: vi.fn() })),
	OpenAIEmbeddings: vi.fn().mockImplementation(() => ({ embedQuery: vi.fn() })),
}));

vi.mock("@langchain/anthropic", () => ({
	ChatAnthropic: vi.fn().mockImplementation(() => ({ invoke: vi.fn() })),
}));

vi.mock("@langchain/ollama", () => ({
	ChatOllama: vi.fn().mockImplementation(() => ({ invoke: vi.fn() })),
	OllamaEmbeddings: vi.fn().mockImplementation(() => ({ embedQuery: vi.fn() })),
}));

// Import types and module after mocks
import type { CustomProviderDefinition } from "../../src/providers/types.ts";
import {
	DEFAULT_SETTINGS,
	PluginDataStore,
	type StoredCustomProvider,
	type StoredProviderState,
} from "../../src/stores/dataStore.svelte.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock plugin for testing
 */
function createMockPlugin() {
	const data: Record<string, unknown> = {};

	return {
		app: {
			vault: {
				getFolderByPath: vi.fn().mockReturnValue(null),
				createFolder: vi.fn().mockResolvedValue(undefined),
			},
			secretStorage: {
				getSecret: vi.fn().mockReturnValue(null),
				setSecret: vi.fn(),
				listSecrets: vi.fn().mockReturnValue([]),
			},
		},
		loadData: vi.fn().mockResolvedValue(data),
		saveData: vi.fn().mockImplementation(async (newData: unknown) => {
			Object.assign(data, newData);
		}),
		manifest: { id: "test-plugin", name: "Test Plugin", version: "1.0.0" },
	};
}

/**
 * Creates a minimal stored custom provider for testing
 */
function createStoredCustomProvider(overrides: Partial<StoredCustomProvider> = {}): StoredCustomProvider {
	const defaultDefinition: StoredCustomProvider["definition"] = {
		id: "test-provider",
		displayName: "Test Provider",
		isBuiltIn: false,
		baseProviderId: "openai",
		createdAt: Date.now(),
		setupInstructions: {
			steps: ["Test step 1"],
		},
		auth: {
			type: "field-based",
			fields: {
				apiKey: {
					label: "API Key",
					kind: "secret",
					primary: true,
					required: true,
				},
				baseUrl: {
					label: "Base URL",
					kind: "text",
					primary: true,
					required: true,
				},
			},
		},
		capabilities: {
			chat: true,
			embedding: true,
			modelDiscovery: false,
		},
	};

	const defaultState: StoredProviderState = {
		isConfigured: false,
		auth: {
			type: "field-based",
			values: {},
			secretIds: {},
		},
		chatModels: {},
		embedModels: {},
	};

	return {
		definition: overrides.definition ?? defaultDefinition,
		state: overrides.state ?? defaultState,
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("PluginDataStore - Custom Provider CRUD", () => {
	// biome-ignore lint/suspicious/noExplicitAny: Mock type
	let mockPlugin: any;
	let dataStore: PluginDataStore;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPlugin = createMockPlugin();
		dataStore = new PluginDataStore(mockPlugin, { ...DEFAULT_SETTINGS });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// getCustomProviders
	// =========================================================================

	describe("getCustomProviders", () => {
		it("returns empty array when no custom providers exist", () => {
			const providers = dataStore.getCustomProviders();
			expect(providers).toEqual([]);
		});

		it("returns all custom providers after adding them", async () => {
			const provider1 = createStoredCustomProvider({
				definition: {
					id: "provider-1",
					displayName: "Provider 1",
					isBuiltIn: false,
					baseProviderId: "openai",
					createdAt: 1000,
					setupInstructions: { steps: ["Step 1"] },
					auth: { type: "field-based", fields: {} },
					capabilities: { chat: true, embedding: false, modelDiscovery: false },
				},
			});

			const provider2 = createStoredCustomProvider({
				definition: {
					id: "provider-2",
					displayName: "Provider 2",
					isBuiltIn: false,
					baseProviderId: "openai",
					createdAt: 2000,
					setupInstructions: { steps: ["Step 2"] },
					auth: { type: "field-based", fields: {} },
					capabilities: { chat: true, embedding: true, modelDiscovery: false },
				},
			});

			await dataStore.addCustomProvider(provider1);
			await dataStore.addCustomProvider(provider2);

			const providers = dataStore.getCustomProviders();
			expect(providers).toHaveLength(2);
			expect(providers[0].definition.id).toBe("provider-1");
			expect(providers[1].definition.id).toBe("provider-2");
		});
	});

	// =========================================================================
	// addCustomProvider
	// =========================================================================

	describe("addCustomProvider", () => {
		it("adds a new custom provider", async () => {
			const provider = createStoredCustomProvider();

			await dataStore.addCustomProvider(provider);

			const providers = dataStore.getCustomProviders();
			expect(providers).toHaveLength(1);
			expect(providers[0].definition.id).toBe("test-provider");
		});

		it("throws error when adding provider with duplicate ID", async () => {
			const provider = createStoredCustomProvider();
			await dataStore.addCustomProvider(provider);

			const duplicate = createStoredCustomProvider();

			await expect(dataStore.addCustomProvider(duplicate)).rejects.toThrow(
				'Custom provider with ID "test-provider" already exists',
			);
		});

		it("throws error when adding provider with built-in provider ID", async () => {
			const provider = createStoredCustomProvider({
				definition: {
					id: "openai",
					displayName: "OpenAI Clone",
					isBuiltIn: false,
					baseProviderId: "openai",
					createdAt: Date.now(),
					setupInstructions: { steps: [] },
					auth: { type: "field-based", fields: {} },
					capabilities: { chat: true, embedding: true, modelDiscovery: false },
				},
			});

			await expect(dataStore.addCustomProvider(provider)).rejects.toThrow(
				'Cannot use built-in provider ID "openai" for custom provider',
			);
		});

		it("saves settings after adding provider", async () => {
			const provider = createStoredCustomProvider();

			await dataStore.addCustomProvider(provider);

			expect(mockPlugin.saveData).toHaveBeenCalled();
		});

		it("persists custom provider state correctly", async () => {
			const provider = createStoredCustomProvider({
				state: {
					isConfigured: true,
					auth: {
						type: "field-based",
						values: { baseUrl: "https://api.example.com" },
						secretIds: { apiKey: "my-secret-id" },
					},
					chatModels: {
						"gpt-4": { contextWindow: 8192, temperature: 0.7 },
					},
					embedModels: {},
				},
			});

			await dataStore.addCustomProvider(provider);

			const providers = dataStore.getCustomProviders();
			expect(providers[0].state.isConfigured).toBe(true);
			expect(providers[0].state.auth.type).toBe("field-based");
			if (providers[0].state.auth.type === "field-based") {
				expect(providers[0].state.auth.values.baseUrl).toBe("https://api.example.com");
				expect(providers[0].state.auth.secretIds.apiKey).toBe("my-secret-id");
			}
			expect(providers[0].state.chatModels["gpt-4"]).toEqual({ contextWindow: 8192, temperature: 0.7 });
		});
	});

	// =========================================================================
	// updateCustomProvider
	// =========================================================================

	describe("updateCustomProvider", () => {
		it("updates an existing custom provider", async () => {
			const provider = createStoredCustomProvider();
			await dataStore.addCustomProvider(provider);

			const updates: Partial<StoredCustomProvider> = {
				definition: {
					...provider.definition,
					displayName: "Updated Provider",
				},
			};

			await dataStore.updateCustomProvider("test-provider", updates);

			const providers = dataStore.getCustomProviders();
			expect(providers[0].definition.displayName).toBe("Updated Provider");
		});

		it("updates provider state", async () => {
			const provider = createStoredCustomProvider();
			await dataStore.addCustomProvider(provider);

			await dataStore.updateCustomProvider("test-provider", {
				state: {
					...provider.state,
					isConfigured: true,
				},
			});

			const providers = dataStore.getCustomProviders();
			expect(providers[0].state.isConfigured).toBe(true);
		});

		it("throws error when updating non-existent provider", async () => {
			await expect(
				dataStore.updateCustomProvider("non-existent", {
					state: { isConfigured: true } as StoredProviderState,
				}),
			).rejects.toThrow('Custom provider with ID "non-existent" not found');
		});

		it("saves settings after updating provider", async () => {
			const provider = createStoredCustomProvider();
			await dataStore.addCustomProvider(provider);
			vi.clearAllMocks();

			await dataStore.updateCustomProvider("test-provider", {
				state: { ...provider.state, isConfigured: true },
			});

			expect(mockPlugin.saveData).toHaveBeenCalled();
		});

		it("does not change provider ID during update", async () => {
			const provider = createStoredCustomProvider();
			await dataStore.addCustomProvider(provider);

			// Attempt to change ID in the update (should be ignored or prevented)
			await dataStore.updateCustomProvider("test-provider", {
				definition: {
					...provider.definition,
					id: "different-id", // This should not change the ID
				},
			});

			const providers = dataStore.getCustomProviders();
			expect(providers[0].definition.id).toBe("test-provider");
		});
	});

	// =========================================================================
	// deleteCustomProvider
	// =========================================================================

	describe("deleteCustomProvider", () => {
		it("deletes an existing custom provider", async () => {
			const provider = createStoredCustomProvider();
			await dataStore.addCustomProvider(provider);

			await dataStore.deleteCustomProvider("test-provider");

			const providers = dataStore.getCustomProviders();
			expect(providers).toHaveLength(0);
		});

		it("throws error when deleting non-existent provider", async () => {
			await expect(dataStore.deleteCustomProvider("non-existent")).rejects.toThrow(
				'Custom provider with ID "non-existent" not found',
			);
		});

		it("saves settings after deleting provider", async () => {
			const provider = createStoredCustomProvider();
			await dataStore.addCustomProvider(provider);
			vi.clearAllMocks();

			await dataStore.deleteCustomProvider("test-provider");

			expect(mockPlugin.saveData).toHaveBeenCalled();
		});

		it("only deletes the specified provider", async () => {
			const provider1 = createStoredCustomProvider({
				definition: { ...createStoredCustomProvider().definition, id: "provider-1" },
			});
			const provider2 = createStoredCustomProvider({
				definition: { ...createStoredCustomProvider().definition, id: "provider-2" },
			});

			await dataStore.addCustomProvider(provider1);
			await dataStore.addCustomProvider(provider2);

			await dataStore.deleteCustomProvider("provider-1");

			const providers = dataStore.getCustomProviders();
			expect(providers).toHaveLength(1);
			expect(providers[0].definition.id).toBe("provider-2");
		});
	});

	// =========================================================================
	// getCustomProvider (single provider by ID)
	// =========================================================================

	describe("getCustomProvider", () => {
		it("returns the custom provider by ID", async () => {
			const provider = createStoredCustomProvider();
			await dataStore.addCustomProvider(provider);

			const result = dataStore.getCustomProvider("test-provider");

			expect(result).toBeDefined();
			expect(result?.definition.id).toBe("test-provider");
		});

		it("returns undefined for non-existent provider", () => {
			const result = dataStore.getCustomProvider("non-existent");
			expect(result).toBeUndefined();
		});
	});

	// =========================================================================
	// Integration with getConfiguredProviderIds
	// =========================================================================

	describe("integration with getConfiguredProviderIds", () => {
		it("includes configured custom providers in getConfiguredProviderIds", async () => {
			const provider = createStoredCustomProvider({
				state: {
					isConfigured: true,
					auth: { type: "field-based", values: {}, secretIds: {} },
					chatModels: {},
					embedModels: {},
				},
			});

			await dataStore.addCustomProvider(provider);

			const configuredIds = dataStore.getConfiguredProviderIds();
			expect(configuredIds).toContain("test-provider");
		});

		it("excludes non-configured custom providers from getConfiguredProviderIds", async () => {
			const provider = createStoredCustomProvider({
				state: {
					isConfigured: false,
					auth: { type: "field-based", values: {}, secretIds: {} },
					chatModels: {},
					embedModels: {},
				},
			});

			await dataStore.addCustomProvider(provider);

			const configuredIds = dataStore.getConfiguredProviderIds();
			expect(configuredIds).not.toContain("test-provider");
		});
	});

	// =========================================================================
	// Integration with isProviderConfigured
	// =========================================================================

	describe("integration with isProviderConfigured", () => {
		it("returns true for configured custom provider", async () => {
			const provider = createStoredCustomProvider({
				state: {
					isConfigured: true,
					auth: { type: "field-based", values: {}, secretIds: {} },
					chatModels: {},
					embedModels: {},
				},
			});

			await dataStore.addCustomProvider(provider);

			expect(dataStore.isProviderConfigured("test-provider")).toBe(true);
		});

		it("returns false for non-configured custom provider", async () => {
			const provider = createStoredCustomProvider({
				state: {
					isConfigured: false,
					auth: { type: "field-based", values: {}, secretIds: {} },
					chatModels: {},
					embedModels: {},
				},
			});

			await dataStore.addCustomProvider(provider);

			expect(dataStore.isProviderConfigured("test-provider")).toBe(false);
		});

		it("returns false for non-existent custom provider", () => {
			expect(dataStore.isProviderConfigured("non-existent")).toBe(false);
		});
	});

	// =========================================================================
	// Integration with getStoredAuthState
	// =========================================================================

	describe("integration with getStoredAuthState", () => {
		it("returns stored auth state for custom provider", async () => {
			const provider = createStoredCustomProvider({
				state: {
					isConfigured: true,
					auth: {
						type: "field-based",
						values: { baseUrl: "https://api.example.com" },
						secretIds: { apiKey: "my-secret-id" },
					},
					chatModels: {},
					embedModels: {},
				},
			});

			await dataStore.addCustomProvider(provider);

			const authState = dataStore.getStoredAuthState("test-provider");
			expect(authState).toBeDefined();
			expect(authState?.type).toBe("field-based");
			if (authState?.type === "field-based") {
				expect(authState.values.baseUrl).toBe("https://api.example.com");
				expect(authState.secretIds.apiKey).toBe("my-secret-id");
			}
		});

		it("returns undefined for non-existent custom provider", () => {
			const authState = dataStore.getStoredAuthState("non-existent-custom");
			expect(authState).toBeUndefined();
		});
	});

	// =========================================================================
	// setProviderConfigured for custom providers
	// =========================================================================

	describe("setProviderConfigured for custom providers", () => {
		it("sets custom provider as configured", async () => {
			const provider = createStoredCustomProvider();
			await dataStore.addCustomProvider(provider);

			dataStore.setProviderConfigured("test-provider", true);

			expect(dataStore.isProviderConfigured("test-provider")).toBe(true);
		});

		it("sets custom provider as not configured", async () => {
			const provider = createStoredCustomProvider({
				state: {
					isConfigured: true,
					auth: { type: "field-based", values: {}, secretIds: {} },
					chatModels: {},
					embedModels: {},
				},
			});
			await dataStore.addCustomProvider(provider);

			dataStore.setProviderConfigured("test-provider", false);

			expect(dataStore.isProviderConfigured("test-provider")).toBe(false);
		});
	});
});

// ============================================================================
// Migration Tests
// ============================================================================

describe("PluginDataStore - Legacy CustomOpenAI Migration", () => {
	// biome-ignore lint/suspicious/noExplicitAny: Mock type
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPlugin = createMockPlugin();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("preserves legacy CustomOpenAI provider through legacy methods", () => {
		// Set up legacy data with CustomOpenAI configured
		const legacyData = {
			...DEFAULT_SETTINGS,
			providerConfig: {
				...DEFAULT_SETTINGS.providerConfig,
				CustomOpenAI: {
					isConfigured: true,
					providerAuth: {
						apiKeyId: "custom-openai-key",
						baseUrl: "https://custom-api.example.com/v1",
					},
					genModels: new Map([["custom-model-1", { temperature: 0.5, contextWindow: 4096 }]]),
					embedModels: new Map([["custom-embed-1", { similarityThreshold: 0.7 }]]),
				},
			},
		};

		const dataStore = new PluginDataStore(mockPlugin, legacyData);

		// The legacy CustomOpenAI should still work through legacy methods
		const legacyConfigured = dataStore.getProviderIsConfigured("CustomOpenAI");
		expect(legacyConfigured).toBe(true);
	});

	it("does not create custom providers from unconfigured legacy CustomOpenAI", () => {
		const dataStore = new PluginDataStore(mockPlugin, { ...DEFAULT_SETTINGS });

		// No custom providers should be created from unconfigured legacy CustomOpenAI
		const customProviders = dataStore.getCustomProviders();
		expect(customProviders).toHaveLength(0);
	});
});
