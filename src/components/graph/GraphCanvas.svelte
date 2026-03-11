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
import type { GraphData, GraphNode, GraphEdge, EdgeType } from "../../types/graph";

interface Props {
	graphData: GraphData;
	nodeSize: number;
	linkDistance: number;
	chargeStrength?: number;
	labelZoomThreshold?: number;
	discoveryMode?: boolean;
	showSemanticEdges?: boolean;
	showWikiLinks?: boolean;
	useForceLayout?: boolean;
	transitionTargets?: Map<string, { x: number; y: number }> | null;
	onTransitionEnd?: () => void;
	focusedCluster?: number | null;
	clusterLabels?: Record<number, string>;
	isLabeling?: boolean;
	onNodeClick?: (path: string) => void;
	onRevealFile?: (path: string) => void;
	onFocusCluster?: (cluster: number) => void;
	onToggleWikiLinks?: () => void;
	onToggleSemanticEdges?: () => void;
	lassoMode?: boolean;
	onSelectionChange?: (paths: string[]) => void;
}

let {
	graphData,
	nodeSize,
	linkDistance,
	chargeStrength = -150,
	labelZoomThreshold = 2.5,
	discoveryMode = false,
	showSemanticEdges = true,
	showWikiLinks = true,
	useForceLayout = true,
	transitionTargets = null,
	onTransitionEnd,
	focusedCluster = null,
	clusterLabels = {},
	isLabeling = false,
	onNodeClick,
	onRevealFile,
	onFocusCluster,
	onToggleWikiLinks,
	onToggleSemanticEdges,
	lassoMode = false,
	onSelectionChange,
}: Props = $props();

let canvasEl: HTMLCanvasElement;
let containerEl: HTMLDivElement;

// Transform state for zoom/pan
let transform = $state({ x: 0, y: 0, scale: 1 });

// Interaction state
let hoveredNode: GraphNode | null = $state(null);
let draggedNode: GraphNode | null = $state(null);
let hasDragged = false;
let isPanning = $state(false);
let panStart = { x: 0, y: 0 };

// Non-reactive drag reference — directly mutates the d3 SimNode's fx/fy
// without going through Svelte's $state proxy
let dragSimNode: SimNode | null = null;

// Pinned nodes: nodes with fixed positions (fx/fy set)
let pinnedNodes: Set<string> = new Set();

// Lasso selection state
let selectedNodes: Set<string> = $state(new Set());
let isLassoing = $state(false);
let lassoPoints: Array<{ x: number; y: number }> = [];
let lassoJustFinished = false;

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
let semanticSimLinks: SimLink[] = [];

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
let clusterLegendHitAreas: Array<{
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
	type: "wiki" | "semantic";
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

function edgeKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

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
	const hitRadius = (nodeSize + 4) / transform.scale;

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
 * Get the draw radius for a node based on its degree.
 */
function getNodeRadius(node: GraphNode): number {
	const base = nodeSize;
	const degree = node.degree ?? 0;
	return base + Math.min(degree * 0.5, base * 2);
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

	// Draw edges — wiki first (solid, below), then semantic (dashed, on top)
	// This lets users spot new semantic connections that don't exist as wiki links.
	// Uses pre-split arrays (built in setupSimulation) to avoid filtering every frame.

	// Advance edge fade-in (smooth crossfade on mode / data changes)
	if (edgeFadeAlpha < 1) {
		edgeFadeAlpha = Math.min(1, edgeFadeAlpha + EDGE_FADE_RATE);
	}

	if (showWikiLinks) {
		for (const link of wikiSimLinks) {
			const source = link.source as SimNode;
			const target = link.target as SimNode;

			if (source.x == null || source.y == null || target.x == null || target.y == null) continue;

			// Dim edges outside focused cluster
			const inFocus =
				focusedCluster == null || source.cluster === focusedCluster || target.cluster === focusedCluster;

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
			ctx.lineWidth = isHighlighted ? 2 / transform.scale : 1 / transform.scale;
			ctx.globalAlpha =
				(!inFocus ? 0.05 : !inSelection ? 0.05 : isHighlighted ? 0.9 : 0.45) *
				edgeFadeAlpha *
				(isHighlighted ? 1 : edgeHoverAlpha / 0.85);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	} // end showWikiLinks

	if (showSemanticEdges) {
		for (const link of semanticSimLinks) {
			const source = link.source as SimNode;
			const target = link.target as SimNode;

			if (source.x == null || source.y == null || target.x == null || target.y == null) continue;

			// Dim edges outside focused cluster
			const inFocus =
				focusedCluster == null || source.cluster === focusedCluster || target.cluster === focusedCluster;

			// Dim edges outside selection
			const inSelection =
				selectedNodes.size === 0 || (selectedNodes.has(source.id) && selectedNodes.has(target.id));

			const isHighlighted = hoveredNode && (source.id === hoveredNode.id || target.id === hoveredNode.id);

			const edgeHoverAlpha = hoveredNode
				? Math.max(hoverAlphas.get(source.id) ?? 0.85, hoverAlphas.get(target.id) ?? 0.85)
				: 1;

			ctx.beginPath();
			const dash = 4 / transform.scale;
			ctx.setLineDash([dash, dash]);
			ctx.moveTo(source.x, source.y);
			ctx.lineTo(target.x, target.y);
			ctx.strokeStyle = isHighlighted ? c.accent : c.graphLine;
			ctx.lineWidth = isHighlighted ? 2 / transform.scale : Math.max(0.8, link.weight * 3) / transform.scale;
			ctx.globalAlpha =
				(!inFocus
					? 0.05
					: !inSelection
						? 0.05
						: isHighlighted
							? 0.9
							: Math.min(0.25 + link.weight * 0.35, 0.9)) *
				edgeFadeAlpha *
				(isHighlighted ? 1 : edgeHoverAlpha / 0.85);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	} // end showSemanticEdges
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
		} else if (focusedCluster != null && node.cluster !== focusedCluster) {
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

		// Discovery mode: pulsing ring for nodes with semantic but no wiki edges
		if (discoveryMode && node.discoverable && !isHovered && !isDragged) {
			ctx.beginPath();
			ctx.arc(node.x, node.y, radius + 4 / transform.scale, 0, Math.PI * 2);
			ctx.strokeStyle = c.textAccent;
			ctx.lineWidth = 2 / transform.scale;
			ctx.setLineDash([3 / transform.scale, 3 / transform.scale]);
			ctx.globalAlpha = 0.8;
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.globalAlpha = 1;
		}

		// Pinned node indicator: small inner dot
		if (pinnedNodes.has(node.id)) {
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
	const showAllLabels = labelZoomThreshold > 0 && transform.scale >= labelZoomThreshold;
	const zoomLabelOpacity = showAllLabels
		? Math.min(1, (transform.scale - labelZoomThreshold) / labelZoomThreshold)
		: 0;
	const hovId = hoveredNode?.id ?? null;
	const hoverNeighbors = hovId ? adjacency.get(hovId) : undefined;

	const fontSize = Math.max(6 / transform.scale, 3.5);
	ctx.font = `${fontSize}px ${c.font}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";

	for (const node of simNodes) {
		if (node.x == null || node.y == null) continue;
		const radius = getNodeRadius(node);
		const labelY = node.y - radius - 3 / transform.scale;
		const nodeAlpha = hoverAlphas.get(node.id) ?? 0.85;

		if (hovId && node.id === hovId) {
			// Hovered node: always show, full opacity
			ctx.fillStyle = c.textNormal;
			ctx.globalAlpha = 1;
			ctx.fillText(node.label, node.x, labelY);
		} else if (hovId && hoverNeighbors?.has(node.id)) {
			// Neighbor of hovered node
			ctx.fillStyle = c.textMuted;
			ctx.globalAlpha = nodeAlpha;
			ctx.fillText(node.label, node.x, labelY);
		} else if (showAllLabels) {
			// Zoom labels: visible for all remaining nodes
			ctx.fillStyle = node.highlighted ? c.textAccent : c.textNormal;
			ctx.globalAlpha = nodeAlpha * zoomLabelOpacity;
			ctx.fillText(node.label, node.x, labelY);
		} else if (node.highlighted && !hovId) {
			// Search highlights: only when not hovering and not zoomed in
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

		// Semantic line (dashed)
		const row2Y = ly + rowH;
		ctx.globalAlpha = showSemanticEdges ? 0.7 : 0.25;
		ctx.beginPath();
		ctx.setLineDash([4, 4]);
		ctx.moveTo(lx, row2Y);
		ctx.lineTo(lx + 28, row2Y);
		ctx.strokeStyle = c.textFaint;
		ctx.lineWidth = 1.5;
		ctx.stroke();

		ctx.setLineDash([]);
		ctx.fillStyle = c.textMuted;
		ctx.fillText("Semantic", lx + 34, row2Y);

		if (!showSemanticEdges) {
			// Strikethrough
			const textW = ctx.measureText("Semantic").width;
			ctx.beginPath();
			ctx.moveTo(lx + 34, row2Y);
			ctx.lineTo(lx + 34 + textW, row2Y);
			ctx.strokeStyle = c.textMuted;
			ctx.lineWidth = 1;
			ctx.stroke();
		}

		edgeLegendHitAreas.push({ x: lx, y: row2Y - rowH / 2, w: 120, h: rowH, type: "semantic" });

		ctx.globalAlpha = 1;
		ctx.restore();
	}

	// ── Cluster legend (screen space, bottom-left above edge legend) ────
	{
		const dpr = window.devicePixelRatio || 1;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		// Collect unique clusters with their colors
		const clusterMap = new Map<number, string>();
		for (const node of simNodes) {
			if (node.cluster != null && node.color && !clusterMap.has(node.cluster)) {
				clusterMap.set(node.cluster, node.color);
			}
		}

		if (clusterMap.size > 0) {
			const swatchSize = 10;
			const rowH = 18;
			const padX = 10;
			const padY = 6;
			const entries = [...clusterMap.entries()].sort((a, b) => a[0] - b[0]);
			const legendH = entries.length * rowH + padY * 2;

			// Compute dynamic legend width based on label text
			ctx.font = `10px ${c.font}`;
			let maxTextW = 0;
			for (const [cluster] of entries) {
				const label = clusterLabels[cluster] ?? `Cluster ${cluster}`;
				const tw = ctx.measureText(label).width;
				if (tw > maxTextW) maxTextW = tw;
			}
			const legendW = Math.min(250, Math.max(108, padX + swatchSize + 6 + maxTextW + padX));

			// Position: bottom-left, above the edge legend (which sits at bottom - 40)
			const legendX = 12;
			const legendY = canvasEl.height / dpr - 50 - legendH;

			// Background
			ctx.globalAlpha = 0.85;
			ctx.fillStyle = c.bgPrimary;
			ctx.beginPath();
			ctx.roundRect(legendX, legendY, legendW, legendH, 6);
			ctx.fill();

			if (isLabeling) {
				// Animated gradient border while LLM is labeling
				const t = (performance.now() % 2000) / 2000; // 0..1 over 2 seconds
				const cx = legendX + legendW / 2;
				const cy = legendY + legendH / 2;
				const angle = t * Math.PI * 2;
				const grad = ctx.createConicGradient(angle, cx, cy);
				grad.addColorStop(0, c.accent);
				grad.addColorStop(0.25, c.textFaint);
				grad.addColorStop(0.5, c.accent);
				grad.addColorStop(0.75, c.textFaint);
				grad.addColorStop(1, c.accent);
				ctx.strokeStyle = grad;
				ctx.lineWidth = 2;
				ctx.globalAlpha = 1;
			} else {
				ctx.strokeStyle = c.textFaint;
				ctx.lineWidth = 0.5;
			}
			ctx.stroke();

			ctx.globalAlpha = 1;
			ctx.font = `10px ${c.font}`;
			ctx.textAlign = "left";
			ctx.textBaseline = "middle";

			// Reset hit areas
			clusterLegendHitAreas = [];

			for (let i = 0; i < entries.length; i++) {
				const [cluster, color] = entries[i];
				const rowY = legendY + padY + i * rowH + rowH / 2;
				const isFocused = focusedCluster === cluster;

				// Color swatch
				ctx.beginPath();
				ctx.roundRect(legendX + padX, rowY - swatchSize / 2, swatchSize, swatchSize, 2);
				ctx.fillStyle = color;
				ctx.globalAlpha = isFocused ? 1 : focusedCluster != null ? 0.3 : 0.8;
				ctx.fill();

				if (isFocused) {
					ctx.strokeStyle = c.textNormal;
					ctx.lineWidth = 1.5;
					ctx.stroke();
				}

				// Label — use LLM-generated label if available, else fallback
				const legendLabel = clusterLabels[cluster] ?? `Cluster ${cluster}`;
				ctx.globalAlpha = isFocused ? 1 : focusedCluster != null ? 0.4 : 0.7;
				ctx.fillStyle = c.textMuted;
				ctx.fillText(legendLabel, legendX + padX + swatchSize + 6, rowY, legendW - padX - swatchSize - 16);
				ctx.globalAlpha = 1;

				// Store hit area
				clusterLegendHitAreas.push({
					x: legendX,
					y: legendY + padY + i * rowH,
					w: legendW,
					h: rowH,
					cluster,
				});
			}
		} else {
			clusterLegendHitAreas = [];
		}

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

			const label =
				hoveredEdge.type === "wiki" ? `wiki · ${hoveredEdge.weight}` : `sim · ${hoveredEdge.weight.toFixed(3)}`;

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

		const lines: string[] = [
			hoveredNode.label,
			`${hoveredNode.cluster != null && clusterLabels[hoveredNode.cluster] ? clusterLabels[hoveredNode.cluster] : `Cluster ${hoveredNode.cluster ?? "?"}`}  ·  ${hoveredNode.degree ?? 0} connections`,
		];
		if (hoveredNode.discoverable) {
			lines.push("⚡ Semantic-only (no wiki links)");
		}
		if (pinnedNodes.has(hoveredNode.id)) {
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

	if (node) {
		// Start dragging a node
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
		let overLegend = false;
		for (const area of clusterLegendHitAreas) {
			if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
				overLegend = true;
				break;
			}
		}

		if (overLegend) {
			canvasEl.style.cursor = "pointer";
			if (hoveredNode || hoveredEdge) {
				hoveredNode = null;
				hoveredEdge = null;
				render();
			}
		} else {
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
					canvasEl.style.cursor = node ? "pointer" : lassoMode ? "crosshair" : "grab";
					render();
				} else if (!node) {
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
			if (area.type === "wiki") {
				onToggleWikiLinks?.();
			} else {
				onToggleSemanticEdges?.();
			}
			render();
			return;
		}
	}

	// Check cluster legend hit areas first (screen space)
	for (const area of clusterLegendHitAreas) {
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
	} else if (selectedNodes.size > 0) {
		// Click on empty space clears selection
		clearSelection();
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

function handleMouseLeave() {
	hoveredNode = null;
	hoveredEdge = null;
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
// Simulation setup
// ============================================================================

function setupSimulation(data: GraphData) {
	// Stop any existing simulation
	if (simulation) {
		simulation.stop();
		simulation = null;
	}

	if (data.nodes.length === 0) return;

	// Save old positions for pinned nodes and smooth transitions
	const oldPositions = new Map<string, { x: number; y: number }>();
	for (const n of simNodes) {
		if (n.x != null && n.y != null) {
			oldPositions.set(n.id, { x: n.x, y: n.y });
		}
	}

	// Create mutable copies for d3-force.
	// Always start from old positions when available so transitions are smooth.
	simNodes = data.nodes.map((n) => {
		const sn: SimNode = { ...n };
		const old = oldPositions.get(n.id);
		if (old) {
			sn.x = old.x;
			sn.y = old.y;
		}
		if (useForceLayout && pinnedNodes.has(n.id) && old) {
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
	semanticSimLinks = simLinks.filter((l) => l.type === "semantic");

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

	// When force layout is disabled, create a minimal simulation that pins
	// nodes at their projection coordinates. This keeps the render loop alive
	// for zoom/pan/drag interaction without applying any layout forces.
	if (!useForceLayout && !transitionTargets) {
		// If nodes had previous positions, animate to new projection coordinates
		const shouldAnimate = oldPositions.size > 0 && !isSmooth;

		if (shouldAnimate) {
			// Build target map from the original graph data positions
			const projTargets = new Map<string, { x: number; y: number }>();
			for (const n of data.nodes) {
				if (n.x != null && n.y != null) {
					projTargets.set(n.id, { x: n.x, y: n.y });
				}
			}
			const normalized = normalizeTargetsToView(simNodes, projTargets);

			simulation = forceSimulation<SimNode>(simNodes)
				.force("targetX", forceX<SimNode>((d) => normalized.get(d.id)?.x ?? d.x ?? 0).strength(0.08))
				.force("targetY", forceY<SimNode>((d) => normalized.get(d.id)?.y ?? d.y ?? 0).strength(0.08))
				.force(
					"collide",
					forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 2),
				)
				.on("tick", () => render())
				.on("end", () => {
					// Once settled, pin nodes at their final positions
					for (const sn of simNodes) {
						const t = normalized.get(sn.id);
						if (t) {
							sn.x = t.x;
							sn.y = t.y;
						}
						sn.fx = sn.x;
						sn.fy = sn.y;
					}
					fitToView();
					render();
				})
				.alphaDecay(0.02)
				.velocityDecay(0.35);

			needsInitialFit = false;
		} else {
			// First load or smooth swap: pin nodes at projection coordinates
			for (const sn of simNodes) {
				sn.fx = sn.x;
				sn.fy = sn.y;
			}

			simulation = forceSimulation<SimNode>(simNodes)
				.force(
					"collide",
					forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 2),
				)
				.on("tick", () => {
					if (needsInitialFit) {
						initialFitTickCount++;
						if (initialFitTickCount === 5 || (initialFitTickCount > 5 && initialFitTickCount % 15 === 0)) {
							fitToView();
						}
						if (simulation && simulation.alpha() < 0.1) {
							needsInitialFit = false;
							initialFitTickCount = 0;
							fitToView();
						}
					}
					render();
				})
				.alphaDecay(0.05)
				.velocityDecay(0.4);

			if (!isSmooth) {
				needsInitialFit = true;
				initialFitTickCount = 0;
			} else {
				simulation.alpha(0.05);
				needsInitialFit = false;
			}
		}

		return;
	}

	// Transition mode: handled by a separate $effect that injects
	// forceX/forceY into the existing simulation (see below).
	// setupSimulation only creates the normal force-directed layout.

	// Compute per-cluster centroids in 2D for cluster cohesion force

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
			// Continuously fit-to-view during initial settling so the graph
			// tracks the shrinking bounding box as nodes converge.
			if (needsInitialFit) {
				initialFitTickCount++;
				// Start fitting at tick 5, then re-fit every 15 ticks until
				// alpha drops below 0.1 (simulation nearly settled).
				if (initialFitTickCount === 5 || (initialFitTickCount > 5 && initialFitTickCount % 15 === 0)) {
					fitToView();
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

	// If nodes already had positions, start with low alpha for gentle transition
	if (oldPositions.size > 0) {
		simulation.alpha(isSmooth ? 0.05 : 0.3);
		needsInitialFit = false;
	}
}

// React to graphData or useForceLayout changes
$effect(() => {
	// Access reactive dependencies
	const data = graphData;
	const _forceLayout = useForceLayout;
	setupSimulation(data);

	return () => {
		if (simulation) {
			simulation.stop();
			simulation = null;
		}
	};
});

/**
 * Rescale target positions so they occupy the same bounding region as the
 * current node positions. This prevents jarring jumps when coordinate
 * spaces differ (e.g. UMAP output range vs d3-force layout range).
 */
function normalizeTargetsToView(
	nodes: SimNode[],
	targets: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
	let cMinX = Infinity;
	let cMaxX = -Infinity;
	let cMinY = Infinity;
	let cMaxY = -Infinity;
	for (const node of nodes) {
		if (node.x != null && node.y != null) {
			if (node.x < cMinX) cMinX = node.x;
			if (node.x > cMaxX) cMaxX = node.x;
			if (node.y < cMinY) cMinY = node.y;
			if (node.y > cMaxY) cMaxY = node.y;
		}
	}

	let tMinX = Infinity;
	let tMaxX = -Infinity;
	let tMinY = Infinity;
	let tMaxY = -Infinity;
	for (const { x, y } of targets.values()) {
		if (x < tMinX) tMinX = x;
		if (x > tMaxX) tMaxX = x;
		if (y < tMinY) tMinY = y;
		if (y > tMaxY) tMaxY = y;
	}

	const cCx = (cMinX + cMaxX) / 2;
	const cCy = (cMinY + cMaxY) / 2;
	const cSpan = Math.max(cMaxX - cMinX, cMaxY - cMinY) || 1;

	const tCx = (tMinX + tMaxX) / 2;
	const tCy = (tMinY + tMaxY) / 2;
	const tSpan = Math.max(tMaxX - tMinX, tMaxY - tMinY) || 1;

	const scale = cSpan / tSpan;

	const normalized = new Map<string, { x: number; y: number }>();
	for (const [id, { x, y }] of targets) {
		normalized.set(id, {
			x: (x - tCx) * scale + cCx,
			y: (y - tCy) * scale + cCy,
		});
	}
	return normalized;
}

// Animate nodes from current positions to transition targets by injecting
// forceX/forceY into the *existing* d3 simulation (no data swap needed).
$effect(() => {
	const targets = transitionTargets;
	if (!targets || targets.size === 0) return;

	// Rescale targets into the current graph coordinate space
	const normalized = normalizeTargetsToView(simNodes, targets);

	// Strip wiki-layout forces; keep only position-targeting + collision
	simulation!.force("link", null);
	simulation!.force("charge", null);
	simulation!.force("center", null);
	simulation!.force("gravityX", null);
	simulation!.force("gravityY", null);
	simulation!.force("cluster", null);

	simulation!.force("targetX", forceX<SimNode>((d) => normalized.get(d.id)?.x ?? d.x ?? 0).strength(0.08));
	simulation!.force("targetY", forceY<SimNode>((d) => normalized.get(d.id)?.y ?? d.y ?? 0).strength(0.08));

	// Unpin all nodes so the transition forces can move them
	for (const sn of simNodes) {
		sn.fx = null;
		sn.fy = null;
	}

	needsInitialFit = false;
	let transitionTickCount = 0;
	simulation!.alphaDecay(0.02).velocityDecay(0.35).alpha(1).restart();

	// Replace the existing tick handler with one that progressively fits
	simulation!.on("tick", () => {
		transitionTickCount++;
		// Progressively fit to view as nodes converge
		if (transitionTickCount === 5 || (transitionTickCount > 5 && transitionTickCount % 15 === 0)) {
			fitToView();
		}
		render();
	});

	simulation!.on("end", () => {
		for (const node of simNodes) {
			const t = normalized.get(node.id);
			if (t) {
				node.x = t.x;
				node.y = t.y;
			}
		}
		render();
		onTransitionEnd?.();
	});
});

// Hot-update force parameters without full rebuild
$effect(() => {
	if (!simulation) return;
	const _charge = chargeStrength;
	const _link = linkDistance;
	const _nodeSize = nodeSize;

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

	// Keyboard handler for Escape to clear selection / exit lasso mode
	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			if (isLassoing) {
				isLassoing = false;
				lassoPoints = [];
				render();
			} else if (selectedNodes.size > 0) {
				clearSelection();
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
		if (animFrameId != null) cancelAnimationFrame(animFrameId);
		if (hoverAnimFrameId != null) cancelAnimationFrame(hoverAnimFrameId);
		if (simulation) {
			simulation.stop();
			simulation = null;
		}
	};
});

// Animation frame ID for animated transitions
let animFrameId: number | null = null;

/**
 * Fit the graph to the viewport with smooth animation.
 */
export function fitToView() {
	if (!canvasEl || simNodes.length === 0) return;
	const rect = canvasEl.getBoundingClientRect();

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const node of simNodes) {
		if (node.x != null && node.y != null) {
			minX = Math.min(minX, node.x);
			minY = Math.min(minY, node.y);
			maxX = Math.max(maxX, node.x);
			maxY = Math.max(maxY, node.y);
		}
	}

	const graphWidth = maxX - minX || 1;
	const graphHeight = maxY - minY || 1;
	const padding = 20;

	const scaleX = (rect.width - padding * 2) / graphWidth;
	const scaleY = (rect.height - padding * 2) / graphHeight;
	const targetScale = Math.min(scaleX, scaleY, 4);

	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;

	const targetX = rect.width / 2 - centerX * targetScale;
	const targetY = rect.height / 2 - centerY * targetScale;

	// Animate from current transform to target
	const startTransform = { ...transform };
	const duration = 300; // ms
	const startTime = performance.now();

	if (animFrameId != null) cancelAnimationFrame(animFrameId);

	function step(now: number) {
		const elapsed = now - startTime;
		const t = Math.min(elapsed / duration, 1);
		// Ease-out cubic
		const ease = 1 - (1 - t) ** 3;

		transform = {
			x: startTransform.x + (targetX - startTransform.x) * ease,
			y: startTransform.y + (targetY - startTransform.y) * ease,
			scale: startTransform.scale + (targetScale - startTransform.scale) * ease,
		};
		render();

		if (t < 1) {
			animFrameId = requestAnimationFrame(step);
		} else {
			animFrameId = null;
		}
	}

	animFrameId = requestAnimationFrame(step);
}

/**
 * Return the current simulation positions of all nodes.
 */
export function getNodePositions(): Map<string, { x: number; y: number }> {
	const positions = new Map<string, { x: number; y: number }>();
	for (const node of simNodes) {
		if (node.x != null && node.y != null) {
			positions.set(node.id, { x: node.x, y: node.y });
		}
	}
	return positions;
}

/**
 * Tell the canvas that the next graphData change is a cosmetic swap
 * (e.g. adding edges/colors after a transition) — skip fitToView and
 * edge-fade so the graph stays visually stable.
 */
export function prepareDataSwap() {
	skipNextSetupEffects = true;
}

/**
 * Update node colors and cluster assignments in-place on the running
 * simulation nodes. Triggers a re-render without rebuilding the simulation.
 */
export function updateNodeAppearance(updates: Map<string, { color?: string; cluster?: number }>) {
	for (const node of simNodes) {
		const u = updates.get(node.id);
		if (u) {
			if (u.color !== undefined) node.color = u.color;
			if (u.cluster !== undefined) node.cluster = u.cluster;
		}
	}
	render();
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
</style>
