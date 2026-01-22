/**
 * Custom provider factories barrel export
 *
 * This module exports factory functions for creating custom providers.
 * Custom providers are user-created configurations that extend built-in provider runtimes.
 */

// Export custom provider factory
export {
	createCustomOpenAICompatibleProvider,
	type CreateCustomOpenAICompatibleProviderOptions,
} from "./openaiCompatible";
