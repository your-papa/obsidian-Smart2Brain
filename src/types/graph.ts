/**
 * Smart Graph View Types
 *
 * Types for the graph visualization feature. The smart graph uses semantic
 * embeddings for node positioning and clustering, with optional wiki link
 * overlay.
 */

/**
 * Dimensionality reduction method for projecting embeddings into 2D.
 * - "pca": Principal Component Analysis (fast, linear)
 * - "umap": Uniform Manifold Approximation and Projection (non-linear, best quality)
 */
export type ProjectionMethod = "pca" | "umap";

/**
 * Clustering algorithm used for grouping document embeddings.
 * - "kmeans": K-Means with cosine distance (requires specifying K or auto-K)
 * - "hdbscan": Hierarchical Density-Based Spatial Clustering (auto-detects cluster count)
 */
export type ClusteringAlgorithm = "kmeans" | "hdbscan";

/**
 * Graph display mode.
 * - "wiki": Force-directed layout using only wiki link edges (initial view)
 * - "smart": Projected positions from embedding-based clustering
 * @deprecated Use `LayoutMode` and `ColorMode` instead.
 */
export type GraphMode = "wiki" | "smart";

/**
 * Layout engine for positioning nodes.
 * - "force": Force-directed simulation using wiki link edges (d3-force)
 * - "semantic": 2D projection from embedding vectors (UMAP / PCA)
 */
export type LayoutMode = "force" | "semantic";

/**
 * Coloring strategy for graph nodes.
 * - "groups": User-defined color groups based on folder/tag queries
 * - "clusters": Automatic cluster coloring from K-Means / HDBSCAN
 * - "none": Default theme color, no special coloring
 */
export type ColorMode = "groups" | "clusters" | "none";

/**
 * A user-defined color group that assigns a color to nodes matching a query.
 * Query matching: path prefix (folder), or tag (starts with #).
 */
export interface ColorGroup {
	/** Query string: folder path prefix or #tag */
	query: string;
	/** CSS color value */
	color: string;
}

/**
 * The type of relationship an edge represents.
 * - "wiki": An explicit wiki link between notes in Obsidian
 * - "semantic": Reserved for future local semantic graph relationships
 */
export type EdgeType = "wiki" | "semantic";

/**
 * A node in the graph representing a vault note.
 */
export interface GraphNode {
	/** Unique identifier (file path) */
	id: string;
	/** Vault-relative file path */
	path: string;
	/** Display label (file basename without extension) */
	label: string;
	/** X position (wiki: set by d3-force simulation, smart: set by UMAP projection) */
	x: number;
	/** Y position (wiki: set by d3-force simulation, smart: set by UMAP projection) */
	y: number;
	/** Velocity X (used by d3-force in wiki mode) */
	vx?: number;
	/** Velocity Y (used by d3-force in wiki mode) */
	vy?: number;
	/** Cluster assignment index */
	cluster?: number;
	/** Display color (derived from cluster) */
	color?: string;
	/** Whether this node matches the current search query */
	highlighted?: boolean;
	/** Number of connections (degree) for sizing */
	degree?: number;
}

/**
 * An edge in the graph representing a relationship between notes.
 */
export interface GraphEdge {
	/** Source node ID (file path) */
	source: string;
	/** Target node ID (file path) */
	target: string;
	/** Edge weight (link count for wiki, similarity for semantic) */
	weight: number;
	/** The type of relationship this edge represents */
	type: EdgeType;
}

/**
 * Complete graph data structure passed to the renderer.
 */
export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

/**
 * Settings for the graph view, persisted in plugin data.
 */
export interface SmartGraphSettings {
	/** Default number of clusters for K-Means */
	defaultK: number;
	/** Whether to auto-determine K via silhouette score */
	autoK: boolean;
	/** Target link distance for force layout */
	linkDistance: number;
	/** Charge strength (negative = repulsive). Controls how far apart nodes spread. */
	chargeStrength: number;
	/** Center force strength (0–1). Pulls the graph toward the center. */
	centerStrength: number;
	/** Link force strength (0–1). How strongly edges pull connected nodes together. */
	linkStrength: number;
	/** Dimensionality reduction algorithm for 2D projection */
	projectionMethod: ProjectionMethod;
	/** Number of nearest neighbors UMAP uses to model local structure */
	umapNeighbors: number;
	/** Minimum distance between points in the UMAP embedding */
	umapMinDist: number;
	/** Tradeoff between faster graph layout and higher projection fidelity */
	layoutFidelity: number;
	/** Whether to show wiki link edges overlaid on the semantic graph */
	showWikiLinks: boolean;
	/** Zoom scale at which all labels are shown (0 = never) */
	labelZoomThreshold: number;
	/** Chat model used for LLM-powered graph features (e.g., cluster labeling) */
	graphChatModel: import("../stores/chatStore.svelte").ChatModel | null;
	/** Whether to automatically generate cluster labels after clustering */
	autoLabelClusters: boolean;
	/** Clustering algorithm to use */
	clusteringAlgorithm: import("./graph").ClusteringAlgorithm;
	/** Minimum cluster size for HDBSCAN */
	minClusterSize: number;
	/** User-defined color groups for the wiki graph mode */
	colorGroups: ColorGroup[];
	/** Layout engine for node positioning */
	layoutMode: import("./graph").LayoutMode;
	/** Coloring strategy for graph nodes */
	colorMode: import("./graph").ColorMode;
	/** Base node circle size (1–10). Actual radius also factors in node degree. */
	nodeSize: number;
}

/**
 * Default graph settings.
 */
export const DEFAULT_SMART_GRAPH_SETTINGS: SmartGraphSettings = {
	defaultK: 5,
	autoK: true,
	linkDistance: 250,
	chargeStrength: -1000,
	centerStrength: 0.1,
	linkStrength: 1,
	projectionMethod: "umap",
	umapNeighbors: 15,
	umapMinDist: 0.1,
	layoutFidelity: 50,
	showWikiLinks: true,
	labelZoomThreshold: 2.5,
	graphChatModel: null,
	autoLabelClusters: false,
	clusteringAlgorithm: "kmeans",
	minClusterSize: 5,
	colorGroups: [],
	layoutMode: "force",
	colorMode: "groups",
	nodeSize: 4,
};

/**
 * Obsidian theme color CSS variable names used as the base cluster palette.
 */
/**
 * Detail about a focused (zoomed-in) cluster.
 * Shared between SmartGraphView and GraphInspector.
 */
export interface FocusedClusterDetail {
	cluster: number;
	label: string;
	noteCount: number;
	topNotes: Array<{ label: string; path: string; degree: number }>;
}

export const THEME_COLOR_VARS = [
	"--color-red",
	"--color-blue",
	"--color-green",
	"--color-orange",
	"--color-purple",
	"--color-cyan",
	"--color-yellow",
	"--color-pink",
	"--interactive-accent",
] as const;

/**
 * Parse HSL components (h 0-360, s 0-100, l 0-100) from a CSS color string.
 * Supports hex, rgb(), and hsl() formats. Returns [0, 70, 55] as fallback.
 */
export function parseHSL(color: string): [number, number, number] {
	const s = color.trim();

	// hsl(H, S%, L%)
	const hslMatch = /^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/i.exec(s);
	if (hslMatch) {
		return [
			Math.round(Number(hslMatch[1])) % 360,
			Math.round(Number(hslMatch[2])),
			Math.round(Number(hslMatch[3])),
		];
	}

	let r = 0;
	let g = 0;
	let b = 0;

	const hexMatch = /^#([\da-f]{3,8})$/i.exec(s);
	if (hexMatch) {
		let hex = hexMatch[1];
		if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
		r = Number.parseInt(hex.slice(0, 2), 16) / 255;
		g = Number.parseInt(hex.slice(2, 4), 16) / 255;
		b = Number.parseInt(hex.slice(4, 6), 16) / 255;
	} else {
		const rgbMatch = /^rgba?\(\s*([\d.]+)\s*[,/\s]\s*([\d.]+)\s*[,/\s]\s*([\d.]+)/i.exec(s);
		if (rgbMatch) {
			r = Number(rgbMatch[1]) / 255;
			g = Number(rgbMatch[2]) / 255;
			b = Number(rgbMatch[3]) / 255;
		} else {
			return [0, 70, 55];
		}
	}

	// RGB → HSL
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	const l = (max + min) / 2;
	if (d === 0) return [0, 0, Math.round(l * 100)];
	const sat = d / (1 - Math.abs(2 * l - 1));
	let h = 0;
	if (max === r) h = ((g - b) / d) % 6;
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	h = Math.round(h * 60);
	return [((h % 360) + 360) % 360, Math.round(sat * 100), Math.round(l * 100)];
}

/**
 * Generate `k` cluster colors from a set of theme base colors.
 *
 * - The first `themeColors.length` clusters use the theme colors directly.
 * - Each subsequent "round" beyond the palette cycles back through the base
 *   colors with a cumulative hue shift (+30° per round), keeping them
 *   distinguishable but still theme-native.
 * - If no theme colors are provided, falls back to evenly-spaced HSL hues.
 */
export function generateClusterColors(k: number, themeColors: string[] = []): string[] {
	// Parse base colors into HSL
	const base: [number, number, number][] =
		themeColors.length > 0
			? themeColors.map((c) => parseHSL(c))
			: Array.from(
					{ length: Math.max(k, 1) },
					(_, i) => [Math.round((i * 360) / Math.max(k, 1)) % 360, 70, 55] as [number, number, number],
				);

	const colors: string[] = [];
	const paletteSize = base.length;
	const HUE_SHIFT_PER_ROUND = 30;

	for (let i = 0; i < k; i++) {
		const baseIndex = i % paletteSize;
		const round = Math.floor(i / paletteSize); // 0 for first pass, 1+ for overflow
		const [h, s, l] = base[baseIndex];
		const shiftedHue = (h + round * HUE_SHIFT_PER_ROUND) % 360;
		colors.push(`hsl(${shiftedHue}, ${s}%, ${l}%)`);
	}
	return colors;
}
