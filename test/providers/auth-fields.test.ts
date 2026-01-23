/**
 * Tests for authentication-related types: AuthFieldDefinition, FieldBasedAuth,
 * OAuthTokens, OAuthAuth, and AuthMethod union type.
 */
import { describe, expect, it } from "vitest";

import type {
	AuthFieldDefinition,
	AuthMethod,
	FieldBasedAuth,
	OAuthAuth,
	OAuthTokens,
} from "../../src/providers/types.ts";

describe("AuthFieldDefinition", () => {
	it("should require label, kind, primary, and required properties", () => {
		const field: AuthFieldDefinition = {
			label: "API Key",
			kind: "secret",
			primary: true,
			required: true,
		};

		expect(field.label).toBe("API Key");
		expect(field.kind).toBe("secret");
		expect(field.primary).toBe(true);
		expect(field.required).toBe(true);
	});

	it("should allow kind to be 'text', 'secret', or 'textarea'", () => {
		const textField: AuthFieldDefinition = {
			label: "Base URL",
			kind: "text",
			primary: false,
			required: false,
		};
		const secretField: AuthFieldDefinition = {
			label: "API Key",
			kind: "secret",
			primary: true,
			required: true,
		};
		const textareaField: AuthFieldDefinition = {
			label: "Custom Headers",
			kind: "textarea",
			primary: false,
			required: false,
		};

		expect(textField.kind).toBe("text");
		expect(secretField.kind).toBe("secret");
		expect(textareaField.kind).toBe("textarea");
	});

	it("should allow optional helper property", () => {
		const fieldWithHelper: AuthFieldDefinition = {
			label: "API Key",
			kind: "secret",
			primary: true,
			required: true,
			helper: "Get your API key from platform.openai.com",
		};

		expect(fieldWithHelper.helper).toBe("Get your API key from platform.openai.com");
	});

	it("should allow optional placeholder property", () => {
		const fieldWithPlaceholder: AuthFieldDefinition = {
			label: "API Key",
			kind: "secret",
			primary: true,
			required: true,
			placeholder: "sk-...",
		};

		expect(fieldWithPlaceholder.placeholder).toBe("sk-...");
	});

	it("should allow optional defaultValue property", () => {
		const fieldWithDefault: AuthFieldDefinition = {
			label: "Base URL",
			kind: "text",
			primary: true,
			required: true,
			defaultValue: "http://localhost:11434",
		};

		expect(fieldWithDefault.defaultValue).toBe("http://localhost:11434");
	});

	it("should work with all optional properties combined", () => {
		const fullField: AuthFieldDefinition = {
			label: "API Key",
			kind: "secret",
			primary: true,
			required: true,
			helper: "Your secret API key",
			placeholder: "sk-...",
			defaultValue: "",
		};

		expect(fullField.label).toBe("API Key");
		expect(fullField.kind).toBe("secret");
		expect(fullField.primary).toBe(true);
		expect(fullField.required).toBe(true);
		expect(fullField.helper).toBe("Your secret API key");
		expect(fullField.placeholder).toBe("sk-...");
		expect(fullField.defaultValue).toBe("");
	});

	it("should allow primary:true with required:false (e.g., OpenAI baseUrl)", () => {
		// A field can be primary (always visible) but not required
		// Example: OpenAI's baseUrl is shown but optional
		const optionalPrimaryField: AuthFieldDefinition = {
			label: "Base URL",
			kind: "text",
			primary: true,
			required: false,
			placeholder: "https://api.openai.com/v1",
			helper: "Leave empty for default OpenAI endpoint",
		};

		expect(optionalPrimaryField.primary).toBe(true);
		expect(optionalPrimaryField.required).toBe(false);
	});
});

describe("FieldBasedAuth", () => {
	it("should have type 'field-based' as discriminator", () => {
		const auth: FieldBasedAuth = {
			type: "field-based",
			fields: {
				apiKey: {
					label: "API Key",
					kind: "secret",
					primary: true,
					required: true,
				},
			},
		};

		expect(auth.type).toBe("field-based");
	});

	it("should have fields as Record<string, AuthFieldDefinition>", () => {
		const auth: FieldBasedAuth = {
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
					required: false,
					defaultValue: "https://api.openai.com/v1",
				},
			},
		};

		expect(Object.keys(auth.fields)).toEqual(["apiKey", "baseUrl"]);
		expect(auth.fields.apiKey.label).toBe("API Key");
		expect(auth.fields.baseUrl.defaultValue).toBe("https://api.openai.com/v1");
	});

	it("should support multiple fields with different kinds", () => {
		const auth: FieldBasedAuth = {
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
					primary: false,
					required: false,
				},
				headers: {
					label: "Custom Headers",
					kind: "textarea",
					primary: false,
					required: false,
					helper: 'JSON format: {"X-Custom": "value"}',
				},
			},
		};

		expect(auth.fields.apiKey.kind).toBe("secret");
		expect(auth.fields.baseUrl.kind).toBe("text");
		expect(auth.fields.headers.kind).toBe("textarea");
	});

	it("should be used for OpenAI-style providers", () => {
		// Example: OpenAI provider auth configuration
		const openaiAuth: FieldBasedAuth = {
			type: "field-based",
			fields: {
				apiKey: {
					label: "API Key",
					kind: "secret",
					primary: true,
					required: true,
					placeholder: "sk-...",
					helper: "Get your API key from platform.openai.com",
				},
				baseUrl: {
					label: "Base URL",
					kind: "text",
					primary: true,
					required: false,
					placeholder: "https://api.openai.com/v1",
					helper: "Leave empty for default OpenAI endpoint",
				},
				headers: {
					label: "Custom Headers",
					kind: "textarea",
					primary: false,
					required: false,
					helper: "Optional JSON headers",
				},
			},
		};

		expect(openaiAuth.type).toBe("field-based");
		expect(openaiAuth.fields.apiKey.primary).toBe(true);
		expect(openaiAuth.fields.apiKey.required).toBe(true);
		expect(openaiAuth.fields.baseUrl.primary).toBe(true);
		expect(openaiAuth.fields.baseUrl.required).toBe(false);
		expect(openaiAuth.fields.headers.primary).toBe(false);
	});

	it("should be used for Ollama-style providers (no API key required)", () => {
		// Example: Ollama provider - baseUrl is primary and required, no API key
		const ollamaAuth: FieldBasedAuth = {
			type: "field-based",
			fields: {
				baseUrl: {
					label: "Base URL",
					kind: "text",
					primary: true,
					required: true,
					defaultValue: "http://localhost:11434",
					helper: "Ollama server URL",
				},
			},
		};

		expect(ollamaAuth.type).toBe("field-based");
		expect(ollamaAuth.fields.baseUrl.primary).toBe(true);
		expect(ollamaAuth.fields.baseUrl.required).toBe(true);
		expect(ollamaAuth.fields.baseUrl.defaultValue).toBe("http://localhost:11434");
		// No apiKey field for Ollama
		expect(ollamaAuth.fields.apiKey).toBeUndefined();
	});
});

describe("OAuthTokens", () => {
	it("should require accessToken property", () => {
		const tokens: OAuthTokens = {
			accessToken: "ghu_xxxxxxxxxxxx",
		};

		expect(tokens.accessToken).toBe("ghu_xxxxxxxxxxxx");
	});

	it("should allow optional refreshToken property", () => {
		const tokens: OAuthTokens = {
			accessToken: "ghu_xxxxxxxxxxxx",
			refreshToken: "ghr_xxxxxxxxxxxx",
		};

		expect(tokens.accessToken).toBe("ghu_xxxxxxxxxxxx");
		expect(tokens.refreshToken).toBe("ghr_xxxxxxxxxxxx");
	});

	it("should allow optional expiresAt property (Unix timestamp)", () => {
		const expirationTime = Date.now() + 3600000; // 1 hour from now
		const tokens: OAuthTokens = {
			accessToken: "ghu_xxxxxxxxxxxx",
			expiresAt: expirationTime,
		};

		expect(tokens.expiresAt).toBe(expirationTime);
	});

	it("should allow optional tokenType property", () => {
		const tokens: OAuthTokens = {
			accessToken: "ghu_xxxxxxxxxxxx",
			tokenType: "Bearer",
		};

		expect(tokens.tokenType).toBe("Bearer");
	});

	it("should allow optional scope property", () => {
		const tokens: OAuthTokens = {
			accessToken: "ghu_xxxxxxxxxxxx",
			scope: "read:user repo",
		};

		expect(tokens.scope).toBe("read:user repo");
	});

	it("should allow optional metadata property for provider-specific data", () => {
		const tokens: OAuthTokens = {
			accessToken: "ghu_xxxxxxxxxxxx",
			metadata: {
				username: "octocat",
				avatarUrl: "https://github.com/images/error/octocat_happy.gif",
				organizationId: 12345,
			},
		};

		expect(tokens.metadata).toBeDefined();
		expect(tokens.metadata?.username).toBe("octocat");
		expect(tokens.metadata?.organizationId).toBe(12345);
	});

	it("should work with all optional properties combined", () => {
		const tokens: OAuthTokens = {
			accessToken: "ghu_xxxxxxxxxxxx",
			refreshToken: "ghr_xxxxxxxxxxxx",
			expiresAt: 1737590400000,
			tokenType: "Bearer",
			scope: "read:user repo",
			metadata: {
				username: "octocat",
			},
		};

		expect(tokens.accessToken).toBe("ghu_xxxxxxxxxxxx");
		expect(tokens.refreshToken).toBe("ghr_xxxxxxxxxxxx");
		expect(tokens.expiresAt).toBe(1737590400000);
		expect(tokens.tokenType).toBe("Bearer");
		expect(tokens.scope).toBe("read:user repo");
		expect(tokens.metadata?.username).toBe("octocat");
	});

	it("should support GitHub Copilot style tokens", () => {
		// Example: GitHub Copilot OAuth tokens
		const copilotTokens: OAuthTokens = {
			accessToken: "ghu_AbCdEfGhIjKlMnOpQrStUvWxYz",
			refreshToken: "ghr_AbCdEfGhIjKlMnOpQrStUvWxYz",
			expiresAt: Date.now() + 28800000, // 8 hours from now
			tokenType: "Bearer",
			scope: "copilot",
			metadata: {
				provider: "github-copilot",
			},
		};

		expect(copilotTokens.accessToken).toMatch(/^ghu_/);
		expect(copilotTokens.refreshToken).toMatch(/^ghr_/);
		expect(copilotTokens.tokenType).toBe("Bearer");
	});

	it("should work without refreshToken (for non-refreshable tokens)", () => {
		// Some OAuth providers don't support refresh tokens
		const tokensWithoutRefresh: OAuthTokens = {
			accessToken: "access_token_value",
			expiresAt: Date.now() + 3600000,
		};

		expect(tokensWithoutRefresh.accessToken).toBe("access_token_value");
		expect(tokensWithoutRefresh.refreshToken).toBeUndefined();
	});
});

describe("OAuthAuth", () => {
	it("should have type 'oauth' as discriminator", () => {
		const auth: OAuthAuth = {
			type: "oauth",
			buttonLabel: "Sign in with GitHub",
			startFlow: async () => ({ accessToken: "token" }),
		};

		expect(auth.type).toBe("oauth");
	});

	it("should require buttonLabel property", () => {
		const auth: OAuthAuth = {
			type: "oauth",
			buttonLabel: "Sign in with Google",
			startFlow: async () => ({ accessToken: "token" }),
		};

		expect(auth.buttonLabel).toBe("Sign in with Google");
	});

	it("should require startFlow function that returns OAuthTokens", async () => {
		const mockTokens: OAuthTokens = {
			accessToken: "ghu_xxxxxxxxxxxx",
			refreshToken: "ghr_xxxxxxxxxxxx",
			expiresAt: Date.now() + 3600000,
			tokenType: "Bearer",
		};

		const auth: OAuthAuth = {
			type: "oauth",
			buttonLabel: "Sign in with GitHub",
			startFlow: async () => mockTokens,
		};

		const tokens = await auth.startFlow();
		expect(tokens.accessToken).toBe("ghu_xxxxxxxxxxxx");
		expect(tokens.refreshToken).toBe("ghr_xxxxxxxxxxxx");
		expect(tokens.tokenType).toBe("Bearer");
	});

	it("should allow optional refreshTokens function", async () => {
		const initialTokens: OAuthTokens = {
			accessToken: "old_token",
			refreshToken: "refresh_token",
		};

		const refreshedTokens: OAuthTokens = {
			accessToken: "new_token",
			refreshToken: "new_refresh_token",
			expiresAt: Date.now() + 3600000,
		};

		const auth: OAuthAuth = {
			type: "oauth",
			buttonLabel: "Sign in",
			startFlow: async () => initialTokens,
			refreshTokens: async (tokens) => {
				if (!tokens.refreshToken) return null;
				return refreshedTokens;
			},
		};

		expect(auth.refreshTokens).toBeDefined();
		const result = await auth.refreshTokens?.(initialTokens);
		expect(result?.accessToken).toBe("new_token");
	});

	it("should allow refreshTokens to return null when refresh not supported", async () => {
		const auth: OAuthAuth = {
			type: "oauth",
			buttonLabel: "Sign in",
			startFlow: async () => ({ accessToken: "token" }),
			refreshTokens: async () => null,
		};

		const result = await auth.refreshTokens?.({ accessToken: "token" });
		expect(result).toBeNull();
	});

	it("should allow optional validateTokens function", async () => {
		const validTokens: OAuthTokens = {
			accessToken: "valid_token",
			expiresAt: Date.now() + 3600000, // Not expired
		};

		const auth: OAuthAuth = {
			type: "oauth",
			buttonLabel: "Sign in",
			startFlow: async () => validTokens,
			validateTokens: async (tokens) => {
				if (!tokens.expiresAt) return true;
				return Date.now() < tokens.expiresAt;
			},
		};

		expect(auth.validateTokens).toBeDefined();
		const isValid = await auth.validateTokens?.(validTokens);
		expect(isValid).toBe(true);
	});

	it("should work with all optional properties combined", async () => {
		const mockTokens: OAuthTokens = {
			accessToken: "ghu_initial",
			refreshToken: "ghr_refresh",
			expiresAt: Date.now() + 3600000,
			tokenType: "Bearer",
			scope: "copilot",
		};

		const auth: OAuthAuth = {
			type: "oauth",
			buttonLabel: "Sign in with GitHub",
			startFlow: async () => mockTokens,
			refreshTokens: async (tokens) => ({
				...tokens,
				accessToken: "ghu_refreshed",
				expiresAt: Date.now() + 7200000,
			}),
			validateTokens: async (tokens) => {
				return !!tokens.accessToken && (!tokens.expiresAt || Date.now() < tokens.expiresAt);
			},
		};

		expect(auth.type).toBe("oauth");
		expect(auth.buttonLabel).toBe("Sign in with GitHub");
		expect(typeof auth.startFlow).toBe("function");
		expect(typeof auth.refreshTokens).toBe("function");
		expect(typeof auth.validateTokens).toBe("function");
	});

	it("should be used for GitHub Copilot style providers", async () => {
		// Example: GitHub Copilot OAuth authentication
		const performGitHubOAuthFlow = async (): Promise<OAuthTokens> => ({
			accessToken: "ghu_AbCdEfGhIjKlMnOpQrStUvWxYz",
			refreshToken: "ghr_AbCdEfGhIjKlMnOpQrStUvWxYz",
			expiresAt: Date.now() + 28800000, // 8 hours
			tokenType: "Bearer",
			scope: "copilot",
			metadata: {
				provider: "github-copilot",
				username: "octocat",
			},
		});

		const copilotAuth: OAuthAuth = {
			type: "oauth",
			buttonLabel: "Sign in with GitHub",
			startFlow: performGitHubOAuthFlow,
			refreshTokens: async (tokens) => {
				if (!tokens.refreshToken) return null;
				// Mock refresh implementation
				return {
					...tokens,
					accessToken: "ghu_NewAccessToken",
					expiresAt: Date.now() + 28800000,
				};
			},
			validateTokens: async (tokens: OAuthTokens) => {
				if (!tokens.accessToken) return false;
				if (tokens.expiresAt && Date.now() > tokens.expiresAt) return false;
				return true;
			},
		};

		expect(copilotAuth.type).toBe("oauth");
		expect(copilotAuth.buttonLabel).toBe("Sign in with GitHub");

		const tokens = await copilotAuth.startFlow();
		expect(tokens.accessToken).toMatch(/^ghu_/);
		expect(tokens.scope).toBe("copilot");
		expect(tokens.metadata?.provider).toBe("github-copilot");
	});

	it("should work without optional functions (minimal OAuth config)", () => {
		// Minimal OAuth configuration - only required properties
		const minimalAuth: OAuthAuth = {
			type: "oauth",
			buttonLabel: "Connect",
			startFlow: async () => ({ accessToken: "token" }),
		};

		expect(minimalAuth.type).toBe("oauth");
		expect(minimalAuth.buttonLabel).toBe("Connect");
		expect(minimalAuth.refreshTokens).toBeUndefined();
		expect(minimalAuth.validateTokens).toBeUndefined();
	});
});

describe("AuthMethod", () => {
	it("should be a union type of FieldBasedAuth and OAuthAuth", () => {
		// AuthMethod can be either FieldBasedAuth or OAuthAuth
		const fieldAuth: AuthMethod = {
			type: "field-based",
			fields: {
				apiKey: {
					label: "API Key",
					kind: "secret",
					primary: true,
					required: true,
				},
			},
		};

		const oauthAuth: AuthMethod = {
			type: "oauth",
			buttonLabel: "Sign in",
			startFlow: async () => ({ accessToken: "token" }),
		};

		expect(fieldAuth.type).toBe("field-based");
		expect(oauthAuth.type).toBe("oauth");
	});

	it("should use type property as discriminator", () => {
		// The 'type' property discriminates between FieldBasedAuth and OAuthAuth
		const authMethods: AuthMethod[] = [
			{
				type: "field-based",
				fields: {
					apiKey: {
						label: "API Key",
						kind: "secret",
						primary: true,
						required: true,
					},
				},
			},
			{
				type: "oauth",
				buttonLabel: "Connect",
				startFlow: async () => ({ accessToken: "token" }),
			},
		];

		// Type narrowing should work based on 'type' discriminator
		for (const auth of authMethods) {
			if (auth.type === "field-based") {
				// TypeScript should know this is FieldBasedAuth
				expect(auth.fields).toBeDefined();
				expect(typeof auth.fields).toBe("object");
			} else if (auth.type === "oauth") {
				// TypeScript should know this is OAuthAuth
				expect(auth.buttonLabel).toBeDefined();
				expect(typeof auth.startFlow).toBe("function");
			}
		}
	});

	it("should allow type narrowing with type guards", () => {
		// Type guard function for FieldBasedAuth
		const isFieldBasedAuth = (auth: AuthMethod): auth is FieldBasedAuth => {
			return auth.type === "field-based";
		};

		// Type guard function for OAuthAuth
		const isOAuthAuth = (auth: AuthMethod): auth is OAuthAuth => {
			return auth.type === "oauth";
		};

		const fieldAuth: AuthMethod = {
			type: "field-based",
			fields: {
				apiKey: {
					label: "API Key",
					kind: "secret",
					primary: true,
					required: true,
				},
			},
		};

		const oauthAuth: AuthMethod = {
			type: "oauth",
			buttonLabel: "Sign in",
			startFlow: async () => ({ accessToken: "token" }),
		};

		expect(isFieldBasedAuth(fieldAuth)).toBe(true);
		expect(isOAuthAuth(fieldAuth)).toBe(false);
		expect(isFieldBasedAuth(oauthAuth)).toBe(false);
		expect(isOAuthAuth(oauthAuth)).toBe(true);
	});

	it("should support OpenAI-style providers (field-based)", () => {
		// OpenAI uses field-based auth with apiKey, baseUrl, and headers
		const openaiAuth: AuthMethod = {
			type: "field-based",
			fields: {
				apiKey: {
					label: "API Key",
					kind: "secret",
					primary: true,
					required: true,
					placeholder: "sk-...",
				},
				baseUrl: {
					label: "Base URL",
					kind: "text",
					primary: true,
					required: false,
				},
				headers: {
					label: "Custom Headers",
					kind: "textarea",
					primary: false,
					required: false,
				},
			},
		};

		expect(openaiAuth.type).toBe("field-based");
		if (openaiAuth.type === "field-based") {
			expect(openaiAuth.fields.apiKey.required).toBe(true);
			expect(openaiAuth.fields.baseUrl.required).toBe(false);
		}
	});

	it("should support GitHub Copilot-style providers (OAuth)", async () => {
		// GitHub Copilot uses OAuth authentication
		const copilotAuth: AuthMethod = {
			type: "oauth",
			buttonLabel: "Sign in with GitHub",
			startFlow: async () => ({
				accessToken: "ghu_xxxxxxxxxxxx",
				refreshToken: "ghr_xxxxxxxxxxxx",
				expiresAt: Date.now() + 28800000,
				tokenType: "Bearer",
				scope: "copilot",
			}),
			refreshTokens: async (tokens: OAuthTokens) => ({
				...tokens,
				accessToken: "ghu_newtoken",
				expiresAt: Date.now() + 28800000,
			}),
		};

		expect(copilotAuth.type).toBe("oauth");
		if (copilotAuth.type === "oauth") {
			expect(copilotAuth.buttonLabel).toBe("Sign in with GitHub");
			const tokens = await copilotAuth.startFlow();
			expect(tokens.accessToken).toMatch(/^ghu_/);
		}
	});

	it("should be mutually exclusive - cannot have both field-based and oauth properties", () => {
		// This test documents that AuthMethod is a proper discriminated union
		// You cannot mix properties from both types

		// FieldBasedAuth has 'fields' but not 'buttonLabel' or 'startFlow'
		const fieldAuth: AuthMethod = {
			type: "field-based",
			fields: {
				apiKey: {
					label: "API Key",
					kind: "secret",
					primary: true,
					required: true,
				},
			},
		};

		// OAuthAuth has 'buttonLabel' and 'startFlow' but not 'fields'
		const oauthAuth: AuthMethod = {
			type: "oauth",
			buttonLabel: "Connect",
			startFlow: async () => ({ accessToken: "token" }),
		};

		// Type system ensures these are mutually exclusive
		// At runtime, we verify the structure matches the type
		if (fieldAuth.type === "field-based") {
			expect("fields" in fieldAuth).toBe(true);
			expect("buttonLabel" in fieldAuth).toBe(false);
			expect("startFlow" in fieldAuth).toBe(false);
		}

		if (oauthAuth.type === "oauth") {
			expect("buttonLabel" in oauthAuth).toBe(true);
			expect("startFlow" in oauthAuth).toBe(true);
			expect("fields" in oauthAuth).toBe(false);
		}
	});
});
