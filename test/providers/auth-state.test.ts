/**
 * Tests for authentication state types:
 * - AuthValidationResult: Discriminated union for validation results (valid/invalid)
 * - StoredAuthState: Auth state as stored in data.json (with secret references)
 * - RuntimeAuthState: Auth state at runtime (with secrets resolved)
 */
import { describe, expect, it } from "vitest";
import type {
	AuthValidationResult,
	OAuthTokens,
	RuntimeAuthState,
	StoredAuthState,
} from "../../src/providers/types.ts";

describe("AuthValidationResult", () => {
	it("should allow valid result with valid: true", () => {
		const result: AuthValidationResult = {
			valid: true,
		};

		expect(result.valid).toBe(true);
	});

	it("should allow invalid result with valid: false and error message", () => {
		const result: AuthValidationResult = {
			valid: false,
			error: "API key is invalid",
		};

		expect(result.valid).toBe(false);
		expect(result.error).toBe("API key is invalid");
	});

	it("should use valid property as discriminator for type narrowing", () => {
		// Test valid result narrowing
		const successResult: AuthValidationResult = { valid: true };
		const errorResult: AuthValidationResult = { valid: false, error: "Connection failed" };

		// Type narrowing based on 'valid' discriminator
		if (successResult.valid) {
			// TypeScript should know this is { valid: true }
			expect(successResult.valid).toBe(true);
			// @ts-expect-error - error property should not exist on valid result
			expect(successResult.error).toBeUndefined();
		}

		if (!errorResult.valid) {
			// TypeScript should know this is { valid: false; error: string }
			expect(errorResult.valid).toBe(false);
			expect(errorResult.error).toBe("Connection failed");
		}
	});

	it("should support different error message types", () => {
		// Missing API key
		const missingKeyResult: AuthValidationResult = {
			valid: false,
			error: "API key is required",
		};

		// Invalid API key format
		const invalidFormatResult: AuthValidationResult = {
			valid: false,
			error: "API key must start with 'sk-'",
		};

		// Connection error
		const connectionErrorResult: AuthValidationResult = {
			valid: false,
			error: "Failed to connect to server at http://localhost:11434",
		};

		// Authentication failure
		const authFailureResult: AuthValidationResult = {
			valid: false,
			error: "Authentication failed: Invalid credentials",
		};

		expect(missingKeyResult.error).toBe("API key is required");
		expect(invalidFormatResult.error).toBe("API key must start with 'sk-'");
		expect(connectionErrorResult.error).toContain("localhost:11434");
		expect(authFailureResult.error).toContain("Invalid credentials");
	});

	it("should be returned by provider validateAuth methods", () => {
		// Example: Mock validateAuth function
		const validateAuth = (apiKey: string | undefined): AuthValidationResult => {
			if (!apiKey) {
				return { valid: false, error: "API key is required" };
			}
			if (!apiKey.startsWith("sk-")) {
				return { valid: false, error: "API key must start with 'sk-'" };
			}
			return { valid: true };
		};

		// Test with missing key
		const missingResult = validateAuth(undefined);
		expect(missingResult.valid).toBe(false);
		if (!missingResult.valid) {
			expect(missingResult.error).toBe("API key is required");
		}

		// Test with invalid key
		const invalidResult = validateAuth("invalid-key");
		expect(invalidResult.valid).toBe(false);
		if (!invalidResult.valid) {
			expect(invalidResult.error).toBe("API key must start with 'sk-'");
		}

		// Test with valid key
		const validResult = validateAuth("sk-valid-key");
		expect(validResult.valid).toBe(true);
	});

	it("should support OpenAI-style validation results", () => {
		// Example: OpenAI provider validation results
		const validateOpenAIAuth = (apiKey: string | undefined): AuthValidationResult => {
			if (!apiKey) {
				return { valid: false, error: "API key is required" };
			}
			// OpenAI keys typically start with 'sk-'
			if (!apiKey.startsWith("sk-")) {
				return { valid: false, error: "Invalid API key format (should start with 'sk-')" };
			}
			return { valid: true };
		};

		const validResult = validateOpenAIAuth("sk-proj-xxxxxxxxxxxx");
		expect(validResult.valid).toBe(true);

		const invalidResult = validateOpenAIAuth("ghu_xxxxxxxxxxxx");
		expect(invalidResult.valid).toBe(false);
		if (!invalidResult.valid) {
			expect(invalidResult.error).toContain("sk-");
		}
	});

	it("should support Ollama-style validation results (connection check)", () => {
		// Example: Ollama provider validation results (checks connection, not API key)
		const validateOllamaConnection = (baseUrl: string | undefined): AuthValidationResult => {
			if (!baseUrl) {
				return { valid: false, error: "Base URL is required" };
			}
			// URL format validation
			try {
				new URL(baseUrl);
			} catch {
				return { valid: false, error: `Invalid URL format: ${baseUrl}` };
			}
			// In real code, this would check if Ollama server is reachable
			return { valid: true };
		};

		const validResult = validateOllamaConnection("http://localhost:11434");
		expect(validResult.valid).toBe(true);

		const missingResult = validateOllamaConnection(undefined);
		expect(missingResult.valid).toBe(false);
		if (!missingResult.valid) {
			expect(missingResult.error).toBe("Base URL is required");
		}

		const invalidResult = validateOllamaConnection("not-a-url");
		expect(invalidResult.valid).toBe(false);
		if (!invalidResult.valid) {
			expect(invalidResult.error).toContain("Invalid URL format");
		}
	});

	it("should be a discriminated union type", () => {
		// This test documents that AuthValidationResult is a discriminated union
		// where 'valid' is the discriminator
		const results: AuthValidationResult[] = [
			{ valid: true },
			{ valid: false, error: "Error 1" },
			{ valid: false, error: "Error 2" },
		];

		// Count valid vs invalid results
		const validCount = results.filter((r) => r.valid).length;
		const invalidCount = results.filter((r) => !r.valid).length;

		expect(validCount).toBe(1);
		expect(invalidCount).toBe(2);

		// All invalid results should have error messages
		for (const result of results) {
			if (!result.valid) {
				expect(typeof result.error).toBe("string");
				expect(result.error.length).toBeGreaterThan(0);
			}
		}
	});

	it("should not allow error property on valid result", () => {
		// This test documents that valid results do not have an error property
		const validResult: AuthValidationResult = { valid: true };

		expect(validResult.valid).toBe(true);
		// The 'error' property should not exist on a valid result
		expect("error" in validResult).toBe(false);
	});

	it("should require error property on invalid result", () => {
		// This test documents that invalid results must have an error property
		const invalidResult: AuthValidationResult = {
			valid: false,
			error: "Something went wrong",
		};

		expect(invalidResult.valid).toBe(false);
		expect("error" in invalidResult).toBe(true);
		expect(invalidResult.error).toBe("Something went wrong");
	});
});

describe("StoredAuthState", () => {
	it("should have type 'field-based' discriminator for field-based auth state", () => {
		const state: StoredAuthState = {
			type: "field-based",
			values: { baseUrl: "https://api.openai.com/v1" },
			secretIds: { apiKey: "openai-api-key-abc123" },
		};

		expect(state.type).toBe("field-based");
	});

	it("should have values as Record<string, string> for field-based auth", () => {
		const state: StoredAuthState = {
			type: "field-based",
			values: {
				baseUrl: "https://api.openai.com/v1",
				headers: '{"X-Custom": "value"}',
			},
			secretIds: { apiKey: "openai-api-key-abc123" },
		};

		expect(state.type).toBe("field-based");
		if (state.type === "field-based") {
			expect(state.values.baseUrl).toBe("https://api.openai.com/v1");
			expect(state.values.headers).toBe('{"X-Custom": "value"}');
			expect(typeof state.values).toBe("object");
		}
	});

	it("should have secretIds as Record<string, string> for field-based auth", () => {
		const state: StoredAuthState = {
			type: "field-based",
			values: { baseUrl: "" },
			secretIds: {
				apiKey: "openai-api-key-abc123",
				refreshToken: "openai-refresh-token-xyz",
			},
		};

		expect(state.type).toBe("field-based");
		if (state.type === "field-based") {
			expect(state.secretIds.apiKey).toBe("openai-api-key-abc123");
			expect(state.secretIds.refreshToken).toBe("openai-refresh-token-xyz");
			expect(typeof state.secretIds).toBe("object");
		}
	});

	it("should allow empty values and secretIds objects for field-based auth", () => {
		const state: StoredAuthState = {
			type: "field-based",
			values: {},
			secretIds: {},
		};

		expect(state.type).toBe("field-based");
		if (state.type === "field-based") {
			expect(Object.keys(state.values)).toHaveLength(0);
			expect(Object.keys(state.secretIds)).toHaveLength(0);
		}
	});

	it("should have type 'oauth' discriminator for OAuth auth state", () => {
		const state: StoredAuthState = {
			type: "oauth",
			tokens: { accessToken: "ghu_xxxxxxxxxxxx" },
		};

		expect(state.type).toBe("oauth");
	});

	it("should have tokens as OAuthTokens for OAuth auth state", () => {
		const state: StoredAuthState = {
			type: "oauth",
			tokens: {
				accessToken: "ghu_xxxxxxxxxxxx",
				refreshToken: "ghr_xxxxxxxxxxxx",
				expiresAt: 1737590400000,
				tokenType: "Bearer",
				scope: "copilot",
			},
		};

		expect(state.type).toBe("oauth");
		if (state.type === "oauth") {
			expect(state.tokens.accessToken).toBe("ghu_xxxxxxxxxxxx");
			expect(state.tokens.refreshToken).toBe("ghr_xxxxxxxxxxxx");
			expect(state.tokens.expiresAt).toBe(1737590400000);
			expect(state.tokens.tokenType).toBe("Bearer");
			expect(state.tokens.scope).toBe("copilot");
		}
	});

	it("should support type narrowing based on discriminator", () => {
		// Test type narrowing with field-based auth
		const fieldBasedState: StoredAuthState = {
			type: "field-based",
			values: { baseUrl: "http://localhost:11434" },
			secretIds: {},
		};

		// Test type narrowing with OAuth auth
		const oauthState: StoredAuthState = {
			type: "oauth",
			tokens: { accessToken: "token123" },
		};

		// Type narrowing should work for field-based
		if (fieldBasedState.type === "field-based") {
			// TypeScript should know this has values and secretIds
			expect("values" in fieldBasedState).toBe(true);
			expect("secretIds" in fieldBasedState).toBe(true);
			expect("tokens" in fieldBasedState).toBe(false);
		}

		// Type narrowing should work for OAuth
		if (oauthState.type === "oauth") {
			// TypeScript should know this has tokens
			expect("tokens" in oauthState).toBe(true);
			expect("values" in oauthState).toBe(false);
			expect("secretIds" in oauthState).toBe(false);
		}
	});

	it("should support OpenAI-style stored auth state", () => {
		// Example: OpenAI stored auth with API key as secret reference
		const openaiAuthState: StoredAuthState = {
			type: "field-based",
			values: {
				baseUrl: "",
				headers: "",
			},
			secretIds: {
				apiKey: "openai-api-key-abc123",
			},
		};

		expect(openaiAuthState.type).toBe("field-based");
		if (openaiAuthState.type === "field-based") {
			expect(openaiAuthState.secretIds.apiKey).toBe("openai-api-key-abc123");
			expect(openaiAuthState.values.baseUrl).toBe("");
		}
	});

	it("should support Ollama-style stored auth state (no secrets)", () => {
		// Example: Ollama stored auth - baseUrl only, no API key needed
		const ollamaAuthState: StoredAuthState = {
			type: "field-based",
			values: {
				baseUrl: "http://localhost:11434",
			},
			secretIds: {},
		};

		expect(ollamaAuthState.type).toBe("field-based");
		if (ollamaAuthState.type === "field-based") {
			expect(ollamaAuthState.values.baseUrl).toBe("http://localhost:11434");
			expect(Object.keys(ollamaAuthState.secretIds)).toHaveLength(0);
		}
	});

	it("should support GitHub Copilot-style stored auth state (OAuth)", () => {
		// Example: GitHub Copilot OAuth stored auth
		const copilotAuthState: StoredAuthState = {
			type: "oauth",
			tokens: {
				accessToken: "ghu_AbCdEfGhIjKlMnOpQrStUvWxYz",
				refreshToken: "ghr_AbCdEfGhIjKlMnOpQrStUvWxYz",
				expiresAt: Date.now() + 28800000,
				tokenType: "Bearer",
				scope: "copilot",
				metadata: {
					provider: "github-copilot",
					username: "octocat",
				},
			},
		};

		expect(copilotAuthState.type).toBe("oauth");
		if (copilotAuthState.type === "oauth") {
			expect(copilotAuthState.tokens.accessToken).toMatch(/^ghu_/);
			expect(copilotAuthState.tokens.scope).toBe("copilot");
			expect(copilotAuthState.tokens.metadata?.provider).toBe("github-copilot");
		}
	});

	it("should be mutually exclusive - field-based has values/secretIds, oauth has tokens", () => {
		// Field-based auth state has values and secretIds, but not tokens
		const fieldBasedState: StoredAuthState = {
			type: "field-based",
			values: { apiUrl: "https://api.example.com" },
			secretIds: { apiKey: "key-ref-123" },
		};

		// OAuth auth state has tokens, but not values or secretIds
		const oauthState: StoredAuthState = {
			type: "oauth",
			tokens: { accessToken: "access_token_value" },
		};

		// Verify field-based structure
		if (fieldBasedState.type === "field-based") {
			expect("values" in fieldBasedState).toBe(true);
			expect("secretIds" in fieldBasedState).toBe(true);
			expect("tokens" in fieldBasedState).toBe(false);
		}

		// Verify OAuth structure
		if (oauthState.type === "oauth") {
			expect("tokens" in oauthState).toBe(true);
			expect("values" in oauthState).toBe(false);
			expect("secretIds" in oauthState).toBe(false);
		}
	});

	it("should be used for storing provider auth in data.json", () => {
		// This test documents that StoredAuthState is used in data.json storage
		// secretIds reference secrets stored in Obsidian's SecretStorage
		const storedConfig = {
			providerId: "openai",
			isConfigured: true,
			auth: {
				type: "field-based",
				values: {
					baseUrl: "https://api.openai.com/v1",
					headers: '{"X-Custom-Header": "value"}',
				},
				secretIds: {
					apiKey: "openai-api-key-uuid-123",
				},
			} as StoredAuthState,
		};

		expect(storedConfig.auth.type).toBe("field-based");
		if (storedConfig.auth.type === "field-based") {
			// The apiKey value is a reference ID, not the actual key
			expect(storedConfig.auth.secretIds.apiKey).toBe("openai-api-key-uuid-123");
			// Non-secret values are stored directly
			expect(storedConfig.auth.values.baseUrl).toBe("https://api.openai.com/v1");
		}
	});

	it("should allow type guard functions for narrowing", () => {
		// Type guard for field-based auth
		const isFieldBasedAuthState = (
			state: StoredAuthState,
		): state is { type: "field-based"; values: Record<string, string>; secretIds: Record<string, string> } => {
			return state.type === "field-based";
		};

		// Type guard for OAuth auth
		const isOAuthAuthState = (state: StoredAuthState): state is { type: "oauth"; tokens: OAuthTokens } => {
			return state.type === "oauth";
		};

		const fieldState: StoredAuthState = {
			type: "field-based",
			values: { url: "https://api.example.com" },
			secretIds: { key: "secret-ref" },
		};

		const oauthState: StoredAuthState = {
			type: "oauth",
			tokens: { accessToken: "token" },
		};

		expect(isFieldBasedAuthState(fieldState)).toBe(true);
		expect(isOAuthAuthState(fieldState)).toBe(false);
		expect(isFieldBasedAuthState(oauthState)).toBe(false);
		expect(isOAuthAuthState(oauthState)).toBe(true);
	});
});

describe("RuntimeAuthState", () => {
	it("should have type 'field-based' discriminator for field-based auth state", () => {
		const state: RuntimeAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-actual-api-key-value",
				baseUrl: "https://api.openai.com/v1",
			},
		};

		expect(state.type).toBe("field-based");
	});

	it("should have values as Record<string, string> for field-based auth (secrets resolved)", () => {
		// RuntimeAuthState has secrets resolved into the values object
		// Unlike StoredAuthState which has secretIds as references
		const state: RuntimeAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-actual-secret-api-key", // The actual secret value, not a reference
				baseUrl: "https://api.openai.com/v1",
				headers: '{"X-Custom": "value"}',
			},
		};

		expect(state.type).toBe("field-based");
		if (state.type === "field-based") {
			// The apiKey is the actual value, not a reference ID
			expect(state.values.apiKey).toBe("sk-actual-secret-api-key");
			expect(state.values.baseUrl).toBe("https://api.openai.com/v1");
			expect(state.values.headers).toBe('{"X-Custom": "value"}');
		}
	});

	it("should NOT have secretIds property (secrets are resolved into values)", () => {
		// Key difference from StoredAuthState: no secretIds, all values resolved
		const state: RuntimeAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-resolved-secret-value",
			},
		};

		expect(state.type).toBe("field-based");
		if (state.type === "field-based") {
			expect("values" in state).toBe(true);
			expect("secretIds" in state).toBe(false);
		}
	});

	it("should allow empty values object for field-based auth", () => {
		const state: RuntimeAuthState = {
			type: "field-based",
			values: {},
		};

		expect(state.type).toBe("field-based");
		if (state.type === "field-based") {
			expect(Object.keys(state.values)).toHaveLength(0);
		}
	});

	it("should have type 'oauth' discriminator for OAuth auth state", () => {
		const state: RuntimeAuthState = {
			type: "oauth",
			tokens: { accessToken: "ghu_xxxxxxxxxxxx" },
		};

		expect(state.type).toBe("oauth");
	});

	it("should have tokens as OAuthTokens for OAuth auth state", () => {
		const state: RuntimeAuthState = {
			type: "oauth",
			tokens: {
				accessToken: "ghu_xxxxxxxxxxxx",
				refreshToken: "ghr_xxxxxxxxxxxx",
				expiresAt: 1737590400000,
				tokenType: "Bearer",
				scope: "copilot",
			},
		};

		expect(state.type).toBe("oauth");
		if (state.type === "oauth") {
			expect(state.tokens.accessToken).toBe("ghu_xxxxxxxxxxxx");
			expect(state.tokens.refreshToken).toBe("ghr_xxxxxxxxxxxx");
			expect(state.tokens.expiresAt).toBe(1737590400000);
			expect(state.tokens.tokenType).toBe("Bearer");
			expect(state.tokens.scope).toBe("copilot");
		}
	});

	it("should support type narrowing based on discriminator", () => {
		// Test type narrowing with field-based auth
		const fieldBasedState: RuntimeAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-resolved-key",
				baseUrl: "http://localhost:11434",
			},
		};

		// Test type narrowing with OAuth auth
		const oauthState: RuntimeAuthState = {
			type: "oauth",
			tokens: { accessToken: "token123" },
		};

		// Type narrowing should work for field-based
		if (fieldBasedState.type === "field-based") {
			// TypeScript should know this has values only (no secretIds)
			expect("values" in fieldBasedState).toBe(true);
			expect("secretIds" in fieldBasedState).toBe(false);
			expect("tokens" in fieldBasedState).toBe(false);
		}

		// Type narrowing should work for OAuth
		if (oauthState.type === "oauth") {
			// TypeScript should know this has tokens
			expect("tokens" in oauthState).toBe(true);
			expect("values" in oauthState).toBe(false);
		}
	});

	it("should support OpenAI-style runtime auth state (API key resolved)", () => {
		// Example: OpenAI runtime auth with API key resolved from SecretStorage
		const openaiRuntimeAuth: RuntimeAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-proj-actual-openai-api-key-value", // Resolved from SecretStorage
				baseUrl: "https://api.openai.com/v1",
				headers: '{"X-Custom-Header": "value"}',
			},
		};

		expect(openaiRuntimeAuth.type).toBe("field-based");
		if (openaiRuntimeAuth.type === "field-based") {
			// The apiKey is the actual value, resolved from storage
			expect(openaiRuntimeAuth.values.apiKey).toMatch(/^sk-/);
			expect(openaiRuntimeAuth.values.baseUrl).toBe("https://api.openai.com/v1");
		}
	});

	it("should support Ollama-style runtime auth state (no secrets to resolve)", () => {
		// Example: Ollama runtime auth - baseUrl only, identical to stored
		const ollamaRuntimeAuth: RuntimeAuthState = {
			type: "field-based",
			values: {
				baseUrl: "http://localhost:11434",
			},
		};

		expect(ollamaRuntimeAuth.type).toBe("field-based");
		if (ollamaRuntimeAuth.type === "field-based") {
			expect(ollamaRuntimeAuth.values.baseUrl).toBe("http://localhost:11434");
			// No apiKey needed for Ollama
			expect(ollamaRuntimeAuth.values.apiKey).toBeUndefined();
		}
	});

	it("should support GitHub Copilot-style runtime auth state (OAuth)", () => {
		// Example: GitHub Copilot OAuth runtime auth (same as stored for OAuth)
		const copilotRuntimeAuth: RuntimeAuthState = {
			type: "oauth",
			tokens: {
				accessToken: "ghu_AbCdEfGhIjKlMnOpQrStUvWxYz",
				refreshToken: "ghr_AbCdEfGhIjKlMnOpQrStUvWxYz",
				expiresAt: Date.now() + 28800000,
				tokenType: "Bearer",
				scope: "copilot",
				metadata: {
					provider: "github-copilot",
					username: "octocat",
				},
			},
		};

		expect(copilotRuntimeAuth.type).toBe("oauth");
		if (copilotRuntimeAuth.type === "oauth") {
			expect(copilotRuntimeAuth.tokens.accessToken).toMatch(/^ghu_/);
			expect(copilotRuntimeAuth.tokens.scope).toBe("copilot");
			expect(copilotRuntimeAuth.tokens.metadata?.provider).toBe("github-copilot");
		}
	});

	it("should be mutually exclusive - field-based has values only, oauth has tokens", () => {
		// Field-based runtime auth state has values only (secrets resolved)
		const fieldBasedState: RuntimeAuthState = {
			type: "field-based",
			values: {
				apiKey: "resolved-secret-value",
				apiUrl: "https://api.example.com",
			},
		};

		// OAuth auth state has tokens
		const oauthState: RuntimeAuthState = {
			type: "oauth",
			tokens: { accessToken: "access_token_value" },
		};

		// Verify field-based structure
		if (fieldBasedState.type === "field-based") {
			expect("values" in fieldBasedState).toBe(true);
			expect("secretIds" in fieldBasedState).toBe(false);
			expect("tokens" in fieldBasedState).toBe(false);
		}

		// Verify OAuth structure
		if (oauthState.type === "oauth") {
			expect("tokens" in oauthState).toBe(true);
			expect("values" in oauthState).toBe(false);
		}
	});

	it("should be used at runtime after resolving secrets from StoredAuthState", () => {
		// This test documents that RuntimeAuthState is created by resolving
		// secrets from StoredAuthState using SecretStorage

		// StoredAuthState has secret references
		const storedAuth: StoredAuthState = {
			type: "field-based",
			values: {
				baseUrl: "https://api.openai.com/v1",
			},
			secretIds: {
				apiKey: "openai-api-key-uuid-123", // Reference to secret
			},
		};

		// Mock function that resolves StoredAuthState to RuntimeAuthState
		const resolveAuth = (stored: StoredAuthState): RuntimeAuthState => {
			if (stored.type === "oauth") {
				return stored; // OAuth is the same at runtime
			}
			// For field-based, resolve secretIds to actual values
			return {
				type: "field-based",
				values: {
					...stored.values,
					// In real code, this would lookup secrets from SecretStorage
					apiKey: "sk-resolved-actual-api-key-value",
				},
			};
		};

		const runtimeAuth = resolveAuth(storedAuth);

		expect(runtimeAuth.type).toBe("field-based");
		if (runtimeAuth.type === "field-based") {
			// The resolved auth has the actual API key value
			expect(runtimeAuth.values.apiKey).toBe("sk-resolved-actual-api-key-value");
			expect(runtimeAuth.values.baseUrl).toBe("https://api.openai.com/v1");
			// No secretIds in runtime state
			expect("secretIds" in runtimeAuth).toBe(false);
		}
	});

	it("should allow type guard functions for narrowing", () => {
		// Type guard for field-based runtime auth
		const isFieldBasedRuntimeAuth = (
			state: RuntimeAuthState,
		): state is { type: "field-based"; values: Record<string, string> } => {
			return state.type === "field-based";
		};

		// Type guard for OAuth runtime auth
		const isOAuthRuntimeAuth = (state: RuntimeAuthState): state is { type: "oauth"; tokens: OAuthTokens } => {
			return state.type === "oauth";
		};

		const fieldState: RuntimeAuthState = {
			type: "field-based",
			values: { apiKey: "sk-secret", url: "https://api.example.com" },
		};

		const oauthState: RuntimeAuthState = {
			type: "oauth",
			tokens: { accessToken: "token" },
		};

		expect(isFieldBasedRuntimeAuth(fieldState)).toBe(true);
		expect(isOAuthRuntimeAuth(fieldState)).toBe(false);
		expect(isFieldBasedRuntimeAuth(oauthState)).toBe(false);
		expect(isOAuthRuntimeAuth(oauthState)).toBe(true);
	});

	it("should be passed to provider createRuntimeDefinition and validateAuth methods", () => {
		// This test documents that RuntimeAuthState is the input type for
		// runtime provider methods (createRuntimeDefinition, validateAuth)

		// Mock provider methods that accept RuntimeAuthState
		const createChatModel = (auth: RuntimeAuthState) => {
			if (auth.type !== "field-based") {
				throw new Error("Expected field-based auth");
			}
			// Use the resolved apiKey to create the model
			return {
				provider: "openai",
				apiKey: auth.values.apiKey,
				baseUrl: auth.values.baseUrl,
			};
		};

		const runtimeAuth: RuntimeAuthState = {
			type: "field-based",
			values: {
				apiKey: "sk-test-key",
				baseUrl: "https://api.openai.com/v1",
			},
		};

		const model = createChatModel(runtimeAuth);
		expect(model.apiKey).toBe("sk-test-key");
		expect(model.baseUrl).toBe("https://api.openai.com/v1");
	});

	it("should differ from StoredAuthState in structure for field-based auth", () => {
		// StoredAuthState has values + secretIds (secretIds are references)
		const stored: StoredAuthState = {
			type: "field-based",
			values: { baseUrl: "https://api.openai.com/v1" },
			secretIds: { apiKey: "secret-ref-uuid" },
		};

		// RuntimeAuthState has values only (all secrets resolved into values)
		const runtime: RuntimeAuthState = {
			type: "field-based",
			values: {
				baseUrl: "https://api.openai.com/v1",
				apiKey: "sk-actual-secret-value",
			},
		};

		// StoredAuthState has secretIds
		expect("secretIds" in stored).toBe(true);
		// RuntimeAuthState does NOT have secretIds
		expect("secretIds" in runtime).toBe(false);

		// Both have values
		expect("values" in stored).toBe(true);
		expect("values" in runtime).toBe(true);

		// But runtime.values has the resolved secret
		if (stored.type === "field-based" && runtime.type === "field-based") {
			expect(stored.secretIds.apiKey).toBe("secret-ref-uuid"); // Reference
			expect(runtime.values.apiKey).toBe("sk-actual-secret-value"); // Actual value
		}
	});

	it("should have identical structure for OAuth auth (no secrets to resolve)", () => {
		// For OAuth, StoredAuthState and RuntimeAuthState have the same structure
		// because tokens are stored directly, not as references

		const storedOAuth: StoredAuthState = {
			type: "oauth",
			tokens: {
				accessToken: "ghu_token",
				refreshToken: "ghr_token",
			},
		};

		const runtimeOAuth: RuntimeAuthState = {
			type: "oauth",
			tokens: {
				accessToken: "ghu_token",
				refreshToken: "ghr_token",
			},
		};

		// Both have the same structure for OAuth
		expect(storedOAuth.type).toBe("oauth");
		expect(runtimeOAuth.type).toBe("oauth");

		if (storedOAuth.type === "oauth" && runtimeOAuth.type === "oauth") {
			expect(storedOAuth.tokens.accessToken).toBe(runtimeOAuth.tokens.accessToken);
			expect(storedOAuth.tokens.refreshToken).toBe(runtimeOAuth.tokens.refreshToken);
		}
	});
});
