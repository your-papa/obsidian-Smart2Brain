/**
 * Mock for @sap-ai-sdk/langchain
 *
 * This is an optional dependency that's dynamically imported.
 * The mock provides minimal implementations for tests.
 */

import { vi } from "vitest";

export const AzureOpenAiChatClient = vi.fn().mockImplementation(() => ({
	invoke: vi.fn().mockResolvedValue({ content: "mocked response" }),
}));

export const AzureOpenAiEmbeddingClient = vi.fn().mockImplementation(() => ({
	embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
	embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
}));
