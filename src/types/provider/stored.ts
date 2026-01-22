/**
 * Stored Auth State Types
 *
 * Types for authentication state as persisted in data.json.
 */

import type { OAuthTokens } from "./auth.ts";

/**
 * Field-based authentication state as stored in data.json.
 * Used for providers that use API keys, tokens, or other field-based auth.
 *
 * - `values`: Non-secret field values stored directly (e.g., baseUrl, headers)
 * - `secretIds`: References to secrets stored in Obsidian's SecretStorage
 *
 * The secretIds contain UUID references, NOT the actual secret values.
 */
export interface StoredFieldBasedAuthState {
	/**
	 * Discriminator for the StoredAuthState union type.
	 * Always "field-based" for this interface.
	 */
	type: "field-based";

	/**
	 * Non-secret field values stored directly in data.json.
	 * Examples: baseUrl, headers (JSON string), organization ID
	 */
	values: Record<string, string>;

	/**
	 * References to secrets stored in Obsidian's SecretStorage.
	 * The key is the field name (e.g., "apiKey"), and the value is
	 * the UUID reference used to look up the secret.
	 */
	secretIds: Record<string, string>;
}

/**
 * OAuth authentication state as stored in data.json.
 * Used for providers that use OAuth flows (e.g., GitHub Copilot).
 */
export interface StoredOAuthAuthState {
	/**
	 * Discriminator for the StoredAuthState union type.
	 * Always "oauth" for this interface.
	 */
	type: "oauth";

	/**
	 * OAuth tokens obtained from the authorization flow.
	 */
	tokens: OAuthTokens;
}

/**
 * Discriminated union type for stored authentication state.
 *
 * This represents how authentication credentials are persisted in data.json.
 * Use the `type` property to narrow the union:
 * - `type: "field-based"` → StoredFieldBasedAuthState (API keys stored as refs)
 * - `type: "oauth"` → StoredOAuthAuthState (OAuth tokens)
 */
export type StoredAuthState = StoredFieldBasedAuthState | StoredOAuthAuthState;
