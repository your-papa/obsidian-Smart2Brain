import type { App } from "obsidian";

/**
 * Wrapper for Obsidian's SecretStorage API (available from 1.11.4+)
 * Provides secure storage for API keys and other sensitive data.
 *
 * SecretStorage is a centralized key-value store that allows users to
 * share secrets across multiple plugins.
 */

/**
 * Get a secret value by its ID
 */
export function getSecret(app: App, id: string): string | null {
	return app.secretStorage.getSecret(id);
}

/**
 * Set a secret value
 * @param id - Lowercase alphanumeric ID with optional dashes, max 64 chars
 * @param value - The secret value to store
 */
export function setSecret(app: App, id: string, value: string): void {
	app.secretStorage.setSecret(id, value);
}

/**
 * List all secret IDs from SecretStorage
 */
export function listSecrets(app: App): string[] {
	return app.secretStorage.listSecrets();
}

/**
 * Validate a secret ID
 * Must be lowercase letters, numbers and dashes only, max 64 characters
 */
export function isValidSecretId(id: string): boolean {
	return /^[a-z0-9-]{1,64}$/.test(id);
}
