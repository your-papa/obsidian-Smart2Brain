/**
 * Compute Worker Manager
 *
 * Provides async versions of clustering and projection functions that run in a
 * Web Worker, keeping the main thread responsive during heavy computations.
 *
 * Falls back to synchronous main-thread execution if workers are unavailable.
 */

import { kMeans, suggestK, hdbscan, type KMeansResult, type HDBSCANResult } from "./clustering";
import { project2D, reduceDimensions } from "./projection";
import type { ProjectionMethod } from "../types/graph";
import type { ComputeWorkerRequest, ComputeWorkerResponse, SerializedVectorBatch } from "./computeWorker";
import ComputeWorkerConstructor from "./computeWorker?worker&inline";

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: any) => void }>();

function getWorker(): Worker | null {
	if (worker) return worker;
	try {
		worker = new ComputeWorkerConstructor({ name: "s2b-compute" });
		worker.onmessage = (e: MessageEvent<ComputeWorkerResponse>) => {
			const msg = e.data;
			const entry = pending.get(msg.id);
			if (!entry) return;
			pending.delete(msg.id);

			if (msg.type === "error") {
				entry.reject(new Error(msg.error));
			} else {
				entry.resolve(msg);
			}
		};
		worker.onerror = (e) => {
			// If the worker fails to load, fall back to main-thread execution
			console.warn("[ComputeWorker] Worker error, falling back to main thread:", e.message);
			terminateWorker();
		};
		return worker;
	} catch {
		// Workers not available — fall back to synchronous
		return null;
	}
}

function postRequest<T extends ComputeWorkerResponse>(request: ComputeWorkerRequest): Promise<T> {
	const w = getWorker();
	if (!w) {
		// Fallback: run synchronously on main thread
		return Promise.resolve(runOnMainThread(request) as T);
	}

	return new Promise<T>((resolve, reject) => {
		pending.set(request.id, { resolve, reject });
		w.postMessage(request, getTransferList(request));
	});
}

/**
 * Convert vectors to a flat Float32Array batch for worker transfer.
 */
function toTransferable(vectors: (Float32Array | number[])[]): SerializedVectorBatch {
	if (vectors.length === 0) {
		return { data: new Float32Array(0), count: 0, dim: 0 };
	}

	const count = vectors.length;
	const dim = vectors[0].length;
	const data = new Float32Array(count * dim);
	for (let i = 0; i < count; i++) {
		data.set(vectors[i], i * dim);
	}
	return { data, count, dim };
}

function fromTransferable(batch: SerializedVectorBatch): Float32Array[] {
	const { data, count, dim } = batch;
	const vectors: Float32Array[] = new Array(count);
	for (let i = 0; i < count; i++) {
		vectors[i] = new Float32Array(data.buffer, i * dim * Float32Array.BYTES_PER_ELEMENT, dim);
	}
	return vectors;
}

function getTransferList(request: ComputeWorkerRequest): Transferable[] {
	switch (request.type) {
		case "kMeans":
		case "suggestK":
		case "hdbscan":
		case "project2D":
		case "reduceDimensions":
			return [request.vectors.data.buffer];
	}
}

/**
 * Main-thread fallback for when the worker is unavailable.
 */
function runOnMainThread(request: ComputeWorkerRequest): ComputeWorkerResponse | Promise<ComputeWorkerResponse> {
	const toF32 = (batch: SerializedVectorBatch) => fromTransferable(batch);
	switch (request.type) {
		case "kMeans": {
			const result = kMeans(toF32(request.vectors), request.k, request.maxIterations);
			return {
				id: request.id,
				type: "kMeans",
				result: {
					labels: result.labels,
					centroids: result.centroids.map((c) => Array.from(c)),
					iterations: result.iterations,
				},
			};
		}
		case "suggestK": {
			const { k, result } = suggestK(toF32(request.vectors), request.minK, request.maxK);
			return {
				id: request.id,
				type: "suggestK",
				result: {
					k,
					labels: result.labels,
					centroids: result.centroids.map((c) => Array.from(c)),
					iterations: result.iterations,
				},
			};
		}
		case "hdbscan": {
			const result = hdbscan(toF32(request.vectors), request.minClusterSize, request.minSamples, request.metric);
			return { id: request.id, type: "hdbscan", result };
		}
		case "project2D": {
			return project2D(toF32(request.vectors), request.method, request.spread, {
				nNeighbors: request.umapNeighbors,
				minDist: request.umapMinDist,
				nEpochs: request.umapEpochs,
			}).then((result) => ({
				id: request.id,
				type: "project2D" as const,
				result,
			}));
		}
		case "reduceDimensions": {
			return reduceDimensions(toF32(request.vectors), request.method, request.targetDim, {
				nNeighbors: request.umapNeighbors,
				minDist: request.umapMinDist,
				nEpochs: request.umapEpochs,
			}).then((result) => ({
				id: request.id,
				type: "reduceDimensions" as const,
				result: toTransferable(result),
			}));
		}
	}
}

// ============================================================================
// Public async API
// ============================================================================

export async function kMeansAsync(vectors: Float32Array[], k: number, maxIterations?: number): Promise<KMeansResult> {
	const id = ++requestId;
	const resp = await postRequest<Extract<ComputeWorkerResponse, { type: "kMeans" }>>({
		id,
		type: "kMeans",
		vectors: toTransferable(vectors),
		k,
		maxIterations,
	});
	return {
		labels: resp.result.labels,
		centroids: resp.result.centroids.map((c) => new Float32Array(c)),
		iterations: resp.result.iterations,
	};
}

export async function suggestKAsync(
	vectors: Float32Array[],
	minK = 2,
	maxK = 10,
): Promise<{ k: number; result: KMeansResult }> {
	const id = ++requestId;
	const resp = await postRequest<Extract<ComputeWorkerResponse, { type: "suggestK" }>>({
		id,
		type: "suggestK",
		vectors: toTransferable(vectors),
		minK,
		maxK,
	});
	return {
		k: resp.result.k,
		result: {
			labels: resp.result.labels,
			centroids: resp.result.centroids.map((c) => new Float32Array(c)),
			iterations: resp.result.iterations,
		},
	};
}

export async function hdbscanAsync(
	vectors: Float32Array[],
	minClusterSize = 5,
	minSamples?: number,
	metric: "cosine" | "euclidean" = "cosine",
): Promise<HDBSCANResult> {
	const id = ++requestId;
	const resp = await postRequest<Extract<ComputeWorkerResponse, { type: "hdbscan" }>>({
		id,
		type: "hdbscan",
		vectors: toTransferable(vectors),
		minClusterSize,
		minSamples,
		metric,
	});
	return resp.result;
}

export async function project2DAsync(
	vectors: (Float32Array | number[])[],
	method: ProjectionMethod = "umap",
	spread = 500,
	umapOptions?: { nNeighbors?: number; minDist?: number; nEpochs?: number },
): Promise<{ x: number; y: number }[]> {
	const id = ++requestId;
	const resp = await postRequest<Extract<ComputeWorkerResponse, { type: "project2D" }>>({
		id,
		type: "project2D",
		vectors: toTransferable(vectors),
		method,
		spread,
		umapNeighbors: umapOptions?.nNeighbors,
		umapMinDist: umapOptions?.minDist,
		umapEpochs: umapOptions?.nEpochs,
	});
	return resp.result;
}

export async function reduceDimensionsAsync(
	vectors: Float32Array[],
	method: ProjectionMethod = "pca",
	targetDim?: number,
	umapOptions?: { nNeighbors?: number; minDist?: number; nEpochs?: number },
): Promise<Float32Array[]> {
	const id = ++requestId;
	const resp = await postRequest<Extract<ComputeWorkerResponse, { type: "reduceDimensions" }>>({
		id,
		type: "reduceDimensions",
		vectors: toTransferable(vectors),
		method,
		targetDim,
		umapNeighbors: umapOptions?.nNeighbors,
		umapMinDist: umapOptions?.minDist,
		umapEpochs: umapOptions?.nEpochs,
	});
	return fromTransferable(resp.result);
}

/**
 * Terminate the worker. Call this on plugin unload.
 */
export function terminateWorker(): void {
	if (worker) {
		worker.terminate();
		worker = null;
		// Reject any pending requests
		for (const [, entry] of pending) {
			entry.reject(new Error("Worker terminated"));
		}
		pending.clear();
	}
}
