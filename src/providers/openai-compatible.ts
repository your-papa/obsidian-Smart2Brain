/**
 * OpenAI-Compatible Provider Factory
 *
 * Creates provider definitions for custom providers that use
 * OpenAI-compatible API endpoints.
 *
 * This factory is used for user-defined providers at runtime.
 */

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { requestUrl } from "obsidian";
import type {
	AuthObject,
	AuthValidationResult,
	BaseProviderDefinition,
	ChatModelConfig,
	CustomProviderMeta,
	EmbeddingProviderDefinition,
} from "../types/provider/index";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Removes trailing slashes from a URL.
 */
function sanitizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

/**
 * Safely reads response text, returning undefined on error.
 */
async function safeReadText(response: Response): Promise<string | undefined> {
	try {
		return await response.text();
	} catch {
		return undefined;
	}
}

// =============================================================================
// API Response Types
// =============================================================================

interface OpenAIModelResponse {
	data?: Array<{ id?: string }>;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Input for creating an OpenAI-compatible custom provider.
 * Combines the provider ID with its metadata.
 */
export type CustomProviderInput = { id: string } & CustomProviderMeta;

/**
 * Creates a BaseProviderDefinition for an OpenAI-compatible custom provider.
 *
 * Custom providers:
 * - Require baseUrl (this is what makes them "custom")
 * - Optionally require apiKey
 * - Optionally support headers
 * - Use OpenAI-compatible /v1/models and /v1/chat/completions endpoints
 *
 * @param config - The provider ID and metadata
 * @returns A BaseProviderDefinition (or EmbeddingProviderDefinition if supportsEmbeddings)
 */
export function createOpenAICompatibleProvider(
	config: CustomProviderInput,
): BaseProviderDefinition | EmbeddingProviderDefinition {
	const baseDefinition: BaseProviderDefinition = {
		id: config.id,
		displayName: config.displayName,
		logo: undefined, // Custom providers use generic icon

		setupInstructions: {
			steps: [
				"Enter the base URL for your OpenAI-compatible API endpoint",
				"Optionally provide an API key if required by the endpoint",
				"Optionally add custom headers for authentication",
			],
		},

		auth: {
			baseUrl: {
				label: "Base URL",
				description: "The base URL for the OpenAI-compatible API endpoint",
				kind: "text",
				required: true,
				placeholder: "http://localhost:11434",
			},
			apiKey: {
				label: "API Key",
				description: "API key for authentication (if required)",
				kind: "secret",
				required: false,
				placeholder: "sk-...",
			},
			headers: {
				label: "Custom Headers",
				description: "Additional headers as JSON (optional)",
				kind: "textarea",
				required: false,
				placeholder: '{"X-Custom-Header": "value"}',
			},
		},

		createChatInstance: (auth: AuthObject, modelId: string, options?: Partial<ChatModelConfig>) => {
			if (!auth.baseUrl) {
				throw new Error("Base URL is required for custom providers");
			}

			const configuration: Record<string, unknown> = {
				baseURL: `${sanitizeBaseUrl(auth.baseUrl)}/v1`,
			};

			// Add custom headers if provided
			if (auth.headers && Object.keys(auth.headers).length > 0) {
				configuration.defaultHeaders = auth.headers;
			}

			const chatConfig: Record<string, unknown> = {
				model: modelId,
				// LangChain's ChatOpenAI requires an apiKey even if the endpoint doesn't need one.
				// Use the provided key or a placeholder for endpoints that don't require auth.
				apiKey: auth.apiKey || "not-required",
				configuration,
			};

			if (options?.temperature !== undefined) {
				chatConfig.temperature = options.temperature;
			}

			return new ChatOpenAI(chatConfig);
		},

		validateAuth: async (auth: AuthObject): Promise<AuthValidationResult> => {
			if (!auth.baseUrl) {
				return { valid: false, error: "Base URL is required" };
			}

			const apiUrl = `${sanitizeBaseUrl(auth.baseUrl)}/v1`;

			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};

				if (auth.apiKey) {
					headers.Authorization = `Bearer ${auth.apiKey}`;
				}

				// Add custom headers if provided
				if (auth.headers) {
					Object.assign(headers, auth.headers);
				}

				// Use Obsidian's requestUrl to bypass CORS
				const response = await requestUrl({
					url: `${apiUrl}/models`,
					method: "GET",
					headers,
					throw: false,
				});

				if (response.status >= 200 && response.status < 300) {
					return { valid: true };
				}

				// Handle error response
				let errorMessage: string | undefined;
				try {
					const parsed = response.json as { error?: { message?: string } };
					errorMessage = parsed?.error?.message;
				} catch {
					// ignore parse errors
				}

				if (response.status === 401 || response.status === 403) {
					return { valid: false, error: errorMessage || "Authentication failed" };
				}

				return {
					valid: false,
					error: errorMessage || `Request failed with status ${response.status}`,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { valid: false, error: `Connection failed: ${message}` };
			}
		},

		discoverModels: async (auth: AuthObject): Promise<string[]> => {
			if (!auth.baseUrl) {
				throw new Error("Base URL is required for model discovery");
			}

			const apiUrl = `${sanitizeBaseUrl(auth.baseUrl)}/v1`;
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};

			if (auth.apiKey) {
				headers.Authorization = `Bearer ${auth.apiKey}`;
			}

			if (auth.headers) {
				Object.assign(headers, auth.headers);
			}

			// Use Obsidian's requestUrl to bypass CORS
			const response = await requestUrl({
				url: `${apiUrl}/models`,
				method: "GET",
				headers,
				throw: false,
			});

			if (response.status < 200 || response.status >= 300) {
				throw new Error(`Model discovery failed: ${response.text || `status ${response.status}`}`);
			}

			const payload = response.json as OpenAIModelResponse;
			const resources = Array.isArray(payload.data) ? payload.data : [];

			return resources.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.trim() !== "");
		},
	};

	// Add embedding support if configured
	if (config.supportsEmbeddings) {
		return {
			...baseDefinition,
			createEmbeddingInstance: (auth: AuthObject, modelId: string) => {
				if (!auth.baseUrl) {
					throw new Error("Base URL is required for custom providers");
				}

				const configuration: Record<string, unknown> = {
					baseURL: `${sanitizeBaseUrl(auth.baseUrl)}/v1`,
				};

				// Add custom headers if provided
				if (auth.headers && Object.keys(auth.headers).length > 0) {
					configuration.defaultHeaders = auth.headers;
				}

				const embeddingConfig: Record<string, unknown> = {
					model: modelId,
					// LangChain's OpenAIEmbeddings requires an apiKey even if the endpoint doesn't need one.
					// Use the provided key or a placeholder for endpoints that don't require auth.
					apiKey: auth.apiKey || "not-required",
					configuration,
				};

				return new OpenAIEmbeddings(embeddingConfig);
			},
		} as EmbeddingProviderDefinition;
	}

	return baseDefinition;
}
