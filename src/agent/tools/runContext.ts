/**
 * Lightweight context holder for the currently-executing agent run.
 * Set by AgentManager before each `streamQuery` / `run` so that
 * tools can access the threadId without modifying the LangChain tool
 * signature.
 */

import { Logger } from "../../utils/logging";

// ---------------------------------------------------------------------------
// Thread context
// ---------------------------------------------------------------------------

let _currentThreadId: string | null = null;

export function setCurrentThreadId(threadId: string | null): void {
	if (threadId !== null && _currentThreadId !== null && _currentThreadId !== threadId) {
		Logger.warn(
			`[runContext] Overwriting active threadId "${_currentThreadId}" with "${threadId}". This may indicate overlapping agent runs.`,
		);
	}
	_currentThreadId = threadId;
}

export function getCurrentThreadId(): string {
	if (!_currentThreadId) {
		throw new Error("No active agent run — cannot determine threadId");
	}
	return _currentThreadId;
}
