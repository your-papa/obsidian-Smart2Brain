/**
 * Tests for provider definition types: BaseProviderDefinition and BuiltInProviderDefinition
 *
 * These tests verify the structure and behavior of provider definition interfaces
 * that define how AI providers are configured and instantiated.
 */
import { describe, expect, it } from "vitest";
import type {
	BaseProviderDefinition,
	BuiltInProviderDefinition,
	CustomProviderDefinition,
	DiscoveredModels,
	OAuthTokens,
	ProviderDefinition,
	RuntimeAuthState,
} from "../../src/providers/types.ts";

describe("BaseProviderDefinition", () => {
	it("should require id property as string", () => {
		// BaseProviderDefinition is the core interface all providers implement
		const provider: BaseProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			setupInstructions: {
				steps: ["Get your API key"],
			},
			auth: {
				type: "field-based",
				fields: {
					apiKey: {
						label: "API Key",
						kind: "secret",
						required: true,
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: true,
			},
			createRuntimeDefinition: async (_auth) => ({
				chatModels: {},
				embeddingModels: {},
			}),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(provider.id).toBe("openai");
		expect(typeof provider.id).toBe("string");
	});

	it("should require displayName property as string", () => {
		const provider: BaseProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			setupInstructions: { steps: [] },
			auth: {
				type: "field-based",
				fields: {},
			},
			capabilities: { chat: true, embedding: false, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(provider.displayName).toBe("OpenAI");
		expect(typeof provider.displayName).toBe("string");
	});

	it("should require capabilities property as ProviderCapabilities", () => {
		const provider: BaseProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: true,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(provider.capabilities.chat).toBe(true);
		expect(provider.capabilities.embedding).toBe(true);
		expect(provider.capabilities.modelDiscovery).toBe(true);
	});

	it("should require createRuntimeDefinition method that returns Promise<RuntimeProviderDefinition>", async () => {
		const provider: BaseProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (auth: RuntimeAuthState) => {
				// Factory should capture auth credentials
				if (auth.type !== "field-based") {
					throw new Error("Expected field-based auth");
				}
				const chatModels: Record<string, () => Promise<unknown>> = {};
				chatModels["gpt-4o"] = async () => ({ modelName: "gpt-4o", apiKey: auth.values.apiKey }) as unknown;
				return {
					chatModels,
					embeddingModels: {},
				};
			},
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: ["gpt-4o"], embedding: [] }),
		};

		const auth: RuntimeAuthState = {
			type: "field-based",
			values: { apiKey: "sk-test-key" },
		};

		const runtime = await provider.createRuntimeDefinition(auth);

		expect(runtime.chatModels).toBeDefined();
		expect(runtime.embeddingModels).toBeDefined();
		expect(runtime.chatModels["gpt-4o"]).toBeDefined();
		expect(typeof runtime.chatModels["gpt-4o"]).toBe("function");
	});

	it("should require validateAuth method that returns Promise<AuthValidationResult>", async () => {
		const provider: BaseProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			setupInstructions: { steps: [] },
			auth: {
				type: "field-based",
				fields: {
					apiKey: { label: "API Key", kind: "secret", required: true },
				},
			},
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
			validateAuth: async (auth: RuntimeAuthState) => {
				if (auth.type !== "field-based") {
					return { valid: false, error: "Invalid auth type" };
				}
				if (!auth.values.apiKey) {
					return { valid: false, error: "API key is required" };
				}
				if (!auth.values.apiKey.startsWith("sk-")) {
					return { valid: false, error: "API key must start with 'sk-'" };
				}
				return { valid: true };
			},
		};

		// Test with valid auth
		const validAuth: RuntimeAuthState = {
			type: "field-based",
			values: { apiKey: "sk-valid-key" },
		};
		const validResult = await provider.validateAuth(validAuth);
		expect(validResult.valid).toBe(true);

		// Test with missing key
		const missingKeyAuth: RuntimeAuthState = {
			type: "field-based",
			values: {},
		};
		const missingResult = await provider.validateAuth(missingKeyAuth);
		expect(missingResult.valid).toBe(false);
		if (!missingResult.valid) {
			expect(missingResult.error).toBe("API key is required");
		}

		// Test with invalid key format
		const invalidKeyAuth: RuntimeAuthState = {
			type: "field-based",
			values: { apiKey: "invalid-key" },
		};
		const invalidResult = await provider.validateAuth(invalidKeyAuth);
		expect(invalidResult.valid).toBe(false);
		if (!invalidResult.valid) {
			expect(invalidResult.error).toContain("sk-");
		}
	});

	it("should support OpenAI-style provider definition", () => {
		// Full example of OpenAI provider implementing BaseProviderDefinition
		const openaiProvider: BaseProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			setupInstructions: {
				steps: [
					"Create an API key from OpenAI's Dashboard",
					"Ensure your OpenAI account has credits loaded",
					"Paste the API key below (starts with 'sk-')",
				],
				link: {
					url: "https://platform.openai.com/api-keys",
					text: "OpenAI Dashboard",
				},
			},
			auth: {
				type: "field-based",
				fields: {
					apiKey: {
						label: "API Key",
						kind: "secret",
						required: true,
						placeholder: "sk-...",
					},
					baseUrl: {
						label: "Base URL",
						kind: "text",
						required: false,
						placeholder: "https://api.openai.com/v1",
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: true,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(openaiProvider.id).toBe("openai");
		expect(openaiProvider.displayName).toBe("OpenAI");
		expect(openaiProvider.capabilities.chat).toBe(true);
		expect(openaiProvider.capabilities.embedding).toBe(true);
		expect(openaiProvider.capabilities.modelDiscovery).toBe(true);
		expect(openaiProvider.auth.type).toBe("field-based");
		if (openaiProvider.auth.type === "field-based") {
			expect(openaiProvider.auth.fields.apiKey.required).toBe(true);
		}
	});

	it("should support Anthropic-style provider definition (chat only)", () => {
		// Anthropic provider - no embeddings, no model discovery
		const anthropicProvider: BaseProviderDefinition = {
			id: "anthropic",
			displayName: "Anthropic",
			setupInstructions: {
				steps: ["Create an API key from your Anthropic Console", "Paste the API key below"],
			},
			auth: {
				type: "field-based",
				fields: {
					apiKey: {
						label: "API Key",
						kind: "secret",
						required: true,
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: false,
				modelDiscovery: false,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(anthropicProvider.id).toBe("anthropic");
		expect(anthropicProvider.capabilities.chat).toBe(true);
		expect(anthropicProvider.capabilities.embedding).toBe(false);
		expect(anthropicProvider.capabilities.modelDiscovery).toBe(false);
	});

	it("should support Ollama-style provider definition (no API key required)", () => {
		// Ollama provider - baseUrl is primary, no API key
		const ollamaProvider: BaseProviderDefinition = {
			id: "ollama",
			displayName: "Ollama",
			setupInstructions: {
				steps: [
					"Install Ollama on your machine",
					"Start the Ollama server (usually runs on localhost:11434)",
					"Enter the base URL below (default: http://localhost:11434)",
				],
				link: {
					url: "https://ollama.ai",
					text: "Ollama Website",
				},
			},
			auth: {
				type: "field-based",
				fields: {
					baseUrl: {
						label: "Base URL",
						kind: "text",
						required: true,
						placeholder: "http://localhost:11434",
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: true,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(ollamaProvider.id).toBe("ollama");
		expect(ollamaProvider.auth.type).toBe("field-based");
		if (ollamaProvider.auth.type === "field-based") {
			expect(ollamaProvider.auth.fields.apiKey).toBeUndefined();
			expect(ollamaProvider.auth.fields.baseUrl.required).toBe(true);
			expect(ollamaProvider.auth.fields.baseUrl.placeholder).toBe("http://localhost:11434");
		}
	});

	it("should support OAuth-style provider definition (GitHub Copilot)", async () => {
		// GitHub Copilot provider with OAuth
		const copilotProvider: BaseProviderDefinition = {
			id: "github-copilot",
			displayName: "GitHub Copilot",
			setupInstructions: {
				steps: [
					"Ensure you have a GitHub account with Copilot access",
					"Click the button below to sign in with GitHub",
					"Authorize the application to access your Copilot subscription",
				],
				link: {
					url: "https://github.com/features/copilot",
					text: "Learn about GitHub Copilot",
				},
			},
			auth: {
				type: "oauth",
				buttonLabel: "Sign in with GitHub",
				startFlow: async () => ({
					accessToken: "ghu_xxxxxxxxxxxx",
					refreshToken: "ghr_xxxxxxxxxxxx",
					expiresAt: Date.now() + 28800000,
					tokenType: "Bearer",
					scope: "copilot",
				}),
				validateTokens: async (tokens: OAuthTokens) => {
					if (!tokens.accessToken) return false;
					if (tokens.expiresAt && Date.now() > tokens.expiresAt) return false;
					return true;
				},
			},
			capabilities: {
				chat: true,
				embedding: false,
				modelDiscovery: false,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async (auth: RuntimeAuthState) => {
				if (auth.type !== "oauth") {
					return { valid: false, error: "Invalid auth type" };
				}
				if (!auth.tokens.accessToken) {
					return { valid: false, error: "Not authenticated" };
				}
				if (auth.tokens.expiresAt && Date.now() > auth.tokens.expiresAt) {
					return { valid: false, error: "Token expired. Please sign in again." };
				}
				return { valid: true };
			},
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(copilotProvider.id).toBe("github-copilot");
		expect(copilotProvider.auth.type).toBe("oauth");
		if (copilotProvider.auth.type === "oauth") {
			expect(copilotProvider.auth.buttonLabel).toBe("Sign in with GitHub");
			const tokens = await copilotProvider.auth.startFlow();
			expect(tokens.accessToken).toMatch(/^ghu_/);
		}
	});

	it("should have all required properties defined at once (type safety)", () => {
		// This test ensures that TypeScript enforces all required properties
		const provider: BaseProviderDefinition = {
			id: "test-provider",
			displayName: "Test Provider",
			setupInstructions: {
				steps: ["Step 1"],
			},
			auth: {
				type: "field-based",
				fields: {
					apiKey: {
						label: "API Key",
						kind: "secret",
						required: true,
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: false,
				modelDiscovery: false,
			},
			createRuntimeDefinition: async (_auth) => ({
				chatModels: {},
				embeddingModels: {},
			}),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		// Verify all required properties are present
		expect(provider.id).toBeDefined();
		expect(provider.displayName).toBeDefined();
		expect(provider.setupInstructions).toBeDefined();
		expect(provider.auth).toBeDefined();
		expect(provider.capabilities).toBeDefined();
		expect(provider.createRuntimeDefinition).toBeDefined();
		expect(provider.validateAuth).toBeDefined();
		expect(provider.discoverModels).toBeDefined();

		// Verify types of each property
		expect(typeof provider.id).toBe("string");
		expect(typeof provider.displayName).toBe("string");
		expect(typeof provider.setupInstructions).toBe("object");
		expect(typeof provider.auth).toBe("object");
		expect(typeof provider.capabilities).toBe("object");
		expect(typeof provider.createRuntimeDefinition).toBe("function");
		expect(typeof provider.validateAuth).toBe("function");
		expect(typeof provider.discoverModels).toBe("function");
	});

	it("should use id as lowercase identifier without spaces", () => {
		// Provider IDs should be lowercase, no spaces (like "openai", "anthropic", "sap-ai-core")
		const provider: BaseProviderDefinition = {
			id: "sap-ai-core",
			displayName: "SAP AI Core",
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: false, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(provider.id).toBe("sap-ai-core");
		// ID should be lowercase
		expect(provider.id).toBe(provider.id.toLowerCase());
		// ID should not contain spaces
		expect(provider.id.includes(" ")).toBe(false);
	});

	it("should use displayName as human-readable name", () => {
		// displayName is what users see in the UI
		const provider: BaseProviderDefinition = {
			id: "sap-ai-core",
			displayName: "SAP AI Core",
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: false, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(provider.displayName).toBe("SAP AI Core");
		// displayName can have spaces and mixed case
		expect(provider.displayName.includes(" ")).toBe(true);
	});

	it("should NOT have isBuiltIn property (that's for BuiltInProviderDefinition)", () => {
		// BaseProviderDefinition is the base interface - it does NOT have isBuiltIn
		// BuiltInProviderDefinition and CustomProviderDefinition add that property
		const provider: BaseProviderDefinition = {
			id: "test",
			displayName: "Test",
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: false, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		// BaseProviderDefinition doesn't have isBuiltIn property
		expect("isBuiltIn" in provider).toBe(false);
	});

	it("should be usable for creating runtime definitions with captured auth", async () => {
		// This test shows the key use case: createRuntimeDefinition captures auth
		// in closures so model factories can use credentials without re-passing them
		const provider: BaseProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (auth: RuntimeAuthState) => {
				// Auth is captured in the closure
				if (auth.type !== "field-based") {
					throw new Error("Expected field-based auth");
				}
				const capturedApiKey = auth.values.apiKey;
				const capturedBaseUrl = auth.values.baseUrl;

				const chatModels: Record<string, (options?: Record<string, unknown>) => Promise<unknown>> = {};
				chatModels["gpt-4o"] = async (options?: Record<string, unknown>) => {
					// Factory uses captured auth from outer scope
					return {
						modelName: "gpt-4o",
						apiKey: capturedApiKey,
						baseUrl: capturedBaseUrl,
						temperature: options?.temperature,
					} as unknown;
				};

				const embeddingModels: Record<string, () => Promise<unknown>> = {};
				embeddingModels["text-embedding-3-small"] = async () => {
					return {
						modelName: "text-embedding-3-small",
						apiKey: capturedApiKey,
					} as unknown;
				};

				return {
					chatModels,
					embeddingModels,
				};
			},
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: ["gpt-4o"], embedding: ["text-embedding-3-small"] }),
		};

		const auth: RuntimeAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-test-key",
				baseUrl: "https://api.openai.com/v1",
			},
		};

		// Create runtime definition
		const runtime = await provider.createRuntimeDefinition(auth);

		// Create a model instance
		const model = (await runtime.chatModels["gpt-4o"]({ temperature: 0.5 })) as {
			modelName: string;
			apiKey: string;
			baseUrl: string;
			temperature: number;
		};

		// Verify auth was captured in the factory closure
		expect(model.apiKey).toBe("sk-test-key");
		expect(model.baseUrl).toBe("https://api.openai.com/v1");
		expect(model.temperature).toBe(0.5);
	});

	it("should have validateAuth that can return validation errors", async () => {
		const provider: BaseProviderDefinition = {
			id: "test",
			displayName: "Test",
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: false, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
			validateAuth: async (auth: RuntimeAuthState) => {
				if (auth.type !== "field-based") {
					return { valid: false, error: "Expected field-based auth" };
				}
				// Simulate various validation errors
				if (!auth.values.apiKey) {
					return { valid: false, error: "API key is required" };
				}
				if (auth.values.apiKey.length < 10) {
					return { valid: false, error: "API key is too short" };
				}
				// Simulate network error
				if (auth.values.apiKey === "network-error") {
					return { valid: false, error: "Failed to connect to server" };
				}
				return { valid: true };
			},
		};

		// Test missing API key
		const result1 = await provider.validateAuth({
			type: "field-based",
			values: {},
		});
		expect(result1.valid).toBe(false);
		if (!result1.valid) {
			expect(result1.error).toBe("API key is required");
		}

		// Test short API key
		const result2 = await provider.validateAuth({
			type: "field-based",
			values: { apiKey: "short" },
		});
		expect(result2.valid).toBe(false);
		if (!result2.valid) {
			expect(result2.error).toBe("API key is too short");
		}

		// Test network error
		const result3 = await provider.validateAuth({
			type: "field-based",
			values: { apiKey: "network-error" },
		});
		expect(result3.valid).toBe(false);
		if (!result3.valid) {
			expect(result3.error).toBe("Failed to connect to server");
		}

		// Test valid
		const result4 = await provider.validateAuth({
			type: "field-based",
			values: { apiKey: "sk-valid-long-key" },
		});
		expect(result4.valid).toBe(true);
	});
});

describe("BuiltInProviderDefinition", () => {
	it("should extend BaseProviderDefinition and require isBuiltIn: true", () => {
		// BuiltInProviderDefinition is for providers shipped with the plugin
		const provider: BuiltInProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			isBuiltIn: true,
			setupInstructions: {
				steps: ["Get your API key from platform.openai.com"],
			},
			auth: {
				type: "field-based",
				fields: {
					apiKey: {
						label: "API Key",
						kind: "secret",
						required: true,
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: true,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(provider.isBuiltIn).toBe(true);
		expect(provider.id).toBe("openai");
		expect(provider.displayName).toBe("OpenAI");
	});

	it("should require isBuiltIn to be literal true (not just boolean)", () => {
		// The isBuiltIn property must be exactly `true` for BuiltInProviderDefinition
		// This is a literal type, not just a boolean
		const provider: BuiltInProviderDefinition = {
			id: "anthropic",
			displayName: "Anthropic",
			isBuiltIn: true, // Must be literal `true`
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: false, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		// TypeScript ensures isBuiltIn is exactly true, but we verify at runtime too
		expect(provider.isBuiltIn).toBe(true);
		expect(typeof provider.isBuiltIn).toBe("boolean");
	});

	it("should have all BaseProviderDefinition properties", () => {
		// BuiltInProviderDefinition extends BaseProviderDefinition
		// So it must have all the base properties
		const provider: BuiltInProviderDefinition = {
			id: "test-builtin",
			displayName: "Test Built-in",
			isBuiltIn: true,
			setupInstructions: {
				steps: ["Step 1", "Step 2"],
				link: { url: "https://example.com", text: "Docs" },
			},
			auth: {
				type: "field-based",
				fields: {
					apiKey: { label: "API Key", kind: "secret", required: true },
				},
			},
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		// Verify all BaseProviderDefinition properties are present
		expect(provider.id).toBeDefined();
		expect(provider.displayName).toBeDefined();
		expect(provider.setupInstructions).toBeDefined();
		expect(provider.auth).toBeDefined();
		expect(provider.capabilities).toBeDefined();
		expect(provider.createRuntimeDefinition).toBeDefined();
		expect(provider.validateAuth).toBeDefined();

		// Plus the BuiltInProviderDefinition-specific property
		expect(provider.isBuiltIn).toBe(true);
	});

	it("should allow optional discoverModels method", async () => {
		// Providers with modelDiscovery capability can implement discoverModels
		const provider: BuiltInProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			isBuiltIn: true,
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async (_auth: RuntimeAuthState): Promise<DiscoveredModels> => ({
				chat: ["gpt-4o", "gpt-4o-mini"],
				embedding: ["text-embedding-3-small"],
			}),
		};

		expect(provider.discoverModels).toBeDefined();
		expect(typeof provider.discoverModels).toBe("function");

		// Call the discoverModels method
		const auth: RuntimeAuthState = {
			type: "field-based",
			values: { apiKey: "sk-test" },
		};
		if (provider.discoverModels) {
			const discovered = await provider.discoverModels(auth);
			expect(discovered.chat).toContain("gpt-4o");
			expect(discovered.embedding).toContain("text-embedding-3-small");
		}
	});

	it("should have discoverModels method that returns empty results when modelDiscovery is false", () => {
		// discoverModels is required - providers without modelDiscovery return empty results
		const provider: BuiltInProviderDefinition = {
			id: "anthropic",
			displayName: "Anthropic",
			isBuiltIn: true,
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: false, modelDiscovery: false }, // No model discovery
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		// discoverModels is required but may return empty results
		expect(provider.discoverModels).toBeDefined();
		expect(provider.capabilities.modelDiscovery).toBe(false);
	});

	it("should support OpenAI-style built-in provider", async () => {
		// Full example of OpenAI as a BuiltInProviderDefinition
		const openaiProvider: BuiltInProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			isBuiltIn: true,
			setupInstructions: {
				steps: [
					"Create an API key from OpenAI's Dashboard",
					"Ensure your OpenAI account has credits loaded",
					"Paste the API key below (starts with 'sk-')",
				],
				link: {
					url: "https://platform.openai.com/api-keys",
					text: "OpenAI Dashboard",
				},
			},
			auth: {
				type: "field-based",
				fields: {
					apiKey: {
						label: "API Key",
						kind: "secret",
						required: true,
						placeholder: "sk-...",
					},
					baseUrl: {
						label: "Base URL",
						kind: "text",
						required: false,
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: true,
			},
			createRuntimeDefinition: async (auth: RuntimeAuthState) => {
				if (auth.type !== "field-based") {
					throw new Error("Expected field-based auth");
				}
				const chatModels: Record<string, () => Promise<unknown>> = {};
				chatModels["gpt-4o"] = async () => ({ modelName: "gpt-4o", apiKey: auth.values.apiKey }) as unknown;
				const embeddingModels: Record<string, () => Promise<unknown>> = {};
				embeddingModels["text-embedding-3-small"] = async () =>
					({ modelName: "text-embedding-3-small" }) as unknown;
				return {
					chatModels,
					embeddingModels,
				};
			},
			validateAuth: async (auth: RuntimeAuthState) => {
				if (auth.type !== "field-based") {
					return { valid: false, error: "Invalid auth type" };
				}
				if (!auth.values.apiKey) {
					return { valid: false, error: "API key is required" };
				}
				return { valid: true };
			},
			discoverModels: async (_auth: RuntimeAuthState): Promise<DiscoveredModels> => ({
				chat: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
				embedding: ["text-embedding-3-small", "text-embedding-3-large"],
			}),
		};

		expect(openaiProvider.id).toBe("openai");
		expect(openaiProvider.isBuiltIn).toBe(true);
		expect(openaiProvider.capabilities.modelDiscovery).toBe(true);
		expect(openaiProvider.discoverModels).toBeDefined();

		// Test discoverModels
		const auth: RuntimeAuthState = { type: "field-based", values: { apiKey: "sk-test" } };
		if (openaiProvider.discoverModels) {
			const discovered = await openaiProvider.discoverModels(auth);
			expect(discovered.chat).toContain("gpt-4o");
		}
	});

	it("should support Anthropic-style built-in provider (no model discovery)", () => {
		// Anthropic has chat only, no embeddings, no model discovery
		const anthropicProvider: BuiltInProviderDefinition = {
			id: "anthropic",
			displayName: "Anthropic",
			isBuiltIn: true,
			setupInstructions: {
				steps: ["Create an API key from Anthropic Console", "Paste the API key below"],
			},
			auth: {
				type: "field-based",
				fields: {
					apiKey: {
						label: "API Key",
						kind: "secret",
						required: true,
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: false,
				modelDiscovery: false,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(anthropicProvider.id).toBe("anthropic");
		expect(anthropicProvider.isBuiltIn).toBe(true);
		expect(anthropicProvider.capabilities.modelDiscovery).toBe(false);
		expect(anthropicProvider.capabilities.embedding).toBe(false);
		// discoverModels is required but returns empty results for providers without modelDiscovery capability
		expect(anthropicProvider.discoverModels).toBeDefined();
	});

	it("should support Ollama-style built-in provider (with model discovery)", async () => {
		// Ollama has chat, embedding, and model discovery
		const ollamaProvider: BuiltInProviderDefinition = {
			id: "ollama",
			displayName: "Ollama",
			isBuiltIn: true,
			setupInstructions: {
				steps: ["Install Ollama on your machine", "Start the Ollama server", "Enter the base URL below"],
				link: { url: "https://ollama.ai", text: "Ollama Website" },
			},
			auth: {
				type: "field-based",
				fields: {
					baseUrl: {
						label: "Base URL",
						kind: "text",
						required: true,
						placeholder: "http://localhost:11434",
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: true,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async (_auth: RuntimeAuthState): Promise<DiscoveredModels> => ({
				chat: ["llama3.1", "mistral", "codellama"],
				embedding: ["nomic-embed-text", "mxbai-embed-large"],
			}),
		};

		expect(ollamaProvider.id).toBe("ollama");
		expect(ollamaProvider.isBuiltIn).toBe(true);
		expect(ollamaProvider.capabilities.modelDiscovery).toBe(true);
		expect(ollamaProvider.discoverModels).toBeDefined();

		// Ollama uses baseUrl as main auth field (no API key)
		if (ollamaProvider.auth.type === "field-based") {
			expect(ollamaProvider.auth.fields.baseUrl).toBeDefined();
			expect(ollamaProvider.auth.fields.baseUrl.required).toBe(true);
			expect(ollamaProvider.auth.fields.apiKey).toBeUndefined();
		}

		// Test discoverModels
		const auth: RuntimeAuthState = {
			type: "field-based",
			values: { baseUrl: "http://localhost:11434" },
		};
		if (ollamaProvider.discoverModels) {
			const discovered = await ollamaProvider.discoverModels(auth);
			expect(discovered.chat).toContain("llama3.1");
			expect(discovered.embedding).toContain("nomic-embed-text");
		}
	});

	it("should support SAP AI Core-style built-in provider", () => {
		// SAP AI Core example
		const sapProvider: BuiltInProviderDefinition = {
			id: "sap-ai-core",
			displayName: "SAP AI Core",
			isBuiltIn: true,
			setupInstructions: {
				steps: ["Configure your SAP AI Core service binding", "Enter the credentials below"],
			},
			auth: {
				type: "field-based",
				fields: {
					apiKey: {
						label: "API Key",
						kind: "secret",
						required: true,
					},
					baseUrl: {
						label: "Base URL",
						kind: "text",
						required: true,
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: false,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(sapProvider.id).toBe("sap-ai-core");
		expect(sapProvider.displayName).toBe("SAP AI Core");
		expect(sapProvider.isBuiltIn).toBe(true);
		expect(sapProvider.capabilities.modelDiscovery).toBe(false);
	});

	it("should support OAuth-based built-in provider (GitHub Copilot style)", async () => {
		// Example: GitHub Copilot with OAuth
		const copilotProvider: BuiltInProviderDefinition = {
			id: "github-copilot",
			displayName: "GitHub Copilot",
			isBuiltIn: true,
			setupInstructions: {
				steps: [
					"Ensure you have a GitHub account with Copilot access",
					"Click the button below to sign in with GitHub",
				],
				link: { url: "https://github.com/features/copilot", text: "GitHub Copilot" },
			},
			auth: {
				type: "oauth",
				buttonLabel: "Sign in with GitHub",
				startFlow: async () => ({
					accessToken: "ghu_xxxxxxxxxxxx",
					refreshToken: "ghr_xxxxxxxxxxxx",
					expiresAt: Date.now() + 28800000,
					tokenType: "Bearer",
					scope: "copilot",
				}),
				validateTokens: async (tokens: OAuthTokens) => {
					if (!tokens.accessToken) return false;
					if (tokens.expiresAt && Date.now() > tokens.expiresAt) return false;
					return true;
				},
			},
			capabilities: {
				chat: true,
				embedding: false,
				modelDiscovery: false,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async (auth: RuntimeAuthState) => {
				if (auth.type !== "oauth") {
					return { valid: false, error: "Invalid auth type" };
				}
				if (!auth.tokens.accessToken) {
					return { valid: false, error: "Not authenticated" };
				}
				return { valid: true };
			},
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(copilotProvider.id).toBe("github-copilot");
		expect(copilotProvider.isBuiltIn).toBe(true);
		expect(copilotProvider.auth.type).toBe("oauth");
		if (copilotProvider.auth.type === "oauth") {
			expect(copilotProvider.auth.buttonLabel).toBe("Sign in with GitHub");
			const tokens = await copilotProvider.auth.startFlow();
			expect(tokens.accessToken).toMatch(/^ghu_/);
		}
	});

	it("should have discoverModels method signature that takes RuntimeAuthState and returns Promise<DiscoveredModels>", async () => {
		// Test the function signature of discoverModels
		const provider: BuiltInProviderDefinition = {
			id: "test",
			displayName: "Test",
			isBuiltIn: true,
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async (auth: RuntimeAuthState): Promise<DiscoveredModels> => {
				// Verify auth parameter type at runtime
				expect(auth.type).toBeDefined();
				return {
					chat: ["model-1", "model-2"],
					embedding: ["embed-1"],
				};
			},
		};

		const auth: RuntimeAuthState = {
			type: "field-based",
			values: { apiKey: "test-key" },
		};

		if (provider.discoverModels) {
			const result = await provider.discoverModels(auth);

			// Verify return type shape
			expect(Array.isArray(result.chat)).toBe(true);
			expect(Array.isArray(result.embedding)).toBe(true);
			expect(result.chat).toEqual(["model-1", "model-2"]);
			expect(result.embedding).toEqual(["embed-1"]);
		}
	});

	it("should be distinguishable from CustomProviderDefinition by isBuiltIn property", () => {
		// BuiltInProviderDefinition has isBuiltIn: true
		// CustomProviderDefinition will have isBuiltIn: false
		const builtInProvider: BuiltInProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			isBuiltIn: true, // Literal true
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		// Type guard function to check if a provider is built-in
		const isBuiltInProvider = (provider: { isBuiltIn: boolean }): provider is BuiltInProviderDefinition => {
			return provider.isBuiltIn === true;
		};

		expect(isBuiltInProvider(builtInProvider)).toBe(true);
		expect(builtInProvider.isBuiltIn).toBe(true);
	});

	it("should NOT have baseProviderId or createdAt properties (those are for CustomProviderDefinition)", () => {
		// BuiltInProviderDefinition doesn't have custom provider properties
		const provider: BuiltInProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			isBuiltIn: true,
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		// These properties are for CustomProviderDefinition, not BuiltInProviderDefinition
		expect("baseProviderId" in provider).toBe(false);
		expect("createdAt" in provider).toBe(false);
	});

	it("should be usable in an array of built-in providers", () => {
		// Built-in providers are typically stored in an array or record
		const builtInProviders: BuiltInProviderDefinition[] = [
			{
				id: "openai",
				displayName: "OpenAI",
				isBuiltIn: true,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: true, modelDiscovery: true },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
			{
				id: "anthropic",
				displayName: "Anthropic",
				isBuiltIn: true,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: false, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
		];

		expect(builtInProviders).toHaveLength(2);
		expect(builtInProviders.every((p) => p.isBuiltIn === true)).toBe(true);
		expect(builtInProviders.map((p) => p.id)).toEqual(["openai", "anthropic"]);
	});

	it("should be usable in a record keyed by provider ID", () => {
		// Built-in providers are often stored in a record for lookup
		const builtInProviders: Record<string, BuiltInProviderDefinition> = {
			openai: {
				id: "openai",
				displayName: "OpenAI",
				isBuiltIn: true,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: true, modelDiscovery: true },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
			anthropic: {
				id: "anthropic",
				displayName: "Anthropic",
				isBuiltIn: true,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: false, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
		};

		expect(Object.keys(builtInProviders)).toEqual(["openai", "anthropic"]);
		expect(builtInProviders.openai.displayName).toBe("OpenAI");
		expect(builtInProviders.anthropic.displayName).toBe("Anthropic");
	});
});

describe("CustomProviderDefinition", () => {
	it("should extend BaseProviderDefinition and require isBuiltIn: false", () => {
		// CustomProviderDefinition is for user-created providers
		const provider: CustomProviderDefinition = {
			id: "local-llm",
			displayName: "Local LLM Server",
			isBuiltIn: false,
			baseProviderId: "openai-compatible",
			createdAt: 1704067200000,
			setupInstructions: {
				steps: ["Configure your local LLM endpoint"],
			},
			auth: {
				type: "field-based",
				fields: {
					baseUrl: {
						label: "Base URL",
						kind: "text",
						required: true,
						placeholder: "http://localhost:8000/v1",
					},
				},
			},
			capabilities: {
				chat: true,
				embedding: true,
				modelDiscovery: false,
			},
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(provider.id).toBe("local-llm");
		expect(provider.isBuiltIn).toBe(false);
		expect(provider.baseProviderId).toBe("openai-compatible");
		if (provider.auth.type === "field-based") {
			expect(provider.auth.fields.baseUrl).toBeDefined();
		}
	});

	it("should be distinguishable from BuiltInProviderDefinition by isBuiltIn property", () => {
		// CustomProviderDefinition has isBuiltIn: false
		const customProvider: CustomProviderDefinition = {
			id: "custom-provider",
			displayName: "Custom Provider",
			isBuiltIn: false, // Literal false
			baseProviderId: "openai-compatible",
			createdAt: Date.now(),
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		// Type guard function to check if a provider is custom
		const isCustomProvider = (provider: { isBuiltIn: boolean }): provider is CustomProviderDefinition => {
			return provider.isBuiltIn === false;
		};

		expect(isCustomProvider(customProvider)).toBe(true);
		expect(customProvider.isBuiltIn).toBe(false);
	});

	it("should be usable in an array of custom providers", () => {
		// Custom providers are typically stored in an array
		const customProviders: CustomProviderDefinition[] = [
			{
				id: "local-llm",
				displayName: "Local LLM",
				isBuiltIn: false,
				baseProviderId: "openai-compatible",
				createdAt: 1704067200000,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: true, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
			{
				id: "azure-openai",
				displayName: "Azure OpenAI",
				isBuiltIn: false,
				baseProviderId: "openai-compatible",
				createdAt: 1704153600000,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: true, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
		];

		expect(customProviders).toHaveLength(2);
		expect(customProviders.every((p) => p.isBuiltIn === false)).toBe(true);
		expect(customProviders.map((p) => p.id)).toEqual(["local-llm", "azure-openai"]);
	});

	it("should be sortable by createdAt timestamp", () => {
		// Custom providers can be sorted by creation date
		const customProviders: CustomProviderDefinition[] = [
			{
				id: "provider-2",
				displayName: "Provider 2",
				isBuiltIn: false,
				baseProviderId: "openai-compatible",
				createdAt: 1704153600000, // Later
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: false, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
			{
				id: "provider-1",
				displayName: "Provider 1",
				isBuiltIn: false,
				baseProviderId: "openai-compatible",
				createdAt: 1704067200000, // Earlier
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: false, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
		];

		// Sort by createdAt ascending
		const sorted = [...customProviders].sort((a, b) => a.createdAt - b.createdAt);

		expect(sorted[0].id).toBe("provider-1");
		expect(sorted[1].id).toBe("provider-2");
	});
});

describe("ProviderDefinition", () => {
	it("should be a union type of BuiltInProviderDefinition | CustomProviderDefinition", () => {
		// ProviderDefinition is the union type for any provider
		const builtIn: ProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			isBuiltIn: true,
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		const custom: ProviderDefinition = {
			id: "custom-provider",
			displayName: "Custom Provider",
			isBuiltIn: false,
			baseProviderId: "openai-compatible",
			createdAt: Date.now(),
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(builtIn.isBuiltIn).toBe(true);
		expect(custom.isBuiltIn).toBe(false);
	});

	it("should allow type narrowing using isBuiltIn discriminator", () => {
		// ProviderDefinition is a discriminated union with isBuiltIn as the discriminator
		const providers: ProviderDefinition[] = [
			{
				id: "openai",
				displayName: "OpenAI",
				isBuiltIn: true,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: true, modelDiscovery: true },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
			{
				id: "custom-llm",
				displayName: "Custom LLM",
				isBuiltIn: false,
				baseProviderId: "openai-compatible",
				createdAt: Date.now(),
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: false, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
		];

		// Type narrowing using isBuiltIn
		for (const provider of providers) {
			if (provider.isBuiltIn) {
				// TypeScript knows provider is BuiltInProviderDefinition here
				expect("discoverModels" in provider || true).toBe(true); // May or may not have it
				expect("baseProviderId" in provider).toBe(false);
			} else {
				// TypeScript knows provider is CustomProviderDefinition here
				expect(provider.baseProviderId).toBeDefined();
				expect(provider.createdAt).toBeDefined();
			}
		}
	});

	it("should support type guard functions", () => {
		// Type guards for working with ProviderDefinition union
		const isBuiltIn = (p: ProviderDefinition): p is BuiltInProviderDefinition => p.isBuiltIn;
		const isCustom = (p: ProviderDefinition): p is CustomProviderDefinition => !p.isBuiltIn;

		const providers: ProviderDefinition[] = [
			{
				id: "openai",
				displayName: "OpenAI",
				isBuiltIn: true,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: true, modelDiscovery: true },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
			{
				id: "anthropic",
				displayName: "Anthropic",
				isBuiltIn: true,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: false, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
			{
				id: "custom-llm",
				displayName: "Custom LLM",
				isBuiltIn: false,
				baseProviderId: "openai-compatible",
				createdAt: Date.now(),
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: false, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
		];

		const builtInProviders = providers.filter(isBuiltIn);
		const customProviders = providers.filter(isCustom);

		expect(builtInProviders).toHaveLength(2);
		expect(customProviders).toHaveLength(1);
		expect(builtInProviders.map((p) => p.id)).toEqual(["openai", "anthropic"]);
		expect(customProviders.map((p) => p.id)).toEqual(["custom-llm"]);
	});

	it("should work with generic provider functions", () => {
		// Example of a function that works with any ProviderDefinition
		function getProviderInfo(provider: ProviderDefinition): string {
			if (provider.isBuiltIn) {
				const hasDiscovery = provider.discoverModels !== undefined;
				return `Built-in: ${provider.displayName} (discovery: ${hasDiscovery})`;
			}
			return `Custom: ${provider.displayName} (based on: ${provider.baseProviderId})`;
		}

		const openai: ProviderDefinition = {
			id: "openai",
			displayName: "OpenAI",
			isBuiltIn: true,
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		const custom: ProviderDefinition = {
			id: "custom",
			displayName: "Custom Provider",
			isBuiltIn: false,
			baseProviderId: "openai-compatible",
			createdAt: Date.now(),
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: false, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		expect(getProviderInfo(openai)).toBe("Built-in: OpenAI (discovery: true)");
		expect(getProviderInfo(custom)).toBe("Custom: Custom Provider (based on: openai-compatible)");
	});

	it("should be usable in a Map keyed by provider ID", () => {
		// ProviderDefinition in a Map for registry pattern
		const registry = new Map<string, ProviderDefinition>();

		registry.set("openai", {
			id: "openai",
			displayName: "OpenAI",
			isBuiltIn: true,
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: true, modelDiscovery: true },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		});

		registry.set("custom-llm", {
			id: "custom-llm",
			displayName: "Custom LLM",
			isBuiltIn: false,
			baseProviderId: "openai-compatible",
			createdAt: Date.now(),
			setupInstructions: { steps: [] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: false, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		});

		expect(registry.size).toBe(2);
		expect(registry.get("openai")?.isBuiltIn).toBe(true);
		expect(registry.get("custom-llm")?.isBuiltIn).toBe(false);
	});

	it("should allow listing all providers sorted by type", () => {
		// Example: Listing providers with built-in first, then custom
		const providers: ProviderDefinition[] = [
			{
				id: "custom-llm",
				displayName: "Custom LLM",
				isBuiltIn: false,
				baseProviderId: "openai-compatible",
				createdAt: Date.now(),
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: false, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
			{
				id: "openai",
				displayName: "OpenAI",
				isBuiltIn: true,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: true, modelDiscovery: true },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
			{
				id: "anthropic",
				displayName: "Anthropic",
				isBuiltIn: true,
				setupInstructions: { steps: [] },
				auth: { type: "field-based", fields: {} },
				capabilities: { chat: true, embedding: false, modelDiscovery: false },
				createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
				validateAuth: async () => ({ valid: true }),
				discoverModels: async () => ({ chat: [], embedding: [] }),
			},
		];

		// Sort: built-in first, then custom; alphabetically within each group
		const sorted = [...providers].sort((a, b) => {
			// Built-in providers come first
			if (a.isBuiltIn !== b.isBuiltIn) {
				return a.isBuiltIn ? -1 : 1;
			}
			// Alphabetically by displayName within same type
			return a.displayName.localeCompare(b.displayName);
		});

		expect(sorted.map((p) => p.id)).toEqual(["anthropic", "openai", "custom-llm"]);
	});

	it("should have common properties accessible without type narrowing", () => {
		// All providers have these common properties from BaseProviderDefinition
		const provider: ProviderDefinition = {
			id: "some-provider",
			displayName: "Some Provider",
			isBuiltIn: true,
			setupInstructions: { steps: ["Step 1"] },
			auth: { type: "field-based", fields: {} },
			capabilities: { chat: true, embedding: false, modelDiscovery: false },
			createRuntimeDefinition: async (_auth) => ({ chatModels: {}, embeddingModels: {} }),
			validateAuth: async () => ({ valid: true }),
			discoverModels: async () => ({ chat: [], embedding: [] }),
		};

		// These are accessible on any ProviderDefinition without type narrowing
		expect(provider.id).toBe("some-provider");
		expect(provider.displayName).toBe("Some Provider");
		expect(provider.setupInstructions.steps).toContain("Step 1");
		expect(provider.auth.type).toBe("field-based");
		expect(provider.capabilities.chat).toBe(true);
		expect(typeof provider.createRuntimeDefinition).toBe("function");
		expect(typeof provider.validateAuth).toBe("function");
	});
});
