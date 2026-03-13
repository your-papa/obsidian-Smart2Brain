/**
 * Stored Provider Types
 *
 * Types for provider data that gets persisted in settings.
 */

/**
 * Code-defined provider template identifiers.
 */
export type ProviderTemplateId = "openai-compatible" | "openai-codex" | "anthropic" | "ollama" | "openrouter";

/**
 * Persisted metadata for a configured provider instance.
 */
export interface ProviderInstanceMeta {
	/** The code-defined template backing this provider instance. */
	templateId: ProviderTemplateId;

	/** User-visible display name for the configured instance. */
	displayName: string;
}

// Temporary compatibility alias while callers migrate from the old custom-provider naming.
export type CustomProviderMeta = ProviderInstanceMeta;
