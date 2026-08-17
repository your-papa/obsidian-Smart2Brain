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
 * Matches a fenced code block delimiter, capturing the run and any trailing text.
 *
 * At most three leading spaces: four or more make the line an *indented* code
 * block, not a fence. Accepting arbitrary indentation let a ``` inside indented
 * example code open a fence that never closed, swallowing every heading after it
 * — a note with three sections collapsed into one chunk.
 */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The delimiter that opened the current fenced block. */
interface OpenFence {
	/** "`" or "~". */
	char: string;
	/** How many delimiter characters opened the block. */
	length: number;
}

/**
 * Track fenced-code state across lines, remembering *how* the block was opened.
 *
 * Both parts of the delimiter matter, and getting either wrong lets a `#` line
 * inside code be read as a real heading — which then becomes a breadcrumb
 * ancestor of every later section:
 *
 *   - **Character.** CommonMark closes a fence only with the same character, so
 *     a `~~~` line inside a ```` ```markdown ```` block is content.
 *   - **Length.** A closing fence must be *at least as long* as the opener, so a
 *     three-backtick line inside a four-backtick block is content too. That is
 *     the ordinary way to show fenced code inside fenced code, so it turns up in
 *     real notes rather than only in edge cases.
 *   - **Trailing text.** An info string (```` ```text ````) is legal only on the
 *     *opening* delimiter; a closer permits nothing but whitespace after the run.
 *     So a ```` ```text ```` line inside an open block is content, and treating
 *     it as a closer would additionally let the *real* closer re-open a fence and
 *     swallow every following section.
 *
 * @param line The line to inspect.
 * @param open The fence currently open, or null when outside one.
 * @returns The fence still open after this line (null when the line closed it).
 */
function nextFenceState(line: string, open: OpenFence | null): OpenFence | null {
	const match = line.match(FENCE_RE);
	if (!match) return open;

	const run = match[1];
	const trailing = match[2];
	if (open === null) {
		// Opening delimiter: an info string is allowed. A backtick fence's info
		// string may not itself contain a backtick (it would be inline code).
		if (run[0] === "`" && trailing.includes("`")) return null;
		return { char: run[0], length: run.length };
	}

	// Closing delimiter: same character, at least as long, nothing but whitespace
	// after it. Anything else is code content inside the open block.
	const closes = run[0] === open.char && run.length >= open.length && trailing.trim() === "";
	return closes ? null : open;
}

/**
 * Count the markdown sections in a note body.
 *
 * Used to decide whether a note that fits the embedding budget should still be
 * split: more than one section means more than one topic averaged into a single
 * vector. Heading lines inside fenced code blocks don't open a section — a shell
 * comment or a Python `#` line would otherwise fragment a note spuriously.
 *
 * Returns the number of top-level-ish sections: any leading prose before the
 * first heading counts as one.
 */
function countSections(content: string): number {
	let sections = 0;
	let openFence: OpenFence | null = null;
	let sawLeadingProse = false;
	let seenHeading = false;

	for (const line of content.split("\n")) {
		const nextFence = nextFenceState(line, openFence);
		const insideFence = openFence !== null || nextFence !== openFence;
		if (insideFence) {
			// Fenced code before the first heading is still leading content: a note
			// that opens with a code block and then has one heading holds two
			// topics, and must not take the single-chunk fast path.
			if (!seenHeading && line.trim()) sawLeadingProse = true;
			openFence = nextFence;
			continue;
		}

		if (HEADING_RE.test(line)) {
			seenHeading = true;
			sections++;
		} else if (!seenHeading && line.trim()) {
			sawLeadingProse = true;
		}
	}

	return sections + (sawLeadingProse ? 1 : 0);
}

/**
 * Render the note title for a chunk prefix.
 *
 * Deliberately NOT `# <title>`. A level-one heading is ordinary note content, so
 * a note containing `# Appendix` would yield a chunk with two sibling H1s and
 * nothing marking which one is the document's identity — the title becomes
 * indistinguishable from a section. A `Note:` label keeps the title unambiguous
 * and reads naturally to an embedding model.
 */
function formatTitleLine(title: string): string {
	return `Note: ${title}`;
}

/**
 * Build the prefix string (title + active heading breadcrumb) for a chunk.
 * Guards against a pathologically deep/long breadcrumb by dropping the
 * shallowest headings first (keeping the title and the nearest headings) so the
 * prefix can never consume the entire budget.
 */
function buildPrefix(title: string, headings: HeadingFrame[], maxPrefixChars: number): string {
	const titleLine = formatTitleLine(title);
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

/**
 * Split raw note content into paragraphs on blank lines, preserving order.
 *
 * Only *trailing* whitespace is trimmed. Leading indentation is structural
 * markdown — four spaces mark an indented code block, and list continuations rely
 * on it — so stripping it changes what the text means. A `    ```` ``` ```` ` line
 * correctly rejected as a fence (indented code, not a delimiter) would otherwise
 * be re-emitted as a bare ```` ``` ````, turning the chunk body into an
 * unterminated fence that swallows the following heading.
 */
function splitParagraphs(content: string): string[] {
	return content
		.split(/\n[ \t]*\n/)
		.map((p) => p.replace(/\s+$/, ""))
		.filter((p) => p.trim().length > 0);
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
	const titleLine = formatTitleLine(title);
	// Strip blank leading/trailing *lines*, but never a line's own indentation:
	// `"    ```".trim()` yields a real fence delimiter, which would make
	// `countSections` read indented example code as an unterminated fence and
	// swallow every heading after it.
	const trimmed = content.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");

	// Fast path: a note that fits the budget AND covers a single topic becomes one
	// vector, as before.
	//
	// Size alone is the wrong test. An embedding averages everything it is given, so
	// a note holding several unrelated sections yields a vector near the centroid of
	// all of them and close to none. Measured on "Cooking Mediterranean Recipes"
	// (1234 chars — comfortably inside a ~32k budget, so previously one chunk): the
	// query "griechenland" scores 0.492 against its Greek-salad section in isolation
	// but only 0.200 against the whole note, because shakshuka, hummus and grilled
	// fish are averaged in. The note ranked 286/337 and never surfaced.
	//
	// So split on section headings whenever the note has more than one, regardless
	// of length. Every level counts (H1-H6, see HEADING_RE): a note organised with
	// top-level `#` sections splits exactly like one using `##`, and deeper levels
	// nest rather than being flattened — a chunk under `### Install` carries the
	// `## Setup` breadcrumb above it. The packing loop below already emits one
	// chunk per heading breadcrumb; it was simply unreachable for notes under the
	// budget.
	const single = trimmed ? `${titleLine}\n\n${trimmed}` : titleLine;
	if (single.length <= maxChars && countSections(trimmed) <= 1) {
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
		// Trim blank edges only — see `splitParagraphs` on why leading indentation
		// must survive.
		const text = buffer
			.join("\n")
			.replace(/^\s*\n/, "")
			.replace(/\s+$/, "");
		buffer = [];
		if (!text.trim()) return;
		for (const para of splitParagraphs(text)) {
			units.push({ body: para, headings: [...headings] });
		}
	};

	// Fence state must be tracked here as well as in `countSections`. A `#` line
	// inside a fenced block is code, not a heading: treating it as one would push a
	// shell comment onto the breadcrumb stack, where it becomes a permanent
	// ancestor of every following real section, and would split the fence markers
	// across separate chunks.
	let openFence: OpenFence | null = null;

	for (const line of lines) {
		const nextFence = nextFenceState(line, openFence);
		if (nextFence !== openFence) {
			openFence = nextFence;
			buffer.push(line);
			continue;
		}

		const m = openFence !== null ? null : line.match(HEADING_RE);
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
