/**
 * Graph Data Builder
 *
 * Constructs a semantic map from document embeddings.
 * Node positions are projected from high-dimensional embedding space into 2D.
 * Clusters are assigned via K-Means — decoupled from edge/layout rebuilds so
 * users can change projection and clustering settings without losing their
 * cluster assignments. Wiki link edges can be optionally overlaid on top of
 * the projected map as authored structure.
 */

import type { App, TFile } from "obsidian";
import { getAllTags } from "obsidian";

import type { DocumentVector } from "../../vectorstore/types";
import {
	kMeansAsync,
	suggestKAsync,
	hdbscanAsync,
	project2DAsync,
	reduceDimensionsAsync,
} from "../../utils/computeWorkerManager";
import {
	type GraphData,
	type GraphEdge,
	type GraphNode,
	generateClusterColors,
	type SmartGraphSettings,
	type ColorGroup,
} from "../../types/graph";
import { edgeKey } from "../../utils/graphUtils";

// ============================================================================
// Cluster Assignment
// ============================================================================

/** Per-node cluster assignment with its display colour. */
export interface ClusterAssignment {
	cluster?: number;
	color: string;
}

// ============================================================================
// Filters
// ============================================================================

export interface GraphFilter {
	/** Only include files under these folder paths */
	folders?: string[];
	/** Only include files with these tags (any match) */
	tags?: string[];
	/** Search query to highlight matching nodes */
	searchQuery?: string;
}

/**
 * Check whether a file passes the given folder/tag filters.
 */
function passesFilter(app: App, file: TFile, filter?: GraphFilter): boolean {
	if (!filter) return true;

	// Folder filter (append "/" so "Work" doesn't match "Workshop/")
	if (filter.folders && filter.folders.length > 0) {
		const inFolder = filter.folders.some((f) => file.path.startsWith(f.endsWith("/") ? f : `${f}/`));
		if (!inFolder) return false;
	}

	// Tag filter
	if (filter.tags && filter.tags.length > 0) {
		const cache = app.metadataCache.getFileCache(file);
		const fileTags = cache ? (getAllTags(cache) ?? []) : [];
		const hasTag = filter.tags.some((t) => fileTags.includes(t));
		if (!hasTag) return false;
	}

	return true;
}

// ============================================================================
// Graph Structure (edges, positions, degree — no clustering)
// ============================================================================

/** Result of building the graph structure without cluster assignments. */
export interface GraphStructureResult {
	/** Graph data with nodes that have NO cluster/color set yet. */
	graphData: GraphData;
	/** The filtered documents used (needed for clustering later). */
	filteredDocs: DocumentVector[];
	/** Embedding vectors aligned with filteredDocs. */
	vectors: Float32Array[];
	/** Reduced vectors (PCA pre-clustering) — used for clustering. */
	reducedVectors: Float32Array[];
	/** Time spent reducing embeddings before the final layout projection. */
	reductionMs: number;
	/** Time spent projecting reduced vectors into 2D. */
	projection2DMs: number;
}

// ============================================================================
// Helper functions (extracted to reduce cognitive complexity)
// ============================================================================

export function filterDocuments(app: App, documents: DocumentVector[], filter?: GraphFilter): DocumentVector[] {
	if (!filter?.folders?.length && !filter?.tags?.length) return documents;
	return documents.filter((doc) => {
		const file = app.vault.getAbstractFileByPath(doc.path);
		if (!file || !("extension" in file)) return false;
		return passesFilter(app, file as TFile, filter);
	});
}
function buildWikiEdges(app: App, filteredPathSet: Set<string>): GraphEdge[] {
	const edges: GraphEdge[] = [];
	const wikiEdgeSet = new Set<string>();

	for (const [sourcePath, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (!filteredPathSet.has(sourcePath)) continue;
		for (const [targetPath, count] of Object.entries(targets)) {
			if (!filteredPathSet.has(targetPath) || sourcePath === targetPath) continue;
			const ek = edgeKey(sourcePath, targetPath);
			if (wikiEdgeSet.has(ek)) continue;
			wikiEdgeSet.add(ek);
			edges.push({ source: sourcePath, target: targetPath, weight: count, type: "wiki" });
		}
	}

	return edges;
}

function buildDegreeMap(edges: GraphEdge[]): Map<string, number> {
	const degreeMap = new Map<string, number>();
	for (const edge of edges) {
		degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
		degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
	}
	return degreeMap;
}

function createWikiNodes(filteredFiles: TFile[], degreeMap: Map<string, number>): GraphNode[] {
	const nodes: GraphNode[] = [];
	for (const file of filteredFiles) {
		const degree = degreeMap.get(file.path) ?? 0;
		const label = file.path.replace(/\.md$/, "").split("/").pop() ?? file.path;
		nodes.push({
			id: file.path,
			path: file.path,
			label,
			x: 0,
			y: 0,
			degree,
			highlighted: false,
		});
	}
	return nodes;
}

function mergeWikiEdge(edges: GraphEdge[], existingEdgeSet: Set<string>, wikiEdge: GraphEdge, ek: string): void {
	if (existingEdgeSet.has(ek)) {
		const idx = edges.findIndex((e) => edgeKey(e.source, e.target) === ek);
		if (idx !== -1) edges[idx] = wikiEdge;
	} else {
		edges.push(wikiEdge);
	}
}

export function overlayWikiEdges(app: App, edges: GraphEdge[], filteredPathSet: Set<string>): void {
	const resolvedLinks = app.metadataCache.resolvedLinks;
	const wikiEdgeSet = new Set<string>();
	const existingEdgeSet = new Set<string>();
	for (const e of edges) {
		existingEdgeSet.add(edgeKey(e.source, e.target));
	}

	for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
		if (!filteredPathSet.has(sourcePath)) continue;
		for (const [targetPath, count] of Object.entries(targets)) {
			if (!filteredPathSet.has(targetPath) || sourcePath === targetPath) continue;
			const ek = edgeKey(sourcePath, targetPath);
			if (wikiEdgeSet.has(ek)) continue;
			wikiEdgeSet.add(ek);
			mergeWikiEdge(
				edges,
				existingEdgeSet,
				{ source: sourcePath, target: targetPath, weight: count, type: "wiki" },
				ek,
			);
		}
	}
}

export function computeWikiDegree(edges: GraphEdge[]): Map<string, number> {
	const degreeMap = new Map<string, number>();

	for (const edge of edges) {
		if (edge.type !== "wiki") continue;
		degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
		degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
	}

	return degreeMap;
}

export function createGraphNodes(
	filtered: DocumentVector[],
	positions: { x: number; y: number }[],
	degreeMap: Map<string, number>,
): GraphNode[] {
	const nodes: GraphNode[] = [];
	for (let i = 0; i < filtered.length; i++) {
		const doc = filtered[i];
		const degree = degreeMap.get(doc.path) ?? 0;
		const label = doc.path.replace(/\.md$/, "").split("/").pop() ?? doc.path;
		nodes.push({
			id: doc.path,
			path: doc.path,
			label,
			x: positions[i].x,
			y: positions[i].y,
			degree,
			highlighted: false,
		});
	}
	return nodes;
}

/**
 * Build graph structure: filtering, edges, positions, degree, discovery flags.
 * Does NOT run K-Means — use {@link computeClusters} and {@link applyClusterMap}
 * to add cluster assignments separately.
 */
export async function buildGraphStructure(
	app: App,
	documents: DocumentVector[],
	settings: Pick<
		SmartGraphSettings,
		"projectionMethod" | "umapNeighbors" | "umapMinDist" | "layoutFidelity" | "showWikiLinks"
	>,
	filter?: GraphFilter,
): Promise<GraphStructureResult> {
	// Filter documents by folder/tag if specified
	const filtered = filterDocuments(app, documents, filter);

	if (filtered.length === 0) {
		return {
			graphData: { nodes: [], edges: [] },
			filteredDocs: [],
			vectors: [],
			reducedVectors: [],
			reductionMs: 0,
			projection2DMs: 0,
		};
	}

	// Extract vectors
	const vectors = filtered.map((doc) => doc.vector);
	const edges: GraphEdge[] = [];

	// Overlay wiki link edges
	const filteredPathSet = new Set(filtered.map((d) => d.path));
	overlayWikiEdges(app, edges, filteredPathSet);

	// Compute wiki connectivity independent of overlay visibility so the smart
	// map structure stays stable even when users hide wiki links.
	const degreeMap = computeWikiDegree(edges);
	const projectionPlan = getProjectionPlan(filtered.length, settings);

	// Always use PCA as the preprocessing stage. Running UMAP for both reduction
	// and final 2D projection compounds distortion and makes cluster structure
	// harder to interpret.
	const reductionStart = performance.now();
	const reducedVectors = await reduceDimensionsAsync(vectors, "pca", projectionPlan.reductionDim);
	const reductionMs = performance.now() - reductionStart;

	// Project the PCA-reduced vectors into 2D using the user-selected method.
	const projection2DStart = performance.now();
	const positions = await project2DAsync(reducedVectors, settings.projectionMethod, undefined, {
		nNeighbors: projectionPlan.umapNeighbors ?? settings.umapNeighbors,
		minDist: settings.umapMinDist,
		nEpochs: projectionPlan.umapEpochs,
	});
	const projection2DMs = performance.now() - projection2DStart;

	// Create nodes
	const nodes = createGraphNodes(filtered, positions, degreeMap);

	// Filter edges to only include edges with valid nodes
	const nodeIds = new Set(nodes.map((n) => n.id));
	const filteredEdges = settings.showWikiLinks
		? edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
		: [];

	return {
		graphData: { nodes, edges: filteredEdges },
		filteredDocs: filtered,
		vectors,
		reducedVectors,
		reductionMs,
		projection2DMs,
	};
}

// ============================================================================
// Clustering
// ============================================================================

/** Result of computing cluster assignments. */
export interface ClusterResult {
	/** Map from document path → cluster assignment (index + colour). */
	clusterMap: Map<string, ClusterAssignment>;
	/** The actual K used (useful when autoK is enabled). */
	k: number;
}

export type ClusterLabelMap = Record<number, string>;
export type ClusterRepresentativeMap = Map<number, GraphNode>;

/**
 * Compute cluster assignments using the configured algorithm.
 * Clustering runs on the reduced (PCA) vectors when available, which sit in a
 * sweet-spot dimensionality for density-based and centroid-based algorithms.
 *
 * @returns A map from document path to its cluster number and display colour,
 *          plus the K that was used.
 */

const NEUTRAL_CLUSTER_COLOR = "hsl(0, 0%, 50%)";
const LARGE_GRAPH_CLUSTERING_THRESHOLD = 2000;
const LARGE_GRAPH_CLUSTERING_SAMPLE_SIZE = 900;
const LARGE_GRAPH_CLUSTERING_MAX_K = 24;
const LARGE_GRAPH_PROJECTION_THRESHOLD = 2000;
const LARGE_GRAPH_UMAP_NEIGHBORS = 10;
const LARGE_GRAPH_UMAP_EPOCHS = 250;

export interface ProjectionPlan {
	reductionDim?: number;
	umapNeighbors?: number;
	umapEpochs?: number;
}

function interpolateInt(min: number, max: number, fidelity: number): number {
	return Math.round(min + (max - min) * fidelity);
}

function normalizeFidelity(value: number): number {
	return Math.max(0, Math.min(value, 100)) / 100;
}

export function getProjectionPlan(
	documentCount: number,
	settings: Pick<SmartGraphSettings, "projectionMethod" | "umapNeighbors" | "layoutFidelity">,
): ProjectionPlan {
	const fidelity = normalizeFidelity(settings.layoutFidelity);

	if (documentCount < 500) {
		return {
			reductionDim: interpolateInt(32, 50, fidelity),
			umapNeighbors:
				settings.projectionMethod === "umap"
					? Math.min(settings.umapNeighbors, interpolateInt(10, 18, fidelity))
					: undefined,
			umapEpochs: settings.projectionMethod === "umap" ? interpolateInt(180, 500, fidelity) : undefined,
		};
	}

	if (documentCount < LARGE_GRAPH_PROJECTION_THRESHOLD) {
		return {
			reductionDim: interpolateInt(24, 50, fidelity),
			umapNeighbors:
				settings.projectionMethod === "umap"
					? Math.min(settings.umapNeighbors, interpolateInt(8, 16, fidelity))
					: undefined,
			umapEpochs: settings.projectionMethod === "umap" ? interpolateInt(150, 420, fidelity) : undefined,
		};
	}

	return {
		reductionDim: interpolateInt(12, 36, fidelity),
		umapNeighbors:
			settings.projectionMethod === "umap"
				? Math.min(settings.umapNeighbors, interpolateInt(6, LARGE_GRAPH_UMAP_NEIGHBORS, fidelity))
				: undefined,
		umapEpochs:
			settings.projectionMethod === "umap" ? interpolateInt(120, LARGE_GRAPH_UMAP_EPOCHS, fidelity) : undefined,
	};
}

function euclideanDistance(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		const diff = a[i] - b[i];
		sum += diff * diff;
	}
	return Math.sqrt(sum);
}

function evenlySampleIndices(length: number, sampleSize: number): number[] {
	if (length <= sampleSize) {
		return Array.from({ length }, (_, index) => index);
	}

	const step = length / sampleSize;
	const indices: number[] = [];
	for (let i = 0; i < sampleSize; i++) {
		indices.push(Math.min(length - 1, Math.floor(i * step)));
	}
	return indices;
}

function nearestCentroid(vector: Float32Array, centroids: Float32Array[]): { cluster: number; distance: number } {
	let bestCluster = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < centroids.length; i++) {
		const distance = euclideanDistance(vector, centroids[i]);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestCluster = i;
		}
	}
	return { cluster: bestCluster, distance: bestDistance };
}

function quantile(values: number[], q: number): number {
	if (values.length === 0) return Number.POSITIVE_INFINITY;
	const sorted = [...values].sort((a, b) => a - b);
	const position = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
	return sorted[position];
}

async function computeLargeGraphFastClusters(
	clusterVectors: Float32Array[],
	minClusterSize: number,
): Promise<{ labels: Array<number | undefined>; k: number }> {
	const sampleIndices = evenlySampleIndices(clusterVectors.length, LARGE_GRAPH_CLUSTERING_SAMPLE_SIZE);
	const sampledVectors = sampleIndices.map((index) => clusterVectors[index]);
	const estimatedK = Math.max(
		2,
		Math.min(
			LARGE_GRAPH_CLUSTERING_MAX_K,
			Math.round(Math.sqrt(clusterVectors.length / Math.max(minClusterSize, 8))),
		),
	);
	const k = Math.min(estimatedK, sampledVectors.length);
	const sampleResult = await kMeansAsync(sampledVectors, k);

	const thresholdCandidates: number[][] = Array.from({ length: k }, () => []);
	for (let i = 0; i < sampledVectors.length; i++) {
		const cluster = sampleResult.labels[i];
		thresholdCandidates[cluster].push(euclideanDistance(sampledVectors[i], sampleResult.centroids[cluster]));
	}

	const clusterThresholds = thresholdCandidates.map((distances) => {
		const base = quantile(distances, 0.9);
		return Number.isFinite(base) ? base * 1.15 : Number.POSITIVE_INFINITY;
	});

	const labels: Array<number | undefined> = new Array(clusterVectors.length);
	for (let i = 0; i < clusterVectors.length; i++) {
		const nearest = nearestCentroid(clusterVectors[i], sampleResult.centroids);
		labels[i] = nearest.distance <= clusterThresholds[nearest.cluster] ? nearest.cluster : undefined;
	}

	return { labels, k };
}

export async function computeClusters(
	filteredDocs: DocumentVector[],
	vectors: Float32Array[],
	settings: Pick<SmartGraphSettings, "defaultK" | "autoK" | "clusteringAlgorithm" | "minClusterSize">,
	themeColors?: string[],
	reducedVectors?: Float32Array[],
): Promise<ClusterResult> {
	if (filteredDocs.length === 0 || vectors.length === 0) {
		return { clusterMap: new Map(), k: 0 };
	}

	// Prefer reduced vectors for clustering — they retain enough structure
	// for meaningful clusters while avoiding the curse of dimensionality.
	const clusterVectors = reducedVectors?.length === vectors.length ? reducedVectors : vectors;

	let k: number;
	let clusterLabels: Array<number | undefined>;

	if (settings.clusteringAlgorithm === "hdbscan") {
		if (clusterVectors.length >= LARGE_GRAPH_CLUSTERING_THRESHOLD) {
			const fastResult = await computeLargeGraphFastClusters(clusterVectors, settings.minClusterSize);
			k = fastResult.k;
			clusterLabels = fastResult.labels;
		} else {
			const result = await hdbscanAsync(clusterVectors, settings.minClusterSize, undefined, "euclidean");
			k = result.numClusters;
			clusterLabels = result.labels.map((label) => (label >= 0 ? label : undefined));
		}
	} else if (settings.autoK) {
		const suggested = await suggestKAsync(clusterVectors, 2, Math.min(10, Math.floor(clusterVectors.length / 2)));
		k = suggested.k;
		clusterLabels = suggested.result.labels;
	} else {
		k = Math.min(settings.defaultK, clusterVectors.length - 1);
		const clusterResult = await kMeansAsync(clusterVectors, Math.max(1, k));
		clusterLabels = clusterResult.labels;
	}

	const clusterColors = generateClusterColors(Math.max(1, k), themeColors);

	const clusterMap = new Map<string, ClusterAssignment>();
	for (let i = 0; i < filteredDocs.length; i++) {
		const cluster = clusterLabels[i];
		clusterMap.set(filteredDocs[i].path, {
			cluster,
			color: cluster === undefined ? NEUTRAL_CLUSTER_COLOR : clusterColors[cluster % clusterColors.length],
		});
	}

	return { clusterMap, k };
}

/**
 * Apply cluster assignments to graph data.
 * Nodes whose path exists in the clusterMap get the stored cluster/color.
 * Nodes without a mapping keep cluster undefined and receive a neutral fallback color.
 */
export function applyClusterMap(
	graphData: GraphData,
	clusterMap: Map<string, ClusterAssignment>,
	fallbackColor = NEUTRAL_CLUSTER_COLOR,
): GraphData {
	return {
		...graphData,
		nodes: graphData.nodes.map((node) => {
			const assignment = clusterMap.get(node.id);
			if (assignment) {
				return { ...node, cluster: assignment.cluster, color: assignment.color };
			}
			return { ...node, cluster: undefined, color: fallbackColor };
		}),
	};
}

/**
 * Derive cluster labels from the best-connected note inside each cluster.
 * Internal cluster degree is preferred; total wiki degree is used as a fallback.
 */
export function deriveClusterRepresentativesFromGraph(graphData: GraphData): ClusterRepresentativeMap {
	const nodeById = new Map(graphData.nodes.map((node) => [node.id, node]));
	const clusterNodes = new Map<number, GraphNode[]>();
	for (const node of graphData.nodes) {
		if (node.cluster == null) continue;
		const group = clusterNodes.get(node.cluster) ?? [];
		group.push(node);
		clusterNodes.set(node.cluster, group);
	}

	const internalDegrees = new Map<string, number>();
	for (const edge of graphData.edges) {
		const source = nodeById.get(edge.source);
		const target = nodeById.get(edge.target);
		if (!source || !target || source.cluster == null || source.cluster !== target.cluster) continue;

		internalDegrees.set(source.id, (internalDegrees.get(source.id) ?? 0) + 1);
		internalDegrees.set(target.id, (internalDegrees.get(target.id) ?? 0) + 1);
	}

	const representatives: ClusterRepresentativeMap = new Map();
	for (const [clusterId, nodes] of clusterNodes) {
		const hubNode = [...nodes].sort((left, right) => {
			const internalDiff = (internalDegrees.get(right.id) ?? 0) - (internalDegrees.get(left.id) ?? 0);
			if (internalDiff !== 0) return internalDiff;

			const degreeDiff = (right.degree ?? 0) - (left.degree ?? 0);
			if (degreeDiff !== 0) return degreeDiff;

			const labelDiff = left.label.localeCompare(right.label);
			if (labelDiff !== 0) return labelDiff;

			return left.id.localeCompare(right.id);
		})[0];

		if (hubNode) {
			representatives.set(clusterId, hubNode);
		}
	}

	return representatives;
}

export function deriveClusterLabelsFromGraph(graphData: GraphData): ClusterLabelMap {
	const labels: ClusterLabelMap = {};
	for (const [clusterId, hubNode] of deriveClusterRepresentativesFromGraph(graphData)) {
		labels[clusterId] = hubNode.label;
	}

	return labels;
}

// ============================================================================
// Wiki-only graph (initial Obsidian-like view)
// ============================================================================

/** Result of building a wiki-link-only graph (no projection). */
export interface WikiGraphResult {
	graphData: GraphData;
	filteredPaths: string[];
}

/**
 * Build a graph using only Obsidian wiki-link edges. Nodes start at (0,0) and
 * are positioned by d3-force.
 *
 * @param constrainToPaths — When provided, only include files whose path is in
 *   this set. Used to keep the wiki graph's node set identical to the smart
 *   graph's so mode transitions don't add/remove nodes.
 */
export function buildWikiGraph(app: App, filter?: GraphFilter, constrainToPaths?: Set<string>): WikiGraphResult {
	let filteredFiles = app.vault.getMarkdownFiles();
	if (constrainToPaths) {
		filteredFiles = filteredFiles.filter((file) => constrainToPaths.has(file.path));
	}
	if (filter?.folders?.length || filter?.tags?.length) {
		filteredFiles = filteredFiles.filter((file) => passesFilter(app, file, filter));
	}

	if (filteredFiles.length === 0) {
		return { graphData: { nodes: [], edges: [] }, filteredPaths: [] };
	}

	const filteredPaths = filteredFiles.map((file) => file.path);
	const filteredPathSet = new Set(filteredPaths);
	const edges = buildWikiEdges(app, filteredPathSet);
	const degreeMap = buildDegreeMap(edges);
	const nodes = createWikiNodes(filteredFiles, degreeMap);

	const nodeIds = new Set(nodes.map((n) => n.id));
	const filteredEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

	return { graphData: { nodes, edges: filteredEdges }, filteredPaths };
}

// ============================================================================
// Color groups
// ============================================================================

/**
 * Check whether a file matches a color group query.
 * - Queries starting with `#` match tags.
 * - All other queries match as a path prefix (folder).
 */
function matchesColorGroup(app: App, path: string, group: ColorGroup): boolean {
	const q = group.query.trim();
	if (!q) return false;
	if (q.startsWith("#")) {
		const file = app.vault.getAbstractFileByPath(path);
		if (!file || !("extension" in file)) return false;
		const cache = app.metadataCache.getFileCache(file as TFile);
		const tags = cache ? (getAllTags(cache) ?? []) : [];
		return tags.includes(q);
	}
	// Folder / path prefix
	const prefix = q.endsWith("/") ? q : `${q}/`;
	return path.startsWith(prefix);
}

/**
 * Apply user-defined color groups to graph nodes.
 * First matching group wins; unmatched nodes keep their existing color.
 */
export function applyColorGroups(app: App, graphData: GraphData, colorGroups: ColorGroup[]): GraphData {
	if (colorGroups.length === 0) return graphData;
	return {
		...graphData,
		nodes: graphData.nodes.map((node) => {
			for (const group of colorGroups) {
				if (matchesColorGroup(app, node.path, group)) {
					return { ...node, color: group.color };
				}
			}
			return node;
		}),
	};
}

// ============================================================================
// Convenience: build + cluster in one call (used by Refresh / initial load)
// ============================================================================

/**
 * Build a fully-clustered graph in a single call.
 * Equivalent to calling {@link buildGraphStructure} then {@link computeClusters}
 * then {@link applyClusterMap}.
 */
export async function buildGraph(
	app: App,
	documents: DocumentVector[],
	settings: Pick<
		SmartGraphSettings,
		| "defaultK"
		| "autoK"
		| "projectionMethod"
		| "umapNeighbors"
		| "umapMinDist"
		| "layoutFidelity"
		| "showWikiLinks"
		| "clusteringAlgorithm"
		| "minClusterSize"
	>,
	filter?: GraphFilter,
	themeColors?: string[],
): Promise<GraphData> {
	const { graphData, filteredDocs, vectors, reducedVectors } = await buildGraphStructure(
		app,
		documents,
		settings,
		filter,
	);
	const { clusterMap } = await computeClusters(filteredDocs, vectors, settings, themeColors, reducedVectors);
	return applyClusterMap(graphData, clusterMap);
}

/**
 * Apply search highlighting to graph nodes.
 * Nodes whose label matches the query get `highlighted = true`.
 */
export function applySearchHighlight(data: GraphData, query: string): GraphData {
	if (!query.trim()) {
		return {
			...data,
			nodes: data.nodes.map((n) => ({ ...n, highlighted: false })),
		};
	}

	const lower = query.toLowerCase();
	return {
		...data,
		nodes: data.nodes.map((n) => ({
			...n,
			highlighted: n.label.toLowerCase().includes(lower) || n.path.toLowerCase().includes(lower),
		})),
	};
}
