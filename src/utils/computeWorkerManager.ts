/**
 * Compute Worker Manager
 *
 * Provides async versions of the graph's heavy computations (Leiden community
 * detection, the semantic edge scan) that run in a Web Worker, keeping the main
 * thread responsive.
 *
 * Falls back to synchronous main-thread execution if workers are unavailable.
 */

import type { ComputeWorkerRequest, ComputeWorkerResponse, SerializedVectorBatch } from "./computeWorker";
import { computeSemanticPairs, type SemanticPair } from "./semanticEdges";
import ComputeWorkerConstructor from "./computeWorker?worker&inline";
import { Graph as LeidenGraph, leiden } from "leiden-ts";

let worker: Worker | null = null;
let requestId = 0;
// One map serves every generic caller, so the per-request `T` is erased on insert and
// restored by the caller's own await. Storing the resolver as taking the full response
// union (with one cast at the registration site) keeps that erasure explicit — the old
// `any` hid it, and also hid that `reject` only ever receives an Error.
const pending = new Map<
	number,
	{ resolve: (value: ComputeWorkerResponse) => void; reject: (reason: Error) => void; request: ComputeWorkerRequest }
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
		// The cast is the erasure described on `pending`: this resolver accepts the
		// caller's narrowed T, and the dispatcher only ever hands it the matching
		// response for this request id.
		pending.set(request.id, {
			resolve: resolve as (value: ComputeWorkerResponse) => void,
			reject,
			request: cloneRequestForRecovery(request),
		});
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
	// about to be transferred. `chunkOwners` transfers separately and needs the
	// same treatment.
	return {
		...request,
		vectors: { data: data.slice(), count, dim },
		chunkOwners: request.chunkOwners.slice(),
	};
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

function getTransferList(request: ComputeWorkerRequest): Transferable[] {
	switch (request.type) {
		case "semanticEdges":
			return [request.vectors.data.buffer, request.chunkOwners.buffer];
		case "leiden":
			return [];
	}
}

/**
 * Main-thread fallback for when the worker is unavailable.
 */
function runOnMainThread(request: ComputeWorkerRequest): ComputeWorkerResponse | Promise<ComputeWorkerResponse> {
	switch (request.type) {
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
					// nodeIndex was just built by walking these same two arrays, so every
					// endpoint is present by construction — the assertions cannot fail.
					// biome-ignore lint/style/noNonNullAssertion: see above
					const u = nodeIndex.get(request.sources[i])!;
					// biome-ignore lint/style/noNonNullAssertion: see above
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
			return { id: request.id, type: "leiden" as const, result: { communities } };
		}
		case "semanticEdges": {
			return computeSemanticPairs(
				request.vectors.data,
				request.vectors.count,
				request.vectors.dim,
				request.chunkOwners,
				request.noteCount,
				{
					neighborCount: request.neighborCount,
					threshold: request.threshold,
					excludePairs: request.excludePairs ? new Set(request.excludePairs) : undefined,
				},
			).then((result) => ({ id: request.id, type: "semanticEdges" as const, result }));
		}
	}
}

// ============================================================================
// Public async API
// ============================================================================

export async function leidenAsync(
	sources: string[],
	targets: string[],
	weights: number[],
	seed = 42,
	resolution = 1.0,
): Promise<Record<string, number>> {
	const id = ++requestId;
	const resp = await postRequest<Extract<ComputeWorkerResponse, { type: "leiden" }>>({
		id,
		type: "leiden",
		sources,
		targets,
		weights,
		seed,
		resolution,
	});
	return resp.result.communities;
}

/**
 * Run the semantic pairwise scan off the main thread.
 *
 * Takes chunk-level vectors plus the note each chunk belongs to, and returns
 * scored note-index pairs. Indices refer to the caller's own note ordering.
 */
export async function semanticEdgesAsync(
	vectors: Float32Array[],
	chunkOwners: Int32Array,
	noteCount: number,
	options: { neighborCount?: number; threshold?: number; excludePairs?: Set<string> } = {},
): Promise<SemanticPair[]> {
	if (vectors.length === 0 || noteCount < 2) return [];

	const id = ++requestId;
	const resp = await postRequest<Extract<ComputeWorkerResponse, { type: "semanticEdges" }>>({
		id,
		type: "semanticEdges",
		vectors: toTransferable(vectors),
		chunkOwners,
		noteCount,
		neighborCount: options.neighborCount,
		threshold: options.threshold,
		excludePairs: options.excludePairs ? [...options.excludePairs] : undefined,
	});
	return resp.result;
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
