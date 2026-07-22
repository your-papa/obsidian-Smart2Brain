/**
 * OpenAI-Compatible Provider Factory
 *
 * Creates provider definitions for configurable providers that use
 * OpenAI-compatible API endpoints.
 */

import { ChatOpenAI } from "@langchain/openai";
import { requestUrl } from "obsidian";
import {
	createBufferedTransportedChatOpenAI,
	createTransportedChatOpenAI,
	createTransportedOpenAIEmbeddings,
} from "./chatProviders";
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

function sanitizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

interface OpenAIModelEntry {
	id?: string;
	/** Some servers (e.g. mlx-lm / OMLX) set type="embedding" on embedding models */
	type?: string;
	/** Alternate field name used by some servers */
	object?: string;
}

interface OpenAIModelResponse {
	data?: Array<OpenAIModelEntry>;
}

interface ModelStatusEntry {
	id?: string;
	model_type?: string;
}

interface ModelsStatusResponse {
	models?: Array<ModelStatusEntry>;
}

function isEmbeddingEntry(entry: OpenAIModelEntry): boolean {
	return entry.type === "embedding" || entry.object === "embedding";
}

async function fetchModelEntries(
	auth: AuthObject,
	providerId: string,
	defaultBaseUrl: string,
): Promise<OpenAIModelEntry[]> {
	const apiUrl = `${sanitizeBaseUrl(auth.baseUrl || defaultBaseUrl)}/v1`;
	const headers: Record<string, string> = { "Content-Type": "application/json" };

	if (auth.apiKey) {
		headers.Authorization = `Bearer ${auth.apiKey}`;
	}
	if (auth.headers) {
		Object.assign(headers, auth.headers);
	}

	const response = await requestUrl({ url: `${apiUrl}/models`, method: "GET", headers, throw: false });

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Model discovery failed for ${providerId}: ${response.text || `status ${response.status}`}`);
	}

	const payload = response.json as OpenAIModelResponse;
	return Array.isArray(payload.data) ? payload.data : [];
}

/**
 * Tries to fetch /v1/models/status, an extension some OpenAI-compatible servers expose
 * (e.g. OMLX) that carries an authoritative model_type per entry.
 * Returns a map of model id → model_type, or null if the endpoint is unavailable.
 */
async function fetchModelTypeMap(auth: AuthObject, defaultBaseUrl: string): Promise<Map<string, string> | null> {
	const apiUrl = `${sanitizeBaseUrl(auth.baseUrl || defaultBaseUrl)}/v1`;
	const headers: Record<string, string> = { "Content-Type": "application/json" };

	if (auth.apiKey) {
		headers.Authorization = `Bearer ${auth.apiKey}`;
	}
	if (auth.headers) {
		Object.assign(headers, auth.headers);
	}

	try {
		const response = await requestUrl({ url: `${apiUrl}/models/status`, method: "GET", headers, throw: false });
		if (response.status < 200 || response.status >= 300) return null;

		const payload = response.json as ModelsStatusResponse;
		if (!Array.isArray(payload.models)) return null;

		const map = new Map<string, string>();
		for (const entry of payload.models) {
			if (entry.id && entry.model_type) {
				map.set(entry.id, entry.model_type);
			}
		}
		return map.size > 0 ? map : null;
	} catch {
		return null;
	}
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
		createSubAgentChatInstance: (auth: AuthObject, modelId: string, options?: Partial<ChatModelConfig>) => {
			const resolvedBaseUrl = sanitizeBaseUrl(auth.baseUrl || defaultBaseUrl);
			const configuration: Record<string, unknown> = { baseURL: `${resolvedBaseUrl}/v1` };
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
			return createBufferedTransportedChatOpenAI(
				config.id,
				chatConfig as ConstructorParameters<typeof ChatOpenAI>[0],
			);
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
			const [entries, typeMap] = await Promise.all([
				fetchModelEntries(auth, config.id, defaultBaseUrl),
				fetchModelTypeMap(auth, defaultBaseUrl),
			]);
			return entries
				.filter((r) => {
					if (!r.id) return false;
					if (typeMap) return typeMap.get(r.id) !== "embedding";
					return !isEmbeddingEntry(r);
				})
				.map((r) => r.id as string);
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

			return createTransportedOpenAIEmbeddings(config.id, embeddingConfig);
		},
		discoverEmbeddingModels: async (auth: AuthObject): Promise<string[]> => {
			const [entries, typeMap] = await Promise.all([
				fetchModelEntries(auth, config.id, defaultBaseUrl),
				fetchModelTypeMap(auth, defaultBaseUrl),
			]);
			return entries
				.filter((r) => {
					if (!r.id) return false;
					if (typeMap) return typeMap.get(r.id) === "embedding";
					return isEmbeddingEntry(r);
				})
				.map((r) => r.id as string);
		},
	} satisfies EmbeddingProviderDefinition;
}
