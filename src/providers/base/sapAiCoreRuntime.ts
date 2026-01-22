/**
 * SAP AI Core runtime functions
 *
 * This module provides functions for:
 * - Creating chat models using SAP AI SDK's AzureOpenAiChatClient
 * - Creating embedding models using SAP AI SDK's AzureOpenAiEmbeddingClient
 * - Validating SAP AI Core authentication
 * - Discovering available models from SAP AI Core API
 *
 * NOTE: This module requires the optional @sap-ai-sdk/langchain package.
 * Users must install it separately: npm install @sap-ai-sdk/langchain
 *
 * SAP AI Core uses Azure OpenAI compatible APIs under the hood, but with
 * SAP-specific authentication and deployment URLs.
 */

import { ProviderAuthError, ProviderEndpointError, ProviderImportError } from "../errors";
import type { AuthValidationResult, ChatModelConfig, DiscoveredModels, RuntimeFieldBasedAuthState } from "../types";

// Dynamic imports for SAP AI SDK - this package is optional
// biome-ignore lint/suspicious/noExplicitAny: Dynamic import typing
let AzureOpenAiChatClient: any = null;
// biome-ignore lint/suspicious/noExplicitAny: Dynamic import typing
let AzureOpenAiEmbeddingClient: any = null;

/**
 * Dynamically loads the SAP AI SDK package.
 * This is called lazily when models are created to avoid import errors
 * for users who don't have the package installed.
 */
async function loadSapAiSdk(): Promise<void> {
	if (AzureOpenAiChatClient && AzureOpenAiEmbeddingClient) {
		return;
	}
	try {
		// @ts-ignore - Optional dependency, may not be installed
		const sdk = await import("@sap-ai-sdk/langchain");
		AzureOpenAiChatClient = sdk.AzureOpenAiChatClient;
		AzureOpenAiEmbeddingClient = sdk.AzureOpenAiEmbeddingClient;
	} catch {
		throw new ProviderImportError(
			"sap-ai-core",
			"@sap-ai-sdk/langchain",
			new Error("Package not installed. Run: npm install @sap-ai-sdk/langchain"),
		);
	}
}

/**
 * Creates a SAP AI Core chat model instance.
 *
 * @param modelId - The model identifier (e.g., "gpt-4o", "gpt-35-turbo")
 * @param auth - Runtime authentication state with apiKey, baseUrl, resourceGroup
 * @param config - Optional chat model configuration (temperature, contextWindow)
 * @returns Promise resolving to a LangChain-compatible chat model
 */
export async function createSapAiCoreChatModel(
	modelId: string,
	auth: RuntimeFieldBasedAuthState,
	config?: ChatModelConfig,
): Promise<unknown> {
	await loadSapAiSdk();

	if (!AzureOpenAiChatClient) {
		throw new ProviderImportError(
			"sap-ai-core",
			"@sap-ai-sdk/langchain",
			new Error("AzureOpenAiChatClient export missing"),
		);
	}

	const { apiKey, baseUrl, resourceGroup } = auth.values;

	// Build client options
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic SDK typing
	const clientOptions: any = {
		modelName: modelId,
	};

	// Apply configuration if provided
	if (config?.temperature !== undefined) {
		clientOptions.temperature = config.temperature;
	}

	// SAP AI SDK uses environment variables or explicit configuration
	// for authentication. We set the API key and base URL.
	if (baseUrl) {
		clientOptions.configuration = {
			baseURL: baseUrl,
		};
	}

	if (resourceGroup) {
		clientOptions.resourceGroup = resourceGroup;
	}

	// Pass API key in the configuration
	if (apiKey) {
		clientOptions.configuration = {
			...clientOptions.configuration,
			apiKey,
		};
	}

	return new AzureOpenAiChatClient(clientOptions);
}

/**
 * Creates a SAP AI Core embedding model instance.
 *
 * @param modelId - The model identifier (e.g., "text-embedding-ada-002")
 * @param auth - Runtime authentication state with apiKey, baseUrl, resourceGroup
 * @returns Promise resolving to a LangChain-compatible embeddings model
 */
export async function createSapAiCoreEmbeddingModel(
	modelId: string,
	auth: RuntimeFieldBasedAuthState,
): Promise<unknown> {
	await loadSapAiSdk();

	if (!AzureOpenAiEmbeddingClient) {
		throw new ProviderImportError(
			"sap-ai-core",
			"@sap-ai-sdk/langchain",
			new Error("AzureOpenAiEmbeddingClient export missing"),
		);
	}

	const { apiKey, baseUrl, resourceGroup } = auth.values;

	// Build client options
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic SDK typing
	const clientOptions: any = {
		modelName: modelId,
	};

	if (baseUrl) {
		clientOptions.configuration = {
			baseURL: baseUrl,
		};
	}

	if (resourceGroup) {
		clientOptions.resourceGroup = resourceGroup;
	}

	if (apiKey) {
		clientOptions.configuration = {
			...clientOptions.configuration,
			apiKey,
		};
	}

	return new AzureOpenAiEmbeddingClient(clientOptions);
}

/**
 * Validates SAP AI Core authentication by making a test API call.
 *
 * @param auth - Runtime authentication state with apiKey and baseUrl
 * @returns Promise resolving to validation result
 */
export async function validateSapAiCoreAuth(auth: RuntimeFieldBasedAuthState): Promise<AuthValidationResult> {
	const { apiKey, baseUrl } = auth.values;

	if (!apiKey?.trim()) {
		return { valid: false, error: "API token is required" };
	}

	if (!baseUrl?.trim()) {
		return { valid: false, error: "Deployment URL is required" };
	}

	// Sanitize the base URL
	const sanitizedBaseUrl = baseUrl.replace(/\/+$/, "");

	try {
		// Make a test request to the foundation-models endpoint
		const response = await fetch(`${sanitizedBaseUrl}/foundation-models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
		});

		if (response.status === 401 || response.status === 403) {
			const errorBody = await safeReadText(response);
			throw new ProviderAuthError("sap-ai-core", response.status, undefined, errorBody);
		}

		if (!response.ok) {
			const errorBody = await safeReadText(response);
			return {
				valid: false,
				error: `API request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
			};
		}

		return { valid: true };
	} catch (error) {
		if (error instanceof ProviderAuthError) {
			return { valid: false, error: error.message };
		}
		if (error instanceof ProviderEndpointError) {
			return { valid: false, error: error.message };
		}
		const message = error instanceof Error ? error.message : String(error);
		return { valid: false, error: `Connection error: ${message}` };
	}
}

/**
 * Discovers available models from SAP AI Core API.
 *
 * @param auth - Runtime authentication state with apiKey and baseUrl
 * @returns Promise resolving to discovered models
 */
export async function discoverSapAiCoreModels(auth: RuntimeFieldBasedAuthState): Promise<DiscoveredModels> {
	const { apiKey, baseUrl } = auth.values;

	if (!apiKey?.trim()) {
		throw new Error("API token is required for model discovery");
	}

	if (!baseUrl?.trim()) {
		throw new Error("Deployment URL is required for model discovery");
	}

	const sanitizedBaseUrl = baseUrl.replace(/\/+$/, "");

	let response: Response;
	try {
		response = await fetch(`${sanitizedBaseUrl}/foundation-models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
		});
	} catch (error) {
		throw new ProviderEndpointError("sap-ai-core", error instanceof Error ? error.message : String(error));
	}

	if (response.status === 401 || response.status === 403) {
		const errorBody = await safeReadText(response);
		throw new ProviderAuthError("sap-ai-core", response.status, undefined, errorBody);
	}

	if (!response.ok) {
		const errorBody = await safeReadText(response);
		throw new Error(
			`SAP AI Core model discovery failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
		);
	}

	const payload = (await response.json()) as SapAiCoreFoundationResponse;
	const items = extractFoundationModels(payload);

	const chatModels: string[] = [];
	const embeddingModels: string[] = [];

	for (const item of items) {
		const name = getModelName(item);
		if (!name) {
			continue;
		}

		if (looksLikeEmbeddingModel(name, item)) {
			embeddingModels.push(name);
		} else {
			chatModels.push(name);
		}
	}

	return {
		chat: chatModels,
		embedding: embeddingModels,
	};
}

// ============================================================================
// Helper functions
// ============================================================================

interface SapAiCoreFoundationResponse {
	value?: Array<Record<string, unknown>>;
	items?: Array<Record<string, unknown>>;
	models?: Array<Record<string, unknown>>;
}

function extractFoundationModels(payload: SapAiCoreFoundationResponse): Array<Record<string, unknown>> {
	if (Array.isArray(payload.value)) {
		return payload.value;
	}
	if (Array.isArray(payload.items)) {
		return payload.items;
	}
	if (Array.isArray(payload.models)) {
		return payload.models;
	}
	return [];
}

function getModelName(model: Record<string, unknown>): string | undefined {
	const nameLike = model.name ?? model.id ?? model.modelName ?? model.model;
	if (typeof nameLike === "string" && nameLike.trim().length > 0) {
		return nameLike.trim();
	}
	return undefined;
}

function looksLikeEmbeddingModel(name: string, model: Record<string, unknown>): boolean {
	const normalized = name.toLowerCase();
	if (normalized.includes("embed") || normalized.includes("embedding")) {
		return true;
	}

	const capabilities = extractCapabilities(model);
	return (
		capabilities?.some((capability) => capability.includes("embedding") || capability.includes("vector")) ?? false
	);
}

function extractCapabilities(model: Record<string, unknown>): string[] | undefined {
	const capabilityField = model.capabilities ?? model.capability ?? model.tasks;
	if (!capabilityField) {
		return undefined;
	}

	if (Array.isArray(capabilityField)) {
		return capabilityField
			.map((value) => (typeof value === "string" ? value.toLowerCase() : undefined))
			.filter((value): value is string => Boolean(value));
	}

	if (typeof capabilityField === "string") {
		return [capabilityField.toLowerCase()];
	}

	return undefined;
}

async function safeReadText(response: Response): Promise<string | undefined> {
	try {
		return await response.text();
	} catch {
		return undefined;
	}
}
