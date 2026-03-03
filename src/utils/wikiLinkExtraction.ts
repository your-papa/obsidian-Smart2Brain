import { IMAGE_EXTENSIONS, PDF_EXTENSIONS, TEXT_EXTENSIONS } from "../types/shared";

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

/**
 * Extracts embedded image/PDF file references from markdown content.
 * Matches both wiki-link embeds `![[file.png]]` and standard markdown embeds `![alt](file.png)`.
 *
 * @returns Array of vault-relative file paths for image/PDF files
 */
export function extractMediaEmbeds(markdown: string): string[] {
	const results: string[] = [];
	const seen = new Set<string>();

	const isMediaFile = (path: string): boolean => {
		const ext = path.split(".").pop()?.toLowerCase() ?? "";
		return IMAGE_EXTENSIONS.has(ext) || PDF_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(ext);
	};

	const addUnique = (path: string) => {
		// Strip any heading/block refs (e.g., "image.png#^block")
		const cleanPath = path.split("#")[0].trim();
		if (cleanPath && isMediaFile(cleanPath) && !seen.has(cleanPath)) {
			seen.add(cleanPath);
			results.push(cleanPath);
		}
	};

	// Match ![[file.ext]] wiki-link embeds (with optional alias: ![[file.ext|alias]])
	const wikiEmbedRegex = /!\[\[([^\]]+)\]\]/g;
	let match = wikiEmbedRegex.exec(markdown);
	while (match !== null) {
		const inner = match[1];
		// Take file part before pipe (alias separator)
		const filePart = inner.includes("|") ? inner.split("|")[0] : inner;
		addUnique(filePart);
		match = wikiEmbedRegex.exec(markdown);
	}

	// Match ![alt](file.ext) standard markdown embeds
	const mdEmbedRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
	match = mdEmbedRegex.exec(markdown);
	while (match !== null) {
		const filePath = match[2];
		// Skip external URLs
		if (!filePath.startsWith("http://") && !filePath.startsWith("https://")) {
			addUnique(decodeURIComponent(filePath));
		}
		match = mdEmbedRegex.exec(markdown);
	}

	return results;
}
