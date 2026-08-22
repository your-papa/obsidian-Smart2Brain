import { type EventRef, normalizePath, TFile } from "obsidian";
import { type Change, diffLines } from "diff";
import { z } from "zod";
import type SecondBrainPlugin from "../main";
import type { PendingChange, PendingChangeEntry } from "../types/shared";
import { shouldProcessVaultPath } from "../utils/fileFiltering";
import { genUUIDv7 } from "../utils/uuid7Validator";
import { Logger } from "../utils/logging";
import { getData } from "./dataStore.svelte";

const SAVE_DEBOUNCE_MS = 1000;
const STORAGE_FILE = "data/pending-changes.json";

const pendingChangeSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("create"), path: z.string(), content: z.string() }),
	z.object({
		type: z.literal("update"),
		path: z.string(),
		originalContent: z.string(),
		newContent: z.string(),
		initialOriginalContent: z.string().optional(),
	}),
	z.object({ type: z.literal("delete"), path: z.string(), originalContent: z.string() }),
	z.object({ type: z.literal("move"), path: z.string(), newPath: z.string() }),
]);

const pendingChangeEntrySchema = z.object({
	id: z.string(),
	change: pendingChangeSchema,
	status: z.enum(["pending", "accepted", "rejected"]),
	toolCallId: z.string(),
	threadId: z.string(),
	createdAt: z.number(),
});

const pendingChangesArraySchema = z.array(pendingChangeEntrySchema);

let _store: PendingChangesStore | null = null;

/**
 * Why a partially-applied note was not restored.
 *
 * - `conflict` — it changed after the group accept, so we left the user's work alone.
 * - `missing`  — nothing exists at that path any more (deleted, or moved while the
 *                plugin was unloaded); there is nothing to restore.
 * - `failed`   — the write itself threw.
 */
export interface RevertSkip {
	path: string;
	reason: "conflict" | "missing" | "failed";
}

/**
 * Determine whether to include a removed or added part in the output.
 */
function shouldIncludePart(part: Change, isTarget: boolean, targetUsesNew: boolean): boolean {
	const useNew = isTarget ? targetUsesNew : !targetUsesNew;
	if (part.removed) return !useNew;
	if (part.added) return useNew;
	return true;
}

/**
 * Build file content by applying only one group's changes.
 * Groups are contiguous sequences of removed/added parts in the line diff.
 *
 * - accept (targetUsesNew=true): target group uses new text, others keep original
 * - reject (targetUsesNew=false): target group keeps original, others use new text
 */
function buildPartialContent(changes: Change[], groupIndex: number, targetUsesNew: boolean): string {
	let currentGroup = -1;
	let inGroup = false;
	let result = "";

	for (const part of changes) {
		if (part.removed || part.added) {
			if (!inGroup) {
				currentGroup++;
				inGroup = true;
			}
			if (shouldIncludePart(part, currentGroup === groupIndex, targetUsesNew)) {
				result += part.value;
			}
		} else {
			inGroup = false;
			result += part.value;
		}
	}

	return result;
}
export function getPendingChangesStore(): PendingChangesStore {
	if (!_store) throw new Error("PendingChangesStore not initialized");
	return _store;
}

export function initPendingChangesStore(store: PendingChangesStore): void {
	_store = store;
}

export class PendingChangesStore {
	#entries: PendingChangeEntry[] = $state([]);
	#revision = $state(0);
	readonly #plugin: SecondBrainPlugin;
	#saveTimer: ReturnType<typeof setTimeout> | null = null;
	readonly #processingGroups = new Set<string>();
	readonly #fileLocks = new Map<string, Promise<void>>();
	readonly #batchProcessing = new Set<string>();
	#renameHandler: EventRef | null = null;

	constructor(plugin: SecondBrainPlugin) {
		this.#plugin = plugin;
	}

	async load(): Promise<void> {
		const path = this.storagePath;
		if (await this.#plugin.app.vault.adapter.exists(path)) {
			try {
				const raw = await this.#plugin.app.vault.adapter.read(path);
				const parsed = JSON.parse(raw);
				const result = pendingChangesArraySchema.safeParse(parsed);
				if (result.success) {
					this.#entries = result.data as PendingChangeEntry[];
				} else {
					Logger.error(
						"[PendingChanges] Invalid data in pending-changes.json, discarding malformed entries",
						result.error,
					);
					// Salvage valid entries if the array itself parsed
					if (Array.isArray(parsed)) {
						this.#entries = parsed.filter(
							(item) => pendingChangeEntrySchema.safeParse(item).success,
						) as PendingChangeEntry[];
					} else {
						this.#entries = [];
					}
				}
			} catch (e) {
				Logger.error("[PendingChanges] Failed to parse pending-changes.json, starting with empty list", e);
				this.#entries = [];
			}
		}
		this.#renameHandler = this.#plugin.app.vault.on("rename", (file, oldPath) => {
			this.#handleFileRename(oldPath, file.path);
		});
		this.#plugin.registerEvent(this.#renameHandler);

		// Trigger re-renders for any reading views already rendered before the store loaded
		if (this.#entries.length > 0) {
			this.notifyChange();
		}
	}

	private get storagePath(): string {
		return normalizePath(`${this.#plugin.manifest.dir}/${STORAGE_FILE}`);
	}

	private scheduleSave(): void {
		if (this.#saveTimer) clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(
			() => void this.saveToDisk().catch((e) => Logger.error("[PendingChanges] Failed to save:", e)),
			SAVE_DEBOUNCE_MS,
		);
	}

	private async saveToDisk(): Promise<void> {
		const path = this.storagePath;
		const dir = path.substring(0, path.lastIndexOf("/"));
		if (!(await this.#plugin.app.vault.adapter.exists(dir))) {
			await this.#plugin.app.vault.adapter.mkdir(dir);
		}
		const snapshot = $state.snapshot(this.#entries);
		await this.#plugin.app.vault.adapter.write(path, JSON.stringify(snapshot, null, 2));
	}

	/** Reactive revision counter – read this inside `$derived` to track store mutations. */
	get revision(): number {
		return this.#revision;
	}

	private notifyChange(): void {
		this.#revision++;
		document.dispatchEvent(new CustomEvent("s2b-pending-changes-updated"));
	}

	/** Check if a vault path is allowed by internal filtering rules. */
	isPathAllowed(filePath: string): boolean {
		return shouldProcessVaultPath(filePath, getData().targetFolder);
	}

	/**
	 * Check if a file is marked as private by the privacy filter.
	 */
	isFilePrivate(filePath: string): boolean {
		return getData().isFilePrivate(filePath);
	}

	/**
	 * Check if a file should be blocked from a provider.
	 * Returns true when the file is private AND the provider is NOT trusted.
	 */
	shouldBlockFile(filePath: string, providerId: string): boolean {
		if (!this.isFilePrivate(filePath)) return false;
		const pluginData = getData();
		return !pluginData.isProviderTrusted(providerId);
	}

	/**
	 * Whether applying this change would take a note out of a private location
	 * and into a non-private one.
	 *
	 * Deliberately independent of provider trust: a move exposes nothing to the
	 * model (it applies as a bare rename), but it does change how every later
	 * operation treats the note — a previously-private note stops being filtered
	 * from indexing, search and prompts. That is worth flagging whichever
	 * provider is selected, so this asks only about the privacy filter.
	 */
	isDeprivatizingMove(change: PendingChange): boolean {
		if (change.type !== "move") return false;
		return this.isFilePrivate(change.path) && !this.isFilePrivate(change.newPath);
	}

	/** Stage one or more pending changes. Returns the entry IDs in input order.
	 *  If a pending update already exists for the same path and thread, the older entry is
	 *  auto-rejected so only the latest proposal is active. */
	addChanges(changes: PendingChange[], toolCallId: string, threadId: string): string[] {
		for (const change of changes) {
			if (change.type !== "update") continue;

			for (const existing of this.#entries) {
				if (
					existing.status === "pending" &&
					existing.threadId === threadId &&
					existing.change.path === change.path &&
					existing.change.type === "update"
				) {
					existing.status = "rejected";
				}
			}
		}

		const createdAt = Date.now();
		const entries: PendingChangeEntry[] = changes.map((change) => ({
			id: genUUIDv7(),
			change,
			status: "pending",
			toolCallId,
			threadId,
			createdAt,
		}));

		this.#entries.push(...entries);
		this.scheduleSave();
		this.notifyChange();
		return entries.map((entry) => entry.id);
	}

	addChange(change: PendingChange, toolCallId: string, threadId: string): string {
		return this.addChanges([change], toolCallId, threadId)[0];
	}

	/** Accept a pending change and apply it to the vault. */
	async acceptChange(entryId: string): Promise<void> {
		const entry = this.#entries.find((e) => e.id === entryId);
		if (entry?.status !== "pending") return;

		const app = this.#plugin.app;
		const change = entry.change;
		const normalizedPath = normalizePath(change.path);

		await this.withFileLock(normalizedPath, async () => {
			if (change.type === "create") {
				// Re-check at apply time (like move below): the stage-time existence
				// check can pass for two tabs both staging the same new path, since
				// neither is applied yet. Surface a clean error rather than a raw
				// vault.create throw when the first one already created it.
				if (app.vault.getAbstractFileByPath(normalizedPath)) {
					throw new Error(`Cannot apply create — a file already exists at: ${change.path}`);
				}
				const dir = normalizedPath.substring(0, normalizedPath.lastIndexOf("/"));
				if (dir && !(await app.vault.adapter.exists(dir))) {
					await app.vault.createFolder(dir);
				}
				await app.vault.create(normalizedPath, change.content);
			} else if (change.type === "update") {
				const file = app.vault.getAbstractFileByPath(normalizedPath);
				if (!(file instanceof TFile)) {
					throw new TypeError(`Cannot apply update — file not found: ${change.path}`);
				}
				// Conflict detection: compare current content with staged original
				const currentContent = await app.vault.read(file);
				if (currentContent !== change.originalContent) {
					throw new Error(
						`File "${change.path}" was modified after the change was proposed. Please review and try again.`,
					);
				}
				await app.vault.modify(file, change.newContent);
			} else if (change.type === "delete") {
				const file = app.vault.getAbstractFileByPath(normalizedPath);
				if (!(file instanceof TFile)) {
					throw new TypeError(`Cannot apply delete — file not found: ${change.path}`);
				}
				await app.vault.trash(file, true);
			} else if (change.type === "move") {
				const file = app.vault.getAbstractFileByPath(normalizedPath);
				if (!(file instanceof TFile)) {
					throw new TypeError(`Cannot apply move — file not found: ${change.path}`);
				}
				const normalizedNewPath = normalizePath(change.newPath);
				if (app.vault.getAbstractFileByPath(normalizedNewPath)) {
					throw new Error(`Cannot apply move — destination already exists: ${change.newPath}`);
				}
				const dir = normalizedNewPath.substring(0, normalizedNewPath.lastIndexOf("/"));
				if (dir && !(await app.vault.adapter.exists(dir))) {
					await app.vault.createFolder(dir);
				}
				await app.fileManager.renameFile(file, normalizedNewPath);
			}
		});

		entry.status = "accepted";
		// The whole proposal is applied with the user's approval, so any partial-write
		// snapshot from earlier group accepts is settled — see `hasUnrevertedApplication`.
		// Leaving it set would let `rejectAll` revert a change they just accepted.
		if (change.type === "update") change.initialOriginalContent = undefined;
		this.scheduleSave();
		this.notifyChange();
	}

	/** Reject a pending change (no vault modification). */
	rejectChange(entryId: string): void {
		const entry = this.#entries.find((e) => e.id === entryId);
		if (entry?.status !== "pending") return;
		entry.status = "rejected";
		this.scheduleSave();
		this.notifyChange();
	}

	/** Acquire a per-file lock to serialize vault writes for the same path.
	 *
	 * A FIFO queue, not a single-slot barrier: each caller chains onto the tail
	 * of the current chain for this path, so N concurrent ops on the same file
	 * run strictly one after another. (A previous version had every waiter await
	 * the same in-flight promise and then proceed together — two tabs editing one
	 * note could interleave read→modify and clobber each other.) The stored
	 * promise is the tail of the chain; the map entry is cleared only when this
	 * op is still the tail, so a later arrival that already chained onto us keeps
	 * the entry alive.
	 *
	 * The key is normalized here rather than at the call sites: `#fileLocks` is a
	 * plain string map, so `"a//b.md"` and `"a/b.md"` would occupy *different*
	 * chains for one file and let two ops interleave read→modify — exactly the
	 * clobbering the queue exists to prevent. Callers pass whatever path they hold;
	 * making the invariant structural means a future call site can't reintroduce
	 * the split by forgetting to normalize. */
	private async withFileLock<T>(rawPath: string, fn: () => Promise<T>): Promise<T> {
		const filePath = normalizePath(rawPath);
		const previous = this.#fileLocks.get(filePath) ?? Promise.resolve();

		// Run only after everything already queued for this path settles. Swallow
		// the predecessor's outcome so one op's failure doesn't reject the chain.
		const run = previous.then(
			() => fn(),
			() => fn(),
		);

		// Publish this op as the new tail. Ignore its result/rejection here — the
		// tail marker only needs to resolve; the real result flows out via `run`.
		const tail = run.then(
			() => {},
			() => {},
		);
		this.#fileLocks.set(filePath, tail);

		try {
			return await run;
		} finally {
			// Only clear if nobody chained after us; otherwise leave their tail in place.
			if (this.#fileLocks.get(filePath) === tail) {
				this.#fileLocks.delete(filePath);
			}
		}
	}

	/** Accept a single diff group within a pending update. */
	async acceptChangeGroup(entryId: string, groupIndex: number): Promise<void> {
		if (this.#processingGroups.has(entryId)) return;
		const entry = this.#entries.find((e) => e.id === entryId);
		if (entry?.status !== "pending") return;

		const change = entry.change;
		if (change.type !== "update") return;

		this.#processingGroups.add(entryId);
		try {
			await this.withFileLock(change.path, async () => {
				// Snapshot the original content before any group mutations
				change.initialOriginalContent ??= change.originalContent;

				const changes = diffLines(change.originalContent, change.newContent);
				const newVaultContent = buildPartialContent(changes, groupIndex, true);

				const file = this.#plugin.app.vault.getAbstractFileByPath(change.path);
				if (!(file instanceof TFile)) return;

				const currentContent = await this.#plugin.app.vault.read(file);
				if (currentContent !== change.originalContent) {
					throw new Error(`File "${change.path}" was modified externally. Please review before accepting.`);
				}
				await this.#plugin.app.vault.modify(file, newVaultContent);

				change.originalContent = newVaultContent;
				if (change.originalContent === change.newContent) {
					entry.status = "accepted";
					// Every group is now applied and the user approved each one, so the
					// note's content is theirs — not an unreviewed partial write. Drop the
					// pre-proposal snapshot: it exists to mark "there is applied content
					// here the user has not signed off on", and keeping it would make
					// `rejectAll` treat this completed acceptance as something to undo,
					// silently reverting a change they explicitly accepted.
					change.initialOriginalContent = undefined;
				}
			});

			this.scheduleSave();
			this.notifyChange();
		} finally {
			this.#processingGroups.delete(entryId);
		}
	}

	/** Reject a single diff group within a pending update. */
	rejectChangeGroup(entryId: string, groupIndex: number): void {
		if (this.#processingGroups.has(entryId)) return;
		const entry = this.#entries.find((e) => e.id === entryId);
		if (entry?.status !== "pending") return;

		const change = entry.change;
		if (change.type !== "update") return;

		const changes = diffLines(change.originalContent, change.newContent);
		const revertedContent = buildPartialContent(changes, groupIndex, false);

		change.newContent = revertedContent;
		if (change.originalContent === change.newContent) {
			entry.status = "rejected";
		}

		this.scheduleSave();
		this.notifyChange();
	}

	/** Accept all pending changes for a thread. Returns paths that failed. */
	async acceptAll(threadId: string): Promise<string[]> {
		// Keyed by thread so concurrent chats accepting their own (disjoint) changes
		// don't spuriously block each other.
		if (this.#batchProcessing.has(threadId)) return ["Batch operation already in progress"];
		this.#batchProcessing.add(threadId);
		try {
			// Snapshot the list before iterating to avoid picking up entries added mid-loop
			const pending = [...this.#entries.filter((e) => e.threadId === threadId && e.status === "pending")];
			const failures: string[] = [];
			for (const entry of pending) {
				try {
					await this.acceptChange(entry.id);
				} catch (e) {
					Logger.error(`[PendingChanges] Failed to accept ${entry.change.path}:`, e);
					failures.push(entry.change.path);
				}
			}
			return failures;
		} finally {
			this.#batchProcessing.delete(threadId);
		}
	}

	/**
	 * Restore a note whose diff groups were partially accepted back to its
	 * pre-proposal content. No-op for anything with nothing applied.
	 *
	 * @returns a {@link RevertSkip} when the revert did NOT happen, else undefined.
	 *   The reason is carried so callers can say which it was — "we left your edits
	 *   alone" and "that note is gone" are very different messages to receive.
	 */
	private async revertAppliedGroups(entry: PendingChangeEntry): Promise<RevertSkip | undefined> {
		if (!this.hasUnrevertedApplication(entry)) return undefined;
		// Narrowed by hasUnrevertedApplication, which TS can't see through.
		const change = entry.change as Extract<PendingChange, { type: "update" }>;
		const initialOriginalContent = change.initialOriginalContent;
		if (initialOriginalContent === undefined) return undefined;

		try {
			return await this.withFileLock(change.path, async () => {
				const file = this.#plugin.app.vault.getAbstractFileByPath(change.path);
				if (!(file instanceof TFile)) {
					// Nothing at this path to restore. Reporting success would tell the
					// user the note was put back when it wasn't — and, because the
					// snapshot below is only cleared on an actual write, the entry would
					// stay actionable forever with no way to resolve it. Renames are now
					// tracked for these entries (see #handleFileRename), so reaching here
					// means the note was deleted, or moved while the plugin was unloaded.
					Logger.warn(
						`[PendingChanges] Cannot restore "${change.path}" — the note no longer exists at that path.`,
					);
					// Clear the snapshot: there is no file left to undo, so keeping it
					// would strand the entry as permanently unresolvable.
					change.initialOriginalContent = undefined;
					return { path: change.path, reason: "missing" as const };
				}

				// Conflict check, matching acceptChange/acceptChangeGroup. Rejecting
				// is not a licence to discard the user's own work: between the group
				// accept and this reject they may have edited the note by hand, and
				// `vault.modify` does not go through trash, so an unconditional
				// overwrite destroys those edits with no way back.
				//
				// `originalContent` is the right baseline, not `initialOriginalContent`:
				// acceptChangeGroup advances `originalContent` to exactly what it wrote
				// (see its `change.originalContent = newVaultContent`), so it tracks what
				// we last put on disk. If the file still matches it, our writes are the
				// only ones there and undoing them is safe.
				const currentContent = await this.#plugin.app.vault.read(file);
				if (currentContent !== change.originalContent) {
					Logger.warn(
						`[PendingChanges] Skipped reverting "${change.path}" — it was modified after the group accept; leaving the file as-is.`,
					);
					// Snapshot deliberately kept: the note is still there, so the user can
					// resolve the conflict and undo later.
					return { path: change.path, reason: "conflict" as const };
				}

				await this.#plugin.app.vault.modify(file, initialOriginalContent);
				// The note is back to its pre-proposal state, so there is nothing left
				// to undo. Clearing this makes the revert idempotent: a later revert
				// (or one after the user edits the note again) must not re-apply this
				// stale snapshot over their newer content.
				change.originalContent = initialOriginalContent;
				change.initialOriginalContent = undefined;
				return undefined;
			});
		} catch (e) {
			Logger.error(`[PendingChanges] Failed to revert ${change.path}:`, e);
			return { path: change.path, reason: "failed" as const };
		}
	}

	/**
	 * Undo the partially-applied content of a single entry (the per-row counterpart
	 * of `rejectAll`'s revert), marking it rejected.
	 *
	 * @returns the path when the revert was skipped, else undefined.
	 */
	async undoAppliedGroups(entryId: string): Promise<RevertSkip | undefined> {
		const entry = this.#entries.find((e) => e.id === entryId);
		if (!entry) return undefined;

		const skipped = await this.revertAppliedGroups(entry);
		entry.status = "rejected";
		this.scheduleSave();
		this.notifyChange();
		return skipped;
	}

	/** Reject all pending changes for a thread, reverting any partially-applied group writes.
	 *
	 *  Returns the paths whose revert was skipped because the file no longer matched what
	 *  we wrote — the entries are still rejected (the proposal is dead either way), but the
	 *  file keeps its current content. Callers should surface these: a silent skip reads as
	 *  "everything was undone" when it wasn't. */
	async rejectAll(threadId: string): Promise<RevertSkip[]> {
		// Two distinct sets, deliberately:
		//
		//  - anything still `pending`, which must be marked rejected; and
		//  - anything with `initialOriginalContent` set, which has partially-applied
		//    content ON DISK that must be undone regardless of its status.
		//
		// The second set is not a subset of the first. Accepting one diff group and
		// then rejecting the remaining ones drives `newContent` back to
		// `originalContent`, so `rejectChangeGroup` already flipped the entry to
		// `rejected` — while the accepted group is still written to the note. Filtering
		// on `pending` alone skipped exactly those entries, leaving the applied text in
		// the vault while the UI reported that everything had been rejected.
		const targets = this.getActionableForThread(threadId);
		const skippedReverts: RevertSkip[] = [];
		for (const entry of targets) {
			const skipped = await this.revertAppliedGroups(entry);
			if (skipped) skippedReverts.push(skipped);
			entry.status = "rejected";
		}
		this.scheduleSave();
		this.notifyChange();
		return skippedReverts;
	}

	/** Get all entries for a thread. */
	getEntriesForThread(threadId: string): PendingChangeEntry[] {
		return this.#entries.filter((e) => e.threadId === threadId);
	}

	/** Get only pending entries for a thread. */
	getPendingForThread(threadId: string): PendingChangeEntry[] {
		return this.#entries.filter((e) => e.threadId === threadId && e.status === "pending");
	}

	/**
	 * Whether this entry has applied content in the note that the user has NOT
	 * signed off on.
	 *
	 * `initialOriginalContent` is the invariant: set on the first
	 * `acceptChangeGroup`, and cleared the moment the outcome is settled — either
	 * every group was accepted (the content is now theirs) or the applied text was
	 * reverted (there is nothing left on disk). So it means "unreviewed partial
	 * write present", not merely "a group was once accepted".
	 *
	 * Status alone cannot answer this. Resolving the last group individually flips
	 * the entry to `accepted`/`rejected` while partial text may still be on disk,
	 * which is why this is keyed on the snapshot rather than on status.
	 *
	 * Single source of truth for the callers that must agree: `rejectAll` (what to
	 * revert), `PendingChangesBar` (whether to stay visible), and `cleanupResolved`
	 * (what is safe to forget).
	 */
	hasUnrevertedApplication(entry: PendingChangeEntry): boolean {
		return entry.change.type === "update" && entry.change.initialOriginalContent !== undefined;
	}

	/**
	 * Entries for a thread that still need the user: pending proposals, plus any
	 * entry holding partially-applied content that has not been reverted.
	 */
	getActionableForThread(threadId: string): PendingChangeEntry[] {
		return this.#entries.filter(
			(e) => e.threadId === threadId && (e.status === "pending" || this.hasUnrevertedApplication(e)),
		);
	}

	/** Get a single entry by ID. */
	getEntry(entryId: string): PendingChangeEntry | undefined {
		return this.#entries.find((e) => e.id === entryId);
	}

	/** Get entry by tool call ID. */
	getEntryByToolCallId(toolCallId: string): PendingChangeEntry | undefined {
		return this.#entries.find((e) => e.toolCallId === toolCallId);
	}

	/** Get count of pending changes for a thread. */
	getPendingCount(threadId: string): number {
		return this.#entries.filter((e) => e.threadId === threadId && e.status === "pending").length;
	}

	/** Get all pending update entries for a specific file path. */
	getPendingUpdatesForPath(filePath: string): PendingChangeEntry[] {
		return this.#entries.filter(
			(e) => e.status === "pending" && e.change.type === "update" && e.change.path === filePath,
		);
	}

	/** Count distinct OTHER threads that also have a pending update to `filePath`.
	 * `exceptThreadId` is the thread being viewed/staged; it's excluded so the
	 * result is "how many *other* chats are editing this same file". Used by the
	 * diff UI (banner) and manage_notes (stage-time warning) to surface the
	 * cross-thread collision the update-dedup deliberately doesn't collapse. */
	countOtherThreadsPendingUpdate(filePath: string, exceptThreadId: string): number {
		const threads = new Set<string>();
		for (const e of this.#entries) {
			if (
				e.status === "pending" &&
				e.change.type === "update" &&
				e.change.path === filePath &&
				e.threadId !== exceptThreadId
			) {
				threads.add(e.threadId);
			}
		}
		return threads.size;
	}

	/** Check if file was modified externally since change was staged. */
	async hasConflict(entryId: string): Promise<boolean> {
		const entry = this.#entries.find((e) => e.id === entryId);
		if (entry?.status !== "pending") return false;

		const change = entry.change;
		if (change.type === "create") return false;
		if (change.type === "move") {
			const source = this.#plugin.app.vault.getAbstractFileByPath(change.path);
			const destination = this.#plugin.app.vault.getAbstractFileByPath(change.newPath);
			return !(source instanceof TFile) || destination instanceof TFile;
		}

		const file = this.#plugin.app.vault.getAbstractFileByPath(change.path);
		if (!(file instanceof TFile)) return true; // File was deleted externally

		const currentContent = await this.#plugin.app.vault.read(file);
		return currentContent !== change.originalContent;
	}

	/** Remove all resolved (accepted/rejected) entries for a thread. */
	cleanupResolved(threadId: string): void {
		const beforeLength = this.#entries.length;
		// Keep anything still holding unreverted content on disk: dropping it would
		// discard the only record of what the note looked like before, leaving the
		// applied text with no way to undo it. Same rule the bar uses to stay visible.
		this.#entries = this.#entries.filter(
			(e) => e.threadId !== threadId || e.status === "pending" || this.hasUnrevertedApplication(e),
		);
		this.scheduleSave();
		if (this.#entries.length !== beforeLength) {
			this.notifyChange();
		}
	}

	/**
	 * Remove all entries for a thread (e.g. when the thread is deleted).
	 *
	 * Unlike {@link cleanupResolved} this drops everything, including entries still
	 * holding unreverted applied content: the chat is gone, so there is no surface
	 * left to review them on and keeping them would leak rows into a thread that no
	 * longer exists. But that content stays in the vault with its only undo record
	 * discarded, so warn rather than doing it silently — the note is left as the
	 * agent partially wrote it, and the user gets no other signal.
	 */
	removeThread(threadId: string): void {
		const beforeLength = this.#entries.length;
		const strandedPaths = this.#entries
			.filter((e) => e.threadId === threadId && this.hasUnrevertedApplication(e))
			.map((e) => e.change.path);
		if (strandedPaths.length > 0) {
			Logger.warn(
				`[PendingChanges] Discarding ${strandedPaths.length} partially-applied change(s) with the deleted thread. ` +
					`These notes keep the content that was already applied: ${strandedPaths.join(", ")}`,
			);
		}
		this.#entries = this.#entries.filter((e) => e.threadId !== threadId);
		this.scheduleSave();
		if (this.#entries.length !== beforeLength) {
			this.notifyChange();
		}
	}

	/** Update entry paths when a vault file is renamed. */
	#handleFileRename(oldPath: string, newPath: string): void {
		let changed = false;
		for (const entry of this.#entries) {
			// Track renames for pending proposals AND for anything still holding
			// unreverted applied content. The latter is not pending — its groups were
			// resolved individually — but its path is still a live pointer to text in
			// the vault that Undo Applied / Reject All must reach. Skipping it left a
			// stale path, so the revert looked up a file that no longer existed and
			// reported success while the applied content sat at the new path.
			if (entry.status !== "pending" && !this.hasUnrevertedApplication(entry)) continue;
			if (entry.change.path === oldPath) {
				entry.change.path = newPath;
				changed = true;
			}
			if (entry.change.type === "move" && entry.change.newPath === oldPath) {
				entry.change.newPath = newPath;
				changed = true;
			}
		}
		// Re-key threadId when a .chat file is renamed (threadId IS the file path)
		if (oldPath.endsWith(".chat")) {
			for (const entry of this.#entries) {
				if (entry.threadId === oldPath) {
					entry.threadId = newPath;
					changed = true;
				}
			}
		}
		if (changed) {
			this.scheduleSave();
			this.notifyChange();
		}
	}

	cleanup(): void {
		if (this.#saveTimer) {
			clearTimeout(this.#saveTimer);
			this.#saveTimer = null;
			// Flush any pending writes so data isn't lost on unload
			void this.saveToDisk().catch((e) => Logger.error("[PendingChanges] Failed to save on cleanup:", e));
		}
		_store = null;
	}
}
