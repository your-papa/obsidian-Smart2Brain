/**
 * File Sync Manager
 *
 * Handles serialization of the vector store to disk using MessagePack.
 * Implements debounced saving with configurable cooldown.
 */

import { encode, decode } from "@msgpack/msgpack";
import type { DataAdapter } from "obsidian";
import {
	INDEX_VERSION,
	SYNC_DEBOUNCE_MS,
	SYNC_MAX_DELAY_MS,
	type SerializedIndex,
	type SerializedDocument,
} from "./types";
import { Logger } from "../utils/logging";

/**
 * Manages serialization of the vector store to a MessagePack file.
 * Supports debounced saving to reduce I/O overhead.
 */
export class FileSyncManager {
	private adapter: DataAdapter;
	private filePath: string;
	private isDirty = false;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;
	private maxDelayTimeout: ReturnType<typeof setTimeout> | null = null;
	private pendingGetIndex: (() => Promise<SerializedIndex>) | null = null;
	private isSaving = false;

	/**
	 * @param adapter Obsidian's DataAdapter for file I/O
	 * @param filePath Path to the MessagePack file (relative to vault root)
	 */
	constructor(adapter: DataAdapter, filePath: string) {
		this.adapter = adapter;
		this.filePath = filePath;
	}

	/**
	 * Load the index from the MessagePack file.
	 * @returns The deserialized index, or null if file doesn't exist
	 */
	async loadFromFile(): Promise<SerializedIndex | null> {
		try {
			if (!(await this.adapter.exists(this.filePath))) {
				return null;
			}

			const data = await this.adapter.readBinary(this.filePath);
			const decoded = decode(new Uint8Array(data)) as SerializedIndex;

			// Validate schema version
			if (decoded.version !== INDEX_VERSION) {
				Logger.warn(
					`[VectorStore] Index version mismatch: expected ${INDEX_VERSION}, got ${decoded.version}. Re-indexing required.`,
				);
				return null;
			}

			return decoded;
		} catch (error) {
			Logger.error("[VectorStore] Failed to load index from file:", error);
			return null;
		}
	}

	/**
	 * Save the index to the MessagePack file immediately.
	 * @param index The index to serialize
	 */
	async saveToFile(index: SerializedIndex): Promise<void> {
		try {
			this.isSaving = true;

			// Ensure directory exists
			const dir = this.filePath.substring(0, this.filePath.lastIndexOf("/"));
			if (dir && !(await this.adapter.exists(dir))) {
				await this.adapter.mkdir(dir);
			}

			const encoded = encode(index);
			// Convert Uint8Array to ArrayBuffer for Obsidian's adapter
			await this.adapter.writeBinary(
				this.filePath,
				encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
			);
			this.isDirty = false;

			Logger.log(`[VectorStore] Saved index with ${index.documents.length} documents to ${this.filePath}`);
		} catch (error) {
			Logger.error("[VectorStore] Failed to save index to file:", error);
			throw error;
		} finally {
			this.isSaving = false;
		}
	}

	/**
	 * Schedule a save operation with debounce and a maximum delay.
	 * The debounce timer resets on each call, but a max-delay timer
	 * guarantees the save fires within SYNC_MAX_DELAY_MS of the first
	 * change, preventing indefinite deferral during continuous edits.
	 *
	 * @param getIndex Function to get the current index state when save is triggered
	 */
	scheduleSave(getIndex: () => Promise<SerializedIndex>): void {
		this.isDirty = true;
		this.pendingGetIndex = getIndex;

		// Clear existing debounce timeout and reset
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}

		this.saveTimeout = setTimeout(async () => {
			await this.executePendingSave();
		}, SYNC_DEBOUNCE_MS);

		// Set max-delay timer only once per dirty cycle to guarantee an upper bound
		if (!this.maxDelayTimeout) {
			this.maxDelayTimeout = setTimeout(async () => {
				await this.executePendingSave();
			}, SYNC_MAX_DELAY_MS);
		}
	}

	/**
	 * Force an immediate save, bypassing the debounce.
	 * Used during plugin unload to ensure data is persisted.
	 */
	async flush(): Promise<void> {
		// Cancel pending timeouts
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		if (this.maxDelayTimeout) {
			clearTimeout(this.maxDelayTimeout);
			this.maxDelayTimeout = null;
		}

		// Execute save if dirty
		if (this.isDirty && this.pendingGetIndex) {
			await this.executePendingSave();
		}
	}

	/**
	 * Check if there are unsaved changes.
	 */
	get hasUnsavedChanges(): boolean {
		return this.isDirty;
	}

	/**
	 * Check if a save is currently in progress.
	 */
	get isSaveInProgress(): boolean {
		return this.isSaving;
	}

	/**
	 * Execute the pending save operation.
	 */
	private async executePendingSave(): Promise<void> {
		if (!this.pendingGetIndex) return;

		try {
			const index = await this.pendingGetIndex();
			await this.saveToFile(index);
		} catch (error) {
			Logger.error("[VectorStore] Failed to execute scheduled save:", error);
		} finally {
			// Clear both timers so the next dirty cycle starts fresh
			if (this.saveTimeout) {
				clearTimeout(this.saveTimeout);
				this.saveTimeout = null;
			}
			if (this.maxDelayTimeout) {
				clearTimeout(this.maxDelayTimeout);
				this.maxDelayTimeout = null;
			}
		}
	}

	/**
	 * Create a serialized index from documents and metadata.
	 */
	static createIndex(
		documents: SerializedDocument[],
		providerId: string,
		modelId: string,
		lastUpdated = Date.now(),
	): SerializedIndex {
		return {
			version: INDEX_VERSION,
			providerId,
			modelId,
			documents,
			lastUpdated,
		};
	}
}
