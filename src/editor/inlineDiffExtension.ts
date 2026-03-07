import {
	type DecorationSet,
	Decoration,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { diffLines, diffWords } from "diff";
import { editorInfoField } from "obsidian";
import { getPendingChangesStore } from "../stores/pendingChangesStore.svelte";

/**
 * Inline widget that shows added text (green) within the editor line.
 */
class AddedTextWidget extends WidgetType {
	constructor(readonly text: string) {
		super();
	}

	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "ssb-diff-word-added";
		span.textContent = this.text;
		return span;
	}

	eq(other: AddedTextWidget): boolean {
		return this.text === other.text;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/**
 * Inline widget that shows accept/reject buttons for a specific diff group.
 */
class ActionBarWidget extends WidgetType {
	constructor(
		readonly entryId: string,
		readonly groupIndex: number,
	) {
		super();
	}

	toDOM(): HTMLElement {
		const bar = document.createElement("span");
		bar.className = "ssb-diff-action-bar-widget";

		const label = document.createElement("span");
		label.className = "ssb-diff-actions-label";
		label.textContent = "Pending change";
		bar.appendChild(label);

		const acceptBtn = document.createElement("button");
		acceptBtn.className = "ssb-diff-accept-btn";
		acceptBtn.textContent = "Accept";
		acceptBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			try {
				const store = getPendingChangesStore();
				void store.acceptChangeGroup(this.entryId, this.groupIndex);
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
			e.stopPropagation();
			try {
				const store = getPendingChangesStore();
				store.rejectChangeGroup(this.entryId, this.groupIndex);
			} catch {
				/* store not initialized */
			}
		});
		bar.appendChild(rejectBtn);

		return bar;
	}

	eq(other: ActionBarWidget): boolean {
		return this.entryId === other.entryId && this.groupIndex === other.groupIndex;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

interface DiffRange {
	from: number;
	to?: number;
	decoration: Decoration;
}

/** A contiguous group of line-level changes in the diff. */
interface ChangeGroup {
	removedText: string;
	addedText: string;
	docOffset: number;
	docLength: number;
}

/**
 * Walk the word-level diff and produce mark decorations for removed words
 * and inline widget decorations for added words.
 */
function computeWordDecorations(
	originalText: string,
	newText: string,
	docOffset: number,
	out: DiffRange[],
): void {
	const parts = diffWords(originalText, newText);
	let pos = docOffset;

	for (const part of parts) {
		if (part.removed) {
			const len = part.value.length;
			if (len > 0) {
				out.push({
					from: pos,
					to: pos + len,
					decoration: Decoration.mark({ class: "ssb-diff-word-removed" }),
				});
			}
			pos += len;
		} else if (part.added) {
			out.push({
				from: pos,
				decoration: Decoration.widget({
					widget: new AddedTextWidget(part.value),
					side: 1,
				}),
			});
		} else {
			pos += part.value.length;
		}
	}
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
function buildPositionMapper(
	originalContent: string,
	docText: string,
): (origPos: number) => number | null {
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
function decorateGroup(
	group: ChangeGroup,
	mappedOffset: number,
	entryId: string,
	groupIndex: number,
	out: DiffRange[],
): void {
	out.push({
		from: mappedOffset,
		decoration: Decoration.widget({
			widget: new ActionBarWidget(entryId, groupIndex),
			side: -1,
		}),
	});

	if (group.removedText && group.addedText) {
		computeWordDecorations(group.removedText, group.addedText, mappedOffset, out);
	} else if (group.removedText) {
		out.push({
			from: mappedOffset,
			to: mappedOffset + group.docLength,
			decoration: Decoration.mark({ class: "ssb-diff-word-removed" }),
		});
	} else if (group.addedText) {
		out.push({
			from: mappedOffset,
			decoration: Decoration.widget({
				widget: new AddedTextWidget(group.addedText),
				side: 1,
			}),
		});
	}
}

function buildDecorations(view: EditorView): DecorationSet {
	try {
		const info = view.state.field(editorInfoField, false);
		const filePath = info?.file?.path;
		if (!filePath) return Decoration.none;

		let store: ReturnType<typeof getPendingChangesStore>;
		try {
			store = getPendingChangesStore();
		} catch {
			return Decoration.none;
		}

		const pendingUpdates = store.getPendingUpdatesForPath(filePath);
		if (pendingUpdates.length === 0) return Decoration.none;

		const entry = pendingUpdates.at(-1);
		if (!entry) return Decoration.none;
		const change = entry.change;
		if (change.type !== "update") return Decoration.none;

		const docText = view.state.doc.toString();
		const groups = identifyGroups(change.originalContent, change.newContent);
		if (groups.length === 0) return Decoration.none;

		const mapPos = buildPositionMapper(change.originalContent, docText);
		const decorations: DiffRange[] = [];

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

			decorateGroup(group, mappedOffset, entry.id, gi, decorations);
		}

		return Decoration.set(
			decorations.map((d) =>
				d.to === undefined
					? d.decoration.range(d.from)
					: d.decoration.range(d.from, d.to),
			),
			true,
		);
	} catch {
		return Decoration.none;
	}
}

export const inlineDiffPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		private readonly refreshHandler: () => void;
		private readonly view: EditorView;

		constructor(view: EditorView) {
			this.view = view;
			this.decorations = buildDecorations(view);
			this.refreshHandler = () => {
				this.decorations = buildDecorations(this.view);
				this.view.requestMeasure();
			};
			document.addEventListener("ssb-pending-changes-updated", this.refreshHandler);
		}

		update(update: ViewUpdate) {
			if (update.docChanged) {
				// Map existing decorations through user edits to preserve positions
				this.decorations = this.decorations.map(update.changes);
			}
		}

		destroy() {
			document.removeEventListener("ssb-pending-changes-updated", this.refreshHandler);
		}
	},
	{
		decorations: (v) => v.decorations,
	},
);
