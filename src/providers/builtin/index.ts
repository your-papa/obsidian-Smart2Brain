/**
 * Built-in providers barrel export
 *
 * This module exports all built-in provider definitions and provides
 * a builtInProviders record for easy lookup by provider id.
 */

import type { BuiltInProviderDefinition } from "../types";
import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";
import { openaiProvider } from "./openai";

// Re-export individual providers for direct import
export { openaiProvider } from "./openai";
export { anthropicProvider } from "./anthropic";
export { ollamaProvider } from "./ollama";

/**
 * Record of all built-in providers, keyed by provider id.
 *
 * Use this to look up a provider definition by its id:
 * ```ts
 * const provider = builtInProviders["openai"];
 * if (provider) {
 *   console.log(provider.displayName); // "OpenAI"
 * }
 * ```
 */
export const builtInProviders: Record<string, BuiltInProviderDefinition> = {
	[openaiProvider.id]: openaiProvider,
	[anthropicProvider.id]: anthropicProvider,
	[ollamaProvider.id]: ollamaProvider,
};
