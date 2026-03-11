import type { Change } from "diff";
import { MarkdownRenderer, setIcon, type MarkdownPostProcessorContext, type Plugin } from "obsidian";
import { diffLines, diffWords } from "diff";
import { getPendingChangesStore } from "../stores/pendingChangesStore.svelte";
import { getData } from "../stores/dataStore.svelte";
import type { DiffViewMode } from "../types/plugin";
import type { PendingChangeEntry } from "../types/shared";

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
function buildLineMapper(originalContent: string, currentContent: string): (currentLine: number) => number | null {
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
		// Binary search for the segment containing currentLine
		let lo = 0;
		let hi = segments.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			const seg = segments[mid];
			if (currentLine < seg.currentStart) {
				hi = mid - 1;
			} else if (currentLine >= seg.currentStart + seg.count) {
				lo = mid + 1;
			} else {
				if (seg.type === "added") return null;
				return seg.originalStart + (currentLine - seg.currentStart);
			}
		}
		return null;
	};
}

/** Result of extracting section-relevant text from a diff. */
interface SectionExtraction {
	/** Unchanged lines in the section before the first change. */
	prefixText: string;
	/** Original text of the changed lines only. */
	sectionOld: string;
	/** New text of the changed lines only. */
	sectionNew: string;
	/** Unchanged lines in the section after the last change. */
	suffixText: string;
}

/** Render word-level diff spans into a container element. */
function renderWordDiff(el: HTMLElement, oldText: string, newText: string): void {
	el.empty();
	const wordChanges = diffWords(oldText.trimEnd(), newText.trimEnd());

	for (const part of wordChanges) {
		const span = document.createElement("span");
		span.textContent = part.value;
		if (part.removed) {
			span.className = "s2b-reading-diff-word-removed";
		} else if (part.added) {
			span.className = "s2b-reading-diff-word-added";
		}
		el.appendChild(span);
	}
}

/** Accumulator for building a SectionExtraction. */
interface ExtractionState {
	prefixText: string;
	sectionOld: string;
	sectionNew: string;
	suffixText: string;
	oldLine: number;
	seenChange: boolean;
}

/** Process a removed diff part, collecting lines within the section range. */
function processRemovedPart(lines: string[], lineStart: number, lineEnd: number, state: ExtractionState): void {
	for (const line of lines) {
		if (state.oldLine >= lineStart && state.oldLine <= lineEnd) {
			state.seenChange = true;
			state.sectionOld += `${line}\n`;
		}
		state.oldLine++;
	}
}

/** Process an unchanged diff part, routing lines to prefix or suffix. */
function processUnchangedPart(lines: string[], lineStart: number, lineEnd: number, state: ExtractionState): void {
	for (const line of lines) {
		if (state.oldLine >= lineStart && state.oldLine <= lineEnd) {
			if (state.seenChange) {
				state.suffixText += `${line}\n`;
			} else {
				state.prefixText += `${line}\n`;
			}
		}
		state.oldLine++;
	}
}

/**
 * Extract the old and new section text from the line-level diff,
 * separating unchanged prefix/suffix lines from the actual changed content.
 */
function extractSectionTexts(changes: Change[], lineStart: number, lineEnd: number): SectionExtraction {
	const state: ExtractionState = {
		prefixText: "",
		sectionOld: "",
		sectionNew: "",
		suffixText: "",
		oldLine: 0,
		seenChange: false,
	};

	for (const part of changes) {
		if (part.value === "") continue;
		const partLines = part.value.replace(/\n$/, "").split("\n");

		if (part.removed) {
			processRemovedPart(partLines, lineStart, lineEnd, state);
		} else if (part.added) {
			const insertionPoint = Math.max(0, state.oldLine - 1);
			if (insertionPoint >= lineStart && insertionPoint <= lineEnd) {
				state.seenChange = true;
				state.sectionNew += part.value;
			}
		} else {
			processUnchangedPart(partLines, lineStart, lineEnd, state);
		}
	}

	return {
		prefixText: state.prefixText,
		sectionOld: state.sectionOld,
		sectionNew: state.sectionNew,
		suffixText: state.suffixText,
	};
}

/** Append unchanged text as a div to a parent element. */
function appendContextText(parent: HTMLElement, text: string, className: string): void {
	if (!text) return;
	const div = document.createElement("div");
	div.className = className;
	div.textContent = text.trimEnd();
	parent.appendChild(div);
}

/**
 * Extract section-relevant text from the line-level diff, then apply
 * word-level diffing. Unchanged prefix/suffix lines within the section
 * are preserved as separate elements so the action bar and diff content
 * only cover the actual change.
 */
function applyInlineWordDiff(el: HTMLElement, changes: Change[], lineStart: number, lineEnd: number): void {
	const { prefixText, sectionOld, sectionNew, suffixText } = extractSectionTexts(changes, lineStart, lineEnd);
	if (sectionOld === sectionNew) return;

	el.empty();
	appendContextText(el, prefixText, "s2b-diff-context");

	const diffContent = document.createElement("div");
	diffContent.className = "s2b-diff-content";
	renderWordDiff(diffContent, sectionOld, sectionNew);
	el.appendChild(diffContent);

	appendContextText(el, suffixText, "s2b-diff-context");
}

/**
 * Render a two-pane stacked diff: the original section (red tint) on top,
 * the new section (green tint) below, both rendered as full markdown.
 */
async function applyTwoPaneDiff(
	el: HTMLElement,
	changes: Change[],
	lineStart: number,
	lineEnd: number,
	sourcePath: string,
	plugin: Plugin,
): Promise<void> {
	const { prefixText, sectionOld, sectionNew, suffixText } = extractSectionTexts(changes, lineStart, lineEnd);
	if (sectionOld === sectionNew) return;

	el.empty();
	appendContextText(el, prefixText, "s2b-diff-context");

	const diffContent = document.createElement("div");
	diffContent.className = "s2b-diff-content";

	const container = document.createElement("div");
	container.className = "s2b-diff-two-pane";

	const oldPane = document.createElement("div");
	oldPane.className = "s2b-diff-pane-removed";
	await MarkdownRenderer.render(plugin.app, sectionOld.trimEnd(), oldPane, sourcePath, plugin);
	container.appendChild(oldPane);

	const newPane = document.createElement("div");
	newPane.className = "s2b-diff-pane-added";
	await MarkdownRenderer.render(plugin.app, sectionNew.trimEnd(), newPane, sourcePath, plugin);
	container.appendChild(newPane);

	diffContent.appendChild(container);
	el.appendChild(diffContent);

	appendContextText(el, suffixText, "s2b-diff-context");
}

/** Context needed to re-render a diff section in a different mode. */
interface DiffRenderContext {
	changes: Change[];
	origLineStart: number;
	origLineEnd: number;
	filePath: string;
	plugin: Plugin;
}

function createReadingDiffActionBar(
	entryId: string,
	groupIndex: number,
	sectionEl: HTMLElement,
	renderCtx: DiffRenderContext,
): HTMLElement {
	const bar = document.createElement("div");
	bar.className = "s2b-diff-actions-bar";

	const label = document.createElement("span");
	label.className = "s2b-diff-actions-label";
	label.textContent = "Pending change";
	bar.appendChild(label);

	// Toggle view mode icon (visible on hover via CSS)
	const toggleBtn = document.createElement("button");
	toggleBtn.className = "s2b-diff-toggle-btn";
	toggleBtn.setAttribute("aria-label", "Toggle diff view");
	let currentMode: DiffViewMode;
	try {
		currentMode = getData().diffViewMode;
	} catch {
		currentMode = "word-diff";
	}
	setIcon(toggleBtn, currentMode === "word-diff" ? "columns-2" : "file-diff");
	toggleBtn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		try {
			const data = getData();
			data.diffViewMode = data.diffViewMode === "word-diff" ? "two-pane" : "word-diff";
		} catch {
			/* data store not initialized */
		}
		document.dispatchEvent(new CustomEvent("s2b-pending-changes-updated"));
	});
	bar.appendChild(toggleBtn);

	const acceptBtn = document.createElement("button");
	acceptBtn.className = "s2b-diff-accept-btn";
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
	rejectBtn.className = "s2b-diff-reject-btn";
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

/** Re-render only the diff content of a section element, preserving the action bar and context. */
function rerenderDiffContent(el: HTMLElement, ctx: DiffRenderContext, mode: DiffViewMode): void {
	// Remove only the diff content container — keep action bar and context text
	const oldDiffContent = el.querySelector(".s2b-diff-content");
	if (!oldDiffContent) return;
	const insertBefore = oldDiffContent.nextSibling;
	oldDiffContent.remove();

	const { sectionOld, sectionNew } = extractSectionTexts(ctx.changes, ctx.origLineStart, ctx.origLineEnd);
	if (sectionOld === sectionNew) return;

	const diffContent = document.createElement("div");
	diffContent.className = "s2b-diff-content";

	if (mode === "word-diff") {
		renderWordDiff(diffContent, sectionOld, sectionNew);
	} else {
		const container = document.createElement("div");
		container.className = "s2b-diff-two-pane";

		const oldPane = document.createElement("div");
		oldPane.className = "s2b-diff-pane-removed";
		const newPane = document.createElement("div");
		newPane.className = "s2b-diff-pane-added";

		container.appendChild(oldPane);
		container.appendChild(newPane);
		diffContent.appendChild(container);

		void Promise.all([
			MarkdownRenderer.render(ctx.plugin.app, sectionOld.trimEnd(), oldPane, ctx.filePath, ctx.plugin),
			MarkdownRenderer.render(ctx.plugin.app, sectionNew.trimEnd(), newPane, ctx.filePath, ctx.plugin),
		]);
	}

	if (insertBefore) {
		insertBefore.before(diffContent);
	} else {
		el.appendChild(diffContent);
	}
}

/**
 * Check if any line in a range overlaps [sectionStart, sectionEnd].
 */
function rangeOverlapsSection(startLine: number, lineCount: number, sectionStart: number, sectionEnd: number): boolean {
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
function computeGroupIndexForSection(changes: Change[], sectionLineStart: number, sectionLineEnd: number): number {
	let oldLine = 0;
	let groupIndex = -1;
	let inGroup = false;

	for (const part of changes) {
		if (part.value === "") continue;
		const partLineCount = countPartLines(part.value);

		if (part.removed || part.added) {
			if (!inGroup) {
				groupIndex++;
				inGroup = true;
			}
			const result = checkPartForSection(
				part,
				groupIndex,
				oldLine,
				partLineCount,
				sectionLineStart,
				sectionLineEnd,
			);
			if (result >= 0) return result;
			if (part.removed) oldLine += partLineCount;
		} else {
			inGroup = false;
			oldLine += partLineCount;
		}
	}

	return -1;
}

/** Apply the configured diff visualization to an affected section. */
function applyDiff(
	el: HTMLElement,
	changes: Change[],
	origLineStart: number,
	origLineEnd: number,
	filePath: string,
	plugin: Plugin,
): void {
	let mode: DiffViewMode = "word-diff";
	try {
		mode = getData().diffViewMode;
	} catch {
		// Data store not ready yet — fall back to word-diff
	}
	if (mode === "word-diff") {
		applyInlineWordDiff(el, changes, origLineStart, origLineEnd);
	} else {
		applyTwoPaneDiff(el, changes, origLineStart, origLineEnd, filePath, plugin).catch(() => {
			// Two-pane rendering failed — fall back to word-diff
			applyInlineWordDiff(el, changes, origLineStart, origLineEnd);
		});
	}
}

/** Check if a section overlaps affected lines and return true if it does. */
function sectionHasAffectedLine(affectedLines: Set<number>, origLineStart: number, origLineEnd: number): boolean {
	for (let line = origLineStart; line <= origLineEnd; line++) {
		if (affectedLines.has(line)) return true;
	}
	return false;
}

/**
 * Core logic for processing a section element for diff highlighting.
 */
function processSection(
	el: HTMLElement,
	entry: PendingChangeEntry,
	plugin: Plugin,
	filePath: string,
	sectionInfo: { text: string; lineStart: number; lineEnd: number },
): void {
	const change = entry.change;
	if (change.type !== "update") return;

	const changes = diffLines(change.originalContent, change.newContent);
	const affectedLines = computeOriginalAffectedLines(change.originalContent, change.newContent);
	if (affectedLines.size === 0) return;

	const mapLine = buildLineMapper(change.originalContent, sectionInfo.text);
	const origLineStart = mapLine(sectionInfo.lineStart);
	const origLineEnd = mapLine(sectionInfo.lineEnd);

	if (origLineStart === null || origLineEnd === null) return;
	if (!sectionHasAffectedLine(affectedLines, origLineStart, origLineEnd)) return;

	applyDiff(el, changes, origLineStart, origLineEnd, filePath, plugin);

	if (!el.querySelector(".s2b-diff-actions-bar")) {
		const groupIndex = computeGroupIndexForSection(changes, origLineStart, origLineEnd);
		if (groupIndex === -1) return;
		const renderCtx: DiffRenderContext = { changes, origLineStart, origLineEnd, filePath, plugin };
		const actionBar = createReadingDiffActionBar(entry.id, groupIndex, el, renderCtx);
		const diffContent = el.querySelector(".s2b-diff-content");
		if (diffContent) {
			diffContent.before(actionBar);
		} else {
			el.insertBefore(actionBar, el.firstChild);
		}

		// Sync with global mode changes (e.g. toggled from edit view or another section)
		const syncHandler = () => {
			if (!el.isConnected) {
				document.removeEventListener("s2b-pending-changes-updated", syncHandler);
				return;
			}
			let mode: DiffViewMode = "word-diff";
			try {
				mode = getData().diffViewMode;
			} catch {
				/* */
			}
			const toggleBtn = el.querySelector<HTMLElement>(".s2b-diff-toggle-btn");
			if (toggleBtn) setIcon(toggleBtn, mode === "word-diff" ? "columns-2" : "file-diff");
			rerenderDiffContent(el, renderCtx, mode);
		};
		document.addEventListener("s2b-pending-changes-updated", syncHandler);
	}
}

/**
 * Create a factory for the reading-view diff post-processor.
 * The plugin instance is captured so MarkdownRenderer can be used for two-pane diffs.
 */
export function createReadingViewDiffPostProcessor(plugin: Plugin) {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
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

		const sectionInfo = ctx.getSectionInfo(el);
		if (!sectionInfo) return;

		try {
			processSection(el, entry, plugin, filePath, sectionInfo);
		} catch {
			// Silently recover — don't break Obsidian's rendering pipeline
		}
	};
}
