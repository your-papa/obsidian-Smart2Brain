/**
 * Graph Data Builder
 *
 * Constructs a unified semantic graph from document embeddings.
 * Node positions are projected from high-dimensional embedding space into 2D.
 * Clusters are assigned via K-Means — decoupled from edge/layout rebuilds so
 * users can change connectivity settings without losing their cluster assignments.
 * Wiki link edges can be optionally overlaid alongside semantic similarity edges,
 * rendered with distinct visual styling.
 */

import type { App, TFile } from "obsidian";
import { getAllTags } from "obsidian";

import type { DocumentVector } from "../../vectorstore/types";
import { cosineSimilarity } from "../../vectorstore/similarity";
import { kMeansAsync, suggestKAsync, hdbscanAsync, project2DAsync } from "../../utils/computeWorkerManager";
import { type GraphData, type GraphEdge, type GraphNode, generateClusterColors, type SmartGraphSettings } from "../../types/graph";

// ============================================================================
// Cluster Assignment
// ============================================================================

/** Per-node cluster assignment with its display colour. */
export interface ClusterAssignment {
    cluster: number;
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
        "semanticNeighbors" | "similarityThreshold" | "showOrphans" | "projectionMethod" | "showWikiLinks" | "showSemanticEdges"
    >,
    filter?: GraphFilter,
): Promise<GraphStructureResult> {
    // Filter documents by folder/tag if specified
    let filtered = documents;
    if (filter?.folders?.length || filter?.tags?.length) {
        filtered = documents.filter((doc) => {
            const file = app.vault.getAbstractFileByPath(doc.path);
            if (!file || !("extension" in file)) return false;
            return passesFilter(app, file as TFile, filter);
        });
    }

    if (filtered.length === 0) {
        return { graphData: { nodes: [], edges: [] }, filteredDocs: [], vectors: [] };
    }

    // Extract vectors
    const vectors = filtered.map((doc) => doc.vector);
    const n = filtered.length;

    // Packed upper-triangle similarity cache — n*(n-1)/2 entries instead of n².
    // triIdx(lo, hi) maps a canonical pair (lo < hi) to a flat index.
    const triSize = (n * (n - 1)) / 2;
    const simCache = new Float32Array(triSize);
    const triIdx = (lo: number, hi: number): number => lo * (2 * n - lo - 1) / 2 + (hi - lo - 1);
    const simGet = (a: number, b: number): number => a < b ? simCache[triIdx(a, b)] : simCache[triIdx(b, a)];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            simCache[triIdx(i, j)] = cosineSimilarity(vectors[i], vectors[j]);
        }
    }

    // Build semantic nearest-neighbor edges
    const edges: GraphEdge[] = [];
    const neighborCount = Math.min(settings.semanticNeighbors, n - 1);
    const filteredPathSet = new Set(filtered.map((d) => d.path));

    for (let i = 0; i < n; i++) {
        const similarities: { index: number; score: number }[] = [];
        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const score = simGet(i, j);
            if (score >= settings.similarityThreshold) {
                similarities.push({ index: j, score });
            }
        }

        similarities.sort((a, b) => b.score - a.score);
        const topN = similarities.slice(0, neighborCount);

        for (const neighbor of topN) {
            if (i < neighbor.index) {
                edges.push({
                    source: filtered[i].path,
                    target: filtered[neighbor.index].path,
                    weight: neighbor.score,
                    type: "semantic",
                });
            }
        }
    }

    // Build a set of existing edge pairs for O(1) dedup lookups
    const edgeSet = new Set<string>();
    for (const e of edges) {
        const key = e.source < e.target ? `${e.source}\0${e.target}` : `${e.target}\0${e.source}`;
        edgeSet.add(key);
    }

    // Reverse direction edges (use cached similarities)
    for (let j = 0; j < n; j++) {
        const similarities: { index: number; score: number }[] = [];
        for (let i = 0; i < j; i++) {
            const score = simGet(j, i);
            if (score >= settings.similarityThreshold) {
                similarities.push({ index: i, score });
            }
        }
        similarities.sort((a, b) => b.score - a.score);
        const topN = similarities.slice(0, neighborCount);

        for (const neighbor of topN) {
            const a = filtered[neighbor.index].path;
            const b = filtered[j].path;
            const key = a < b ? `${a}\0${b}` : `${b}\0${a}`;
            if (!edgeSet.has(key)) {
                edgeSet.add(key);
                edges.push({
                    source: a,
                    target: b,
                    weight: neighbor.score,
                    type: "semantic",
                });
            }
        }
    }

    // Overlay wiki link edges from Obsidian's resolved links
    {
        const resolvedLinks = app.metadataCache.resolvedLinks;
        const wikiEdgeSet = new Set<string>();

        for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
            if (!filteredPathSet.has(sourcePath)) continue;

            for (const [targetPath, count] of Object.entries(targets)) {
                if (!filteredPathSet.has(targetPath)) continue;
                if (sourcePath === targetPath) continue;

                const ek = sourcePath < targetPath ? `${sourcePath}\0${targetPath}` : `${targetPath}\0${sourcePath}`;
                if (!wikiEdgeSet.has(ek)) {
                    wikiEdgeSet.add(ek);
                    const wikiEdge: GraphEdge = { source: sourcePath, target: targetPath, weight: count, type: "wiki" };
                    if (edgeSet.has(ek)) {
                        // Wiki link trumps semantic edge — replace it
                        const idx = edges.findIndex((e) => {
                            const key = e.source < e.target ? `${e.source}\0${e.target}` : `${e.target}\0${e.source}`;
                            return key === ek;
                        });
                        if (idx !== -1) edges[idx] = wikiEdge;
                    } else {
                        edges.push(wikiEdge);
                    }
                }
            }
        }
    }

    // Create degree map counting only visible edge types
    const degreeMap = new Map<string, number>();
    for (const edge of edges) {
        if (edge.type === "wiki" && !settings.showWikiLinks) continue;
        if (edge.type === "semantic" && !settings.showSemanticEdges) continue;
        degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
        degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    }

    // Discovery mode: identify nodes with semantic edges but zero wiki edges
    // Only count visible edge types so stats match what the user sees
    const hasSemanticEdge = new Set<string>();
    const hasWikiEdge = new Set<string>();
    for (const edge of edges) {
        if (edge.type === "semantic" && settings.showSemanticEdges) {
            hasSemanticEdge.add(edge.source);
            hasSemanticEdge.add(edge.target);
        } else if (edge.type === "wiki" && settings.showWikiLinks) {
            hasWikiEdge.add(edge.source);
            hasWikiEdge.add(edge.target);
        }
    }

    // Project vectors into 2D so positions reflect semantic similarity
    const positions = await project2DAsync(vectors, settings.projectionMethod);

    // Create nodes — cluster/color intentionally omitted (applied later)
    const nodes: GraphNode[] = [];
    for (let i = 0; i < filtered.length; i++) {
        const doc = filtered[i];
        const degree = degreeMap.get(doc.path) ?? 0;

        if (!settings.showOrphans && degree === 0) continue;

        const label = doc.path.replace(/\.md$/, "").split("/").pop() ?? doc.path;

        nodes.push({
            id: doc.path,
            path: doc.path,
            label,
            x: positions[i].x,
            y: positions[i].y,
            degree,
            highlighted: false,
            discoverable: hasSemanticEdge.has(doc.path) && !hasWikiEdge.has(doc.path),
        });
    }

    // Filter edges to only include edges with valid nodes
    const nodeIds = new Set(nodes.map((n) => n.id));
    const filteredEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

    return {
        graphData: { nodes, edges: filteredEdges },
        filteredDocs: filtered,
        vectors,
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

/**
 * Compute cluster assignments for the given vectors using the configured algorithm.
 *
 * @returns A map from document path to its cluster number and display colour,
 *          plus the K that was used.
 */
export async function computeClusters(
    filteredDocs: DocumentVector[],
    vectors: Float32Array[],
    settings: Pick<SmartGraphSettings, "defaultK" | "autoK" | "clusteringAlgorithm" | "minClusterSize">,
    themeColors?: string[],
    graphData?: GraphData,
): Promise<ClusterResult> {
    if (filteredDocs.length === 0 || vectors.length === 0) {
        return { clusterMap: new Map(), k: 0 };
    }

    let k: number;
    let clusterLabels: number[];

    if (settings.clusteringAlgorithm === "hdbscan") {
        // HDBSCAN works best on low-dimensional data. When projected 2D
        // positions are available, cluster on those with Euclidean distance
        // so that clusters match the visual layout the user sees.
        let hdbVectors = vectors;
        let metric: "cosine" | "euclidean" = "cosine";

        if (graphData && graphData.nodes.length > 0) {
            const pathToPos = new Map<string, { x: number; y: number }>();
            for (const node of graphData.nodes) {
                pathToPos.set(node.id, { x: node.x, y: node.y });
            }

            const positions: Float32Array[] = [];
            for (const doc of filteredDocs) {
                const pos = pathToPos.get(doc.path);
                if (pos) {
                    positions.push(new Float32Array([pos.x, pos.y]));
                } else {
                    positions.push(new Float32Array([0, 0]));
                }
            }
            hdbVectors = positions;
            metric = "euclidean";
        }

        const result = await hdbscanAsync(hdbVectors, settings.minClusterSize, undefined, metric);
        k = result.numClusters;
        clusterLabels = result.labels;
    } else if (settings.autoK) {
        const suggested = await suggestKAsync(vectors, 2, Math.min(10, Math.floor(vectors.length / 2)));
        k = suggested.k;
        clusterLabels = suggested.result.labels;
    } else {
        k = Math.min(settings.defaultK, vectors.length - 1);
        const clusterResult = await kMeansAsync(vectors, Math.max(1, k));
        clusterLabels = clusterResult.labels;
    }

    const clusterColors = generateClusterColors(Math.max(1, k), themeColors);

    const clusterMap = new Map<string, ClusterAssignment>();
    for (let i = 0; i < filteredDocs.length; i++) {
        const cluster = clusterLabels[i];
        clusterMap.set(filteredDocs[i].path, {
            cluster,
            color: clusterColors[cluster % clusterColors.length],
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
    fallbackColor = "hsl(0, 0%, 50%)",
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
        "defaultK" | "autoK" | "semanticNeighbors" | "similarityThreshold" | "showOrphans" | "projectionMethod" | "showWikiLinks" | "showSemanticEdges" | "clusteringAlgorithm" | "minClusterSize"
    >,
    filter?: GraphFilter,
    themeColors?: string[],
): Promise<GraphData> {
    const { graphData, filteredDocs, vectors } = await buildGraphStructure(app, documents, settings, filter);
    const { clusterMap } = await computeClusters(filteredDocs, vectors, settings, themeColors, graphData);
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
