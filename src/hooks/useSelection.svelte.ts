import { MarkdownView, type EventRef, type Workspace, type WorkspaceLeaf } from "obsidian";
import { getPlugin } from "../stores/state.svelte";
import { clearSelectionHighlight, setSelectionHighlight } from "../editor/selectionHighlightExtension";

/** Serializable snapshot of user-selected text. Persisted in HumanMessage additional_kwargs. */
export interface SelectionRef {
	path: string;
	basename: string;
	viewType: string;
	text: string;
	icon: string;
}

interface CapturedSelection {
	ref: SelectionRef;
	/** CM6 ranges for edit-mode highlights (from/to offsets in the document). */
	cmRanges?: { from: number; to: number }[];
	/** Saved DOM Range objects for reading / PDF highlight persistence. */
	domRanges?: Range[];
}

const VIEW_ICONS: Record<string, string> = {
	markdown: "file-text",
	pdf: "file-type",
};

const LONG_SELECTION_CHARS = 4000;

/**
 * Attempt to get the selected text in the active leaf.
 * Supports markdown edit mode (CM6), markdown reading mode, and PDF views.
 */
function getSelectionFromLeaf(leaf: WorkspaceLeaf): CapturedSelection | undefined {
	const view = leaf.view;
	const file = (view as { file?: { path: string; basename: string } }).file;
	if (!file) return undefined;

	const viewType = leaf.view.getViewType();

	// --- Markdown edit mode: use CM6 selection API ---
	if (view instanceof MarkdownView && view.getMode() === "source") {
		try {
			// biome-ignore lint/suspicious/noExplicitAny: Obsidian internal CM6 API
			const cm = (view.editor as any).cm;
			if (!cm?.state) return undefined;
			const sel = cm.state.selection;
			const ranges = sel.ranges.filter((r: { from: number; to: number }) => r.from !== r.to);
			if (ranges.length === 0) return undefined;

			const text = ranges
				.map((r: { from: number; to: number }) => cm.state.doc.sliceString(r.from, r.to))
				.join("\n");
			if (!text.trim()) return undefined;

			return {
				ref: {
					path: file.path,
					basename: file.basename,
					viewType: "markdown",
					text,
					icon: VIEW_ICONS.markdown,
				},
				cmRanges: ranges.map((r: { from: number; to: number }) => ({ from: r.from, to: r.to })),
			};
		} catch {
			/* CM internals may change */
		}
		return undefined;
	}

	// --- Markdown reading mode & PDF: use DOM selection ---
	if ((view instanceof MarkdownView && view.getMode() === "preview") || viewType === "pdf") {
		try {
			const domSel = activeWindow.getSelection();
			if (!domSel || domSel.rangeCount === 0) return undefined;

			// Scope to the leaf's container so we don't capture stray selections
			const container = leaf.view.containerEl;
			const firstRange = domSel.getRangeAt(0);
			if (!container.contains(firstRange.commonAncestorContainer)) return undefined;

			const text = domSel.toString();
			if (!text.trim()) return undefined;

			const domRanges: Range[] = [];
			for (let i = 0; i < domSel.rangeCount; i++) {
				domRanges.push(domSel.getRangeAt(i).cloneRange());
			}

			const icon = viewType === "pdf" ? VIEW_ICONS.pdf : VIEW_ICONS.markdown;
			return {
				ref: { path: file.path, basename: file.basename, viewType, text, icon },
				domRanges,
			};
		} catch {
			/* safety */
		}
	}

	return undefined;
}

/** Formats a captured selection into a context block for the agent. */
export function formatSelectionContext(ref: SelectionRef): string {
	return `[Selected text from ${ref.path}]\n${ref.text}`;
}

/**
 * Reactive tracker for user text selections in the main workspace area.
 * Polls the active leaf for non-empty selections and exposes a snapshot
 * that persists even after focus moves to the chat input.
 */
export class SelectionTracker {
	#workspace = getPlugin().app.workspace;
	#selection: CapturedSelection | undefined = $state(undefined);
	#refs: EventRef[] = [];
	#interval: ReturnType<typeof setInterval> | undefined;
	/** When true, selection was pinned (focus left the note) and should be kept. */
	#pinned = false;

	/** The current captured selection ref (serializable). */
	get selection(): SelectionRef | undefined {
		return this.#selection?.ref;
	}

	/** Whether the current selection exceeds the long-selection warning threshold. */
	get isLong(): boolean {
		return (this.#selection?.ref.text.length ?? 0) > LONG_SELECTION_CHARS;
	}

	constructor() {
		this.#refresh();
		this.#refs = [
			this.#workspace.on("active-leaf-change", () => {
				// When focus leaves a note (e.g. to the chat sidebar),
				// pin whatever we captured so the chip stays.
				if (this.#selection && !this.#pinned) {
					this.#pin();
				}
				this.#refresh();
			}),
		];
		this.#interval = setInterval(() => this.#refresh(), 1000);
	}

	#refresh() {
		const activeLeaf = this.#workspace.activeLeaf;
		if (!activeLeaf) return;

		// Check if we're in a note/PDF leaf (not the chat sidebar)
		const vt = activeLeaf.view.getViewType();
		const isNoteLeaf = vt === "markdown" || vt === "pdf";

		// If pinned but user is back in a note leaf, check for a new selection
		if (this.#pinned && isNoteLeaf) {
			const captured = getSelectionFromLeaf(activeLeaf);
			if (captured && !this.#selectionEqual(this.#selection, captured)) {
				// User made a new selection — unpin and adopt it
				this.#clearHighlights();
				this.#pinned = false;
				this.#selection = captured;
			}
			return;
		}

		// Don't overwrite a pinned selection
		if (this.#pinned) return;

		const captured = isNoteLeaf ? getSelectionFromLeaf(activeLeaf) : undefined;
		if (captured) {
			// New non-empty selection detected → update
			if (!this.#selectionEqual(this.#selection, captured)) {
				this.#selection = captured;
			}
		}
		// If selection is now empty and we haven't pinned, clear
		else if (this.#selection && !this.#pinned) {
			this.#selection = undefined;
		}
	}

	/** Pin the current selection and apply dim highlights so the user can see what was captured. */
	#pin() {
		if (!this.#selection) return;
		this.#pinned = true;

		const captured = this.#selection;

		// CM6 edit mode: dispatch decoration marks
		if (captured.cmRanges?.length) {
			try {
				const activeLeaf = this.#workspace.activeLeaf;
				if (activeLeaf?.view instanceof MarkdownView) {
					// biome-ignore lint/suspicious/noExplicitAny: Obsidian internal CM6 API
					const cm = (activeLeaf.view.editor as any).cm;
					if (cm) setSelectionHighlight(cm, captured.cmRanges);
				}
			} catch {
				/* CM internals */
			}
		}

		// Reading / PDF: use CSS Custom Highlight API
		if (captured.domRanges?.length) {
			try {
				if (CSS.highlights) {
					const highlight = new Highlight(...captured.domRanges);
					CSS.highlights.set("s2b-selection", highlight);
				}
			} catch {
				/* API may not be available */
			}
		}
	}

	/** Clear the captured selection and remove all highlights. */
	clear() {
		this.#selection = undefined;
		this.#pinned = false;
		this.#clearHighlights();
	}

	/** Remove all visual highlights (CM6 decorations and CSS Highlight API). */
	#clearHighlights() {
		// Remove CM6 highlights from all editors
		try {
			for (const leaf of this.#workspace.getLeavesOfType("markdown")) {
				if (leaf.view instanceof MarkdownView) {
					// biome-ignore lint/suspicious/noExplicitAny: Obsidian internal CM6 API
					const cm = (leaf.view.editor as any).cm;
					if (cm) clearSelectionHighlight(cm);
				}
			}
		} catch {
			/* safety */
		}

		// Remove CSS Highlight API highlights
		try {
			CSS.highlights?.delete("s2b-selection");
		} catch {
			/* safety */
		}
	}

	#selectionEqual(a: CapturedSelection | undefined, b: CapturedSelection | undefined): boolean {
		if (!a && !b) return true;
		if (!a || !b) return false;
		return a.ref.path === b.ref.path && a.ref.text === b.ref.text;
	}

	destroy() {
		this.clear();
		for (const ref of this.#refs) {
			this.#workspace.offref(ref);
		}
		this.#refs = [];
		clearInterval(this.#interval);
		this.#interval = undefined;
	}
}
