import type { Change } from "diff";
import type { MarkdownPostProcessorContext } from "obsidian";
import { diffLines, diffWords } from "diff";
import { getPendingChangesStore } from "../stores/pendingChangesStore.svelte";

/** Count lines in a diff part value. */
function countPartLines(value: string): number {
	if (value === "") return 0;
	return value.replace(/\n$/, "").split("\n").length;
}

/**
 * Computes which lines in the *original* content are removed or modified.
 * Returns a Set of 0-based line numbers that are affected.
 */
function computeOriginalAffectedLines(originalContent: string, newContent: string): Set<number> {
	const affected = new Set<number>();
	const changes = diffLines(originalContent, newContent);
	let oldLine = 0; // 0-based

	for (const part of changes) {
		if (part.value === "") continue;
		const lines = countPartLines(part.value);

		if (part.removed) {
			for (let i = 0; i < lines; i++) {
				affected.add(oldLine + i);
			}
			oldLine += lines;
		} else if (part.added) {
			const markerLine = Math.max(0, oldLine - 1);
			affected.add(markerLine);
		} else {
			oldLine += lines;
		}
	}

	return affected;
}

/**
 * Build a mapper from current-content line numbers to originalContent line numbers.
 * Returns null for lines that don't exist in the original (user additions/edits).
 */
function buildLineMapper(
	originalContent: string,
	currentContent: string,
): (currentLine: number) => number | null {
	if (originalContent === currentContent) return (line) => line;

	const parts = diffLines(originalContent, currentContent);
	const segments: Array<{
		currentStart: number;
		count: number;
		originalStart: number;
		type: "equal" | "added";
	}> = [];

	let origLine = 0;
	let currLine = 0;

	for (const part of parts) {
		if (part.value === "") continue;
		const lines = countPartLines(part.value);

		if (part.removed) {
			origLine += lines;
		} else if (part.added) {
			segments.push({ currentStart: currLine, count: lines, originalStart: origLine, type: "added" });
			currLine += lines;
		} else {
			segments.push({ currentStart: currLine, count: lines, originalStart: origLine, type: "equal" });
			origLine += lines;
			currLine += lines;
		}
	}

	return (currentLine: number): number | null => {
		for (const seg of segments) {
			if (currentLine >= seg.currentStart && currentLine < seg.currentStart + seg.count) {
				if (seg.type === "added") return null;
				return seg.originalStart + (currentLine - seg.currentStart);
			}
		}
		return null;
	};
}

/** Accumulator for extracting section-relevant text from a diff. */
interface SectionAccumulator {
	oldLine: number;
	sectionOld: string;
	sectionNew: string;
}

/** Collect lines from a removed/unchanged part that fall within a section range. */
function collectLinesForSection(
	lines: string[],
	acc: SectionAccumulator,
	lineStart: number,
	lineEnd: number,
	includeInNew: boolean,
): void {
	for (const line of lines) {
		if (acc.oldLine >= lineStart && acc.oldLine <= lineEnd) {
			acc.sectionOld += `${line}\n`;
			if (includeInNew) acc.sectionNew += `${line}\n`;
		}
		acc.oldLine++;
	}
}

/** Render word-level diff spans into a container element. */
function renderWordDiff(el: HTMLElement, oldText: string, newText: string): void {
	el.empty();
	const wordChanges = diffWords(oldText.trimEnd(), newText.trimEnd());

	for (const part of wordChanges) {
		const span = document.createElement("span");
		span.textContent = part.value;
		if (part.removed) {
			span.className = "ssb-reading-diff-word-removed";
		} else if (part.added) {
			span.className = "ssb-reading-diff-word-added";
		}
		el.appendChild(span);
	}
}

/**
 * Extract section-relevant text from the line-level diff, then apply
 * word-level diffing and replace the section element's content inline.
 */
function applyInlineWordDiff(
	el: HTMLElement,
	changes: Change[],
	lineStart: number,
	lineEnd: number,
): void {
	const acc: SectionAccumulator = { oldLine: 0, sectionOld: "", sectionNew: "" };

	for (const part of changes) {
		if (part.value === "") continue;
		const partLines = part.value.replace(/\n$/, "").split("\n");

		if (part.removed) {
			collectLinesForSection(partLines, acc, lineStart, lineEnd, false);
		} else if (part.added) {
			const insertionPoint = Math.max(0, acc.oldLine - 1);
			if (insertionPoint >= lineStart && insertionPoint <= lineEnd) {
				acc.sectionNew += part.value;
			}
		} else {
			collectLinesForSection(partLines, acc, lineStart, lineEnd, true);
		}
	}

	if (acc.sectionOld === acc.sectionNew) return;
	renderWordDiff(el, acc.sectionOld, acc.sectionNew);
}

function createReadingDiffActionBar(entryId: string, groupIndex: number): HTMLElement {
	const bar = document.createElement("div");
	bar.className = "ssb-diff-actions-bar";

	const label = document.createElement("span");
	label.className = "ssb-diff-actions-label";
	label.textContent = "Pending change";
	bar.appendChild(label);

	const acceptBtn = document.createElement("button");
	acceptBtn.className = "ssb-diff-accept-btn";
	acceptBtn.textContent = "Accept";
	acceptBtn.addEventListener("click", (e) => {
		e.preventDefault();
		try {
			const store = getPendingChangesStore();
			void store.acceptChangeGroup(entryId, groupIndex);
		} catch {
			/* store not initialized */
		}
	});
	bar.appendChild(acceptBtn);

	const rejectBtn = document.createElement("button");
	rejectBtn.className = "ssb-diff-reject-btn";
	rejectBtn.textContent = "Reject";
	rejectBtn.addEventListener("click", (e) => {
		e.preventDefault();
		try {
			const store = getPendingChangesStore();
			store.rejectChangeGroup(entryId, groupIndex);
		} catch {
			/* store not initialized */
		}
	});
	bar.appendChild(rejectBtn);

	return bar;
}

/**
 * Check if any line in a range overlaps [sectionStart, sectionEnd].
 */
function rangeOverlapsSection(
	startLine: number,
	lineCount: number,
	sectionStart: number,
	sectionEnd: number,
): boolean {
	const endLine = startLine + lineCount - 1;
	return endLine >= sectionStart && startLine <= sectionEnd;
}

/**
 * Process a single diff part for group index detection.
 * Returns the group index if this part overlaps the section, or -1 otherwise.
 */
function checkPartForSection(
	part: Change,
	groupIndex: number,
	oldLine: number,
	lineCount: number,
	sectionStart: number,
	sectionEnd: number,
): number {
	if (part.removed) {
		if (rangeOverlapsSection(oldLine, lineCount, sectionStart, sectionEnd)) {
			return groupIndex;
		}
	} else if (part.added) {
		const markerLine = Math.max(0, oldLine - 1);
		if (markerLine >= sectionStart && markerLine <= sectionEnd) return groupIndex;
	}
	return -1;
}

/**
 * Compute which diff group index a section belongs to, based on its line range.
 * Groups are contiguous sequences of removed/added parts in the line diff.
 */
function computeGroupIndexForSection(
	changes: Change[],
	sectionLineStart: number,
	sectionLineEnd: number,
): number {
	let oldLine = 0;
	let groupIndex = -1;
	let inGroup = false;

	for (const part of changes) {
		if (part.value === "") continue;
		const partLineCount = countPartLines(part.value);

		if (part.removed || part.added) {
			if (!inGroup) { groupIndex++; inGroup = true; }
			const result = checkPartForSection(part, groupIndex, oldLine, partLineCount, sectionLineStart, sectionLineEnd);
			if (result >= 0) return result;
			if (part.removed) oldLine += partLineCount;
		} else {
			inGroup = false;
			oldLine += partLineCount;
		}
	}

	return -1;
}

/**
 * Markdown post-processor that highlights sections in reading view
 * when they overlap with pending update changes, and adds accept/reject buttons.
 */
export function readingViewDiffPostProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
	const filePath = ctx.sourcePath;
	if (!filePath) return;

	let store: ReturnType<typeof getPendingChangesStore>;
	try {
		store = getPendingChangesStore();
	} catch {
		return;
	}

	const pendingUpdates = store.getPendingUpdatesForPath(filePath);
	if (pendingUpdates.length === 0) return;

	const entry = pendingUpdates.at(-1);
	if (!entry) return;
	const change = entry.change;
	if (change.type !== "update") return;

	const changes = diffLines(change.originalContent, change.newContent);
	const affectedLines = computeOriginalAffectedLines(change.originalContent, change.newContent);
	if (affectedLines.size === 0) return;

	const sectionInfo = ctx.getSectionInfo(el);
	if (!sectionInfo) return;

	const { lineStart, lineEnd } = sectionInfo;

	// Map section line numbers from current-content-space to originalContent-space
	const mapLine = buildLineMapper(change.originalContent, sectionInfo.text);
	const origLineStart = mapLine(lineStart);
	const origLineEnd = mapLine(lineEnd);

	// Skip sections in user-added/edited regions
	if (origLineStart === null || origLineEnd === null) return;

	// Check if any affected line falls within this section's original range
	for (let line = origLineStart; line <= origLineEnd; line++) {
		if (affectedLines.has(line)) {
			// Replace section content with inline word-diff (using original-space line range)
			applyInlineWordDiff(el, changes, origLineStart, origLineEnd);

			// Insert action bar at top if not already present
			if (!el.querySelector(".ssb-diff-actions-bar")) {
				const groupIndex = computeGroupIndexForSection(changes, origLineStart, origLineEnd);
				const actionBar = createReadingDiffActionBar(entry.id, groupIndex);
				el.insertBefore(actionBar, el.firstChild);
			}
			return;
		}
	}
}
