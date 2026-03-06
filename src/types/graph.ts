/**
 * Smart Graph View Types
 *
 * Types for the graph visualization feature. The graph uses semantic
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
 * The type of relationship an edge represents.
 * - "wiki": An explicit wiki link between notes in Obsidian
 * - "semantic": An inferred similarity edge from embedding cosine similarity
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
    /** X position (set by force simulation) */
    x: number;
    /** Y position (set by force simulation) */
    y: number;
    /** Velocity X (used by d3-force) */
    vx?: number;
    /** Velocity Y (used by d3-force) */
    vy?: number;
    /** Cluster assignment index */
    cluster?: number;
    /** Display color (derived from cluster) */
    color?: string;
    /** Whether this node matches the current search query */
    highlighted?: boolean;
    /** Number of connections (degree) for sizing */
    degree?: number;
    /** True when the node has semantic edges but no wiki edges (discovery mode) */
    discoverable?: boolean;
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
    /** Whether to show orphan nodes (no connections) */
    showOrphans: boolean;
    /** Base node radius in pixels */
    nodeSize: number;
    /** Target link distance for force layout */
    linkDistance: number;
    /** Charge strength (negative = repulsive). Controls how far apart nodes spread. */
    chargeStrength: number;
    /** Minimum similarity threshold for semantic edges (0-1) */
    similarityThreshold: number;
    /** Number of nearest neighbors to connect in semantic mode */
    semanticNeighbors: number;
    /** Dimensionality reduction algorithm for 2D projection */
    projectionMethod: ProjectionMethod;
    /** Whether to show wiki link edges overlaid on the semantic graph */
    showWikiLinks: boolean;
    /** Zoom scale at which all labels are shown (0 = never) */
    labelZoomThreshold: number;
    /** Whether to highlight nodes with semantic but no wiki edges */
    discoveryMode: boolean;
    /** Whether to show semantic similarity edges */
    showSemanticEdges: boolean;
    /** Chat model used for LLM-powered graph features (e.g., cluster labeling) */
    graphChatModel: import("../stores/chatStore.svelte").ChatModel | null;
    /** Whether to automatically generate cluster labels after clustering */
    autoLabelClusters: boolean;
}

/**
 * Default graph settings.
 */
export const DEFAULT_SMART_GRAPH_SETTINGS: SmartGraphSettings = {
    defaultK: 5,
    autoK: true,
    showOrphans: true,
    nodeSize: 6,
    linkDistance: 100,
    chargeStrength: -150,
    similarityThreshold: 0.3,
    semanticNeighbors: 5,
    projectionMethod: "umap",
    showWikiLinks: true,
    labelZoomThreshold: 2.5,
    discoveryMode: false,
    showSemanticEdges: true,
    graphChatModel: null,
    autoLabelClusters: false,
};

/**
 * Obsidian theme color CSS variable names used as the base cluster palette.
 */
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
    const hslMatch = s.match(/^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/i);
    if (hslMatch) {
        return [Math.round(Number(hslMatch[1])) % 360, Math.round(Number(hslMatch[2])), Math.round(Number(hslMatch[3]))];
    }

    let r = 0;
    let g = 0;
    let b = 0;

    const hexMatch = s.match(/^#([\da-f]{3,8})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        r = parseInt(hex.slice(0, 2), 16) / 255;
        g = parseInt(hex.slice(2, 4), 16) / 255;
        b = parseInt(hex.slice(4, 6), 16) / 255;
    } else {
        const rgbMatch = s.match(/^rgba?\(\s*([\d.]+)\s*[,/\s]\s*([\d.]+)\s*[,/\s]\s*([\d.]+)/i);
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
            : Array.from({ length: Math.max(k, 1) }, (_, i) => [
                Math.round((i * 360) / Math.max(k, 1)) % 360,
                70,
                55,
            ] as [number, number, number]);

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
