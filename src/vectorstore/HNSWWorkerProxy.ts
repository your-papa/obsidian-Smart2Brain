/**
 * HNSW Worker Proxy
 *
 * Main-thread proxy that implements the VectorStore interface by forwarding
 * all calls to an HNSWVectorStore running inside a Web Worker.
 * Every CPU-intensive operation (build, search, add) runs off the main thread.
 */

import type { DocumentVector, IndexMetadata, ScoredDocument, SerializedDocument, VectorStore } from "./types";
import type { HNSWWorkerRequest, HNSWWorkerResponse } from "./hnswWorker";
import HNSWWorkerConstructor from "./hnswWorker?worker&inline";
import { Logger } from "../utils/logging";

export class HNSWWorkerProxy implements VectorStore {
	private worker: Worker;
	private nextId = 0;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	private _providerId: string | null = null;
	private _modelId: string | null = null;

	constructor(vaultId: string, indexId?: string) {
		this.worker = new HNSWWorkerConstructor({ name: "s2b-hnsw" });
		this.worker.onmessage = (e: MessageEvent<HNSWWorkerResponse>) => {
			const { id, result, error } = e.data;
			const entry = this.pending.get(id);
			if (!entry) return;
			this.pending.delete(id);
			if (error) {
				entry.reject(new Error(error));
			} else {
				entry.resolve(result);
			}
		};
		this.worker.onerror = (e) => {
			Logger.error("[VectorStore] [HNSW] Worker error:", e.message);
		};

		// Initialize the store inside the worker (fire-and-forget, open() will await)
		this.call("init", vaultId, indexId);
	}

	private call(method: string, ...args: unknown[]): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			const request: HNSWWorkerRequest = { id, method, args };
			this.worker.postMessage(request);
		});
	}

	async open(): Promise<void> {
		await this.call("open");
		// Sync cached getters
		this._providerId = (await this.call("getProviderId")) as string | null;
		this._modelId = (await this.call("getModelId")) as string | null;
	}

	async close(): Promise<void> {
		await this.call("close");
		this.worker.terminate();
		this.pending.clear();
	}

	get providerId(): string | null {
		return this._providerId;
	}

	get modelId(): string | null {
		return this._modelId;
	}

	async setMetadata(providerId: string, modelId: string, version: number): Promise<void> {
		await this.call("setMetadata", providerId, modelId, version);
		this._providerId = providerId;
		this._modelId = modelId;
	}

	async getMetadata(): Promise<IndexMetadata | null> {
		return (await this.call("getMetadata")) as IndexMetadata | null;
	}

	async upsert(doc: DocumentVector): Promise<void> {
		await this.call("upsert", doc);
	}

	async remove(path: string): Promise<void> {
		await this.call("remove", path);
	}

	async getByPath(path: string): Promise<DocumentVector | undefined> {
		const result = await this.call("getByPath", path);
		return (result as DocumentVector) ?? undefined;
	}

	async getDocumentMtime(path: string): Promise<number | undefined> {
		const result = await this.call("getDocumentMtime", path);
		return (result as number) ?? undefined;
	}

	async getAll(): Promise<DocumentVector[]> {
		return (await this.call("getAll")) as DocumentVector[];
	}

	async getAllSerialized(): Promise<SerializedDocument[]> {
		return (await this.call("getAllSerialized")) as SerializedDocument[];
	}

	async bulkPut(docs: DocumentVector[]): Promise<void> {
		await this.call("bulkPut", docs);
	}

	async clear(): Promise<void> {
		await this.call("clear");
	}

	async count(): Promise<number> {
		return (await this.call("count")) as number;
	}

	async countNotes(): Promise<number> {
		return (await this.call("countNotes")) as number;
	}

	async search(queryVector: Float32Array, topK: number, threshold?: number): Promise<ScoredDocument[]> {
		return (await this.call("search", queryVector, topK, threshold)) as ScoredDocument[];
	}

	/**
	 * Inspect HNSW graph health inside the worker.
	 *
	 * The graph lives in the worker realm, so reading `hnswIndex` from the main
	 * thread always shows `undefined` regardless of its true state. A `nodeCount`
	 * much larger than `mappedIdCount` indicates stale nodes left over from earlier
	 * indexing runs, which collide with reassigned numeric ids and cause search to
	 * silently return too few results.
	 */
	async getGraphStats(): Promise<{
		dimensions: number | null;
		hasIndex: boolean;
		nodeCount: number | null;
		mappedIdCount: number;
	}> {
		return (await this.call("getGraphStats")) as {
			dimensions: number | null;
			hasIndex: boolean;
			nodeCount: number | null;
			mappedIdCount: number;
		};
	}
}
