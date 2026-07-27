/**
 * Vector Store Service
 *
 * Main orchestration service for the embedding-based vector store.
 * Manages multiple indexes (one per embedding model), indexing, search,
 * and export/import via native file dialogs.
 */

import { Notice, TFile, getAllTags } from "obsidian";
import { encode, decode } from "@msgpack/msgpack";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type SecondBrainPlugin from "../main";
import { hydrateEmbeddingModel } from "../lib/modelMetadataNormalizer";
import { fetchModelsDevData } from "../providers/modelsDevApi";
import { getOllamaModelsCache } from "../providers/ollamaModels";
import { fetchOpenRouterModels } from "../providers/openrouterModels";
import { getData } from "../stores/dataStore.svelte";
import { getRegistry } from "../providers/registry";
import { getProviderDefinition } from "../providers/index";
import { showSettingsLinkNotice } from "../utils/settingsNotice";
import { getDefaultEmbeddingBatchSize, normalizeEmbeddingBatchSize } from "./batchSize";
import { createVectorStore } from "./index";
import {
	INDEX_VERSION,
	getDbName,
	makeChunkId,
	sanitizeIndexId,
	type DefaultEmbedModel,
	type DocumentVector,
	type IndexMetadata,
	type IndexingProgress,
	type IndexingReport,
	type SearchResult,
	type SearchFilter,
	type SerializedIndex,
	type SkipReason,
	type SkippedFile,
	type VectorSearchResult,
	type VectorStore,
} from "./types";
import { Logger } from "../utils/logging";
import { StartupProfiler } from "../utils/startupProfiler";
import { getIndexableVaultFiles, isIndexableFile, readIndexableContent } from "../utils/fileFiltering";
import { matchesPathPrefix } from "../utils/pathUtils";
import { chunkText } from "../utils/chunkText";
import { toFloat32Array } from "./similarity";

// ── Electron dialog helpers (Obsidian desktop) ────────────────────────

interface DialogFilter {
	name: string;
	extensions: string[];
}

/**
 * Require a Node.js built-in module from Electron's renderer process.
 * Works in Obsidian desktop where `require` is exposed on `window`.
 */
function requireNodeModule<T>(id: string): T {
	const globalWithRequire = globalThis as typeof globalThis & {
		require?: (id: string) => unknown;
	};
	if (typeof globalWithRequire.require !== "function") {
		throw new Error(`Node module "${id}" is not available in this environment.`);
	}
	return globalWithRequire.require(id) as T;
}

/**
 * Show a native "Save As" dialog and return the chosen file path, or null if
 * the user cancelled.
 */
function showSaveDialog(options: {
	title?: string;
	defaultPath?: string;
	filters?: DialogFilter[];
}): string | null {
	const { remote } = requireNodeModule<{
		remote: {
			dialog: {
				showSaveDialogSync: (options: {
					title?: string;
					defaultPath?: string;
					filters?: DialogFilter[];
				}) => string | undefined;
			};
		};
	}>("electron");
	const result = remote.dialog.showSaveDialogSync({
		title: options.title,
		defaultPath: options.defaultPath,
		filters: options.filters,
	});
	return result ?? null;
}

/**
 * Show a native "Open File" dialog and return the chosen file paths, or null
 * if the user cancelled.
 */
function showOpenDialog(options: {
	title?: string;
	filters?: DialogFilter[];
	properties?: string[];
}): string[] | null {
	const { remote } = requireNodeModule<{
		remote: {
			dialog: {
				showOpenDialogSync: (options: {
					title?: string;
					filters?: DialogFilter[];
					properties?: string[];
				}) => string[] | undefined;
			};
		};
	}>("electron");
	const result = remote.dialog.showOpenDialogSync({
		title: options.title,
		filters: options.filters,
		properties: options.properties,
	});
	return result ?? null;
}

/** Default max input tokens for embedding models when metadata is unavailable */
const DEFAULT_EMBED_MAX_INPUT_TOKENS = 8191;

/** Debounce delay before re-embedding a modified file (ms) */
const MODIFY_DEBOUNCE_MS = 5_000;

/** Approximate chars per token for rough estimation */
const CHARS_PER_TOKEN = 4;

/**
 * Over-fetch factor for semantic search. A large note is now stored as multiple
 * chunks, so several of a note's chunks can occupy adjacent result slots; we
 * request more raw neighbors than `topK` and dedup to distinct notes afterwards
 * so `topK` still yields `topK` distinct notes.
 */
const CHUNK_OVERFETCH = 4;

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
	embeddings: EmbeddingsInterface | null;
	currentProviderId: string | null;
	currentModelId: string | null;
	hasValidatedThisSession: boolean;
	isIndexing: boolean;
	progress: IndexingProgress;
	/** Timestamp (ms) when the current indexing run started, for ETA estimation */
	indexingStartedAt: number | null;
	/** `indexed` count when the current run started, so ETA measures only this run's rate */
	indexingStartCount: number;
	abortController: AbortController | null;
	maxInputTokensCache: {
		provider: string;
		model: string;
		maxInputTokens: number;
	} | null;
	report: IndexingReport | null;
}

/**
 * Format an estimated-time-remaining duration (in ms) as a short human string,
 * e.g. "45s", "3m", "1h 12m". Rounds up so the estimate never reads as "0s"
 * while work is still in flight.
 */
export function formatEta(ms: number): string {
	const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;

	const totalMinutes = Math.ceil(totalSeconds / 60);
	if (totalMinutes < 60) return `${totalMinutes}m`;

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
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
	private readonly progressListeners = new Map<string, Set<(progress: IndexingProgress) => void>>();
	private readonly modifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private isInitialized = false;
	private readonly vaultId: string;

	private constructor(plugin: SecondBrainPlugin) {
		this.plugin = plugin;
		this.vaultId = getData().vaultSlug;
	}

	/** Promise tracking initialization, awaited by cleanup to avoid closing mid-init. */
	private initPromise: Promise<void> | null = null;

	/**
	 * Create an IndexInstance for the given index ID.
	 */
	private createInstance(indexId: string): IndexInstance {
		const store = createVectorStore(this.vaultId, indexId);

		return {
			indexId,
			store,
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
				etaMs: null,
			},
			indexingStartedAt: null,
			indexingStartCount: 0,
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

			// Open IndexedDB — this is the sole persistence layer
			await StartupProfiler.measure(`vectorstore:open[${indexId}]`, () => inst.store.open());

			const [provider = "", ...modelParts] = indexId.split(":");
			const model = modelParts.join(":");

			const runtimeMeta = await inst.store.getMetadata();
			const versionCurrent = runtimeMeta !== null && runtimeMeta.version >= INDEX_VERSION;
			const runtimeMatches =
				runtimeMeta !== null &&
				runtimeMeta.documentCount > 0 &&
				runtimeMeta.providerId === provider &&
				runtimeMeta.modelId === model &&
				versionCurrent;

			if (runtimeMatches && runtimeMeta) {
				inst.currentProviderId = runtimeMeta.providerId;
				inst.currentModelId = runtimeMeta.modelId;

				Logger.log(
					`[VectorStore] Loaded index for ${indexId} from IDB (${runtimeMeta.documentCount} documents)`,
				);

				this.plugin.app.workspace.onLayoutReady(() => {
					this.validateIndexOnStartup(inst);
				});
			} else if (
				runtimeMeta &&
				(runtimeMeta.providerId !== provider || runtimeMeta.modelId !== model || !versionCurrent)
			) {
				const why = !versionCurrent
					? `schema v${runtimeMeta.version} < v${INDEX_VERSION} (pre-chunking)`
					: "model mismatch";
				Logger.log(`[VectorStore] Clearing index for ${indexId} (${why}), will rebuild on next use`);
				await inst.store.clear();
			}

			this.instances.set(indexId, inst);
			Logger.info(`[VectorStore] Init ${indexId}: ${Math.round(performance.now() - initStart)}ms`);
			return inst;
		})();

		this.initializingInstances.set(indexId, initPromise);
		try {
			return await initPromise;
		} finally {
			this.initializingInstances.delete(indexId);
		}
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

		if (!this.ensureProviderRegistered(model.provider)) {
			Logger.log(
				`[VectorStore] Provider "${model.provider}" not available for ${inst.indexId}, skipping validation`,
			);
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
		const allVaultFiles = getIndexableVaultFiles(vault);
		const vaultFiles = allVaultFiles.filter((file) => this.shouldIndexFile(file, defaultModel.provider));

		const indexedDocs = await inst.store.getAll();
		// A note may be stored as multiple chunk rows; collapse them to one entry
		// per path. All chunks of a note share the same mtime, so last-write-wins
		// is correct for missing/stale detection.
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

			// Pre-read files and split them into chunks before setting up
			// progress tracking so counts are accurate from the start. Large
			// notes are chunked (not skipped); each chunk is embedded separately.
			interface ChunkEntry {
				file: TFile;
				chunkIndex: number;
				chunkCount: number;
				checksum: string;
				embedText: string;
			}
			const validChunks: ChunkEntry[] = [];
			const maxContentLength = await this.getMaxEmbeddingContentLength(inst, defaultModel);
			const skippedReadError: string[] = [];
			let validFileCount = 0;

			for (const file of filesToIndex) {
				try {
					const content = await readIndexableContent(vault, file);
					const checksum = this.hashContent(content);
					const chunks = chunkText(content, file.basename, maxContentLength);
					for (const chunk of chunks) {
						validChunks.push({
							file,
							chunkIndex: chunk.chunkIndex,
							chunkCount: chunks.length,
							checksum,
							embedText: chunk.content,
						});
					}
					validFileCount++;
				} catch (error) {
					Logger.error(`[VectorStore] Failed to read ${file.path}:`, error);
					skippedReadError.push(file.basename);
				}
			}

			const preFilterSkipped = skippedReadError.length;

			Logger.log(
				`[VectorStore] ${inst.indexId}: pre-filter result: ${validFileCount} files (${validChunks.length} chunks), ${preFilterSkipped} skipped (maxContentLength=${maxContentLength})`,
			);

			if (preFilterSkipped > 0) {
				new Notice(
					`Skipped indexing ${preFilterSkipped} notes (unreadable: ${skippedReadError.join(", ")})`,
					8000,
				);
			}

			// If no files actually need indexing (all unreadable), skip entirely
			if (validChunks.length === 0) {
				Logger.log(
					`[VectorStore] ${inst.indexId}: all ${filesToIndex.length} pending files were skipped (unreadable)`,
				);
			} else {
				const pendingFileCount = filesToIndex.length;
				const { startingIndexedCount, totalCount } = summarizeValidationProgressCounts({
					eligibleFileCount: vaultFiles.length,
					pendingFileCount,
					validPendingFileCount: validFileCount,
				});
				let indexed = 0;
				// Progress is tracked in files (matching `total`), not chunks: a note is
				// counted once its final chunk is written, so a multi-chunk note advances
				// the bar by one, keeping `indexed <= total` and the ETA well-defined.
				const indexedValidationPaths = new Set<string>();
				const noteValidated = (path: string) => {
					if (indexedValidationPaths.has(path)) return;
					indexedValidationPaths.add(path);
					this.updateInstanceProgress(inst, {
						indexed: startingIndexedCount + indexedValidationPaths.size,
					});
				};
				const showNotice = validFileCount > 5;
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

				// A note may have been indexed previously (stale re-index) with a
				// different chunk count; drop its old chunks before writing new ones.
				const purgedPaths = new Set<string>();
				const purgeIfNeeded = async (entry: ChunkEntry) => {
					if (entry.chunkIndex === 0 && !purgedPaths.has(entry.file.path)) {
						await inst.store.remove(entry.file.path);
						purgedPaths.add(entry.file.path);
					}
				};

				for (let i = 0; i < validChunks.length; i += batchSize) {
					if (inst.abortController?.signal.aborted) {
						Logger.log(`[VectorStore] Validation indexing cancelled for ${inst.indexId}`);
						break;
					}

					const batch = validChunks.slice(i, i + batchSize);

					this.updateInstanceProgress(inst, {
						currentFile:
							batch.length === 1
								? batch[0].file.path
								: `Embedding batch ${Math.floor(i / batchSize) + 1}...`,
					});

					try {
						const texts = batch.map((entry) => entry.embedText);
						const vectors = await embeddings.embedDocuments(texts);
						// The run may have been aborted (e.g. index deleted) while the
						// embedding call was in flight; bail before writing to a store
						// that could now be closed.
						if (inst.abortController?.signal.aborted) break;
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
							await purgeIfNeeded(entry);
							const doc: DocumentVector = {
								id: makeChunkId(entry.file.path, entry.chunkIndex),
								path: entry.file.path,
								mtime: entry.file.stat.mtime,
								checksum: entry.checksum,
								chunkIndex: entry.chunkIndex,
								vector: new Float32Array(vectors[j]),
							};
							await inst.store.upsert(doc);
							if (entry.chunkIndex === entry.chunkCount - 1) noteValidated(entry.file.path);
						}
						indexed += batch.length;
						if (notice) this.updateNotice(notice, inst.progress);
					} catch (error) {
						Logger.error("[VectorStore] Batch validation indexing failed:", error);
						for (const entry of batch) {
							if (inst.abortController?.signal.aborted) break;
							try {
								const vector = await embeddings.embedQuery(entry.embedText);
								if (!vector || vector.length === 0) {
									Logger.error(
										`[VectorStore] embedQuery returned empty result for ${entry.file.path}`,
									);
									this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
									continue;
								}
								await purgeIfNeeded(entry);
								const doc: DocumentVector = {
									id: makeChunkId(entry.file.path, entry.chunkIndex),
									path: entry.file.path,
									mtime: entry.file.stat.mtime,
									checksum: entry.checksum,
									chunkIndex: entry.chunkIndex,
									vector: new Float32Array(vector),
								};
								await inst.store.upsert(doc);
								indexed++;
								if (entry.chunkIndex === entry.chunkCount - 1) noteValidated(entry.file.path);
							} catch (entryError) {
								Logger.error(`[VectorStore] Failed to index ${entry.file.path}:`, entryError);
								const reason = entryError instanceof Error ? entryError.message : String(entryError);
								new Notice(`Failed to embed ${entry.file.basename}: ${reason}`);
								this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
							}
						}
						if (notice) this.updateNotice(notice, inst.progress);
					}
				}

				if (notice) {
					const cancelled = inst.abortController?.signal.aborted;
					notice.setMessage(
						cancelled
							? `Indexing cancelled (${indexed} chunks updated)`
							: `✓ Index updated: ${indexed} chunks`,
					);
					setTimeout(() => notice.hide(), 3000);
				}

				inst.abortController = null;
				this.updateInstanceProgress(inst, { isIndexing: false, currentFile: null });
				Logger.log(`[VectorStore] Indexed ${indexed} chunks for ${inst.indexId}`);
			} // end else (validChunks.length > 0)
		}

		// Sync document count to pluginData for reactive UI updates. Skip when the
		// run was aborted (e.g. the index was deleted mid-build) since the store
		// may have been closed out from under us.
		if (!inst.abortController?.signal.aborted && this.instances.has(inst.indexId)) {
			const count = await inst.store.count();
			getData().updateEmbeddingIndexStats(inst.indexId, { documentCount: count });
		}

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
				if (file instanceof TFile && isIndexableFile(file)) {
					await this.handleFileCreate(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("modify", (file) => {
				if (file instanceof TFile && isIndexableFile(file)) {
					this.handleFileModify(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("delete", async (file) => {
				if (file instanceof TFile) {
					await this.handleFileDelete(file);
				}
			}),
		);

		this.plugin.registerEvent(
			vault.on("rename", async (file, oldPath) => {
				if (file instanceof TFile && isIndexableFile(file)) {
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
			}
			this.notifyStatsChanged(inst);
		}
	}

	/**
	 * Ensure a provider is registered in the runtime registry.
	 * VectorStoreService may need embeddings before the agent is initialized
	 * (which is the normal point of provider registration), so we register
	 * on demand here when needed.
	 */
	private ensureProviderRegistered(providerId: string): boolean {
		const registry = getRegistry();
		if (registry.has(providerId)) return true;

		const data = getData();
		const auth = data.getResolvedAuthState(providerId);
		if (!auth) return false;

		const def = getProviderDefinition(providerId, data.getAllProviderMeta());
		if (!def) return false;

		try {
			registry.register(providerId, def, auth);
			return true;
		} catch {
			return false;
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
			showSettingsLinkNotice(
				this.plugin.app,
				"No embedding model configured. Please set a default embedding model.",
				{
					tab: "search",
					linkText: "Open search settings",
				},
			);
			return false;
		}

		const inst = await this.getOrCreateInstance(resolvedId);
		const model = this.getModelForInstance(inst);
		if (!model) {
			showSettingsLinkNotice(this.plugin.app, "Invalid embedding index configuration.", {
				tab: "search",
				linkText: "Open search settings",
			});
			return false;
		}

		if (!this.ensureProviderRegistered(model.provider)) {
			showSettingsLinkNotice(this.plugin.app, `Provider "${model.provider}" is not configured.`, {
				tab: "general",
				linkText: "Open provider settings",
			});
			return false;
		}

		const embeddings = this.getEmbeddingsForInstance(inst, model);
		if (!embeddings) {
			showSettingsLinkNotice(this.plugin.app, "Failed to initialize embedding model.", {
				tab: "general",
				linkText: "Open provider settings",
			});
			return false;
		}

		// Rebuild if the model changed or the persisted index predates chunking.
		const meta = await inst.store.getMetadata();
		const modelChanged = meta && (meta.providerId !== model.provider || meta.modelId !== model.model);
		const versionStale = meta !== null && meta.version < INDEX_VERSION;

		if (modelChanged || versionStale) {
			Logger.log(
				`[VectorStore] Rebuilding index for ${resolvedId} (${versionStale ? `schema v${meta?.version} < v${INDEX_VERSION}` : "model changed"})`,
			);
			await inst.store.clear();
		}

		const count = await inst.store.count();
		if (count === 0 || modelChanged || versionStale) {
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
		const allFiles = getIndexableVaultFiles(vault);
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
			etaMs: null,
		});

		const notice = new Notice("", 0);
		this.updateNotice(notice, inst.progress);

		try {
			await inst.store.setMetadata(model.provider, model.model, INDEX_VERSION);

			this.updateInstanceProgress(inst, { currentFile: "Reading files..." });
			this.updateNotice(notice, inst.progress);

			interface ChunkEntry {
				file: TFile;
				chunkIndex: number;
				checksum: string;
				embedText: string;
			}

			const validChunks: ChunkEntry[] = [];
			let validFileCount = 0;
			const maxContentLength = await this.getMaxEmbeddingContentLength(inst, model);

			for (const file of files) {
				try {
					const content = await readIndexableContent(vault, file);
					const checksum = this.hashContent(content);
					const chunks = chunkText(content, file.basename, maxContentLength);
					for (const chunk of chunks) {
						validChunks.push({
							file,
							chunkIndex: chunk.chunkIndex,
							checksum,
							embedText: chunk.content,
						});
					}
					validFileCount++;
				} catch (error) {
					Logger.error(`[VectorStore] Failed to read ${file.path}:`, error);
					skippedFiles.push({ path: file.path, reason: "read-error" });
					this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
				}
			}

			// Progress is tracked per file; the store was cleared before this loop
			// so chunks can be inserted directly without purging prior versions.
			this.updateInstanceProgress(inst, { total: validFileCount });
			this.updateNotice(notice, inst.progress);
			const indexedPaths = new Set<string>();
			const noteIndexed = (path: string) => {
				if (!indexedPaths.has(path)) {
					indexedPaths.add(path);
					indexedFiles.push(path);
					this.updateInstanceProgress(inst, { indexed: indexedPaths.size });
				}
			};

			for (let i = 0; i < validChunks.length; i += batchSize) {
				if (inst.abortController?.signal.aborted) {
					Logger.log(`[VectorStore] Indexing cancelled for ${inst.indexId}`);
					break;
				}

				const batch = validChunks.slice(i, i + batchSize);

				this.updateInstanceProgress(inst, {
					currentFile:
						batch.length === 1 ? batch[0].file.path : `Embedding batch ${Math.floor(i / batchSize) + 1}...`,
				});
				this.updateNotice(notice, inst.progress);

				try {
					const texts = batch.map((entry) => entry.embedText);
					const vectors = await embeddings.embedDocuments(texts);
					// The run may have been aborted (e.g. index deleted) while the
					// embedding call was in flight; bail before writing to a store
					// that could now be closed.
					if (inst.abortController?.signal.aborted) break;
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
							id: makeChunkId(entry.file.path, entry.chunkIndex),
							path: entry.file.path,
							mtime: entry.file.stat.mtime,
							checksum: entry.checksum,
							chunkIndex: entry.chunkIndex,
							vector: new Float32Array(vectors[j]),
						};
						await inst.store.upsert(doc);
						noteIndexed(entry.file.path);
					}

					this.updateNotice(notice, inst.progress);
				} catch (error) {
					Logger.warn(
						`[VectorStore] Batch ${Math.floor(i / batchSize) + 1} failed, falling back to sequential:`,
						error,
					);

					for (const entry of batch) {
						if (inst.abortController?.signal.aborted) break;
						try {
							const vector = await embeddings.embedQuery(entry.embedText);
							if (!vector || vector.length === 0) {
								Logger.error(`[VectorStore] embedQuery returned empty result for ${entry.file.path}`);
								skippedFiles.push({ path: entry.file.path, reason: "embed-error" });
								this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
								continue;
							}
							const doc: DocumentVector = {
								id: makeChunkId(entry.file.path, entry.chunkIndex),
								path: entry.file.path,
								mtime: entry.file.stat.mtime,
								checksum: entry.checksum,
								chunkIndex: entry.chunkIndex,
								vector: new Float32Array(vector),
							};
							await inst.store.upsert(doc);
							noteIndexed(entry.file.path);
						} catch (entryError) {
							Logger.error(`[VectorStore] Failed to index ${entry.file.path}:`, entryError);
							const reason = entryError instanceof Error ? entryError.message : String(entryError);
							new Notice(`Failed to embed ${entry.file.basename}: ${reason}`);
							skippedFiles.push({ path: entry.file.path, reason: "embed-error" });
							this.updateInstanceProgress(inst, { skipped: inst.progress.skipped + 1 });
						}
					}
					this.updateNotice(notice, inst.progress);
				}
			}

			// Save the indexing report
			inst.report = { indexedFiles, skippedFiles, timestamp: Date.now() };

			const cancelled = inst.abortController?.signal.aborted;

			// A cancelled run may have had its store torn down (e.g. index deleted
			// mid-build); skip the post-run store read/stats update in that case.
			if (!cancelled) {
				// Update cached stats in plugin data using actual store count
				const actualCount = await inst.store.count();
				const data = getData();
				data.updateEmbeddingIndexStats(inst.indexId, {
					lastBuiltAt: Date.now(),
					documentCount: actualCount,
				});
			}

			const { indexed, skipped } = inst.progress;
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
		const { indexed, skipped, total, percentage, etaMs } = progress;
		const skippedText = skipped > 0 ? ` (${skipped} skipped)` : "";
		const etaText = etaMs !== null ? ` (~${formatEta(etaMs)} left)` : "";

		const el = notice.noticeEl;
		el.empty();

		const container = el.createDiv({ cls: "s2b-indexing-notice" });

		container.createDiv({
			cls: "s2b-indexing-status",
			text: `Indexing: ${indexed}/${total}${skippedText}${etaText}`,
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
		if (!isIndexableFile(file)) return "excluded";

		// Privacy check: skip private files for untrusted providers
		if (provider && !pluginData.isProviderTrusted(provider)) {
			if (pluginData.isFilePrivate(file.path)) return "privacy";
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
			const content = await readIndexableContent(this.plugin.app.vault, file);
			const maxContentLength = await this.getMaxEmbeddingContentLength(inst, model);
			const checksum = this.hashContent(content);
			const chunks = chunkText(content, file.basename, maxContentLength);

			// Embed all chunks first; only touch the store once every embedding
			// succeeded so a mid-way failure can't leave a note partially indexed.
			const vectors: Float32Array[] = [];
			for (const chunk of chunks) {
				const vector = await embeddings.embedQuery(chunk.content);
				if (!vector || vector.length === 0) {
					Logger.error(`[VectorStore] embedQuery returned empty result for ${file.path}`);
					new Notice(`Failed to embed ${file.basename}: empty result from model`);
					return;
				}
				vectors.push(new Float32Array(vector));
			}

			// Replace any prior version's chunks, then write the new ones.
			await inst.store.remove(file.path);
			for (let i = 0; i < chunks.length; i++) {
				const doc: DocumentVector = {
					id: makeChunkId(file.path, chunks[i].chunkIndex),
					path: file.path,
					mtime: file.stat.mtime,
					checksum,
					chunkIndex: chunks[i].chunkIndex,
					vector: vectors[i],
				};
				await inst.store.upsert(doc);
			}

			Logger.log(`[VectorStore] Indexed: ${file.path} (${chunks.length} chunks, ${inst.indexId})`);
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
			// Over-fetch so filtering + chunk→note dedup still leaves enough
			// distinct notes to fill topK.
			const searchTopK = (hasFilters ? topK * 3 : topK) * CHUNK_OVERFETCH;

			const results = await inst.store.search(queryVectorTyped, searchTopK, threshold);

			const { metadataCache } = this.plugin.app;
			const filteredResults: VectorSearchResult[] = [];
			// Collapse multiple chunk-hits of the same note into one result. HNSW
			// returns results sorted by score, so the first hit per path is its
			// best-matching chunk.
			const seenPaths = new Set<string>();

			for (const r of results) {
				if (seenPaths.has(r.doc.path)) continue;

				if (filter?.pathPrefixes?.length) {
					const matchesPath = filter.pathPrefixes.some((prefix) => matchesPathPrefix(r.doc.path, prefix));
					if (!matchesPath) continue;
				}

				const file = this.plugin.app.vault.getAbstractFileByPath(r.doc.path);
				const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;
				const docTags = cache ? (getAllTags(cache) ?? []) : [];

				if (filter?.tags?.length) {
					const normalizedFilterTags = filter.tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
					const normalizedDocTags = docTags.map((t) => (t.startsWith("#") ? t : `#${t}`));
					const matchesTag = (filterTag: string) =>
						normalizedDocTags.some((docTag) => docTag === filterTag || docTag.startsWith(`${filterTag}/`));

					if (filter.requireAllTags) {
						if (!normalizedFilterTags.every(matchesTag)) continue;
					} else if (!normalizedFilterTags.some(matchesTag)) {
						continue;
					}
				}

				seenPaths.add(r.doc.path);
				filteredResults.push({
					path: r.doc.path,
					name:
						file instanceof TFile ? file.basename : r.doc.path.replace(/.*\//, "").replace(/\.[^.]+$/, ""),
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
	 * Get progress for a specific index.
	 */
	getProgress(indexId?: string): IndexingProgress {
		if (!indexId) {
			const data = getData();
			indexId = data.searchEmbedIndex ?? undefined;
		}
		if (!indexId) {
			return {
				isIndexing: false,
				total: 0,
				indexed: 0,
				skipped: 0,
				currentFile: null,
				percentage: 0,
				etaMs: null,
			};
		}
		const inst = this.instances.get(indexId);
		if (!inst) {
			return {
				isIndexing: false,
				total: 0,
				indexed: 0,
				skipped: 0,
				currentFile: null,
				percentage: 0,
				etaMs: null,
			};
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
		const allFiles = getIndexableVaultFiles(vault);
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
			callback({
				isIndexing: false,
				total: 0,
				indexed: 0,
				skipped: 0,
				currentFile: null,
				percentage: 0,
				etaMs: null,
			});
			return () => {};
		}

		// Register at service level so subscriptions survive instance recreation
		if (!this.progressListeners.has(indexId)) {
			this.progressListeners.set(indexId, new Set());
		}
		this.progressListeners.get(indexId)?.add(callback);

		// Send initial progress from existing instance if available
		const inst = this.instances.get(indexId);
		callback(
			inst
				? { ...inst.progress }
				: {
						isIndexing: false,
						total: 0,
						indexed: 0,
						skipped: 0,
						currentFile: null,
						percentage: 0,
						etaMs: null,
					},
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
		const wasIndexing = inst.progress.isIndexing;
		Object.assign(inst.progress, partial);

		// Track the start of an indexing run so ETA measures only this run's rate.
		if (inst.progress.isIndexing && !wasIndexing) {
			inst.indexingStartedAt = Date.now();
			inst.indexingStartCount = inst.progress.indexed;
		} else if (!inst.progress.isIndexing) {
			inst.indexingStartedAt = null;
			inst.indexingStartCount = 0;
		}

		if (inst.progress.total > 0) {
			inst.progress.percentage = Math.round((inst.progress.indexed / inst.progress.total) * 100);
		}
		inst.progress.etaMs = this.estimateEtaMs(inst);
		const progress = { ...inst.progress };
		const listeners = this.progressListeners.get(inst.indexId);
		if (listeners) {
			for (const listener of listeners) {
				listener(progress);
			}
		}
	}

	/**
	 * Estimate milliseconds remaining for the current indexing run based on the
	 * rate of files processed so far. Returns null until enough progress has been
	 * made to produce a stable estimate.
	 */
	private estimateEtaMs(inst: IndexInstance): number | null {
		const { isIndexing, indexed, total } = inst.progress;
		if (!isIndexing || inst.indexingStartedAt === null || total <= 0) return null;

		const doneThisRun = indexed - inst.indexingStartCount;
		const remaining = total - indexed;
		if (doneThisRun <= 0 || remaining <= 0) return null;

		const elapsed = Date.now() - inst.indexingStartedAt;
		if (elapsed <= 0) return null;

		const msPerFile = elapsed / doneThisRun;
		return Math.round(msPerFile * remaining);
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
	 * Export an index to a user-chosen file via the system save dialog.
	 * Opens a native file picker and writes the serialized index as MessagePack.
	 *
	 * @returns true if the export succeeded, false if cancelled or empty.
	 */
	async exportIndex(indexId: string): Promise<boolean> {
		const inst = await this.getOrCreateInstance(indexId);
		const docs = await inst.store.getAllSerialized();
		if (docs.length === 0) {
			new Notice("Index is empty — nothing to export.");
			return false;
		}

		const filePath = showSaveDialog({
			title: "Export Embedding Index",
			defaultPath: `s2b-embeddings-${sanitizeIndexId(...this.splitIndexId(indexId))}.msgpack`,
			filters: [{ name: "MessagePack", extensions: ["msgpack"] }],
		});
		if (!filePath) return false; // User cancelled

		const [provider, model] = this.splitIndexId(indexId);
		const serialized: SerializedIndex = {
			version: INDEX_VERSION,
			providerId: provider,
			modelId: model,
			documents: docs,
			lastUpdated: Date.now(),
		};

		try {
			const encoded = encode(serialized);
			const fs = requireNodeModule<typeof import("node:fs")>("fs");
			fs.writeFileSync(filePath, new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
			Logger.log(`[VectorStore] Exported ${docs.length} documents to ${filePath}`);
			new Notice(`Exported ${docs.length} embeddings.`);
			return true;
		} catch (error) {
			Logger.error("[VectorStore] Export failed:", error);
			new Notice("Failed to export index.");
			return false;
		}
	}

	/**
	 * Import an index from a user-chosen MessagePack file via the system open dialog.
	 * Reads provider/model metadata from the file, registers the index, and
	 * bulk-loads embeddings into IDB.
	 *
	 * @returns The index ID that was imported, or null on failure/cancel.
	 */
	async importIndex(): Promise<string | null> {
		const filePaths = showOpenDialog({
			title: "Import Embedding Index",
			filters: [{ name: "MessagePack", extensions: ["msgpack"] }],
			properties: ["openFile"],
		});
		if (!filePaths || filePaths.length === 0) return null; // User cancelled

		try {
			const fs = requireNodeModule<typeof import("node:fs")>("fs");
			const raw = fs.readFileSync(filePaths[0]);
			const decoded = decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) as SerializedIndex;

			if (decoded.version !== INDEX_VERSION) {
				new Notice(
					`Export file version mismatch (expected ${INDEX_VERSION}, got ${decoded.version}). Re-index instead.`,
				);
				return null;
			}

			const { providerId: provider, modelId: model } = decoded;
			if (!provider || !model) {
				new Notice("Export file is missing provider or model metadata.");
				return null;
			}

			const indexId = `${provider}:${model}`;
			const inst = await this.getOrCreateInstance(indexId);
			await inst.store.clear();

			const docs: DocumentVector[] = decoded.documents.map((d) => ({
				id: d.id,
				path: d.path,
				mtime: d.mtime,
				checksum: d.checksum,
				vector: toFloat32Array(d.vector),
				chunkIndex: d.chunkIndex,
			}));

			await inst.store.bulkPut(docs);
			await inst.store.setMetadata(provider, model, INDEX_VERSION);
			inst.currentProviderId = provider;
			inst.currentModelId = model;

			await this.notifyStatsChanged(inst);

			Logger.log(`[VectorStore] Imported ${docs.length} documents for ${indexId}`);
			new Notice(`Imported ${docs.length} embeddings (${model}).`);
			return indexId;
		} catch (error) {
			Logger.error("[VectorStore] Failed to import index:", error);
			new Notice("Failed to import index. The file may be corrupted.");
			return null;
		}
	}

	/**
	 * Split an indexId ("provider:model") into [provider, model].
	 */
	private splitIndexId(indexId: string): [string, string] {
		const [provider = "", ...modelParts] = indexId.split(":");
		return [provider, modelParts.join(":")];
	}

	/**
	 * Delete an index completely: clear IndexedDB and remove instance.
	 */
	async deleteIndex(indexId: string): Promise<void> {
		const inst = this.instances.get(indexId);
		if (inst) {
			// Abort any in-flight indexing run so it stops writing to the store
			// we're about to clear, and flip progress off so listeners (e.g. the
			// settings progress bar) hide immediately instead of lingering. Keep
			// the abortController set (don't null it) so the loop's own
			// `signal.aborted` checks fire and it breaks out on its next tick.
			inst.abortController?.abort();
			this.updateInstanceProgress(inst, { isIndexing: false, currentFile: null, etaMs: null });
			inst.isIndexing = false;
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
			for (const inst of this.instances.values()) {
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
