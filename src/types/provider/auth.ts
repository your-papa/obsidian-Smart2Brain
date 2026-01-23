/**
 * Auth Field Types
 *
 * Types for defining authentication fields and methods.
 */

/**
 * Standard authentication field keys that ALL field-based providers must define.
 * Each provider decides whether each field is `required: true` or `required: false`.
 *
 * - apiKey: API key or token for authentication
 * - baseUrl: Base URL for the API endpoint
 * - headers: Custom headers for API requests
 */
export type AuthObjectKey = "apiKey" | "baseUrl" | "headers";

/**
 * Definition for a single authentication field in a provider's auth config.
 * Used to dynamically render auth forms in the settings UI.
 *
 * Visibility is determined by `required`:
 * - Required fields (`required: true`) are always visible
 * - Optional fields (`required: false`) are shown in "Advanced Options"
 */
export interface AuthFieldDefinition {
	/**
	 * Display label for the field.
	 * Shown to users in the settings UI.
	 */
	label: string;

	/**
	 * Description of what this field is for.
	 * Shown as helper text in the settings UI.
	 */
	description: string;

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
 * Runtime authentication object passed to provider methods.
 * Contains the resolved values for authentication fields.
 */
export interface AuthObject {
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
}

/**
 * Auth field definition with required: true
 */
export type RequiredAuthField = AuthFieldDefinition & { required: true };

/**
 * Auth field definition with required: false
 */
export type OptionalAuthField = AuthFieldDefinition & { required: false };

/**
 * Provider auth configuration that requires at least one field to be required.
 * Creates a union where each variant has one key with required: true.
 */
export type ProviderAuthConfig = {
	[K in AuthObjectKey]: Partial<Record<AuthObjectKey, AuthFieldDefinition>> & {
		[P in K]: RequiredAuthField;
	};
}[AuthObjectKey];
