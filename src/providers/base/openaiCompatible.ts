/**
 * OpenAI-compatible base runtime
 *
 * Factory functions for creating LangChain models for OpenAI-compatible APIs.
 * Used by the OpenAI built-in provider and custom OpenAI-compatible providers.
 */

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ProviderAuthError, ProviderEndpointError } from "../errors";
import type { AuthValidationResult, ChatModelConfig, DiscoveredModels, RuntimeFieldBasedAuthState } from "../types";

/**
 * Creates a LangChain ChatOpenAI instance.
 *
 * @param modelId - The model ID (e.g., "gpt-4o", "gpt-4o-mini")
 * @param auth - Runtime authentication state with resolved secrets
 * @param options - Optional model configuration (temperature, etc.)
 * @returns Promise resolving to a ChatOpenAI instance
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { apiKey: "sk-...", baseUrl: "https://api.openai.com/v1" },
 * };
 * const model = await createOpenAIChatModel("gpt-4o", auth, { temperature: 0.7 });
 * const response = await model.invoke("Hello!");
 * ```
 */
export async function createOpenAIChatModel(
	modelId: string,
	auth: RuntimeFieldBasedAuthState,
	options?: ChatModelConfig,
): Promise<ChatOpenAI> {
	const config: Record<string, unknown> = {
		model: modelId,
		apiKey: auth.values.apiKey,
	};

	// Add temperature if provided
	if (options?.temperature !== undefined) {
		config.temperature = options.temperature;
	}

	// Add baseUrl configuration if provided and not empty
	const baseUrl = auth.values.baseUrl;
	if (baseUrl && baseUrl.trim() !== "") {
		config.configuration = {
			baseURL: sanitizeBaseUrl(baseUrl),
		};
	}

	return new ChatOpenAI(config);
}

/**
 * Creates a LangChain OpenAIEmbeddings instance.
 *
 * @param modelId - The model ID (e.g., "text-embedding-3-small", "text-embedding-ada-002")
 * @param auth - Runtime authentication state with resolved secrets
 * @returns Promise resolving to an OpenAIEmbeddings instance
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { apiKey: "sk-...", baseUrl: "https://api.openai.com/v1" },
 * };
 * const model = await createOpenAIEmbeddingModel("text-embedding-3-small", auth);
 * const vectors = await model.embedQuery("Hello world!");
 * ```
 */
export async function createOpenAIEmbeddingModel(
	modelId: string,
	auth: RuntimeFieldBasedAuthState,
): Promise<OpenAIEmbeddings> {
	const config: Record<string, unknown> = {
		model: modelId,
		apiKey: auth.values.apiKey,
	};

	// Add baseUrl configuration if provided and not empty
	const baseUrl = auth.values.baseUrl;
	if (baseUrl && baseUrl.trim() !== "") {
		config.configuration = {
			baseURL: sanitizeBaseUrl(baseUrl),
		};
	}

	return new OpenAIEmbeddings(config);
}

/**
 * Removes trailing slashes from a URL.
 * @param url - The URL to sanitize
 * @returns URL with trailing slashes removed
 */
function sanitizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

// Default base URL for OpenAI API
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Discovers available models from an OpenAI-compatible API.
 *
 * Makes a GET request to /models endpoint and categorizes models into
 * chat and embedding models based on their names.
 *
 * @param auth - Runtime authentication state with resolved secrets
 * @returns Promise resolving to DiscoveredModels with chat and embedding arrays
 * @throws ProviderAuthError if authentication fails (401, 403, or invalid_api_key)
 * @throws ProviderEndpointError if network request fails
 * @throws Error if API key is missing or other errors occur
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { apiKey: "sk-...", baseUrl: "https://api.openai.com/v1" },
 * };
 * const models = await discoverOpenAIModels(auth);
 * // models.chat = ["gpt-4o", "gpt-4o-mini", ...]
 * // models.embedding = ["text-embedding-3-small", ...]
 * ```
 */
export async function discoverOpenAIModels(auth: RuntimeFieldBasedAuthState): Promise<DiscoveredModels> {
	const apiKey = auth.values.apiKey;
	if (!apiKey) {
		throw new Error("OpenAI model discovery requires an API key.");
	}

	const baseUrl =
		auth.values.baseUrl && auth.values.baseUrl.trim() !== ""
			? sanitizeBaseUrl(auth.values.baseUrl)
			: OPENAI_DEFAULT_BASE_URL;

	let response: Response;
	try {
		response = await globalThis.fetch(`${baseUrl}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		});
	} catch (error) {
		throw toEndpointError(error);
	}

	if (!response.ok) {
		const errorBody = await safeReadText(response);
		let errorCode: string | undefined;
		let errorMessage: string | undefined;
		try {
			const parsed = errorBody
				? (JSON.parse(errorBody) as {
						error?: { code?: string; message?: string };
					})
				: undefined;
			errorCode = parsed?.error?.code;
			errorMessage = parsed?.error?.message;
		} catch {
			// ignore parse errors
		}

		if (response.status === 401 || response.status === 403 || errorCode === "invalid_api_key") {
			throw new ProviderAuthError("openai", response.status, errorCode, errorMessage);
		}
		throw new Error(
			`OpenAI model discovery failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
		);
	}

	const payload = (await response.json()) as OpenAIModelResponse;
	const resources = Array.isArray(payload.data) ? payload.data : [];

	const models: string[] = [];

	for (const resource of resources) {
		const id = typeof resource?.id === "string" ? resource.id.trim() : undefined;
		if (!id) {
			continue;
		}

		models.push(id);
	}

	// Return all models in both arrays - let users choose which model to use for each purpose
	return { chat: models, embedding: models };
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

/**
 * Converts an error to a ProviderEndpointError.
 */
function toEndpointError(error: unknown): Error {
	if (error instanceof ProviderEndpointError) {
		return error;
	}
	const message = error instanceof Error ? error.message : String(error);
	return new ProviderEndpointError("openai", message);
}

/**
 * OpenAI API models response structure.
 */
interface OpenAIModelResponse {
	data?: OpenAIModelResource[];
}

/**
 * OpenAI API model resource structure.
 */
interface OpenAIModelResource {
	id?: string;
	object?: string;
}

/**
 * Validates OpenAI authentication credentials by making a test API call.
 *
 * Makes a GET request to the /models endpoint to verify the API key is valid.
 * This is the same endpoint used for model discovery, so it validates both
 * the API key and the baseUrl configuration.
 *
 * @param auth - Runtime authentication state with resolved secrets
 * @returns Promise resolving to AuthValidationResult ({ valid: true } or { valid: false, error: string })
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { apiKey: "sk-...", baseUrl: "https://api.openai.com/v1" },
 * };
 * const result = await validateOpenAIAuth(auth);
 * if (result.valid) {
 *   console.log("Authentication successful!");
 * } else {
 *   console.error("Auth failed:", result.error);
 * }
 * ```
 */
export async function validateOpenAIAuth(auth: RuntimeFieldBasedAuthState): Promise<AuthValidationResult> {
	const apiKey = auth.values.apiKey?.trim();
	if (!apiKey) {
		return { valid: false, error: "API key is required" };
	}

	const baseUrl =
		auth.values.baseUrl && auth.values.baseUrl.trim() !== ""
			? sanitizeBaseUrl(auth.values.baseUrl)
			: OPENAI_DEFAULT_BASE_URL;

	let response: Response;
	try {
		response = await globalThis.fetch(`${baseUrl}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { valid: false, error: `Connection failed: ${message}` };
	}

	if (response.ok) {
		return { valid: true };
	}

	// Handle error response
	const errorBody = await safeReadText(response);
	let errorCode: string | undefined;
	let errorMessage: string | undefined;
	try {
		const parsed = errorBody
			? (JSON.parse(errorBody) as {
					error?: { code?: string; message?: string };
				})
			: undefined;
		errorCode = parsed?.error?.code;
		errorMessage = parsed?.error?.message;
	} catch {
		// ignore parse errors
	}

	// Build error message
	if (response.status === 401 || response.status === 403 || errorCode === "invalid_api_key") {
		const detail = errorMessage || `Authentication failed (${response.status})`;
		return { valid: false, error: detail };
	}

	// Other errors
	const detail = errorMessage || errorBody || `Request failed with status ${response.status}`;
	return { valid: false, error: detail };
}
