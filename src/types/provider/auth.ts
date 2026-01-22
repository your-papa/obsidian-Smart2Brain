/**
 * Auth Field Types
 *
 * Types for defining authentication fields and methods.
 */

/**
 * Definition for a single authentication field in a provider's auth config.
 * Used to dynamically render auth forms in the settings UI.
 *
 * Visibility is determined by `required`:
 * - Required fields are always visible
 * - Optional fields are hidden behind an "Advanced" toggle
 */
export interface AuthFieldDefinition {
	/**
	 * Display label for the field.
	 * Shown to users in the settings UI.
	 */
	label: string;

	/**
	 * Input type for the field.
	 * - 'text': Regular text input
	 * - 'secret': Password-style input (hidden characters)
	 * - 'textarea': Multi-line text input (for headers, etc.)
	 */
	kind: "text" | "secret" | "textarea";

	/**
	 * Whether the field must be filled for the provider to work.
	 * Required fields are always visible; optional fields are hidden behind "Advanced".
	 */
	required: boolean;

	/**
	 * Placeholder text shown when the field is empty.
	 */
	placeholder?: string;
}

/**
 * Field-based authentication configuration.
 * Used for providers that require API keys, tokens, or other field-based auth.
 *
 * This is the most common auth method:
 * - OpenAI: apiKey (required), baseUrl (optional), headers (optional)
 * - Anthropic: apiKey (required)
 * - Ollama: baseUrl (required, no API key)
 */
export interface FieldBasedAuth {
	/**
	 * Discriminator for the AuthMethod union type.
	 * Always "field-based" for this interface.
	 */
	type: "field-based";

	/**
	 * Authentication field definitions keyed by field ID.
	 * The key (e.g., "apiKey", "baseUrl") is used as the storage key
	 * and to access the field's value programmatically.
	 */
	fields: Record<string, AuthFieldDefinition>;
}

/**
 * OAuth token data structure.
 * Used by providers that support OAuth authentication flows.
 */
export interface OAuthTokens {
	/**
	 * The access token used to authenticate API requests.
	 * This is always required after a successful OAuth flow.
	 */
	accessToken: string;

	/**
	 * Refresh token used to obtain new access tokens.
	 * Optional - not all OAuth providers support refresh tokens.
	 */
	refreshToken?: string;

	/**
	 * Unix timestamp (seconds since epoch) when the access token expires.
	 * Optional - some tokens don't expire or don't report expiration.
	 */
	expiresAt?: number;

	/**
	 * Token type (e.g., "Bearer", "Basic").
	 * Optional - defaults to "Bearer" if not specified.
	 */
	tokenType?: string;

	/**
	 * OAuth scopes granted to this token.
	 * Optional - space-separated list of scopes.
	 */
	scope?: string;

	/**
	 * Provider-specific metadata.
	 * Optional - allows storing additional token-related data.
	 */
	metadata?: Record<string, unknown>;
}

/**
 * OAuth-based authentication configuration.
 * Used for providers that support OAuth authorization flows.
 */
export interface OAuthAuth {
	/**
	 * Discriminator for the AuthMethod union type.
	 * Always "oauth" for this interface.
	 */
	type: "oauth";

	/**
	 * Label for the sign-in button shown in the settings UI.
	 */
	buttonLabel: string;

	/**
	 * Initiates the OAuth authorization flow.
	 * Called when the user clicks the sign-in button.
	 */
	startFlow: () => Promise<OAuthTokens>;

	/**
	 * Refreshes expired tokens using a refresh token.
	 * Optional - only needed for providers that support token refresh.
	 */
	refreshTokens?: (tokens: OAuthTokens) => Promise<OAuthTokens | null>;

	/**
	 * Validates whether the current tokens are still valid.
	 * Optional - can be used to check token expiration or make a test API call.
	 */
	validateTokens?: (tokens: OAuthTokens) => Promise<boolean>;
}

/**
 * Discriminated union type for all authentication methods.
 *
 * Use the `type` property to narrow the union:
 * - `type: "field-based"` → FieldBasedAuth (API keys, tokens, etc.)
 * - `type: "oauth"` → OAuthAuth (OAuth flows like GitHub, Google)
 */
export type AuthMethod = FieldBasedAuth | OAuthAuth;
