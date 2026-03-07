/**
 * Lightweight context holder for the currently-executing agent run.
 * Set by AgentManager before each `streamQuery` / `run` so that
 * write tools can access the threadId without modifying the
 * LangChain tool signature.
 */

let _currentThreadId: string | null = null;

export function setCurrentThreadId(threadId: string | null): void {
	_currentThreadId = threadId;
}

export function getCurrentThreadId(): string {
	if (!_currentThreadId) {
		throw new Error("No active agent run — cannot determine threadId");
	}
	return _currentThreadId;
}
