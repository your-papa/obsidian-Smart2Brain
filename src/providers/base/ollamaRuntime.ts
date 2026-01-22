/**
 * Ollama base runtime
 *
 * Factory functions for creating LangChain models for Ollama.
 * Used by the Ollama built-in provider.
 *
 * Ollama is a local service that runs on the user's machine,
 * so it doesn't require an API key - only a baseUrl.
 */

import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { ProviderAuthError, ProviderEndpointError } from "../errors";
import type { AuthValidationResult, ChatModelConfig, DiscoveredModels, RuntimeFieldBasedAuthState } from "../types";

/**
 * Creates a LangChain ChatOllama instance.
 *
 * @param modelId - The model ID (e.g., "llama3.1", "mistral", "codellama")
 * @param auth - Runtime authentication state with resolved values (baseUrl optional)
 * @param options - Optional model configuration (temperature, contextWindow, etc.)
 * @returns Promise resolving to a ChatOllama instance
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { baseUrl: "http://localhost:11434" },
 * };
 * const model = await createOllamaChatModel("llama3.1", auth, { contextWindow: 8192 });
 * const response = await model.invoke("Hello!");
 * ```
 */
export async function createOllamaChatModel(
	modelId: string,
	auth: RuntimeFieldBasedAuthState,
	options?: ChatModelConfig,
): Promise<ChatOllama> {
	const config: Record<string, unknown> = {
		model: modelId,
	};

	// Add baseUrl configuration if provided and not empty
	const baseUrl = auth.values.baseUrl;
	if (baseUrl && baseUrl.trim() !== "") {
		config.baseUrl = sanitizeBaseUrl(baseUrl);
	}

	// Add temperature if provided
	if (options?.temperature !== undefined) {
		config.temperature = options.temperature;
	}

	// Add contextWindow as numCtx (Ollama-specific parameter)
	if (options?.contextWindow !== undefined) {
		config.numCtx = options.contextWindow;
	}

	return new ChatOllama(config);
}

/**
 * Creates a LangChain OllamaEmbeddings instance.
 *
 * @param modelId - The model ID (e.g., "nomic-embed-text", "mxbai-embed-large")
 * @param auth - Runtime authentication state with resolved values (baseUrl optional)
 * @returns Promise resolving to an OllamaEmbeddings instance
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { baseUrl: "http://localhost:11434" },
 * };
 * const model = await createOllamaEmbeddingModel("nomic-embed-text", auth);
 * const vectors = await model.embedQuery("Hello world!");
 * ```
 */
export async function createOllamaEmbeddingModel(
	modelId: string,
	auth: RuntimeFieldBasedAuthState,
): Promise<OllamaEmbeddings> {
	const config: Record<string, unknown> = {
		model: modelId,
	};

	// Add baseUrl configuration if provided and not empty
	const baseUrl = auth.values.baseUrl;
	if (baseUrl && baseUrl.trim() !== "") {
		config.baseUrl = sanitizeBaseUrl(baseUrl);
	}

	return new OllamaEmbeddings(config);
}

/**
 * Discovers available models from an Ollama server.
 *
 * Makes a GET request to /api/tags endpoint and categorizes models into
 * chat and embedding models based on their names.
 *
 * @param auth - Runtime authentication state with resolved values (baseUrl optional)
 * @returns Promise resolving to DiscoveredModels with chat and embedding arrays
 * @throws ProviderAuthError if authentication fails (401, 403)
 * @throws ProviderEndpointError if network request fails
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { baseUrl: "http://localhost:11434" },
 * };
 * const models = await discoverOllamaModels(auth);
 * // models.chat = ["llama3.1", "mistral", ...]
 * // models.embedding = ["nomic-embed-text", ...]
 * ```
 */
export async function discoverOllamaModels(auth: RuntimeFieldBasedAuthState): Promise<DiscoveredModels> {
	const baseUrl = auth.values.baseUrl?.trim();
	if (!baseUrl) {
		throw new Error("Ollama base URL is required");
	}
	const sanitizedUrl = sanitizeBaseUrl(baseUrl);

	let response: Response;
	try {
		response = await globalThis.fetch(`${sanitizedUrl}/api/tags`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		});
	} catch (error) {
		throw toEndpointError(error);
	}

	if (!response.ok) {
		const errorBody = await safeReadText(response);
		if (response.status === 401 || response.status === 403) {
			throw new ProviderAuthError("ollama", response.status, undefined, errorBody);
		}
		throw new Error(
			`Ollama model discovery failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
		);
	}

	const payload = (await response.json()) as OllamaTagsResponse;
	const models = Array.isArray(payload.models) ? payload.models : [];

	const chatModels: string[] = [];
	const embeddingModels: string[] = [];

	for (const model of models) {
		const name = typeof model?.name === "string" ? model.name.trim() : undefined;
		if (!name) {
			continue;
		}

		if (isEmbeddingModel(name)) {
			embeddingModels.push(name);
			continue;
		}

		chatModels.push(name);
	}

	return { chat: chatModels, embedding: embeddingModels };
}

/**
 * Validates Ollama connection by checking if the server is reachable.
 *
 * Makes a GET request to the /api/tags endpoint to verify the Ollama
 * server is running and accessible. Unlike other providers, Ollama
 * doesn't require an API key - just a working connection.
 *
 * @param auth - Runtime authentication state with resolved values (baseUrl optional)
 * @returns Promise resolving to AuthValidationResult ({ valid: true } or { valid: false, error: string })
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { baseUrl: "http://localhost:11434" },
 * };
 * const result = await validateOllamaConnection(auth);
 * if (result.valid) {
 *   console.log("Ollama server is reachable!");
 * } else {
 *   console.error("Connection failed:", result.error);
 * }
 * ```
 */
export async function validateOllamaConnection(auth: RuntimeFieldBasedAuthState): Promise<AuthValidationResult> {
	const baseUrl = auth.values.baseUrl?.trim();
	if (!baseUrl) {
		return { valid: false, error: "Server URL is required" };
	}
	const sanitizedUrl = sanitizeBaseUrl(baseUrl);

	let response: Response;
	try {
		response = await globalThis.fetch(`${sanitizedUrl}/api/tags`, {
			method: "GET",
			headers: {
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

	// Build error message
	if (response.status === 401 || response.status === 403) {
		const detail = errorBody || `Authentication failed (${response.status})`;
		return { valid: false, error: detail };
	}

	// Other errors
	const detail = errorBody || `Request failed with status ${response.status}`;
	return { valid: false, error: detail };
}

/**
 * Removes trailing slashes from a URL.
 * @param url - The URL to sanitize
 * @returns URL with trailing slashes removed
 */
function sanitizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

/**
 * Checks if a model is an embedding model based on its name.
 */
function isEmbeddingModel(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return normalized.includes("embedding") || normalized.includes("embed");
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
	return new ProviderEndpointError("ollama", message);
}

/**
 * Ollama API tags response structure.
 */
interface OllamaTagsResponse {
	models?: OllamaModelResource[];
}

/**
 * Ollama API model resource structure.
 */
interface OllamaModelResource {
	name?: string;
}
