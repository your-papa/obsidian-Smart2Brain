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
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";

export interface SerializedVectorBatch {
	data: Float32Array;
	count: number;
	dim: number;
}

export type ComputeWorkerRequest =
	| { id: number; type: "kMeans"; vectors: SerializedVectorBatch; k: number; maxIterations?: number }
	| { id: number; type: "suggestK"; vectors: SerializedVectorBatch; minK?: number; maxK?: number }
	| {
			id: number;
			type: "hdbscan";
			vectors: SerializedVectorBatch;
			minClusterSize: number;
			minSamples?: number;
			metric?: "cosine" | "euclidean";
	  }
	| {
			id: number;
			type: "project2D";
			vectors: SerializedVectorBatch;
			method?: ProjectionMethod;
			spread?: number;
			umapNeighbors?: number;
			umapMinDist?: number;
			umapEpochs?: number;
	  }
	| {
			id: number;
			type: "reduceDimensions";
			vectors: SerializedVectorBatch;
			method?: ProjectionMethod;
			targetDim?: number;
			umapNeighbors?: number;
			umapMinDist?: number;
			umapEpochs?: number;
	  }
	| {
			id: number;
			type: "louvain";
			sources: string[];
			targets: string[];
			weights: number[];
			/** If true, also compute betweenness centrality on the same graph */
			withCentrality?: boolean;
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
	| { id: number; type: "reduceDimensions"; result: SerializedVectorBatch }
	| {
			id: number;
			type: "louvain";
			result: {
				communities: Record<string, number>;
				/** Normalized betweenness centrality per node (0–1). Only present when withCentrality was true. */
				centrality?: Record<string, number>;
			};
	  }
	| { id: number; type: "error"; error: string };

/**
 * Convert a flat vector batch from the message to Float32Array[] views.
 */
function toFloat32Arrays(batch: SerializedVectorBatch): Float32Array[] {
	const { data, count, dim } = batch;
	const vectors: Float32Array[] = new Array(count);
	for (let i = 0; i < count; i++) {
		vectors[i] = new Float32Array(data.buffer, i * dim * Float32Array.BYTES_PER_ELEMENT, dim);
	}
	return vectors;
}

function fromFloat32Arrays(vectors: Float32Array[]): SerializedVectorBatch {
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

const workerScope = globalThis as typeof globalThis & {
	postMessage: (message: ComputeWorkerResponse, transfer?: Transferable[]) => void;
	onmessage: ((event: MessageEvent<ComputeWorkerRequest>) => void | Promise<void>) | null;
};

workerScope.onmessage = async (e: MessageEvent<ComputeWorkerRequest>) => {
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
				workerScope.postMessage(response);
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
				workerScope.postMessage(response);
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
				workerScope.postMessage(response);
				break;
			}
			case "project2D": {
				const vectors = toFloat32Arrays(msg.vectors);
				const result = await project2D(vectors, msg.method, msg.spread, {
					nNeighbors: msg.umapNeighbors,
					minDist: msg.umapMinDist,
					nEpochs: msg.umapEpochs,
				});
				const response: ComputeWorkerResponse = {
					id: msg.id,
					type: "project2D",
					result,
				};
				workerScope.postMessage(response);
				break;
			}
			case "reduceDimensions": {
				const vectors = toFloat32Arrays(msg.vectors);
				const result = await reduceDimensions(vectors, msg.method, msg.targetDim, {
					nNeighbors: msg.umapNeighbors,
					minDist: msg.umapMinDist,
					nEpochs: msg.umapEpochs,
				});
				const response: ComputeWorkerResponse = {
					id: msg.id,
					type: "reduceDimensions",
					result: fromFloat32Arrays(result),
				};
				workerScope.postMessage(response, [response.result.data.buffer as ArrayBuffer]);
				break;
			}
			case "louvain": {
				const graph = new Graph({ type: "undirected", multi: false });
				for (let i = 0; i < msg.sources.length; i++) {
					if (msg.sources[i] !== msg.targets[i]) {
						graph.mergeEdge(msg.sources[i], msg.targets[i], { weight: msg.weights[i] });
					}
				}
				const communities: Record<string, number> = graph.order > 0 ? louvain(graph) : {};

				let centrality: Record<string, number> | undefined;
				if (msg.withCentrality && graph.order > 0) {
					// betweennessCentrality returns raw counts; we use normalized=true for 0–1 range
					centrality = betweennessCentrality(graph, { normalized: true, getEdgeWeight: "weight" });
				}

				workerScope.postMessage({
					id: msg.id,
					type: "louvain",
					result: { communities, centrality },
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
