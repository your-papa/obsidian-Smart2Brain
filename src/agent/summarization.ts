export const SUMMARY_TRIGGER_RATIO = 0.8;
export const SUMMARY_KEEP_MESSAGE_COUNT = 12;
export const SUMMARY_MIN_TRIGGER_TOKENS = 12_000;
export const SUMMARY_MIN_TRIM_TOKENS = 6_000;
export const SUMMARY_MAX_TRIM_TOKENS = 24_000;
export const SUMMARY_PREFIX = "Previous conversation summary";
export const SUMMARY_PROMPT = `Summarize the earlier conversation so the assistant can continue the thread accurately.

Preserve:
- user goals, preferences, and constraints
- important facts, decisions, and unresolved questions
- tool results or note/file references that still matter
- any explicit instructions that should continue to apply

Be concise but specific. Do not invent information.

Conversation:
{messages}`;

export function getSummarizationTriggerTokens(contextWindow: number | undefined): number | null {
	if (!contextWindow || contextWindow <= 0) {
		return null;
	}

	return Math.max(Math.floor(contextWindow * SUMMARY_TRIGGER_RATIO), SUMMARY_MIN_TRIGGER_TOKENS);
}

export function getTrimTokensToSummarize(triggerTokens: number): number {
	return Math.max(
		Math.min(Math.floor(triggerTokens / 2), SUMMARY_MAX_TRIM_TOKENS),
		Math.min(SUMMARY_MIN_TRIM_TOKENS, triggerTokens),
	);
}

export function shouldSummarizeForEstimatedTokens(estimatedTokens: number, contextWindow: number | undefined): boolean {
	const triggerTokens = getSummarizationTriggerTokens(contextWindow);
	return triggerTokens !== null && estimatedTokens >= triggerTokens;
}
