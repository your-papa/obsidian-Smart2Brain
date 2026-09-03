/**
 * Compute Worker Manager
 *
 * Provides an async version of the graph's Leiden community detection that
 * runs in a Web Worker, keeping the main thread responsive.
 *
 * Falls back to synchronous main-thread execution if workers are unavailable.
 *
 * (The semantic edge scan is no longer routed through here: it runs inside the
 * vector store's worker, where the vectors already live — see
 * `VectorStore.semanticPairs`.)
 */

import type { ComputeWorkerRequest, ComputeWorkerResponse } from "./computeWorker";
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
		// The cast is the erasure described on `pending`: this resolver accepts the
		// caller's narrowed T, and the dispatcher only ever hands it the matching
		// response for this request id. Nothing is transferred, so the retained
		// request is the same object and stays usable for the recovery path.
		pending.set(request.id, {
			resolve: resolve as (value: ComputeWorkerResponse) => void,
			reject,
			request,
		});
		w.postMessage(request);
	});
}

/**
 * Main-thread fallback for when the worker is unavailable.
 */
function runOnMainThread(request: ComputeWorkerRequest): ComputeWorkerResponse {
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
