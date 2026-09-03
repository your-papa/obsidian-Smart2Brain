import type { App } from "obsidian";
import { slugifyProviderName } from "../utils/slugify";

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
 * Clear a secret by its ID.
 * Obsidian's SecretStorage API does not currently expose deletion,
 * so we overwrite the value with an empty string and treat that as absent.
 */
export function removeSecret(app: App, id: string): void {
	app.secretStorage.setSecret(id, "");
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

const MAX_SECRET_ID_LENGTH = 64;

/**
 * Propose a secret ID from the context the caller already has, so the user can
 * paste a key without inventing a handle first — e.g. ("Anthropic", "apiKey")
 * yields "anthropic-api-key".
 *
 * `label` is human-facing (a provider's display name) and is slugified as-is.
 * `fieldKey` is a machine identifier and gets its camelCase split first, so
 * "apiKey" reads as "api-key". Splitting camelCase in `label` too would mangle
 * real names ("LangSmith" → "lang-smith", "Work OpenAI" → "work-open-ai").
 *
 * The result is always a valid ID per {@link isValidSecretId} and is never one
 * that already exists: `setSecret` overwrites unconditionally, so prefilling a
 * taken ID would silently clobber a working credential. Collisions get a
 * `-2`, `-3`, ... suffix instead.
 */
export function suggestSecretId(app: App, label: string, fieldKey?: string): string {
	const parts = [label, fieldKey?.replace(/([a-z0-9])([A-Z])/g, "$1-$2")].filter(
		(part): part is string => !!part && part.trim().length > 0,
	);
	const base = slugifyProviderName(parts.join("-")) || "secret";

	let taken: Set<string>;
	try {
		taken = new Set(listSecrets(app));
	} catch {
		taken = new Set();
	}

	// Truncate to leave room for the widest suffix we might append, so the
	// suffixed candidates stay within the 64-char limit too.
	const fit = (candidate: string, suffix: string) =>
		`${candidate.slice(0, MAX_SECRET_ID_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;

	const first = fit(base, "");
	if (first && !taken.has(first)) return first;

	for (let n = 2; ; n++) {
		const suffixed = fit(base, `-${n}`);
		if (!taken.has(suffixed)) return suffixed;
	}
}
