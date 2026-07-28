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
export function computeOriginalAffectedLines(originalContent: string, newContent: string): Set<number> {
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
			// A pure insertion removes no original line. Flag both the line before
			// the insertion point AND the original line now following it (oldLine):
			// the "before" line is often a blank separator owned by no rendered
			// section, so relying on it alone silently drops the decoration.
			affected.add(Math.max(0, oldLine - 1));
			affected.add(oldLine);
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
			// Match the insertion to the section either by the line before it or
			// by the original line now following it (state.oldLine) — the "before"
			// line is often a blank separator owned by no rendered section, which
			// would otherwise leave the detail body empty. Mirrors
			// computeOriginalAffectedLines / checkPartForSection.
			const beforeLine = Math.max(0, state.oldLine - 1);
			const inSection =
				(beforeLine >= lineStart && beforeLine <= lineEnd) ||
				(state.oldLine >= lineStart && state.oldLine <= lineEnd);
			if (inSection) {
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

/**
 * Render a word-level diff of the changed section into a detail container.
 * Additive — the caller owns `container`; Obsidian's rendered markdown is
 * never touched.
 */
function applyInlineWordDiff(container: HTMLElement, changes: Change[], lineStart: number, lineEnd: number): void {
	const { sectionOld, sectionNew } = extractSectionTexts(changes, lineStart, lineEnd);
	if (sectionOld === sectionNew) return;

	const diffContent = document.createElement("div");
	diffContent.className = "s2b-diff-content";
	renderWordDiff(diffContent, sectionOld, sectionNew);
	container.appendChild(diffContent);
}

/**
 * Render the "new content" preview into a detail container: the proposed section
 * text rendered as full markdown into a pane we own (green tint). The original
 * text is deliberately NOT shown — Obsidian's rendered markdown of the current
 * (original) note is already visible directly beneath this decoration, so a
 * removed pane would just duplicate it. Additive — Obsidian's rendered markdown
 * is never touched.
 */
async function applyTwoPaneDiff(
	container: HTMLElement,
	changes: Change[],
	lineStart: number,
	lineEnd: number,
	sourcePath: string,
	plugin: Plugin,
): Promise<void> {
	const { sectionOld, sectionNew } = extractSectionTexts(changes, lineStart, lineEnd);
	if (sectionOld === sectionNew) return;

	const diffContent = document.createElement("div");
	diffContent.className = "s2b-diff-content";

	const paneWrap = document.createElement("div");
	paneWrap.className = "s2b-diff-two-pane";

	const newPane = document.createElement("div");
	newPane.className = "s2b-diff-pane-added";
	await MarkdownRenderer.render(plugin.app, sectionNew.trimEnd(), newPane, sourcePath, plugin);
	paneWrap.appendChild(newPane);

	diffContent.appendChild(paneWrap);
	container.appendChild(diffContent);
}

/** Context needed to re-render a diff section in a different mode. */
interface DiffRenderContext {
	changes: Change[];
	origLineStart: number;
	origLineEnd: number;
	filePath: string;
	plugin: Plugin;
}

/** Render the diff detail (word-diff or two-pane) into a detail container. */
function renderDetailInto(container: HTMLElement, ctx: DiffRenderContext, mode: DiffViewMode): void {
	container.empty();
	if (mode === "word-diff") {
		applyInlineWordDiff(container, ctx.changes, ctx.origLineStart, ctx.origLineEnd);
	} else {
		applyTwoPaneDiff(container, ctx.changes, ctx.origLineStart, ctx.origLineEnd, ctx.filePath, ctx.plugin).catch(
			() => {
				applyInlineWordDiff(container, ctx.changes, ctx.origLineStart, ctx.origLineEnd);
			},
		);
	}
}

/**
 * Build the action bar + always-shown detail body for a reading-view change
 * group. Additive: returns a fragment the caller prepends to the section; it
 * never touches Obsidian's rendered markdown. The diff detail is always rendered
 * (no collapse); the toggle switches word-diff ↔ two-pane in place.
 */
function createReadingDiffActionBar(entryId: string, groupIndex: number, renderCtx: DiffRenderContext): HTMLElement {
	const wrap = document.createElement("div");
	wrap.className = "s2b-diff-reading-group";

	const bar = document.createElement("div");
	bar.className = "s2b-diff-actions-bar";
	wrap.appendChild(bar);

	const detail = document.createElement("div");
	detail.className = "s2b-diff-detail";
	wrap.appendChild(detail);

	const renderDetail = () => {
		let mode: DiffViewMode = "word-diff";
		try {
			mode = getData().diffViewMode;
		} catch {
			/* data store not ready */
		}
		renderDetailInto(detail, renderCtx, mode);
	};

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
		// A view-mode flip is NOT a pending-changes mutation — dispatch the
		// dedicated mode event so only the in-place re-render paths react. Firing
		// s2b-pending-changes-updated here would trigger main.ts's destructive
		// previewMode.rerender(true), which races (and loses to) the async
		// two-pane render and tears down the review card.
		document.dispatchEvent(new CustomEvent("s2b-diff-mode-changed"));
	});
	bar.appendChild(toggleBtn);

	const acceptBtn = document.createElement("button");
	acceptBtn.className = "s2b-diff-accept-btn";
	acceptBtn.textContent = "Accept";
	acceptBtn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
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
		e.stopPropagation();
		try {
			const store = getPendingChangesStore();
			store.rejectChangeGroup(entryId, groupIndex);
		} catch {
			/* store not initialized */
		}
	});
	bar.appendChild(rejectBtn);

	// The diff detail is always shown (no collapse) — render it now. It survives
	// store-triggered section re-renders via the same call path.
	renderDetail();

	return wrap;
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
		// Mirror computeOriginalAffectedLines: match either the line before the
		// insertion point or the original line now following it, so group-index
		// detection stays consistent with the widened affected set.
		const beforeLine = Math.max(0, oldLine - 1);
		if (
			(beforeLine >= sectionStart && beforeLine <= sectionEnd) ||
			(oldLine >= sectionStart && oldLine <= sectionEnd)
		) {
			return groupIndex;
		}
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

/** Check if a section overlaps affected lines and return true if it does. */
function sectionHasAffectedLine(affectedLines: Set<number>, origLineStart: number, origLineEnd: number): boolean {
	for (let line = origLineStart; line <= origLineEnd; line++) {
		if (affectedLines.has(line)) return true;
	}
	return false;
}

/** Whether the changed section has any removed lines (vs. a pure insertion). */
function sectionHasRemoval(changes: Change[], lineStart: number, lineEnd: number): boolean {
	const { sectionOld } = extractSectionTexts(changes, lineStart, lineEnd);
	return sectionOld.trim().length > 0;
}

/**
 * Strip any diff decoration this processor previously applied to a section
 * element. Needed because the processor is additive and Obsidian reuses section
 * DOM nodes across `rerender(true)` — without this a tint/review bar would
 * linger after the pending change is accepted/rejected or the section stops
 * overlapping a change.
 */
function clearSectionDecoration(el: HTMLElement): void {
	el.classList.remove(
		"s2b-diff-section",
		"s2b-diff-section-removed",
		"s2b-diff-section-added",
		"s2b-diff-hide-original",
	);
	el.querySelector(":scope > .s2b-diff-reading-group")?.remove();
}

/**
 * In word-diff mode the detail already shows the old (red) and new (green) text
 * inline, so the section's own rendered original is a duplicate — hide it (and
 * suppress the section tint, which would otherwise be an empty red band). In
 * two-pane mode the original stays visible beneath the new-content pane.
 */
function applyWordDiffOriginalVisibility(el: HTMLElement, mode: DiffViewMode): void {
	el.classList.toggle("s2b-diff-hide-original", mode === "word-diff");
}

/**
 * Core logic for decorating a rendered section that overlaps a pending change.
 * Purely ADDITIVE — it tints the section and prepends a collapsible review bar,
 * but never calls `el.empty()` or replaces Obsidian's rendered markdown, so it
 * does not clash with other plugins' post-processors.
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
	if (!sectionHasAffectedLine(affectedLines, origLineStart, origLineEnd)) {
		// This section no longer overlaps the change (e.g. content shifted after
		// an accept on a reused DOM node) — clear any stale decoration.
		clearSectionDecoration(el);
		return;
	}

	// Idempotency: if we already decorated this section (re-entry from a
	// re-render), do nothing rather than double-insert.
	if (el.classList.contains("s2b-diff-section") || el.querySelector(":scope > .s2b-diff-reading-group")) {
		return;
	}

	// Additive tint on the rendered section.
	el.classList.add("s2b-diff-section");
	el.classList.add(
		sectionHasRemoval(changes, origLineStart, origLineEnd) ? "s2b-diff-section-removed" : "s2b-diff-section-added",
	);

	const groupIndex = computeGroupIndexForSection(changes, origLineStart, origLineEnd);
	if (groupIndex === -1) return;
	const renderCtx: DiffRenderContext = { changes, origLineStart, origLineEnd, filePath, plugin };
	const groupEl = createReadingDiffActionBar(entry.id, groupIndex, renderCtx);
	el.insertBefore(groupEl, el.firstChild);

	// Hide the (duplicated) original when the initial mode is word-diff.
	let initialMode: DiffViewMode = "word-diff";
	try {
		initialMode = getData().diffViewMode;
	} catch {
		/* data store not ready */
	}
	applyWordDiffOriginalVisibility(el, initialMode);

	// Sync the toggle icon + expanded detail with global mode changes (e.g.
	// toggled from this or another section, or the editor). Only re-renders our
	// detail subtree in place — never the section. Listens to the dedicated
	// mode event (fired by the toggle) as well as the pending-changes event (so
	// the icon stays correct after external mutations).
	const syncHandler = () => {
		if (!el.isConnected) {
			document.removeEventListener("s2b-pending-changes-updated", syncHandler);
			document.removeEventListener("s2b-diff-mode-changed", syncHandler);
			return;
		}
		let mode: DiffViewMode = "word-diff";
		try {
			mode = getData().diffViewMode;
		} catch {
			/* */
		}
		const toggleBtn = groupEl.querySelector<HTMLElement>(".s2b-diff-toggle-btn");
		if (toggleBtn) setIcon(toggleBtn, mode === "word-diff" ? "columns-2" : "file-diff");
		applyWordDiffOriginalVisibility(el, mode);
		const detail = groupEl.querySelector<HTMLElement>(":scope > .s2b-diff-detail");
		if (detail) {
			renderDetailInto(detail, renderCtx, mode);
		}
	};
	document.addEventListener("s2b-pending-changes-updated", syncHandler);
	document.addEventListener("s2b-diff-mode-changed", syncHandler);
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
		if (pendingUpdates.length === 0) {
			// No pending change for this file — strip any decoration left on a
			// reused section node from a previous render.
			clearSectionDecoration(el);
			return;
		}

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
