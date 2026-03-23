/**
 * Vector Store Service
 *
 * Main orchestration service for the embedding-based vector store.
 * Manages multiple indexes (one per embedding model), indexing, search,
 * and synchronization between IndexedDB and file storage.
 */

import { Notice, TFile, getAllTags } from "obsidian";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type SecondBrainPlugin from "../main";
import { hydrateEmbeddingModel } from "../lib/modelMetadataNormalizer";
import { fetchModelsDevData } from "../providers/modelsDevApi";
import { getOllamaModelsCache } from "../providers/ollamaModels";
import { fetchOpenRouterModels } from "../providers/openrouterModels";
import { getData } from "../stores/dataStore.svelte";
import { getRegistry } from "../providers/registry";
import { getDefaultEmbeddingBatchSize, normalizeEmbeddingBatchSize } from "./batchSize";
import { createVectorStore } from "./index";
import { FileSyncManager } from "./FileSyncManager";
import {
	INDEX_VERSION,
	getDbName,
	getIndexFilePath,
	type DefaultEmbedModel,
	type DocumentVector,
	type IndexMetadata,
	type IndexingProgress,
	type IndexingReport,
	type SearchFilter,
	type SerializedIndex,
	type SkipReason,
	type SkippedFile,
	type VectorSearchResult,
	type VectorStore,
} from "./types";
import { toFloat32Array } from "./similarity";
import { Logger } from "../utils/logging";
import { matchesPathPattern, shouldProcessVaultPath } from "../utils/fileFiltering";
import { matchesPathPrefix } from "../utils/pathUtils";

/** Default max input tokens for embedding models when metadata is unavailable */
const DEFAULT_EMBED_MAX_INPUT_TOKENS = 8191;

/** Debounce delay before re-embedding a modified file (ms) */
const MODIFY_DEBOUNCE_MS = 5_000;

/** Approximate chars per token for rough estimation */
const CHARS_PER_TOKEN = 4;

let instance: VectorStoreService | null = null;
let pendingInstance: VectorStoreService | null = null;
let pendingInitPromise: Promise<void> | null = null;

/**
 * Get the singleton VectorStoreService instance.
 * Must call initialize() first.
 */
export function getVectorStoreService(): VectorStoreService {
	if (!instance) {
		throw new Error("VectorStoreService not initialized. Call initialize() first.");
	}
	return instance;
}

/**
 * Check if the VectorStoreService has been initialized.
 */
export function isVectorStoreInitialized(): boolean {
	return instance !== null;
}

/**
 * Wait for the VectorStoreService to finish initializing.
 * Resolves immediately if already initialized, or waits for the pending init.
 * Returns true if initialization succeeded, false otherwise.
 */
export async function waitForVectorStore(): Promise<boolean> {
	if (instance) return true;
	if (pendingInitPromise) {
		await pendingInitPromise;
		return instance !== null;
	}
	return false;
}

/**
 * Wait for a specific index instance to be available.
 * Unlike waitForVectorStore(), this does not wait for unrelated indexes.
 */
export async function waitForVectorStoreIndex(indexId?: string | null): Promise<boolean> {
	if (!indexId) return false;

	const service = instance ?? pendingInstance;
	if (!service) return false;

	try {
		await service.getOrCreateInstance(indexId);
		return true;
	} catch (error) {
		Logger.error(`[VectorStore] Failed to initialize index ${indexId}:`, error);
		return false;
	}
}

/**
 * Per-index state container. Each embedding model gets its own instance
 * with separate storage, sync manager, and progress tracking.
 */
interface IndexInstance {
	indexId: string;
	store: VectorStore;
	syncManager: FileSyncManager;
	embeddings: EmbeddingsInterface | null;
	currentProviderId: string | null;
	currentModelId: string | null;
	hasValidatedThisSession: boolean;
	isIndexing: boolean;
	progress: IndexingProgress;
	abortController: AbortController | null;
	maxInputTokensCache: {
		provider: string;
		model: string;
		maxInputTokens: number;
	} | null;
	report: IndexingReport | null;
}

export interface IndexRestoreSourceSelectionInput {
	runtime: Pick<IndexMetadata, "providerId" | "modelId" | "documentCount" | "lastUpdated"> | null;
	file: Pick<SerializedIndex, "providerId" | "modelId" | "documents" | "lastUpdated"> | null;
	expectedProviderId: string;
	expectedModelId: string;
}

export function selectIndexRestoreSource({
	runtime,
	file,
	expectedProviderId,
	expectedModelId,
}: IndexRestoreSourceSelectionInput): "runtime" | "file" | "none" {
	const runtimeMatches =
		runtime !== null &&
		runtime.documentCount > 0 &&
		runtime.providerId === expectedProviderId &&
		runtime.modelId === expectedModelId;
	const fileMatches =
		file !== null &&
		file.providerId === expectedProviderId &&
		file.modelId === expectedModelId &&
		file.documents.length > 0;

	if (runtimeMatches && !fileMatches) return "runtime";
	if (fileMatches && !runtimeMatches) return "file";
	if (!runtimeMatches && !fileMatches) return "none";

	if ((runtime?.lastUpdated ?? 0) > (file?.lastUpdated ?? 0)) return "runtime";
	if ((runtime?.lastUpdated ?? 0) < (file?.lastUpdated ?? 0)) return "file";

	return (runtime?.documentCount ?? 0) >= (file?.documents.length ?? 0) ? "runtime" : "file";
}

export interface ValidationProgressCountsInput {
	eligibleFileCount: number;
	pendingFileCount: number;
	validPendingFileCount: number;
}

export function summarizeValidationProgressCounts({
	eligibleFileCount,
	pendingFileCount,
	validPendingFileCount,
}: ValidationProgressCountsInput): { startingIndexedCount: number; totalCount: number } {
	const normalizedEligible = Math.max(eligibleFileCount, 0);
	const normalizedPending = Math.max(Math.min(pendingFileCount, normalizedEligible), 0);
	const normalizedValidPending = Math.max(Math.min(validPendingFileCount, normalizedPending), 0);
	const startingIndexedCount = normalizedEligible - normalizedPending;

	return {
		startingIndexedCount,
		totalCount: startingIndexedCount + normalizedValidPending,
	};
}

/**
 * Main service for embedding-based vector search.
 * Manages multiple indexes, one per embedding model.
 */
export class VectorStoreService {
	private readonly plugin: SecondBrainPlugin;
	private readonly instances: Map<string, IndexInstance> = new Map();
	private readonly initializingInstances = new Map<string, Promise<IndexInstance>>();
	private readonly backgroundSnapshotSaves = new Map<string, Promise<void>>();
	private readonly progressListeners = new Map<string, Set<(progress: IndexingProgress) => void>>();
	private readonly modifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private isInitialized = false;
	private readonly vaultId: string;
	private readonly configDir: string;

	private constructor(plugin: SecondBrainPlugin) {
		this.plugin = plugin;
		this.vaultId = (plugin.app as unknown as { appId: string }).appId;
		const vault = plugin.app.vault as { configDir?: string };
		this.configDir = vault.configDir || ".obsidian";
	}

	/** Promise tracking initialization, awaited by cleanup to avoid closing mid-init. */
	private initPromise: Promise<void> | null = null;

	/**
	 * Create an IndexInstance for the given index ID.
	 */
	private createInstance(indexId: string): IndexInstance {
		const store = createVectorStore(this.vaultId, indexId);
		const filePath = `${this.configDir}/plugins/${this.plugin.manifest.id}/data/${getIndexFilePath(indexId)}`;
		const syncManager = new FileSyncManager(this.plugin.app.vault.adapter, filePath);

		return {
			indexId,
			store,
			syncManager,
			embeddings: null,
			currentProviderId: null,
			currentModelId: null,
			hasValidatedThisSession: false,
			isIndexing: false,
			progress: {
				isIndexing: false,
				total: 0,
				indexed: 0,
				skipped: 0,
				currentFile: null,
				percentage: 0,
			},
			abortController: null,
			maxInputTokensCache: null,
			report: null,
		};
	}

	/**
	 * Initialize the VectorStoreService singleton.
	 */
	static async initialize(plugin: SecondBrainPlugin): Promise<VectorStoreService> {
		if (instance) {
			Logger.warn("[VectorStore] Already initialized");
			return instance;
		}

		if (pendingInstance) {
			Logger.warn("[VectorStore] Initialization already in progress");
			if (pendingInitPromise) {
				await pendingInitPromise;
			}
			return instance ?? pendingInstance;
		}

		const service = new VectorStoreService(plugin);
		pendingInstance = service;
		service.initPromise = service.init();
		try {
			await service.initPromise;
			instance = service;
			return service;
		} finally {
			if (pendingInstance === service) {
				pendingInstance = null;
			}
		}
	}

	/**
	 * Start VectorStoreService initialization in the background.
	 * Returns the service immediately for cleanup purposes.
	 * isVectorStoreInitialized() will return false until init completes.
	 */
	static startInitialize(plugin: SecondBrainPlugin): VectorStoreService {
		if (instance) {
			Logger.warn("[VectorStore] Already initialized");
			return instance;
		}

		if (pendingInstance) {
			Logger.warn("[VectorStore] Initialization already in progress");
			return pendingInstance;
		}

		const service = new VectorStoreService(plugin);
		pendingInstance = service;
		pendingInitPromise = service
			.init()
			.then(() => {
				instance = service;
			})
			.catch((error) => {
				if (instance === service) {
					instance = null;
				}
				Logger.error("[VectorStore] Background initialization failed:", error);
			})
			.finally(() => {
				if (pendingInstance === service) {
					pendingInstance = null;
				}
				pendingInitPromise = null;
			});
		service.initPromise = pendingInitPromise;
		return service;
	}

	/**
	 * Internal initialization.
	 * Opens instances for currently-referenced indexes (search + graph).
	 */
	private async init(): Promise<void> {
		try {
			const data = getData();
			const searchIndex = data.searchEmbedIndex;
			const graphIndex = data.graphEmbedIndex;

			// Collect unique index IDs to initialize
			const indexIds = new Set<string>();
			if (searchIndex) indexIds.add(searchIndex);
			if (graphIndex) indexIds.add(graphIndex);

			if (indexIds.size > 0) {
				await Promise.all(Array.from(indexIds, (indexId) => this.initializeInstance(indexId)));
			}

			// Register vault events
			this.registerEvents();

			this.isInitialized = true;
			Logger.log("[VectorStore] Initialized");
		} catch (error) {
			Logger.error("[VectorStore] Initialization failed:", error);
			throw error;
		}
	}

	private async initializeInstance(indexId: string): Promise<IndexInstance> {
		// Return existing if already open
		const existing = this.instances.get(indexId);
		if (existing) return existing;

		const pending = this.initializingInstances.get(indexId);
		if (pending) return pending;

		const initPromise = (async () => {
			const initStart = performance.now();
			const inst = this.createInstance(indexId);

			// Open databases
			await inst.store.open();

			const [provider = "", ...modelParts] = indexId.split(":");
			const model = modelParts.join(":");

			// Check IDB metadata first — this is cheap (~50ms).
			// If runtime already matches the expected provider/model and has documents,
			// we can skip the expensive loadFromFile() call entirely (avoids deserializing
			// a potentially 40-100MB+ MessagePack file on the main thread).
			const runtimeMeta = await inst.store.getMetadata();
			const runtimeMatches =
				runtimeMeta !== null &&
				runtimeMeta.documentCount > 0 &&
				runtimeMeta.providerId === provider &&
				runtimeMeta.modelId === model;

			let serialized: SerializedIndex | null = null;
			if (!runtimeMatches) {
				serialized = await inst.syncManager.loadFromFile();
			}

			const restoreSource = selectIndexRestoreSource({
				runtime: runtimeMeta,
				file: serialized,
				expectedProviderId: provider,
				expectedModelId: model,
			});

			if (restoreSource === "file" && serialized) {
				const docs: DocumentVector[] = serialized.documents.map((d) => ({
					id: d.id,
					path: d.path,
					mtime: d.mtime,
					checksum: d.checksum,
					vector: toFloat32Array(d.vector),
					chunkIndex: d.chunkIndex,
				}));

				await inst.store.clear();
				await inst.store.bulkPut(docs);
				await inst.store.setMetadata(serialized.providerId, serialized.modelId, serialized.version);

				inst.currentProviderId = serialized.providerId;
				inst.currentModelId = serialized.modelId;

				Logger.log(
					`[VectorStore] Restored ${docs.length} documents for index ${indexId} from file in ${(performance.now() - initStart).toFixed(1)}ms`,
				);

				this.plugin.app.workspace.onLayoutReady(() => {
					this.validateIndexOnStartup(inst);
				});
			} else if (restoreSource === "runtime" && runtimeMeta) {
				inst.currentProviderId = runtimeMeta.providerId;
				inst.currentModelId = runtimeMeta.modelId;

				Logger.log(
					`[VectorStore] Kept newer runtime index for ${indexId} (${runtimeMeta.documentCount} documents) and refreshed the file snapshot`,
				);

				this.saveInstanceToFileInBackground(inst, indexId, runtimeMeta.documentCount);

				this.plugin.app.workspace.onLayoutReady(() => {
					this.validateIndexOnStartup(inst);
				});
			} else if (
				(serialized && (serialized.providerId !== provider || serialized.modelId !== model)) ||
				(runtimeMeta && (runtimeMeta.providerId !== provider || runtimeMeta.modelId !== model))
			) {
				Logger.log(`[VectorStore] Model mismatch for ${indexId}, index will be rebuilt on next use`);
				await inst.store.clear();
			}

			this.instances.set(indexId, inst);
			Logger.info(
				`[VectorStore] Init ${indexId}: ${Math.round(performance.now() - initStart)}ms (source=${restoreSource})`,
			);
			return inst;
		})();

		this.initializingInstances.set(indexId, initPromise);
		try {
			return await initPromise;
		} finally {
			this.initializingInstances.delete(indexId);
		}
	}

	private saveInstanceToFileInBackground(inst: IndexInstance, indexId: string, documentCount: number): void {
		if (this.backgroundSnapshotSaves.has(indexId)) {
			return;
		}

		const savePromise = this.saveInstanceToFile(inst)
			.then(() => {
				Logger.debug(`[VectorStore] Refreshed snapshot for ${indexId} (${documentCount} docs)`);
			})
			.catch((error) => {
				Logger.error(`[VectorStore] Background snapshot refresh failed for ${indexId}:`, error);
			})
			.finally(() => {
				this.backgroundSnapshotSaves.delete(indexId);
			});

		this.backgroundSnapshotSaves.set(indexId, savePromise);
	}

	/**
	 * Get or create an instance for the given index ID.
	 * Lazily initializes instances when first accessed.
	 */
	async getOrCreateInstance(indexId: string): Promise<IndexInstance> {
		const existing = this.instances.get(indexId);
		if (existing) return existing;
		return this.initializeInstance(indexId);
	}

	/**
	 * Get the instance for a given purpose (search or graph).
	 */
	private async getInstanceForPurpose(purpose: "search" | "graph"): Promise<IndexInstance | null> {
		const data = getData();
		const indexId = purpose === "search" ? data.searchEmbedIndex : data.graphEmbedIndex;
		if (!indexId) return null;
		return this.getOrCreateInstance(indexId);
	}

	private async persistIndexCheckpoint(
		inst: IndexInstance,
		indexedCount: number,
		lastPersistedCount: number,
	): Promise<number> {
		if (indexedCount === 0 || indexedCount === lastPersistedCount) {
			return lastPersistedCount;
		}

		await this.saveInstanceToFile(inst);
		return indexedCount;
	}

	private async getEmbeddingMaxInputTokens(
		inst: IndexInstance,
		defaultModel: DefaultEmbedModel | null,
	): Promise<number> {
		if (!defaultModel) {
			return DEFAULT_EMBED_MAX_INPUT_TOKENS;
		}

		if (
			inst.maxInputTokensCache?.provider === defaultModel.provider &&
			inst.maxInputTokensCache.model === defaultModel.model
		) {
			return inst.maxInputTokensCache.maxInputTokens;
		}

		const [modelsDevData, openRouterData] = await Promise.all([
			fetchModelsDevData(),
			defaultModel.provider === "openrouter" ? fetchOpenRouterModels() : Promise.resolve(null),
		]);

		const ollamaData =
			defaultModel.provider === "ollama"
				? (() => {
						const ollamaAuth = getData().getResolvedProviderAuth("ollama");
						if (!ollamaAuth?.baseUrl) return null;
						return getOllamaModelsCache(ollamaAuth.baseUrl);
					})()
				: null;

		const metadata = hydrateEmbeddingModel(defaultModel.provider, defaultModel.model, {
			modelsDevData,
			openRouterData,
			ollamaData,
		});

		inst.maxInputTokensCache = {
			provider: defaultModel.provider,
			model: defaultModel.model,
			maxInputTokens: metadata.maxInputTokens,
		};

		return metadata.maxInputTokens;
	}

	private async getMaxEmbeddingContentLength(
		inst: IndexInstance,
		defaultModel: DefaultEmbedModel | null,
	): Promise<number> {
		const maxInputTokens = await this.getEmbeddingMaxInputTokens(inst, defaultModel);
		return maxInputTokens * CHARS_PER_TOKEN;
	}

	/**
	 * Validate the index against the vault on startup.
	 */
	private async validateIndexOnStartup(inst: IndexInstance): Promise<void> {
		const model = this.getModelForInstance(inst);
		if (!model) {
			Logger.log(`[VectorStore] No embedding model for ${inst.indexId}, skipping validation`);
			return;
		}

		const registry = getRegistry();
		if (!registry.has(model.provider)) {
			Logger.log(`[VectorStore] Provider not yet registered for ${inst.indexId}, will validate on first search`);
			return;
		}

		const embeddings = this.getEmbeddingsForInstance(inst, model);
		if (!embeddings) {
			Logger.log(`[VectorStore] Failed to create embeddings for ${inst.indexId}, skipping validation`);
			return;
		}

		await this.validateIndexCompleteness(inst, embeddings, model);
	}

	/**
	 * Get the model for an index instance by parsing its indexId.
	 */
	private getModelForInstance(inst: IndexInstance): DefaultEmbedModel | null {
		const [provider, ...modelParts] = inst.indexId.split(":");
		const model = modelParts.join(":");
		if (!provider || !model) return null;
		return { provider, model };
	}

	/**
	 * Get or create embeddings for a specific instance.
	 */
	private getEmbeddingsForInstance(inst: IndexInstance, model: DefaultEmbedModel): EmbeddingsInterface | null {
		if (inst.embeddings && inst.currentProviderId === model.provider && inst.currentModelId === model.model) {
			return inst.embeddings;
		}

		try {
			const registry = getRegistry();
			inst.embeddings = registry.createEmbeddingInstance(model.provider, model.model);
			inst.currentProviderId = model.provider;
			inst.currentModelId = model.model;
			return inst.embeddings;
		} catch (error) {
			Logger.error(`[VectorStore] Failed to create embeddings for ${inst.indexId}:`, error);
			return null;
		}
	}

	/**
	 * Validate index completeness and update missing/stale entries.
	 */
	private async validateIndexCompleteness(
		inst: IndexInstance,
		embeddings: EmbeddingsInterface,
		defaultModel: DefaultEmbedModel,
	): Promise<void> {
		if (inst.hasValidatedThisSession) return;
		inst.hasValidatedThisSession = true;

		Logger.log(`[VectorStore] Validating index ${inst.indexId} against vault...`);

		const { vault } = this.plugin.app;
		const allVaultFiles = vault.getMarkdownFiles();
		const vaultFiles = allVaultFiles.filter((file) => this.shouldIndexFile(file, defaultModel.provider));

		const indexedDocs = await inst.store.getAll();
		const indexedMap = new Map<string, { mtime: number }>();
		for (const doc of indexedDocs) {
			indexedMap.set(doc.path, { mtime: doc.mtime });
		}

		const missingFiles: TFile[] = [];
		const staleFiles: TFile[] = [];
		const vaultPaths = new Set<string>();

		for (const file of vaultFiles) {
			vaultPaths.add(file.path);
			const indexed = indexedMap.get(file.path);
			if (!indexed) {
				missingFiles.push(file);
			} else if (indexed.mtime < file.stat.mtime) {
				staleFiles.push(file);
			}
		}

		const orphanedPaths: string[] = [];
		for (const path of indexedMap.keys()) {
			if (!vaultPaths.has(path)) orphanedPaths.push(path);
		}

		const totalUpdates = missingFiles.length + staleFiles.length + orphanedPaths.length;
		if (totalUpdates === 0) {
			Logger.log(`[VectorStore] Index ${inst.indexId} is up to date`);
			// Always sync document count to fix stale cached values
			await this.notifyStatsChanged(inst);
			return;
		}

		Logger.log(
			`[VectorStore] ${inst.indexId}: ${missingFiles.length} missing, ${staleFiles.length} stale, ${orphanedPaths.length} orphaned`,
		);

		let didMutateIndex = false;

		if (orphanedPaths.length > 0) {
			for (const path of orphanedPaths) {
				await inst.store.remove(path);
			}
			didMutateIndex = true;
			Logger.log(`[VectorStore] Removed ${orphanedPaths.length} orphaned entries`);
		}

		const filesToIndex = [...missingFiles, ...staleFiles];
		if (filesToIndex.length > 0) {
			const batchSize = this.getBatchSize(inst.indexId, defaultModel.provider);

			// Pre-read files and filter out too-large/unreadable ones before
			// setting up progress tracking so counts are accurate from the start.
			interface FileEntry {
				file: TFile;
				content: string;
				contentWithTitle: string;
			}
			const validFiles: FileEntry[] = [];
			const maxContentLength = await this.getMaxEmbeddingContentLength(inst, defaultModel);
			const skippedTooLarge: string[] = [];
			const skippedReadError: string[] = [];

			for (const file of filesToIndex) {
				try {
					const content = await vault.cachedRead(file);
					if (content.length <= maxContentLength) {
						const contentWithTitle = `# ${file.basename}\n\n${content}`;
						validFiles.push({ file, content, contentWithTitle });
					} else {
						skippedTooLarge.push(file.basename);
					}
				} catch (error) {
					Logger.error(`[VectorStore] Failed to read ${file.path}:`, error);
					skippedReadError.push(file.basename);
				}
			}

			const preFilterSkipped = skippedTooLarge.length + skippedReadError.length;

			Logger.log(
				`[VectorStore] ${inst.indexId}: pre-filter result: ${validFiles.length} valid, ${preFilterSkipped} skipped (maxContentLength=${maxContentLength})`,
			);

			if (preFilterSkipped > 0) {
				const parts: string[] = [];
				if (skippedTooLarge.length > 0) {
					parts.push(`${skippedTooLarge.length} too large: ${skippedTooLarge.join(", ")}`);
				}
				if (skippedReadError.length > 0) {
					parts.push(`${skippedReadError.length} unreadable: ${skippedReadError.join(", ")}`);
				}
				new Notice(`Skipped indexing ${preFilterSkipped} notes (${parts.join("; ")})`, 8000);
			}

			// If no files actually need indexing (all too large / unreadable), skip entirely
			if (validFiles.length === 0) {
				Logger.log(
					`[VectorStore] ${inst.indexId}: all ${filesToIndex.length} pending files were skipped (too large or unreadable)`,
				);
			} else {
				const pendingFileCount = filesToIndex.length;
				const { startingIndexedCount, totalCount } = summarizeValidationProgressCounts({
					eligibleFileCount: vaultFiles.length,
					pendingFileCount,
					validPendingFileCount: validFiles.length,
				});
				let indexed = 0;
				let lastPersistedIndexed = 0;
				const showNotice = validFiles.length > 5;
				let notice: Notice | null = null;
				if (showNotice) {
					notice = new Notice("", 0);
				}

				this.updateInstanceProgress(inst, {
					isIndexing: true,
					total: totalCount,
					indexed: startingIndexedCount,
					skipped: preFilterSkipped,
					currentFile: null,
				});
				if (notice) this.updateNotice(notice, inst.progress);
				inst.abortController = new AbortController();

				for (let i = 0; i < validFiles.length; i += batchSize) {
					if (inst.abortController?.signal.aborted) {
						Logger.log(`[VectorStore] Validation indexing cancelled for ${inst.indexId}`);
						break;
					}

					const batch = validFiles.slice(i, i + batchSize);
					const batchEnd = Math.min(i + batchSize, validFiles.length);

					this.updateInstanceProgress(inst, {
						currentFile:
							batch.length === 1
								? batch[0].file.path
								: `Embedding batch ${Math.floor(i / batchSize) + 1}...`,
					});

					try {
						const texts = batch.map((entry) => entry.contentWithTitle);
						const vectors = await embeddings.embedDocuments(texts);
						if (!vectors || vectors.length === 0) {
							Logger.error(`[VectorStore] embedDocuments returned empty result for ${inst.indexId}`);
							this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + batch.length });
							continue;
						}
						for (let j = 0; j < batch.length; j++) {
							if (!vectors[j]) {
								Logger.error(`[VectorStore] Empty vector for ${batch[j].file.path}`);
								continue;
							}
							const entry = batch[j];
							const doc: DocumentVector = {
								id: entry.file.path,
								path: entry.file.path,
								mtime: entry.file.stat.mtime,
								checksum: this.hashContent(entry.content),
								vector: new Float32Array(vectors[j]),
							};
							await inst.store.upsert(doc);
						}
						indexed += batch.length;
						this.updateInstanceProgress(inst, { indexed: startingIndexedCount + batchEnd });
						lastPersistedIndexed = await this.persistIndexCheckpoint(inst, indexed, lastPersistedIndexed);
						if (notice) this.updateNotice(notice, inst.progress);
					} catch (error) {
						Logger.error("[VectorStore] Batch validation indexing failed:", error);
						for (const entry of batch) {
							if (inst.abortController?.signal.aborted) break;
							try {
								const vector = await embeddings.embedQuery(entry.contentWithTitle);
								if (!vector || vector.length === 0) {
									Logger.error(
										`[VectorStore] embedQuery returned empty result for ${entry.file.path}`,
									);
									this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
									continue;
								}
								const doc: DocumentVector = {
									id: entry.file.path,
									path: entry.file.path,
									mtime: entry.file.stat.mtime,
									checksum: this.hashContent(entry.content),
									vector: new Float32Array(vector),
								};
								await inst.store.upsert(doc);
								indexed++;
								this.updateInstanceProgress(inst, { indexed: inst.progress.indexed + 1 });
							} catch (entryError) {
								Logger.error(`[VectorStore] Failed to index ${entry.file.path}:`, entryError);
								const reason = entryError instanceof Error ? entryError.message : String(entryError);
								new Notice(`Failed to embed ${entry.file.basename}: ${reason}`);
								this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
							}
						}
						lastPersistedIndexed = await this.persistIndexCheckpoint(inst, indexed, lastPersistedIndexed);
						if (notice) this.updateNotice(notice, inst.progress);
					}
				}

				if (notice) {
					const cancelled = inst.abortController?.signal.aborted;
					notice.setMessage(
						cancelled
							? `Indexing cancelled (${indexed} files updated)`
							: `✓ Index updated: ${indexed} files`,
					);
					setTimeout(() => notice.hide(), 3000);
				}

				inst.abortController = null;
				this.updateInstanceProgress(inst, { isIndexing: false, currentFile: null });
				Logger.log(`[VectorStore] Indexed ${indexed} missing/stale files for ${inst.indexId}`);
			} // end else (validFiles.length > 0)
		}

		if (didMutateIndex) {
			await this.saveInstanceToFile(inst);
		}

		// Sync document count to pluginData for reactive UI updates
		const count = await inst.store.count();
		getData().updateEmbeddingIndexStats(inst.indexId, { documentCount: count });

		Logger.log(`[VectorStore] Validation complete for ${inst.indexId}`);
	}

	/**
	 * Register vault file events for incremental updates.
	 * Events are only forwarded to active (selected) instances.
	 * Inactive instances are marked for re-validation on next use.
	 */
	private registerEvents(): void {
		const { vault } = this.plugin.app;

		this.plugin.registerEvent(
			vault.on("create", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileCreate(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.handleFileModify(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("delete", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileDelete(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("rename", async (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileRename(file, oldPath);
				}
			}),
		);
	}

	/**
	 * Check if an index is currently active (selected for search or graph).
	 */
	private isActiveIndex(indexId: string): boolean {
		const data = getData();
		return indexId === data.searchEmbedIndex || indexId === data.graphEmbedIndex;
	}

	/**
	 * Handle new file creation — forward to active instances only.
	 * Inactive instances are marked for re-validation on next use.
	 */
	private async handleFileCreate(file: TFile): Promise<void> {
		for (const inst of this.instances.values()) {
			if (!this.isActiveIndex(inst.indexId)) {
				inst.hasValidatedThisSession = false;
				continue;
			}
			if (!inst.embeddings || inst.isIndexing) continue;
			await this.indexDocumentForInstance(inst, file);
			this.notifyStatsChanged(inst);
		}
	}

	/**
	 * Handle file modification — debounce re-embedding until 10s of inactivity.
	 * Inactive instances are marked for re-validation on next use.
	 */
	private handleFileModify(file: TFile): void {
		const existing = this.modifyTimers.get(file.path);
		if (existing) clearTimeout(existing);

		this.modifyTimers.set(
			file.path,
			setTimeout(async () => {
				this.modifyTimers.delete(file.path);

				for (const inst of this.instances.values()) {
					if (!this.isActiveIndex(inst.indexId)) {
						inst.hasValidatedThisSession = false;
						continue;
					}
					if (!inst.embeddings || inst.isIndexing) continue;
					const storedMtime = await inst.store.getDocumentMtime(file.path);
					if (storedMtime && storedMtime >= file.stat.mtime) continue;
					await this.indexDocumentForInstance(inst, file);
					this.notifyStatsChanged(inst);
				}
			}, MODIFY_DEBOUNCE_MS),
		);
	}

	/**
	 * Handle file deletion — forward to active instances only.
	 * Inactive instances are marked for re-validation on next use.
	 */
	private async handleFileDelete(file: TFile): Promise<void> {
		for (const inst of this.instances.values()) {
			if (!this.isActiveIndex(inst.indexId)) {
				inst.hasValidatedThisSession = false;
				continue;
			}
			await inst.store.remove(file.path);
			this.scheduleInstanceSave(inst);
			this.notifyStatsChanged(inst);
		}
	}

	/**
	 * Handle file rename — forward to active instances only.
	 * Inactive instances are marked for re-validation on next use.
	 */
	private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
		for (const inst of this.instances.values()) {
			if (!this.isActiveIndex(inst.indexId)) {
				inst.hasValidatedThisSession = false;
				continue;
			}
			await inst.store.remove(oldPath);
			if (inst.embeddings) {
				await this.indexDocumentForInstance(inst, file);
			} else {
				// Even if we can't re-index (no embeddings), persist the removal
				this.scheduleInstanceSave(inst);
			}
			this.notifyStatsChanged(inst);
		}
	}

	/**
	 * Ensure the index is built for the given indexId.
	 * Called on-demand when embeddings search is used.
	 */
	async ensureIndex(indexId?: string): Promise<boolean> {
		const data = getData();
		const resolvedId = indexId ?? data.searchEmbedIndex;
		if (!resolvedId) {
			new Notice("No embedding model configured. Please set a default embedding model in settings.");
			return false;
		}

		const inst = await this.getOrCreateInstance(resolvedId);
		const model = this.getModelForInstance(inst);
		if (!model) {
			new Notice("Invalid embedding index configuration.");
			return false;
		}

		const embeddings = this.getEmbeddingsForInstance(inst, model);
		if (!embeddings) {
			new Notice("Failed to initialize embedding model. Check your provider settings.");
			return false;
		}

		// Check if model changed
		const meta = await inst.store.getMetadata();
		const modelChanged = meta && (meta.providerId !== model.provider || meta.modelId !== model.model);

		if (modelChanged) {
			Logger.log(`[VectorStore] Model changed for ${resolvedId}, clearing index`);
			await inst.store.clear();
		}

		const count = await inst.store.count();
		if (count === 0 || modelChanged) {
			await this.buildFullIndex(inst, embeddings, model);
			inst.hasValidatedThisSession = true;
		} else if (!inst.hasValidatedThisSession) {
			this.validateIndexCompleteness(inst, embeddings, model);
		}

		return true;
	}

	/**
	 * Get the configured batch size for an index, falling back to provider defaults.
	 */
	private getBatchSize(indexId: string, providerId: string): number {
		const configuredBatchSize = getData().getEmbeddingIndex(indexId)?.batchSize;
		return normalizeEmbeddingBatchSize(configuredBatchSize ?? getDefaultEmbeddingBatchSize(providerId), providerId);
	}

	/**
	 * Build the full index for a specific instance.
	 */
	private async buildFullIndex(
		inst: IndexInstance,
		embeddings: EmbeddingsInterface,
		model: DefaultEmbedModel,
	): Promise<void> {
		if (inst.isIndexing) {
			new Notice("Indexing already in progress...");
			return;
		}

		inst.isIndexing = true;
		inst.abortController = new AbortController();
		const { vault } = this.plugin.app;
		const allFiles = vault.getMarkdownFiles();
		const batchSize = this.getBatchSize(inst.indexId, model.provider);

		// Categorize files by skip reason
		const files: TFile[] = [];
		const skippedFiles: SkippedFile[] = [];
		for (const file of allFiles) {
			const reason = this.getFileSkipReason(file, model.provider);
			if (reason) {
				skippedFiles.push({ path: file.path, reason });
			} else {
				files.push(file);
			}
		}
		const indexedFiles: string[] = [];

		this.updateInstanceProgress(inst, {
			isIndexing: true,
			total: files.length,
			indexed: 0,
			skipped: skippedFiles.length,
			currentFile: null,
			percentage: 0,
		});

		const notice = new Notice("", 0);
		this.updateNotice(notice, inst.progress);
		let lastPersistedIndexed = 0;

		try {
			await inst.store.setMetadata(model.provider, model.model, INDEX_VERSION);

			this.updateInstanceProgress(inst, { currentFile: "Reading files..." });
			this.updateNotice(notice, inst.progress);

			interface FileEntry {
				file: TFile;
				content: string;
				contentWithTitle: string;
			}

			const validFiles: FileEntry[] = [];
			const maxContentLength = await this.getMaxEmbeddingContentLength(inst, model);

			for (const file of files) {
				try {
					const content = await vault.cachedRead(file);
					if (content.length > maxContentLength) {
						skippedFiles.push({ path: file.path, reason: "too-large" });
						this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
						continue;
					}
					const contentWithTitle = `# ${file.basename}\n\n${content}`;
					validFiles.push({ file, content, contentWithTitle });
				} catch (error) {
					Logger.error(`[VectorStore] Failed to read ${file.path}:`, error);
					skippedFiles.push({ path: file.path, reason: "read-error" });
					this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
				}
			}

			this.updateInstanceProgress(inst, { total: validFiles.length });
			this.updateNotice(notice, inst.progress);

			for (let i = 0; i < validFiles.length; i += batchSize) {
				if (inst.abortController?.signal.aborted) {
					Logger.log(`[VectorStore] Indexing cancelled for ${inst.indexId}`);
					break;
				}

				const batch = validFiles.slice(i, i + batchSize);
				const batchEnd = Math.min(i + batchSize, validFiles.length);

				this.updateInstanceProgress(inst, {
					currentFile:
						batch.length === 1 ? batch[0].file.path : `Embedding batch ${Math.floor(i / batchSize) + 1}...`,
				});
				this.updateNotice(notice, inst.progress);

				try {
					const texts = batch.map((entry) => entry.contentWithTitle);
					const vectors = await embeddings.embedDocuments(texts);
					if (!vectors || vectors.length === 0) {
						Logger.error(`[VectorStore] embedDocuments returned empty result for ${inst.indexId}`);
						for (const entry of batch) skippedFiles.push({ path: entry.file.path, reason: "embed-error" });
						this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + batch.length });
						this.updateNotice(notice, inst.progress);
						continue;
					}

					for (let j = 0; j < batch.length; j++) {
						if (!vectors[j]) {
							Logger.error(`[VectorStore] Empty vector for ${batch[j].file.path}`);
							skippedFiles.push({ path: batch[j].file.path, reason: "embed-error" });
							continue;
						}
						const entry = batch[j];
						const doc: DocumentVector = {
							id: entry.file.path,
							path: entry.file.path,
							mtime: entry.file.stat.mtime,
							checksum: this.hashContent(entry.content),
							vector: new Float32Array(vectors[j]),
						};
						await inst.store.upsert(doc);
						indexedFiles.push(entry.file.path);
					}

					this.updateInstanceProgress(inst, { indexed: batchEnd });
					this.updateNotice(notice, inst.progress);
					lastPersistedIndexed = await this.persistIndexCheckpoint(
						inst,
						indexedFiles.length,
						lastPersistedIndexed,
					);
				} catch (error) {
					Logger.warn(
						`[VectorStore] Batch ${Math.floor(i / batchSize) + 1} failed, falling back to sequential:`,
						error,
					);

					for (const entry of batch) {
						if (inst.abortController?.signal.aborted) break;
						try {
							const vector = await embeddings.embedQuery(entry.contentWithTitle);
							if (!vector || vector.length === 0) {
								Logger.error(`[VectorStore] embedQuery returned empty result for ${entry.file.path}`);
								skippedFiles.push({ path: entry.file.path, reason: "embed-error" });
								this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
								continue;
							}
							const doc: DocumentVector = {
								id: entry.file.path,
								path: entry.file.path,
								mtime: entry.file.stat.mtime,
								checksum: this.hashContent(entry.content),
								vector: new Float32Array(vector),
							};
							await inst.store.upsert(doc);
							indexedFiles.push(entry.file.path);
							this.updateInstanceProgress(inst, { indexed: inst.progress.indexed + 1 });
						} catch (entryError) {
							Logger.error(`[VectorStore] Failed to index ${entry.file.path}:`, entryError);
							const reason = entryError instanceof Error ? entryError.message : String(entryError);
							new Notice(`Failed to embed ${entry.file.basename}: ${reason}`);
							skippedFiles.push({ path: entry.file.path, reason: "embed-error" });
							this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
						}
					}
					this.updateNotice(notice, inst.progress);
					lastPersistedIndexed = await this.persistIndexCheckpoint(
						inst,
						indexedFiles.length,
						lastPersistedIndexed,
					);
				}
			}

			// Save the indexing report
			inst.report = { indexedFiles, skippedFiles, timestamp: Date.now() };

			await this.saveInstanceToFile(inst);

			// Update cached stats in plugin data using actual store count
			const actualCount = await inst.store.count();
			const data = getData();
			data.updateEmbeddingIndexStats(inst.indexId, {
				lastBuiltAt: Date.now(),
				documentCount: actualCount,
			});

			const { indexed, skipped } = inst.progress;
			const cancelled = inst.abortController?.signal.aborted;
			const skippedText = skipped > 0 ? `, ${skipped} skipped` : "";
			const noticeMessage = cancelled
				? `Indexing cancelled (${indexed} notes indexed so far)`
				: `✓ Indexed ${indexed} notes${skippedText}`;
			notice.setMessage(noticeMessage);
			setTimeout(() => notice.hide(), 3000);

			Logger.log(`[VectorStore] Full index complete for ${inst.indexId}: ${indexed} indexed, ${skipped} skipped`);
		} finally {
			inst.isIndexing = false;
			inst.abortController = null;
			this.updateInstanceProgress(inst, { isIndexing: false, currentFile: null });
		}
	}

	/**
	 * Update the indexing notice with current progress.
	 */
	private updateNotice(notice: Notice, progress: IndexingProgress): void {
		const { indexed, skipped, total, percentage } = progress;
		const skippedText = skipped > 0 ? ` (${skipped} skipped)` : "";

		const el = notice.noticeEl;
		el.empty();

		const container = el.createDiv({ cls: "s2b-indexing-notice" });

		container.createDiv({
			cls: "s2b-indexing-status",
			text: `Indexing: ${indexed}/${total}${skippedText}`,
		});

		const progressContainer = container.createDiv({ cls: "s2b-indexing-progress" });
		progressContainer.style.cssText =
			"width: 100%; height: 6px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden; margin: 8px 0;";

		const progressFill = progressContainer.createDiv({ cls: "s2b-indexing-fill" });
		progressFill.style.cssText = `width: ${percentage}%; height: 100%; background: var(--interactive-accent); border-radius: 3px; transition: width 0.2s ease;`;

		container.createDiv({
			cls: "s2b-indexing-percent",
			text: `${percentage}%`,
		});
	}

	/**
	 * Check if a file should be indexed based on internal filter rules and
	 * privacy rules. When a provider is specified, private files are blocked
	 * for untrusted providers.
	 */
	private shouldIndexFile(file: TFile, provider?: string): boolean {
		return this.getFileSkipReason(file, provider) === null;
	}

	/**
	 * Get the reason a file would be skipped, or null if it should be indexed.
	 */
	private getFileSkipReason(file: TFile, provider?: string): SkipReason | null {
		const pluginData = getData();
		if (!shouldProcessVaultPath(file.path, pluginData.targetFolder)) return "excluded";

		// Privacy check: skip private files for untrusted providers
		if (provider && !pluginData.isProviderTrusted(provider)) {
			const privacyList = pluginData.privacyList;
			const privacyIsExcluding = pluginData.privacyIsExcluding;
			const matchesPrivacy = privacyList.some((pattern) => matchesPathPattern(file.path, pattern));
			const isPrivate = privacyIsExcluding ? matchesPrivacy : privacyList.length > 0 && !matchesPrivacy;
			if (isPrivate) return "privacy";
		}

		return null;
	}

	/**
	 * Index a single document for a specific instance.
	 */
	private async indexDocumentForInstance(inst: IndexInstance, file: TFile): Promise<void> {
		const model = this.getModelForInstance(inst);
		if (!model) return;
		const embeddings = this.getEmbeddingsForInstance(inst, model);
		if (!embeddings) return;

		if (!this.shouldIndexFile(file, model.provider)) {
			Logger.log(`[VectorStore] Skipping ${file.path}: excluded by internal rules`);
			return;
		}

		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			const maxContentLength = await this.getMaxEmbeddingContentLength(inst, model);

			if (content.length > maxContentLength) {
				Logger.log(`[VectorStore] Skipping ${file.path}: too large`);
				return;
			}

			const contentWithTitle = `# ${file.basename}\n\n${content}`;
			const vector = await embeddings.embedQuery(contentWithTitle);
			if (!vector || vector.length === 0) {
				Logger.error(`[VectorStore] embedQuery returned empty result for ${file.path}`);
				new Notice(`Failed to embed ${file.basename}: empty result from model`);
				return;
			}

			const doc: DocumentVector = {
				id: file.path,
				path: file.path,
				mtime: file.stat.mtime,
				checksum: this.hashContent(content),
				vector: new Float32Array(vector),
			};

			await inst.store.upsert(doc);
			this.scheduleInstanceSave(inst);

			Logger.log(`[VectorStore] Indexed: ${file.path} (${inst.indexId})`);
		} catch (error) {
			Logger.error(`[VectorStore] Failed to index ${file.path} (${inst.indexId}):`, error);
			const reason = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to embed ${file.basename}: ${reason}`);
		}
	}

	/**
	 * Semantic (embedding-based) search for similar documents with optional filtering.
	 * Uses the search embed index by default.
	 */
	async semanticSearch(
		query: string,
		topK: number,
		threshold?: number,
		filter?: SearchFilter,
	): Promise<VectorSearchResult[]> {
		const isReady = await this.ensureIndex();
		if (!isReady) return [];

		const data = getData();
		const indexId = data.searchEmbedIndex;
		if (!indexId) return [];

		const inst = this.instances.get(indexId);
		if (!inst) return [];

		const model = this.getModelForInstance(inst);
		if (!model) return [];

		const embeddings = this.getEmbeddingsForInstance(inst, model);
		if (!embeddings) return [];

		try {
			const maxContentLength = await this.getMaxEmbeddingContentLength(inst, model);
			if (query.length > maxContentLength) {
				Logger.warn(
					`[VectorStore] Query too large for embedding model (${query.length} chars > ${maxContentLength} chars)`,
				);
				return [];
			}

			const queryVector = await embeddings.embedQuery(query);
			if (!queryVector || queryVector.length === 0) {
				Logger.error("[VectorStore] embedQuery returned empty result for search query");
				return [];
			}
			const queryVectorTyped = new Float32Array(queryVector);

			const hasFilters = filter?.pathPrefixes?.length || filter?.tags?.length;
			const searchTopK = hasFilters ? topK * 3 : topK;

			const results = await inst.store.search(queryVectorTyped, searchTopK, threshold);

			const { metadataCache } = this.plugin.app;
			const filteredResults: VectorSearchResult[] = [];

			for (const r of results) {
				if (filter?.pathPrefixes?.length) {
					const matchesPath = filter.pathPrefixes.some((prefix) => matchesPathPrefix(r.doc.path, prefix));
					if (!matchesPath) continue;
				}

				const file = this.plugin.app.vault.getAbstractFileByPath(r.doc.path);
				const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;
				const docTags = cache ? (getAllTags(cache) ?? []) : [];

				if (filter?.tags?.length) {
					const normalizedFilterTags = filter.tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
					const normalizedDocTags = new Set(docTags.map((t) => (t.startsWith("#") ? t : `#${t}`)));

					if (filter.requireAllTags) {
						if (!normalizedFilterTags.every((tag) => normalizedDocTags.has(tag))) continue;
					} else if (!normalizedFilterTags.some((tag) => normalizedDocTags.has(tag))) {
						continue;
					}
				}

				filteredResults.push({
					path: r.doc.path,
					name: r.doc.path.replace(/.*\//, "").replace(/\.md$/, ""),
					frontmatter: cache?.frontmatter,
					tags: docTags,
					matchBadges: ["semantic"],
					score: r.score,
				});

				if (filteredResults.length >= topK) break;
			}

			return filteredResults;
		} catch (error) {
			Logger.error("[VectorStore] Search failed:", error);
			return [];
		}
	}

	/**
	 * Schedule a save to file with debounce for a specific instance.
	 */
	private scheduleInstanceSave(inst: IndexInstance): void {
		inst.syncManager.scheduleSave(async () => {
			const docs = await inst.store.getAllSerialized();
			return FileSyncManager.createIndex(docs, inst.currentProviderId ?? "", inst.currentModelId ?? "");
		});
	}

	/**
	 * Immediately save a specific instance to file.
	 */
	private async saveInstanceToFile(inst: IndexInstance): Promise<void> {
		const docs = await inst.store.getAllSerialized();
		const metadata = await inst.store.getMetadata();
		const index = FileSyncManager.createIndex(
			docs,
			inst.currentProviderId ?? "",
			inst.currentModelId ?? "",
			metadata?.lastUpdated,
		);
		await inst.syncManager.saveToFile(index);
	}

	/**
	 * Simple hash function for content change detection.
	 */
	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = (hash * 33) ^ (content.codePointAt(i) ?? 0);
		}
		return (hash >>> 0).toString(16);
	}

	/**
	 * Get all document vectors for the graph index.
	 */
	async getAllDocumentVectors(indexId?: string): Promise<DocumentVector[]> {
		const data = getData();
		const resolvedId = indexId ?? data.graphEmbedIndex;
		if (!resolvedId) return [];

		const inst = await this.getOrCreateInstance(resolvedId);
		return inst.store.getAll();
	}

	/**
	 * Get the current index stats for a specific index or the search index.
	 */
	async getStats(indexId?: string): Promise<{
		documentCount: number;
		providerId: string | null;
		modelId: string | null;
		isReady: boolean;
	}> {
		const data = getData();
		const resolvedId = indexId ?? data.searchEmbedIndex;

		if (!resolvedId) {
			return {
				documentCount: 0,
				providerId: null,
				modelId: null,
				isReady: false,
			};
		}

		const inst = await this.getOrCreateInstance(resolvedId);

		const count = await inst.store.count();
		const metadata = await inst.store.getMetadata();
		const model = this.getModelForInstance(inst);
		const isReady = this.isInitialized && model !== null;

		return {
			documentCount: count,
			providerId: metadata?.providerId ?? inst.currentProviderId,
			modelId: metadata?.modelId ?? inst.currentModelId,
			isReady,
		};
	}

	/**
	 * Get the storage size (in bytes) for a specific index's msgpack file.
	 * Returns 0 if the file doesn't exist.
	 */
	async getStorageSize(indexId: string): Promise<number> {
		const filePath = `${this.configDir}/plugins/${this.plugin.manifest.id}/data/${getIndexFilePath(indexId)}`;
		try {
			const stat = await this.plugin.app.vault.adapter.stat(filePath);
			return stat?.size ?? 0;
		} catch {
			return 0;
		}
	}

	/**
	 * Get progress for a specific index.
	 */
	getProgress(indexId?: string): IndexingProgress {
		if (!indexId) {
			const data = getData();
			indexId = data.searchEmbedIndex ?? undefined;
		}
		if (!indexId) {
			return { isIndexing: false, total: 0, indexed: 0, skipped: 0, currentFile: null, percentage: 0 };
		}
		const inst = this.instances.get(indexId);
		if (!inst) {
			return { isIndexing: false, total: 0, indexed: 0, skipped: 0, currentFile: null, percentage: 0 };
		}
		return { ...inst.progress };
	}

	/**
	 * Get the indexing report for a specific index.
	 * If no report exists from the last build, generates one on-demand
	 * by comparing the current index against all vault files.
	 */
	async getReport(indexId?: string): Promise<IndexingReport | null> {
		const data = getData();
		const resolvedId = indexId ?? data.searchEmbedIndex;
		if (!resolvedId) return null;

		const inst = this.instances.get(resolvedId);
		if (!inst) return null;

		// Return cached report if available
		if (inst.report) return inst.report;

		// Generate report on-demand from current state
		return this.generateReport(inst);
	}

	/**
	 * Generate an indexing report by comparing the current index state
	 * against all vault files, classifying each by its status.
	 */
	private async generateReport(inst: IndexInstance): Promise<IndexingReport> {
		const { vault } = this.plugin.app;
		const allFiles = vault.getMarkdownFiles();
		const model = this.getModelForInstance(inst);
		const provider = model?.provider;

		const indexedDocs = await inst.store.getAll();
		const indexedPaths = new Set(indexedDocs.map((d) => d.path));

		const indexedFiles: string[] = [...indexedPaths];
		const skippedFiles: SkippedFile[] = [];

		for (const file of allFiles) {
			if (indexedPaths.has(file.path)) continue;

			const reason = this.getFileSkipReason(file, provider);
			if (reason) {
				skippedFiles.push({ path: file.path, reason });
			} else {
				// File passed filters but isn't indexed yet
				skippedFiles.push({ path: file.path, reason: "not-indexed" });
			}
		}

		const report: IndexingReport = { indexedFiles, skippedFiles, timestamp: Date.now() };
		inst.report = report;
		return report;
	}

	/**
	 * Check if indexing is in progress for any instance.
	 */
	get isIndexing(): boolean {
		for (const inst of this.instances.values()) {
			if (inst.isIndexing) return true;
		}
		return false;
	}

	/**
	 * Subscribe to progress updates for a specific index.
	 */
	onProgress(callback: (progress: IndexingProgress) => void, indexId?: string): () => void {
		if (!indexId) {
			const data = getData();
			indexId = data.searchEmbedIndex ?? undefined;
		}
		if (!indexId) {
			callback({ isIndexing: false, total: 0, indexed: 0, skipped: 0, currentFile: null, percentage: 0 });
			return () => {};
		}

		// Register at service level so subscriptions survive instance recreation
		if (!this.progressListeners.has(indexId)) {
			this.progressListeners.set(indexId, new Set());
		}
		this.progressListeners.get(indexId)!.add(callback);

		// Send initial progress from existing instance if available
		const inst = this.instances.get(indexId);
		callback(
			inst
				? { ...inst.progress }
				: { isIndexing: false, total: 0, indexed: 0, skipped: 0, currentFile: null, percentage: 0 },
		);

		return () => {
			const listeners = this.progressListeners.get(indexId);
			if (listeners) {
				listeners.delete(callback);
				if (listeners.size === 0) this.progressListeners.delete(indexId);
			}
		};
	}

	/**
	 * Update progress state for a specific instance and notify listeners.
	 */
	private updateInstanceProgress(inst: IndexInstance, partial: Partial<IndexingProgress>): void {
		Object.assign(inst.progress, partial);
		if (inst.progress.total > 0) {
			inst.progress.percentage = Math.round((inst.progress.indexed / inst.progress.total) * 100);
		}
		const progress = { ...inst.progress };
		const listeners = this.progressListeners.get(inst.indexId);
		if (listeners) {
			for (const listener of listeners) {
				listener(progress);
			}
		}
	}

	/**
	 * Update the cached document count in pluginData after a file event.
	 */
	private async notifyStatsChanged(inst: IndexInstance): Promise<void> {
		const count = await inst.store.count();
		getData().updateEmbeddingIndexStats(inst.indexId, { documentCount: count });
	}

	/**
	 * Cancel ongoing indexing for a specific index.
	 */
	cancelIndexing(indexId: string): void {
		const inst = this.instances.get(indexId);
		if (inst?.abortController) {
			inst.abortController.abort();
			new Notice("Cancelling indexing… will stop after the current embedding finishes.");
		}
	}

	/**
	 * Clear and rebuild a specific index.
	 */
	async rebuildIndex(indexId?: string): Promise<void> {
		const data = getData();
		const resolvedId = indexId ?? data.searchEmbedIndex;
		if (!resolvedId) return;

		const inst = await this.getOrCreateInstance(resolvedId);
		await inst.store.clear();
		await this.ensureIndex(resolvedId);
	}

	/**
	 * Delete an index completely: clear IndexedDB, delete msgpack file, remove instance.
	 */
	async deleteIndex(indexId: string): Promise<void> {
		const inst = this.instances.get(indexId);
		if (inst) {
			await inst.syncManager.flush();
			await inst.store.clear();
			await inst.store.close();
			this.instances.delete(indexId);
		}

		// Delete IndexedDB databases (HNSW + HNSW internal index)
		const hnswDbName = getDbName("s2b-hnsw", this.vaultId, indexId);
		try {
			indexedDB.deleteDatabase(hnswDbName);
			indexedDB.deleteDatabase(`${hnswDbName}-hnsw-index`);
		} catch (error) {
			Logger.error(`[VectorStore] Failed to delete IndexedDB databases for ${indexId}:`, error);
		}

		// Delete the index directory (contains msgpack file)
		const dataDir = `${this.configDir}/plugins/${this.plugin.manifest.id}/data`;
		const indexFilePath = getIndexFilePath(indexId);
		const indexDir = indexFilePath.replace(/\/[^/]+$/, "");
		const dirPath = `${dataDir}/${indexDir}`;
		try {
			if (await this.plugin.app.vault.adapter.exists(dirPath)) {
				await this.plugin.app.vault.adapter.rmdir(dirPath, true);
			}
		} catch (error) {
			Logger.error(`[VectorStore] Failed to delete index directory for ${indexId}:`, error);
		}

		// Remove from plugin data
		getData().removeEmbeddingIndex(indexId);

		Logger.log(`[VectorStore] Deleted index ${indexId}`);
	}

	/**
	 * Cleanup and save state for all instances.
	 */
	async cleanup(): Promise<void> {
		try {
			for (const timer of this.modifyTimers.values()) clearTimeout(timer);
			this.modifyTimers.clear();
			// Wait for any in-progress initialization before cleaning up
			if (this.initPromise) {
				await this.initPromise.catch(() => {});
			}
			if (this.backgroundSnapshotSaves.size > 0) {
				await Promise.allSettled(this.backgroundSnapshotSaves.values());
			}
			for (const inst of this.instances.values()) {
				await inst.syncManager.flush();
				await inst.store.close();
			}
			this.instances.clear();

			Logger.log("[VectorStore] Cleanup complete");
		} catch (error) {
			Logger.error("[VectorStore] Cleanup failed:", error);
		}

		instance = null;
		pendingInstance = null;
	}
}
