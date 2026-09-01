import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { summarizationMiddleware } from "langchain";
import {
	guardSummarizationFailure,
	isFailedSummaryContent,
	isFailedSummaryUpdate,
	SUMMARY_PREFIX,
} from "../../src/agent/summarization";

/* --------------------------------------------------------------------------
 * Pure helpers
 * ------------------------------------------------------------------------*/

describe("isFailedSummaryContent", () => {
	it("matches the middleware's swallowed-error stubs", () => {
		expect(
			isFailedSummaryContent(
				`${SUMMARY_PREFIX}\n\nError generating summary: Error: net::ERR_INCOMPLETE_CHUNKED_ENCODING`,
			),
		).toBe(true);
		expect(isFailedSummaryContent(`${SUMMARY_PREFIX}\n\nError generating summary: Invalid response format`)).toBe(
			true,
		);
	});

	it("does not match real summaries, even ones mentioning errors", () => {
		expect(isFailedSummaryContent(`${SUMMARY_PREFIX}\n\nUser debugged an "Error generating summary" bug.`)).toBe(
			false,
		);
		expect(isFailedSummaryContent(`${SUMMARY_PREFIX}\n\nUser is planning a thesis.`)).toBe(false);
		expect(isFailedSummaryContent(undefined)).toBe(false);
		expect(isFailedSummaryContent(42)).toBe(false);
	});
});

describe("isFailedSummaryUpdate", () => {
	it("detects a failed summary message inside a state update", () => {
		const update = {
			messages: [
				new HumanMessage({
					content: `${SUMMARY_PREFIX}\n\nError generating summary: Error: boom`,
					additional_kwargs: { lc_source: "summarization" },
				}),
				new HumanMessage({ content: "kept" }),
			],
		};
		expect(isFailedSummaryUpdate(update)).toBe(true);
	});

	it("passes successful updates, no-ops, and unrelated shapes", () => {
		expect(
			isFailedSummaryUpdate({
				messages: [
					new HumanMessage({
						content: `${SUMMARY_PREFIX}\n\nA proper summary.`,
						additional_kwargs: { lc_source: "summarization" },
					}),
				],
			}),
		).toBe(false);
		expect(isFailedSummaryUpdate(undefined)).toBe(false);
		expect(isFailedSummaryUpdate({})).toBe(false);
		expect(isFailedSummaryUpdate({ messages: "not-an-array" })).toBe(false);
	});
});

/* --------------------------------------------------------------------------
 * Guard against the real middleware
 * ------------------------------------------------------------------------*/

function longConversation() {
	return [
		new HumanMessage({ content: "First question about the thesis plan, with plenty of words." }),
		new AIMessage({ content: "A long first answer that costs a good number of tokens overall." }),
		new HumanMessage({ content: "Second question, following up on supervisors." }),
		new AIMessage({ content: "Second answer with more detail than strictly needed." }),
		new HumanMessage({ content: "Third question about the timeline." }),
		new AIMessage({ content: "Third answer, still fairly wordy." }),
		new HumanMessage({ content: "Fourth question that overflows the tiny test budget." }),
	];
}

function makeMiddleware(model: { invoke: (...args: unknown[]) => Promise<unknown> }) {
	return summarizationMiddleware({
		model: model as never,
		trigger: { tokens: 10 },
		keep: { messages: 2 },
		summaryPrefix: SUMMARY_PREFIX,
		summaryPrompt: "Summarize:\n{messages}",
	});
}

const runtime = { context: {} } as never;

describe("guardSummarizationFailure (real summarizationMiddleware)", () => {
	it("without the guard, a model failure is committed as the summary (LangChain contract)", async () => {
		const middleware = makeMiddleware({
			invoke: async () => {
				throw new Error("net::ERR_INCOMPLETE_CHUNKED_ENCODING");
			},
		});
		const update = await (middleware.beforeModel as (s: unknown, r: unknown) => Promise<unknown>)(
			{ messages: longConversation() },
			runtime,
		);

		// If this stops matching, LangChain changed its swallowed-error format
		// and isFailedSummaryContent must be updated with it.
		expect(isFailedSummaryUpdate(update)).toBe(true);
	});

	it("aborts the trim when summary generation fails", async () => {
		const middleware = guardSummarizationFailure(
			makeMiddleware({
				invoke: async () => {
					throw new Error("net::ERR_INCOMPLETE_CHUNKED_ENCODING");
				},
			}),
		);
		const update = await (middleware.beforeModel as (s: unknown, r: unknown) => Promise<unknown>)(
			{ messages: longConversation() },
			runtime,
		);

		expect(update).toBeUndefined();
	});

	it("passes a successful summarization through untouched", async () => {
		const middleware = guardSummarizationFailure(
			makeMiddleware({
				invoke: async () => new AIMessage({ content: "User is planning a thesis; supervisor search ongoing." }),
			}),
		);
		const update = (await (middleware.beforeModel as (s: unknown, r: unknown) => Promise<unknown>)(
			{ messages: longConversation() },
			runtime,
		)) as { messages: { content?: unknown; additional_kwargs?: Record<string, unknown> }[] };

		expect(Array.isArray(update?.messages)).toBe(true);
		const summary = update.messages.find((m) => m.additional_kwargs?.lc_source === "summarization");
		expect(summary?.content).toBe(`${SUMMARY_PREFIX}\n\nUser is planning a thesis; supervisor search ongoing.`);
	});

	it("passes a below-trigger no-op through untouched", async () => {
		const middleware = guardSummarizationFailure(
			makeMiddleware({
				invoke: async () => {
					throw new Error("should not be called");
				},
			}),
		);
		const update = await (middleware.beforeModel as (s: unknown, r: unknown) => Promise<unknown>)(
			{ messages: [new HumanMessage({ content: "hi" })] },
			runtime,
		);
		expect(update).toBeUndefined();
	});

	it("leaves middleware without a beforeModel hook untouched", () => {
		const bare = { name: "x" } as { name: string; beforeModel?: unknown };
		expect(guardSummarizationFailure(bare)).toBe(bare);
		expect(bare.beforeModel).toBeUndefined();
	});
});
