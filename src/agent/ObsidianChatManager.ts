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
import { gunzipSync, gzipSync } from "node:zlib";
import type SecondBrainPlugin from "../main";
import { getData } from "../stores/dataStore.svelte";
import type { ThreadSnapshot, ThreadStore } from "./memory/ThreadStore";
import { Logger } from "../utils/logging";
import { toBase64, toBase64DataUri } from "../utils/attachments";
import type { ChatAttachment } from "../types/shared";

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

interface GenerationMetadata {
	agentId?: string;
	agentName?: string;
	provider?: string;
	model?: string;
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
	private dirtyThreadVersions: Map<string, number> = new Map();
	private persistedThreadVersions: Map<string, number> = new Map();
	private dirtyIndexVersion = 0;
	private persistedIndexVersion = 0;
	private inFlightThreadSaves: Map<string, Promise<void>> = new Map();
	private inFlightIndexSave: Promise<void> | null = null;

	constructor(plugin: SecondBrainPlugin) {
		super();
		this.plugin = plugin;
		this.adapter = plugin.app.vault.adapter;

		// When a .chat file is deleted via the Obsidian file explorer (outside the plugin UI),
		// clean up in-memory caches so stale threads don't appear in the UI.
		plugin.registerEvent(
			plugin.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "chat") {
					this.onChatFileDeleted(file.path);
				}
			}),
		);
	}

	/**
	 * Handle external deletion of a .chat file (e.g., via Obsidian file explorer).
	 * Cleans up in-memory caches so stale threads don't appear in the UI.
	 * Attachment files are intentionally left in place (matching Obsidian's behavior
	 * of not deleting embedded images when a note is deleted).
	 */
	private onChatFileDeleted(filePath: string): void {
		// Reverse-lookup threadId from filePathCache
		let threadId: string | undefined;
		for (const [id, path] of this.filePathCache) {
			if (path === filePath) {
				threadId = id;
				break;
			}
		}

		if (!threadId) return;

		this.storage.delete(threadId);
		this.threadIndex.delete(threadId);
		this.filePathCache.delete(threadId);
		this.markIndexDirty();
		this.saveIndexDebounced();
	}

	// --- File System Helpers ---

	private async readThreadFile(path: string): Promise<ThreadData> {
		const raw = await this.adapter.readBinary(path);
		const decompressed = gunzipSync(new Uint8Array(raw));
		return JSON.parse(decompressed.toString("utf8")) as ThreadData;
	}

	private stripBase64FromChannelValues(channelValues: Record<string, unknown> | undefined): void {
		if (!channelValues) return;
		for (const value of Object.values(channelValues)) {
			this.stripBase64FromWriteValue(value);
		}
	}

	private stripBase64FromWriteValue(value: unknown): void {
		if (Array.isArray(value)) {
			this.stripBase64FromMessages(value);
		} else if (value && typeof value === "object") {
			const msgs = (value as Record<string, unknown>).messages;
			if (Array.isArray(msgs)) this.stripBase64FromMessages(msgs);
		}
	}

	private stripBase64FromMessages(messages: unknown[]): void {
		for (const msg of messages) {
			const kwargs = (msg as Record<string, unknown>).kwargs as Record<string, unknown> | undefined;
			if (!kwargs) continue;
			const content = kwargs.content;
			if (!Array.isArray(content)) continue;
			const attachments = (kwargs.additional_kwargs as Record<string, unknown> | undefined)
				?.attachments as ChatAttachment[] | undefined;
			if (!attachments?.length) continue;

			const imageAttachments = attachments.filter((a) => a.mimeType.startsWith("image/"));
			const pdfAttachments = attachments.filter((a) => a.mimeType === "application/pdf");
			let imageIdx = 0;
			let pdfIdx = 0;

			for (let i = 0; i < content.length; i++) {
				const block = content[i] as Record<string, unknown>;
				if (block.type === "image_url") {
					const url = (block.image_url as Record<string, unknown> | undefined)?.url as string | undefined;
					if (url?.startsWith("data:")) {
						const att = imageAttachments[imageIdx++];
						if (att) content[i] = { type: "image_url", image_url: { url: `vault://${att.vaultPath}` } };
					}
				} else if (block.type === "file" && block.source_type === "base64") {
					const att = pdfAttachments[pdfIdx++];
					if (att) {
						content[i] = {
							type: "file",
							source_type: "vault",
							vault_path: att.vaultPath,
							mime_type: att.mimeType,
							metadata: block.metadata,
						};
					}
				}
			}
		}
	}

	private async rehydrateBase64InMessages(messages: unknown[]): Promise<void> {
		const vault = this.plugin.app.vault;
		for (const msg of messages) {
			const kwargs = (msg as Record<string, unknown>).kwargs as Record<string, unknown> | undefined;
			if (!kwargs) continue;
			const content = kwargs.content;
			if (!Array.isArray(content)) continue;
			const attachments = (kwargs.additional_kwargs as Record<string, unknown> | undefined)
				?.attachments as ChatAttachment[] | undefined;

			for (let i = 0; i < content.length; i++) {
				const block = content[i] as Record<string, unknown>;
				if (block.type === "image_url") {
					const url = (block.image_url as Record<string, unknown> | undefined)?.url as string | undefined;
					if (url?.startsWith("vault://")) {
						const vaultPath = url.slice("vault://".length);
						const file = vault.getAbstractFileByPath(vaultPath);
						if (file instanceof TFile) {
							const buffer = await vault.readBinary(file);
							const mimeType = attachments?.find((a) => a.vaultPath === vaultPath)?.mimeType ?? "image/png";
							content[i] = { type: "image_url", image_url: { url: toBase64DataUri(buffer, mimeType) } };
						} else {
							content[i] = { type: "text", text: `[Image at "${vaultPath}" is no longer available]` };
						}
					}
				} else if (block.type === "file" && block.source_type === "vault") {
					const vaultPath = block.vault_path as string;
					const file = vault.getAbstractFileByPath(vaultPath);
					if (file instanceof TFile) {
						const buffer = await vault.readBinary(file);
						content[i] = {
							type: "file",
							source_type: "base64",
							data: toBase64(buffer),
							mime_type: block.mime_type,
							metadata: block.metadata,
						};
					} else {
						content[i] = { type: "text", text: `[File at "${vaultPath}" is no longer available]` };
					}
				}
			}
		}
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

	private markThreadDirty(threadId: string): void {
		this.dirtyThreadVersions.set(threadId, (this.dirtyThreadVersions.get(threadId) ?? 0) + 1);
	}

	private markIndexDirty(): void {
		this.dirtyIndexVersion += 1;
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

	async resolveFilePath(threadId: string): Promise<string> {
		// Check cache first
		if (this.filePathCache.has(threadId)) {
			const cachedPath = this.filePathCache.get(threadId);
			if (cachedPath) return cachedPath;
		}

		const folder = this.getChatFolder();

		// First try the default path
		const defaultPath = `${folder}/${threadId}.chat`;
		if (await this.adapter.exists(defaultPath)) {
			this.filePathCache.set(threadId, defaultPath);
			return defaultPath;
		}

		// If not found, search for it (renamed files)
		try {
			if (await this.adapter.exists(folder)) {
				const result = await this.adapter.list(folder);
				for (const file of result.files) {
					if (!file.endsWith(".chat")) continue;

					try {
						const parsed = await this.readThreadFile(file);
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

		// Use default path (it will be created there when writing)
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
				for (const snapshot of snapshots) {
					this.threadIndex.set(snapshot.threadId, snapshot);
				}
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
		this.storage.clear();

		for (const file of result.files) {
			if (!file.endsWith(".chat")) continue;

			// Yield to event loop
			await new Promise((resolve) => setTimeout(resolve, 0));

			try {
				const data = await this.readThreadFile(file);
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
		if (this.inFlightIndexSave) {
			await this.inFlightIndexSave;
			if (this.persistedIndexVersion >= this.dirtyIndexVersion) {
				return;
			}
		}

		const indexPath = this.getIndexPath();
		const snapshots = Array.from(this.threadIndex.values());
		const targetVersion = this.dirtyIndexVersion;
		let savePromise: Promise<void> | null = null;
		savePromise = (async () => {
			try {
				await this.adapter.write(indexPath, JSON.stringify(snapshots));
				if (this.dirtyIndexVersion === targetVersion) {
					this.persistedIndexVersion = targetVersion;
				}
			} catch (e) {
				Logger.error("Error saving chat index:", e);
			} finally {
				if (this.inFlightIndexSave === savePromise) {
					this.inFlightIndexSave = null;
				}
			}
		})();
		this.inFlightIndexSave = savePromise;
		await savePromise;
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
				const data = await this.readThreadFile(path);
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
		const existingSave = this.inFlightThreadSaves.get(threadId);
		if (existingSave) {
			await existingSave;
			if ((this.persistedThreadVersions.get(threadId) ?? 0) >= (this.dirtyThreadVersions.get(threadId) ?? 0)) {
				return;
			}
		}

		const data = this.storage.get(threadId);
		if (!data) return;

		await this.ensureFolder();
		const path = await this.resolveFilePath(threadId);
		const targetVersion = this.dirtyThreadVersions.get(threadId) ?? 0;

		let savePromise: Promise<void> | null = null;
		savePromise = (async () => {
			try {
				const compressed = gzipSync(JSON.stringify(data));
				await this.adapter.writeBinary(
					path,
					compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer,
				);
				if ((this.dirtyThreadVersions.get(threadId) ?? 0) === targetVersion) {
					this.persistedThreadVersions.set(threadId, targetVersion);
				}

				// Update index
				this.threadIndex.set(threadId, {
					threadId: data.threadId,
					title: data.title,
					metadata: data.metadata,
					createdAt: data.createdAt,
					updatedAt: data.updatedAt,
				});
				this.markIndexDirty();
				this.saveIndexDebounced();
			} catch (e) {
				Logger.error(`Error saving thread ${threadId}:`, e);
			} finally {
				if (this.inFlightThreadSaves.get(threadId) === savePromise) {
					this.inFlightThreadSaves.delete(threadId);
				}
			}
		})();
		this.inFlightThreadSaves.set(threadId, savePromise);
		await savePromise;
	}

	private saveDebounced = debounce(
		(threadId: string) => {
			this.saveThread(threadId);
		},
		2000,
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

		this.markThreadDirty(snapshot.threadId);
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
			flush: this.flush.bind(this),
		};
	}

	async exportThreadAsJson(threadId: string): Promise<void> {
		const threadData = await this.ensureThreadLoaded(threadId);
		if (!threadData) throw new Error(`Thread ${threadId} not found`);
		const exportData = JSON.parse(JSON.stringify(threadData));
		for (const entry of Object.values(exportData.checkpoints as Record<string, CheckpointEntry>)) {
			const messages = ((entry.checkpoint as unknown) as Record<string, unknown>).channel_values as Record<string, unknown>;
			if (Array.isArray(messages?.messages)) await this.rehydrateBase64InMessages(messages.messages as unknown[]);
		}
		const folder = this.getChatFolder();
		const exportPath = normalizePath(`${folder}/${threadId}.json`);
		await this.adapter.write(exportPath, JSON.stringify(exportData, null, 2));
	}

	async flush(threadId?: string): Promise<void> {
		this.saveIndexDebounced.cancel();

		if (threadId) {
			await this.saveThread(threadId);
		} else {
			const threadIds = new Set<string>([
				...this.storage.keys(),
				...this.dirtyThreadVersions.keys(),
				...this.inFlightThreadSaves.keys(),
			]);
			await Promise.all(Array.from(threadIds, (id) => this.saveThread(id)));
		}

		await this.saveIndex();
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

			const pendingWrites = this.collectWritesWithErrors(threadData, checkpointId);
			const checkpoint = JSON.parse(JSON.stringify(entry.checkpoint));
			const messages = checkpoint.channel_values?.messages;
			if (Array.isArray(messages)) await this.rehydrateBase64InMessages(messages);

			return {
				config,
				checkpoint,
				metadata: entry.metadata,
				parentConfig: entry.parentConfig,
				pendingWrites: pendingWrites as unknown as CheckpointTuple["pendingWrites"],
			};
		}

		const checkpoints = Object.values(threadData.checkpoints);
		if (checkpoints.length === 0) return undefined;

		const sortedCheckpointIds = this.getSortedCheckpointIds(threadData);
		const latestId = sortedCheckpointIds[0];
		if (!latestId) return undefined;
		const entry = threadData.checkpoints[latestId];

		const pendingWrites = this.collectWritesWithErrors(threadData, latestId);
		const checkpoint = JSON.parse(JSON.stringify(entry.checkpoint));
		const messages = checkpoint.channel_values?.messages;
		if (Array.isArray(messages)) await this.rehydrateBase64InMessages(messages);

		return {
			config: {
				...config,
				configurable: { ...config.configurable, checkpoint_id: latestId },
			},
			checkpoint,
			metadata: entry.metadata,
			parentConfig: entry.parentConfig,
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

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

	private readString(record: Record<string, unknown>, key: string): string | undefined {
		const value = record[key];
		return typeof value === "string" && value.length > 0 ? value : undefined;
	}

	private extractGenerationMetadata(metadata: unknown): GenerationMetadata {
		if (!this.isRecord(metadata)) return {};
		return {
			agentId: this.readString(metadata, "agent_id"),
			agentName: this.readString(metadata, "agent_name"),
			provider: this.readString(metadata, "model_provider"),
			model: this.readString(metadata, "model"),
		};
	}

	private getCheckpointMessages(checkpoint: unknown): unknown[] {
		if (!this.isRecord(checkpoint)) return [];
		const channelValues = checkpoint.channel_values;
		if (!this.isRecord(channelValues)) return [];
		const messages = channelValues.messages;
		return Array.isArray(messages) ? messages : [];
	}

	private getParentMessageCount(threadData: ThreadData, config: RunnableConfig): number {
		const parentCheckpointId = config.configurable?.checkpoint_id;
		if (typeof parentCheckpointId !== "string" || parentCheckpointId.length === 0) {
			return 0;
		}
		const parentCheckpoint = threadData.checkpoints[parentCheckpointId]?.checkpoint;
		return this.getCheckpointMessages(parentCheckpoint).length;
	}

	private isAiSerializedMessage(message: Record<string, unknown>): boolean {
		if (typeof message.role === "string" && message.role.toLowerCase() === "assistant") {
			return true;
		}

		if (typeof message.type === "string") {
			const type = message.type.toLowerCase();
			if (type === "ai" || type === "aimessage" || type === "aimessagechunk") {
				return true;
			}
		}

		const identifier = message.id;
		if (Array.isArray(identifier) && typeof identifier[identifier.length - 1] === "string") {
			const className = (identifier[identifier.length - 1] as string).toLowerCase();
			return className === "aimessage" || className === "aimessagechunk";
		}

		if (typeof identifier === "string") {
			const className = identifier.split(":").pop()?.toLowerCase();
			return className === "aimessage" || className === "aimessagechunk";
		}

		return false;
	}

	private getOrCreateResponseMetadata(message: Record<string, unknown>): Record<string, unknown> | undefined {
		if (this.isRecord(message.kwargs)) {
			const kwargs = message.kwargs;
			if (!this.isRecord(kwargs.response_metadata)) {
				kwargs.response_metadata = {};
			}
			return this.isRecord(kwargs.response_metadata) ? kwargs.response_metadata : undefined;
		}

		if (this.isRecord(message.data)) {
			const data = message.data;
			if (!this.isRecord(data.response_metadata)) {
				data.response_metadata = {};
			}
			return this.isRecord(data.response_metadata) ? data.response_metadata : undefined;
		}

		if (!this.isRecord(message.response_metadata)) {
			message.response_metadata = {};
		}
		return this.isRecord(message.response_metadata) ? message.response_metadata : undefined;
	}

	private annotateCheckpointMessagesWithGeneration(
		checkpoint: unknown,
		parentMessageCount: number,
		generation: GenerationMetadata,
	): void {
		const messages = this.getCheckpointMessages(checkpoint);
		if (messages.length === 0) return;
		const startIndex = Math.max(0, Math.min(parentMessageCount, messages.length));
		const hasMetadata =
			Boolean(generation.agentId) ||
			Boolean(generation.agentName) ||
			Boolean(generation.provider) ||
			Boolean(generation.model);
		if (!hasMetadata) return;

		for (let i = startIndex; i < messages.length; i++) {
			const message = messages[i];
			if (!this.isRecord(message) || !this.isAiSerializedMessage(message)) {
				continue;
			}

			const responseMetadata = this.getOrCreateResponseMetadata(message);
			if (!responseMetadata) continue;

			if (generation.agentId) {
				responseMetadata.agent_id = generation.agentId;
			}
			if (generation.agentName) {
				responseMetadata.agent_name = generation.agentName;
			}
			if (!this.readString(responseMetadata, "model_provider") && generation.provider) {
				responseMetadata.model_provider = generation.provider;
			}
			if (!this.readString(responseMetadata, "model") && generation.model) {
				responseMetadata.model = generation.model;
			}
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
		const parentMessageCount = this.getParentMessageCount(threadData, config);
		const generation = this.extractGenerationMetadata(config.metadata);
		this.annotateCheckpointMessagesWithGeneration(plainCheckpoint, parentMessageCount, generation);
		this.stripBase64FromChannelValues(plainCheckpoint.channel_values);

		threadData.checkpoints[checkpointId] = {
			checkpoint: plainCheckpoint,
			metadata: plainMetadata,
			parentConfig: config,
		};

		threadData.updatedAt = Date.now();
		this.markThreadDirty(threadId);
		this.saveDebounced(threadId);

		// Update index cache immediately
		if (this.threadIndex.has(threadId)) {
			const snap = this.threadIndex.get(threadId);
			if (snap) {
				snap.updatedAt = threadData.updatedAt;
			}
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
		this.markIndexDirty();
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

		const plainWrites = JSON.parse(JSON.stringify(writes)) as PendingWrite[];
		for (const write of plainWrites) {
			this.stripBase64FromWriteValue(write[1]);
		}
		threadData.writes[checkpointId].push(...plainWrites);
		threadData.updatedAt = Date.now();
		this.markThreadDirty(threadId);
		this.saveDebounced(threadId);

		if (this.threadIndex.has(threadId)) {
			const snapshot = this.threadIndex.get(threadId);
			if (!snapshot) return;
			snapshot.updatedAt = threadData.updatedAt;
			this.markIndexDirty();
			this.saveIndexDebounced();
		}
	}

	async deleteThread(threadId: string): Promise<void> {
		// Remove from memory
		this.storage.delete(threadId);
		this.threadIndex.delete(threadId);
		this.filePathCache.delete(threadId);
		this.dirtyThreadVersions.delete(threadId);
		this.persistedThreadVersions.delete(threadId);
		this.markIndexDirty();
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
	}

	// --- Utilities ---

	private sanitizeFileName(title: string): string {
		return title
			.replace(/[<>:"/\\|?*]/g, "-")
			.replace(/\s+/g, " ")
			.trim()
			.substring(0, 100);
	}

	getAttachmentDirectory(): string {
		return getData().resolvedAttachmentFolder;
	}

	async getUniqueTitlePath(
		folder: string,
		baseTitle: string,
		currentPath: string,
	): Promise<{
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
				this.markThreadDirty(threadId);
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
			this.markIndexDirty();
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
		const file = this.plugin.app.vault.getAbstractFileByPath(currentPath);

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
		this.dirtyThreadVersions.delete(currentThreadId);
		this.persistedThreadVersions.delete(currentThreadId);

		const currentIndex = this.threadIndex.get(currentThreadId);
		this.threadIndex.delete(currentThreadId);
		this.threadIndex.set(nextThreadId, {
			threadId: nextThreadId,
			title: currentIndex?.title ?? loaded.title,
			metadata: currentIndex?.metadata ?? loaded.metadata,
			createdAt: currentIndex?.createdAt ?? loaded.createdAt,
			updatedAt: now,
		});

		let finalPath = currentPath;
		if (file && file instanceof TFile) {
			const folder = this.getChatFolder();
			const newPath = normalizePath(`${folder}/${nextThreadId}.chat`);
			// Only rename if the path changed and the target doesn't already exist
			if (currentPath !== newPath && !(await this.adapter.exists(newPath))) {
				try {
					await this.plugin.app.fileManager.renameFile(file, newPath);
					finalPath = newPath;
				} catch (e) {
					Logger.error("Error renaming file during ID reassignment:", e);
				}
			}
		}

		this.filePathCache.set(nextThreadId, finalPath);
		this.markThreadDirty(nextThreadId);
		this.markIndexDirty();
		await this.saveThread(nextThreadId);
		return true;
	}
}
