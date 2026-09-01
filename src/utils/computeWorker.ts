/**
 * Compute Web Worker
 *
 * Runs Leiden community detection and the semantic edge scan off the main
 * thread. Messages follow a request/response pattern with a shared `id` for
 * correlation.
 */

import { computeSemanticPairs, type SemanticPair } from "./semanticEdges";
import { Graph as LeidenGraph, leiden } from "leiden-ts";

export interface SerializedVectorBatch {
	data: Float32Array;
	count: number;
	dim: number;
}

export type ComputeWorkerRequest =
	| {
			id: number;
			type: "leiden";
			sources: string[];
			targets: string[];
			weights: number[];
			/** PRNG seed for reproducibility (default 42) */
			seed?: number;
			/** Resolution γ — lower = fewer larger communities (default 1.0) */
			resolution?: number;
	  }
	| {
			id: number;
			type: "semanticEdges";
			/** Flat chunk vectors — one note may own several chunks. */
			vectors: SerializedVectorBatch;
			/** `chunkOwners[i]` is the note index owning chunk `i`. */
			chunkOwners: Int32Array;
			/** Number of distinct notes (indices are 0..noteCount-1). */
			noteCount: number;
			neighborCount?: number;
			threshold?: number;
			/** Note-index pairs (`${min}:${max}`) to skip — already wiki-linked. */
			excludePairs?: string[];
	  };

export type ComputeWorkerResponse =
	| {
			id: number;
			type: "leiden";
			result: { communities: Record<string, number> };
	  }
	| {
			id: number;
			type: "semanticEdges";
			/** Scored note-index pairs; callers map indices back to paths. */
			result: SemanticPair[];
	  }
	| { id: number; type: "error"; error: string };

const workerScope = globalThis as typeof globalThis & {
	postMessage: (message: ComputeWorkerResponse, transfer?: Transferable[]) => void;
	onmessage: ((event: MessageEvent<ComputeWorkerRequest>) => void | Promise<void>) | null;
};

workerScope.onmessage = async (e: MessageEvent<ComputeWorkerRequest>) => {
	const msg = e.data;
	try {
		switch (msg.type) {
			case "leiden": {
				// Build an integer-indexed graph for leiden-ts (string node ids → indices)
				const nodeIndex = new Map<string, number>();
				for (let i = 0; i < msg.sources.length; i++) {
					if (!nodeIndex.has(msg.sources[i])) nodeIndex.set(msg.sources[i], nodeIndex.size);
					if (!nodeIndex.has(msg.targets[i])) nodeIndex.set(msg.targets[i], nodeIndex.size);
				}
				const nodeCount = nodeIndex.size;
				const communities: Record<string, number> = {};

				if (nodeCount > 0) {
					// Deduplicate edges (leiden-ts rejects duplicate undirected edges)
					const seen = new Set<string>();
					const edges: [number, number, number][] = [];
					for (let i = 0; i < msg.sources.length; i++) {
						const u = nodeIndex.get(msg.sources[i])!;
						const v = nodeIndex.get(msg.targets[i])!;
						if (u === v) continue;
						const key = u < v ? `${u}:${v}` : `${v}:${u}`;
						if (!seen.has(key)) {
							seen.add(key);
							edges.push([u, v, msg.weights[i]]);
						}
					}
					const lGraph = LeidenGraph.fromEdgeList(nodeCount, edges, { selfLoops: "collapse" });
					const result = leiden(lGraph, { seed: msg.seed ?? 42, resolution: msg.resolution ?? 1.0 });
					const assignments = result.partition.assignments;
					for (const [path, idx] of nodeIndex) {
						communities[path] = assignments[idx];
					}
				}

				workerScope.postMessage({
					id: msg.id,
					type: "leiden",
					result: { communities },
				} satisfies ComputeWorkerResponse);
				break;
			}
			case "semanticEdges": {
				const result = await computeSemanticPairs(
					msg.vectors.data,
					msg.vectors.count,
					msg.vectors.dim,
					msg.chunkOwners,
					msg.noteCount,
					{
						neighborCount: msg.neighborCount,
						threshold: msg.threshold,
						excludePairs: msg.excludePairs ? new Set(msg.excludePairs) : undefined,
					},
				);
				workerScope.postMessage({
					id: msg.id,
					type: "semanticEdges",
					result,
				} satisfies ComputeWorkerResponse);
				break;
			}
		}
	} catch (err) {
		const response: ComputeWorkerResponse = {
			id: msg.id,
			type: "error",
			error: err instanceof Error ? err.message : String(err),
		};
		workerScope.postMessage(response);
	}
};
