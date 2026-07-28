import { type DecorationSet, Decoration, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { diffLines, diffWords } from "diff";
import { type App, Component, MarkdownRenderer, editorInfoField, setIcon } from "obsidian";
import { getData } from "../stores/dataStore.svelte";
import { getPendingChangesStore } from "../stores/pendingChangesStore.svelte";
import type { PendingChangeEntry } from "../types/shared";
import type { DiffViewMode } from "../types/plugin";

/** Dispatched to signal the plugin should rebuild decorations from the store. */
const refreshPendingChanges = StateEffect.define();

/**
 * Create the compact action bar shown at the head of a pending change group:
 * the "Pending change" label, a view-mode toggle, and Accept / Reject buttons.
 * The diff detail below is always shown (no collapse).
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
		// A view-mode flip is not a pending-changes mutation — use the dedicated
		// mode event so it doesn't trigger the reading views' destructive
		// rerender (see readingViewDiffProcessor). The editor field rebuilds its
		// decorations synchronously in response either way.
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
 * Render the diff detail body (word-diff or two-pane) for a change group. In
 * two-pane mode only the NEW content is shown, rendered as full markdown (the
 * original is already visible + red-tinted in the document). `app`/`sourcePath`
 * are needed for markdown rendering; a transient {@link Component} owns the
 * render lifecycle and is unloaded when the widget's DOM is torn down.
 */
function buildDetailBody(
	mode: DiffViewMode,
	removedText: string,
	addedText: string,
	app: App | null,
	sourcePath: string,
	onCleanup: (fn: () => void) => void,
): HTMLElement {
	const body = document.createElement("div");
	body.className = "s2b-diff-detail";

	if (mode === "two-pane") {
		const panes = document.createElement("div");
		panes.className = "s2b-diff-two-pane";

		// Only the new content is shown. The original lines are already visible
		// (and tinted red) in the document above/around this widget, so a removed
		// pane would just duplicate them.
		if (addedText) {
			const added = document.createElement("div");
			added.className = "s2b-diff-pane-added";
			if (app) {
				// Render markdown so the pane matches the reading-view two-pane
				// (headings/bold/lists formatted, not raw source).
				const component = new Component();
				component.load();
				onCleanup(() => component.unload());
				void MarkdownRenderer.render(app, addedText.trimEnd(), added, sourcePath, component);
			} else {
				const pre = document.createElement("pre");
				pre.textContent = addedText;
				added.appendChild(pre);
			}
			panes.appendChild(added);
		}

		body.appendChild(panes);
	} else {
		const preview = document.createElement("div");
		preview.className = "s2b-diff-edit-word-preview";
		appendWordDiffContent(preview, removedText, addedText);
		body.appendChild(preview);
	}

	return body;
}

/**
 * Lightweight block widget for a single change group: a compact action bar
 * (accept / reject / view-mode toggle) plus the always-shown word-diff /
 * two-pane detail. The removed/added lines are also conveyed by the line tints
 * in the document. This replaces the old always-on full-preview block widgets,
 * which reflowed the editor for every group.
 */
class PendingGroupWidget extends WidgetType {
	/** Markdown-render cleanups for the currently-shown detail body, so a
	 * re-render or widget teardown unloads its Components. */
	private detailCleanups: Array<() => void> = [];

	constructor(
		readonly entryId: string,
		readonly groupIndex: number,
		readonly removedText: string,
		readonly addedText: string,
		readonly mode: DiffViewMode,
		readonly app: App | null,
		readonly sourcePath: string,
	) {
		super();
	}

	private runDetailCleanups() {
		for (const fn of this.detailCleanups) fn();
		this.detailCleanups = [];
	}

	private buildDetail(): HTMLElement {
		this.runDetailCleanups();
		return buildDetailBody(this.mode, this.removedText, this.addedText, this.app, this.sourcePath, (fn) =>
			this.detailCleanups.push(fn),
		);
	}

	toDOM(): HTMLElement {
		const container = document.createElement("div");
		container.className = "s2b-diff-edit-group";

		container.appendChild(createEditActionBar(this.entryId, this.groupIndex));
		container.appendChild(this.buildDetail());

		return container;
	}

	destroy(): void {
		this.runDetailCleanups();
	}

	eq(other: PendingGroupWidget): boolean {
		return (
			this.entryId === other.entryId &&
			this.groupIndex === other.groupIndex &&
			this.removedText === other.removedText &&
			this.addedText === other.addedText &&
			this.mode === other.mode &&
			this.sourcePath === other.sourcePath
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

/** Block widget shown at the top of the document when OTHER chats also have a
 * pending update to this file. The inline diff only renders the newest pending
 * update ({@link getLatestPendingUpdateForPath} → `.at(-1)`), so without this
 * banner the existence of competing edits from other threads would be invisible
 * here. Purely informational — the entries are reviewed from each chat's own
 * PendingChangesBar. */
class CrossThreadBannerWidget extends WidgetType {
	constructor(readonly otherCount: number) {
		super();
	}

	toDOM(): HTMLElement {
		const banner = document.createElement("div");
		banner.className = "s2b-diff-cross-thread-banner";
		const chat = this.otherCount === 1 ? "chat has" : "chats have";
		banner.textContent = `${this.otherCount} other ${chat} a pending edit to this file. Only the latest is shown here; whichever is accepted first wins and the others may then fail to apply.`;
		return banner;
	}

	eq(other: CrossThreadBannerWidget): boolean {
		return this.otherCount === other.otherCount;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

function createGroupDecoration(
	group: ChangeGroup,
	entryId: string,
	groupIndex: number,
	mode: DiffViewMode,
	app: App | null,
	sourcePath: string,
): Decoration {
	const widget = new PendingGroupWidget(
		entryId,
		groupIndex,
		group.removedText,
		group.addedText,
		mode,
		app,
		sourcePath,
	);
	return Decoration.widget({ widget, side: -1, block: true });
}

/** Line-background tint decorations for removed/added lines within a group. */
const removedLineDecoration = Decoration.line({ class: "s2b-diff-line-removed" });
const addedLineDecoration = Decoration.line({ class: "s2b-diff-line-added" });
/** Neutral tint for removed lines in word-diff mode — marks the source lines
 * the card's diff refers to without the "deleted" connotation of red. */
const mutedLineDecoration = Decoration.line({ class: "s2b-diff-line-muted" });

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
function getEditorFilePath(state: EditorState): string | null {
	try {
		return state.field(editorInfoField, false)?.file?.path ?? null;
	} catch {
		return null;
	}
}

function getEditorApp(state: EditorState): App | null {
	try {
		return state.field(editorInfoField, false)?.app ?? null;
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

function buildDecorations(state: EditorState, entryOverride?: PendingChangeEntry | null): DecorationSet {
	try {
		const filePath = getEditorFilePath(state);
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

		const docText = state.doc.toString();
		const app = getEditorApp(state);
		const groups = identifyGroups(change.originalContent, change.newContent);
		if (groups.length === 0) return Decoration.none;

		const mapPos = buildPositionMapper(change.originalContent, docText);
		const decorations = [];

		// Prepend a banner if OTHER chats also have a pending update to this file
		// (the inline diff only renders this entry — the newest). Anchored at the
		// document start with side: -1 so it sorts before any group decoration.
		let otherThreads = 0;
		try {
			otherThreads = getPendingChangesStore().countOtherThreadsPendingUpdate(filePath, entry.threadId);
		} catch {
			otherThreads = 0;
		}
		if (otherThreads > 0) {
			decorations.push(
				Decoration.widget({ widget: new CrossThreadBannerWidget(otherThreads), side: -1, block: true }).range(
					0,
				),
			);
		}

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

			const clampedOffset = Math.min(mappedOffset, state.doc.length);
			const lineStart = state.doc.lineAt(clampedOffset).from;

			// Compact collapsible action bar for the group, anchored above its
			// first line (side: -1 so it sorts before the line decoration).
			decorations.push(createGroupDecoration(group, entry.id, gi, mode, app, filePath).range(lineStart));

			// Line-background tints — additive, no document reflow. Tint every
			// removed line the group covers; a pure insertion (no removed text)
			// tints its single anchor line as added. In word-diff mode the card
			// already shows the exact old->new inline, so removed lines get a
			// MUTED tint instead of red: a full red band there reads like "this
			// line was deleted" (misleading for an in-place edit), while no tint
			// makes the still-visible original look like a duplicate paragraph.
			// Two-pane keeps the red (the document is the reference the new pane
			// is compared against).
			let tint: Decoration;
			if (group.removedText) {
				tint = mode === "word-diff" ? mutedLineDecoration : removedLineDecoration;
			} else {
				tint = addedLineDecoration;
			}
			// group.docLength counts the removed lines' trailing newline, so
			// clampedOffset + docLength lands on the START of the line AFTER the
			// change — often a blank separator. Step back one char so the span ends
			// on the last removed line's own newline and the loop doesn't tint that
			// trailing blank line red (edit mode used to show a stray red gap under
			// the original; reading mode never did — this keeps them consistent).
			const spanEnd = group.removedText
				? Math.min(clampedOffset + group.docLength - 1, state.doc.length)
				: clampedOffset;
			let pos = lineStart;
			while (pos <= spanEnd) {
				const line = state.doc.lineAt(pos);
				decorations.push(tint.range(line.from));
				if (line.to >= state.doc.length) break;
				pos = line.to + 1;
			}
		}

		// Decoration.set(..., true) sorts the mixed line/widget/block ranges,
		// satisfying CM6's sorted-range invariant regardless of push order.
		return Decoration.set(decorations, true);
	} catch {
		return Decoration.none;
	}
}

/**
 * The pending-diff decorations live in a StateField (NOT a ViewPlugin): CM6
 * forbids block decorations — the collapsible group widget and cross-thread
 * banner are `block: true` — from being provided by a ViewPlugin ("Block
 * decorations may not be specified via plugins"). The field rebuilds when it
 * sees a {@link refreshPendingChanges} effect (fired by the companion plugin on
 * init, store changes, file switches, and viewport/geometry changes) or when
 * the document itself changes; otherwise it maps the existing set through the
 * transaction's changes to keep positions valid.
 */
const pendingDiffField = StateField.define<DecorationSet>({
	create() {
		// editorInfoField may not be ready during field init — defer the first
		// build to the companion plugin's scheduled refresh.
		return Decoration.none;
	},
	update(deco, tr) {
		const refreshRequested = tr.effects.some((e) => e.is(refreshPendingChanges));
		if (refreshRequested || tr.docChanged) {
			return buildDecorations(tr.state);
		}
		return deco.map(tr.changes);
	},
	provide: (f) => EditorView.decorations.from(f),
});

/**
 * Companion side-effect plugin: it holds no decorations itself. It (1) defers
 * the first decoration build until `editorInfoField` is ready (rAF loop, as the
 * field/plugin can be constructed before Obsidian attaches the file), (2)
 * rebuilds on the `s2b-pending-changes-updated` DOM event, and (3) re-fires the
 * refresh effect on file switches and viewport/geometry changes the field can't
 * observe on its own.
 */
const inlineDiffSideEffects = ViewPlugin.fromClass(
	class {
		private readonly refreshHandler: () => void;
		private readonly view: EditorView;
		private initialized = false;
		private refreshAttempts = 0;
		private lastFilePath: string | null = null;

		constructor(view: EditorView) {
			this.view = view;
			this.refreshHandler = () => {
				try {
					this.view.dispatch({ effects: refreshPendingChanges.of(null) });
				} catch {
					/* view may already be destroyed */
				}
			};
			document.addEventListener("s2b-pending-changes-updated", this.refreshHandler);
			document.addEventListener("s2b-diff-mode-changed", this.refreshHandler);
			this.scheduleInitialRefresh();
		}

		private scheduleInitialRefresh() {
			requestAnimationFrame(() => {
				if (this.initialized) return;

				const hasFilePath = getEditorFilePath(this.view.state) !== null;
				if (hasFilePath || this.refreshAttempts >= 4) {
					this.initialized = true;
					this.lastFilePath = getEditorFilePath(this.view.state);
					this.refreshHandler();
					return;
				}

				this.refreshAttempts++;
				this.scheduleInitialRefresh();
			});
		}

		update(update: ViewUpdate) {
			if (!this.initialized) return;

			const filePath = getEditorFilePath(this.view.state);
			if (filePath !== this.lastFilePath) {
				this.lastFilePath = filePath;
				this.refreshHandler();
				return;
			}

			// docChanged is handled directly by the field; only viewport/geometry
			// changes (which the field can't observe) need a nudge.
			if (update.viewportChanged || update.geometryChanged) {
				this.refreshHandler();
			}
		}

		destroy() {
			document.removeEventListener("s2b-pending-changes-updated", this.refreshHandler);
			document.removeEventListener("s2b-diff-mode-changed", this.refreshHandler);
		}
	},
);

/** Inline pending-diff decorations: the decoration StateField plus its
 * companion side-effect plugin. Registered as one editor extension. */
export const inlineDiffPlugin: Extension = [pendingDiffField, inlineDiffSideEffects];
