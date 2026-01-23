/**
 * Stored Provider Types
 *
 * Types for provider data that gets persisted in settings.
 */

/**
 * Extra metadata for custom (user-defined) providers.
 * Only stored for custom providers - built-in providers have their metadata in code.
 *
 * This is used by the settings UI to display/edit custom provider info.
 */
export interface CustomProviderMeta {
	/** User-defined display name for the provider. */
	displayName: string;

	/** Whether this provider supports embedding models. */
	supportsEmbeddings: boolean;
}
