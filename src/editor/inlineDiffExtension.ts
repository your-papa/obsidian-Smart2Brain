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
import type { DiffViewMode } from "../types/plugin";

/** Dispatched to signal the plugin should rebuild decorations from the store. */
const refreshPendingChanges = StateEffect.define();

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
        // Preserve whitespace and newlines in added text
        for (const line of this.text.split("\n")) {
            if (span.childNodes.length > 0) {
                span.appendChild(document.createElement("br"));
            }
            span.appendChild(document.createTextNode(line));
        }
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
 * Create an action bar element with toggle, accept, and reject buttons for edit view.
 */
function createEditActionBar(entryId: string, groupIndex: number): HTMLElement {
    const bar = document.createElement("span");
    bar.className = "ssb-diff-action-bar-widget";

    const label = document.createElement("span");
    label.className = "ssb-diff-actions-label";
    label.textContent = "Pending change";
    bar.appendChild(label);

    // Toggle view mode icon (visible on hover via CSS)
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "ssb-diff-toggle-btn";
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
        document.dispatchEvent(new CustomEvent("ssb-pending-changes-updated"));
    });
    bar.appendChild(toggleBtn);

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "ssb-diff-accept-btn";
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
    rejectBtn.className = "ssb-diff-reject-btn";
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

/**
 * Inline widget that shows the action bar for a specific diff group (word-diff mode).
 */
class ActionBarWidget extends WidgetType {
    constructor(
        readonly entryId: string,
        readonly groupIndex: number,
    ) {
        super();
    }

    toDOM(): HTMLElement {
        return createEditActionBar(this.entryId, this.groupIndex);
    }

    eq(other: ActionBarWidget): boolean {
        return this.entryId === other.entryId && this.groupIndex === other.groupIndex;
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
        container.className = "ssb-diff-edit-two-pane-container";

        container.appendChild(createEditActionBar(this.entryId, this.groupIndex));

        const panes = document.createElement("div");
        panes.className = "ssb-diff-two-pane";

        if (this.removedText) {
            const removed = document.createElement("div");
            removed.className = "ssb-diff-pane-removed";
            const pre = document.createElement("pre");
            pre.textContent = this.removedText;
            removed.appendChild(pre);
            panes.appendChild(removed);
        }

        if (this.addedText) {
            const added = document.createElement("div");
            added.className = "ssb-diff-pane-added";
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
    docLength: number,
    out: DiffRange[],
): void {
    const parts = diffWords(originalText, newText);
    let pos = docOffset;
    // Never place decorations beyond the region occupied by the original text in the doc.
    const maxPos = docOffset + docLength;

    for (const part of parts) {
        if (part.removed) {
            const len = part.value.length;
            if (len > 0) {
                const from = Math.min(pos, maxPos);
                const to = Math.min(pos + len, maxPos);
                if (to > from) {
                    out.push({
                        from,
                        to,
                        decoration: Decoration.mark({ class: "ssb-diff-word-removed" }),
                    });
                }
            }
            pos += len;
        } else if (part.added) {
            // Clamp insertion point so the widget never lands past the document region.
            const insertPos = Math.min(pos, maxPos);
            out.push({
                from: insertPos,
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
    mode: DiffViewMode,
): void {
    if (mode === "two-pane") {
        if (group.docLength > 0) {
            out.push({
                from: mappedOffset,
                to: mappedOffset + group.docLength,
                decoration: Decoration.replace({
                    widget: new TwoPaneGroupWidget(entryId, groupIndex, group.removedText, group.addedText),
                }),
            });
        } else {
            // Pure insertion — no text to replace, show as widget
            out.push({
                from: mappedOffset,
                decoration: Decoration.widget({
                    widget: new TwoPaneGroupWidget(entryId, groupIndex, group.removedText, group.addedText),
                    side: 1,
                }),
            });
        }
        return;
    }

    // word-diff mode
    out.push({
        from: mappedOffset,
        decoration: Decoration.widget({
            widget: new ActionBarWidget(entryId, groupIndex),
            side: -1,
        }),
    });

    if (group.removedText && group.addedText) {
        computeWordDecorations(group.removedText, group.addedText, mappedOffset, group.docLength, out);
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

            decorateGroup(group, mappedOffset, entry.id, gi, decorations, mode);
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
        decorations: DecorationSet = Decoration.none;
        private readonly refreshHandler: () => void;
        private readonly view: EditorView;
        private initialized = false;

        constructor(view: EditorView) {
            this.view = view;
            // Don't call buildDecorations during construction or the first
            // synchronous update — editorInfoField may not be ready yet and
            // causes "Failed to open" errors in Obsidian.
            // Schedule the first build for the next frame.
            this.refreshHandler = () => {
                this.view.dispatch({ effects: refreshPendingChanges.of(null) });
            };
            document.addEventListener("ssb-pending-changes-updated", this.refreshHandler);
            requestAnimationFrame(() => {
                if (!this.initialized) {
                    this.initialized = true;
                    try {
                        this.view.dispatch({ effects: refreshPendingChanges.of(null) });
                    } catch {
                        /* view may already be destroyed */
                    }
                }
            });
        }

        update(update: ViewUpdate) {
            if (!this.initialized) return;
            if (
                update.docChanged ||
                update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshPendingChanges)))
            ) {
                this.decorations = buildDecorations(this.view);
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
