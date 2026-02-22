/**
 * Vector Store Service
 *
 * Main orchestration service for the embedding-based vector store.
 * Manages indexing, search, and synchronization between IndexedDB and file storage.
 */

import { Notice, TFile, getAllTags } from "obsidian";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type SecondBrainPlugin from "../main";
import { getData } from "../stores/dataStore.svelte";
import { getRegistry } from "../providers/registry";
import { createVectorStore } from "./index";
import { FileSyncManager } from "./FileSyncManager";
import { MiniSearchService, type LexicalSearchResult } from "./MiniSearchService";
import {
	INDEX_FILE_PATH,
	INDEX_VERSION,
	type DefaultEmbedModel,
	type DocumentVector,
	type IndexingProgress,
	type SearchFilter,
	type VectorSearchResult,
	type VectorStore,
} from "./types";
import { cosineSimilarity, toFloat32Array } from "./similarity";
import { Logger } from "../utils/logging";

/** Default context window for embedding models (8k tokens) */
const DEFAULT_EMBED_CONTEXT_WINDOW = 8191;

/** Approximate chars per token for rough estimation */
const CHARS_PER_TOKEN = 4;

/** Maximum content length before skipping (rough estimate) */
const MAX_CONTENT_LENGTH = DEFAULT_EMBED_CONTEXT_WINDOW * CHARS_PER_TOKEN;

/**
 * Batch sizes for embedding providers.
 * OpenAI supports up to 2048 inputs per request.
 * Ollama processes sequentially but LangChain handles concurrency.
 * Smaller batches = more frequent progress updates.
 */
const BATCH_SIZE_OPENAI = 100;
const BATCH_SIZE_OLLAMA = 10; // Smaller batches for local models (concurrent requests)
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
 * Main service for embedding-based vector search.
 */
export class VectorStoreService {
	private plugin: SecondBrainPlugin;
	private store: VectorStore;
	private syncManager: FileSyncManager;
	private miniSearch: MiniSearchService;
	private embeddings: EmbeddingsInterface | null = null;
	private isInitialized = false;
	private _isIndexing = false;
	private currentProviderId: string | null = null;
	private currentModelId: string | null = null;
	private _hasValidatedThisSession = false;

	// Progress tracking
	private _progress: IndexingProgress = {
		isIndexing: false,
		total: 0,
		indexed: 0,
		skipped: 0,
		currentFile: null,
		percentage: 0,
	};
	private progressListeners: Set<(progress: IndexingProgress) => void> = new Set();

	private constructor(plugin: SecondBrainPlugin) {
		this.plugin = plugin;

		// Create vector store backend based on user setting
		const backend = getData()?.vectorStoreBackend ?? "hnsw";
		this.store = createVectorStore(backend);
		Logger.log(`[VectorStore] Using ${backend} backend`);

		// Get plugin data directory path
		const vault = plugin.app.vault as { configDir?: string };
		const configDir = vault.configDir || ".obsidian";
		const filePath = `${configDir}/plugins/${plugin.manifest.id}/data/${INDEX_FILE_PATH}`;

		this.syncManager = new FileSyncManager(plugin.app.vault.adapter, filePath);
		this.miniSearch = new MiniSearchService();
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
	 */
	private async init(): Promise<void> {
		try {
			// Open databases
			await this.store.open();
			await this.miniSearch.open();
			await this.miniSearch.loadFromStorage();

			// Load from file if exists
			const serialized = await this.syncManager.loadFromFile();
			if (serialized) {
				// Check if model matches current config
				const defaultModel = this.getDefaultEmbedModel();
				const modelMatches =
					defaultModel &&
					serialized.providerId === defaultModel.provider &&
					serialized.modelId === defaultModel.model;

				if (modelMatches) {
					// Populate Dexie from file
					const docs: DocumentVector[] = serialized.documents.map((d) => ({
						id: d.id,
						path: d.path,
						mtime: d.mtime,
						checksum: d.checksum,
						vector: toFloat32Array(d.vector),
						chunkIndex: d.chunkIndex,
					}));

					await this.store.clear();
					await this.store.bulkPut(docs);
					await this.store.setMetadata(serialized.providerId, serialized.modelId, serialized.version);

					this.currentProviderId = serialized.providerId;
					this.currentModelId = serialized.modelId;

					Logger.log(`[VectorStore] Loaded ${docs.length} documents from file`);

					// Validate index against vault after workspace is ready (providers registered)
					this.plugin.app.workspace.onLayoutReady(() => {
						this.validateIndexOnStartup();
					});
				} else {
					Logger.log("[VectorStore] Model changed, index will be rebuilt on next search");
					await this.store.clear();
				}
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
	 * Validate the index against the vault on startup.
	 * Identifies missing, stale, and orphaned entries and processes them.
	 * Runs asynchronously to avoid blocking startup.
	 */
	private async validateIndexOnStartup(): Promise<void> {
		const defaultModel = this.getDefaultEmbedModel();
		if (!defaultModel) {
			Logger.log("[VectorStore] No embedding model configured, skipping validation");
			return;
		}

		// Check if provider is registered (may not be ready yet after startup)
		const registry = getRegistry();
		if (!registry.has(defaultModel.provider)) {
			Logger.log("[VectorStore] Provider not yet registered, will validate on first search");
			return;
		}

		const embeddings = this.getEmbeddings();
		if (!embeddings) {
			Logger.log("[VectorStore] Failed to create embeddings, skipping validation");
			return;
		}

		await this.validateIndexCompleteness(embeddings, defaultModel);
	}

	/**
	 * Validate index completeness and update missing/stale entries.
	 * Called either on startup (if provider ready) or on first search.
	 */
	private async validateIndexCompleteness(
		embeddings: EmbeddingsInterface,
		defaultModel: DefaultEmbedModel,
	): Promise<void> {
		// Skip if already validated this session
		if (this._hasValidatedThisSession) {
			return;
		}
		this._hasValidatedThisSession = true;

		Logger.log("[VectorStore] Validating index against vault...");

		const { vault } = this.plugin.app;
		const allVaultFiles = vault.getMarkdownFiles();

		// Filter files based on exclusion settings
		const vaultFiles = allVaultFiles.filter((file) => this.shouldIndexFile(file));

		// Get all indexed paths with their mtimes
		const indexedDocs = await this.store.getAll();
		const indexedMap = new Map<string, { mtime: number }>();
		for (const doc of indexedDocs) {
			indexedMap.set(doc.path, { mtime: doc.mtime });
		}

		// Find missing and stale files
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

		// Find orphaned entries (indexed but no longer in vault)
		const orphanedPaths: string[] = [];
		for (const path of indexedMap.keys()) {
			if (!vaultPaths.has(path)) {
				orphanedPaths.push(path);
			}
		}

		const totalUpdates = missingFiles.length + staleFiles.length + orphanedPaths.length;

		if (totalUpdates === 0) {
			Logger.log("[VectorStore] Index is up to date");
			return;
		}

		Logger.log(
			`[VectorStore] Found ${missingFiles.length} missing, ${staleFiles.length} stale, ${orphanedPaths.length} orphaned`,
		);

		// Remove orphaned entries first
		if (orphanedPaths.length > 0) {
			for (const path of orphanedPaths) {
				await this.store.remove(path);
			}
			Logger.log(`[VectorStore] Removed ${orphanedPaths.length} orphaned entries`);
		}

		// Index missing and stale files
		const filesToIndex = [...missingFiles, ...staleFiles];
		if (filesToIndex.length > 0) {
			const batchSize = this.getBatchSize(defaultModel.provider);
			let indexed = 0;

			// Show notice for larger updates
			const showNotice = filesToIndex.length > 5;
			let notice: Notice | null = null;
			if (showNotice) {
				notice = new Notice(`Updating index: 0/${filesToIndex.length}`, 0);
			}

			// Collect valid file contents
			interface FileEntry {
				file: TFile;
				content: string;
				contentWithTitle: string;
			}
			const validFiles: FileEntry[] = [];

			for (const file of filesToIndex) {
				try {
					const content = await vault.cachedRead(file);
					if (content.length <= MAX_CONTENT_LENGTH) {
						const contentWithTitle = `# ${file.basename}\n\n${content}`;
						validFiles.push({ file, content, contentWithTitle });
					}
				} catch (error) {
					Logger.error(`[VectorStore] Failed to read ${file.path}:`, error);
				}
			}

			// Process in batches
			for (let i = 0; i < validFiles.length; i += batchSize) {
				const batch = validFiles.slice(i, i + batchSize);

				try {
					const texts = batch.map((entry) => entry.contentWithTitle);
					const vectors = await embeddings.embedDocuments(texts);

					for (let j = 0; j < batch.length; j++) {
						const entry = batch[j];
						const vector = vectors[j];

						const doc: DocumentVector = {
							id: entry.file.path,
							path: entry.file.path,
							mtime: entry.file.stat.mtime,
							checksum: this.hashContent(entry.content),
							vector: new Float32Array(vector),
						};

						await this.store.upsert(doc);

						// Also index in MiniSearch
						this.miniSearch.addDocument(entry.file.path, entry.file.basename, entry.content);
					}

					indexed += batch.length;
					if (notice) {
						notice.setMessage(`Updating index: ${indexed}/${filesToIndex.length}`);
					}
				} catch (error) {
					Logger.error("[VectorStore] Batch validation indexing failed:", error);
					// Fall back to sequential for this batch
					for (const entry of batch) {
						try {
							const vector = await embeddings.embedQuery(entry.contentWithTitle);
							const doc: DocumentVector = {
								id: entry.file.path,
								path: entry.file.path,
								mtime: entry.file.stat.mtime,
								checksum: this.hashContent(entry.content),
								vector: new Float32Array(vector),
							};
							await this.store.upsert(doc);

							// Also index in MiniSearch
							this.miniSearch.addDocument(entry.file.path, entry.file.basename, entry.content);

							indexed++;
						} catch (entryError) {
							Logger.error(`[VectorStore] Failed to index ${entry.file.path}:`, entryError);
						}
					}
					if (notice) {
						notice.setMessage(`Updating index: ${indexed}/${filesToIndex.length}`);
					}
				}
			}

			if (notice) {
				notice.setMessage(`✓ Index updated: ${indexed} files`);
				setTimeout(() => notice.hide(), 3000);
			}

			Logger.log(`[VectorStore] Indexed ${indexed} missing/stale files`);
		}

		// Save updated index
		await this.saveToFile();
		Logger.log("[VectorStore] Validation complete");
	}

	/**
	 * Register vault file events for incremental updates.
	 */
	private registerEvents(): void {
		const { vault } = this.plugin.app;

		// New file created
		this.plugin.registerEvent(
			vault.on("create", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileCreate(file);
				}
			}),
		);

		// File modified
		this.plugin.registerEvent(
			vault.on("modify", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileModify(file);
				}
			}),
		);

		// File deleted
		this.plugin.registerEvent(
			vault.on("delete", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileDelete(file);
				}
			}),
		);

		// File renamed
		this.plugin.registerEvent(
			vault.on("rename", async (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.handleFileRename(file, oldPath);
				}
			}),
		);
	}

	/**
	 * Handle new file creation.
	 */
	private async handleFileCreate(file: TFile): Promise<void> {
		if (!this.embeddings || this.isIndexing) return;
		await this.indexDocument(file);
	}

	/**
	 * Handle file modification.
	 */
	private async handleFileModify(file: TFile): Promise<void> {
		if (!this.embeddings || this.isIndexing) return;

		// Check if mtime changed (avoid double-indexing)
		const storedMtime = await this.store.getDocumentMtime(file.path);
		if (storedMtime && storedMtime >= file.stat.mtime) {
			return;
		}

		await this.indexDocument(file);
	}

	/**
	 * Handle file deletion.
	 */
	private async handleFileDelete(file: TFile): Promise<void> {
		await this.store.remove(file.path);
		this.miniSearch.removeDocument(file.path);
		this.scheduleSave();
	}

	/**
	 * Handle file rename.
	 */
	private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
		// Remove old entry
		await this.store.remove(oldPath);
		this.miniSearch.removeDocument(oldPath);

		// Re-index with new path (if embeddings available)
		if (this.embeddings) {
			await this.indexDocument(file);
		}
	}

	/**
	 * Get the configured default embedding model.
	 */
	private getDefaultEmbedModel(): DefaultEmbedModel | null {
		const data = getData();
		return data.defaultEmbedModel;
	}

	/**
	 * Get or create the embeddings instance.
	 */
	private getEmbeddings(): EmbeddingsInterface | null {
		const defaultModel = this.getDefaultEmbedModel();
		if (!defaultModel) {
			return null;
		}

		// Check if we need to create a new instance
		if (
			this.embeddings &&
			this.currentProviderId === defaultModel.provider &&
			this.currentModelId === defaultModel.model
		) {
			return this.embeddings;
		}

		try {
			const registry = getRegistry();
			this.embeddings = registry.createEmbeddingInstance(defaultModel.provider, defaultModel.model);
			this.currentProviderId = defaultModel.provider;
			this.currentModelId = defaultModel.model;
			return this.embeddings;
		} catch (error) {
			Logger.error("[VectorStore] Failed to create embeddings instance:", error);
			return null;
		}
	}

	/**
	 * Ensure the index is built. Called on-demand when embeddings search is used.
	 * Returns true if index is ready, false if not possible.
	 */
	async ensureIndex(): Promise<boolean> {
		const defaultModel = this.getDefaultEmbedModel();
		if (!defaultModel) {
			new Notice("No embedding model configured. Please set a default embedding model in settings.");
			return false;
		}

		const embeddings = this.getEmbeddings();
		if (!embeddings) {
			new Notice("Failed to initialize embedding model. Check your settings.");
			return false;
		}

		// Check if model changed
		const meta = await this.store.getMetadata();
		const modelChanged = meta && (meta.providerId !== defaultModel.provider || meta.modelId !== defaultModel.model);

		if (modelChanged) {
			Logger.log("[VectorStore] Model changed, clearing index");
			await this.store.clear();
		}

		// Check if index is empty or needs rebuilding
		const count = await this.store.count();
		if (count === 0 || modelChanged) {
			await this.buildFullIndex(embeddings, defaultModel);
			this._hasValidatedThisSession = true; // Full build validates everything
		} else if (!this._hasValidatedThisSession) {
			// Validate index completeness on first search of session
			// Run validation async to not block the current search
			this.validateIndexCompleteness(embeddings, defaultModel);
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
	 * Build the full index from all markdown files using batch embedding.
	 */
	private async buildFullIndex(embeddings: EmbeddingsInterface, model: DefaultEmbedModel): Promise<void> {
		if (this._isIndexing) {
			new Notice("Indexing already in progress...");
			return;
		}

		this._isIndexing = true;
		const { vault } = this.plugin.app;
		const allFiles = vault.getMarkdownFiles();
		const batchSize = this.getBatchSize(model.provider);

		// Filter files based on exclusion/inclusion settings
		const files = allFiles.filter((file) => this.shouldIndexFile(file));
		const excludedCount = allFiles.length - files.length;

		// Initialize progress
		this.updateProgress({
			isIndexing: true,
			total: files.length,
			indexed: 0,
			skipped: excludedCount,
			currentFile: null,
			percentage: 0,
		});

		const notice = new Notice("", 0);
		this.updateNotice(notice);

		try {
			// Set metadata first
			await this.store.setMetadata(model.provider, model.model, INDEX_VERSION);

			// Phase 1: Collect all valid documents with their content
			this.updateProgress({ currentFile: "Reading files..." });
			this.updateNotice(notice);

			interface FileEntry {
				file: TFile;
				content: string;
				contentWithTitle: string;
			}

			const validFiles: FileEntry[] = [];

			for (const file of files) {
				try {
					const content = await vault.cachedRead(file);

					// Skip files that are too large
					if (content.length > MAX_CONTENT_LENGTH) {
						this.updateProgress({ skipped: this._progress.skipped + 1 });
						continue;
					}

					// Prepend title to content for better semantic matching
					const contentWithTitle = `# ${file.basename}\n\n${content}`;
					validFiles.push({ file, content, contentWithTitle });
				} catch (error) {
					Logger.error(`[VectorStore] Failed to read ${file.path}:`, error);
					this.updateProgress({ skipped: this._progress.skipped + 1 });
				}
			}

			// Update total to reflect only valid files
			this.updateProgress({ total: validFiles.length + this._progress.skipped });
			this.updateNotice(notice);

			// Phase 2: Process in batches
			for (let i = 0; i < validFiles.length; i += batchSize) {
				const batch = validFiles.slice(i, i + batchSize);
				const batchEnd = Math.min(i + batchSize, validFiles.length);

				this.updateProgress({ currentFile: `Embedding batch ${Math.floor(i / batchSize) + 1}...` });
				this.updateNotice(notice);

				try {
					// Generate embeddings for the batch
					const texts = batch.map((entry) => entry.contentWithTitle);
					const vectors = await embeddings.embedDocuments(texts);

					// Store each document
					for (let j = 0; j < batch.length; j++) {
						const entry = batch[j];
						const vector = vectors[j];

						const doc: DocumentVector = {
							id: entry.file.path,
							path: entry.file.path,
							mtime: entry.file.stat.mtime,
							checksum: this.hashContent(entry.content),
							vector: new Float32Array(vector),
						};

						await this.store.upsert(doc);

						// Also index in MiniSearch for lexical search
						this.miniSearch.addDocument(entry.file.path, entry.file.basename, entry.content);
					}

					this.updateProgress({ indexed: batchEnd });
					this.updateNotice(notice);
				} catch (error) {
					// If batch fails, fall back to individual processing for this batch
					Logger.warn(
						`[VectorStore] Batch ${Math.floor(i / batchSize) + 1} failed, falling back to sequential:`,
						error,
					);

					for (const entry of batch) {
						try {
							const vector = await embeddings.embedQuery(entry.contentWithTitle);

							const doc: DocumentVector = {
								id: entry.file.path,
								path: entry.file.path,
								mtime: entry.file.stat.mtime,
								checksum: this.hashContent(entry.content),
								vector: new Float32Array(vector),
							};

							await this.store.upsert(doc);

							// Also index in MiniSearch
							this.miniSearch.addDocument(entry.file.path, entry.file.basename, entry.content);

							this.updateProgress({ indexed: this._progress.indexed + 1 });
						} catch (entryError) {
							Logger.error(`[VectorStore] Failed to index ${entry.file.path}:`, entryError);
							this.updateProgress({ skipped: this._progress.skipped + 1 });
						}
					}
					this.updateNotice(notice);
				}
			}

			// Save to file
			await this.saveToFile();

			// Final message
			const { indexed, skipped } = this._progress;
			notice.setMessage(`✓ Indexed ${indexed} notes${skipped > 0 ? `, ${skipped} skipped` : ""}`);
			setTimeout(() => notice.hide(), 3000);

			Logger.log(`[VectorStore] Full index complete: ${indexed} indexed, ${skipped} skipped`);
		} finally {
			this._isIndexing = false;
			this.updateProgress({
				isIndexing: false,
				currentFile: null,
			});
		}
	}

	/**
	 * Update the indexing notice with current progress.
	 */
	private updateNotice(notice: Notice): void {
		const { indexed, skipped, total, percentage, currentFile } = this._progress;
		const skippedText = skipped > 0 ? ` (${skipped} skipped)` : "";
		const fileText = currentFile ? `\n${currentFile}` : "";

		// Use DOM for proper progress bar rendering
		const el = notice.noticeEl;
		el.empty();

		const container = el.createDiv({ cls: "ssb-indexing-notice" });

		// Status text
		container.createDiv({
			cls: "ssb-indexing-status",
			text: `Indexing: ${indexed}/${total}${skippedText}`,
		});

		// Progress bar container
		const progressContainer = container.createDiv({ cls: "ssb-indexing-progress" });
		progressContainer.style.cssText =
			"width: 100%; height: 6px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden; margin: 8px 0;";

		// Progress bar fill
		const progressFill = progressContainer.createDiv({ cls: "ssb-indexing-fill" });
		progressFill.style.cssText = `width: ${percentage}%; height: 100%; background: var(--interactive-accent); border-radius: 3px; transition: width 0.2s ease;`;

		// Percentage text
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

		// Check if file path matches any pattern in the list
		const matchesPattern = indexList.some(
			(pattern) => file.path.startsWith(pattern) || file.path.includes(`/${pattern}`),
		);

		// If excluding (blacklist): include file if it does NOT match
		// If including (whitelist): include file if it DOES match (or if list is empty)
		return isExcluding ? !matchesPattern : indexList.length === 0 || matchesPattern;
	}

	/**
	 * Index a single document.
	 */
	private async indexDocument(file: TFile): Promise<void> {
		const embeddings = this.getEmbeddings();
		if (!embeddings) return;

		// Check exclusion settings
		if (!this.shouldIndexFile(file)) {
			Logger.log(`[VectorStore] Skipping ${file.path}: excluded by settings`);
			return;
		}

		try {
			const content = await this.plugin.app.vault.cachedRead(file);

			// Skip files that are too large
			if (content.length > MAX_CONTENT_LENGTH) {
				Logger.log(`[VectorStore] Skipping ${file.path}: too large`);
				return;
			}

			// Prepend title to content for better semantic matching
			const contentWithTitle = `# ${file.basename}\n\n${content}`;

			// Generate embedding
			const vector = await embeddings.embedQuery(contentWithTitle);

			// Store in Dexie
			const doc: DocumentVector = {
				id: file.path,
				path: file.path,
				mtime: file.stat.mtime,
				checksum: this.hashContent(content),
				vector: new Float32Array(vector),
			};

			await this.store.upsert(doc);

			// Also index in MiniSearch for lexical search
			this.miniSearch.addDocument(file.path, file.basename, content);

			this.scheduleSave();

			Logger.log(`[VectorStore] Indexed: ${file.path}`);
		} catch (error) {
			Logger.error(`[VectorStore] Failed to index ${file.path}:`, error);
		}
	}

	/**
	 * Perform lexical (full-text) search using MiniSearch.
	 * Uses TF-IDF scoring with fuzzy matching and prefix search.
	 *
	 * @param query Text query to search for
	 * @param topK Maximum number of results to return
	 * @param filter Optional filters for path prefixes and tags
	 */
	async lexicalSearch(query: string, topK: number, filter?: SearchFilter): Promise<VectorSearchResult[]> {
		const results = this.miniSearch.search(query, topK * (filter ? 3 : 1));

		const { metadataCache } = this.plugin.app;
		const filteredResults: VectorSearchResult[] = [];

		for (const r of results) {
			// Apply path prefix filter
			if (filter?.pathPrefixes?.length) {
				const matchesPath = filter.pathPrefixes.some((prefix) => r.path.startsWith(prefix));
				if (!matchesPath) continue;
			}

			// Get file metadata for tag filtering
			const file = this.plugin.app.vault.getAbstractFileByPath(r.path);
			const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;

			// Extract all tags (frontmatter + inline)
			const docTags = cache ? (getAllTags(cache) ?? []) : [];

			// Apply tag filter
			if (filter?.tags?.length) {
				const normalizedFilterTags = filter.tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
				const normalizedDocTags = docTags.map((t) => (t.startsWith("#") ? t : `#${t}`));

				if (filter.requireAllTags) {
					const hasAllTags = normalizedFilterTags.every((tag) => normalizedDocTags.includes(tag));
					if (!hasAllTags) continue;
				} else {
					const hasAnyTag = normalizedFilterTags.some((tag) => normalizedDocTags.includes(tag));
					if (!hasAnyTag) continue;
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
	 * Browse all indexed documents with optional filtering.
	 * Used for filter-only queries (no search terms).
	 *
	 * @param topK Maximum number of results to return
	 * @param filter Optional filters for path prefixes and tags
	 */
	async browseDocuments(topK: number, filter?: SearchFilter): Promise<VectorSearchResult[]> {
		const results = this.miniSearch.browse(topK * (filter ? 3 : 1));

		const { metadataCache } = this.plugin.app;
		const filteredResults: VectorSearchResult[] = [];

		for (const r of results) {
			// Apply path prefix filter
			if (filter?.pathPrefixes?.length) {
				const matchesPath = filter.pathPrefixes.some((prefix) => r.path.startsWith(prefix));
				if (!matchesPath) continue;
			}

			// Get file metadata for tag filtering
			const file = this.plugin.app.vault.getAbstractFileByPath(r.path);
			const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;

			// Extract all tags (frontmatter + inline)
			const docTags = cache ? (getAllTags(cache) ?? []) : [];

			// Apply tag filter
			if (filter?.tags?.length) {
				const normalizedFilterTags = filter.tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
				const normalizedDocTags = docTags.map((t) => (t.startsWith("#") ? t : `#${t}`));

				if (filter.requireAllTags) {
					const hasAllTags = normalizedFilterTags.every((tag) => normalizedDocTags.includes(tag));
					if (!hasAllTags) continue;
				} else {
					const hasAnyTag = normalizedFilterTags.some((tag) => normalizedDocTags.includes(tag));
					if (!hasAnyTag) continue;
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
	 * Delegates to the underlying vector store backend (IndexedDB or HNSW).
	 *
	 * @param query Text query to search for
	 * @param topK Maximum number of results to return
	 * @param threshold Minimum similarity score (0-1)
	 * @param filter Optional filters for path prefixes and tags
	 */
	async search(
		query: string,
		topK: number,
		threshold?: number,
		filter?: SearchFilter,
	): Promise<VectorSearchResult[]> {
		// Ensure index is ready
		const isReady = await this.ensureIndex();
		if (!isReady) {
			return [];
		}

		const embeddings = this.getEmbeddings();
		if (!embeddings) {
			return [];
		}

		try {
			// Embed the query
			const queryVector = await embeddings.embedQuery(query);
			const queryVectorTyped = new Float32Array(queryVector);

			// Request more results if filtering, to ensure we get enough after filtering
			const hasFilters = filter?.pathPrefixes?.length || filter?.tags?.length;
			const searchTopK = hasFilters ? topK * 3 : topK;

			// Delegate search to the backend (IndexedDB brute-force or HNSW ANN)
			const results = await this.store.search(queryVectorTyped, searchTopK, threshold);

			// Convert to SearchResult format with filtering
			const { metadataCache } = this.plugin.app;
			const filteredResults: VectorSearchResult[] = [];

			for (const r of results) {
				// Apply path prefix filter
				if (filter?.pathPrefixes?.length) {
					const matchesPath = filter.pathPrefixes.some((prefix) => r.doc.path.startsWith(prefix));
					if (!matchesPath) continue;
				}

				// Get file metadata for tag filtering
				const file = this.plugin.app.vault.getAbstractFileByPath(r.doc.path);
				const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;

				// Extract all tags (frontmatter + inline)
				const docTags = cache ? (getAllTags(cache) ?? []) : [];

				// Apply tag filter
				if (filter?.tags?.length) {
					const normalizedFilterTags = filter.tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
					const normalizedDocTags = docTags.map((t) => (t.startsWith("#") ? t : `#${t}`));

					if (filter.requireAllTags) {
						// All tags must be present
						const hasAllTags = normalizedFilterTags.every((tag) => normalizedDocTags.includes(tag));
						if (!hasAllTags) continue;
					} else {
						// At least one tag must be present
						const hasAnyTag = normalizedFilterTags.some((tag) => normalizedDocTags.includes(tag));
						if (!hasAnyTag) continue;
					}
				}

				filteredResults.push({
					path: r.doc.path,
					name: r.doc.path.replace(/.*\//, "").replace(/\.md$/, ""),
					frontmatter: cache?.frontmatter,
					tags: docTags,
					score: r.score,
				});

				// Stop once we have enough results
				if (filteredResults.length >= topK) break;
			}

			return filteredResults;
		} catch (error) {
			Logger.error("[VectorStore] Search failed:", error);
			return [];
		}
	}

	/**
	 * Schedule a save to file with debounce.
	 */
	private scheduleSave(): void {
		this.syncManager.scheduleSave(async () => {
			const docs = await this.store.getAllSerialized();
			return FileSyncManager.createIndex(docs, this.currentProviderId ?? "", this.currentModelId ?? "");
		});
	}

	/**
	 * Immediately save to file.
	 */
	private async saveToFile(): Promise<void> {
		const docs = await this.store.getAllSerialized();
		const index = FileSyncManager.createIndex(docs, this.currentProviderId ?? "", this.currentModelId ?? "");
		await this.syncManager.saveToFile(index);
	}

	/**
	 * Simple hash function for content change detection.
	 * Uses djb2 algorithm for speed.
	 */
	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = (hash * 33) ^ content.charCodeAt(i);
		}
		return (hash >>> 0).toString(16);
	}

	/**
	 * Get the current index stats.
	 */
	async getStats(): Promise<{
		documentCount: number;
		lexicalDocumentCount: number;
		providerId: string | null;
		modelId: string | null;
		isReady: boolean;
	}> {
		const count = await this.store.count();
		const lexicalCount = this.miniSearch.documentCount;
		const metadata = await this.store.getMetadata();
		const defaultModel = this.getDefaultEmbedModel();

		// isReady = service initialized AND embedding model is configured
		const isReady = this.isInitialized && defaultModel !== null;

		return {
			documentCount: count,
			lexicalDocumentCount: lexicalCount,
			providerId: metadata?.providerId ?? this.currentProviderId,
			modelId: metadata?.modelId ?? this.currentModelId,
			isReady,
		};
	}

	/**
	 * Get the current indexing progress.
	 */
	getProgress(): IndexingProgress {
		return { ...this._progress };
	}

	/**
	 * Check if indexing is in progress.
	 */
	get isIndexing(): boolean {
		return this._isIndexing;
	}

	/**
	 * Subscribe to progress updates.
	 * @returns Unsubscribe function
	 */
	onProgress(callback: (progress: IndexingProgress) => void): () => void {
		this.progressListeners.add(callback);
		// Immediately call with current state
		callback(this.getProgress());
		return () => {
			this.progressListeners.delete(callback);
		};
	}

	/**
	 * Notify all progress listeners.
	 */
	private notifyProgress(): void {
		const progress = this.getProgress();
		for (const listener of this.progressListeners) {
			listener(progress);
		}
	}

	/**
	 * Update progress state.
	 */
	private updateProgress(partial: Partial<IndexingProgress>): void {
		Object.assign(this._progress, partial);
		if (this._progress.total > 0) {
			this._progress.percentage = Math.round(
				((this._progress.indexed + this._progress.skipped) / this._progress.total) * 100,
			);
		}
		this.notifyProgress();
	}

	/**
	 * Clear the index and rebuild.
	 */
	async rebuildIndex(): Promise<void> {
		await this.store.clear();
		await this.ensureIndex();
	}

	/**
	 * Cleanup and save state.
	 */
	async cleanup(): Promise<void> {
		try {
			// Flush pending saves
			await this.syncManager.flush();
			await this.miniSearch.flush();

			// Close databases
			await this.store.close();
			this.miniSearch.close();

			Logger.log("[VectorStore] Cleanup complete");
		} catch (error) {
			Logger.error("[VectorStore] Cleanup failed:", error);
		}

		instance = null;
	}
}
