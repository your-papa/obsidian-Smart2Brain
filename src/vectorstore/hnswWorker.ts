/**
 * HNSW Worker
 *
 * Hosts the full HNSWVectorStore inside a Web Worker so all IndexedDB I/O
 * and CPU-intensive HNSW operations (build, search, add) run off the main thread.
 *
 * Communication uses a generic request/response protocol: each message is
 * { id, method, args } and the response is { id, result? , error? }.
 */

import { HNSWVectorStore } from "./HNSWVectorStore";
import type { DocumentVector } from "./types";
import { toFloat32Array } from "./similarity";

export interface HNSWWorkerRequest {
	id: number;
	method: string;
	args: unknown[];
}

export interface HNSWWorkerResponse {
	id: number;
	result?: unknown;
	error?: string;
}

let store: HNSWVectorStore | null = null;

/**
 * Convert a DocumentVector that crossed the postMessage boundary back.
 * Float32Array survives structured clone, but we defensively convert.
 */
function toDocVec(raw: unknown): DocumentVector {
	const d = raw as {
		id: string;
		path: string;
		mtime: number;
		checksum: string;
		vector: Float32Array | number[];
		chunkIndex?: number;
	};
	return {
		id: d.id,
		path: d.path,
		mtime: d.mtime,
		checksum: d.checksum,
		vector: d.vector instanceof Float32Array ? d.vector : toFloat32Array(d.vector),
		chunkIndex: d.chunkIndex,
	};
}

globalThis.onmessage = async (e: MessageEvent<HNSWWorkerRequest>) => {
	const { id, method, args } = e.data;
	try {
		let result: unknown;

		switch (method) {
			case "init": {
				const [vaultId, indexId] = args as [string, string | undefined];
				store = new HNSWVectorStore(vaultId, indexId);
				result = undefined;
				break;
			}
			case "open": {
				result = await requireStore().open();
				break;
			}
			case "close": {
				result = await requireStore().close();
				break;
			}
			case "getProviderId": {
				result = requireStore().providerId;
				break;
			}
			case "getModelId": {
				result = requireStore().modelId;
				break;
			}
			case "setMetadata": {
				const [providerId, modelId, version] = args as [string, string, number];
				result = await requireStore().setMetadata(providerId, modelId, version);
				break;
			}
			case "getMetadata": {
				result = await requireStore().getMetadata();
				break;
			}
			case "upsert": {
				const doc = toDocVec(args[0]);
				result = await requireStore().upsert(doc);
				break;
			}
			case "remove": {
				result = await requireStore().remove(args[0] as string);
				break;
			}
			case "getByPath": {
				const doc = await requireStore().getByPath(args[0] as string);
				result = doc ?? null;
				break;
			}
			case "getAllByPath": {
				result = await requireStore().getAllByPath(args[0] as string);
				break;
			}
			case "getDocumentMtime": {
				result = (await requireStore().getDocumentMtime(args[0] as string)) ?? null;
				break;
			}
			case "getAll": {
				result = await requireStore().getAll();
				break;
			}
			case "getAllSerialized": {
				result = await requireStore().getAllSerialized();
				break;
			}
			case "bulkPut": {
				const rawDocs = args[0] as unknown[];
				const docs = rawDocs.map(toDocVec);
				result = await requireStore().bulkPut(docs);
				break;
			}
			case "clear": {
				result = await requireStore().clear();
				break;
			}
			case "count": {
				result = await requireStore().count();
				break;
			}
			case "countNotes": {
				result = await requireStore().countNotes();
				break;
			}
			case "search": {
				const [queryVector, topK, threshold] = args as [Float32Array | number[], number, number | undefined];
				const qv = queryVector instanceof Float32Array ? queryVector : toFloat32Array(queryVector);
				result = await requireStore().search(qv, topK, threshold);
				break;
			}
			case "getGraphStats": {
				// Graph health, for diagnosing recall problems. `nodeCount` far
				// exceeding `mappedIdCount` means the persisted graph has retained
				// nodes from earlier indexing runs, whose numeric ids now collide
				// with freshly assigned ones — search then silently drops results.
				const s = requireStore() as unknown as {
					dimensions: number | null;
					hnswIndex: { nodes?: Map<number, unknown> } | null;
					numericToId: Map<number, string>;
				};
				result = {
					dimensions: s.dimensions,
					hasIndex: !!s.hnswIndex,
					nodeCount: s.hnswIndex?.nodes?.size ?? null,
					mappedIdCount: s.numericToId.size,
				};
				break;
			}
			default:
				throw new Error(`Unknown method: ${method}`);
		}

		const response: HNSWWorkerResponse = { id, result };
		globalThis.postMessage(response);
	} catch (err: unknown) {
		const response: HNSWWorkerResponse = {
			id,
			error: err instanceof Error ? err.message : String(err),
		};
		globalThis.postMessage(response);
	}
};

function requireStore(): HNSWVectorStore {
	if (!store) throw new Error("Worker not initialized. Call init first.");
	return store;
}
