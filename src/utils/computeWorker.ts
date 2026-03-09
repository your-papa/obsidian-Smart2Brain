/**
 * Compute Web Worker
 *
 * Runs clustering (K-Means, suggestK, HDBSCAN) and projection (PCA, UMAP)
 * computations off the main thread.
 * Messages follow a request/response pattern with a shared `id` for correlation.
 */

import { kMeans, suggestK, hdbscan } from "./clustering";
import type { HDBSCANResult } from "./clustering";
import { project2D, reduceDimensions } from "./projection";
import type { ProjectionMethod } from "../types/graph";

export type ComputeWorkerRequest =
	| { id: number; type: "kMeans"; vectors: number[][]; k: number; maxIterations?: number }
	| { id: number; type: "suggestK"; vectors: number[][]; minK?: number; maxK?: number }
	| {
			id: number;
			type: "hdbscan";
			vectors: number[][];
			minClusterSize: number;
			minSamples?: number;
			metric?: "cosine" | "euclidean";
	  }
	| {
			id: number;
			type: "project2D";
			vectors: number[][];
			method?: ProjectionMethod;
			spread?: number;
			umapNeighbors?: number;
			umapMinDist?: number;
	  }
	| {
			id: number;
			type: "reduceDimensions";
			vectors: number[][];
			method?: ProjectionMethod;
			targetDim?: number;
			umapNeighbors?: number;
			umapMinDist?: number;
	  };

export type ComputeWorkerResponse =
	| { id: number; type: "kMeans"; result: { labels: number[]; centroids: number[][]; iterations: number } }
	| {
			id: number;
			type: "suggestK";
			result: { k: number; labels: number[]; centroids: number[][]; iterations: number };
	  }
	| { id: number; type: "hdbscan"; result: HDBSCANResult }
	| { id: number; type: "project2D"; result: { x: number; y: number }[] }
	| { id: number; type: "reduceDimensions"; result: number[][] }
	| { id: number; type: "error"; error: string };

/**
 * Convert number[][] from the message to Float32Array[] for clustering functions.
 */
function toFloat32Arrays(arrays: number[][]): Float32Array[] {
	return arrays.map((a) => new Float32Array(a));
}

globalThis.onmessage = async (e: MessageEvent<ComputeWorkerRequest>) => {
	const msg = e.data;
	try {
		switch (msg.type) {
			case "kMeans": {
				const vectors = toFloat32Arrays(msg.vectors);
				const result = kMeans(vectors, msg.k, msg.maxIterations);
				const response: ComputeWorkerResponse = {
					id: msg.id,
					type: "kMeans",
					result: {
						labels: result.labels,
						centroids: result.centroids.map((c) => Array.from(c)),
						iterations: result.iterations,
					},
				};
				globalThis.postMessage(response);
				break;
			}
			case "suggestK": {
				const vectors = toFloat32Arrays(msg.vectors);
				const { k, result } = suggestK(vectors, msg.minK, msg.maxK);
				const response: ComputeWorkerResponse = {
					id: msg.id,
					type: "suggestK",
					result: {
						k,
						labels: result.labels,
						centroids: result.centroids.map((c) => Array.from(c)),
						iterations: result.iterations,
					},
				};
				globalThis.postMessage(response);
				break;
			}
			case "hdbscan": {
				const vectors = toFloat32Arrays(msg.vectors);
				const result = hdbscan(vectors, msg.minClusterSize, msg.minSamples, msg.metric);
				const response: ComputeWorkerResponse = {
					id: msg.id,
					type: "hdbscan",
					result,
				};
				globalThis.postMessage(response);
				break;
			}
			case "project2D": {
				const vectors = toFloat32Arrays(msg.vectors);
				const result = await project2D(vectors, msg.method, msg.spread, {
					nNeighbors: msg.umapNeighbors,
					minDist: msg.umapMinDist,
				});
				const response: ComputeWorkerResponse = {
					id: msg.id,
					type: "project2D",
					result,
				};
				globalThis.postMessage(response);
				break;
			}
			case "reduceDimensions": {
				const vectors = toFloat32Arrays(msg.vectors);
				const result = await reduceDimensions(vectors, msg.method, msg.targetDim, {
					nNeighbors: msg.umapNeighbors,
					minDist: msg.umapMinDist,
				});
				const response: ComputeWorkerResponse = {
					id: msg.id,
					type: "reduceDimensions",
					result: result.map((v) => Array.from(v)),
				};
				globalThis.postMessage(response);
				break;
			}
		}
	} catch (err) {
		const response: ComputeWorkerResponse = {
			id: msg.id,
			type: "error",
			error: err instanceof Error ? err.message : String(err),
		};
		globalThis.postMessage(response);
	}
};
