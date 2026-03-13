import { type DecorationSet, Decoration, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { StateEffect, type Extension } from "@codemirror/state";

/** Carries an array of {from, to} ranges to highlight, or empty to clear. */
const setHighlightEffect = StateEffect.define<{ from: number; to: number }[]>();

const highlightMark = Decoration.mark({ class: "s2b-selection-highlight" });

/**
 * CM6 ViewPlugin that renders dim highlight marks over previously-selected
 * text ranges. Driven by setHighlightEffect dispatched from the SelectionTracker.
 */
export const selectionHighlightPlugin: Extension = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet = Decoration.none;

        update(update: ViewUpdate) {
            for (const tr of update.transactions) {
                for (const effect of tr.effects) {
                    if (effect.is(setHighlightEffect)) {
                        const ranges = effect.value;
                        if (ranges.length === 0) {
                            this.decorations = Decoration.none;
                        } else {
                            const docLen = update.state.doc.length;
                            const marks = ranges
                                .filter((r) => r.from >= 0 && r.to <= docLen && r.from < r.to)
                                .map((r) => highlightMark.range(r.from, r.to));
                            this.decorations = Decoration.set(marks, true);
                        }
                    }
                }
            }
        }
    },
    { decorations: (v) => v.decorations },
);

/** Apply dim highlight marks to the given ranges in a CM6 EditorView. */
export function setSelectionHighlight(view: EditorView, ranges: { from: number; to: number }[]): void {
    view.dispatch({ effects: setHighlightEffect.of(ranges) });
}

/** Clear all dim highlight marks from a CM6 EditorView. */
export function clearSelectionHighlight(view: EditorView): void {
    view.dispatch({ effects: setHighlightEffect.of([]) });
}
