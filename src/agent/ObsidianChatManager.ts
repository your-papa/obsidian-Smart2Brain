import type { RunnableConfig } from "@langchain/core/runnables";
import {
	BaseCheckpointSaver,
	type Checkpoint,
	type CheckpointListOptions,
	type CheckpointMetadata,
	type CheckpointTuple,
	type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { type DataAdapter, Plugin, TFile, debounce, normalizePath } from "obsidian";
import type SecondBrainPlugin from "../main";
import { getData } from "../stores/dataStore.svelte";
import type { ThreadSnapshot, ThreadStore } from "./memory/ThreadStore";

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
		// Look for: "{Title} - {Timestamp}.chat"
		// Timestamp is usually the part after "Chat " in the threadId
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
				}
			}
		} catch (e) {
			console.error(`Error searching for file with threadId ${threadId}:`, e);
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
				console.log(`ObsidianChatManager: Loaded index with ${this.threadIndex.size} threads`);
			} else {
				console.log("ObsidianChatManager: Index missing, rebuilding...");
				await this.rebuildIndex();
			}
		} catch (e) {
			console.error("Error loading chat index:", e);
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
				const data = JSON.parse(content) as ThreadData;
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
				console.error(`Failed to read ${file} during index rebuild:`, e);
			}
		}

		this.indexLoaded = true;
		await this.saveIndex();
	}

	private async saveIndex() {
		const indexPath = this.getIndexPath();
		const snapshots = Array.from(this.threadIndex.values());
		try {
			await this.adapter.write(indexPath, JSON.stringify(snapshots, null, 2));
		} catch (e) {
			console.error("Error saving chat index:", e);
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
				const data = JSON.parse(content) as ThreadData;
				this.storage.set(threadId, data);
				return data;
			}
		} catch (e) {
			console.error(`Error loading thread ${threadId}:`, e);
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
			await this.adapter.write(path, JSON.stringify(data, null, 2));

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
			console.error(`Error saving thread ${threadId}:`, e);
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

		// Find latest by getting keys and sorting (could rely on insertion order if reliable, but timestamps/keys are safer)
		// We use lex sort on keys (checkpoint_ids are usually lex-sortable uuids or similar)
		const keys = Object.keys(threadData.checkpoints).sort().reverse();
		const latestId = keys[0];
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

		const keys = Object.keys(threadData.checkpoints).sort().reverse();

		for (const key of keys) {
			const entry = threadData.checkpoints[key];
			if (options?.before?.configurable?.checkpoint_id && key >= options.before.configurable.checkpoint_id) {
				continue;
			}

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

		// Remove from disk
		const path = await this.resolveFilePath(threadId);
		try {
			if (await this.adapter.exists(path)) {
				await this.adapter.remove(path);
			}
		} catch (e) {
			console.error(`Error deleting thread ${threadId}:`, e);
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

	async renameChatFile(threadId: string, title: string): Promise<void> {
		if (!title || !title.trim()) return;

		try {
			const oldPath = await this.resolveFilePath(threadId);
			const file = this.plugin.app.vault.getAbstractFileByPath(oldPath);

			if (!file || !(file instanceof TFile)) {
				console.warn(`renameChatFile: File not found: ${oldPath}`);
				return;
			}

			const sanitizedTitle = this.sanitizeFileName(title);
			const dateTimePart = threadId.startsWith("Chat ") ? threadId.substring(5) : threadId;
			const newFileName = `${sanitizedTitle} - ${dateTimePart}.chat`;

			if (file.name === newFileName) return;

			const folder = this.getChatFolder();
			const newPath = normalizePath(`${folder}/${newFileName}`);

			if (await this.adapter.exists(newPath)) {
				console.warn(`renameChatFile: Target file already exists: ${newPath}`);
				return;
			}

			await this.plugin.app.fileManager.renameFile(file, newPath);

			// Update cache with new path
			this.filePathCache.set(threadId, newPath);
			console.log(`renameChatFile: Successfully renamed to ${newPath}`);
		} catch (error) {
			console.error(`Error renaming chat file for thread ${threadId}:`, error);
		}
	}
}
