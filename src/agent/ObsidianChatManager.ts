import type { RunnableConfig } from "@langchain/core/runnables";
import {
	BaseCheckpointSaver,
	type Checkpoint,
	type CheckpointListOptions,
	type CheckpointMetadata,
	type CheckpointTuple,
	type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { type DataAdapter, TFile, debounce, normalizePath } from "obsidian";
import type SecondBrainPlugin from "../main";
import { getData } from "../stores/dataStore.svelte";
import type { ThreadSnapshot, ThreadStore } from "./memory/ThreadStore";
import { Logger } from "../utils/logging";

interface CheckpointEntry {
	checkpoint: Checkpoint;
	metadata: CheckpointMetadata;
	parentConfig?: RunnableConfig;
}

interface ThreadData {
	// Metadata (ThreadSnapshot)
	threadId: string;
	title?: string;
	metadata?: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;

	// Checkpoint data
	checkpoints: Record<string, CheckpointEntry>;
	writes: Record<string, PendingWrite[]>; // checkpoint_id -> writes
}

export class ObsidianChatManager extends BaseCheckpointSaver {
	private plugin: SecondBrainPlugin;
	private adapter: DataAdapter;

	// In-memory cache: thread_id -> ThreadData (Loaded on demand)
	private storage: Map<string, ThreadData> = new Map();

	// Index cache: thread_id -> ThreadSnapshot (Loaded on startup)
	private threadIndex: Map<string, ThreadSnapshot> = new Map();

	// Path cache: thread_id -> file_path (Optimizes file lookups)
	private filePathCache: Map<string, string> = new Map();

	private indexLoaded = false;

	constructor(plugin: SecondBrainPlugin) {
		super();
		this.plugin = plugin;
		this.adapter = plugin.app.vault.adapter;
	}

	// --- File System Helpers ---

	private parseNdjsonObject<T>(content: string, context: string): T {
		const records = content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		if (records.length !== 1) {
			throw new Error(`Invalid NDJSON format for ${context}: expected 1 record, found ${records.length}`);
		}

		return JSON.parse(records[0]) as T;
	}

	private getCheckpointTimestamp(entry: CheckpointEntry): number {
		const ts = entry.checkpoint?.ts;
		if (typeof ts !== "string") return 0;
		const parsed = Date.parse(ts);
		return Number.isNaN(parsed) ? 0 : parsed;
	}

	private getCheckpointStep(entry: CheckpointEntry): number {
		const step = entry.metadata?.step;
		return typeof step === "number" ? step : Number.NEGATIVE_INFINITY;
	}

	private getSortedCheckpointIds(threadData: ThreadData): string[] {
		return Object.entries(threadData.checkpoints)
			.sort((a, b) => {
				const tsDiff = this.getCheckpointTimestamp(b[1]) - this.getCheckpointTimestamp(a[1]);
				if (tsDiff !== 0) return tsDiff;

				const stepDiff = this.getCheckpointStep(b[1]) - this.getCheckpointStep(a[1]);
				if (stepDiff !== 0) return stepDiff;

				return b[0].localeCompare(a[0]);
			})
			.map(([id]) => id);
	}

	private getChatFolder(): string {
		const data = getData();
		return data.targetFolder;
	}

	private getIndexPath(): string {
		// configDir is an internal Obsidian API property
		const vault = this.plugin.app.vault as { configDir?: string };
		const configDir = vault.configDir || ".obsidian";
		return `${configDir}/plugins/${this.plugin.manifest.id}/data/threads.json`;
	}

	private async ensureFolder(): Promise<void> {
		const folder = this.getChatFolder();
		if (!(await this.adapter.exists(folder))) {
			await this.adapter.mkdir(folder);
		}

		// Ensure plugin data dir for index
		const vault = this.plugin.app.vault as { configDir?: string };
		const dataDir = `${vault.configDir || ".obsidian"}/plugins/${this.plugin.manifest.id}/data`;
		if (!(await this.adapter.exists(dataDir))) {
			await this.adapter.mkdir(dataDir);
		}
	}

	private async resolveFilePath(threadId: string): Promise<string> {
		// Check cache first
		if (this.filePathCache.has(threadId)) {
			return this.filePathCache.get(threadId)!;
		}

		const folder = this.getChatFolder();

		// First try the default path
		const defaultPath = `${folder}/${threadId}.chat`;
		if (await this.adapter.exists(defaultPath)) {
			this.filePathCache.set(threadId, defaultPath);
			return defaultPath;
		}

		// If not found, search for it (renamed files)
		// Legacy format: "{Title} - {Timestamp}.chat"
		let timestampPart = "";
		if (threadId.startsWith("Chat ")) {
			timestampPart = threadId.substring(5);
		}

		try {
			if (await this.adapter.exists(folder)) {
				const result = await this.adapter.list(folder);
				for (const file of result.files) {
					if (!file.endsWith(".chat")) continue;

					// Check if file contains threadId (legacy check)
					if (file.includes(threadId)) {
						this.filePathCache.set(threadId, file);
						return file;
					}

					// Check for renamed files with matching timestamp
					if (timestampPart && file.endsWith(` - ${timestampPart}.chat`)) {
						this.filePathCache.set(threadId, file);
						return file;
					}

					try {
						const content = await this.adapter.read(file);
						const parsed = this.parseNdjsonObject<ThreadData>(content, file);
						if (parsed.threadId === threadId) {
							this.filePathCache.set(threadId, file);
							return file;
						}
					} catch {
						// Ignore malformed files while searching.
					}
				}
			}
		} catch (e) {
			Logger.error(`Error searching for file with threadId ${threadId}:`, e);
		}

		// Fallback to default path (will be created there if writing)
		this.filePathCache.set(threadId, defaultPath);
		return defaultPath;
	}

	// --- Index Management ---

	async load(): Promise<void> {
		if (this.indexLoaded) return;

		await this.ensureFolder();
		const indexPath = this.getIndexPath();

		try {
			if (await this.adapter.exists(indexPath)) {
				const content = await this.adapter.read(indexPath);
				const snapshots = JSON.parse(content) as ThreadSnapshot[];
				this.threadIndex.clear();
				snapshots.forEach((s) => this.threadIndex.set(s.threadId, s));
				this.indexLoaded = true;
				Logger.log(`ObsidianChatManager: Loaded index with ${this.threadIndex.size} threads`);
			} else {
				Logger.log("ObsidianChatManager: Index missing, rebuilding...");
				await this.rebuildIndex();
			}
		} catch (e) {
			Logger.error("Error loading chat index:", e);
		}
	}

	async rebuildIndex(): Promise<void> {
		const folder = this.getChatFolder();
		if (!(await this.adapter.exists(folder))) return;

		const result = await this.adapter.list(folder);
		this.threadIndex.clear();
		this.filePathCache.clear();

		for (const file of result.files) {
			if (!file.endsWith(".chat")) continue;

			// Yield to event loop
			await new Promise((resolve) => setTimeout(resolve, 0));

			try {
				const content = await this.adapter.read(file);
				const data = this.parseNdjsonObject<ThreadData>(content, file);
				if (data?.threadId) {
					// Cache path
					this.filePathCache.set(data.threadId, file);

					// Update index
					this.threadIndex.set(data.threadId, {
						threadId: data.threadId,
						title: data.title,
						metadata: data.metadata,
						createdAt: data.createdAt,
						updatedAt: data.updatedAt,
					});
				}
			} catch (e) {
				Logger.error(`Failed to read ${file} during index rebuild:`, e);
			}
		}

		this.indexLoaded = true;
		await this.saveIndex();
	}

	private async saveIndex() {
		const indexPath = this.getIndexPath();
		const snapshots = Array.from(this.threadIndex.values());
		try {
			await this.adapter.write(indexPath, JSON.stringify(snapshots));
		} catch (e) {
			Logger.error("Error saving chat index:", e);
		}
	}

	private saveIndexDebounced = debounce(
		() => {
			this.saveIndex();
		},
		2000,
		true,
	);

	// --- Thread Loading / Saving ---

	async ensureThreadLoaded(threadId: string): Promise<ThreadData | undefined> {
		if (this.storage.has(threadId)) return this.storage.get(threadId);

		const path = await this.resolveFilePath(threadId);

		try {
			if (await this.adapter.exists(path)) {
				const content = await this.adapter.read(path);
				const data = this.parseNdjsonObject<ThreadData>(content, path);
				this.storage.set(threadId, data);
				return data;
			}
		} catch (e) {
			Logger.error(`Error loading thread ${threadId}:`, e);
		}
		return undefined;
	}

	private createThreadData(threadId: string): ThreadData {
		return {
			threadId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			checkpoints: {},
			writes: {},
		};
	}

	/**
	 * Creates a new thread and persists it to disk.
	 * Returns
	 **/

	private async saveThread(threadId: string) {
		const data = this.storage.get(threadId);
		if (!data) return;

		await this.ensureFolder();
		const path = await this.resolveFilePath(threadId);

		try {
			await this.adapter.write(path, `${JSON.stringify(data)}\n`);

			// Update index
			this.threadIndex.set(threadId, {
				threadId: data.threadId,
				title: data.title,
				metadata: data.metadata,
				createdAt: data.createdAt,
				updatedAt: data.updatedAt,
			});
			this.saveIndexDebounced();
		} catch (e) {
			Logger.error(`Error saving thread ${threadId}:`, e);
		}
	}

	private saveDebounced = debounce(
		(threadId: string) => {
			this.saveThread(threadId);
		},
		1000,
		true,
	);

	// --- ThreadStore Implementation ---

	async read(threadId: string, forceReload = false): Promise<ThreadSnapshot | undefined> {
		if (!forceReload && this.threadIndex.has(threadId)) {
			return this.threadIndex.get(threadId);
		}

		const data = await this.ensureThreadLoaded(threadId);
		if (!data) return undefined;

		const snapshot: ThreadSnapshot = {
			threadId: data.threadId,
			title: data.title,
			metadata: data.metadata,
			createdAt: data.createdAt,
			updatedAt: data.updatedAt,
		};

		if (!this.threadIndex.has(threadId) || forceReload) {
			this.threadIndex.set(threadId, snapshot);
		}

		return snapshot;
	}

	async write(snapshot: ThreadSnapshot): Promise<void> {
		let data = await this.ensureThreadLoaded(snapshot.threadId);

		if (!data) {
			data = this.createThreadData(snapshot.threadId);
			data.createdAt = snapshot.createdAt;
			this.storage.set(snapshot.threadId, data);
		}

		data.title = snapshot.title;
		data.metadata = snapshot.metadata;
		data.updatedAt = snapshot.updatedAt;

		this.saveDebounced(snapshot.threadId);
	}

	async delete(threadId: string): Promise<void> {
		await this.deleteThread(threadId);
	}

	async listThreads(): Promise<ThreadSnapshot[]> {
		await this.load();
		return Array.from(this.threadIndex.values()).sort((a, b) => b.updatedAt - a.updatedAt);
	}

	asThreadStore(): ThreadStore {
		return {
			read: this.read.bind(this),
			write: this.write.bind(this),
			delete: this.delete.bind(this),
			list: this.listThreads.bind(this),
			clear: this.clear.bind(this),
		};
	}

	async clear(): Promise<void> {
		await this.load();
		const ids = Array.from(this.threadIndex.keys()); // Use index keys as source of truth
		for (const id of ids) {
			await this.deleteThread(id);
		}
	}

	// --- CheckpointSaver Implementation ---

	async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
		const threadId = config.configurable?.thread_id;
		if (!threadId) return undefined;

		const threadData = await this.ensureThreadLoaded(threadId);
		if (!threadData) return undefined;

		const checkpointId = config.configurable?.checkpoint_id;

		if (checkpointId) {
			const entry = threadData.checkpoints[checkpointId];
			if (!entry) return undefined;

			// For specific checkpoint, also include any error writes from child checkpoints
			const pendingWrites = this.collectWritesWithErrors(threadData, checkpointId);

			return {
				config,
				checkpoint: entry.checkpoint,
				metadata: entry.metadata,
				parentConfig: entry.parentConfig,
				// Type assertion needed due to LangGraph checkpoint type variance
				pendingWrites: pendingWrites as unknown as CheckpointTuple["pendingWrites"],
			};
		}

		const checkpoints = Object.values(threadData.checkpoints);
		if (checkpoints.length === 0) return undefined;

		const sortedCheckpointIds = this.getSortedCheckpointIds(threadData);
		const latestId = sortedCheckpointIds[0];
		if (!latestId) return undefined;
		const entry = threadData.checkpoints[latestId];

		// Collect writes from the latest checkpoint AND any error writes from subsequent checkpoints
		const pendingWrites = this.collectWritesWithErrors(threadData, latestId);

		return {
			config: {
				...config,
				configurable: { ...config.configurable, checkpoint_id: latestId },
			},
			checkpoint: entry.checkpoint,
			metadata: entry.metadata,
			parentConfig: entry.parentConfig,
			// Type assertion needed due to LangGraph checkpoint type variance
			pendingWrites: pendingWrites as unknown as CheckpointTuple["pendingWrites"],
		};
	}

	/**
	 * Collects pending writes for a checkpoint, including error writes from child checkpoints.
	 * This is needed because errors are written to a child checkpoint that may not exist in the checkpoints map.
	 */
	private collectWritesWithErrors(threadData: ThreadData, checkpointId: string): PendingWrite[] {
		const writes: PendingWrite[] = [];

		// Add writes from the specific checkpoint
		if (threadData.writes[checkpointId]) {
			writes.push(...threadData.writes[checkpointId]);
		}

		// Collect ALL error writes from the entire thread
		// This is needed because each errored user message has its own error in a subsequent checkpoint
		const allWriteKeys = Object.keys(threadData.writes).sort();
		for (const writeKey of allWriteKeys) {
			// Skip the checkpoint we already added
			if (writeKey === checkpointId) continue;

			const checkpointWrites = threadData.writes[writeKey];
			for (const write of checkpointWrites) {
				if (Array.isArray(write) && (write[0] === "__error__" || write[1] === "__error__")) {
					writes.push(write);
				}
			}
		}

		return writes;
	}

	async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
		const threadId = config.configurable?.thread_id;
		if (!threadId) return;

		const threadData = await this.ensureThreadLoaded(threadId);
		if (!threadData) return;

		const sortedCheckpointIds = this.getSortedCheckpointIds(threadData);
		if (sortedCheckpointIds.length === 0) return;

		const beforeId = options?.before?.configurable?.checkpoint_id;
		let keysToIterate = sortedCheckpointIds;
		if (typeof beforeId === "string") {
			const beforeIndex = sortedCheckpointIds.indexOf(beforeId);
			if (beforeIndex < 0) {
				return;
			}
			keysToIterate = sortedCheckpointIds.slice(beforeIndex + 1);
		}

		for (const key of keysToIterate) {
			const entry = threadData.checkpoints[key];

			yield {
				config: {
					...config,
					configurable: { ...config.configurable, checkpoint_id: key },
				},
				checkpoint: entry.checkpoint,
				metadata: entry.metadata,
				parentConfig: entry.parentConfig,
				// Type assertion needed due to LangGraph checkpoint type variance
				pendingWrites: (threadData.writes[key] || []) as unknown as CheckpointTuple["pendingWrites"],
			};

			if (options?.limit && --options.limit <= 0) break;
		}
	}

	async put(
		config: RunnableConfig,
		checkpoint: Checkpoint,
		metadata: CheckpointMetadata,
		newVersions: Record<string, number | string>,
	): Promise<RunnableConfig> {
		const threadId = config.configurable?.thread_id;
		const checkpointId = checkpoint.id;
		if (!threadId || !checkpointId) return config;

		let threadData = await this.ensureThreadLoaded(threadId);
		if (!threadData) {
			threadData = this.createThreadData(threadId);
			this.storage.set(threadId, threadData);
		}

		// Sanitize to plain JSON
		const plainCheckpoint = JSON.parse(JSON.stringify(checkpoint));
		const plainMetadata = JSON.parse(JSON.stringify(metadata));

		threadData.checkpoints[checkpointId] = {
			checkpoint: plainCheckpoint,
			metadata: plainMetadata,
			parentConfig: config,
		};

		threadData.updatedAt = Date.now();
		this.saveDebounced(threadId);

		// Update index cache immediately
		if (this.threadIndex.has(threadId)) {
			const snap = this.threadIndex.get(threadId)!;
			snap.updatedAt = threadData.updatedAt;
		} else {
			this.threadIndex.set(threadId, {
				threadId: threadData.threadId,
				title: threadData.title,
				metadata: threadData.metadata,
				createdAt: threadData.createdAt,
				updatedAt: threadData.updatedAt,
			});
		}
		// Persist index changes debounced
		this.saveIndexDebounced();

		return {
			...config,
			configurable: {
				...config.configurable,
				checkpoint_id: checkpointId,
			},
		};
	}

	async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
		const threadId = config.configurable?.thread_id;
		const checkpointId = config.configurable?.checkpoint_id;

		if (!threadId || !checkpointId) return;

		let threadData = await this.ensureThreadLoaded(threadId);
		if (!threadData) {
			threadData = this.createThreadData(threadId);
			this.storage.set(threadId, threadData);
		}

		if (!threadData.writes[checkpointId]) {
			threadData.writes[checkpointId] = [];
		}

		threadData.writes[checkpointId].push(...writes);
		threadData.updatedAt = Date.now();
		this.saveDebounced(threadId);

		if (this.threadIndex.has(threadId)) {
			this.threadIndex.get(threadId)!.updatedAt = threadData.updatedAt;
			this.saveIndexDebounced();
		}
	}

	async deleteThread(threadId: string): Promise<void> {
		// Remove from memory
		this.storage.delete(threadId);
		this.threadIndex.delete(threadId);
		this.filePathCache.delete(threadId);
		this.saveIndexDebounced();

		// Remove chat file from disk
		const path = await this.resolveFilePath(threadId);
		try {
			if (await this.adapter.exists(path)) {
				await this.adapter.remove(path);
			}
		} catch (e) {
			Logger.error(`Error deleting thread ${threadId}:`, e);
		}

		// Remove attachment directory if it exists
		const attachDir = normalizePath(`${this.getChatFolder()}/attachments/${threadId}`);
		try {
			if (await this.adapter.exists(attachDir)) {
				const listing = await this.adapter.list(attachDir);
				// Delete all files in the attachment directory
				for (const file of listing.files) {
					await this.adapter.remove(file);
				}
				// Remove the directory itself
				await this.adapter.rmdir(attachDir, true);
			}
		} catch (e) {
			Logger.error(`Error deleting attachments for thread ${threadId}:`, e);
		}
	}

	// --- Utilities ---

	private sanitizeFileName(title: string): string {
		return title
			.replace(/[<>:"/\\|?*]/g, "-")
			.replace(/\s+/g, " ")
			.trim()
			.substring(0, 100);
	}

	private async getUniqueTitlePath(folder: string, baseTitle: string, currentPath: string): Promise<{
		title: string;
		path: string;
		fileName: string;
	}> {
		let index = 1;
		while (true) {
			const title = index === 1 ? baseTitle : `${baseTitle} (${index})`;
			const fileName = `${title}.chat`;
			const path = normalizePath(`${folder}/${fileName}`);

			if (path === currentPath) {
				return { title, path, fileName };
			}

			if (!(await this.adapter.exists(path))) {
				return { title, path, fileName };
			}

			index += 1;
		}
	}

	async renameChatFile(threadId: string, title: string): Promise<void> {
		if (!title || !title.trim()) return;

		try {
			const oldPath = await this.resolveFilePath(threadId);
			const file = this.plugin.app.vault.getAbstractFileByPath(oldPath);

			if (!file || !(file instanceof TFile)) {
				Logger.warn(`renameChatFile: File not found: ${oldPath}`);
				return;
			}

			const sanitizedTitle = this.sanitizeFileName(title) || "Chat";
			const folder = this.getChatFolder();
			const currentPath = normalizePath(oldPath);
			const uniqueTarget = await this.getUniqueTitlePath(folder, sanitizedTitle, currentPath);
			const newFileName = uniqueTarget.fileName;
			const newPath = uniqueTarget.path;

			if (file.name !== newFileName) {
				await this.plugin.app.fileManager.renameFile(file, newPath);
			}

			const now = Date.now();
			const loaded = await this.ensureThreadLoaded(threadId);
			if (loaded) {
				loaded.title = uniqueTarget.title;
				loaded.updatedAt = now;
				this.saveDebounced(threadId);
			}

			const indexed = this.threadIndex.get(threadId);
			if (indexed) {
				indexed.title = uniqueTarget.title;
				indexed.updatedAt = now;
			} else if (loaded) {
				this.threadIndex.set(threadId, {
					threadId: loaded.threadId,
					title: loaded.title,
					metadata: loaded.metadata,
					createdAt: loaded.createdAt,
					updatedAt: loaded.updatedAt,
				});
			}
			this.saveIndexDebounced();

			// Update cache with new path
			this.filePathCache.set(threadId, newPath);
			Logger.log(`renameChatFile: Successfully renamed to ${newPath}`);
		} catch (error) {
			Logger.error(`Error renaming chat file for thread ${threadId}:`, error);
		}
	}

	async reassignThreadId(currentThreadId: string, nextThreadId: string): Promise<boolean> {
		if (!currentThreadId || !nextThreadId || currentThreadId === nextThreadId) {
			return false;
		}

		const currentPath = await this.resolveFilePath(currentThreadId);
		const loaded = await this.ensureThreadLoaded(currentThreadId);
		if (!loaded) {
			return false;
		}

		const now = Date.now();
		loaded.threadId = nextThreadId;
		loaded.updatedAt = now;

		this.storage.delete(currentThreadId);
		this.storage.set(nextThreadId, loaded);

		this.filePathCache.delete(currentThreadId);
		this.filePathCache.set(nextThreadId, currentPath);

		const currentIndex = this.threadIndex.get(currentThreadId);
		this.threadIndex.delete(currentThreadId);
		this.threadIndex.set(nextThreadId, {
			threadId: nextThreadId,
			title: currentIndex?.title ?? loaded.title,
			metadata: currentIndex?.metadata ?? loaded.metadata,
			createdAt: currentIndex?.createdAt ?? loaded.createdAt,
			updatedAt: now,
		});

		await this.saveThread(nextThreadId);
		return true;
	}
}
