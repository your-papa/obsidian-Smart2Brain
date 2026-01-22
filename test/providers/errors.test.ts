/**
 * Tests for provider error classes
 *
 * These tests verify the structure and behavior of custom error classes
 * used throughout the provider system for consistent error handling.
 */
import { describe, expect, it } from "vitest";
import {
	ModelNotFoundError,
	ProviderAuthError,
	ProviderEndpointError,
	ProviderRegistryError,
} from "../../src/providers/errors.ts";

describe("ProviderRegistryError", () => {
	it("should be an instance of Error", () => {
		const error = new ProviderRegistryError("Test error");
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ProviderRegistryError);
	});

	it("should set the message correctly", () => {
		const error = new ProviderRegistryError("Test error message");
		expect(error.message).toBe("Test error message");
	});

	it("should set the name property", () => {
		const error = new ProviderRegistryError("Test");
		expect(error.name).toBe("ProviderRegistryError");
	});

	it("should have a stack trace", () => {
		const error = new ProviderRegistryError("Test");
		expect(error.stack).toBeDefined();
		expect(typeof error.stack).toBe("string");
	});
});

describe("ProviderAuthError", () => {
	it("should be an instance of ProviderRegistryError", () => {
		const error = new ProviderAuthError("openai", 401);
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ProviderRegistryError);
		expect(error).toBeInstanceOf(ProviderAuthError);
	});

	it("should set the name property", () => {
		const error = new ProviderAuthError("openai", 401);
		expect(error.name).toBe("ProviderAuthError");
	});

	it("should format message with provider and status", () => {
		const error = new ProviderAuthError("openai", 401);
		expect(error.message).toContain("openai");
		expect(error.message).toContain("401");
		expect(error.message).toContain("Authentication failed");
	});

	it("should include error code when provided", () => {
		const error = new ProviderAuthError("openai", 401, "invalid_api_key");
		expect(error.message).toContain("invalid_api_key");
	});

	it("should include custom message when provided", () => {
		const error = new ProviderAuthError("openai", 401, undefined, "API key is invalid");
		expect(error.message).toContain("API key is invalid");
	});

	it("should include both code and message when both provided", () => {
		const error = new ProviderAuthError("anthropic", 403, "insufficient_quota", "Your account has no credits");
		expect(error.message).toContain("anthropic");
		expect(error.message).toContain("403");
		expect(error.message).toContain("insufficient_quota");
		expect(error.message).toContain("Your account has no credits");
	});

	it("should handle different providers", () => {
		const openaiError = new ProviderAuthError("openai", 401);
		const anthropicError = new ProviderAuthError("anthropic", 401);
		const ollamaError = new ProviderAuthError("ollama", 401);

		expect(openaiError.message).toContain("openai");
		expect(anthropicError.message).toContain("anthropic");
		expect(ollamaError.message).toContain("ollama");
	});

	it("should handle various HTTP status codes", () => {
		const error401 = new ProviderAuthError("openai", 401);
		const error403 = new ProviderAuthError("openai", 403);
		const error429 = new ProviderAuthError("openai", 429);

		expect(error401.message).toContain("401");
		expect(error403.message).toContain("403");
		expect(error429.message).toContain("429");
	});
});

describe("ProviderEndpointError", () => {
	it("should be an instance of ProviderRegistryError", () => {
		const error = new ProviderEndpointError("openai", "Connection refused");
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ProviderRegistryError);
		expect(error).toBeInstanceOf(ProviderEndpointError);
	});

	it("should set the name property", () => {
		const error = new ProviderEndpointError("openai", "Connection refused");
		expect(error.name).toBe("ProviderEndpointError");
	});

	it("should format message with provider and error message", () => {
		const error = new ProviderEndpointError("ollama", "Connection refused");
		expect(error.message).toContain("ollama");
		expect(error.message).toContain("Connection refused");
		expect(error.message).toContain("Endpoint error");
	});

	it("should include status when provided", () => {
		const error = new ProviderEndpointError("openai", "Service unavailable", 503);
		expect(error.message).toContain("503");
		expect(error.message).toContain("Service unavailable");
	});

	it("should handle missing status gracefully", () => {
		const error = new ProviderEndpointError("openai", "Network error");
		expect(error.message).toContain("openai");
		expect(error.message).toContain("Network error");
		// Should not contain "status" when status is not provided
		expect(error.message.match(/status \d+/)).toBeNull();
	});

	it("should handle different providers", () => {
		const openaiError = new ProviderEndpointError("openai", "Timeout");
		const ollamaError = new ProviderEndpointError("ollama", "Server not running");
		const customError = new ProviderEndpointError("my-custom-provider", "Invalid endpoint");

		expect(openaiError.message).toContain("openai");
		expect(ollamaError.message).toContain("ollama");
		expect(customError.message).toContain("my-custom-provider");
	});
});

describe("ModelNotFoundError", () => {
	it("should be an instance of ProviderRegistryError", () => {
		const error = new ModelNotFoundError("openai", "gpt-5", "chat");
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ProviderRegistryError);
		expect(error).toBeInstanceOf(ModelNotFoundError);
	});

	it("should set the name property", () => {
		const error = new ModelNotFoundError("openai", "gpt-5", "chat");
		expect(error.name).toBe("ModelNotFoundError");
	});

	it("should format message with provider, model, and type", () => {
		const error = new ModelNotFoundError("openai", "gpt-5", "chat");
		expect(error.message).toContain("openai");
		expect(error.message).toContain("gpt-5");
		expect(error.message).toContain("chat");
		expect(error.message.toLowerCase()).toContain("not found");
	});

	it("should handle chat model type", () => {
		const error = new ModelNotFoundError("openai", "gpt-4o", "chat");
		expect(error.message).toContain("chat");
		expect(error.message).toContain("gpt-4o");
	});

	it("should handle embedding model type", () => {
		const error = new ModelNotFoundError("openai", "text-embedding-3-small", "embedding");
		expect(error.message).toContain("embedding");
		expect(error.message).toContain("text-embedding-3-small");
	});

	it("should handle different providers", () => {
		const openaiError = new ModelNotFoundError("openai", "gpt-4o", "chat");
		const anthropicError = new ModelNotFoundError("anthropic", "claude-3-opus", "chat");
		const ollamaError = new ModelNotFoundError("ollama", "llama3", "chat");

		expect(openaiError.message).toContain("openai");
		expect(anthropicError.message).toContain("anthropic");
		expect(ollamaError.message).toContain("ollama");
	});

	it("should handle various model names", () => {
		const models = [
			"gpt-4o",
			"gpt-4o-mini",
			"claude-3-5-sonnet-20241022",
			"llama3.1:70b",
			"text-embedding-3-large",
			"nomic-embed-text",
		];

		for (const model of models) {
			const error = new ModelNotFoundError("test", model, "chat");
			expect(error.message).toContain(model);
		}
	});
});

describe("Error inheritance hierarchy", () => {
	it("should have correct inheritance chain for ProviderAuthError", () => {
		const error = new ProviderAuthError("openai", 401);

		// Check inheritance
		expect(error instanceof ProviderAuthError).toBe(true);
		expect(error instanceof ProviderRegistryError).toBe(true);
		expect(error instanceof Error).toBe(true);
	});

	it("should have correct inheritance chain for ProviderEndpointError", () => {
		const error = new ProviderEndpointError("openai", "Connection refused");

		// Check inheritance
		expect(error instanceof ProviderEndpointError).toBe(true);
		expect(error instanceof ProviderRegistryError).toBe(true);
		expect(error instanceof Error).toBe(true);
	});

	it("should have correct inheritance chain for ModelNotFoundError", () => {
		const error = new ModelNotFoundError("openai", "gpt-5", "chat");

		// Check inheritance
		expect(error instanceof ModelNotFoundError).toBe(true);
		expect(error instanceof ProviderRegistryError).toBe(true);
		expect(error instanceof Error).toBe(true);
	});

	it("should allow catching all provider errors with ProviderRegistryError", () => {
		const errors = [
			new ProviderAuthError("openai", 401),
			new ProviderEndpointError("ollama", "Connection refused"),
			new ModelNotFoundError("anthropic", "claude-5", "chat"),
		];

		for (const error of errors) {
			expect(error instanceof ProviderRegistryError).toBe(true);
		}
	});

	it("should allow type-checking specific error types", () => {
		const error: Error = new ProviderAuthError("openai", 401);

		if (error instanceof ProviderAuthError) {
			// TypeScript should narrow the type here
			expect(error.name).toBe("ProviderAuthError");
		}

		const endpointError: Error = new ProviderEndpointError("ollama", "Connection refused");

		if (endpointError instanceof ProviderEndpointError) {
			expect(endpointError.name).toBe("ProviderEndpointError");
		}
	});
});

describe("Error usage patterns", () => {
	it("should be usable in try-catch blocks", () => {
		const throwAuthError = () => {
			throw new ProviderAuthError("openai", 401, "invalid_api_key");
		};

		expect(throwAuthError).toThrow(ProviderAuthError);
		expect(throwAuthError).toThrow(ProviderRegistryError);
		expect(throwAuthError).toThrow(Error);
	});

	it("should be usable for discriminating error types", () => {
		const errors = [
			new ProviderAuthError("openai", 401),
			new ProviderEndpointError("ollama", "Connection refused"),
			new ModelNotFoundError("anthropic", "claude-5", "chat"),
		];

		const errorTypes = errors.map((error) => {
			if (error instanceof ProviderAuthError) return "auth";
			if (error instanceof ProviderEndpointError) return "endpoint";
			if (error instanceof ModelNotFoundError) return "model";
			return "unknown";
		});

		expect(errorTypes).toEqual(["auth", "endpoint", "model"]);
	});

	it("should preserve stack trace for debugging", () => {
		const createError = () => {
			return new ProviderAuthError("openai", 401);
		};

		const error = createError();
		expect(error.stack).toBeDefined();
		expect(error.stack).toContain("ProviderAuthError");
	});

	it("should be serializable to JSON for logging", () => {
		const error = new ProviderAuthError("openai", 401, "invalid_api_key", "API key is invalid");

		// Errors can be serialized (though stack is not included by default)
		const serialized = JSON.stringify({
			name: error.name,
			message: error.message,
		});

		const parsed = JSON.parse(serialized);
		expect(parsed.name).toBe("ProviderAuthError");
		expect(parsed.message).toContain("openai");
	});
});
