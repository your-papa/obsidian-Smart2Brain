/**
 * Provider helper utilities
 *
 * This file contains utility functions for the provider system:
 * - AUTH_FIELD_TEMPLATES: Canonical definitions for common auth fields
 * - buildFieldBasedAuth: Builds FieldBasedAuth from templates and requirements
 * - validateCustomProviderId: Validates custom provider IDs
 * - parseHeadersJson: Parses JSON headers strings
 */

import type { AuthFieldDefinition, FieldBasedAuth } from "./types";

// ============================================================================
// Auth Field Templates
// ============================================================================

/**
 * Known auth field types that have canonical definitions.
 * Each field type has a predefined label, kind, and placeholder.
 */
export type AuthFieldType = "apiKey" | "baseUrl" | "headers";

/**
 * Canonical template definitions for common authentication fields.
 *
 * These templates define the immutable properties of each field type:
 * - label: Display label in the UI
 * - kind: Input type (text, secret, textarea)
 * - placeholder: Default placeholder text
 *
 * Providers only need to specify:
 * - required: Whether the field must be filled
 * - Optionally override label/placeholder for provider-specific text
 */
export const AUTH_FIELD_TEMPLATES: Record<AuthFieldType, Omit<AuthFieldDefinition, "required">> = {
	apiKey: {
		label: "API Key",
		kind: "secret",
		placeholder: "sk-...",
	},
	baseUrl: {
		label: "Base URL",
		kind: "text",
		placeholder: "https://api.example.com/v1",
	},
	headers: {
		label: "Custom Headers",
		kind: "textarea",
		placeholder: '{"Header-Name": "value"}',
	},
};

// ============================================================================
// Auth Field Requirements Types
// ============================================================================

/**
 * Provider-specific requirements for an auth field.
 *
 * Providers define ONLY what varies between them:
 * - required: Whether the field must have a value (required fields are always visible)
 * - label: Optional override for provider-specific label (e.g., "Server URL" for Ollama)
 * - placeholder: Optional override for provider-specific placeholder
 */
export interface AuthFieldRequirements {
	/** Whether the field must be filled for the provider to work. Required fields are always visible. */
	required: boolean;
	/** Optional: Override the default label (e.g., "Server URL" instead of "Base URL") */
	label?: string;
	/** Optional: Override the default placeholder text */
	placeholder?: string;
}

/**
 * Map of field types to their provider-specific requirements.
 *
 * @example OpenAI requirements
 * ```typescript
 * const openaiRequirements: AuthRequirementsMap = {
 *   apiKey: { required: true },
 *   baseUrl: { required: false, placeholder: "https://api.openai.com/v1" },
 *   headers: { required: false },
 * };
 * ```
 *
 * @example Ollama requirements (no API key)
 * ```typescript
 * const ollamaRequirements: AuthRequirementsMap = {
 *   baseUrl: { required: true, placeholder: "http://localhost:11434" },
 * };
 * ```
 */
export type AuthRequirementsMap = Partial<Record<AuthFieldType, AuthFieldRequirements>>;

/**
 * Options for building field-based auth configuration.
 */
export interface BuildFieldBasedAuthOptions {
	/**
	 * Requirements for standard auth fields (apiKey, baseUrl, headers).
	 * These fields use the canonical templates with provider-specific overrides.
	 */
	fields?: AuthRequirementsMap;

	/**
	 * Custom fields that don't use templates.
	 * Use this for provider-specific fields like SAP's resourceGroup.
	 */
	customFields?: Record<string, AuthFieldDefinition>;
}

// ============================================================================
// buildFieldBasedAuth
// ============================================================================

/**
 * Builds a FieldBasedAuth configuration from templates and provider requirements.
 *
 * This function merges the canonical AUTH_FIELD_TEMPLATES with provider-specific
 * requirements to create the final auth configuration. This eliminates duplication
 * across providers while allowing customization where needed.
 *
 * @param options - Provider-specific field requirements (can be AuthRequirementsMap or BuildFieldBasedAuthOptions)
 * @returns A complete FieldBasedAuth configuration
 *
 * @example OpenAI provider (simple form)
 * ```typescript
 * const auth = buildFieldBasedAuth({
 *   apiKey: { required: true },
 *   baseUrl: { required: false, placeholder: "https://api.openai.com/v1" },
 *   headers: { required: false },
 * });
 * ```
 *
 * @example SAP AI Core (with custom field)
 * ```typescript
 * const auth = buildFieldBasedAuth({
 *   fields: {
 *     apiKey: { required: true, label: "API Token" },
 *     baseUrl: { required: true, label: "Deployment URL" },
 *   },
 *   customFields: {
 *     resourceGroup: {
 *       label: "Resource Group",
 *       kind: "text",
 *       required: false,
 *       placeholder: "default",
 *     },
 *   },
 * });
 * ```
 */
export function buildFieldBasedAuth(options: AuthRequirementsMap | BuildFieldBasedAuthOptions): FieldBasedAuth {
	const fields: Record<string, AuthFieldDefinition> = {};

	// Determine if we're using the simple form (AuthRequirementsMap) or the extended form (BuildFieldBasedAuthOptions)
	const isExtendedForm = "fields" in options || "customFields" in options;
	const requirements = isExtendedForm ? ((options as BuildFieldBasedAuthOptions).fields ?? {}) : options;
	const customFields = isExtendedForm ? (options as BuildFieldBasedAuthOptions).customFields : undefined;

	// Build fields from templates
	for (const [fieldType, fieldRequirements] of Object.entries(requirements)) {
		const template = AUTH_FIELD_TEMPLATES[fieldType as AuthFieldType];
		if (!template) {
			throw new Error(`Unknown auth field type: ${fieldType}`);
		}

		fields[fieldType] = {
			...template,
			required: fieldRequirements.required,
			// Allow provider-specific overrides
			...(fieldRequirements.label !== undefined && { label: fieldRequirements.label }),
			...(fieldRequirements.placeholder !== undefined && { placeholder: fieldRequirements.placeholder }),
		};
	}

	// Add custom fields (if any)
	if (customFields) {
		for (const [fieldId, fieldDef] of Object.entries(customFields)) {
			fields[fieldId] = fieldDef;
		}
	}

	return {
		type: "field-based",
		fields,
	};
}

// ============================================================================
// Types
// ============================================================================

/**
 * Result of validating a custom provider ID.
 *
 * - `{ valid: true }` - ID is valid and can be used
 * - `{ valid: false; error: string }` - ID is invalid with error message
 */
export type ProviderIdValidationResult = { valid: true; error?: undefined } | { valid: false; error: string };

/**
 * Result of parsing a headers JSON string.
 *
 * - `{ success: true; headers: Record<string, string> }` - Parsed successfully
 * - `{ success: false; error: string; headers: {} }` - Parse failed with error
 */
export type ParseHeadersResult =
	| { success: true; headers: Record<string, string>; error?: undefined }
	| { success: false; error: string; headers: Record<string, string> };

// ============================================================================
// validateCustomProviderId
// ============================================================================

/**
 * Regular expression for valid provider IDs.
 *
 * Valid IDs must:
 * - Start with a lowercase letter
 * - Contain only lowercase letters, numbers, and single dashes
 * - Not end with a dash
 * - Not contain consecutive dashes
 *
 * Examples of valid IDs: "openai", "my-provider", "azure-openai-v2"
 * Examples of invalid IDs: "OpenAI", "my_provider", "-start", "end-", "double--dash"
 */
const VALID_PROVIDER_ID_REGEX = /^[a-z]([a-z0-9]|-(?=[a-z0-9]))*$/;

/**
 * Validates a custom provider ID.
 *
 * Checks that the ID:
 * - Is not empty
 * - Contains no spaces
 * - Is all lowercase
 * - Follows the pattern: lowercase letters, numbers, and dashes
 * - Does not duplicate an existing provider ID
 *
 * @param id - The provider ID to validate
 * @param existingIds - Array of existing provider IDs to check for duplicates
 * @returns Validation result with `valid: true` or `valid: false` with error message
 *
 * @example
 * ```typescript
 * const result = validateCustomProviderId("my-provider", ["openai", "anthropic"]);
 * if (result.valid) {
 *   console.log("ID is valid!");
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function validateCustomProviderId(id: string, existingIds: string[]): ProviderIdValidationResult {
	// Check for empty string
	if (!id || id.trim() === "") {
		return {
			valid: false,
			error: "Provider ID cannot be empty",
		};
	}

	// Check for spaces (including leading/trailing)
	if (/\s/.test(id)) {
		return {
			valid: false,
			error: "Provider ID cannot contain spaces",
		};
	}

	// Check for uppercase letters
	if (id !== id.toLowerCase()) {
		return {
			valid: false,
			error: "Provider ID must be lowercase",
		};
	}

	// Check for valid format (lowercase letters, numbers, dashes)
	if (!VALID_PROVIDER_ID_REGEX.test(id)) {
		// Provide more specific error messages
		if (id.startsWith("-")) {
			return {
				valid: false,
				error: "Provider ID cannot start with a dash",
			};
		}
		if (id.endsWith("-")) {
			return {
				valid: false,
				error: "Provider ID cannot end with a dash",
			};
		}
		if (/--/.test(id)) {
			return {
				valid: false,
				error: "Provider ID cannot contain consecutive dashes",
			};
		}
		if (/^[0-9]/.test(id)) {
			return {
				valid: false,
				error: "Provider ID must start with a letter",
			};
		}
		if (/_/.test(id)) {
			return {
				valid: false,
				error: "Provider ID cannot contain underscores, use dashes instead",
			};
		}
		return {
			valid: false,
			error: "Provider ID can only contain lowercase letters, numbers, and dashes",
		};
	}

	// Check for duplicates
	if (existingIds.includes(id)) {
		return {
			valid: false,
			error: `Provider ID "${id}" already exists`,
		};
	}

	return { valid: true };
}

// ============================================================================
// parseHeadersJson
// ============================================================================

/**
 * Parses a JSON string containing HTTP headers.
 *
 * Expects a JSON object where all values are strings.
 * Returns empty headers for empty/whitespace-only input.
 *
 * @param jsonString - The JSON string to parse
 * @returns Parse result with headers object or error message
 *
 * @example Valid JSON
 * ```typescript
 * const result = parseHeadersJson('{"Authorization": "Bearer token"}');
 * // result = { success: true, headers: { Authorization: "Bearer token" } }
 * ```
 *
 * @example Empty input
 * ```typescript
 * const result = parseHeadersJson("");
 * // result = { success: true, headers: {} }
 * ```
 *
 * @example Invalid JSON
 * ```typescript
 * const result = parseHeadersJson("{invalid}");
 * // result = { success: false, error: "...", headers: {} }
 * ```
 */
export function parseHeadersJson(jsonString: string): ParseHeadersResult {
	// Handle empty/whitespace-only input
	const trimmed = jsonString.trim();
	if (trimmed === "") {
		return {
			success: true,
			headers: {},
		};
	}

	// Try to parse JSON
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (e) {
		return {
			success: false,
			error: `Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`,
			headers: {},
		};
	}

	// Check that parsed value is an object (not null, array, or primitive)
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			success: false,
			error: "Headers must be a JSON object",
			headers: {},
		};
	}

	// Cast to record for iteration
	const obj = parsed as Record<string, unknown>;

	// Validate that all values are strings
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (typeof value !== "string") {
			return {
				success: false,
				error: `Header value for "${key}" must be a string, got ${typeof value}`,
				headers: {},
			};
		}
		headers[key] = value;
	}

	return {
		success: true,
		headers,
	};
}
