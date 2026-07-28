import { MarkdownView, Notice, TFile } from "obsidian";
import { computeOriginalAffectedLines } from "../editor/readingViewDiffProcessor";
import type SecondBrainPlugin from "../main";
import { getPendingChangesStore } from "../stores/pendingChangesStore.svelte";
import type { PendingChange, PendingChangeEntry } from "../types/shared";
import { ChatView } from "../views/chat/Chat";

/**
 * Per-thread navigation cursor for stepping through a chat's pending changes.
 *
 * Keyed by threadId, valued by the ENTRY ID of the last-visited change (not an
 * index): accept/reject can reorder or drop entries mid-navigation, and an id
 * survives that — a stale id simply isn't found and we restart at the head/tail.
 * Kept out of `pendingChangesStore` on purpose: the cursor is UI navigation
 * state, so folding it into the store would pollute its reactive `revision`
 * signal and couple the store to the workspace.
 */
const cursors = new Map<string, string>();

/**
 * The thread's pending changes in a stable, deterministic order: by path
 * (so a file's changes are adjacent), then createdAt, then id as a final
 * tiebreak. `getPendingForThread` returns pending-only but in insertion order,
 * which isn't stable enough for group-by-file — hence the sort here.
 */
export function orderedPendingForThread(threadId: string): PendingChangeEntry[] {
	const store = getPendingChangesStore();
	return [...store.getPendingForThread(threadId)].sort(
		(a, b) => a.change.path.localeCompare(b.change.path) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
	);
}

/** 0-based line to scroll to: the first changed line of an update, else the top of the file. */
export function firstChangedLine(change: PendingChange): number {
	if (change.type === "update") {
		const lines = computeOriginalAffectedLines(change.originalContent, change.newContent);
		if (lines.size === 0) return 0;
		return Math.min(...lines);
	}
	return 0;
}

/**
 * Scroll a MarkdownView to `line`, working in both source and reading mode.
 * `currentMode.applyScroll` is the sub-view (editor or preview) actually shown,
 * and both implement it — `setEphemeralState({ line })` alone does NOT reliably
 * scroll the reading view.
 *
 * Reading-mode layout isn't final the instant a leaf is revealed/re-rendered, so
 * a single synchronous call scrolls a not-yet-tall container and lands at 0. We
 * re-apply on the next frame and once more shortly after so the scroll sticks
 * whether the view is ready now or momentarily later.
 */
function scrollToLine(view: MarkdownView, line: number): void {
	const apply = () => view.currentMode.applyScroll(line);
	apply();
	requestAnimationFrame(apply);
	window.setTimeout(apply, 50);
}

/**
 * Reveal the note at `path` and scroll it to `line`, preserving the mode of an
 * already-open leaf. Returns false when the path has no on-disk file (e.g. a
 * `create` change not yet accepted) so the caller can surface a Notice.
 */
export async function revealAndScroll(plugin: SecondBrainPlugin, path: string, line: number): Promise<boolean> {
	const ws = plugin.app.workspace;
	const file = plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return false;

	// Reuse a leaf already showing this note — keeps its current reading/edit mode.
	const existing = ws
		.getLeavesOfType("markdown")
		.find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
	if (existing && existing.view instanceof MarkdownView) {
		ws.setActiveLeaf(existing, { focus: true });
		void ws.revealLeaf(existing);
		scrollToLine(existing.view, line);
		return true;
	}

	// Otherwise open the note. Reuse the current leaf UNLESS it hosts a chat —
	// opening a note into the ChatView leaf would replace the chat the user is
	// reviewing from (the arrows/commands are triggered while the chat is active).
	// In that case open a new tab so the chat survives.
	const current = ws.getLeaf(false);
	const leaf = current.view instanceof ChatView ? ws.getLeaf("tab") : current;
	// eState scrolls the initial (source) render; then apply a mode-aware scroll
	// once the view is mounted so reading mode lands correctly too.
	await leaf.openFile(file, { eState: { line } });
	void ws.revealLeaf(leaf);
	if (leaf.view instanceof MarkdownView) scrollToLine(leaf.view, line);
	return true;
}

/**
 * Advance the thread's navigation cursor in `direction` (wrapping around) and
 * reveal+scroll to that change. Shared by the PendingChangesBar arrows and the
 * command-palette commands so both stay in sync.
 *
 * Returns the entry navigated to, or null when the thread has no pending changes
 * (the caller Notices). A `create` target that isn't on disk yet still advances
 * the cursor but shows a Notice instead of opening nothing.
 */
export async function navigateToPendingChange(
	plugin: SecondBrainPlugin,
	threadId: string,
	direction: "next" | "prev",
): Promise<PendingChangeEntry | null> {
	const ordered = orderedPendingForThread(threadId);
	const n = ordered.length;
	if (n === 0) {
		cursors.delete(threadId);
		return null;
	}

	const currentId = cursors.get(threadId);
	const currentIdx = currentId ? ordered.findIndex((e) => e.id === currentId) : -1;
	let idx: number;
	if (currentIdx === -1) {
		// No cursor yet, or it pointed at an accepted/rejected entry: start at the
		// head for "next" and the tail for "prev".
		idx = direction === "next" ? 0 : n - 1;
	} else {
		idx = direction === "next" ? (currentIdx + 1) % n : (currentIdx - 1 + n) % n;
	}

	const target = ordered[idx];
	cursors.set(threadId, target.id);

	const opened = await revealAndScroll(plugin, target.change.path, firstChangedLine(target.change));
	if (!opened) {
		new Notice("This change creates a new file — nothing to open yet.");
	}
	return target;
}

/** Drop a thread's cursor (e.g. when the thread is removed). */
export function clearCursor(threadId: string): void {
	cursors.delete(threadId);
}
