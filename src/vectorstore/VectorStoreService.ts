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
import { createVectorStore } from "./index";
import { FileSyncManager } from "./FileSyncManager";
import { MiniSearchService, type LexicalSearchResult } from "./MiniSearchService";
import {
	DEXIE_DB_NAME,
	INDEX_FILE_PATH,
	INDEX_VERSION,
	getDbName,
	getIndexFilePath,
	type DefaultEmbedModel,
	type DocumentVector,
	type IndexingProgress,
	type SearchFilter,
	type VectorSearchResult,
	type VectorStore,
	type VectorStoreBackend,
} from "./types";
import { cosineSimilarity, toFloat32Array } from "./similarity";
import { Logger } from "../utils/logging";

/** Default max input tokens for embedding models when metadata is unavailable */
const DEFAULT_EMBED_MAX_INPUT_TOKENS = 8191;

/** Approximate chars per token for rough estimation */
const CHARS_PER_TOKEN = 4;

/**
 * Batch sizes for embedding providers.
 * OpenAI supports up to 2048 inputs per request.
 * Ollama processes sequentially but LangChain handles concurrency.
 * Smaller batches = more frequent progress updates.
 */
const BATCH_SIZE_OPENAI = 100;
const BATCH_SIZE_OLLAMA = 1; // Sequential for local models — gives per-file progress updates
const BATCH_SIZE_DEFAULT = 50;

let instance: VectorStoreService | null = null;

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
 * Per-index state container. Each embedding model gets its own instance
 * with separate storage, sync manager, and progress tracking.
 */
interface IndexInstance {
	indexId: string;
	store: VectorStore;
	syncManager: FileSyncManager;
	miniSearch: MiniSearchService;
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
}

/**
 * Main service for embedding-based vector search.
 * Manages multiple indexes, one per embedding model.
 */
export class VectorStoreService {
	private plugin: SecondBrainPlugin;
	private instances: Map<string, IndexInstance> = new Map();
	private progressListeners = new Map<string, Set<(progress: IndexingProgress) => void>>();
	private isInitialized = false;
	private vaultId: string;
	private backend: VectorStoreBackend;
	private configDir: string;

	// Legacy instance for backward compatibility during migration
	private legacyInstance: IndexInstance | null = null;

	private constructor(plugin: SecondBrainPlugin) {
		this.plugin = plugin;
		this.vaultId = (plugin.app as unknown as { appId: string }).appId;
		this.backend = getData()?.vectorStoreBackend ?? "hnsw";
		const vault = plugin.app.vault as { configDir?: string };
		this.configDir = vault.configDir || ".obsidian";
		Logger.log(`[VectorStore] Using ${this.backend} backend`);
	}

	/**
	 * Create an IndexInstance for the given index ID.
	 */
	private createInstance(indexId: string): IndexInstance {
		const store = createVectorStore(this.backend, this.vaultId, indexId);
		const filePath = `${this.configDir}/plugins/${this.plugin.manifest.id}/data/${getIndexFilePath(indexId)}`;
		const syncManager = new FileSyncManager(this.plugin.app.vault.adapter, filePath);
		const miniSearch = new MiniSearchService(this.vaultId, indexId);

		return {
			indexId,
			store,
			syncManager,
			miniSearch,
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
		};
	}

	/**
	 * Create a legacy IndexInstance (no indexId suffix) for migration.
	 */
	private createLegacyInstance(): IndexInstance {
		const store = createVectorStore(this.backend, this.vaultId);
		const filePath = `${this.configDir}/plugins/${this.plugin.manifest.id}/data/${INDEX_FILE_PATH}`;
		const syncManager = new FileSyncManager(this.plugin.app.vault.adapter, filePath);
		const miniSearch = new MiniSearchService(this.vaultId);

		return {
			indexId: "__legacy__",
			store,
			syncManager,
			miniSearch,
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

		instance = new VectorStoreService(plugin);
		await instance.init();
		return instance;
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
				// Try to migrate from legacy storage for each index
				for (const indexId of indexIds) {
					await this.initializeInstance(indexId);
				}
			} else if (data.defaultEmbedModel) {
				// Legacy: no multi-index config yet, but has old defaultEmbedModel
				// This handles the case where migration in createData hasn't run yet
				const { provider, model } = data.defaultEmbedModel;
				const indexId = `${provider}:${model}`;
				await this.initializeInstance(indexId);
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

	/**
	 * Initialize a single index instance: open databases, load from file.
	 */
	private async initializeInstance(indexId: string): Promise<IndexInstance> {
		// Return existing if already open
		const existing = this.instances.get(indexId);
		if (existing) return existing;

		const inst = this.createInstance(indexId);

		// Open databases
		await inst.store.open();
		await inst.miniSearch.open();
		await inst.miniSearch.loadFromStorage();

		// Try to load from new per-index file first
		let serialized = await inst.syncManager.loadFromFile();

		// If no per-index file, try legacy file path for migration
		if (!serialized && !this.legacyInstance) {
			this.legacyInstance = this.createLegacyInstance();
			const legacySerialized = await this.legacyInstance.syncManager.loadFromFile();
			if (legacySerialized) {
				const [provider = "", ...modelParts] = indexId.split(":");
				const model = modelParts.join(":");
				const modelMatches = legacySerialized.providerId === provider && legacySerialized.modelId === model;
				if (modelMatches) {
					serialized = legacySerialized;
					Logger.log(`[VectorStore] Migrating legacy index to ${indexId}`);
				}
			}
		}

		if (serialized) {
			const [provider = "", ...modelParts] = indexId.split(":");
			const model = modelParts.join(":");
			const modelMatches = serialized.providerId === provider && serialized.modelId === model;

			if (modelMatches) {
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

				Logger.log(`[VectorStore] Loaded ${docs.length} documents for index ${indexId}`);

				// Save to new per-index location (migration)
				await this.saveInstanceToFile(inst);

				// Validate index against vault after workspace is ready
				this.plugin.app.workspace.onLayoutReady(() => {
					this.validateIndexOnStartup(inst);
				});
			} else {
				Logger.log(`[VectorStore] Model mismatch for ${indexId}, index will be rebuilt on next use`);
				await inst.store.clear();
			}
		}

		this.instances.set(indexId, inst);
		return inst;
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

	private async getEmbeddingMaxInputTokens(
		inst: IndexInstance,
		defaultModel: DefaultEmbedModel | null,
	): Promise<number> {
		if (!defaultModel) {
			return DEFAULT_EMBED_MAX_INPUT_TOKENS;
		}

		if (
			inst.maxInputTokensCache &&
			inst.maxInputTokensCache.provider === defaultModel.provider &&
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
		const vaultFiles = allVaultFiles.filter((file) => this.shouldIndexFile(file));

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
			return;
		}

		Logger.log(
			`[VectorStore] ${inst.indexId}: ${missingFiles.length} missing, ${staleFiles.length} stale, ${orphanedPaths.length} orphaned`,
		);

		if (orphanedPaths.length > 0) {
			for (const path of orphanedPaths) {
				await inst.store.remove(path);
			}
			Logger.log(`[VectorStore] Removed ${orphanedPaths.length} orphaned entries`);
		}

		const filesToIndex = [...missingFiles, ...staleFiles];
		if (filesToIndex.length > 0) {
			const batchSize = this.getBatchSize(defaultModel.provider);
			let indexed = 0;
			const showNotice = filesToIndex.length > 5;
			let notice: Notice | null = null;
			if (showNotice) {
				notice = new Notice(`Updating index: 0/${filesToIndex.length}`, 0);
			}

			this.updateInstanceProgress(inst, {
				isIndexing: true,
				total: filesToIndex.length,
				indexed: 0,
				skipped: 0,
				currentFile: "Reading files...",
				percentage: 0,
			});
			inst.abortController = new AbortController();

			interface FileEntry {
				file: TFile;
				content: string;
				contentWithTitle: string;
			}
			const validFiles: FileEntry[] = [];
			const maxContentLength = await this.getMaxEmbeddingContentLength(inst, defaultModel);

			for (const file of filesToIndex) {
				try {
					const content = await vault.cachedRead(file);
					if (content.length <= maxContentLength) {
						const contentWithTitle = `# ${file.basename}\n\n${content}`;
						validFiles.push({ file, content, contentWithTitle });
					} else {
						this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
					}
				} catch (error) {
					Logger.error(`[VectorStore] Failed to read ${file.path}:`, error);
					this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
				}
			}

			this.updateInstanceProgress(inst, { total: validFiles.length });

			for (let i = 0; i < validFiles.length; i += batchSize) {
				if (inst.abortController?.signal.aborted) {
					Logger.log(`[VectorStore] Validation indexing cancelled for ${inst.indexId}`);
					break;
				}

				const batch = validFiles.slice(i, i + batchSize);
				const batchEnd = Math.min(i + batchSize, validFiles.length);

				this.updateInstanceProgress(inst, {
					currentFile:
						batch.length === 1 ? batch[0].file.path : `Embedding batch ${Math.floor(i / batchSize) + 1}...`,
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
						inst.miniSearch.addDocument(entry.file.path, entry.file.basename, entry.content);
					}
					indexed += batch.length;
					this.updateInstanceProgress(inst, { indexed: batchEnd });
					if (notice) notice.setMessage(`Updating index: ${indexed}/${filesToIndex.length}`);
				} catch (error) {
					Logger.error("[VectorStore] Batch validation indexing failed:", error);
					for (const entry of batch) {
						try {
							const vector = await embeddings.embedQuery(entry.contentWithTitle);
							if (!vector || vector.length === 0) {
								Logger.error(`[VectorStore] embedQuery returned empty result for ${entry.file.path}`);
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
							inst.miniSearch.addDocument(entry.file.path, entry.file.basename, entry.content);
							indexed++;
							this.updateInstanceProgress(inst, { indexed: inst.progress.indexed + 1 });
						} catch (entryError) {
							Logger.error(`[VectorStore] Failed to index ${entry.file.path}:`, entryError);
							this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
						}
					}
					if (notice) notice.setMessage(`Updating index: ${indexed}/${filesToIndex.length}`);
				}
			}

			if (notice) {
				const cancelled = inst.abortController?.signal.aborted;
				notice.setMessage(
					cancelled ? `Indexing cancelled (${indexed} files updated)` : `✓ Index updated: ${indexed} files`,
				);
				setTimeout(() => notice.hide(), 3000);
			}

			inst.abortController = null;
			this.updateInstanceProgress(inst, { isIndexing: false, currentFile: null });
			Logger.log(`[VectorStore] Indexed ${indexed} missing/stale files for ${inst.indexId}`);
		}

		await this.saveInstanceToFile(inst);

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
			vault.on("modify", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileModify(file);
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
	 * Handle file modification — forward to active instances only.
	 * Inactive instances are marked for re-validation on next use.
	 */
	private async handleFileModify(file: TFile): Promise<void> {
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
			inst.miniSearch.removeDocument(file.path);
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
			inst.miniSearch.removeDocument(oldPath);
			if (inst.embeddings) {
				await this.indexDocumentForInstance(inst, file);
			}
			this.notifyStatsChanged(inst);
		}
	}

	/**
	 * Get the configured default embedding model.
	 * @deprecated Use getModelForInstance or getSearchEmbedModel/getGraphEmbedModel instead.
	 */
	private getDefaultEmbedModel(): DefaultEmbedModel | null {
		const data = getData();
		return data.defaultEmbedModel;
	}

	/**
	 * Get or create the embeddings instance for the search index.
	 * @deprecated Use getEmbeddingsForInstance instead.
	 */
	private getEmbeddings(): EmbeddingsInterface | null {
		const data = getData();
		const indexId = data.searchEmbedIndex;
		if (!indexId) {
			const defaultModel = this.getDefaultEmbedModel();
			if (!defaultModel) return null;
			// Legacy path
			const inst = this.instances.values().next().value;
			if (!inst) return null;
			return this.getEmbeddingsForInstance(inst, defaultModel);
		}
		const inst = this.instances.get(indexId);
		if (!inst) return null;
		const model = this.getModelForInstance(inst);
		if (!model) return null;
		return this.getEmbeddingsForInstance(inst, model);
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
			new Notice("Failed to initialize embedding model. Check your settings.");
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
	 * Get the batch size for the given provider.
	 */
	private getBatchSize(providerId: string): number {
		switch (providerId) {
			case "openai":
			case "openrouter":
				return BATCH_SIZE_OPENAI;
			case "ollama":
				return BATCH_SIZE_OLLAMA;
			default:
				return BATCH_SIZE_DEFAULT;
		}
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
		const batchSize = this.getBatchSize(model.provider);
		const files = allFiles.filter((file) => this.shouldIndexFile(file));
		const excludedCount = allFiles.length - files.length;

		this.updateInstanceProgress(inst, {
			isIndexing: true,
			total: files.length,
			indexed: 0,
			skipped: excludedCount,
			currentFile: null,
			percentage: 0,
		});

		const notice = new Notice("", 0);
		this.updateNotice(notice, inst.progress);

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
						this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
						continue;
					}
					const contentWithTitle = `# ${file.basename}\n\n${content}`;
					validFiles.push({ file, content, contentWithTitle });
				} catch (error) {
					Logger.error(`[VectorStore] Failed to read ${file.path}:`, error);
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
						this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + batch.length });
						this.updateNotice(notice, inst.progress);
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
						inst.miniSearch.addDocument(entry.file.path, entry.file.basename, entry.content);
					}

					this.updateInstanceProgress(inst, { indexed: batchEnd });
					this.updateNotice(notice, inst.progress);
				} catch (error) {
					Logger.warn(
						`[VectorStore] Batch ${Math.floor(i / batchSize) + 1} failed, falling back to sequential:`,
						error,
					);

					for (const entry of batch) {
						try {
							const vector = await embeddings.embedQuery(entry.contentWithTitle);
							if (!vector || vector.length === 0) {
								Logger.error(`[VectorStore] embedQuery returned empty result for ${entry.file.path}`);
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
							inst.miniSearch.addDocument(entry.file.path, entry.file.basename, entry.content);
							this.updateInstanceProgress(inst, { indexed: inst.progress.indexed + 1 });
						} catch (entryError) {
							Logger.error(`[VectorStore] Failed to index ${entry.file.path}:`, entryError);
							this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
						}
					}
					this.updateNotice(notice, inst.progress);
				}
			}

			await this.saveInstanceToFile(inst);

			// Update cached stats in plugin data
			const data = getData();
			data.updateEmbeddingIndexStats(inst.indexId, {
				lastBuiltAt: Date.now(),
				documentCount: inst.progress.indexed,
			});

			const { indexed, skipped } = inst.progress;
			const cancelled = inst.abortController?.signal.aborted;
			notice.setMessage(
				cancelled
					? `Indexing cancelled (${indexed} notes indexed so far)`
					: `✓ Indexed ${indexed} notes${skipped > 0 ? `, ${skipped} skipped` : ""}`,
			);
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

		const container = el.createDiv({ cls: "ssb-indexing-notice" });

		container.createDiv({
			cls: "ssb-indexing-status",
			text: `Indexing: ${indexed}/${total}${skippedText}`,
		});

		const progressContainer = container.createDiv({ cls: "ssb-indexing-progress" });
		progressContainer.style.cssText =
			"width: 100%; height: 6px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden; margin: 8px 0;";

		const progressFill = progressContainer.createDiv({ cls: "ssb-indexing-fill" });
		progressFill.style.cssText = `width: ${percentage}%; height: 100%; background: var(--interactive-accent); border-radius: 3px; transition: width 0.2s ease;`;

		container.createDiv({
			cls: "ssb-indexing-percent",
			text: `${percentage}%`,
		});
	}

	/**
	 * Check if a file should be indexed based on exclusion/inclusion settings.
	 */
	private shouldIndexFile(file: TFile): boolean {
		const pluginData = getData();
		const indexList = pluginData.indexList;
		const isExcluding = pluginData.isExcluding;

		const matchesPattern = indexList.some(
			(pattern) => file.path.startsWith(pattern) || file.path.includes(`/${pattern}`),
		);

		return isExcluding ? !matchesPattern : indexList.length === 0 || matchesPattern;
	}

	/**
	 * Index a single document for a specific instance.
	 */
	private async indexDocumentForInstance(inst: IndexInstance, file: TFile): Promise<void> {
		const model = this.getModelForInstance(inst);
		if (!model) return;
		const embeddings = this.getEmbeddingsForInstance(inst, model);
		if (!embeddings) return;

		if (!this.shouldIndexFile(file)) {
			Logger.log(`[VectorStore] Skipping ${file.path}: excluded by settings`);
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
			inst.miniSearch.addDocument(file.path, file.basename, content);
			this.scheduleInstanceSave(inst);

			Logger.log(`[VectorStore] Indexed: ${file.path} (${inst.indexId})`);
		} catch (error) {
			Logger.error(`[VectorStore] Failed to index ${file.path} (${inst.indexId}):`, error);
		}
	}

	/**
	 * Perform lexical (full-text) search using MiniSearch.
	 */
	async lexicalSearch(query: string, topK: number, filter?: SearchFilter): Promise<VectorSearchResult[]> {
		// For lexical search, use the search index's MiniSearch (or first available)
		const data = getData();
		const indexId = data.searchEmbedIndex;
		let miniSearch: MiniSearchService | null = null;

		if (indexId) {
			const inst = this.instances.get(indexId);
			if (inst) miniSearch = inst.miniSearch;
		}

		// Fall back to first instance
		if (!miniSearch) {
			const firstInst = this.instances.values().next().value;
			if (firstInst) miniSearch = firstInst.miniSearch;
		}

		if (!miniSearch) return [];

		const results = miniSearch.search(query, topK * (filter ? 3 : 1));
		return this.applyFilterToLexicalResults(results, topK, filter);
	}

	/**
	 * Browse all indexed documents with optional filtering.
	 */
	async browseDocuments(topK: number, filter?: SearchFilter): Promise<VectorSearchResult[]> {
		const data = getData();
		const indexId = data.searchEmbedIndex;
		let miniSearch: MiniSearchService | null = null;

		if (indexId) {
			const inst = this.instances.get(indexId);
			if (inst) miniSearch = inst.miniSearch;
		}

		if (!miniSearch) {
			const firstInst = this.instances.values().next().value;
			if (firstInst) miniSearch = firstInst.miniSearch;
		}

		if (!miniSearch) return [];

		const results = miniSearch.browse(topK * (filter ? 3 : 1));
		return this.applyFilterToLexicalResults(results, topK, filter);
	}

	/**
	 * Apply filters to lexical/browse results.
	 */
	private applyFilterToLexicalResults(
		results: LexicalSearchResult[],
		topK: number,
		filter?: SearchFilter,
	): VectorSearchResult[] {
		const { metadataCache } = this.plugin.app;
		const filteredResults: VectorSearchResult[] = [];

		for (const r of results) {
			if (filter?.pathPrefixes?.length) {
				const matchesPath = filter.pathPrefixes.some((prefix) => r.path.startsWith(prefix));
				if (!matchesPath) continue;
			}

			const file = this.plugin.app.vault.getAbstractFileByPath(r.path);
			const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;
			const docTags = cache ? (getAllTags(cache) ?? []) : [];

			if (filter?.tags?.length) {
				const normalizedFilterTags = filter.tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
				const normalizedDocTags = docTags.map((t) => (t.startsWith("#") ? t : `#${t}`));

				if (filter.requireAllTags) {
					if (!normalizedFilterTags.every((tag) => normalizedDocTags.includes(tag))) continue;
				} else {
					if (!normalizedFilterTags.some((tag) => normalizedDocTags.includes(tag))) continue;
				}
			}

			filteredResults.push({
				path: r.path,
				name: r.name,
				frontmatter: cache?.frontmatter,
				tags: docTags,
				score: r.score,
			});

			if (filteredResults.length >= topK) break;
		}

		return filteredResults;
	}

	/**
	 * Search for similar documents with optional filtering.
	 * Uses the search embed index by default.
	 */
	async search(
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
					const matchesPath = filter.pathPrefixes.some((prefix) => r.doc.path.startsWith(prefix));
					if (!matchesPath) continue;
				}

				const file = this.plugin.app.vault.getAbstractFileByPath(r.doc.path);
				const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;
				const docTags = cache ? (getAllTags(cache) ?? []) : [];

				if (filter?.tags?.length) {
					const normalizedFilterTags = filter.tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
					const normalizedDocTags = docTags.map((t) => (t.startsWith("#") ? t : `#${t}`));

					if (filter.requireAllTags) {
						if (!normalizedFilterTags.every((tag) => normalizedDocTags.includes(tag))) continue;
					} else {
						if (!normalizedFilterTags.some((tag) => normalizedDocTags.includes(tag))) continue;
					}
				}

				filteredResults.push({
					path: r.doc.path,
					name: r.doc.path.replace(/.*\//, "").replace(/\.md$/, ""),
					frontmatter: cache?.frontmatter,
					tags: docTags,
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
		const index = FileSyncManager.createIndex(docs, inst.currentProviderId ?? "", inst.currentModelId ?? "");
		await inst.syncManager.saveToFile(index);
	}

	/**
	 * Simple hash function for content change detection.
	 */
	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = (hash * 33) ^ content.charCodeAt(i);
		}
		return (hash >>> 0).toString(16);
	}

	/**
	 * Get all document vectors for the graph index.
	 */
	async getAllDocumentVectors(indexId?: string): Promise<DocumentVector[]> {
		const data = getData();
		const resolvedId = indexId ?? data.graphEmbedIndex ?? data.searchEmbedIndex;
		if (!resolvedId) return [];

		const inst = await this.getOrCreateInstance(resolvedId);
		return inst.store.getAll();
	}

	/**
	 * Get the current index stats for a specific index or the search index.
	 */
	async getStats(indexId?: string): Promise<{
		documentCount: number;
		lexicalDocumentCount: number;
		providerId: string | null;
		modelId: string | null;
		isReady: boolean;
	}> {
		const data = getData();
		const resolvedId = indexId ?? data.searchEmbedIndex;

		if (!resolvedId) {
			return {
				documentCount: 0,
				lexicalDocumentCount: 0,
				providerId: null,
				modelId: null,
				isReady: false,
			};
		}

		const inst = await this.getOrCreateInstance(resolvedId);

		const count = await inst.store.count();
		const lexicalCount = inst.miniSearch.documentCount;
		const metadata = await inst.store.getMetadata();
		const model = this.getModelForInstance(inst);
		const isReady = this.isInitialized && model !== null;

		return {
			documentCount: count,
			lexicalDocumentCount: lexicalCount,
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
			await inst.miniSearch.flush();
			await inst.store.clear();
			await inst.store.close();
			inst.miniSearch.close();
			this.instances.delete(indexId);
		}

		// Delete IndexedDB databases (vector store + MiniSearch)
		const vectorDbName = getDbName(this.backend === "hnsw" ? "ssb-hnsw" : DEXIE_DB_NAME, this.vaultId, indexId);
		const miniSearchDbName = getDbName("ssb-minisearch", this.vaultId, indexId);
		try {
			indexedDB.deleteDatabase(vectorDbName);
			indexedDB.deleteDatabase(miniSearchDbName);
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
			for (const inst of this.instances.values()) {
				await inst.syncManager.flush();
				await inst.miniSearch.flush();
				await inst.store.close();
				inst.miniSearch.close();
			}
			this.instances.clear();
			Logger.log("[VectorStore] Cleanup complete");
		} catch (error) {
			Logger.error("[VectorStore] Cleanup failed:", error);
		}

		instance = null;
	}
}
