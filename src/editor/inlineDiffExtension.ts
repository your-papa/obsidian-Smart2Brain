import {
	type DecorationSet,
	Decoration,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { diffLines, diffWords } from "diff";
import { editorInfoField, setIcon } from "obsidian";
import { getData } from "../stores/dataStore.svelte";
import { getPendingChangesStore } from "../stores/pendingChangesStore.svelte";
import type { PendingChangeEntry } from "../types/shared";
import type { DiffViewMode } from "../types/plugin";

/** Dispatched to signal the plugin should rebuild decorations from the store. */
const refreshPendingChanges = StateEffect.define();

/**
 * Create an action bar element with toggle, accept, and reject buttons for edit view.
 */
function createEditActionBar(entryId: string, groupIndex: number): HTMLElement {
	const bar = document.createElement("div");
	bar.className = "s2b-diff-action-bar-widget";

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

	return bar;
}

function appendWordDiffContent(container: HTMLElement, removedText: string, addedText: string): void {
	const parts = diffWords(removedText, addedText);

	for (const part of parts) {
		const span = document.createElement("span");
		span.textContent = part.value;
		if (part.removed) {
			span.className = "s2b-diff-word-removed";
		} else if (part.added) {
			span.className = "s2b-diff-word-added";
		}
		container.appendChild(span);
	}
}

/**
 * Block widget that shows a word-level diff preview with an action bar.
 */
class WordDiffGroupWidget extends WidgetType {
	constructor(
		readonly entryId: string,
		readonly groupIndex: number,
		readonly removedText: string,
		readonly addedText: string,
	) {
		super();
	}

	toDOM(): HTMLElement {
		const container = document.createElement("div");
		container.className = "s2b-diff-edit-word-container";

		container.appendChild(createEditActionBar(this.entryId, this.groupIndex));

		const preview = document.createElement("div");
		preview.className = "s2b-diff-edit-word-preview";
		appendWordDiffContent(preview, this.removedText, this.addedText);
		container.appendChild(preview);

		return container;
	}

	eq(other: WordDiffGroupWidget): boolean {
		return (
			this.entryId === other.entryId &&
			this.groupIndex === other.groupIndex &&
			this.removedText === other.removedText &&
			this.addedText === other.addedText
		);
	}

	ignoreEvent(): boolean {
		return false;
	}
}

/**
 * Block widget that shows a two-pane diff (removed/added) with an action bar (two-pane mode).
 */
class TwoPaneGroupWidget extends WidgetType {
	constructor(
		readonly entryId: string,
		readonly groupIndex: number,
		readonly removedText: string,
		readonly addedText: string,
	) {
		super();
	}

	toDOM(): HTMLElement {
		const container = document.createElement("div");
		container.className = "s2b-diff-edit-two-pane-container";

		container.appendChild(createEditActionBar(this.entryId, this.groupIndex));

		const panes = document.createElement("div");
		panes.className = "s2b-diff-two-pane";

		if (this.removedText) {
			const removed = document.createElement("div");
			removed.className = "s2b-diff-pane-removed";
			const pre = document.createElement("pre");
			pre.textContent = this.removedText;
			removed.appendChild(pre);
			panes.appendChild(removed);
		}

		if (this.addedText) {
			const added = document.createElement("div");
			added.className = "s2b-diff-pane-added";
			const pre = document.createElement("pre");
			pre.textContent = this.addedText;
			added.appendChild(pre);
			panes.appendChild(added);
		}

		container.appendChild(panes);
		return container;
	}

	eq(other: TwoPaneGroupWidget): boolean {
		return (
			this.entryId === other.entryId &&
			this.groupIndex === other.groupIndex &&
			this.removedText === other.removedText &&
			this.addedText === other.addedText
		);
	}

	ignoreEvent(): boolean {
		return false;
	}
}

/** A contiguous group of line-level changes in the diff. */
interface ChangeGroup {
	removedText: string;
	addedText: string;
	docOffset: number;
	docLength: number;
}

function createGroupDecoration(
	group: ChangeGroup,
	entryId: string,
	groupIndex: number,
	mode: DiffViewMode,
): Decoration {
	const widget =
		mode === "two-pane"
			? new TwoPaneGroupWidget(entryId, groupIndex, group.removedText, group.addedText)
			: new WordDiffGroupWidget(entryId, groupIndex, group.removedText, group.addedText);

	return Decoration.widget({ widget, side: -1, block: true });
}

/**
 * Identify contiguous change groups from a line-level diff.
 * Each group tracks its removed/added text and position relative to the first text.
 */
function identifyGroups(fromText: string, toText: string): ChangeGroup[] {
	const lineChanges = diffLines(fromText, toText);
	const groups: ChangeGroup[] = [];
	let docPos = 0;
	let current: ChangeGroup | null = null;

	for (const part of lineChanges) {
		if (part.removed) {
			if (!current) {
				current = { removedText: "", addedText: "", docOffset: docPos, docLength: 0 };
			}
			current.removedText += part.value;
			current.docLength += part.value.length;
			docPos += part.value.length;
		} else if (part.added) {
			if (!current) {
				current = { removedText: "", addedText: "", docOffset: docPos, docLength: 0 };
			}
			current.addedText += part.value;
		} else {
			if (current) {
				groups.push(current);
				current = null;
			}
			docPos += part.value.length;
		}
	}
	if (current) groups.push(current);

	return groups;
}

/**
 * Build a function that maps positions from originalContent-space to docText-space,
 * accounting for user edits. Returns null for positions that fall in regions
 * the user has modified (deleted/changed).
 */
function buildPositionMapper(originalContent: string, docText: string): (origPos: number) => number | null {
	if (originalContent === docText) return (pos) => pos;

	const parts = diffLines(originalContent, docText);
	const segments: Array<{
		fromStart: number;
		fromEnd: number;
		shift: number;
		type: "equal" | "removed";
	}> = [];
	let fromPos = 0;
	let toPos = 0;

	for (const part of parts) {
		if (part.removed) {
			segments.push({
				fromStart: fromPos,
				fromEnd: fromPos + part.value.length,
				shift: toPos - fromPos,
				type: "removed",
			});
			fromPos += part.value.length;
		} else if (part.added) {
			toPos += part.value.length;
		} else {
			segments.push({
				fromStart: fromPos,
				fromEnd: fromPos + part.value.length,
				shift: toPos - fromPos,
				type: "equal",
			});
			fromPos += part.value.length;
			toPos += part.value.length;
		}
	}

	return (origPos: number): number | null => {
		for (const seg of segments) {
			if (origPos >= seg.fromStart && origPos < seg.fromEnd) {
				if (seg.type === "removed") return null;
				return origPos + seg.shift;
			}
		}
		// Position at or beyond the end — use last segment's shift
		const last = segments.at(-1);
		if (last?.fromEnd === origPos) {
			return origPos + last.shift;
		}
		return origPos;
	};
}

/** Build decorations for a single change group at the given mapped offset. */
function getEditorFilePath(view: EditorView): string | null {
	try {
		return view.state.field(editorInfoField, false)?.file?.path ?? null;
	} catch {
		return null;
	}
}

function getLatestPendingUpdateForPath(filePath: string): PendingChangeEntry | null {
	try {
		return getPendingChangesStore().getPendingUpdatesForPath(filePath).at(-1) ?? null;
	} catch {
		return null;
	}
}

function buildDecorations(view: EditorView, entryOverride?: PendingChangeEntry | null): DecorationSet {
	try {
		const filePath = getEditorFilePath(view);
		if (!filePath) return Decoration.none;

		const entry = entryOverride ?? getLatestPendingUpdateForPath(filePath);
		if (!entry) return Decoration.none;
		const change = entry.change;
		if (change.type !== "update") return Decoration.none;

		let mode: DiffViewMode;
		try {
			mode = getData().diffViewMode;
		} catch {
			mode = "word-diff";
		}

		const docText = view.state.doc.toString();
		const groups = identifyGroups(change.originalContent, change.newContent);
		if (groups.length === 0) return Decoration.none;

		const mapPos = buildPositionMapper(change.originalContent, docText);
		const decorations = [];

		for (let gi = 0; gi < groups.length; gi++) {
			const group = groups[gi];
			const mappedOffset = mapPos(group.docOffset);
			if (mappedOffset === null) continue;

			if (
				group.removedText &&
				docText.substring(mappedOffset, mappedOffset + group.docLength) !== group.removedText
			) {
				continue;
			}

			const lineStart = view.state.doc.lineAt(Math.min(mappedOffset, view.state.doc.length)).from;
			const decoration = createGroupDecoration(group, entry.id, gi, mode);
			decorations.push(decoration.range(lineStart));
		}

		return Decoration.set(decorations, true);
	} catch {
		return Decoration.none;
	}
}

export const inlineDiffPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet = Decoration.none;
		private readonly refreshHandler: () => void;
		private readonly view: EditorView;
		private initialized = false;
		private refreshAttempts = 0;
		private hasPendingUpdate = false;
		private lastFilePath: string | null = null;

		constructor(view: EditorView) {
			this.view = view;
			// Don't call buildDecorations during construction or the first
			// synchronous update — editorInfoField may not be ready yet and
			// causes "Failed to open" errors in Obsidian.
			// Schedule the first build for the next frame.
			this.refreshHandler = () => {
				this.view.dispatch({ effects: refreshPendingChanges.of(null) });
			};
			document.addEventListener("s2b-pending-changes-updated", this.refreshHandler);
			this.scheduleInitialRefresh();
		}

		private scheduleInitialRefresh() {
			requestAnimationFrame(() => {
				if (this.initialized) return;

				const hasFilePath = getEditorFilePath(this.view) !== null;
				if (hasFilePath || this.refreshAttempts >= 4) {
					this.initialized = true;
					try {
						this.view.dispatch({ effects: refreshPendingChanges.of(null) });
					} catch {
						/* view may already be destroyed */
					}
					return;
				}

				this.refreshAttempts++;
				this.scheduleInitialRefresh();
			});
		}

		private rebuildDecorations(filePath = getEditorFilePath(this.view)) {
			this.lastFilePath = filePath;
			if (!filePath) {
				this.hasPendingUpdate = false;
				this.decorations = Decoration.none;
				return;
			}

			const entry = getLatestPendingUpdateForPath(filePath);
			this.hasPendingUpdate = entry !== null;
			this.decorations = buildDecorations(this.view, entry);
		}

		update(update: ViewUpdate) {
			if (!this.initialized) return;
			const refreshRequested = update.transactions.some((tr) =>
				tr.effects.some((e) => e.is(refreshPendingChanges)),
			);
			const filePath = getEditorFilePath(this.view);
			const fileChanged = filePath !== this.lastFilePath;

			if (refreshRequested || fileChanged) {
				this.rebuildDecorations(filePath);
				return;
			}

			if (!this.hasPendingUpdate) return;

			if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
				this.decorations = buildDecorations(this.view);
			}
		}

		destroy() {
			document.removeEventListener("s2b-pending-changes-updated", this.refreshHandler);
		}
	},
	{
		decorations: (v) => v.decorations,
	},
);
