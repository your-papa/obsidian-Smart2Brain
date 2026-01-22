/**
 * Provider-specific error classes
 *
 * These error classes provide a consistent way to handle provider-related errors
 * throughout the application. All provider errors extend ProviderRegistryError,
 * allowing consumers to catch all provider errors with a single catch block.
 *
 * Error hierarchy:
 * - Error
 *   - ProviderRegistryError (base class for all provider errors)
 *     - ProviderAuthError (authentication failures)
 *     - ProviderEndpointError (connection/network issues)
 *     - ModelNotFoundError (requested model not available)
 */

/**
 * Base error class for all provider-related errors.
 *
 * Use this class to catch any provider error generically:
 * ```typescript
 * try {
 *   await provider.validateAuth(auth);
 * } catch (error) {
 *   if (error instanceof ProviderRegistryError) {
 *     // Handle any provider error
 *   }
 * }
 * ```
 */
export class ProviderRegistryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProviderRegistryError";
	}
}

/**
 * Error thrown when provider authentication fails.
 *
 * This error is thrown when:
 * - API key is invalid or expired
 * - OAuth tokens are invalid or expired
 * - Account has insufficient permissions
 * - Rate limits are exceeded
 *
 * @example
 * ```typescript
 * // Basic usage
 * throw new ProviderAuthError("openai", 401);
 * // → "Authentication failed for provider "openai" with status 401."
 *
 * // With error code
 * throw new ProviderAuthError("openai", 401, "invalid_api_key");
 * // → "Authentication failed for provider "openai" with status 401 (invalid_api_key)."
 *
 * // With custom message
 * throw new ProviderAuthError("openai", 401, undefined, "API key is invalid");
 * // → "Authentication failed for provider "openai" with status 401: API key is invalid."
 *
 * // With both
 * throw new ProviderAuthError("anthropic", 403, "insufficient_quota", "Your account has no credits");
 * // → "Authentication failed for provider "anthropic" with status 403: Your account has no credits (insufficient_quota)."
 * ```
 */
export class ProviderAuthError extends ProviderRegistryError {
	constructor(provider: string, status: number, code?: string, message?: string) {
		const detail = message ? `: ${message}` : "";
		super(
			`Authentication failed for provider "${provider}" with status ${status}${detail}${code ? ` (${code})` : ""}.`,
		);
		this.name = "ProviderAuthError";
	}
}

/**
 * Error thrown when there's an issue connecting to a provider's endpoint.
 *
 * This error is thrown when:
 * - Network connection fails
 * - Server is unreachable
 * - DNS resolution fails
 * - Timeout occurs
 * - Server returns 5xx error
 *
 * @example
 * ```typescript
 * // Basic usage
 * throw new ProviderEndpointError("ollama", "Connection refused");
 * // → "Endpoint error for provider "ollama": Connection refused"
 *
 * // With status code
 * throw new ProviderEndpointError("openai", "Service unavailable", 503);
 * // → "Endpoint error for provider "openai" (status 503): Service unavailable"
 * ```
 */
export class ProviderEndpointError extends ProviderRegistryError {
	constructor(provider: string, message: string, status?: number) {
		const suffix = status ? ` (status ${status})` : "";
		super(`Endpoint error for provider "${provider}"${suffix}: ${message}`);
		this.name = "ProviderEndpointError";
	}
}

/**
 * Error thrown when a requested model is not found in a provider.
 *
 * This error is thrown when:
 * - User requests a model that doesn't exist
 * - Model has been deprecated or removed
 * - Model is not available in the user's account/region
 *
 * @example
 * ```typescript
 * // Chat model not found
 * throw new ModelNotFoundError("openai", "gpt-5", "chat");
 * // → "Model "gpt-5" not found for chat models in provider "openai"."
 *
 * // Embedding model not found
 * throw new ModelNotFoundError("openai", "text-embedding-5", "embedding");
 * // → "Model "text-embedding-5" not found for embedding models in provider "openai"."
 * ```
 */
export class ModelNotFoundError extends ProviderRegistryError {
	constructor(provider: string, model: string, type: "chat" | "embedding") {
		super(`Model "${model}" not found for ${type} models in provider "${provider}".`);
		this.name = "ModelNotFoundError";
	}
}

/**
 * Error thrown when a required provider package fails to import.
 *
 * This error is thrown when:
 * - An optional provider package is not installed
 * - A required export is missing from a package
 * - A package fails to load for any reason
 *
 * This is particularly useful for providers like SAP AI Core that require
 * optional packages that users must install separately.
 *
 * @example
 * ```typescript
 * // Package not installed
 * throw new ProviderImportError(
 *   "sap-ai-core",
 *   "@sap-ai-sdk/langchain",
 *   new Error("Package not installed. Run: npm install @sap-ai-sdk/langchain")
 * );
 * // → "Failed to import package "@sap-ai-sdk/langchain" for provider "sap-ai-core": Package not installed. Run: npm install @sap-ai-sdk/langchain"
 * ```
 */
export class ProviderImportError extends ProviderRegistryError {
	constructor(provider: string, packageName: string, cause?: Error) {
		const causeMessage = cause?.message ?? "Unknown error";
		super(`Failed to import package "${packageName}" for provider "${provider}": ${causeMessage}`);
		this.name = "ProviderImportError";
		this.cause = cause;
	}
}
