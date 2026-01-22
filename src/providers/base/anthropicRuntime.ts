/**
 * Anthropic base runtime
 *
 * Factory functions for creating LangChain models for Anthropic API.
 * Used by the Anthropic built-in provider.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ProviderAuthError, ProviderEndpointError } from "../errors";
import type { AuthValidationResult, ChatModelConfig, DiscoveredModels, RuntimeFieldBasedAuthState } from "../types";

// Default base URL for Anthropic API
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

// Anthropic API version header value
const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Creates a LangChain ChatAnthropic instance.
 *
 * @param modelId - The model ID (e.g., "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022")
 * @param auth - Runtime authentication state with resolved secrets
 * @param options - Optional model configuration (temperature, etc.)
 * @returns Promise resolving to a ChatAnthropic instance
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { apiKey: "sk-ant-..." },
 * };
 * const model = await createAnthropicChatModel("claude-3-5-sonnet-20241022", auth, { temperature: 0.7 });
 * const response = await model.invoke("Hello!");
 * ```
 */
export async function createAnthropicChatModel(
	modelId: string,
	auth: RuntimeFieldBasedAuthState,
	options?: ChatModelConfig,
): Promise<ChatAnthropic> {
	const config: Record<string, unknown> = {
		model: modelId,
		apiKey: auth.values.apiKey,
	};

	// Add temperature if provided
	if (options?.temperature !== undefined) {
		config.temperature = options.temperature;
	}

	return new ChatAnthropic(config);
}

/**
 * Validates Anthropic authentication credentials by making a test API call.
 *
 * Makes a POST request to the /v1/messages endpoint with a minimal payload
 * to verify the API key is valid. This is the standard Anthropic endpoint
 * for chat completions.
 *
 * @param auth - Runtime authentication state with resolved secrets
 * @returns Promise resolving to AuthValidationResult ({ valid: true } or { valid: false, error: string })
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { apiKey: "sk-ant-..." },
 * };
 * const result = await validateAnthropicAuth(auth);
 * if (result.valid) {
 *   console.log("Authentication successful!");
 * } else {
 *   console.error("Auth failed:", result.error);
 * }
 * ```
 */
export async function validateAnthropicAuth(auth: RuntimeFieldBasedAuthState): Promise<AuthValidationResult> {
	const apiKey = auth.values.apiKey?.trim();
	if (!apiKey) {
		return { valid: false, error: "API key is required" };
	}

	let response: Response;
	try {
		response = await globalThis.fetch(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`, {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": ANTHROPIC_API_VERSION,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "claude-3-5-sonnet-20241022",
				max_tokens: 1,
				messages: [{ role: "user", content: "hi" }],
			}),
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
	let errorType: string | undefined;
	let errorMessage: string | undefined;
	try {
		const parsed = errorBody
			? (JSON.parse(errorBody) as {
					error?: { type?: string; message?: string };
				})
			: undefined;
		errorType = parsed?.error?.type;
		errorMessage = parsed?.error?.message;
	} catch {
		// ignore parse errors
	}

	// Build error message
	if (response.status === 401 || response.status === 403 || errorType === "authentication_error") {
		const detail = errorMessage || `Authentication failed (${response.status})`;
		return { valid: false, error: detail };
	}

	// Other errors
	const detail = errorMessage || errorBody || `Request failed with status ${response.status}`;
	return { valid: false, error: detail };
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
 * Response structure for Anthropic's /v1/models endpoint.
 */
interface AnthropicModelResponse {
	data: Array<{
		id: string;
		created_at?: string;
		display_name?: string;
		type?: string;
	}>;
	has_more?: boolean;
	first_id?: string;
	last_id?: string;
}

/**
 * Converts a fetch error to a ProviderEndpointError.
 */
function toEndpointError(error: unknown): ProviderEndpointError {
	if (error instanceof Error) {
		return new ProviderEndpointError("anthropic", error.message);
	}
	return new ProviderEndpointError("anthropic", String(error));
}

/**
 * Discovers available models from Anthropic API.
 *
 * Makes a GET request to /v1/models endpoint to list available models.
 * All Anthropic models are chat models - they don't offer embedding models.
 *
 * @param auth - Runtime authentication state with resolved secrets
 * @returns Promise resolving to DiscoveredModels with chat array and empty embedding array
 * @throws ProviderAuthError if authentication fails (401, 403)
 * @throws ProviderEndpointError if network request fails
 * @throws Error if API key is missing
 *
 * @example
 * ```typescript
 * const auth: RuntimeFieldBasedAuthState = {
 *   type: "field-based",
 *   values: { apiKey: "sk-ant-..." },
 * };
 * const models = await discoverAnthropicModels(auth);
 * // models.chat = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", ...]
 * // models.embedding = []
 * ```
 */
export async function discoverAnthropicModels(auth: RuntimeFieldBasedAuthState): Promise<DiscoveredModels> {
	const apiKey = auth.values.apiKey?.trim();
	if (!apiKey) {
		throw new Error("Anthropic model discovery requires an API key.");
	}

	let response: Response;
	try {
		response = await globalThis.fetch(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/models`, {
			method: "GET",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": ANTHROPIC_API_VERSION,
				"Content-Type": "application/json",
			},
		});
	} catch (error) {
		throw toEndpointError(error);
	}

	if (!response.ok) {
		const errorBody = await safeReadText(response);
		let errorType: string | undefined;
		let errorMessage: string | undefined;
		try {
			const parsed = errorBody
				? (JSON.parse(errorBody) as {
						error?: { type?: string; message?: string };
					})
				: undefined;
			errorType = parsed?.error?.type;
			errorMessage = parsed?.error?.message;
		} catch {
			// ignore parse errors
		}

		if (response.status === 401 || response.status === 403 || errorType === "authentication_error") {
			throw new ProviderAuthError("anthropic", response.status, errorType, errorMessage);
		}
		throw new Error(
			`Anthropic model discovery failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
		);
	}

	const payload = (await response.json()) as AnthropicModelResponse;
	const resources = Array.isArray(payload.data) ? payload.data : [];

	const chatModels: string[] = [];

	for (const resource of resources) {
		const id = typeof resource?.id === "string" ? resource.id.trim() : undefined;
		if (!id) {
			continue;
		}
		// All Anthropic models are chat models
		chatModels.push(id);
	}

	// Anthropic doesn't offer embedding models
	return { chat: chatModels, embedding: [] };
}
