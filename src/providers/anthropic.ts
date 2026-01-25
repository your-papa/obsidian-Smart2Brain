/**
 * Anthropic built-in provider definition
 *
 * This provider supports:
 * - Chat models (claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus, etc.)
 * - NO embedding models (Anthropic doesn't offer embeddings)
 * - Model discovery via Anthropic API (/v1/models)
 *
 * Authentication: apiKey (required), headers (optional)
 */

import { ChatAnthropic } from "@langchain/anthropic";
import AnthropicLogo from "../components/ui/logos/AnthropicLogo.svelte";
import type {
	AuthObject,
	AuthValidationResult,
	BaseProviderDefinition,
	ChatModelConfig,
} from "../types/provider/index";

// =============================================================================
// Constants
// =============================================================================

/** Default base URL for Anthropic API */
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

/** Anthropic API version header value */
const ANTHROPIC_API_VERSION = "2023-06-01";

// =============================================================================
// Helper Functions
// =============================================================================

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
// Types
// =============================================================================

interface AnthropicModelResponse {
	data: Array<{
		id: string;
		created_at?: string;
		display_name?: string;
		type?: string;
	}>;
	has_more?: boolean;
}

// =============================================================================
// Provider Definition
// =============================================================================

/**
 * Anthropic built-in provider definition.
 *
 * Supports chat models only (no embeddings).
 */
export const anthropicProvider: BaseProviderDefinition = {
	// =========================================================================
	// Identity
	// =========================================================================
	id: "anthropic",
	displayName: "Anthropic",
	logo: AnthropicLogo,

	// =========================================================================
	// Setup Instructions
	// =========================================================================
	setupInstructions: {
		steps: [
			"Create an API key from Anthropic's Console",
			"Ensure your Anthropic account has credits available",
			"Paste the API key below (starts with 'sk-ant-')",
		],
		link: {
			url: "https://console.anthropic.com/settings/keys",
			text: "Anthropic Console",
		},
	},

	// =========================================================================
	// Auth Configuration
	// =========================================================================
	auth: {
		apiKey: {
			label: "API Key",
			description: "Your Anthropic API key for authentication",
			kind: "secret",
			required: true,
			placeholder: "sk-ant-...",
		},
		headers: {
			label: "Custom Headers",
			description: "Additional headers as JSON (optional)",
			kind: "textarea",
			required: false,
			placeholder: '{"X-Custom-Header": "value"}',
		},
	},

	// =========================================================================
	// Runtime Methods
	// =========================================================================

	createChatInstance: (auth: AuthObject, modelId: string, options?: Partial<ChatModelConfig>) => {
		const config: Record<string, unknown> = {
			model: modelId,
			apiKey: auth.apiKey,
		};

		if (options?.temperature !== undefined) {
			config.temperature = options.temperature;
		}

		// Enable extended thinking for models that support it
		// Supported models: claude-sonnet-4-5, claude-sonnet-4, claude-haiku-4-5, claude-opus-4-5, claude-opus-4-1, claude-opus-4
		// This allows Claude to show its reasoning process
		// Budget tokens controls how much thinking is allowed (minimum: 1024, default: 10000)
		const supportsThinking =
			modelId.includes("sonnet-4") || modelId.includes("haiku-4-5") || modelId.includes("opus-4");

		if (supportsThinking && options?.enableThinking !== false) {
			config.thinking = {
				type: "enabled",
				budget_tokens: Math.max(1024, options?.thinkingBudget ?? 10000),
			};
		}

		return new ChatAnthropic(config);
	},

	validateAuth: async (auth: AuthObject): Promise<AuthValidationResult> => {
		if (!auth.apiKey?.trim()) {
			return { valid: false, error: "API key is required" };
		}

		let response: Response;
		try {
			response = await globalThis.fetch(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`, {
				method: "POST",
				headers: {
					"x-api-key": auth.apiKey,
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
				? (JSON.parse(errorBody) as { error?: { type?: string; message?: string } })
				: undefined;
			errorType = parsed?.error?.type;
			errorMessage = parsed?.error?.message;
		} catch {
			// ignore parse errors
		}

		if (response.status === 401 || response.status === 403 || errorType === "authentication_error") {
			return { valid: false, error: errorMessage || `Authentication failed (${response.status})` };
		}

		return { valid: false, error: errorMessage || errorBody || `Request failed with status ${response.status}` };
	},

	discoverModels: async (auth: AuthObject): Promise<string[]> => {
		if (!auth.apiKey?.trim()) {
			throw new Error("Anthropic model discovery requires an API key.");
		}

		const response = await globalThis.fetch(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/models`, {
			method: "GET",
			headers: {
				"x-api-key": auth.apiKey,
				"anthropic-version": ANTHROPIC_API_VERSION,
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			const errorBody = await safeReadText(response);
			throw new Error(`Model discovery failed: ${errorBody || response.statusText}`);
		}

		const payload = (await response.json()) as AnthropicModelResponse;
		const resources = Array.isArray(payload.data) ? payload.data : [];

		return resources.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.trim() !== "");
	},
};
