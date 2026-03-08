import { normalizePath, TFile } from "obsidian";
import { type Change, diffLines } from "diff";
import type SecondBrainPlugin from "../main";
import type { PendingChange, PendingChangeEntry } from "../types/shared";
import { genUUIDv7 } from "../utils/uuid7Validator";
import { Logger } from "../utils/logging";
import { getData } from "./dataStore.svelte";

const SAVE_DEBOUNCE_MS = 1000;
const STORAGE_FILE = "data/pending-changes.json";

let _store: PendingChangesStore | null = null;

/**
 * Determine whether to include a removed or added part in the output.
 */
function shouldIncludePart(
    part: Change,
    isTarget: boolean,
    targetUsesNew: boolean,
): boolean {
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
function buildPartialContent(
    changes: Change[],
    groupIndex: number,
    targetUsesNew: boolean,
): string {
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
    readonly #plugin: SecondBrainPlugin;
    #saveTimer: ReturnType<typeof setTimeout> | null = null;
    readonly #processingGroups = new Set<string>();

    constructor(plugin: SecondBrainPlugin) {
        this.#plugin = plugin;
    }

    async load(): Promise<void> {
        const path = this.storagePath;
        if (await this.#plugin.app.vault.adapter.exists(path)) {
            try {
                const raw = await this.#plugin.app.vault.adapter.read(path);
                const parsed = JSON.parse(raw);
                this.#entries = Array.isArray(parsed) ? parsed as PendingChangeEntry[] : [];
            } catch (e) {
                Logger.error("[PendingChanges] Failed to parse pending-changes.json, starting with empty list", e);
                this.#entries = [];
            }
        }
    }

    private get storagePath(): string {
        return normalizePath(`${this.#plugin.manifest.dir}/${STORAGE_FILE}`);
    }

    private scheduleSave(): void {
        if (this.#saveTimer) clearTimeout(this.#saveTimer);
        this.#saveTimer = setTimeout(() => this.saveToDisk(), SAVE_DEBOUNCE_MS);
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

    /** Check if a vault path is allowed by include/exclude filter settings. */
    isPathAllowed(filePath: string): boolean {
        const pluginData = getData();
        const indexList = pluginData.indexList;
        const isExcluding = pluginData.isExcluding;

        const matchesPattern = indexList.some(
            (pattern: string) => filePath.startsWith(pattern) || filePath.includes(`/${pattern}`),
        );

        return isExcluding ? !matchesPattern : indexList.length === 0 || matchesPattern;
    }

    /** Stage a new pending change. Returns the entry ID.
     *  If a pending update already exists for the same path and thread, the older entry is
     *  auto-rejected so only the latest proposal is active. */
    addChange(change: PendingChange, toolCallId: string, threadId: string): string {
        // Supersede any existing pending entry for the same path+thread
        if (change.type === "update") {
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

        const id = genUUIDv7();
        const entry: PendingChangeEntry = {
            id,
            change,
            status: "pending",
            toolCallId,
            threadId,
            createdAt: Date.now(),
        };
        this.#entries.push(entry);
        this.scheduleSave();
        document.dispatchEvent(new CustomEvent("ssb-pending-changes-updated"));
        return id;
    }

    /** Accept a pending change and apply it to the vault. */
    async acceptChange(entryId: string): Promise<void> {
        const entry = this.#entries.find((e) => e.id === entryId);
        if (entry?.status !== "pending") return;

        const app = this.#plugin.app;
        const change = entry.change;

        if (change.type === "create") {
            const dir = change.path.substring(0, change.path.lastIndexOf("/"));
            if (dir && !(await app.vault.adapter.exists(dir))) {
                await app.vault.createFolder(dir);
            }
            await app.vault.create(normalizePath(change.path), change.content);
        } else if (change.type === "update") {
            const file = app.vault.getAbstractFileByPath(change.path);
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
            const file = app.vault.getAbstractFileByPath(change.path);
            if (!(file instanceof TFile)) {
                throw new TypeError(`Cannot apply delete — file not found: ${change.path}`);
            }
            await app.vault.trash(file, true);
        }

        entry.status = "accepted";
        this.scheduleSave();
        document.dispatchEvent(new CustomEvent("ssb-pending-changes-updated"));
    }

    /** Reject a pending change (no vault modification). */
    rejectChange(entryId: string): void {
        const entry = this.#entries.find((e) => e.id === entryId);
        if (entry?.status !== "pending") return;
        entry.status = "rejected";
        this.scheduleSave();
        document.dispatchEvent(new CustomEvent("ssb-pending-changes-updated"));
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
            // Snapshot the original content before any group mutations
            change.initialOriginalContent ??= change.originalContent;

            const changes = diffLines(change.originalContent, change.newContent);
            const newVaultContent = buildPartialContent(changes, groupIndex, true);

            const file = this.#plugin.app.vault.getAbstractFileByPath(change.path);
            if (!(file instanceof TFile)) return;

            const currentContent = await this.#plugin.app.vault.read(file);
            if (currentContent !== change.originalContent) {
                throw new Error(
                    `File "${change.path}" was modified externally. Please review before accepting.`,
                );
            }
            await this.#plugin.app.vault.modify(file, newVaultContent);

            change.originalContent = newVaultContent;
            if (change.originalContent === change.newContent) {
                entry.status = "accepted";
            }

            this.scheduleSave();
            // Dispatch immediately so in-memory consumers (PendingChangesBar) update,
            // then again after delays so the editor decorations rebuild against the new document.
            const notify = () => document.dispatchEvent(new CustomEvent("ssb-pending-changes-updated"));
            notify();
            setTimeout(notify, 100);
            setTimeout(notify, 500);
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
        document.dispatchEvent(new CustomEvent("ssb-pending-changes-updated"));
    }

    /** Accept all pending changes for a thread. Returns paths that failed. */
    async acceptAll(threadId: string): Promise<string[]> {
        const pending = this.#entries.filter((e) => e.threadId === threadId && e.status === "pending");
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
    }

    /** Reject all pending changes for a thread, reverting any partially-applied group writes. */
    async rejectAll(threadId: string): Promise<void> {
        const pending = this.#entries.filter((e) => e.threadId === threadId && e.status === "pending");
        for (const entry of pending) {
            // Revert vault file if groups were partially accepted
            if (entry.change.type === "update" && entry.change.initialOriginalContent !== undefined) {
                try {
                    const file = this.#plugin.app.vault.getAbstractFileByPath(entry.change.path);
                    if (file instanceof TFile) {
                        await this.#plugin.app.vault.modify(file, entry.change.initialOriginalContent);
                    }
                } catch (e) {
                    Logger.error(`[PendingChanges] Failed to revert ${entry.change.path}:`, e);
                }
            }
            entry.status = "rejected";
        }
        this.scheduleSave();
        document.dispatchEvent(new CustomEvent("ssb-pending-changes-updated"));
    }

    /** Get all entries for a thread. */
    getEntriesForThread(threadId: string): PendingChangeEntry[] {
        return this.#entries.filter((e) => e.threadId === threadId);
    }

    /** Get only pending entries for a thread. */
    getPendingForThread(threadId: string): PendingChangeEntry[] {
        return this.#entries.filter((e) => e.threadId === threadId && e.status === "pending");
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

    /** Check if file was modified externally since change was staged. */
    async hasConflict(entryId: string): Promise<boolean> {
        const entry = this.#entries.find((e) => e.id === entryId);
        if (entry?.status !== "pending") return false;

        const change = entry.change;
        if (change.type === "create") return false;

        const file = this.#plugin.app.vault.getAbstractFileByPath(change.path);
        if (!(file instanceof TFile)) return true; // File was deleted externally

        const currentContent = await this.#plugin.app.vault.read(file);
        return currentContent !== change.originalContent;
    }

    /** Remove all resolved (accepted/rejected) entries for a thread. */
    cleanupResolved(threadId: string): void {
        this.#entries = this.#entries.filter(
            (e) => e.threadId !== threadId || e.status === "pending",
        );
        this.scheduleSave();
    }

    /** Remove all entries for a thread (e.g., when thread is deleted). */
    removeThread(threadId: string): void {
        this.#entries = this.#entries.filter((e) => e.threadId !== threadId);
        this.scheduleSave();
    }

    cleanup(): void {
        if (this.#saveTimer) {
            clearTimeout(this.#saveTimer);
            this.#saveTimer = null;
            // Flush any pending writes so data isn't lost on unload
            void this.saveToDisk();
        }
        _store = null;
    }
}
