import type { PluginData } from "../types/plugin";
import { DEFAULT_SETTINGS } from "./dataStore.svelte";

// TODO: This entire validation file needs to be rewritten for the new StoredProvidersConfig structure
// For now, validation just returns defaults or passes through data

// Language type for assistant language selection
export type Language = "en" | "de";

/**
 * Validation result type
 */
export interface ValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
	data?: PluginData;
}

/**
 * Main function to validate all plugin data
 * TODO: Implement proper validation for new StoredProvidersConfig structure
 */
export function validatePluginData(rawData: unknown): ValidationResult {
	if (!rawData || typeof rawData !== "object") {
		return {
			isValid: true,
			errors: [],
			warnings: ["Plugin data is missing or invalid, using all defaults"],
			data: DEFAULT_SETTINGS,
		};
	}

	// For now, just merge with defaults
	const data = {
		...DEFAULT_SETTINGS,
		...(rawData as Partial<PluginData>),
	} as PluginData;

	return {
		isValid: true,
		errors: [],
		warnings: [],
		data,
	};
}

/**
 * Type guard to check if data is valid PluginData
 */
export function isValidPluginData(data: unknown): data is PluginData {
	const validation = validatePluginData(data);
	return validation.isValid;
}

/**
 * Safely load and validate plugin data
 */
export function safeLoadPluginData(rawData: unknown): {
	data: PluginData;
	hasErrors: boolean;
	hasWarnings: boolean;
	errors: string[];
	warnings: string[];
} {
	const validation = validatePluginData(rawData);

	return {
		data: validation.data as PluginData,
		hasErrors: validation.errors.length > 0,
		hasWarnings: validation.warnings.length > 0,
		errors: validation.errors,
		warnings: validation.warnings,
	};
}
