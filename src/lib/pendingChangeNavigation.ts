import { diffLines } from "diff";
import { MarkdownView, Notice, TFile } from "obsidian";
import { computeOriginalAffectedLines } from "../editor/readingViewDiffProcessor";
import type SecondBrainPlugin from "../main";
import { getPendingChangesStore } from "../stores/pendingChangesStore.svelte";
import type { PendingChange, PendingChangeEntry } from "../types/shared";
import { ChatView } from "../views/chat/Chat";

/**
 * Per-thread navigation cursor for stepping through a chat's pending changes.
 *
 * Keyed by threadId, valued by the STOP KEY of the last-visited change group
 * (`entryId#groupIndex`, see {@link stopKey}) — not an index: accept/reject can
 * reorder or drop stops mid-navigation, and a key survives that (a stale key
 * simply isn't found and we restart at the head/tail). The groupIndex is part
 * of the key because a single entry (one file edit) can contain several
 * non-adjacent change groups, and navigation steps through each of them.
 * Kept out of `pendingChangesStore` on purpose: the cursor is UI navigation
 * state, so folding it into the store would pollute its reactive `revision`
 * signal and couple the store to the workspace.
 */
const cursors = new Map<string, string>();

/**
 * A single navigation stop: one contiguous change group within an entry, plus
 * the 0-based original-content line it starts at. Multiple stops can share an
 * entry when a file edit touches several separate spots.
 */
export interface NavStop {
	entry: PendingChangeEntry;
	groupIndex: number;
	line: number;
}

/** Stable cursor key for a stop. `create`/`delete`/`move` have a single group 0. */
function stopKey(entryId: string, groupIndex: number): string {
	return `${entryId}#${groupIndex}`;
}

/**
 * Count lines in a diff part value (trailing newline ignored). Mirrors the
 * helper in readingViewDiffProcessor so group line numbers line up with the
 * decorations shown in the note.
 */
function countPartLines(value: string): number {
	if (value === "") return 0;
	return value.replace(/\n$/, "").split("\n").length;
}

/**
 * The first original-content line of each contiguous change group in an update,
 * indexed the same way the store/decorations index groups (0,1,2… in document
 * order — a group is a run of added/removed parts ended by an unchanged part).
 * Returns `[{ groupIndex, line }]`. For pure insertions the line is the original
 * line just before the insertion point (matching computeOriginalAffectedLines).
 */
function groupFirstLines(originalContent: string, newContent: string): Array<{ groupIndex: number; line: number }> {
	const parts = diffLines(originalContent, newContent);
	const out: Array<{ groupIndex: number; line: number }> = [];
	let oldLine = 0; // 0-based line in originalContent
	let groupIndex = -1;
	let inGroup = false;
	let groupLine = 0;

	for (const part of parts) {
		if (part.value === "") continue;
		const lines = countPartLines(part.value);

		if (part.removed) {
			if (!inGroup) {
				inGroup = true;
				groupIndex++;
				groupLine = oldLine;
			}
			oldLine += lines;
		} else if (part.added) {
			if (!inGroup) {
				inGroup = true;
				groupIndex++;
				// Pure insertion: anchor to the line before the insertion point.
				groupLine = Math.max(0, oldLine - 1);
			}
		} else {
			if (inGroup) {
				out.push({ groupIndex, line: groupLine });
				inGroup = false;
			}
			oldLine += lines;
		}
	}
	if (inGroup) out.push({ groupIndex, line: groupLine });

	return out;
}

/** The navigation stops contributed by one entry, in document order. */
function stopsForEntry(entry: PendingChangeEntry): NavStop[] {
	if (entry.change.type === "update") {
		const groups = groupFirstLines(entry.change.originalContent, entry.change.newContent);
		if (groups.length > 0) return groups.map((g) => ({ entry, groupIndex: g.groupIndex, line: g.line }));
	}
	// create/delete/move (or a degenerate update): a single stop at the top.
	return [{ entry, groupIndex: 0, line: 0 }];
}

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

/**
 * Every navigation stop for the thread, ordered so next/prev steps through each
 * changed spot: by file path, then by line within the file, then groupIndex as
 * a final tiebreak. Entries are pre-sorted by {@link orderedPendingForThread};
 * expanding each into its groups and re-sorting by line keeps multi-spot files
 * visited top-to-bottom.
 */
export function orderedStopsForThread(threadId: string): NavStop[] {
	const entries = orderedPendingForThread(threadId);
	const stops = entries.flatMap(stopsForEntry);
	return stops.sort(
		(a, b) =>
			a.entry.change.path.localeCompare(b.entry.change.path) ||
			a.line - b.line ||
			a.groupIndex - b.groupIndex ||
			a.entry.id.localeCompare(b.entry.id),
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
	// Open WITHOUT eState.line: passing it makes Obsidian flash the target line
	// yellow (.is-flashing), which is redundant here — the change's own red/green
	// tint already marks the spot. scrollToLine handles the scroll in both modes.
	await leaf.openFile(file);
	void ws.revealLeaf(leaf);
	if (leaf.view instanceof MarkdownView) scrollToLine(leaf.view, line);
	return true;
}

/**
 * Advance the thread's navigation cursor in `direction` (wrapping around) and
 * reveal+scroll to that change group. Shared by the in-note diff bars, the
 * PendingChangesBar arrows, and the command-palette commands so all stay in
 * sync. Steps through each changed spot (group) within a file before moving to
 * the next file.
 *
 * Returns the stop navigated to, or null when the thread has no pending changes
 * (the caller Notices). A `create` target that isn't on disk yet still advances
 * the cursor but shows a Notice instead of opening nothing.
 */
export async function navigateToPendingChange(
	plugin: SecondBrainPlugin,
	threadId: string,
	direction: "next" | "prev",
): Promise<NavStop | null> {
	const stops = orderedStopsForThread(threadId);
	const n = stops.length;
	if (n === 0) {
		cursors.delete(threadId);
		return null;
	}

	const currentKey = cursors.get(threadId);
	const currentIdx = currentKey ? stops.findIndex((s) => stopKey(s.entry.id, s.groupIndex) === currentKey) : -1;
	let idx: number;
	if (currentIdx === -1) {
		// No cursor yet, or it pointed at an accepted/rejected group: start at the
		// head for "next" and the tail for "prev".
		idx = direction === "next" ? 0 : n - 1;
	} else {
		idx = direction === "next" ? (currentIdx + 1) % n : (currentIdx - 1 + n) % n;
	}

	const target = stops[idx];
	cursors.set(threadId, stopKey(target.entry.id, target.groupIndex));

	const opened = await revealAndScroll(plugin, target.entry.change.path, target.line);
	if (!opened) {
		new Notice("This change creates a new file — nothing to open yet.");
	}
	return target;
}

/** Drop a thread's cursor (e.g. when the thread is removed). */
export function clearCursor(threadId: string): void {
	cursors.delete(threadId);
}
