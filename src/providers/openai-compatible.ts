/**
 * OpenAI-Compatible Provider Factory
 *
 * Creates provider definitions for configurable providers that use
 * OpenAI-compatible API endpoints.
 */

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { requestUrl } from "obsidian";
import OpenAILogo from "../components/ui/logos/OpenAILogo.svelte";
import type {
	AuthObject,
	AuthValidationResult,
	BaseProviderDefinition,
	ChatModelConfig,
	EmbeddingProviderDefinition,
	LogoProps,
	ProviderSetupInstructions,
} from "../types/provider/index";
import { createTransportedChatOpenAI } from "./chatProviders";

function sanitizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

interface OpenAIModelResponse {
	data?: Array<{ id?: string }>;
}

export interface OpenAICompatibleProviderInput {
	id: string;
	displayName: string;
	defaultBaseUrl?: string;
	logo?: typeof OpenAILogo;
	setupInstructions?: ProviderSetupInstructions;
}

export function createOpenAICompatibleProvider(
	config: OpenAICompatibleProviderInput,
): BaseProviderDefinition | EmbeddingProviderDefinition {
	const defaultBaseUrl = sanitizeBaseUrl(config.defaultBaseUrl ?? "https://api.openai.com");
	const baseDefinition: BaseProviderDefinition = {
		id: config.id,
		displayName: config.displayName,
		logo: config.logo as typeof OpenAILogo | undefined,
		setupInstructions: config.setupInstructions ?? {
			steps: [
				"Enter the base URL for your OpenAI-compatible API endpoint",
				"Provide an API key if the endpoint requires authentication",
				"Optionally add custom headers for authentication or routing",
			],
		},
		auth: {
			apiKey: {
				label: "API Key",
				description: "API key for authentication (if required)",
				kind: "secret",
				required: true,
				placeholder: "sk-...",
			},
			baseUrl: {
				label: "Base URL",
				description: "The base URL for the OpenAI-compatible API endpoint",
				kind: "text",
				required: false,
				placeholder: defaultBaseUrl,
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
			const resolvedBaseUrl = sanitizeBaseUrl(auth.baseUrl || defaultBaseUrl);
			const configuration: Record<string, unknown> = {
				baseURL: `${resolvedBaseUrl}/v1`,
			};

			if (auth.headers && Object.keys(auth.headers).length > 0) {
				configuration.defaultHeaders = auth.headers;
			}

			const chatConfig: Record<string, unknown> = {
				model: modelId,
				apiKey: auth.apiKey || "not-required",
				configuration,
			};

			if (options?.temperature !== undefined) {
				chatConfig.temperature = options.temperature;
			}

			return createTransportedChatOpenAI(config.id, chatConfig as ConstructorParameters<typeof ChatOpenAI>[0]);
		},
		validateAuth: async (auth: AuthObject): Promise<AuthValidationResult> => {
			const apiUrl = `${sanitizeBaseUrl(auth.baseUrl || defaultBaseUrl)}/v1`;

			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};

				if (auth.apiKey) {
					headers.Authorization = `Bearer ${auth.apiKey}`;
				}

				if (auth.headers) {
					Object.assign(headers, auth.headers);
				}

				const response = await requestUrl({
					url: `${apiUrl}/models`,
					method: "GET",
					headers,
					throw: false,
				});

				if (response.status >= 200 && response.status < 300) {
					return { valid: true };
				}

				let errorMessage: string | undefined;
				try {
					const parsed = response.json as { error?: { message?: string } };
					errorMessage = parsed?.error?.message;
				} catch {
					errorMessage = undefined;
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
			const apiUrl = `${sanitizeBaseUrl(auth.baseUrl || defaultBaseUrl)}/v1`;
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};

			if (auth.apiKey) {
				headers.Authorization = `Bearer ${auth.apiKey}`;
			}

			if (auth.headers) {
				Object.assign(headers, auth.headers);
			}

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

	return {
		...baseDefinition,
		createEmbeddingInstance: (auth: AuthObject, modelId: string) => {
			const resolvedBaseUrl = sanitizeBaseUrl(auth.baseUrl || defaultBaseUrl);
			const configuration: Record<string, unknown> = {
				baseURL: `${resolvedBaseUrl}/v1`,
			};

			if (auth.headers && Object.keys(auth.headers).length > 0) {
				configuration.defaultHeaders = auth.headers;
			}

			const embeddingConfig: Record<string, unknown> = {
				model: modelId,
				apiKey: auth.apiKey || "not-required",
				encodingFormat: "float",
				configuration,
			};

			return new OpenAIEmbeddings(embeddingConfig);
		},
	} satisfies EmbeddingProviderDefinition;
}
