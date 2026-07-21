import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

const { createAgentMock, summarizationMiddlewareMock } = vi.hoisted(() => ({
	createAgentMock: vi.fn(() => ({ invoke: vi.fn(), streamEvents: vi.fn() })),
	summarizationMiddlewareMock: vi.fn((config: unknown) => ({ kind: "summary", config })),
}));

vi.mock("langchain", () => ({
	createAgent: createAgentMock,
	summarizationMiddleware: summarizationMiddlewareMock,
}));

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Agent } from "../../src/agent/Agent";

function makeRegistry() {
	return {
		createChatInstance: vi.fn((provider: string, model: string) => ({
			provider,
			model,
			invoke: vi.fn(),
		})) as unknown as (provider: string, model: string) => BaseChatModel,
	};
}

const BASE_RESOLVE_PARAMS = {
	cacheKey: "test-key",
	systemPrompt: "You are a helpful assistant.",
	tools: [] as const,
	subAgents: [] as const,
} as const;

describe("Agent summarization middleware", () => {
	beforeEach(() => {
		createAgentMock.mockClear();
		summarizationMiddlewareMock.mockClear();
	});

	it("uses the configured summarization model when provided", async () => {
		const registry = makeRegistry();
		const agent = new Agent({ registry: registry as never });

		await agent.resolveRun({
			...BASE_RESOLVE_PARAMS,
			provider: "openai",
			chatModel: "gpt-4o",
			options: { contextWindow: 100_000 },
			summarizationModel: {
				provider: "openai",
				chatModel: "gpt-4o-mini",
				options: { contextWindow: 100_000 },
			},
		});

		expect(summarizationMiddlewareMock).toHaveBeenCalledTimes(1);
		expect((summarizationMiddlewareMock.mock.calls[0] ?? [])[0]).toMatchObject({
			trigger: { tokens: 80_000, messages: 14 },
			keep: { messages: 12 },
		});
		expect(registry.createChatInstance).toHaveBeenCalledWith("openai", "gpt-4o-mini", { contextWindow: 100_000 });
		expect(createAgentMock).toHaveBeenCalledWith(
			expect.objectContaining({
				middleware: [expect.objectContaining({ kind: "summary" })],
			}),
		);
	});

	it("falls back to the active chat model for summarization when no explicit summarization model is set", async () => {
		const registry = makeRegistry();
		const agent = new Agent({ registry: registry as never });

		await agent.resolveRun({
			...BASE_RESOLVE_PARAMS,
			cacheKey: "test-key-2",
			provider: "anthropic",
			chatModel: "claude-sonnet",
			options: { contextWindow: 50_000 },
		});

		expect(summarizationMiddlewareMock).toHaveBeenCalledTimes(1);
		expect(registry.createChatInstance).toHaveBeenCalledTimes(1);
		expect((summarizationMiddlewareMock.mock.calls[0] ?? [])[0]).toMatchObject({
			trigger: { tokens: 40_000, messages: 14 },
			keep: { messages: 12 },
		});
	});

	it("skips summarization middleware when the context window is unknown", async () => {
		const registry = makeRegistry();
		const agent = new Agent({ registry: registry as never });

		await agent.resolveRun({
			...BASE_RESOLVE_PARAMS,
			cacheKey: "test-key-3",
			provider: "openai",
			chatModel: "gpt-4o",
			options: {},
		});

		expect(summarizationMiddlewareMock).not.toHaveBeenCalled();
		expect(createAgentMock).toHaveBeenCalledWith(
			expect.objectContaining({
				middleware: [],
			}),
		);
	});
});

describe("Agent stream tool output normalization", () => {
	it("unwraps tool-message-like output wrappers", () => {
		const agent = new Agent({ registry: makeRegistry() as never });

		const output = (
			agent as unknown as {
				normalizeStreamToolOutput: (rawOutput: unknown) => unknown;
			}
		).normalizeStreamToolOutput({
			content: [{ type: "text", text: "Found 3 results" }],
			artifact: { totalResults: 3 },
			status: "success",
		});

		expect(output).toEqual([{ type: "text", text: "Found 3 results" }]);
	});

	it("preserves missing tool output as undefined", () => {
		const agent = new Agent({ registry: makeRegistry() as never });

		const output = (
			agent as unknown as {
				normalizeStreamToolOutput: (rawOutput: unknown) => unknown;
			}
		).normalizeStreamToolOutput(undefined);

		expect(output).toBeUndefined();
	});
});
