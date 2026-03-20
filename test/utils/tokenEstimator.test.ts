import { describe, it, expect, vi } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

import {
    estimateContextUsage,
    estimateContextUsageBreakdown,
    formatContextUsage,
    type UsageEstimate,
} from "../../src/utils/tokenEstimator";

function createConversation(userContent: string, assistantContent: string) {
    return [new HumanMessage(userContent), new AIMessage(assistantContent)];
}

function createConversationWithAttachments(
    userContent: string,
    assistantContent: string,
    attachmentCount: number,
) {
    return [
        new HumanMessage({
            content: userContent,
            additional_kwargs: {
                attachments: new Array(attachmentCount).fill({ size: 1000, name: "file.pdf" }),
            },
        }),
        new AIMessage(assistantContent),
    ];
}

describe("tokenEstimator", () => {
    describe("estimateContextUsage", () => {
        it("should handle empty conversation and empty input", () => {
            const result = estimateContextUsage([], "", 128000);

            expect(result.estimatedUsedTokens).toBe(0);
            expect(result.contextWindow).toBe(128000);
            expect(result.usagePercent).toBe(0);
        });

        it("should estimate tokens from a single message pair", () => {
            const messages = createConversation("hello world", "goodbye world");
            const result = estimateContextUsage(messages, "", 128000);

            // "hello world" = 2 words * 1.3 = 2.6 ≈ 3 tokens
            // "goodbye world" = 2 words * 1.3 = 2.6 ≈ 3 tokens
            // Per-message overhead: 80 + 80 = 160
            // Total: 3 + 3 + 160 = 166
            expect(result.estimatedUsedTokens).toBe(166);
            expect(result.usagePercent).toBeCloseTo(0.13, 2);
        });

        it("should include draft text in estimation", () => {
            const messages = createConversation("hello", "hi");
            const result = estimateContextUsage(messages, "what is this", 128000);

            // hello = 1 word * 1.3 ≈ 2 tokens (rounded up)
            // hi = 1 word * 1.3 ≈ 2 tokens (rounded up)
            // Message overheads: 160
            // Draft "what is this" = 3 words * 1.3 = 3.9 ≈ 4 tokens
            // Draft overhead: 20
            // Total: 2 + 2 + 160 + 4 + 20 = 188
            expect(result.estimatedUsedTokens).toBe(188);
            expect(result.usagePercent).toBeCloseTo(0.147, 2);
        });

        it("should ignore empty draft text", () => {
            const messages = createConversation("hello", "hi");
            const result1 = estimateContextUsage(messages, "", 128000);
            const result2 = estimateContextUsage(messages, "   ", 128000);

            expect(result1.estimatedUsedTokens).toBe(result2.estimatedUsedTokens);
        });

        it("should account for attachment overhead", () => {
            const messages = createConversationWithAttachments("hello", "hi", 2);
            const result = estimateContextUsage(messages, "", 128000);

            // 2 attachments * 200 tokens each = 400
            // Plus other content: ~164 (hello + hi + message overheads)
            // Expected: ~564
            expect(result.estimatedUsedTokens).toBeGreaterThan(400);
            expect(result.estimatedUsedTokens).toBeLessThan(600);
        });

        it("should include visible notes overhead when present", () => {
            const messages = [
                new HumanMessage({
                    content: "hello",
                    additional_kwargs: { visibleNotes: [{ path: "note1.md", basename: "note1" }] },
                }),
                new AIMessage("hi"),
            ];

            const resultWithoutNotes = estimateContextUsage(
                createConversation("hello", "hi"),
                "",
                128000,
            );
            const resultWithNotes = estimateContextUsage(messages, "", 128000);

            // Difference should be around 100 tokens for visible notes
            expect(resultWithNotes.estimatedUsedTokens - resultWithoutNotes.estimatedUsedTokens).toBe(
                100,
            );
        });

        it("should include selection overhead when present", () => {
            const messages = [
                new HumanMessage({
                    content: "hello",
                    additional_kwargs: { selection: { text: "selected text", file: "note.md" } },
                }),
                new AIMessage("hi"),
            ];

            const resultWithoutSelection = estimateContextUsage(
                createConversation("hello", "hi"),
                "",
                128000,
            );
            const resultWithSelection = estimateContextUsage(messages, "", 128000);

            // Difference should be around 50 tokens for selection
            expect(resultWithSelection.estimatedUsedTokens - resultWithoutSelection.estimatedUsedTokens).toBe(
                50,
            );
        });

        it("should include graph notes overhead when present", () => {
            const messages = [
                new HumanMessage({
                    content: "hello",
                    additional_kwargs: { graphNotes: [{ path: "note1.md", basename: "note1" }] },
                }),
                new AIMessage("hi"),
            ];

            const resultWithoutGraphNotes = estimateContextUsage(
                createConversation("hello", "hi"),
                "",
                128000,
            );
            const resultWithGraphNotes = estimateContextUsage(messages, "", 128000);

            // Difference should be around 100 tokens for graph notes
            expect(
                resultWithGraphNotes.estimatedUsedTokens - resultWithoutGraphNotes.estimatedUsedTokens,
            ).toBe(100);
        });

        it("should include summarized checkpoint messages in the normal human token bucket", () => {
            const messages = [
                new HumanMessage({
                    content: "Previous conversation summary\n\nImportant prior decisions.",
                    additional_kwargs: { lc_source: "summarization" },
                }),
                new HumanMessage("hello"),
                new AIMessage("hi"),
            ];
            const breakdown = estimateContextUsageBreakdown(messages, "", {});

            expect(breakdown.humanTokens).toBeGreaterThan(0);
            expect(breakdown.totalTokens).toBe(
                breakdown.systemPromptTokens +
                    breakdown.humanTokens +
                    breakdown.assistantTokens +
                    breakdown.toolTokens +
                    breakdown.draftAndPendingTokens,
            );
        });

        it("should clamp usage percent to [0, 100]", () => {
            const messages = createConversation("hello world", "hi there");

            // Small context window to exceed 100%
            const resultOver = estimateContextUsage(messages, "", 100);
            expect(resultOver.usagePercent).toBeLessThanOrEqual(100);
            expect(resultOver.usagePercent).toBeGreaterThan(0);

            // Ensure it's not clamped when under 100%
            const resultUnder = estimateContextUsage(messages, "", 128000);
            expect(resultUnder.usagePercent).toBeLessThan(100);
        });

        it("should handle undefined context window", () => {
            const messages = createConversation("hello world", "hi there");
            const result = estimateContextUsage(messages, "", undefined);

            expect(result.contextWindow).toBeUndefined();
            expect(result.usagePercent).toBe(0);
            expect(result.estimatedUsedTokens).toBeGreaterThan(0);
        });

        it("should handle long conversations with multiple message pairs", () => {
            const messages = [
                ...createConversation("first message", "first response"),
                ...createConversation("second message", "second response"),
                ...createConversation("third message", "third response"),
            ];
            const result = estimateContextUsage(messages, "", 128000);

            // Should accumulate tokens from all three pairs
            expect(result.estimatedUsedTokens).toBeGreaterThan(300); // At least 3 * ~100
            expect(result.usagePercent).toBeGreaterThan(0);
        });

        it("should handle very long text content", () => {
            const longText = new Array(1000).fill("word").join(" ");
            const messages = createConversation(longText, "short response");
            const result = estimateContextUsage(messages, "", 128000);

            // long text (1000 words) * 1.3 ≈ 1300 tokens + overhead
            expect(result.estimatedUsedTokens).toBeGreaterThan(1000);
        });

        it("should handle empty content strings gracefully", () => {
            const messages = createConversation("", "");
            const result = estimateContextUsage(messages, "", 128000);

            // Only message overhead: 80 + 80 = 160
            expect(result.estimatedUsedTokens).toBe(160);
        });

        it("should not double-count when messages and draft are both empty", () => {
            const result = estimateContextUsage([], "", 128000);

            expect(result.estimatedUsedTokens).toBe(0);
            expect(result.contextWindow).toBe(128000);
            expect(result.usagePercent).toBe(0);
        });

        it("should include system prompt tokens in the estimate", () => {
            const base = estimateContextUsage([], "", 128000);
            const withSystemPrompt = estimateContextUsage([], "", 128000, {
                systemPrompt: "You are a helpful assistant with strict formatting rules",
            });

            expect(withSystemPrompt.estimatedUsedTokens).toBeGreaterThan(base.estimatedUsedTokens);
        });

        it("should include pending draft contexts in the estimate", () => {
            const base = estimateContextUsage([], "", 128000);
            const withPendingContext = estimateContextUsage([], "", 128000, {
                pendingAttachmentsCount: 2,
                pendingVisibleNotesCount: 1,
                hasPendingSelection: true,
                pendingGraphNotesCount: 3,
            });

            expect(withPendingContext.estimatedUsedTokens).toBe(base.estimatedUsedTokens + 650);
        });

        it("should include additional text blocks in the estimate", () => {
            const base = estimateContextUsage([], "", 128000);
            const withAdditionalBlocks = estimateContextUsage([], "", 128000, {
                additionalTextBlocks: ["first block", "second context block"],
            });

            expect(withAdditionalBlocks.estimatedUsedTokens).toBeGreaterThan(base.estimatedUsedTokens);
        });

        it("should include assistant tool call payloads in the estimate", () => {
            const withoutToolCall = estimateContextUsage(createConversation("plan this", "working on it"), "", 128000);
            const withToolCall = estimateContextUsage(
                [
                    new HumanMessage("plan this"),
                    new AIMessage({
                        content: "working on it",
                        tool_calls: [
                            {
                                id: "tc-1",
                                name: "read_content",
                                args: { path: "note.md" },
                            },
                        ],
                    }),
                ],
                "",
                128000,
            );

            expect(withToolCall.estimatedUsedTokens).toBeGreaterThan(withoutToolCall.estimatedUsedTokens);
        });
    });

    describe("formatContextUsage", () => {
        it("should format usage with known context window", () => {
            const estimate: UsageEstimate = {
                estimatedUsedTokens: 47000,
                contextWindow: 128000,
                usagePercent: 36.7,
            };

            const formatted = formatContextUsage(estimate);

            expect(formatted).toContain("37%");
            expect(formatted).toContain("47k");
            expect(formatted).toContain("128k");
            expect(formatted).toContain("(est.)");
        });

        it("should format usage with unknown context window", () => {
            const estimate: UsageEstimate = {
                estimatedUsedTokens: 47000,
                contextWindow: undefined,
                usagePercent: 0,
            };

            const formatted = formatContextUsage(estimate);

            expect(formatted).toContain("47k");
            expect(formatted).toContain("unknown");
            expect(formatted).toContain("(est.)");
        });

        it("should round tokens to nearest thousand", () => {
            const estimate: UsageEstimate = {
                estimatedUsedTokens: 47500,
                contextWindow: 128000,
                usagePercent: 37.1,
            };

            const formatted = formatContextUsage(estimate);

            expect(formatted).toContain("48k"); // 47500 rounds to 48k
        });

        it("should format percentage correctly", () => {
            const estimate: UsageEstimate = {
                estimatedUsedTokens: 50000,
                contextWindow: 128000,
                usagePercent: 39.0625,
            };

            const formatted = formatContextUsage(estimate);

            expect(formatted).toContain("39%"); // Should be rounded to nearest integer
        });
    });
});
