<script lang="ts">
import { onMount } from "svelte";
import { Menu } from "obsidian";
import {
	forceSimulation,
	forceLink,
	forceManyBody,
	forceCenter,
	forceCollide,
	forceX,
	forceY,
	type SimulationNodeDatum,
	type SimulationLinkDatum,
} from "d3-force";
import type { GraphData, GraphNode, GraphEdge, EdgeType, LayoutMode } from "../../types/graph";
import { deriveClusterRepresentativesFromGraph } from "../../views/smart-graph/graphDataBuilder";
import { edgeKey } from "../../utils/graphUtils";
import { animateTransform, computeNodeBounds, framingTransform, easeOutCubic } from "../../utils/graphAnimation";

interface Props {
	graphData: GraphData;
	/** Layout mode — force uses d3-force, semantic uses projected positions. */
	mode: LayoutMode;
	linkDistance: number;
	chargeStrength?: number;
	labelZoomThreshold?: number;
	showWikiLinks?: boolean;
	focusedClusters?: Set<number>;
	clusterLabels?: Record<number, string>;
	isLabeling?: boolean;
	onNodeClick?: (path: string) => void;
	onRevealFile?: (path: string) => void;
	onFocusCluster?: (cluster: number) => void;
	onToggleWikiLinks?: () => void;
	lassoMode?: boolean;
	onSelectionChange?: (paths: string[]) => void;
	onClearFocusedClusters?: () => void;
	onHoverPreview?: (event: MouseEvent, path: string, targetEl: HTMLElement) => void;
}

let {
	graphData,
	mode,
	linkDistance,
	chargeStrength = -150,
	labelZoomThreshold = 2.5,
	showWikiLinks = true,
	focusedClusters = new Set<number>(),
	clusterLabels = {},
	isLabeling = false,
	onNodeClick,
	onRevealFile,
	onFocusCluster,
	onToggleWikiLinks,
	lassoMode = false,
	onSelectionChange,
	onClearFocusedClusters,
	onHoverPreview,
}: Props = $props();

/** Whether the current mode uses d3-force simulation vs static projected positions. */
let isForceMode = $derived(mode === "force");

let canvasEl: HTMLCanvasElement;
let containerEl: HTMLDivElement;

// Invisible anchor element repositioned over hovered nodes for Obsidian's hover popover
let hoverAnchorEl: HTMLDivElement;

// Auto-compute node size based on graph density — smaller dots for large graphs
let nodeSize = $derived.by(() => {
	const n = graphData.nodes.length;
	if (n <= 50) return 6;
	if (n <= 200) return 4;
	if (n <= 500) return 3;
	return 2;
});

// Transform state for zoom/pan
let transform = $state({ x: 0, y: 0, scale: 1 });

// Interaction state
let hoveredNode: GraphNode | null = $state(null);
let draggedNode: GraphNode | null = $state(null);
let hasDragged = false;
let isPanning = $state(false);
let panStart = { x: 0, y: 0 };

// Non-reactive drag reference — directly mutates the d3 SimNode's fx/fy
// without going through Svelte's $state proxy (wiki mode only)
let dragSimNode: SimNode | null = null;

// Pinned nodes: nodes with fixed positions (fx/fy set) — wiki mode only
let pinnedNodes: Set<string> = new Set();

// rAF render loop ID for smart mode (replaces the d3 simulation tick)
let smartRafId: number | null = null;

// Lasso selection state
let selectedNodes: Set<string> = $state(new Set());
let isLassoing = $state(false);
let lassoPoints: Array<{ x: number; y: number }> = [];
let lassoJustFinished = false;

// Track which node already had a hover-preview triggered (fire once per node)
let previewTriggeredForNode: string | null = null;

// Track whether we need an initial fit-to-view after first simulation setup
let needsInitialFit = true;
let initialFitTickCount = 0;

// Simulation reference
let simulation: ReturnType<typeof forceSimulation<SimNode>> | null = null;

// D3-compatible node/link types
type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { weight: number; type: EdgeType };

let simNodes: SimNode[] = [];
let simLinks: SimLink[] = [];

// Pre-split edge arrays – built once in setupSimulation, reused every frame
let wikiSimLinks: SimLink[] = [];

// Edge fade-in: edges start invisible and fade to full opacity after each
// setupSimulation call, providing a smooth crossfade on mode/data changes.
let edgeFadeAlpha = 1;
const EDGE_FADE_RATE = 0.04; // reaches 1 in 25 ticks (~0.4s at 60fps)

// Smooth hover highlighting: per-node alpha lerps toward target on each frame.
// 0 = fully dimmed, 1 = fully visible. Drives node, edge, and label opacity.
let hoverAlphas: Map<string, number> = new Map();
let hoverAnimFrameId: number | null = null;
const HOVER_LERP_SPEED = 0.06; // per-frame blend factor (~250ms to settle)

// When true, the next setupSimulation call skips disruptive effects
// (edge fade reset, fitToView) for a seamless data swap.
let skipNextSetupEffects = false;

// Adjacency map: nodeId → Set of connected node ids (O(1) hover lookup)
let adjacency: Map<string, Set<string>> = new Map();

// Edge hover state for weight display
let hoveredEdge: SimLink | null = $state(null);

// Cluster legend hit areas for click detection (screen space)
let clusterAnchorHitAreas: Array<{
	x: number;
	y: number;
	w: number;
	h: number;
	cluster: number;
}> = [];

// Edge legend hit areas for click detection (screen space)
let edgeLegendHitAreas: Array<{
	x: number;
	y: number;
	w: number;
	h: number;
	type: "wiki";
}> = [];

// Labeling animation loop
let labelAnimFrameId: number | null = null;

$effect(() => {
	if (isLabeling) {
		function tick() {
			render();
			labelAnimFrameId = requestAnimationFrame(tick);
		}
		labelAnimFrameId = requestAnimationFrame(tick);
		return () => {
			if (labelAnimFrameId != null) {
				cancelAnimationFrame(labelAnimFrameId);
				labelAnimFrameId = null;
			}
			// One final render to clear the animated border
			render();
		};
	}
});

// Edge lookup map: "nodeA\0nodeB" → SimLink (built once in setupSimulation)
// Enables O(1) edge weight lookups for hover labels instead of O(n) scan.
let edgeLookup: Map<string, SimLink> = new Map();

// Node ID → SimNode map for O(1) lookups (built once in setupSimulation)
let simNodeMap: Map<string, SimNode> = new Map();
let clusterRepresentativeIds: Set<string> = new Set();
let clusterRepresentativeNodes: Map<number, SimNode> = new Map();
let clusterNodeCounts: Map<number, number> = new Map();

const REPRESENTATIVE_LABEL_NODE_THRESHOLD = 120;
const REPRESENTATIVE_LABEL_ZOOM_RATIO = 0.6;
const FULL_LABEL_DENSE_GRAPH_MULTIPLIER = 1.8;
const CLUSTER_ANCHOR_ZOOM_RATIO = 0.85;

/**
 * Cached theme colors — Canvas 2D cannot use CSS var() directly.
 * We read computed styles once and invalidate on Obsidian theme change
 * (via the `css-change` event on `document.body`) instead of every frame.
 */
type ThemeColors = ReturnType<typeof readThemeColors>;
let cachedThemeColors: ThemeColors | null = null;

function readThemeColors() {
	const style = getComputedStyle(canvasEl);
	const get = (prop: string, fallback: string) => style.getPropertyValue(prop).trim() || fallback;
	return {
		accent: get("--interactive-accent", "#7b6cd9"),
		textNormal: get("--text-normal", "#dcddde"),
		textMuted: get("--text-muted", "#999999"),
		textFaint: get("--text-faint", "#b4b4b4"),
		textAccent: get("--text-accent", "#7b6cd9"),
		graphLine: get("--graph-line", "#969696"),
		graphNode: get("--graph-node", "#999999"),
		textOnAccent: get("--text-on-accent", "#ffffff"),
		bgPrimary: get("--background-primary", "#1e1e1e"),
		font: get("--font-interface", "-apple-system, BlinkMacSystemFont, sans-serif"),
	};
}

function invalidateThemeColors() {
	cachedThemeColors = null;
}

function resolveThemeColors(): ThemeColors {
	if (!cachedThemeColors) {
		cachedThemeColors = readThemeColors();
	}
	return cachedThemeColors;
}

/**
 * Distance from point (px,py) to line segment (x1,y1)-(x2,y2).
 */
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
	const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
	const projX = x1 + t * dx;
	const projY = y1 + t * dy;
	return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if (px, py) is inside the polygon defined by `poly`.
 */
function pointInPolygon(px: number, py: number, poly: Array<{ x: number; y: number }>): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const xi = poly[i].x;
		const yi = poly[i].y;
		const xj = poly[j].x;
		const yj = poly[j].y;
		if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Clear the current lasso selection.
 */
export function clearSelection() {
	selectedNodes = new Set();
	onSelectionChange?.([]);
	render();
}

/**
 * Get paths for all nodes belonging to any of the given clusters.
 */
export function getNodePathsForClusters(clusters: Set<number>): string[] {
	return simNodes.filter((n) => n.cluster != null && clusters.has(n.cluster)).map((n) => n.path);
}

/**
 * Select nodes by their paths (e.g. from cluster selection).
 */
export function selectNodesByPaths(paths: string[]) {
	const pathSet = new Set(paths);
	selectedNodes = new Set(simNodes.filter((n) => pathSet.has(n.path)).map((n) => n.id));
	render();
}

/**
 * Truncate text with an ellipsis if it exceeds `maxWidth` in the current font.
 */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	const ellipsis = "…";
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return lo > 0 ? text.slice(0, lo) + ellipsis : ellipsis;
}

/**
 * Find the edge nearest to the given screen coordinates, if within hit distance.
 */
function findEdgeAt(screenX: number, screenY: number): SimLink | null {
	const { x, y } = screenToGraph(screenX, screenY);
	const hitDist = 6 / transform.scale;
	let best: SimLink | null = null;
	let bestDist = hitDist;
	for (const link of simLinks) {
		const s = link.source as SimNode;
		const t = link.target as SimNode;
		if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
		const d = distToSegment(x, y, s.x, s.y, t.x, t.y);
		if (d < bestDist) {
			bestDist = d;
			best = link;
		}
	}
	return best;
}

/**
 * Convert screen coordinates to graph coordinates.
 */
function screenToGraph(screenX: number, screenY: number): { x: number; y: number } {
	return {
		x: (screenX - transform.x) / transform.scale,
		y: (screenY - transform.y) / transform.scale,
	};
}

/**
 * Find the node at the given screen coordinates.
 */
function findNodeAt(screenX: number, screenY: number): GraphNode | null {
	const { x, y } = screenToGraph(screenX, screenY);
	const hitRadius = (Math.max(0.5, nodeSize / 6) + 4) / transform.scale;

	// Search in reverse order (top-most nodes first)
	for (let i = simNodes.length - 1; i >= 0; i--) {
		const node = simNodes[i];
		const dx = (node.x ?? 0) - x;
		const dy = (node.y ?? 0) - y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const radius = getNodeRadius(node);
		if (dist <= radius + hitRadius) {
			return node;
		}
	}
	return null;
}

/**
 * Get the draw radius for a node based on its degree and the user-configurable nodeSize.
 * nodeSize default is 6; the base radius scales linearly so nodes are always visible.
 */
function getNodeRadius(node: GraphNode): number {
	const base = Math.max(0.5, nodeSize / 6);
	const degree = node.degree ?? 0;
	return base + Math.min(Math.log1p(degree) * 0.5, 6);
}

/**
 * Render the graph to the canvas.
 */
function render() {
	if (!canvasEl) return;
	const ctx = canvasEl.getContext("2d");
	if (!ctx) return;

	const dpr = window.devicePixelRatio || 1;
	const width = canvasEl.width / dpr;
	const height = canvasEl.height / dpr;

	// Resolve theme CSS variables (Canvas 2D can't use var() directly)
	const c = resolveThemeColors();

	// Clear (use logical pixel dimensions — context is already DPR-scaled)
	ctx.clearRect(0, 0, width, height);

	ctx.save();
	ctx.translate(transform.x, transform.y);
	ctx.scale(transform.scale, transform.scale);

	// Draw wiki edges using the pre-split array built in setupSimulation.

	// Advance edge fade-in (smooth crossfade on mode / data changes)
	if (edgeFadeAlpha < 1) {
		edgeFadeAlpha = Math.min(1, edgeFadeAlpha + EDGE_FADE_RATE);
	}

	if (showWikiLinks) {
		for (const link of wikiSimLinks) {
			const source = link.source as SimNode;
			const target = link.target as SimNode;

			if (source.x == null || source.y == null || target.x == null || target.y == null) continue;

			// Dim edges outside focused clusters
			const inFocus =
				focusedClusters.size === 0 ||
				(source.cluster != null && focusedClusters.has(source.cluster)) ||
				(target.cluster != null && focusedClusters.has(target.cluster));

			// Dim edges outside selection
			const inSelection =
				selectedNodes.size === 0 || (selectedNodes.has(source.id) && selectedNodes.has(target.id));

			const isHighlighted = hoveredNode && (source.id === hoveredNode.id || target.id === hoveredNode.id);

			// Use the smoother of the two endpoint alphas for edge dimming
			const edgeHoverAlpha = hoveredNode
				? Math.max(hoverAlphas.get(source.id) ?? 0.85, hoverAlphas.get(target.id) ?? 0.85)
				: 1;

			ctx.beginPath();
			ctx.setLineDash([]);
			ctx.moveTo(source.x, source.y);
			ctx.lineTo(target.x, target.y);
			ctx.strokeStyle = isHighlighted ? c.accent : c.textFaint;
			ctx.lineWidth = isHighlighted ? 2 / transform.scale : 0.5 / transform.scale;
			ctx.globalAlpha =
				(!inFocus ? 0.05 : !inSelection ? 0.05 : isHighlighted ? 0.9 : 0.25) *
				edgeFadeAlpha *
				(isHighlighted ? 1 : edgeHoverAlpha / 0.85);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	} // end showWikiLinks

	ctx.setLineDash([]);

	// ── Smooth hover alpha interpolation ──────────────────────
	// Compute target alpha for each node and lerp toward it.
	// This produces a smooth dim/brighten effect on hover.
	let hoverSettled = true;
	const hasSelection = selectedNodes.size > 0;

	for (const node of simNodes) {
		let target: number;
		if (node.highlighted || hoveredNode?.id === node.id || draggedNode?.id === node.id) {
			target = 1;
		} else if (hasSelection && !selectedNodes.has(node.id)) {
			target = 0.15;
		} else if (
			!hasSelection &&
			focusedClusters.size > 0 &&
			(node.cluster == null || !focusedClusters.has(node.cluster))
		) {
			target = 0.1;
		} else if (hoveredNode) {
			const isConnected = adjacency.get(hoveredNode.id)?.has(node.id) ?? false;
			target = isConnected ? 1 : 0.15;
		} else {
			target = 0.85;
		}

		const prev = hoverAlphas.get(node.id) ?? 0.85;
		const next = prev + (target - prev) * HOVER_LERP_SPEED;
		const final = Math.abs(next - target) < 0.01 ? target : next;
		hoverAlphas.set(node.id, final);
		if (final !== target) hoverSettled = false;
	}

	// Schedule another frame if alphas haven't settled yet
	if (!hoverSettled && hoverAnimFrameId == null) {
		hoverAnimFrameId = requestAnimationFrame(() => {
			hoverAnimFrameId = null;
			render();
		});
	}

	// Draw nodes
	for (const node of simNodes) {
		if (node.x == null || node.y == null) continue;

		const radius = getNodeRadius(node);
		const isHovered = hoveredNode?.id === node.id;
		const isDragged = draggedNode?.id === node.id;
		const alpha = hoverAlphas.get(node.id) ?? 0.85;

		ctx.beginPath();
		ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);

		// Fill
		if (node.highlighted) {
			ctx.fillStyle = c.accent;
			ctx.globalAlpha = alpha;
		} else {
			ctx.fillStyle = node.color ?? c.graphNode;
			ctx.globalAlpha = alpha;
		}

		ctx.fill();
		ctx.globalAlpha = 1;

		// Stroke for highlighted/hovered/selected nodes
		if (selectedNodes.has(node.id)) {
			ctx.strokeStyle = c.accent;
			ctx.lineWidth = 3 / transform.scale;
			ctx.stroke();
		} else if (node.highlighted || isHovered) {
			ctx.strokeStyle = isHovered ? c.textNormal : c.accent;
			ctx.lineWidth = 2 / transform.scale;
			ctx.stroke();
		}

		// Pinned node indicator: small inner dot (wiki mode only)
		if (isForceMode && pinnedNodes.has(node.id)) {
			const pinR = Math.max(2 / transform.scale, 1);
			ctx.beginPath();
			ctx.arc(node.x, node.y, pinR, 0, Math.PI * 2);
			ctx.fillStyle = c.textOnAccent;
			ctx.fill();
		}
	}

	// ── Unified label rendering ──────────────────────────────
	// One pass determines label text, style, and opacity per node.
	// Priority: hover context → zoom labels → search highlights.
	const denseGraph = simNodes.length >= REPRESENTATIVE_LABEL_NODE_THRESHOLD;
	const representativeLabelThreshold = labelZoomThreshold;
	const allLabelsThreshold = denseGraph
		? Math.max(
				representativeLabelThreshold,
				representativeLabelThreshold *
					(1 + (FULL_LABEL_DENSE_GRAPH_MULTIPLIER - 1) * REPRESENTATIVE_LABEL_ZOOM_RATIO),
			)
		: labelZoomThreshold;
	const showRepresentativeLabels =
		denseGraph &&
		labelZoomThreshold > 0 &&
		transform.scale >= representativeLabelThreshold &&
		transform.scale < allLabelsThreshold;
	const representativeLabelOpacity = showRepresentativeLabels
		? Math.min(
				1,
				(transform.scale - representativeLabelThreshold) /
					Math.max(0.25, allLabelsThreshold - representativeLabelThreshold),
			)
		: 0;
	const showAllLabels = labelZoomThreshold > 0 && transform.scale >= allLabelsThreshold;
	const showClusterAnchors = clusterRepresentativeNodes.size > 0;
	const zoomLabelOpacity = showAllLabels
		? Math.min(1, (transform.scale - allLabelsThreshold) / Math.max(0.25, allLabelsThreshold))
		: 0;
	const hovId = hoveredNode?.id ?? null;
	const hoverNeighbors = hovId ? adjacency.get(hovId) : undefined;

	const fontSize = Math.max(4.5 / transform.scale, 2.8);
	const baseLabelFont = `${fontSize}px ${c.font}`;
	ctx.font = baseLabelFont;
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";

	// Label occlusion culling: track drawn label bounding boxes in screen space
	// and skip any label that would overlap an already-drawn one.
	const drawnLabelRects: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
	const LABEL_PAD_X = 2; // horizontal padding between labels (screen px)
	const LABEL_PAD_Y = 1; // vertical padding between labels (screen px)

	function canDrawLabel(nodeX: number, labelY: number, text: string): boolean {
		const textW = ctx!.measureText(text).width;
		// Convert label bounds from graph space to screen space
		const sx = nodeX * transform.scale + transform.x;
		const sy = labelY * transform.scale + transform.y;
		const sw = textW * transform.scale;
		const sh = fontSize * transform.scale;
		const x1 = sx - sw / 2 - LABEL_PAD_X;
		const y1 = sy - sh - LABEL_PAD_Y;
		const x2 = sx + sw / 2 + LABEL_PAD_X;
		const y2 = sy + LABEL_PAD_Y;

		for (const r of drawnLabelRects) {
			if (x1 < r.x2 && x2 > r.x1 && y1 < r.y2 && y2 > r.y1) return false;
		}
		drawnLabelRects.push({ x1, y1, x2, y2 });
		return true;
	}

	// Sort nodes by label priority: hovered → neighbors → highlighted →
	// cluster representatives → high-degree → rest. Higher-priority labels
	// reserve screen space first so lower-priority ones get culled.
	const sortedLabelNodes = simNodes.filter((n) => n.x != null && n.y != null);
	sortedLabelNodes.sort((a, b) => {
		const pa =
			a.id === hovId
				? 0
				: hoverNeighbors?.has(a.id)
					? 1
					: a.highlighted
						? 2
						: clusterRepresentativeIds.has(a.id)
							? 3
							: 4;
		const pb =
			b.id === hovId
				? 0
				: hoverNeighbors?.has(b.id)
					? 1
					: b.highlighted
						? 2
						: clusterRepresentativeIds.has(b.id)
							? 3
							: 4;
		if (pa !== pb) return pa - pb;
		return (b.degree ?? 0) - (a.degree ?? 0);
	});

	for (const node of sortedLabelNodes) {
		const radius = getNodeRadius(node);
		const labelY = node.y - radius - 2 / transform.scale;
		const nodeAlpha = hoverAlphas.get(node.id) ?? 0.85;

		if (hovId && node.id === hovId) {
			// Hovered node: always show, skip occlusion (reserves its rect)
			canDrawLabel(node.x, labelY, node.label);
			ctx.font = baseLabelFont;
			ctx.fillStyle = c.textNormal;
			ctx.globalAlpha = 1;
			ctx.fillText(node.label, node.x, labelY);
		} else if (hovId && hoverNeighbors?.has(node.id)) {
			// Neighbor of hovered node — draw only if no overlap
			if (!canDrawLabel(node.x, labelY, node.label)) continue;
			ctx.font = baseLabelFont;
			ctx.fillStyle = c.textMuted;
			ctx.globalAlpha = nodeAlpha;
			ctx.fillText(node.label, node.x, labelY);
		} else if (showAllLabels) {
			// Zoom labels: visible for all remaining nodes — cull overlaps
			if (!canDrawLabel(node.x, labelY, node.label)) continue;
			ctx.font = baseLabelFont;
			ctx.fillStyle = node.highlighted ? c.textAccent : c.textNormal;
			ctx.globalAlpha = nodeAlpha * zoomLabelOpacity;
			ctx.fillText(node.label, node.x, labelY);
		} else if (showRepresentativeLabels && clusterRepresentativeIds.has(node.id)) {
			// Dense graphs: representative nodes are labeled by screen-space cluster anchors.
		} else if (node.highlighted && !hovId) {
			// Search highlights — cull overlaps
			if (!canDrawLabel(node.x, labelY, node.label)) continue;
			ctx.font = baseLabelFont;
			ctx.fillStyle = c.textAccent;
			ctx.globalAlpha = 1;
			ctx.fillText(node.label, node.x, labelY);
		}
	}
	ctx.globalAlpha = 1;

	// ── Lasso path (graph space) ──────────────────────────────
	if (isLassoing && lassoPoints.length >= 2) {
		ctx.beginPath();
		ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
		for (let i = 1; i < lassoPoints.length; i++) {
			ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
		}
		ctx.closePath();
		// Semi-transparent fill
		ctx.fillStyle = c.accent;
		ctx.globalAlpha = 0.08;
		ctx.fill();
		// Dashed stroke
		const dash = 4 / transform.scale;
		ctx.setLineDash([dash, dash]);
		ctx.strokeStyle = c.accent;
		ctx.lineWidth = 2 / transform.scale;
		ctx.globalAlpha = 0.6;
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}

	ctx.restore();

	// ── Cluster anchors (screen space) ─────────────────────────
	{
		const dpr = window.devicePixelRatio || 1;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		clusterAnchorHitAreas = [];

		if (showClusterAnchors) {
			ctx.textAlign = "left";
			ctx.textBaseline = "middle";
			ctx.font = `600 11px ${c.font}`;

			// Phase 1: compute initial positions and sizes for all visible anchors
			const anchorPlacements: Array<{
				cluster: number;
				node: SimNode;
				text: string;
				pillW: number;
				pillH: number;
				idealX: number;
				idealY: number;
				x: number;
				y: number;
				isFocused: boolean;
				color: string;
			}> = [];

			const ANCHOR_PILL_H = 20;
			const ANCHOR_GAP = 4; // minimum gap between anchor pills

			for (const [cluster, node] of clusterRepresentativeNodes) {
				if (node.x == null || node.y == null) continue;
				if (focusedClusters.size > 0 && !focusedClusters.has(cluster)) continue;

				const screenX = node.x * transform.scale + transform.x;
				const screenY = node.y * transform.scale + transform.y;
				const anchorLabel = clusterLabels[cluster] ?? node.label;
				const nodeCount = clusterNodeCounts.get(cluster) ?? 0;
				const anchorText = `${anchorLabel} · ${nodeCount}`;
				const textWidth = ctx.measureText(anchorText).width;
				const pillWidth = Math.min(200, Math.max(80, textWidth + 16));
				const pillX = Math.max(8, Math.min(width - pillWidth - 8, screenX + 8));
				const pillY = Math.max(8, Math.min(height - ANCHOR_PILL_H - 8, screenY - ANCHOR_PILL_H - 6));

				anchorPlacements.push({
					cluster,
					node,
					text: anchorText,
					pillW: pillWidth,
					pillH: ANCHOR_PILL_H,
					idealX: pillX,
					idealY: pillY,
					x: pillX,
					y: pillY,
					isFocused: focusedClusters.has(cluster),
					color: node.color ?? c.graphNode,
				});
			}

			// Phase 2: greedy overlap resolution — nudge colliding pills apart.
			// Sort by idealY so top-most anchors get priority placement.
			anchorPlacements.sort((a, b) => a.idealY - b.idealY);

			for (let pass = 0; pass < 3; pass++) {
				for (let i = 0; i < anchorPlacements.length; i++) {
					const a = anchorPlacements[i];
					for (let j = i + 1; j < anchorPlacements.length; j++) {
						const b = anchorPlacements[j];

						// Check overlap with gap
						const overlapX = a.x < b.x + b.pillW + ANCHOR_GAP && a.x + a.pillW + ANCHOR_GAP > b.x;
						const overlapY = a.y < b.y + b.pillH + ANCHOR_GAP && a.y + a.pillH + ANCHOR_GAP > b.y;

						if (overlapX && overlapY) {
							// Compute overlap depth in each axis
							const overlapDepthY =
								Math.min(a.y + a.pillH + ANCHOR_GAP, b.y + b.pillH + ANCHOR_GAP) - Math.max(a.y, b.y);
							const overlapDepthX =
								Math.min(a.x + a.pillW + ANCHOR_GAP, b.x + b.pillW + ANCHOR_GAP) - Math.max(a.x, b.x);

							if (overlapDepthY <= overlapDepthX) {
								// Push apart vertically (cheaper, more natural)
								const pushY = overlapDepthY / 2 + 1;
								a.y = Math.max(8, a.y - pushY);
								b.y = Math.min(height - b.pillH - 8, b.y + pushY);
							} else {
								// Push apart horizontally
								const pushX = overlapDepthX / 2 + 1;
								a.x = Math.max(8, a.x - pushX);
								b.x = Math.min(width - b.pillW - 8, b.x + pushX);
							}
						}
					}
				}
			}

			// Phase 3: render leader lines, then pills on top
			// Leader lines connect each anchor pill to its representative node.
			for (const anchor of anchorPlacements) {
				const nodeScreenX = anchor.node.x! * transform.scale + transform.x;
				const nodeScreenY = anchor.node.y! * transform.scale + transform.y;
				const pillCenterX = anchor.x + anchor.pillW / 2;
				const pillCenterY = anchor.y + anchor.pillH / 2;

				// Only draw if the pill drifted noticeably from the node
				const dist = Math.sqrt((pillCenterX - nodeScreenX) ** 2 + (pillCenterY - nodeScreenY) ** 2);
				if (dist > anchor.pillW * 0.6) {
					ctx.beginPath();
					ctx.moveTo(pillCenterX, pillCenterY);
					ctx.lineTo(nodeScreenX, nodeScreenY);
					const dash = 3;
					ctx.setLineDash([dash, dash]);
					ctx.strokeStyle = anchor.color;
					ctx.lineWidth = 0.75;
					ctx.globalAlpha = anchor.isFocused ? 0.5 : 0.25;
					ctx.stroke();
					ctx.setLineDash([]);
				}
			}

			for (const anchor of anchorPlacements) {
				ctx.globalAlpha = anchor.isFocused ? 0.96 : 0.88;
				ctx.fillStyle = c.bgPrimary;
				ctx.beginPath();
				ctx.roundRect(anchor.x, anchor.y, anchor.pillW, anchor.pillH, 999);
				ctx.fill();

				ctx.strokeStyle = anchor.color;
				ctx.lineWidth = anchor.isFocused ? 1.75 : 1;
				ctx.stroke();

				ctx.globalAlpha = 1;
				ctx.fillStyle = c.textNormal;
				const maxTextW = anchor.pillW - 16;
				const displayText = truncateText(ctx, anchor.text, maxTextW);
				ctx.fillText(displayText, anchor.x + 8, anchor.y + anchor.pillH / 2 + 0.5);

				clusterAnchorHitAreas.push({
					x: anchor.x,
					y: anchor.y,
					w: anchor.pillW,
					h: anchor.pillH,
					cluster: anchor.cluster,
				});
			}
		}

		ctx.restore();
	}

	// ── Edge legend (screen space) ──────────────────────────────
	{
		const dpr = window.devicePixelRatio || 1;

		ctx.save();
		// reset to identity so we draw in device pixels
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const lx = 16;
		const ly = canvasEl.height / dpr - 40;
		const rowH = 18;

		ctx.font = `${11}px ${c.font}`;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";

		edgeLegendHitAreas = [];

		// Wiki link line (solid)
		ctx.globalAlpha = showWikiLinks ? 0.7 : 0.25;
		ctx.beginPath();
		ctx.setLineDash([]);
		ctx.moveTo(lx, ly);
		ctx.lineTo(lx + 28, ly);
		ctx.strokeStyle = c.textFaint;
		ctx.lineWidth = 1.5;
		ctx.stroke();

		ctx.fillStyle = c.textMuted;
		ctx.fillText("Wiki link", lx + 34, ly);

		if (!showWikiLinks) {
			// Strikethrough
			const textW = ctx.measureText("Wiki link").width;
			ctx.beginPath();
			ctx.moveTo(lx + 34, ly);
			ctx.lineTo(lx + 34 + textW, ly);
			ctx.strokeStyle = c.textMuted;
			ctx.lineWidth = 1;
			ctx.setLineDash([]);
			ctx.stroke();
		}

		edgeLegendHitAreas.push({ x: lx, y: ly - rowH / 2, w: 120, h: rowH, type: "wiki" });

		ctx.globalAlpha = 1;
		ctx.restore();
	}

	// ── Edge weight tooltip (screen space) ─────────────────────
	if (hoveredEdge && !hoveredNode) {
		const s = hoveredEdge.source as SimNode;
		const t = hoveredEdge.target as SimNode;
		if (s.x != null && s.y != null && t.x != null && t.y != null) {
			// Midpoint in graph coords → screen coords
			const midGX = (s.x + t.x) / 2;
			const midGY = (s.y + t.y) / 2;
			const midSX = midGX * transform.scale + transform.x;
			const midSY = midGY * transform.scale + transform.y;

			const dpr = window.devicePixelRatio || 1;
			ctx.save();
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			const label = `wiki · ${hoveredEdge.weight}`;

			ctx.font = `11px ${c.font}`;
			const metrics = ctx.measureText(label);
			const padX = 6;
			const padY = 4;
			const boxW = metrics.width + padX * 2;
			const boxH = 18;
			const bx = midSX - boxW / 2;
			const by = midSY - boxH - 6;

			// Background pill
			ctx.globalAlpha = 0.85;
			ctx.fillStyle = c.bgPrimary;
			ctx.beginPath();
			ctx.roundRect(bx, by, boxW, boxH, 4);
			ctx.fill();
			ctx.strokeStyle = c.textFaint;
			ctx.lineWidth = 0.5;
			ctx.stroke();

			// Text
			ctx.globalAlpha = 1;
			ctx.fillStyle = c.textNormal;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(label, midSX, by + boxH / 2);

			ctx.restore();
		}
	}

	// ── Node info tooltip (screen space) ───────────────────────
	if (hoveredNode && hoveredNode.x != null && hoveredNode.y != null) {
		const dpr = window.devicePixelRatio || 1;
		const sx = hoveredNode.x * transform.scale + transform.x;
		const sy = hoveredNode.y * transform.scale + transform.y;

		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const lines: string[] = [hoveredNode.label];
		if (hoveredNode.cluster != null) {
			const clusterLabel = clusterLabels[hoveredNode.cluster] ?? `Cluster ${hoveredNode.cluster}`;
			lines.push(`${clusterLabel}  ·  ${hoveredNode.degree ?? 0} connections`);
		} else {
			lines.push(`${hoveredNode.degree ?? 0} connections`);
		}
		if (isForceMode && pinnedNodes.has(hoveredNode.id)) {
			lines.push("📌 Pinned");
		}

		const fontSize = 11;
		const lineH = 16;
		const padX = 10;
		const padY = 8;
		ctx.font = `${fontSize}px ${c.font}`;

		let maxW = 0;
		for (const line of lines) {
			const w = ctx.measureText(line).width;
			if (w > maxW) maxW = w;
		}
		const boxW = maxW + padX * 2;
		const boxH = lines.length * lineH + padY * 2;

		// Position to the right of the node, flip if near right edge
		const canvasW = canvasEl.width / dpr;
		let bx = sx + 14;
		if (bx + boxW > canvasW - 8) bx = sx - boxW - 14;
		const by = sy - boxH / 2;

		// Background
		ctx.globalAlpha = 0.92;
		ctx.fillStyle = c.bgPrimary;
		ctx.beginPath();
		ctx.roundRect(bx, by, boxW, boxH, 6);
		ctx.fill();
		ctx.strokeStyle = c.textFaint;
		ctx.lineWidth = 0.5;
		ctx.stroke();

		// Lines
		ctx.globalAlpha = 1;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";

		for (let i = 0; i < lines.length; i++) {
			ctx.font = i === 0 ? `bold ${fontSize}px ${c.font}` : `${fontSize}px ${c.font}`;
			ctx.fillStyle = i === 0 ? c.textNormal : c.textMuted;
			ctx.fillText(lines[i], bx + padX, by + padY + i * lineH);
		}

		ctx.restore();
	}
}

/**
 * Resize the canvas to fill its container.
 */
function resizeCanvas() {
	if (!canvasEl || !containerEl) return;
	const rect = containerEl.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;
	canvasEl.width = rect.width * dpr;
	canvasEl.height = rect.height * dpr;
	canvasEl.style.width = `${rect.width}px`;
	canvasEl.style.height = `${rect.height}px`;
	const ctx = canvasEl.getContext("2d");
	if (ctx) ctx.scale(dpr, dpr);

	// Center transform if not already set
	if (transform.x === 0 && transform.y === 0) {
		transform = { ...transform, x: rect.width / 2, y: rect.height / 2 };
	}

	render();
}

// ============================================================================
// Event handlers
// ============================================================================

function handleMouseDown(e: PointerEvent) {
	e.preventDefault(); // Prevent native drag on canvas
	containerEl.focus(); // Ensure keyboard events work
	const rect = canvasEl.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	// Shift+click on a node toggles its selection; Shift+drag on empty space starts lasso
	if (lassoMode || e.shiftKey) {
		const node = findNodeAt(x, y);
		if (node && e.shiftKey && !lassoMode) {
			// Toggle individual node selection
			const next = new Set(selectedNodes);
			if (next.has(node.id)) {
				next.delete(node.id);
			} else {
				next.add(node.id);
			}
			selectedNodes = next;
			onSelectionChange?.(simNodes.filter((n) => next.has(n.id)).map((n) => n.path));
			lassoJustFinished = true; // suppress the subsequent click event
			render();
			return;
		}
		isLassoing = true;
		const graphPos = screenToGraph(x, y);
		lassoPoints = [graphPos];
		canvasEl.setPointerCapture(e.pointerId);
		return;
	}

	const node = findNodeAt(x, y);

	if (node && isForceMode) {
		// Start dragging a node (only in wiki/force mode — smart mode positions are projected)
		const sn = simNodeMap.get(node.id);
		if (!sn) return;
		draggedNode = node;
		dragSimNode = sn;
		hasDragged = false;
		simulation?.alphaTarget(0.3).restart();
		sn.fx = sn.x;
		sn.fy = sn.y;
		// Capture pointer so drag continues even outside canvas
		canvasEl.setPointerCapture(e.pointerId);
	} else {
		// Start panning
		isPanning = true;
		panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
	}
}

function handleMouseMove(e: PointerEvent) {
	const rect = canvasEl.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	if (isLassoing) {
		const graphPos = screenToGraph(x, y);
		// Throttle: only add point if moved at least 3px in screen space from last point
		const last = lassoPoints[lassoPoints.length - 1];
		if (last) {
			const lastSX = last.x * transform.scale + transform.x;
			const lastSY = last.y * transform.scale + transform.y;
			const dist = Math.sqrt((x - lastSX) ** 2 + (y - lastSY) ** 2);
			if (dist < 3) return;
		}
		lassoPoints = [...lassoPoints, graphPos];
		render();
		return;
	}

	if (dragSimNode) {
		// Drag node
		hasDragged = true;
		hoveredNode = null;
		hoveredEdge = null;
		const graphPos = screenToGraph(x, y);
		dragSimNode.fx = graphPos.x;
		dragSimNode.fy = graphPos.y;
		render();
	} else if (isPanning) {
		// Pan
		hasDragged = true;
		transform = {
			...transform,
			x: e.clientX - panStart.x,
			y: e.clientY - panStart.y,
		};
		render();
	} else {
		// Hover detection: check cluster legend first, then nodes, then edges
		let overClusterAnchor = false;
		for (const area of clusterAnchorHitAreas) {
			if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
				overClusterAnchor = true;
				break;
			}
		}

		if (overClusterAnchor) {
			canvasEl.style.cursor = "pointer";
			if (hoveredNode || hoveredEdge) {
				hoveredNode = null;
				hoveredEdge = null;
				render();
			}
			return;
		}

		{
			// Check edge legend hit areas
			let overEdgeLegend = false;
			for (const area of edgeLegendHitAreas) {
				if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
					overEdgeLegend = true;
					break;
				}
			}

			if (overEdgeLegend) {
				canvasEl.style.cursor = "pointer";
				if (hoveredNode || hoveredEdge) {
					hoveredNode = null;
					hoveredEdge = null;
					render();
				}
			} else {
				const node = findNodeAt(x, y);
				if (node !== hoveredNode) {
					hoveredNode = node;
					hoveredEdge = null;
					previewTriggeredForNode = null; // reset preview tracker on node change
					canvasEl.style.cursor = node ? "pointer" : lassoMode ? "crosshair" : "grab";
					render();
				}
				// Cmd/Ctrl+hover triggers note preview (fire once per node)
				if (node && (e.metaKey || e.ctrlKey) && onHoverPreview && previewTriggeredForNode !== node.id) {
					triggerNodePreview(e, node);
				}
				if (!node) {
					// No node hovered — check edges
					const edge = findEdgeAt(x, y);
					if (edge !== hoveredEdge) {
						hoveredEdge = edge;
						canvasEl.style.cursor = edge ? "crosshair" : lassoMode ? "crosshair" : "grab";
						render();
					}
				}
			}
		}
	}
}

function handleMouseUp(_e: PointerEvent) {
	if (isLassoing) {
		isLassoing = false;
		lassoJustFinished = true;
		if (lassoPoints.length >= 3) {
			// Run point-in-polygon for all sim nodes, merging with existing selection
			const merged = new Set(selectedNodes);
			for (const node of simNodes) {
				if (node.x == null || node.y == null) continue;
				if (pointInPolygon(node.x, node.y, lassoPoints)) {
					merged.add(node.id);
				}
			}
			if (merged.size !== selectedNodes.size) {
				selectedNodes = merged;
				onSelectionChange?.(simNodes.filter((n) => merged.has(n.id)).map((n) => n.path));
			}
		}
		lassoPoints = [];
		render();
		return;
	}
	if (dragSimNode) {
		simulation?.alphaTarget(0);
		if (!pinnedNodes.has(dragSimNode.id)) {
			dragSimNode.fx = null;
			dragSimNode.fy = null;
		}
		draggedNode = null;
		dragSimNode = null;
	}
	isPanning = false;
}

function handleClick(e: MouseEvent) {
	// Ignore clicks that were actually drags or lasso completions
	if (hasDragged) {
		hasDragged = false;
		return;
	}
	if (lassoJustFinished) {
		lassoJustFinished = false;
		return;
	}

	const rect = canvasEl.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	// Check edge legend hit areas (screen space)
	for (const area of edgeLegendHitAreas) {
		if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
			onToggleWikiLinks?.();
			render();
			return;
		}
	}

	for (const area of clusterAnchorHitAreas) {
		if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
			onFocusCluster?.(area.cluster);
			render();
			return;
		}
	}

	const node = findNodeAt(x, y);

	if (node) {
		if (onNodeClick) {
			onNodeClick(node.path);
		}
	} else {
		// Click on empty space clears selection and focused clusters
		if (selectedNodes.size > 0) clearSelection();
		if (focusedClusters.size > 0) onClearFocusedClusters?.();
	}
}

function handleWheel(e: WheelEvent) {
	e.preventDefault();
	const rect = canvasEl.getBoundingClientRect();
	const mouseX = e.clientX - rect.left;
	const mouseY = e.clientY - rect.top;

	const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
	const newScale = Math.max(0.1, Math.min(10, transform.scale * zoomFactor));

	// Zoom toward mouse position
	const scaleRatio = newScale / transform.scale;
	transform = {
		x: mouseX - (mouseX - transform.x) * scaleRatio,
		y: mouseY - (mouseY - transform.y) * scaleRatio,
		scale: newScale,
	};

	render();
}

/**
 * Fire the hover-link preview for a node exactly once.
 * Positions the invisible anchor at the node's screen location.
 */
function triggerNodePreview(event: MouseEvent | KeyboardEvent, node: GraphNode) {
	const sx = (node.x ?? 0) * transform.scale + transform.x;
	const sy = (node.y ?? 0) * transform.scale + transform.y;
	hoverAnchorEl.style.left = `${sx}px`;
	hoverAnchorEl.style.top = `${sy}px`;
	previewTriggeredForNode = node.id;
	onHoverPreview?.(event as MouseEvent, node.path, hoverAnchorEl);
}

function handleMouseLeave() {
	hoveredNode = null;
	hoveredEdge = null;
	previewTriggeredForNode = null;
	// Drag continues via pointer capture — only cancel pan
	isPanning = false;
	render();
}

function handleContextMenu(e: MouseEvent) {
	e.preventDefault();
	const rect = canvasEl.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;
	const node = findNodeAt(x, y);

	if (!node) return;

	const menu = new Menu();

	menu.addItem((item) =>
		item
			.setTitle("Open file")
			.setIcon("file-text")
			.onClick(() => {
				onNodeClick?.(node.path);
			}),
	);

	menu.addItem((item) =>
		item
			.setTitle("Reveal in file explorer")
			.setIcon("folder-open")
			.onClick(() => {
				onRevealFile?.(node.path);
			}),
	);

	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Focus on this cluster")
			.setIcon("scan")
			.onClick(() => {
				if (node.cluster != null) {
					onFocusCluster?.(node.cluster);
				}
			}),
	);

	menu.addItem((item) =>
		item
			.setTitle("Select this cluster")
			.setIcon("box-select")
			.onClick(() => {
				if (node.cluster != null) {
					const clusterPaths = simNodes.filter((n) => n.cluster === node.cluster).map((n) => n.path);
					selectNodesByPaths(clusterPaths);
					onSelectionChange?.(clusterPaths);
				}
			}),
	);

	// Pin/unpin only makes sense in force-layout (wiki) mode
	if (isForceMode) {
		menu.addSeparator();

		const isPinned = pinnedNodes.has(node.id);
		menu.addItem((item) =>
			item
				.setTitle(isPinned ? "Unpin node" : "Pin node")
				.setIcon(isPinned ? "pin-off" : "pin")
				.onClick(() => {
					const simNode = simNodeMap.get(node.id);
					if (!simNode) return;

					if (isPinned) {
						pinnedNodes.delete(node.id);
						simNode.fx = null;
						simNode.fy = null;
					} else {
						pinnedNodes.add(node.id);
						simNode.fx = simNode.x;
						simNode.fy = simNode.y;
					}

					simulation?.alpha(0.1).restart();
					render();
				}),
		);
	}

	menu.showAtPosition({ x: e.clientX, y: e.clientY });
}

// ============================================================================
// Cluster cohesion helpers
// ============================================================================

/** Compute the 2D centroid (mean x, y) for each cluster. */
function computeClusterCentroids(nodes: SimNode[]): Map<number, { x: number; y: number }> {
	const sums = new Map<number, { sx: number; sy: number; count: number }>();
	for (const n of nodes) {
		const c = n.cluster ?? 0;
		const entry = sums.get(c) ?? { sx: 0, sy: 0, count: 0 };
		entry.sx += n.x ?? 0;
		entry.sy += n.y ?? 0;
		entry.count += 1;
		sums.set(c, entry);
	}
	const centroids = new Map<number, { x: number; y: number }>();
	for (const [c, { sx, sy, count }] of sums) {
		centroids.set(c, { x: sx / count, y: sy / count });
	}
	return centroids;
}

/**
 * Custom d3-force that gently pulls each node toward its cluster's 2D centroid.
 * The centroid is recomputed every tick so it tracks the moving average.
 */
function clusterCohesionForce(nodes: SimNode[], strength: number) {
	let _strength = strength;

	function force(alpha: number) {
		// Recompute centroids each tick so they follow the nodes
		const centroids = computeClusterCentroids(nodes);

		for (const node of nodes) {
			// Skip pinned nodes
			if (node.fx != null && node.fy != null) continue;

			const centroid = centroids.get(node.cluster ?? 0);
			if (!centroid) continue;

			const dx = centroid.x - (node.x ?? 0);
			const dy = centroid.y - (node.y ?? 0);
			node.vx = (node.vx ?? 0) + dx * _strength * alpha;
			node.vy = (node.vy ?? 0) + dy * _strength * alpha;
		}
	}

	force.strength = (s?: number) => {
		if (s === undefined) return _strength;
		_strength = s;
		return force;
	};

	// d3 force interface: initialize is a no-op since we track nodes directly
	force.initialize = () => {};

	return force;
}

// ============================================================================
// Shared graph data setup (used by both wiki and smart modes)
// ============================================================================

/**
 * Build the internal node/link data structures from the incoming GraphData.
 * This is shared between wiki (d3-force) and smart (static) modes.
 */
function buildInternalData(data: GraphData): {
	oldPositions: Map<string, { x: number; y: number }>;
	isSmooth: boolean;
} {
	// Save old positions for smooth transitions
	const oldPositions = new Map<string, { x: number; y: number }>();
	for (const n of simNodes) {
		if (n.x != null && n.y != null) {
			oldPositions.set(n.id, { x: n.x, y: n.y });
		}
	}

	// Compute centroid of old positions so new nodes (without a prior position)
	// can be scattered around it instead of stacking at (0,0).
	let centroidX = 0;
	let centroidY = 0;
	if (oldPositions.size > 0) {
		for (const { x, y } of oldPositions.values()) {
			centroidX += x;
			centroidY += y;
		}
		centroidX /= oldPositions.size;
		centroidY /= oldPositions.size;
	}

	// Create mutable copies.
	// Always start from old positions when available so transitions are smooth.
	// Nodes without a prior position are scattered near the centroid of old nodes
	// to avoid the "pile at origin" effect during mode transitions.
	let newNodeIndex = 0;
	simNodes = data.nodes.map((n) => {
		const sn: SimNode = { ...n };
		const old = oldPositions.get(n.id);
		if (old) {
			sn.x = old.x;
			sn.y = old.y;
		} else if (oldPositions.size > 0) {
			// Scatter new nodes in a ring around the centroid of the old layout
			const angle = (2 * Math.PI * newNodeIndex) / Math.max(1, data.nodes.length - oldPositions.size);
			const radius = 80 + Math.random() * 60;
			sn.x = centroidX + Math.cos(angle) * radius;
			sn.y = centroidY + Math.sin(angle) * radius;
			newNodeIndex++;
		}
		// Restore pinned positions in wiki (force) mode
		if (isForceMode && pinnedNodes.has(n.id) && old) {
			sn.fx = old.x;
			sn.fy = old.y;
		}
		return sn;
	});

	// Prune pinned set for removed nodes
	const nodeIds = new Set(data.nodes.map((n) => n.id));
	for (const id of pinnedNodes) {
		if (!nodeIds.has(id)) pinnedNodes.delete(id);
	}
	simNodeMap = new Map(simNodes.map((n) => [n.id, n]));

	simLinks = data.edges
		.filter((e) => simNodeMap.has(e.source) && simNodeMap.has(e.target))
		.map((e) => ({
			source: simNodeMap.get(e.source)!,
			target: simNodeMap.get(e.target)!,
			weight: e.weight,
			type: e.type,
		}));

	// Pre-split by edge type to avoid filtering every render frame
	wikiSimLinks = simLinks.filter((l) => l.type === "wiki");
	const clusterRepresentatives = deriveClusterRepresentativesFromGraph(data);
	clusterRepresentativeIds = new Set([...clusterRepresentatives.values()].map((node) => node.id));
	clusterRepresentativeNodes = new Map(
		[...clusterRepresentatives].flatMap(([cluster, node]) => {
			const simNode = simNodeMap.get(node.id);
			return simNode ? [[cluster, simNode] as const] : [];
		}),
	);
	clusterNodeCounts = new Map<number, number>();
	for (const node of data.nodes) {
		if (node.cluster == null) continue;
		clusterNodeCounts.set(node.cluster, (clusterNodeCounts.get(node.cluster) ?? 0) + 1);
	}

	// Build adjacency map for O(1) hover-dimming lookups
	adjacency = new Map();
	// Build edge lookup map for O(1) weight lookups on hover labels
	edgeLookup = new Map();
	for (const link of simLinks) {
		const sId = (link.source as SimNode).id;
		const tId = (link.target as SimNode).id;
		if (!adjacency.has(sId)) adjacency.set(sId, new Set());
		if (!adjacency.has(tId)) adjacency.set(tId, new Set());
		adjacency.get(sId)!.add(tId);
		adjacency.get(tId)!.add(sId);

		// Store edge by canonical key; keep highest-weight edge per pair
		const ek = edgeKey(sId, tId);
		const existing = edgeLookup.get(ek);
		if (!existing || link.weight > existing.weight) {
			edgeLookup.set(ek, link);
		}
	}

	// Start edge fade-in when the edge set changes (skip on smooth data swap)
	const isSmooth = skipNextSetupEffects;
	if (isSmooth) skipNextSetupEffects = false;
	if (!isSmooth) edgeFadeAlpha = 0;

	return { oldPositions, isSmooth };
}

// ============================================================================
// Smart mode: static projected layout (no d3-force)
// ============================================================================

/** Stop the smart-mode rAF render loop. */
function stopSmartRaf() {
	if (smartRafId != null) {
		cancelAnimationFrame(smartRafId);
		smartRafId = null;
	}
}

/**
 * Set up the smart (projected) graph — nodes are placed directly at their
 * projected x/y coordinates. No d3-force simulation is used.
 *
 * If nodes had previous positions (e.g. from a re-projection), animates
 * them to their new positions using a rAF-based lerp.
 */
function setupSmartLayout(data: GraphData, oldPositions: Map<string, { x: number; y: number }>, isSmooth: boolean) {
	const shouldAnimate = oldPositions.size > 0 && !isSmooth;

	if (shouldAnimate) {
		// Build target map from the raw projected positions.
		// We animate directly to these (no rescaling) so the final layout
		// is identical to a fresh start in smart mode.
		const projTargets = new Map<string, { x: number; y: number }>();
		for (const n of data.nodes) {
			if (n.x != null && n.y != null) {
				projTargets.set(n.id, { x: n.x, y: n.y });
			}
		}

		const TRANSITION_DURATION = 900; // ms
		const startTime = performance.now();
		// Snapshot start positions (in the old coordinate space)
		const startPositions = new Map<string, { x: number; y: number }>();
		for (const sn of simNodes) {
			startPositions.set(sn.id, { x: sn.x ?? 0, y: sn.y ?? 0 });
		}

		needsInitialFit = false;

		// Capture the camera transform at animation start so we can
		// smoothly interpolate it alongside the node positions.
		cancelCameraAnim();

		function animateStep(now: number) {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / TRANSITION_DURATION, 1);
			const ease = easeOutCubic(t);

			for (const sn of simNodes) {
				const start = startPositions.get(sn.id);
				const target = projTargets.get(sn.id);
				if (start && target) {
					sn.x = start.x + (target.x - start.x) * ease;
					sn.y = start.y + (target.y - start.y) * ease;
				}
			}

			// Continuously reframe the camera as nodes move so there's
			// no jarring jump at the end.
			if (!canvasEl) {
				render();
			} else {
				const bounds = computeNodeBounds(simNodes);
				if (bounds) {
					const rect = canvasEl.getBoundingClientRect();
					const target = framingTransform(bounds, { width: rect.width, height: rect.height }, 20);
					// Blend camera toward target each frame for a smooth follow
					const camBlend = Math.min(ease, 1);
					transform = {
						x: transform.x + (target.x - transform.x) * camBlend,
						y: transform.y + (target.y - transform.y) * camBlend,
						scale: transform.scale + (target.scale - transform.scale) * camBlend,
					};
				}
				render();
			}

			if (t < 1) {
				smartRafId = requestAnimationFrame(animateStep);
			} else {
				smartRafId = null;
			}
		}

		smartRafId = requestAnimationFrame(animateStep);
	} else {
		// First load or smooth swap: place nodes directly at projected coords
		// (they already have the right x/y from the data)

		if (!isSmooth) {
			needsInitialFit = true;
			initialFitTickCount = 0;
		} else {
			needsInitialFit = false;
		}

		// Kick off initial fit-to-view via a short rAF sequence.
		// Set the camera directly each frame (no animation) to track the
		// bounding box, then do one smooth animated fitToView at the end.
		if (needsInitialFit) {
			let tickCount = 0;
			function initialFitLoop() {
				tickCount++;
				if (tickCount >= 5 && canvasEl) {
					const bounds = computeNodeBounds(simNodes);
					if (bounds) {
						const rect = canvasEl.getBoundingClientRect();
						transform = framingTransform(bounds, { width: rect.width, height: rect.height }, 20);
					}
				}
				render();
				if (tickCount < 30) {
					smartRafId = requestAnimationFrame(initialFitLoop);
				} else {
					smartRafId = null;
					needsInitialFit = false;
					initialFitTickCount = 0;
					fitToView();
				}
			}
			smartRafId = requestAnimationFrame(initialFitLoop);
		} else {
			render();
		}
	}
}

// ============================================================================
// Wiki mode: d3-force simulation setup
// ============================================================================

function setupForceSimulation(data: GraphData, oldPositions: Map<string, { x: number; y: number }>, isSmooth: boolean) {
	simulation = forceSimulation<SimNode>(simNodes)
		.force(
			"link",
			forceLink<SimNode, SimLink>(simLinks)
				.id((d) => d.id)
				.distance(linkDistance)
				.strength((l) => {
					if (l.type === "wiki") return 0.5;
					return Math.min(l.weight * 0.5, 0.5);
				}),
		)
		.force("charge", forceManyBody().strength(chargeStrength).distanceMax(3000))
		.force("center", forceCenter(0, 0))
		.force("gravityX", forceX<SimNode>(0).strength(0.08))
		.force("gravityY", forceY<SimNode>(0).strength(0.08))
		.force("cluster", clusterCohesionForce(simNodes, 0.15))
		.force(
			"collide",
			forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 2),
		)
		.on("tick", () => {
			// Continuously reframe the camera during initial settling so the
			// graph tracks the shrinking bounding box as nodes converge.
			// We set the transform directly (no animation) to avoid stacking
			// competing animated fitToView calls, then do one smooth animated
			// fitToView once the simulation has nearly settled.
			if (needsInitialFit) {
				initialFitTickCount++;
				if (initialFitTickCount >= 5 && canvasEl) {
					const bounds = computeNodeBounds(simNodes);
					if (bounds) {
						const rect = canvasEl.getBoundingClientRect();
						transform = framingTransform(bounds, { width: rect.width, height: rect.height }, 20);
					}
				}
				if (simulation && simulation.alpha() < 0.1) {
					needsInitialFit = false;
					initialFitTickCount = 0;
					fitToView();
				}
			}
			render();
		})
		.alphaDecay(0.02)
		.velocityDecay(0.3);

	// If nodes already had positions, start with low alpha for gentle transition.
	// On a smooth data swap (e.g. cosmetic update), skip the initial fit entirely.
	// On a mode switch (smart → wiki), use a lower alpha and slower decay so
	// nodes drift into place over ~700ms instead of snapping instantly.
	if (oldPositions.size > 0) {
		if (isSmooth) {
			simulation.alpha(0.05);
			needsInitialFit = false;
		} else {
			simulation.alpha(0.15).alphaDecay(0.008).velocityDecay(0.4);
			needsInitialFit = true;
		}
	}
}

// ============================================================================
// Main graph setup — dispatches to wiki or smart layout engine
// ============================================================================

function setupGraph(data: GraphData) {
	// Stop any existing layout engine
	if (simulation) {
		simulation.stop();
		simulation = null;
	}
	stopSmartRaf();

	if (data.nodes.length === 0) return;

	const { oldPositions, isSmooth } = buildInternalData(data);

	if (isForceMode) {
		// Wiki mode: full d3-force simulation
		setupForceSimulation(data, oldPositions, isSmooth);
	} else {
		// Smart mode: static projected positions, no d3-force
		setupSmartLayout(data, oldPositions, isSmooth);
	}
}

// React to graphData or mode changes
$effect(() => {
	// Access reactive dependencies
	const data = graphData;
	const _mode = mode;
	setupGraph(data);

	return () => {
		if (simulation) {
			simulation.stop();
			simulation = null;
		}
		stopSmartRaf();
	};
});

// Hot-update force parameters without full rebuild (wiki mode only)
$effect(() => {
	if (!simulation || !isForceMode) return;
	const _charge = chargeStrength;
	const _link = linkDistance;

	const charge = simulation.force("charge") as ReturnType<typeof forceManyBody> | undefined;
	if (charge) {
		charge.strength(_charge);
	}

	// Scale gravity inversely: lower repulsion → stronger pull toward center
	const gravityStrength = 0.08 + (1 - Math.abs(_charge) / 800) * 0.12;
	const gx = simulation.force("gravityX") as ReturnType<typeof forceX> | undefined;
	if (gx) gx.strength(gravityStrength);
	const gy = simulation.force("gravityY") as ReturnType<typeof forceY> | undefined;
	if (gy) gy.strength(gravityStrength);

	const link = simulation.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | undefined;
	if (link) link.distance(_link);

	const collide = simulation.force("collide") as ReturnType<typeof forceCollide<SimNode>> | undefined;
	if (collide) collide.radius((d: SimNode) => getNodeRadius(d) + 2);

	simulation.alpha(0.5).restart();
});

onMount(() => {
	resizeCanvas();

	// Register wheel handler as non-passive so preventDefault() works
	canvasEl.addEventListener("wheel", handleWheel, { passive: false });

	// Keyboard handler for graph shortcuts
	function handleKeyDown(e: KeyboardEvent) {
		// Ignore when user is typing in an input/textarea inside the inspector
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

		// Cmd/Ctrl pressed while hovering a node → trigger preview
		if (
			(e.key === "Meta" || e.key === "Control") &&
			hoveredNode &&
			onHoverPreview &&
			previewTriggeredForNode !== hoveredNode.id
		) {
			triggerNodePreview(e, hoveredNode);
			return;
		}

		switch (e.key) {
			case "Escape":
				if (isLassoing) {
					isLassoing = false;
					lassoPoints = [];
					render();
				} else if (selectedNodes.size > 0) {
					clearSelection();
				} else if (focusedClusters.size > 0) {
					onClearFocusedClusters?.();
				}
				break;
			case "f":
				// Zoom to selection if nodes are selected, otherwise fit entire graph
				if (selectedNodes.size > 0) {
					panToSelection();
				} else {
					fitToView();
				}
				break;
			case "=":
			case "+": {
				// Zoom in toward center
				const rect = canvasEl.getBoundingClientRect();
				const cx = rect.width / 2;
				const cy = rect.height / 2;
				const newScale = Math.min(10, transform.scale * 1.2);
				const scaleRatio = newScale / transform.scale;
				transform = {
					x: cx - (cx - transform.x) * scaleRatio,
					y: cy - (cy - transform.y) * scaleRatio,
					scale: newScale,
				};
				render();
				break;
			}
			case "-": {
				// Zoom out from center
				const rect = canvasEl.getBoundingClientRect();
				const cx = rect.width / 2;
				const cy = rect.height / 2;
				const newScale = Math.max(0.1, transform.scale / 1.2);
				const scaleRatio = newScale / transform.scale;
				transform = {
					x: cx - (cx - transform.x) * scaleRatio,
					y: cy - (cy - transform.y) * scaleRatio,
					scale: newScale,
				};
				render();
				break;
			}
		}
	}
	containerEl.addEventListener("keydown", handleKeyDown);
	// Make container focusable so it receives keyboard events
	if (!containerEl.hasAttribute("tabindex")) {
		containerEl.setAttribute("tabindex", "0");
	}

	const resizeObserver = new ResizeObserver(() => {
		resizeCanvas();
	});
	resizeObserver.observe(containerEl);

	// Listen for Obsidian theme changes to invalidate cached colors
	const handleCssChange = () => invalidateThemeColors();
	document.body.addEventListener("css-change", handleCssChange);

	return () => {
		canvasEl.removeEventListener("wheel", handleWheel);
		containerEl.removeEventListener("keydown", handleKeyDown);
		resizeObserver.disconnect();
		document.body.removeEventListener("css-change", handleCssChange);
		cancelCameraAnim();
		if (hoverAnimFrameId != null) cancelAnimationFrame(hoverAnimFrameId);
		if (simulation) {
			simulation.stop();
			simulation = null;
		}
		stopSmartRaf();
	};
});

// Cancel function for the current camera animation (returned by animateTransform)
let cancelCameraAnim: () => void = () => {};

/** Animate the camera to frame the given nodes with the specified padding and duration. */
function animateCameraToNodes(filter?: (node: SimNode) => boolean, padding = 40, duration = 400) {
	if (!canvasEl) return;
	const bounds = computeNodeBounds(simNodes, filter);
	if (!bounds) return;
	const rect = canvasEl.getBoundingClientRect();
	const target = framingTransform(bounds, { width: rect.width, height: rect.height }, padding);

	cancelCameraAnim();
	cancelCameraAnim = animateTransform(
		() => transform,
		(t) => {
			transform = t;
			render();
		},
		target,
		duration,
	);
}

/**
 * Fit the graph to the viewport with smooth animation.
 */
export function fitToView() {
	if (simNodes.length === 0) return;
	animateCameraToNodes(undefined, 20, 300);
}

/**
 * Smoothly pan and zoom to frame the currently selected nodes.
 */
export function panToSelection() {
	if (selectedNodes.size === 0) return;
	animateCameraToNodes((n) => selectedNodes.has(n.id), 60, 400);
}

/**
 * Smoothly pan and zoom to frame the nodes belonging to the given clusters.
 */
export function panToClusters(clusters: Set<number>) {
	if (simNodes.length === 0 || clusters.size === 0) return;
	animateCameraToNodes((n) => n.cluster != null && clusters.has(n.cluster), 60, 400);
}
</script>

<div class="graph-canvas-container" bind:this={containerEl}>
  <canvas
    bind:this={canvasEl}
    onpointerdown={handleMouseDown}
    onpointermove={handleMouseMove}
    onpointerup={handleMouseUp}
    onclick={handleClick}
    onmouseleave={handleMouseLeave}
    oncontextmenu={handleContextMenu}
  ></canvas>
  <!-- Invisible anchor for Obsidian hover-link popover positioning -->
  <div bind:this={hoverAnchorEl} class="hover-anchor"></div>
</div>

<style>
  .graph-canvas-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
    outline: none;
  }

  canvas {
    display: block;
    cursor: grab;
    touch-action: none; /* Required for pointer capture to work */
  }

  canvas:active {
    cursor: grabbing;
  }

  .hover-anchor {
    position: absolute;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
</style>
