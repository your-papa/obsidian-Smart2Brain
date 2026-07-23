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
import Graph from "graphology";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";
import { Graph as LeidenGraph, leiden } from "leiden-ts";

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<
	number,
	{ resolve: (value: any) => void; reject: (reason: any) => void; request: ComputeWorkerRequest }
>();

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
			// The worker died (failed to load, or crashed on a message). Honor the
			// documented contract: don't reject unrelated in-flight requests —
			// recompute each one synchronously on the main thread so a transient
			// worker failure degrades gracefully instead of surfacing spurious
			// errors for work that was otherwise fine.
			console.warn("[ComputeWorker] Worker error, falling back to main thread:", e.message);
			recoverPendingOnMainThread();
		};
		return worker;
	} catch {
		// Workers not available — fall back to synchronous
		return null;
	}
}

/**
 * Tear down the worker and re-run every in-flight request on the main thread,
 * settling each promise with the synchronous result. Used when the worker
 * errors out mid-flight (as opposed to an explicit `terminateWorker()`, which
 * rejects). Keeps callers whose work never reached the worker from failing.
 */
function recoverPendingOnMainThread(): void {
	if (worker) {
		worker.terminate();
		worker = null;
	}
	const entries = [...pending.values()];
	pending.clear();
	for (const entry of entries) {
		Promise.resolve()
			.then(() => runOnMainThread(entry.request))
			.then(entry.resolve, entry.reject);
	}
}

function postRequest<T extends ComputeWorkerResponse>(request: ComputeWorkerRequest): Promise<T> {
	const w = getWorker();
	if (!w) {
		// Fallback: run synchronously on main thread
		return Promise.resolve(runOnMainThread(request) as T);
	}

	return new Promise<T>((resolve, reject) => {
		// Store a recovery copy whose vector buffer is NOT the one we transfer.
		// `getTransferList` hands the buffer to the worker, which detaches it on
		// this thread; recomputing on the main thread from a detached buffer
		// would throw. Cloning first keeps the recovery path intact while the
		// worker still gets a zero-copy transfer of the original.
		pending.set(request.id, { resolve, reject, request: cloneRequestForRecovery(request) });
		w.postMessage(request, getTransferList(request));
	});
}

/**
 * Deep-copy the transferable vector buffer of a request so a retained copy
 * survives the `postMessage` transfer (which detaches the original's buffer on
 * this thread). Non-vector requests (e.g. `leiden`) transfer nothing and are
 * returned as-is.
 */
function cloneRequestForRecovery(request: ComputeWorkerRequest): ComputeWorkerRequest {
	if (request.type === "leiden") return request;
	const { data, count, dim } = request.vectors;
	// `data.slice()` allocates a fresh backing buffer, decoupled from the one
	// about to be transferred.
	return { ...request, vectors: { data: data.slice(), count, dim } };
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
		case "leiden":
			return [];
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
		case "leiden": {
			// Build an integer-indexed graph for leiden-ts (string node ids → indices)
			const nodeIndex = new Map<string, number>();
			for (let i = 0; i < request.sources.length; i++) {
				if (!nodeIndex.has(request.sources[i])) nodeIndex.set(request.sources[i], nodeIndex.size);
				if (!nodeIndex.has(request.targets[i])) nodeIndex.set(request.targets[i], nodeIndex.size);
			}
			const nodeCount = nodeIndex.size;
			const communities: Record<string, number> = {};

			if (nodeCount > 0) {
				const seen = new Set<string>();
				const edges: [number, number, number][] = [];
				for (let i = 0; i < request.sources.length; i++) {
					const u = nodeIndex.get(request.sources[i])!;
					const v = nodeIndex.get(request.targets[i])!;
					if (u === v) continue;
					const key = u < v ? `${u}:${v}` : `${v}:${u}`;
					if (!seen.has(key)) {
						seen.add(key);
						edges.push([u, v, request.weights[i]]);
					}
				}
				const lGraph = LeidenGraph.fromEdgeList(nodeCount, edges, { selfLoops: "collapse" });
				const result = leiden(lGraph, { seed: request.seed ?? 42, resolution: request.resolution ?? 1.0 });
				const assignments = result.partition.assignments;
				for (const [path, idx] of nodeIndex) {
					communities[path] = assignments[idx];
				}
			}

			let centrality: Record<string, number> | undefined;
			if (request.withCentrality && Object.keys(communities).length > 0) {
				const gGraph = new Graph({ type: "undirected", multi: false });
				for (let i = 0; i < request.sources.length; i++) {
					if (request.sources[i] !== request.targets[i]) {
						gGraph.mergeEdge(request.sources[i], request.targets[i], { weight: request.weights[i] });
					}
				}
				centrality = betweennessCentrality(gGraph, { normalized: true, getEdgeWeight: "weight" });
			}
			return { id: request.id, type: "leiden" as const, result: { communities, centrality } };
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

export async function leidenAsync(
	sources: string[],
	targets: string[],
	weights: number[],
	withCentrality = false,
	seed = 42,
	resolution = 1.0,
): Promise<{ communities: Record<string, number>; centrality: Record<string, number> }> {
	const id = ++requestId;
	const resp = await postRequest<Extract<ComputeWorkerResponse, { type: "leiden" }>>({
		id,
		type: "leiden",
		sources,
		targets,
		weights,
		withCentrality,
		seed,
		resolution,
	});
	return {
		communities: resp.result.communities,
		centrality: resp.result.centrality ?? {},
	};
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
