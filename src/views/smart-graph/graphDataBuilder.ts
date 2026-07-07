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
import { getIndexableVaultFiles } from "../../utils/fileFiltering";
import { kMeansAsync, suggestKAsync, hdbscanAsync } from "../../utils/computeWorkerManager";
import {
	type GraphData,
	type GraphEdge,
	type GraphNode,
	generateClusterColors,
	type ProjectionMethod,
	type SmartGraphSettings,
	type ColorGroup,
	type SegmentBy,
	type SpaceSegment,
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
	/** Only include files with these extensions (e.g. "md", "pdf") */
	extensions?: string[];
}

/**
 * Check whether a file passes the given folder/tag filters.
 */
function passesFilter(app: App, file: TFile, filter?: GraphFilter): boolean {
	if (!filter) return true;

	// Extension filter
	if (filter.extensions && filter.extensions.length > 0) {
		if (!filter.extensions.includes(file.extension.toLowerCase())) return false;
	}

	// Folder filter (append "/" so "Work" doesn't match "Workshop/")
	if (filter.folders && filter.folders.length > 0) {
		const inFolder = filter.folders.some((f) => file.path.startsWith(f.endsWith("/") ? f : `${f}/`));
		if (!inFolder) return false;
	}

	// Tag filter (supports hierarchical tags: #WIN matches #WIN/2016)
	if (filter.tags && filter.tags.length > 0) {
		const cache = app.metadataCache.getFileCache(file);
		const fileTags = cache ? (getAllTags(cache) ?? []) : [];
		const hasTag = filter.tags.some((filterTag) =>
			fileTags.some((docTag) => docTag === filterTag || docTag.startsWith(`${filterTag}/`)),
		);
		if (!hasTag) return false;
	}

	return true;
}

// ============================================================================
// Helper functions (extracted to reduce cognitive complexity)
// ============================================================================

export function filterDocuments(
	app: App,
	documents: DocumentVector[],
	filter?: GraphFilter,
	constrainPaths?: Set<string> | null,
): DocumentVector[] {
	let filtered = documents;
	if (filter?.folders?.length || filter?.tags?.length || filter?.extensions?.length) {
		filtered = documents.filter((doc) => {
			const file = app.vault.getAbstractFileByPath(doc.path);
			if (!file || !("extension" in file)) return false;
			return passesFilter(app, file as TFile, filter);
		});
	}
	if (constrainPaths) {
		filtered = filtered.filter((doc) => constrainPaths.has(doc.path));
	}
	return filtered;
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
		const label = file.basename;
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
	let filteredFiles = getIndexableVaultFiles(app.vault);
	if (constrainToPaths) {
		filteredFiles = filteredFiles.filter((file) => constrainToPaths.has(file.path));
	}
	if (filter?.folders?.length || filter?.tags?.length || filter?.extensions?.length) {
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
 * Obsidian native graph.json color entry.
 * Colors can be stored as a packed RGB integer or as HSL components.
 * The query uses Obsidian's search syntax with operators and boolean logic.
 */
interface ObsidianGraphColorEntry {
	query: string;
	color: { a: number; rgb?: number; h?: number; s?: number; l?: number };
}

/**
 * Convert a packed RGB integer (e.g. `12424185`) to a hex string.
 */
function rgbIntToHex(rgb: number): string {
	const r = (rgb >> 16) & 0xff;
	const g = (rgb >> 8) & 0xff;
	const b = rgb & 0xff;
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Convert an HSL color to a hex string.
 */
function hslToHex(h: number, s: number, l: number): string {
	const sNorm = s / 100;
	const lNorm = l / 100;
	const a = sNorm * Math.min(lNorm, 1 - lNorm);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
		return Math.round(255 * color)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Resolve an Obsidian graph color entry to a hex string.
 * Supports both packed RGB integer and HSL formats.
 */
function resolveObsidianColor(color: ObsidianGraphColorEntry["color"]): string {
	if (color.rgb != null) return rgbIntToHex(color.rgb);
	if (color.h != null && color.s != null && color.l != null) return hslToHex(color.h, color.s, color.l);
	return "#888888";
}

/**
 * Normalise a single Obsidian search term into a Smart Graph query atom.
 *
 * - `tag:#foo`  → `#foo`        (tag match)
 * - `#foo`      → `#foo`        (bare tag)
 * - `file:X`    → `X`           (path/filename substring)
 * - `path:X`    → `X`           (path prefix)
 *
 * Property selectors like `["key":value]` are not supported and return `null`.
 */
function normaliseObsidianTerm(raw: string): string | null {
	const part = raw.trim();
	if (!part || part.startsWith("[")) return null;
	if (part.startsWith("tag:")) {
		const tag = part.slice(4).trim().replace(/^"|"$/g, "");
		return tag ? (tag.startsWith("#") ? tag : `#${tag}`) : null;
	}
	if (part.startsWith("path:")) {
		const p = part.slice(5).trim().replace(/^"|"$/g, "");
		return p || null;
	}
	if (part.startsWith("file:")) {
		const f = part.slice(5).trim().replace(/^"|"$/g, "");
		return f || null;
	}
	if (part.startsWith("#")) return part;
	return null;
}

/**
 * Convert an Obsidian native graph query into a single Smart Graph query
 * string that preserves OR semantics.
 *
 * Obsidian graph queries can be complex boolean expressions like:
 *   `file:"Bachelor" OR tag:#Bachelor`
 *   `["related":SAP] OR file:SAP`
 *
 * We split on ` OR `, normalise each recognisable atomic term, and rejoin
 * them with ` OR `.  Property selectors like `["key":value]` are skipped.
 *
 * Returns `null` if no recognisable terms remain.
 *
 * @example
 * convertObsidianQuery('file:"Master" OR ["projects":Master] OR tag:#Master')
 * // → "Master OR #Master"
 */
function convertObsidianQuery(query: string): string | null {
	const parts = query.split(/\s+OR\s+/i);
	const atoms: string[] = [];
	for (const raw of parts) {
		const atom = normaliseObsidianTerm(raw);
		if (atom) atoms.push(atom);
	}
	return atoms.length > 0 ? atoms.join(" OR ") : null;
}

/**
 * Shape of the Obsidian native `graph.json` file (partial — only the fields
 * we care about).
 */
interface ObsidianGraphConfig {
	colorGroups?: ObsidianGraphColorEntry[];
	/** Target link distance (positive number). Maps 1:1 to SmartGraphSettings.linkDistance. */
	linkDistance?: number;
	/** Repel strength (positive number). Maps to SmartGraphSettings.chargeStrength with negation. */
	repelStrength?: number;
	/** Center force strength (0–1). Maps 1:1 to SmartGraphSettings.centerStrength. */
	centerStrength?: number;
	/** Link force strength (0–1). Maps 1:1 to SmartGraphSettings.linkStrength. */
	linkStrength?: number;
}

/**
 * Read settings from Obsidian's native graph view configuration.
 * The settings are stored in `<configDir>/graph.json`.
 *
 * Returns a `Partial<SmartGraphSettings>` containing only the fields that
 * have a meaningful counterpart in the Smart Graph plugin:
 *
 * | Obsidian field    | SmartGraphSettings field | Transform          |
 * |-------------------|--------------------------|--------------------|
 * | `linkDistance`     | `linkDistance`            | direct (1:1)       |
 * | `repelStrength`   | `chargeStrength`          | negate (`-value`)  |
 * | `centerStrength`  | `centerStrength`          | direct (1:1)       |
 * | `linkStrength`    | `linkStrength`            | direct (1:1)       |
 * | `colorGroups`     | `colorGroups`             | query/color parse  |
 *
 * Returns an empty object if the file doesn't exist or cannot be read.
 */
export async function readNativeGraphSettings(app: App): Promise<Partial<SmartGraphSettings>> {
	const configDir = app.vault.configDir;
	const graphConfigPath = `${configDir}/graph.json`;
	try {
		const exists = await app.vault.adapter.exists(graphConfigPath);
		if (!exists) return {};
		const raw = await app.vault.adapter.read(graphConfigPath);
		const config = JSON.parse(raw) as ObsidianGraphConfig;

		const result: Partial<SmartGraphSettings> = {};

		// --- Color groups ---
		if (Array.isArray(config.colorGroups) && config.colorGroups.length > 0) {
			const groups: ColorGroup[] = [];
			for (const entry of config.colorGroups) {
				if (!entry.query || !entry.color) continue;
				const hex = resolveObsidianColor(entry.color);
				const query = convertObsidianQuery(entry.query);
				if (query) groups.push({ query, color: hex });
			}
			if (groups.length > 0) result.colorGroups = groups;
		}

		// --- Physics: link distance ---
		if (typeof config.linkDistance === "number" && config.linkDistance > 0) {
			result.linkDistance = config.linkDistance;
		}

		// --- Physics: charge strength (Obsidian stores positive repelStrength) ---
		// Obsidian clamps abs(repelStrength) < 1 to -1 (see sim.js).
		if (typeof config.repelStrength === "number") {
			result.chargeStrength = Math.abs(config.repelStrength) < 1 ? -1 : -config.repelStrength;
		}

		// --- Physics: center strength ---
		if (typeof config.centerStrength === "number") {
			result.centerStrength = config.centerStrength;
		}

		// --- Physics: link strength ---
		if (typeof config.linkStrength === "number") {
			result.linkStrength = config.linkStrength;
		}

		return result;
	} catch {
		return {};
	}
}

// ============================================================================
// Unified Groups
// ============================================================================

/**
 * Resolve segments for a given segmentBy source.
 * Partitions the graph's nodes into colored {@link SpaceSegment}s depending on
 * how the user chose to segment them.
 *
 * - **folder**: one segment per unique top-level folder (or "Root" for files at vault root)
 * - **tag**: one segment per unique tag across the displayed nodes
 * - **extension**: one segment per file extension
 * - **semantic**: uses a pre-computed `clusterMap` (K-Means / HDBSCAN)
 * - **none**: returns an empty array (no segments)
 */
export function resolveSegments(
	app: App,
	graphData: GraphData,
	source: SegmentBy,
	options?: {
		clusterMap?: Map<string, ClusterAssignment>;
		clusterLabels?: Record<number, string>;
		themeColors?: string[];
		leidenCommunities?: Record<string, number>;
	},
): SpaceSegment[] {
	if (source === "none") return [];

	const { clusterMap, clusterLabels, themeColors = [], leidenCommunities } = options ?? {};

	switch (source) {
		case "folder":
			return resolveSegmentsByFolder(graphData, themeColors);
		case "tag":
			return resolveSegmentsByTag(app, graphData, themeColors);
		case "extension":
			return resolveSegmentsByExtension(graphData, themeColors);
		case "semantic":
			return resolveSegmentsByCluster(graphData, clusterMap, clusterLabels, themeColors);
		case "leiden":
			return resolveSegmentsByLeiden(graphData, leidenCommunities ?? {}, themeColors);
		default:
			return [];
	}
}

function resolveSegmentsByFolder(graphData: GraphData, themeColors: string[]): SpaceSegment[] {
	const folderMap = new Map<string, Set<string>>();
	for (const node of graphData.nodes) {
		const parts = node.path.split("/");
		const folder = parts.length > 1 ? parts[0] : "Root";
		let set = folderMap.get(folder);
		if (!set) {
			set = new Set();
			folderMap.set(folder, set);
		}
		set.add(node.path);
	}
	const sortedFolders = [...folderMap.keys()].sort();
	const colors = generateClusterColors(sortedFolders.length, themeColors);
	return sortedFolders.map((folder, i) => ({
		id: `folder:${folder}`,
		label: folder === "Root" ? "Root" : `${folder}/`,
		color: colors[i],
		source: "folder" as SegmentBy,
		paths: folderMap.get(folder)!,
	}));
}

function resolveSegmentsByTag(app: App, graphData: GraphData, themeColors: string[]): SpaceSegment[] {
	const tagMap = new Map<string, Set<string>>();
	for (const node of graphData.nodes) {
		// getCache() takes the path directly — no vault file lookup needed
		const cache = app.metadataCache.getCache(node.path);
		const tags = cache ? (getAllTags(cache) ?? []) : [];
		for (const tag of tags) {
			let set = tagMap.get(tag);
			if (!set) {
				set = new Set();
				tagMap.set(tag, set);
			}
			set.add(node.path);
		}
	}
	const sortedTags = [...tagMap.keys()].sort();
	const colors = generateClusterColors(sortedTags.length, themeColors);
	return sortedTags.map((tag, i) => ({
		id: `tag:${tag}`,
		label: tag,
		color: colors[i],
		source: "tag" as SegmentBy,
		paths: tagMap.get(tag)!,
	}));
}

function resolveSegmentsByExtension(graphData: GraphData, themeColors: string[]): SpaceSegment[] {
	const extMap = new Map<string, Set<string>>();
	for (const node of graphData.nodes) {
		const ext = node.path.split(".").pop()?.toLowerCase() ?? "";
		let set = extMap.get(ext);
		if (!set) {
			set = new Set();
			extMap.set(ext, set);
		}
		set.add(node.path);
	}
	const sortedExts = [...extMap.keys()].sort();
	const colors = generateClusterColors(sortedExts.length, themeColors);
	return sortedExts.map((ext, i) => ({
		id: `extension:${ext}`,
		label: `.${ext}`,
		color: colors[i],
		source: "extension" as SegmentBy,
		paths: extMap.get(ext)!,
	}));
}

function resolveSegmentsByCluster(
	graphData: GraphData,
	clusterMap?: Map<string, ClusterAssignment>,
	clusterLabels?: Record<number, string>,
	themeColors: string[] = [],
): SpaceSegment[] {
	if (!clusterMap || clusterMap.size === 0) return [];
	const clusterPaths = new Map<number, Set<string>>();
	const clusterColors = new Map<number, string>();
	for (const node of graphData.nodes) {
		const assignment = clusterMap.get(node.id);
		if (!assignment || assignment.cluster == null) continue;
		let set = clusterPaths.get(assignment.cluster);
		if (!set) {
			set = new Set();
			clusterPaths.set(assignment.cluster, set);
		}
		set.add(node.path);
		if (!clusterColors.has(assignment.cluster)) {
			clusterColors.set(assignment.cluster, assignment.color);
		}
	}
	const sortedClusters = [...clusterPaths.keys()].sort((a, b) => a - b);
	const fallbackColors = generateClusterColors(sortedClusters.length, themeColors);
	return sortedClusters.map((clusterId, i) => ({
		id: `cluster:${clusterId}`,
		label: clusterLabels?.[clusterId] ?? `Cluster ${clusterId}`,
		color: clusterColors.get(clusterId) ?? fallbackColors[i],
		source: "semantic" as SegmentBy,
		paths: clusterPaths.get(clusterId)!,
	}));
}

/**
 * Resolve segments using Leiden community detection on the wiki link graph.
 * Communities are derived purely from link topology — notes that heavily
 * interlink end up in the same community regardless of content similarity.
 * Nodes with no wiki links are not assigned to any community and keep the
 * default node color.
 *
 * `communities` is a pre-computed node-id → community-id map produced by
 * `leidenAsync` in the compute worker.
 */
function resolveSegmentsByLeiden(
	graphData: GraphData,
	communities: Record<string, number>,
	themeColors: string[],
): SpaceSegment[] {
	if (Object.keys(communities).length === 0) return [];

	const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));
	const communityNodes = new Map<number, string[]>();

	for (const [nodeId, communityId] of Object.entries(communities)) {
		if (!nodeById.has(nodeId)) continue;
		if (!communityNodes.has(communityId)) communityNodes.set(communityId, []);
		communityNodes.get(communityId)?.push(nodeId);
	}

	if (communityNodes.size === 0) return [];

	// Compute internal degree: count edges whose both endpoints share the same community
	const internalDegree = new Map<string, number>();
	for (const edge of graphData.edges) {
		const sourceCommunity = communities[edge.source];
		const targetCommunity = communities[edge.target];
		if (sourceCommunity == null || targetCommunity == null || sourceCommunity !== targetCommunity) continue;
		internalDegree.set(edge.source, (internalDegree.get(edge.source) ?? 0) + 1);
		internalDegree.set(edge.target, (internalDegree.get(edge.target) ?? 0) + 1);
	}

	// Sort communities by size descending so the largest get the most prominent colors
	const sorted = [...communityNodes.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
	const colors = generateClusterColors(sorted.length, themeColors);

	return sorted.map(([, nodeIds], i) => {
		// Pick representative: highest internal degree, fall back to total degree
		let bestId = nodeIds[0];
		let bestInternal = Number.NEGATIVE_INFINITY;
		let bestTotal = Number.NEGATIVE_INFINITY;
		for (const id of nodeIds) {
			const internal = internalDegree.get(id) ?? 0;
			const total = nodeById.get(id)?.degree ?? 0;
			if (internal > bestInternal || (internal === bestInternal && total > bestTotal)) {
				bestInternal = internal;
				bestTotal = total;
				bestId = id;
			}
		}
		const label = nodeById.get(bestId)?.label ?? nodeById.get(bestId)?.path ?? `Community ${i + 1}`;
		const paths = new Set(nodeIds.map((id) => nodeById.get(id)?.path).filter((p): p is string => p != null));

		return {
			id: `leiden:${i}`,
			label,
			color: colors[i],
			source: "leiden" as SegmentBy,
			paths,
		};
	});
}

/**
 * Apply resolved segments to graph data — sets `color` on matching nodes.
 * First matching segment wins; unmatched nodes keep their existing color.
 */
export function applySegments(graphData: GraphData, segments: SpaceSegment[]): GraphData {
	if (segments.length === 0) return graphData;
	// Build a path → (color, cluster index) lookup for O(1) per-node
	const pathInfo = new Map<string, { color: string; cluster: number }>();
	// First segment to claim a path wins (ordered)
	for (let i = 0; i < segments.length; i++) {
		for (const path of segments[i].paths) {
			if (!pathInfo.has(path)) {
				pathInfo.set(path, { color: segments[i].color, cluster: i });
			}
		}
	}
	return {
		...graphData,
		nodes: graphData.nodes.map((node) => {
			const info = pathInfo.get(node.path);
			if (info === undefined) return node; // not in any segment
			if (!info.color) return { ...node, color: undefined, cluster: info.cluster };
			return { ...node, color: info.color, cluster: info.cluster };
		}),
	};
}

function getPathBasename(path: string): string {
	const name = path.split("/").pop() ?? path;
	return name.replace(/\.[^.]+$/, "");
}

function getProjectionDimensions(vectorLength: number, layoutFidelity: number): number {
	const clampedFidelity = Math.min(100, Math.max(0, layoutFidelity));
	const minDimensions = Math.min(8, vectorLength);
	return Math.max(
		2,
		Math.min(vectorLength, Math.round(minDimensions + (vectorLength - minDimensions) * (clampedFidelity / 100))),
	);
}

function reduceGraphVector(vector: Float32Array, dimensions: number): Float32Array {
	return Float32Array.from(vector.subarray(0, Math.max(2, Math.min(dimensions, vector.length))));
}

interface GraphStructureOptions {
	projectionMethod?: ProjectionMethod;
	umapNeighbors?: number;
	umapMinDist?: number;
	layoutFidelity?: number;
	showWikiLinks: boolean;
}

type GraphBuildOptions = GraphStructureOptions &
	Pick<SmartGraphSettings, "defaultK" | "autoK" | "clusteringAlgorithm" | "minClusterSize">;

export async function buildGraphStructure(
	app: App,
	documents: DocumentVector[],
	settings: GraphStructureOptions,
): Promise<{ reducedVectors: Float32Array[]; graphData: GraphData }> {
	if (documents.length === 0) {
		return { reducedVectors: [], graphData: { nodes: [], edges: [] } };
	}

	const dimensions = getProjectionDimensions(documents[0]?.vector.length ?? 2, settings.layoutFidelity ?? 50);
	const reducedVectors = documents.map((document) => reduceGraphVector(document.vector, dimensions));
	const constrainedPaths = new Set(documents.map((document) => document.path));
	const wikiGraph = settings.showWikiLinks
		? buildWikiGraph(app, undefined, constrainedPaths).graphData
		: { nodes: [], edges: [] };
	const wikiDegreeMap = buildDegreeMap(wikiGraph.edges);
	const nodes = documents.map((document, index) => {
		const file = app.vault.getAbstractFileByPath(document.path);
		const vector = reducedVectors[index];
		return {
			id: document.path,
			path: document.path,
			label:
				file && "basename" in file && typeof file.basename === "string"
					? file.basename
					: getPathBasename(document.path),
			x: vector[0] ?? 0,
			y: vector[1] ?? 0,
			degree: wikiDegreeMap.get(document.path) ?? 0,
			highlighted: false,
		} satisfies GraphNode;
	});

	return {
		reducedVectors,
		graphData: {
			nodes,
			edges: wikiGraph.edges,
		},
	};
}

export async function buildGraph(
	app: App,
	documents: DocumentVector[],
	settings: GraphBuildOptions,
): Promise<GraphData> {
	if (documents.length === 0) {
		return { nodes: [], edges: [] };
	}

	const structure = await buildGraphStructure(app, documents, settings);
	const clusterResult = await computeClusters(
		documents,
		documents.map((document) => document.vector),
		settings,
		undefined,
		structure.reducedVectors,
	);

	return {
		...structure.graphData,
		nodes: structure.graphData.nodes.map((node) => {
			const assignment = clusterResult.clusterMap.get(node.path);
			return assignment ? { ...node, cluster: assignment.cluster, color: assignment.color } : node;
		}),
	};
}

export function deriveClusterLabelsFromGraph(graphData: GraphData): Record<number, string> {
	const representatives = deriveClusterRepresentativesFromGraph(graphData);
	const labels: Record<number, string> = {};
	for (const [clusterId, node] of representatives) {
		labels[clusterId] = node.label;
	}
	return labels;
}

export function applyColorGroups(app: App, graphData: GraphData, colorGroups: ColorGroup[]): GraphData {
	if (colorGroups.length === 0) return graphData;

	return {
		...graphData,
		nodes: graphData.nodes.map((node) => {
			const file = app.vault.getAbstractFileByPath(node.path);
			if (!file || !("extension" in file)) {
				return node;
			}

			for (const group of colorGroups) {
				const query = group.query.trim();
				if (!query) continue;

				if (query.startsWith("#")) {
					const cache = app.metadataCache.getFileCache(file as TFile);
					const tags = cache ? (getAllTags(cache) ?? []) : [];
					if (tags.some((tag) => tag === query || tag.startsWith(`${query}/`))) {
						return { ...node, color: group.color };
					}
					continue;
				}

				if (node.path.includes(query)) {
					return { ...node, color: group.color };
				}
			}

			return node;
		}),
	};
}
