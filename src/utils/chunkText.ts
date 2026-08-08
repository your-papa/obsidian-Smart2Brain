/**
 * Structure-aware, paragraph-level text chunker for the embedding index.
 *
 * Large notes cannot be embedded as a single vector once they exceed the
 * embedding model's input cap, so we split them into multiple chunks. To
 * preserve semantic context, every chunk is prefixed with the note title and
 * the markdown-header breadcrumb of the section it lives under, and splits
 * happen on paragraph boundaries rather than mid-sentence.
 *
 * Pure module: no Obsidian / DOM dependencies so it is trivially unit-testable.
 */

/** A single chunk ready to be embedded. */
export interface TextChunk {
	/** The full embedded text: `# <title>` + header breadcrumb + body. */
	content: string;
	/** Ordinal position of this chunk within the note (0-based). */
	chunkIndex: number;
}

/** Matches an ATX markdown heading line, capturing its level and text. */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

interface HeadingFrame {
	level: number;
	text: string;
}

/**
 * Build the prefix string (title + active heading breadcrumb) for a chunk.
 * Guards against a pathologically deep/long breadcrumb by dropping the
 * shallowest headings first (keeping the title and the nearest headings) so the
 * prefix can never consume the entire budget.
 */
function buildPrefix(title: string, headings: HeadingFrame[], maxPrefixChars: number): string {
	const titleLine = `# ${title}`;
	if (headings.length === 0) return titleLine;

	let frames = headings;
	let prefix = "";
	// Drop from the front (shallowest) until the breadcrumb fits the budget.
	while (frames.length > 0) {
		const crumb = frames.map((h) => `${"#".repeat(Math.min(h.level, 6))} ${h.text}`).join("\n");
		prefix = `${titleLine}\n${crumb}`;
		if (prefix.length <= maxPrefixChars) return prefix;
		frames = frames.slice(1);
	}
	// Even the title alone may be long; the caller's budget guard handles that.
	return titleLine;
}

/** Split raw note content into paragraphs on blank lines, preserving order. */
function splitParagraphs(content: string): string[] {
	return content
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
}

/**
 * Split text on sentence boundaries: whitespace that immediately follows a
 * sentence terminator (`.`, `!`, `?`). Equivalent to splitting on
 * `/(?<=[.!?])\s+/`, but written without regex lookbehind, which is unsupported
 * on iOS < 16.4 (and throws at parse time there).
 */
function splitOnSentences(text: string): string[] {
	const parts: string[] = [];
	let start = 0;
	// Match a terminator followed by one or more whitespace chars; the split
	// point is *after* the terminator, and the whitespace run is dropped.
	const boundary = /[.!?]\s+/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
	while ((m = boundary.exec(text)) !== null) {
		const cut = m.index + 1; // keep the terminator on the left part
		parts.push(text.slice(start, cut));
		start = cut + (m[0].length - 1); // skip the whitespace run
	}
	if (start < text.length) parts.push(text.slice(start));
	return parts;
}

/**
 * Break a single oversized unit (a paragraph too large for the body budget)
 * into pieces no larger than `maxBodyChars`, preferring line, then sentence,
 * then hard character boundaries.
 */
function splitOversizedUnit(unit: string, maxBodyChars: number): string[] {
	if (unit.length <= maxBodyChars) return [unit];

	// Try progressively finer separators: newline first, then sentence boundary.
	const strategies: Array<{ split: (s: string) => string[]; joiner: string }> = [
		{ split: (s) => s.split("\n"), joiner: "\n" },
		{ split: splitOnSentences, joiner: " " },
	];
	for (const { split, joiner } of strategies) {
		const parts = split(unit);
		if (parts.length < 2) continue;

		const packed: string[] = [];
		let current = "";
		for (const part of parts) {
			const candidate = current ? `${current}${joiner}${part}` : part;
			if (candidate.length <= maxBodyChars) {
				current = candidate;
			} else {
				if (current) packed.push(current);
				// A single part may still be too large; recurse to the next separator.
				current = part.length > maxBodyChars ? "" : part;
				if (part.length > maxBodyChars) packed.push(...splitOversizedUnit(part, maxBodyChars));
			}
		}
		if (current) packed.push(current);
		if (packed.length > 0) return packed;
	}

	// Last resort: hard character cut.
	const pieces: string[] = [];
	for (let i = 0; i < unit.length; i += maxBodyChars) {
		pieces.push(unit.slice(i, i + maxBodyChars));
	}
	return pieces;
}

/**
 * Split note content into embedding-ready chunks.
 *
 * Each returned chunk's `content` already includes the title + header
 * breadcrumb prefix and is guaranteed to be `<= maxChars` in length.
 *
 * @param content Raw note body (without the title).
 * @param title Note title (basename), prepended to every chunk.
 * @param maxChars Hard upper bound on the full chunk length (prefix + body).
 */
export function chunkText(content: string, title: string, maxChars: number): TextChunk[] {
	const titleLine = `# ${title}`;
	const trimmed = content.trim();

	// Fast path: whole note (with title) fits in one chunk — one vector, as before.
	const single = trimmed ? `${titleLine}\n\n${trimmed}` : titleLine;
	if (single.length <= maxChars) {
		return [{ content: single, chunkIndex: 0 }];
	}

	// Reserve at most ~40% of the budget for the prefix so the body always has room.
	const maxPrefixChars = Math.max(titleLine.length, Math.floor(maxChars * 0.4));

	const lines = content.split("\n");
	const headings: HeadingFrame[] = [];
	// Rebuild paragraphs while tracking the heading stack at each paragraph.
	interface Unit {
		body: string;
		headings: HeadingFrame[];
	}
	const units: Unit[] = [];
	let buffer: string[] = [];

	const flushBuffer = () => {
		const text = buffer.join("\n").trim();
		buffer = [];
		if (!text) return;
		for (const para of splitParagraphs(text)) {
			units.push({ body: para, headings: [...headings] });
		}
	};

	for (const line of lines) {
		const m = line.match(HEADING_RE);
		if (m) {
			flushBuffer();
			const level = m[1].length;
			const text = m[2].trim();
			// Pop headings at the same or deeper level, then push this one.
			while (headings.length > 0 && headings[headings.length - 1].level >= level) {
				headings.pop();
			}
			headings.push({ level, text });
		} else {
			buffer.push(line);
		}
	}
	flushBuffer();

	// Greedily pack units into chunks. A chunk only spans units that share the
	// same heading breadcrumb, so the prefix always matches the body's section.
	const chunks: TextChunk[] = [];
	let chunkIndex = 0;
	let i = 0;

	const headingsEqual = (a: HeadingFrame[], b: HeadingFrame[]): boolean =>
		a.length === b.length && a.every((h, idx) => h.level === b[idx].level && h.text === b[idx].text);

	while (i < units.length) {
		const sectionHeadings = units[i].headings;
		const prefix = buildPrefix(title, sectionHeadings, maxPrefixChars);
		const separatorLen = 2; // "\n\n" between prefix and body
		const maxBodyChars = Math.max(1, maxChars - prefix.length - separatorLen);

		const bodyParts: string[] = [];
		let bodyLen = 0;

		// Pack consecutive units of THIS section until the budget is hit.
		while (i < units.length && headingsEqual(units[i].headings, sectionHeadings)) {
			const unit = units[i];
			if (unit.body.length > maxBodyChars) {
				// Oversized lone paragraph. If a chunk is already accumulating,
				// close it first; otherwise hard-split this paragraph in place.
				if (bodyParts.length > 0) break;
				for (const piece of splitOversizedUnit(unit.body, maxBodyChars)) {
					chunks.push({ content: `${prefix}\n\n${piece}`, chunkIndex: chunkIndex++ });
				}
				i++;
				continue;
			}
			const addLen = unit.body.length + (bodyParts.length > 0 ? 2 : 0);
			if (bodyLen + addLen > maxBodyChars) break;
			bodyParts.push(unit.body);
			bodyLen += addLen;
			i++;
		}

		if (bodyParts.length > 0) {
			chunks.push({ content: `${prefix}\n\n${bodyParts.join("\n\n")}`, chunkIndex: chunkIndex++ });
		}
	}

	// Defensive: never return zero chunks for non-empty content.
	if (chunks.length === 0) {
		return [{ content: single.slice(0, maxChars), chunkIndex: 0 }];
	}
	return chunks;
}
