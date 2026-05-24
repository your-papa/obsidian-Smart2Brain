/**
 * Lightweight context holder for the currently-executing agent run.
 * Set by AgentManager before each `streamQuery` / `run` so that
 * tools can access the threadId and active space scope without
 * modifying the LangChain tool signature.
 */

import type { Space } from "../../types/graph";
import { Logger } from "../../utils/logging";

// ---------------------------------------------------------------------------
// Thread context
// ---------------------------------------------------------------------------

let _currentThreadId: string | null = null;

export function setCurrentThreadId(threadId: string | null): void {
	if (threadId !== null && _currentThreadId !== null && _currentThreadId !== threadId) {
		Logger.warn(
			`[runContext] Overwriting active threadId "${_currentThreadId}" with "${threadId}". ` +
				"This may indicate overlapping agent runs.",
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

// ---------------------------------------------------------------------------
// Active-space context
// ---------------------------------------------------------------------------

let _currentSpaces: Space[] | null = null;

/**
 * Set the active spaces for the current agent run.
 * Called by AgentManager before each run and cleared in the finally block.
 * `null` means no space restriction (whole vault).
 */
export function setCurrentSpaces(spaces: Space[] | null): void {
	if (spaces !== null && _currentSpaces !== null && _currentSpaces !== spaces) {
		Logger.warn(
			`[runContext] Overwriting active spaces [${_currentSpaces.map((s) => s.label).join(", ")}] ` +
				`with [${spaces.map((s) => s.label).join(", ")}]. This may indicate overlapping agent runs.`,
		);
	}
	_currentSpaces = spaces;
}

/**
 * Get the active spaces for the current agent run.
 * Returns `null` when no space restriction is active (whole vault).
 */
export function getCurrentSpaces(): Space[] | null {
	return _currentSpaces;
}
