import {
    BaseCheckpointSaver,
    type Checkpoint,
    type CheckpointMetadata,
    type CheckpointTuple,
    type SerializerProtocol,
    type PendingWrite,
    type CheckpointListOptions
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { Plugin, debounce, TFile, normalizePath } from "obsidian";
import { type ThreadStore, type ThreadSnapshot } from "papa-ts";

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
    private plugin: Plugin;
    // In-memory cache: thread_id -> ThreadData (Loaded on demand)
    private storage: Map<string, ThreadData> = new Map();
    // Index cache: thread_id -> ThreadSnapshot (Loaded on startup)
    private threadIndex: Map<string, ThreadSnapshot> = new Map();
    private loaded: boolean = false;
    private indexLoaded: boolean = false;

    constructor(plugin: Plugin) {
        super();
        this.plugin = plugin;
    }

    private getChatFolder(): string {
        // @ts-ignore
        return this.plugin.settings.chatsFolder || "Chats";
    }

    private getFilePath(threadId: string): string {
        const folder = this.getChatFolder();
        return `${folder}/${threadId}.chat`;
    }

    private getIndexPath(): string {
        const configDir = (this.plugin.app.vault as any).configDir || '.obsidian';
        return `${configDir}/plugins/${this.plugin.manifest.id}/data/threads.json`;
    }

    private async ensureFolder(): Promise<void> {
        const folder = this.getChatFolder();
        const adapter = this.plugin.app.vault.adapter;
        if (!(await adapter.exists(folder))) {
            await adapter.mkdir(folder);
        }

        // Ensure plugin data dir for index
        const dataDir = `${(this.plugin.app.vault as any).configDir || '.obsidian'}/plugins/${this.plugin.manifest.id}/data`;
        if (!(await adapter.exists(dataDir))) {
            await adapter.mkdir(dataDir);
        }
    }

    // --- Load / Save Logic ---

    async load(): Promise<void> {
        // Load index only initially
        if (this.indexLoaded) return;

        await this.ensureFolder();
        const adapter = this.plugin.app.vault.adapter;
        const indexPath = this.getIndexPath();

        try {
            if (await adapter.exists(indexPath)) {
                const content = await adapter.read(indexPath);
                const snapshots = JSON.parse(content) as ThreadSnapshot[];
                this.threadIndex.clear();
                snapshots.forEach(s => this.threadIndex.set(s.threadId, s));
                this.indexLoaded = true;
                console.log(`ObsidianChatManager: Loaded index with ${this.threadIndex.size} threads`);
            } else {
                // Rebuild index from files if missing (one-time cost)
                console.log("ObsidianChatManager: Index missing, rebuilding...");
                await this.rebuildIndex();
            }
        } catch (e) {
            console.error("Error loading chat index:", e);
        }
    }

    async rebuildIndex(): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        const folder = this.getChatFolder();

        if (!(await adapter.exists(folder))) return;

        const result = await adapter.list(folder);
        this.threadIndex.clear();

        for (const file of result.files) {
            if (!file.endsWith(".chat")) continue;
            // Yield to event loop to prevent freezing
            await new Promise(resolve => setTimeout(resolve, 0));
            try {
                const content = await adapter.read(file);
                const data = JSON.parse(content) as ThreadData;
                if (data && data.threadId) {
                    this.threadIndex.set(data.threadId, {
                        threadId: data.threadId,
                        title: data.title,
                        metadata: data.metadata,
                        createdAt: data.createdAt,
                        updatedAt: data.updatedAt
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
        const adapter = this.plugin.app.vault.adapter;
        const indexPath = this.getIndexPath();
        const snapshots = Array.from(this.threadIndex.values());
        try {
            await adapter.write(indexPath, JSON.stringify(snapshots, null, 2));
        } catch (e) {
            console.error("Error saving chat index:", e);
        }
    }

    private saveIndexDebounced = debounce(() => {
        this.saveIndex();
    }, 2000, true);

    // Helper to load specific thread data into memory
    private async ensureThreadLoaded(threadId: string): Promise<ThreadData | undefined> {
        if (this.storage.has(threadId)) return this.storage.get(threadId);

        const adapter = this.plugin.app.vault.adapter;
        const path = this.getFilePath(threadId);

        try {
            if (await adapter.exists(path)) {
                const content = await adapter.read(path);
                const data = JSON.parse(content) as ThreadData;
                this.storage.set(threadId, data);
                return data;
            }
        } catch (e) {
            console.error(`Error loading thread ${threadId}:`, e);
        }
        return undefined;
    }

    private async saveThread(threadId: string) {
        const data = this.storage.get(threadId);
        if (!data) return;

        await this.ensureFolder();
        const adapter = this.plugin.app.vault.adapter;
        const path = this.getFilePath(threadId);

        try {
            await adapter.write(path, JSON.stringify(data, null, 2));
            // Update index
            this.threadIndex.set(threadId, {
                threadId: data.threadId,
                title: data.title,
                metadata: data.metadata,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt
            });
            this.saveIndexDebounced();
        } catch (e) {
            console.error(`Error saving thread ${threadId}:`, e);
        }
    }

    private saveDebounced = debounce((threadId: string) => {
        this.saveThread(threadId);
    }, 1000, true);

    // --- ThreadStore-like Implementation ---
    // We don't implement the interface directly due to 'list' name collision with BaseCheckpointSaver

    async read(threadId: string): Promise<ThreadSnapshot | undefined> {
        // Read metadata from index if available
        if (this.threadIndex.has(threadId)) {
            return this.threadIndex.get(threadId);
        }

        // Fallback to loading file
        const data = await this.ensureThreadLoaded(threadId);
        if (!data) return undefined;

        return {
            threadId: data.threadId,
            title: data.title,
            metadata: data.metadata,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt
        };
    }

    async write(snapshot: ThreadSnapshot): Promise<void> {
        // Ensure data is loaded before modifying
        let data = await this.ensureThreadLoaded(snapshot.threadId);

        if (!data) {
            data = {
                threadId: snapshot.threadId,
                createdAt: snapshot.createdAt,
                updatedAt: snapshot.updatedAt,
                checkpoints: {},
                writes: {}
            };
            this.storage.set(snapshot.threadId, data);
        }

        // Update metadata
        data.title = snapshot.title;
        data.metadata = snapshot.metadata;
        data.updatedAt = snapshot.updatedAt; // Ensure update time is synced

        this.saveDebounced(snapshot.threadId);
    }

    async delete(threadId: string): Promise<void> {
        await this.deleteThread(threadId);
    }

    async listThreads(): Promise<ThreadSnapshot[]> {
        await this.load(); // Ensures index is loaded
        return Array.from(this.threadIndex.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    // Helper to get a ThreadStore compatible object
    asThreadStore(): ThreadStore {
        return {
            read: this.read.bind(this),
            write: this.write.bind(this),
            delete: this.delete.bind(this),
            list: this.listThreads.bind(this),
            clear: this.clear.bind(this)
        };
    }

    async clear(): Promise<void> {
        await this.load();
        const ids = Array.from(this.storage.keys());
        for (const id of ids) {
            await this.deleteThread(id);
        }
    }


    // --- CheckpointSaver Implementation ---

    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        const threadId = config.configurable?.thread_id;
        if (!threadId) return undefined;

        // Ensure loaded
        const threadData = await this.ensureThreadLoaded(threadId);
        if (!threadData) return undefined;

        const checkpointId = config.configurable?.checkpoint_id;

        if (checkpointId) {
            const entry = threadData.checkpoints[checkpointId];
            if (!entry) return undefined;

            return {
                config,
                checkpoint: entry.checkpoint,
                metadata: entry.metadata,
                parentConfig: entry.parentConfig,
                pendingWrites: (threadData.writes[checkpointId] || []) as any
            };
        }

        const checkpoints = Object.values(threadData.checkpoints);
        if (checkpoints.length === 0) return undefined;

        const keys = Object.keys(threadData.checkpoints).sort().reverse();
        const latestId = keys[0];
        const entry = threadData.checkpoints[latestId];

        return {
            config: { ...config, configurable: { ...config.configurable, checkpoint_id: latestId } },
            checkpoint: entry.checkpoint,
            metadata: entry.metadata,
            parentConfig: entry.parentConfig,
            pendingWrites: (threadData.writes[latestId] || []) as any
        };
    }

    async *list(
        config: RunnableConfig,
        options?: CheckpointListOptions
    ): AsyncGenerator<CheckpointTuple> {
        const threadId = config.configurable?.thread_id;
        if (!threadId) return;

        const threadData = await this.ensureThreadLoaded(threadId);
        if (!threadData) return;

        const keys = Object.keys(threadData.checkpoints).sort().reverse();

        for (const key of keys) {
            const entry = threadData.checkpoints[key];
            if (options?.before && options.before.configurable?.checkpoint_id && key >= options.before.configurable.checkpoint_id) {
                continue;
            }

            yield {
                config: { ...config, configurable: { ...config.configurable, checkpoint_id: key } },
                checkpoint: entry.checkpoint,
                metadata: entry.metadata,
                parentConfig: entry.parentConfig,
                pendingWrites: (threadData.writes[key] || []) as any
            };

            if (options?.limit && --options.limit <= 0) break;
        }
    }

    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        newVersions: Record<string, number | string>
    ): Promise<RunnableConfig> {
        const threadId = config.configurable?.thread_id;
        const checkpointId = checkpoint.id;
        if (!threadId || !checkpointId) return config;

        let threadData = await this.ensureThreadLoaded(threadId);
        if (!threadData) {
            threadData = {
                threadId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                checkpoints: {},
                writes: {}
            };
            this.storage.set(threadId, threadData);
        }

        // Sanitize checkpoint to plain JSON to match disk storage behavior.
        // This ensures papa-ts always receives consistent plain objects, 
        // preventing normalization issues with mixed class instances/plain objects.
        const plainCheckpoint = JSON.parse(JSON.stringify(checkpoint));
        const plainMetadata = JSON.parse(JSON.stringify(metadata));

        threadData.checkpoints[checkpointId] = {
            checkpoint: plainCheckpoint,
            metadata: plainMetadata,
            parentConfig: config
        };

        // Update timestamp
        threadData.updatedAt = Date.now();

        this.saveDebounced(threadId);

        // Update index immediately for timestamp
        if (this.threadIndex.has(threadId)) {
            const snap = this.threadIndex.get(threadId)!;
            snap.updatedAt = threadData.updatedAt;
            this.threadIndex.set(threadId, snap);
            this.saveIndexDebounced();
        } else {
            // New thread potentially
            this.threadIndex.set(threadId, {
                threadId: threadData.threadId,
                title: threadData.title,
                metadata: threadData.metadata,
                createdAt: threadData.createdAt,
                updatedAt: threadData.updatedAt
            });
            this.saveIndexDebounced();
        }

        return {
            ...config,
            configurable: {
                ...config.configurable,
                checkpoint_id: checkpointId
            }
        };
    }

    async deleteThread(threadId: string): Promise<void> {
        this.storage.delete(threadId);
        this.threadIndex.delete(threadId);
        this.saveIndexDebounced();

        const adapter = this.plugin.app.vault.adapter;
        const path = this.getFilePath(threadId);

        try {
            if (await adapter.exists(path)) {
                await adapter.remove(path);
            }
        } catch (e) {
            console.error(`Error deleting thread ${threadId}:`, e);
        }
    }

    async putWrites(
        config: RunnableConfig,
        writes: PendingWrite[],
        taskId: string
    ): Promise<void> {
        const threadId = config.configurable?.thread_id;
        const checkpointId = config.configurable?.checkpoint_id;

        if (!threadId || !checkpointId) return;

        let threadData = await this.ensureThreadLoaded(threadId);
        if (!threadData) {
            threadData = {
                threadId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                checkpoints: {},
                writes: {}
            };
            this.storage.set(threadId, threadData);
        }

        if (!threadData.writes[checkpointId]) {
            threadData.writes[checkpointId] = [];
        }

        threadData.writes[checkpointId].push(...writes);
        threadData.updatedAt = Date.now();

        this.saveDebounced(threadId);

        // Update index for timestamp
        if (this.threadIndex.has(threadId)) {
            const snap = this.threadIndex.get(threadId)!;
            snap.updatedAt = threadData.updatedAt;
            this.threadIndex.set(threadId, snap);
            this.saveIndexDebounced();
        }
    }
}

