/**
 * Turns a thrown error into a concise, human-readable message suitable for
 * display in the chat UI.
 *
 * Provider/LLM errors arrive in a few shapes:
 *  - A LangChain-wrapped `Error` whose `.message` already contains the upstream
 *    status and body (e.g. `507 Model 'x' (15GB) does not fit ...`).
 *  - An error whose `.message` is a raw JSON error envelope
 *    (`{"error":{"message":"...","type":"server_error"}}`).
 *  - A generic `Error` or non-error value.
 *
 * This unwraps the `cause` chain, extracts the inner `error.message` from any
 * embedded JSON envelope, and returns a trimmed single-paragraph string.
 */
export function extractErrorMessage(error: unknown): string {
	const fallback = "The model request failed.";

	const raw = resolveRawMessage(error);
	if (!raw) return fallback;

	const cleaned = unwrapJsonErrorEnvelope(raw).trim();
	return cleaned.length > 0 ? cleaned : fallback;
}

type ErrorWithCause = Error & { cause?: unknown };

function resolveRawMessage(error: unknown): string | undefined {
	// Walk the cause chain and prefer the deepest error that still carries a
	// message — that's usually the upstream provider error rather than a generic
	// LangChain wrapper.
	let current: unknown = error;
	let best: string | undefined;

	let depth = 0;
	while (current instanceof Error && depth < 10) {
		if (current.message) best = current.message;
		current = (current as ErrorWithCause).cause;
		depth += 1;
	}

	if (best !== undefined) return best;

	if (typeof error === "string") return error;
	return undefined;
}

/**
 * If the message contains a JSON error envelope like
 * `{"error":{"message":"...","type":"server_error"}}` (possibly prefixed with a
 * status code, e.g. `507 {...}`), return the inner `error.message`. Otherwise
 * return the original message unchanged.
 */
function unwrapJsonErrorEnvelope(message: string): string {
	const braceStart = message.indexOf("{");
	const braceEnd = message.lastIndexOf("}");
	if (braceStart === -1 || braceEnd <= braceStart) return message;

	// Try the substring from the first `{` to the last `}`. This tolerates a
	// leading status code (e.g. `507 {...}`) and trailing whitespace/newlines
	// without a full brace-matching parser. If it isn't valid JSON, or lacks the
	// expected `error.message`, we return the original message untouched.
	const jsonCandidate = message.slice(braceStart, braceEnd + 1);
	try {
		const parsed = JSON.parse(jsonCandidate) as { error?: { message?: unknown } };
		const inner = parsed?.error?.message;
		if (typeof inner === "string" && inner.trim().length > 0) {
			return inner;
		}
	} catch {
		// Not valid JSON — fall through and return the original message.
	}

	return message;
}
