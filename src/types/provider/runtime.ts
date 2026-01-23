/**
 * Runtime Types
 *
 * Types for runtime authentication state and model factories.
 */

import type { OAuthTokens } from "./auth.ts";

/**
 * Field-based authentication state at runtime (secrets resolved).
 *
 * This is the resolved version of StoredFieldBasedAuthState:
 * - secretIds are looked up from SecretStorage
 * - Secret values are merged into the `values` object
 * - No secretIds property exists at runtime
 */
export interface RuntimeFieldBasedAuthState {
	/**
	 * Discriminator for the RuntimeAuthState union type.
	 * Always "field-based" for this interface.
	 */
	type: "field-based";

	/**
	 * All field values, including resolved secrets.
	 * Contains both plain values (e.g., baseUrl) and resolved secrets (e.g., apiKey).
	 */
	values: Record<string, string>;
}

/**
 * OAuth authentication state at runtime.
 * Identical to StoredOAuthAuthState - OAuth tokens don't need resolution.
 */
export interface RuntimeOAuthAuthState {
	/**
	 * Discriminator for the RuntimeAuthState union type.
	 * Always "oauth" for this interface.
	 */
	type: "oauth";

	/**
	 * OAuth tokens for authentication.
	 */
	tokens: OAuthTokens;
}

/**
 * Discriminated union type for runtime authentication state.
 *
 * This represents authentication credentials ready for use at runtime.
 * Unlike StoredAuthState, all secrets have been resolved from SecretStorage.
 */
export type RuntimeAuthState = RuntimeFieldBasedAuthState | RuntimeOAuthAuthState;
