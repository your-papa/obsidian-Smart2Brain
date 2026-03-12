import { MarkdownView, type EventRef, type TFile, type Workspace, type WorkspaceLeaf } from "obsidian";
import { getPlugin } from "../stores/state.svelte";

export interface VisibleNote {
	file: TFile;
	viewType: string;
	/** e.g. "p. 1 / 2" for PDFs, "§ Heading" for markdown */
	context?: string;
	icon: string;
}

/** Serializable version of VisibleNote (no TFile). Persisted in HumanMessage additional_kwargs. */
export interface VisibleNoteRef {
	path: string;
	basename: string;
	viewType: string;
	context?: string;
	icon: string;
}

export function toVisibleNoteRefs(notes: VisibleNote[]): VisibleNoteRef[] {
	return notes.map((n) => ({
		path: n.file.path,
		basename: n.file.basename,
		viewType: n.viewType,
		context: n.context,
		icon: n.icon,
	}));
}

const VIEW_TYPES = ["markdown", "pdf", "canvas", "image"] as const;

const VIEW_ICONS: Record<string, string> = {
	markdown: "file-text",
	pdf: "file-type",
	canvas: "layout-dashboard",
	image: "image",
};

function getPdfContext(view: unknown): string | undefined {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: Obsidian internal PDF viewer API
		const inner = (view as any)?.viewer?.child?.pdfViewer?.pdfViewer;
		if (!inner) return undefined;
		const page: number = inner._currentPageNumber ?? inner.currentPageNumber;
		const total: number = inner._pages?.length ?? inner.pagesCount;
		if (typeof page !== "number" || page <= 0 || typeof total !== "number" || total <= 0) {
			return undefined;
		}
		// PDFs can define custom page labels (e.g. 0-indexed, Roman numerals).
		// When present, show the label instead of the raw page number.
		const labels: string[] | null = inner._pageLabels;
		const label = labels?.[page - 1];
		if (label != null && label !== "" && label !== String(page)) {
			return `p. ${label} / ${total}`;
		}
		return `p. ${page} / ${total}`;
	} catch {
		/* internal API may change */
	}
	return undefined;
}

function getMarkdownContext(view: unknown): string | undefined {
	try {
		if (!(view instanceof MarkdownView) || !view.file) return undefined;
		const cache = view.app.metadataCache.getFileCache(view.file);
		const headings = cache?.headings;
		if (!headings?.length) return undefined;

		// Use ephemeral scroll / cursor position to pick the nearest heading
		const cursor = view.editor?.getCursor();
		if (!cursor) return undefined;
		const line = cursor.line;

		// Walk headings in reverse to find the last one at or before the cursor
		for (let i = headings.length - 1; i >= 0; i--) {
			if (headings[i].position.start.line <= line) {
				return `§ ${headings[i].heading}`;
			}
		}
	} catch {
		/* safety net */
	}
	return undefined;
}

function getContext(type: string, leaf: WorkspaceLeaf): string | undefined {
	switch (type) {
		case "pdf":
			return getPdfContext(leaf.view);
		case "markdown":
			return getMarkdownContext(leaf.view);
		default:
			return undefined;
	}
}

/**
 * One-shot snapshot of visible notes. Use at send time to inject context
 * into the agent query without requiring a reactive tracker.
 */
export function getVisibleNotes(workspace: Workspace): VisibleNote[] {
	const visible: VisibleNote[] = [];
	const seen = new Set<string>();

	for (const type of VIEW_TYPES) {
		for (const leaf of workspace.getLeavesOfType(type)) {
			if (leaf.getRoot() !== workspace.rootSplit) continue;
			if ((leaf as any).containerEl?.style.display === "none") continue;
			const file = (leaf.view as { file?: TFile }).file;
			if (!file || seen.has(file.path)) continue;
			seen.add(file.path);

			visible.push({
				file,
				viewType: type,
				context: getContext(type, leaf),
				icon: VIEW_ICONS[type] ?? "file",
			});
		}
	}

	return visible;
}

/** Formats visible notes into a context string for the agent. */
export function formatVisibleNotesContext(notes: VisibleNoteRef[]): string {
	if (notes.length === 0) return "";
	const lines = notes.map((n) => {
		const ctx = n.context ? ` (${n.context})` : "";
		return `- ${n.path}${ctx}`;
	});
	return `[Currently visible notes]\n${lines.join("\n")}`;
}

/**
 * Reactive tracker for files visible in the main workspace area.
 * Tracks markdown, PDF, canvas, and image views.
 * Provides context metadata (current PDF page, active heading, etc.).
 */
export class VisibleNotesTracker {
	#workspace = getPlugin().app.workspace;
	#notes: VisibleNote[] = $state([]);
	#refs: EventRef[] = [];
	#interval: ReturnType<typeof setInterval> | undefined;

	get notes(): VisibleNote[] {
		return this.#notes;
	}

	constructor() {
		this.#refresh();
		this.#refs = [
			this.#workspace.on("active-leaf-change", () => this.#refresh()),
			this.#workspace.on("layout-change", () => this.#refresh()),
		];
		// Poll periodically so the sidebar chat stays in sync and
		// context (PDF page, heading) updates without requiring focus.
		this.#interval = setInterval(() => this.#refresh(), 1500);
	}

	#refresh() {
		const visible = getVisibleNotes(this.#workspace);

		// Only update state when the visible set actually changed to avoid
		// unnecessary Svelte re-renders from the polling interval.
		if (!this.#notesEqual(this.#notes, visible)) {
			this.#notes = visible;
		}
	}

	#notesEqual(a: VisibleNote[], b: VisibleNote[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i].file.path !== b[i].file.path || a[i].context !== b[i].context) return false;
		}
		return true;
	}

	destroy() {
		for (const ref of this.#refs) {
			this.#workspace.offref(ref);
		}
		this.#refs = [];
		clearInterval(this.#interval);
		this.#interval = undefined;
	}
}
