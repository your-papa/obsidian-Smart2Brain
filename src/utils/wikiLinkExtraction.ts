export interface WikiLinkContext {
	fullStart: number;
	fullEnd: number;
	innerStart: number;
	innerEnd: number;
	inner: string;
	filePart: string;
	displayPart: string | null;
}

/**
 * Returns context if the cursor is inside [[...]].
 * cursor: position (selectionStart) inside the text.
 */
export function getWikiLinkAtCursor(text: string, cursor: number): WikiLinkContext | null {
	// Slice before cursor and find the nearest opening [[
	const before = text.slice(0, cursor);
	const open = before.lastIndexOf("[[");
	if (open === -1) return null;

	// Ensure there is not a closing ]] after that open but still before cursor (would mean you're outside)
	const lastCloseBefore = before.lastIndexOf("]]");
	if (lastCloseBefore > open) return null; // We are after a closed link.

	// Now look forward from cursor for the closing ]]
	const after = text.slice(cursor);
	const relativeClose = after.indexOf("]]");
	if (relativeClose === -1) return null; // Not closed yet.

	const fullStart = open;
	const fullEnd = cursor + relativeClose + 2; // +2 for length of ]]
	const innerStart = fullStart + 2;
	const innerEnd = fullEnd - 2;
	if (cursor < innerStart || cursor > innerEnd) return null;

	const inner = text.slice(innerStart, innerEnd);
	if (inner.includes("\n")) return null;

	// Extract file|alias
	const pipeIdx = inner.indexOf("|");
	const filePart = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
	const displayPart = pipeIdx === -1 ? null : inner.slice(pipeIdx + 1);

	return {
		fullStart,
		fullEnd,
		innerStart,
		innerEnd,
		inner,
		filePart,
		displayPart,
	};
}
