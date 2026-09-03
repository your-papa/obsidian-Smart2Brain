import { describe, expect, it } from "vitest";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { createAgent } from "langchain";
import { createSubAgentMiddleware } from "deepagents/browser";
import { createNormalizedChatModel } from "../../src/providers/chatProviders";

/**
 * Regression for: `Invalid response from "wrapModelCall" in middleware
 * "subAgentMiddleware": expected AIMessage or Command, got object`.
 *
 * Some OpenAI-compatible endpoints (OpenRouter) make the underlying chat model
 * produce a result that is NOT a branded core AIMessage. The provider Proxy
 * (createNormalizedChatModel) now coerces it back to a real AIMessage so the
 * agent loop — and deepagents' subagent middleware — accept it.
 */

/**
 * Minimal chat model whose invoke() returns a PLAIN object (no core message
 * brand), mimicking the OpenRouter failure shape. Everything else delegates to a
 * no-op BaseChatModel implementation so it satisfies the LangChain interface.
 */
class UnbrandedResultModel extends BaseChatModel {
	_llmType() {
		return "unbranded-test";
	}
	// The agent invokes the (tool-bound) model; return a plain object.
	//
	// BaseChatModel.invoke is declared to return AIMessageChunk, and this deliberately
	// returns a plain AIMessage-shaped object instead — that mismatch IS the bug being
	// reproduced, so it is suppressed rather than fixed. Casting the return type would
	// hide the very shape the test exists to pin down.
	// @ts-expect-error - intentionally violates the AIMessageChunk return type (see above)
	async invoke(_input: BaseLanguageModelInput, _options?: unknown): Promise<AIMessage> {
		return {
			content: "final answer from unbranded model",
			type: "ai",
			tool_calls: [],
			additional_kwargs: {},
			response_metadata: {},
		} as unknown as AIMessage;
	}
	// biome-ignore lint/suspicious/noExplicitAny: interface stub
	async _generate(_messages: BaseMessage[], _options: any): Promise<any> {
		return { generations: [{ text: "x", message: new AIMessage("x") }] };
	}
	// bindTools must return something that still has our proxied invoke.
	// biome-ignore lint/suspicious/noExplicitAny: interface stub
	bindTools(_tools: any, _kwargs?: any): any {
		return this;
	}
}

describe("provider proxy coerces non-AIMessage model results (OpenRouter subagent bug)", () => {
	it("raw unbranded result fails AIMessage.isInstance (the trigger)", async () => {
		const raw = await new UnbrandedResultModel({}).invoke([new AIMessage("hi")]);
		expect(AIMessage.isInstance(raw as never)).toBe(false);
	});

	it("proxied invoke coerces the unbranded result into a valid AIMessage", async () => {
		// Same deliberate mismatch as the invoke() override above: this model is not a
		// valid BaseChatModel by design, which is the condition under test.
		// @ts-expect-error - intentionally non-conforming model (see UnbrandedResultModel)
		const proxied = createNormalizedChatModel(new UnbrandedResultModel({}));
		const result = await proxied.invoke([new AIMessage("hi")]);
		expect(AIMessage.isInstance(result as never)).toBe(true);
		expect((result as AIMessage).content).toBe("final answer from unbranded model");
	});

	it("agent + subAgentMiddleware run without 'expected AIMessage or Command, got object'", async () => {
		// Same deliberate mismatch as the invoke() override above: this model is not a
		// valid BaseChatModel by design, which is the condition under test.
		// @ts-expect-error - intentionally non-conforming model (see UnbrandedResultModel)
		const proxied = createNormalizedChatModel(new UnbrandedResultModel({}));
		const agent = createAgent({
			model: proxied as never,
			tools: [],
			systemPrompt: "parent",
			middleware: [
				createSubAgentMiddleware({
					defaultModel: proxied as never,
					defaultTools: [],
					generalPurposeAgent: false,
					subagents: [
						{ name: "Sub", description: "s", systemPrompt: "sub", model: proxied as never, tools: [] },
					],
				}),
			] as never,
		});

		const res = await agent.invoke({ messages: [new AIMessage("go")] } as never);
		expect(res).toBeTruthy();
	});
});
