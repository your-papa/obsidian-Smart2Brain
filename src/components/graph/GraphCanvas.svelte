<script lang="ts">
import { onMount } from "svelte";
import { Menu } from "obsidian";
import {
	forceSimulation,
	forceLink,
	forceManyBody,
	forceCollide,
	forceX,
	forceY,
	type SimulationNodeDatum,
	type SimulationLinkDatum,
} from "d3-force";
import type { GraphData, GraphNode, GraphEdge, EdgeType, LayoutMode } from "../../types/graph";
import { deriveClusterRepresentativesFromGraph } from "../../views/smart-graph/graphDataBuilder";
import { edgeKey } from "../../utils/graphUtils";
import { computeNodeBounds, framingTransform, easeOutCubic } from "../../utils/graphAnimation";
import { PixiRenderer, readThemeColors, type ClusterPillHit, type EdgeLegendHit } from "./pixiRenderer";

interface Props {
	graphData: GraphData;
	/** Layout mode — force uses d3-force, semantic uses projected positions. */
	mode: LayoutMode;
	linkDistance: number;
	chargeStrength?: number;
	centerStrength?: number;
	linkStrength?: number;
	labelZoomThreshold?: number;
	nodeSize?: number;
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
	chargeStrength = -1000,
	centerStrength = 0.1,
	linkStrength = 1,
	labelZoomThreshold = 2.5,
	nodeSize: nodeSizeProp = 4,
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

let containerEl: HTMLDivElement;

// Invisible anchor element repositioned over hovered nodes for Obsidian's hover popover
let hoverAnchorEl: HTMLDivElement;

// Pixi renderer instance
let pixi: PixiRenderer | null = null;

// Node size: use the user setting, scaled down for very large graphs
let nodeSize = $derived.by(() => {
	const n = graphData.nodes.length;
	const base = nodeSizeProp;
	// Gently shrink for large graphs so nodes don't overlap
	if (n > 500) return Math.max(1, base * 0.5);
	if (n > 200) return Math.max(1, base * 0.75);
	return base;
});

// Interaction state
let hoveredNode: GraphNode | null = $state(null);
let draggedNode: GraphNode | null = $state(null);
let hasDragged = false;

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
// Tick counter for periodic camera refits during force-mode settling
let forceTickCount = 0;

// Simulation reference
let simulation: ReturnType<typeof forceSimulation<SimNode>> | null = null;
// D3's default link strength function, captured at simulation init so the
// hot-update effect can reuse it (it depends on the link topology).
let cachedDefaultLinkStrengthFn: ((link: SimLink, i: number, links: SimLink[]) => number) | null = null;

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

// Cluster legend hit areas for click detection (screen space)
let clusterAnchorHitAreas: ClusterPillHit[] = [];

// Edge legend hit areas for click detection (screen space)
let edgeLegendHitAreas: EdgeLegendHit[] = [];

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

// Track previous mode + graphData reference to detect mode-only changes
// (mode changed but data hasn't been re-projected yet).
let lastMode: LayoutMode | null = null;
let lastGraphDataRef: GraphData | null = null;

// Node ID → SimNode map for O(1) lookups (built once in setupSimulation)
let simNodeMap: Map<string, SimNode> = new Map();
let clusterRepresentativeIds: Set<string> = new Set();
let clusterRepresentativeNodes: Map<number, SimNode> = new Map();
let clusterNodeCounts: Map<number, number> = new Map();

// Build a cluster map for edge rendering (nodeId → cluster)
function getNodeClusterMap(): Map<string, number | undefined> {
	const map = new Map<string, number | undefined>();
	for (const n of simNodes) {
		map.set(n.id, n.cluster);
	}
	return map;
}

const REPRESENTATIVE_LABEL_NODE_THRESHOLD = 120;
const REPRESENTATIVE_LABEL_ZOOM_RATIO = 0.6;
const FULL_LABEL_DENSE_GRAPH_MULTIPLIER = 1.8;
const CLUSTER_ANCHOR_ZOOM_RATIO = 0.85;

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
 * Convert screen coordinates to graph (world) coordinates via the viewport.
 */
function screenToGraph(screenX: number, screenY: number): { x: number; y: number } {
	if (!pixi) return { x: screenX, y: screenY };
	return pixi.screenToWorld(screenX, screenY);
}

/**
 * Find the node at the given screen coordinates.
 */
function findNodeAt(screenX: number, screenY: number): GraphNode | null {
	const { x, y } = screenToGraph(screenX, screenY);
	const scale = pixi?.scale ?? 1;
	const hitRadius = (Math.max(1, nodeSize) + 4) / scale;

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
 */
function getNodeRadius(node: GraphNode): number {
	const base = Math.max(1, nodeSize);
	const degree = node.degree ?? 0;
	return base + Math.min(Math.log1p(degree) * 2.5, base * 5);
}

/**
 * Update the Pixi renderer with current state.
 * Replaces the old Canvas 2D render() function.
 */
function render() {
	if (!pixi || !pixi.ready) return;

	const width = pixi.width;
	const height = pixi.height;
	const scale = pixi.scale;
	const c = pixi.theme;
	const nodeClusterMap = getNodeClusterMap();

	// Advance edge fade-in (smooth crossfade on mode / data changes)
	if (edgeFadeAlpha < 1) {
		edgeFadeAlpha = Math.min(1, edgeFadeAlpha + EDGE_FADE_RATE);
	}

	// ── Smooth hover alpha interpolation ──────────────────────
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

	// ── Edges ──────────────────────────────────────────────────
	pixi.drawEdges(
		wikiSimLinks as Array<{
			source: { id: string; x: number; y: number };
			target: { id: string; x: number; y: number };
			type: string;
		}>,
		{
			showWikiLinks,
			hoveredNodeId: hoveredNode?.id ?? null,
			adjacency,
			focusedClusters,
			selectedNodes,
			hoverAlphas,
			edgeFadeAlpha,
			nodeClusterMap,
		},
	);

	// ── Nodes ──────────────────────────────────────────────────
	pixi.syncNodes(simNodes, nodeSize, {
		selectedNodes,
		hoveredNodeId: hoveredNode?.id ?? null,
		draggedNodeId: draggedNode?.id ?? null,
		focusedClusters,
		pinnedNodes,
		isForceMode,
		hoverAlphas,
		nodeClusterMap,
	});

	// ── Labels ─────────────────────────────────────────────────
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
		denseGraph && labelZoomThreshold > 0 && scale >= representativeLabelThreshold && scale < allLabelsThreshold;
	const showAllLabels = labelZoomThreshold > 0 && scale >= allLabelsThreshold;
	const showClusterAnchors = clusterRepresentativeNodes.size > 0;
	const zoomLabelOpacity = showAllLabels
		? Math.min(1, (scale - allLabelsThreshold) / Math.max(0.25, allLabelsThreshold))
		: 0;
	const hovId = hoveredNode?.id ?? null;
	const hoverNeighbors = hovId ? adjacency.get(hovId) : undefined;

	const fontSize = Math.max(4.5 / scale, 2.8);

	// Label occlusion culling in screen space
	const drawnLabelRects: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
	const LABEL_PAD_X = 2;
	const LABEL_PAD_Y = 1;

	function canDrawLabel(nodeX: number, labelY: number, approxCharCount: number): boolean {
		// Approximate text width: ~6px per char at 12px font, scaled
		const textW = approxCharCount * 6 * (fontSize / 12);
		const screen = pixi!.worldToScreen(nodeX, labelY);
		const sw = textW * scale;
		const sh = fontSize * scale;
		const x1 = screen.x - sw / 2 - LABEL_PAD_X;
		const y1 = screen.y - sh - LABEL_PAD_Y;
		const x2 = screen.x + sw / 2 + LABEL_PAD_X;
		const y2 = screen.y + LABEL_PAD_Y;

		for (const r of drawnLabelRects) {
			if (x1 < r.x2 && x2 > r.x1 && y1 < r.y2 && y2 > r.y1) return false;
		}
		drawnLabelRects.push({ x1, y1, x2, y2 });
		return true;
	}

	// Sort nodes by label priority
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

	const labelEntries: Array<{
		nodeX: number;
		nodeY: number;
		text: string;
		color: string;
		alpha: number;
		fontSize: number;
	}> = [];

	for (const node of sortedLabelNodes) {
		const radius = getNodeRadius(node);
		const labelY = node.y - radius - 2 / scale;
		const nodeAlpha = hoverAlphas.get(node.id) ?? 0.85;

		if (hovId && node.id === hovId) {
			canDrawLabel(node.x, labelY, node.label.length);
			labelEntries.push({
				nodeX: node.x,
				nodeY: labelY,
				text: node.label,
				color: c.textNormal,
				alpha: 1,
				fontSize,
			});
		} else if (hovId && hoverNeighbors?.has(node.id)) {
			if (!canDrawLabel(node.x, labelY, node.label.length)) continue;
			labelEntries.push({
				nodeX: node.x,
				nodeY: labelY,
				text: node.label,
				color: c.textMuted,
				alpha: nodeAlpha,
				fontSize,
			});
		} else if (showAllLabels) {
			if (!canDrawLabel(node.x, labelY, node.label.length)) continue;
			labelEntries.push({
				nodeX: node.x,
				nodeY: labelY,
				text: node.label,
				color: node.highlighted ? c.textAccent : c.textNormal,
				alpha: nodeAlpha * zoomLabelOpacity,
				fontSize,
			});
		} else if (showRepresentativeLabels && clusterRepresentativeIds.has(node.id)) {
			// Dense graphs: representative nodes labeled by cluster anchor pills
		} else if (node.highlighted && !hovId) {
			if (!canDrawLabel(node.x, labelY, node.label.length)) continue;
			labelEntries.push({
				nodeX: node.x,
				nodeY: labelY,
				text: node.label,
				color: c.textAccent,
				alpha: 1,
				fontSize,
			});
		}
	}

	pixi.drawLabels(labelEntries);

	// ── Lasso ──────────────────────────────────────────────────
	if (isLassoing && lassoPoints.length >= 2) {
		pixi.drawLasso(lassoPoints);
	} else {
		pixi.clearLasso();
	}

	// ── Cluster anchor pills (screen space) ────────────────────
	if (showClusterAnchors) {
		const ANCHOR_PILL_H = 20;
		const ANCHOR_GAP = 4;

		const anchorPlacements: Array<{
			cluster: number;
			nodeScreenX: number;
			nodeScreenY: number;
			text: string;
			pillW: number;
			pillH: number;
			x: number;
			y: number;
			isFocused: boolean;
			color: string;
		}> = [];

		for (const [cluster, node] of clusterRepresentativeNodes) {
			if (node.x == null || node.y == null) continue;
			if (focusedClusters.size > 0 && !focusedClusters.has(cluster)) continue;

			const screen = pixi.worldToScreen(node.x, node.y);
			const anchorLabel = clusterLabels[cluster] ?? node.label;
			const nodeCount = clusterNodeCounts.get(cluster) ?? 0;
			const anchorText = `${anchorLabel} · ${nodeCount}`;
			// Approximate pill width: ~7px per char + padding
			const pillWidth = Math.min(200, Math.max(80, anchorText.length * 7 + 16));
			const pillX = Math.max(8, Math.min(width - pillWidth - 8, screen.x + 8));
			const pillY = Math.max(8, Math.min(height - ANCHOR_PILL_H - 8, screen.y - ANCHOR_PILL_H - 6));

			anchorPlacements.push({
				cluster,
				nodeScreenX: screen.x,
				nodeScreenY: screen.y,
				text: anchorText,
				pillW: pillWidth,
				pillH: ANCHOR_PILL_H,
				x: pillX,
				y: pillY,
				isFocused: focusedClusters.has(cluster),
				color: node.color ?? c.graphNode,
			});
		}

		// Greedy overlap resolution
		anchorPlacements.sort((a, b) => a.y - b.y);
		for (let pass = 0; pass < 3; pass++) {
			for (let i = 0; i < anchorPlacements.length; i++) {
				const a = anchorPlacements[i];
				for (let j = i + 1; j < anchorPlacements.length; j++) {
					const b = anchorPlacements[j];
					const overlapX = a.x < b.x + b.pillW + ANCHOR_GAP && a.x + a.pillW + ANCHOR_GAP > b.x;
					const overlapY = a.y < b.y + b.pillH + ANCHOR_GAP && a.y + a.pillH + ANCHOR_GAP > b.y;
					if (overlapX && overlapY) {
						const overlapDepthY =
							Math.min(a.y + a.pillH + ANCHOR_GAP, b.y + b.pillH + ANCHOR_GAP) - Math.max(a.y, b.y);
						const overlapDepthX =
							Math.min(a.x + a.pillW + ANCHOR_GAP, b.x + b.pillW + ANCHOR_GAP) - Math.max(a.x, b.x);
						if (overlapDepthY <= overlapDepthX) {
							const pushY = overlapDepthY / 2 + 1;
							a.y = Math.max(8, a.y - pushY);
							b.y = Math.min(height - b.pillH - 8, b.y + pushY);
						} else {
							const pushX = overlapDepthX / 2 + 1;
							a.x = Math.max(8, a.x - pushX);
							b.x = Math.min(width - b.pillW - 8, b.x + pushX);
						}
					}
				}
			}
		}

		clusterAnchorHitAreas = pixi.drawClusterPills(anchorPlacements);
	} else {
		clusterAnchorHitAreas = pixi.drawClusterPills([]);
	}

	// ── Edge legend (screen space) ─────────────────────────────
	edgeLegendHitAreas = [pixi.drawEdgeLegend(showWikiLinks)];

	// ── Node tooltip ───────────────────────────────────────────
	if (hoveredNode && hoveredNode.x != null && hoveredNode.y != null) {
		pixi.showNodeTooltip(hoveredNode, clusterLabels, pinnedNodes.has(hoveredNode.id), isForceMode);
	} else {
		pixi.hideTooltip();
	}
}

// ============================================================================
// Event handlers
// ============================================================================

function handleMouseDown(e: PointerEvent) {
	e.preventDefault();
	containerEl.focus();
	if (!pixi) return;
	const canvas = pixi.canvas;
	const rect = canvas.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	// Shift+click on a node toggles its selection; Shift+drag on empty space starts lasso
	if (lassoMode || e.shiftKey) {
		const node = findNodeAt(x, y);
		if (node && e.shiftKey && !lassoMode) {
			const next = new Set(selectedNodes);
			if (next.has(node.id)) {
				next.delete(node.id);
			} else {
				next.add(node.id);
			}
			selectedNodes = next;
			onSelectionChange?.(simNodes.filter((n) => next.has(n.id)).map((n) => n.path));
			lassoJustFinished = true;
			render();
			return;
		}
		isLassoing = true;
		// Pause pixi-viewport drag during lasso
		pixi.pauseViewport();
		const graphPos = screenToGraph(x, y);
		lassoPoints = [graphPos];
		canvas.setPointerCapture(e.pointerId);
		return;
	}

	const node = findNodeAt(x, y);

	if (node && isForceMode) {
		const sn = simNodeMap.get(node.id);
		if (!sn) return;
		draggedNode = node;
		dragSimNode = sn;
		hasDragged = false;
		// Pause pixi-viewport drag during node drag
		pixi.pauseViewport();
		simulation?.alphaTarget(0.3).restart();
		sn.fx = sn.x;
		sn.fy = sn.y;
		canvas.setPointerCapture(e.pointerId);
	}
	// Pan is handled by pixi-viewport automatically
}

function handleMouseMove(e: PointerEvent) {
	if (!pixi) return;
	const canvas = pixi.canvas;
	const rect = canvas.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	if (isLassoing) {
		const graphPos = screenToGraph(x, y);
		// Throttle: only add point if moved at least 3px in screen space from last point
		const last = lassoPoints[lassoPoints.length - 1];
		if (last) {
			const lastScreen = pixi.worldToScreen(last.x, last.y);
			const dist = Math.sqrt((x - lastScreen.x) ** 2 + (y - lastScreen.y) ** 2);
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
		const graphPos = screenToGraph(x, y);
		dragSimNode.fx = graphPos.x;
		dragSimNode.fy = graphPos.y;
		render();
	} else {
		// Hover detection: check cluster legend first, then nodes
		let overClusterAnchor = false;
		for (const area of clusterAnchorHitAreas) {
			if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
				overClusterAnchor = true;
				break;
			}
		}

		if (overClusterAnchor) {
			canvas.style.cursor = "pointer";
			if (hoveredNode) {
				hoveredNode = null;
				render();
			}
			return;
		}

		// Check edge legend hit areas
		let overEdgeLegend = false;
		for (const area of edgeLegendHitAreas) {
			if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
				overEdgeLegend = true;
				break;
			}
		}

		if (overEdgeLegend) {
			canvas.style.cursor = "pointer";
			if (hoveredNode) {
				hoveredNode = null;
				render();
			}
		} else {
			const node = findNodeAt(x, y);
			if (node !== hoveredNode) {
				hoveredNode = node;
				previewTriggeredForNode = null;
				canvas.style.cursor = node ? "pointer" : lassoMode ? "crosshair" : "grab";
				render();
			}
			// Cmd/Ctrl+hover triggers note preview (fire once per node)
			if (node && (e.metaKey || e.ctrlKey) && onHoverPreview && previewTriggeredForNode !== node.id) {
				triggerNodePreview(e, node);
			}
		}
	}
}

function handleMouseUp(_e: PointerEvent) {
	if (isLassoing) {
		isLassoing = false;
		lassoJustFinished = true;
		pixi?.resumeViewport();
		if (lassoPoints.length >= 3) {
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
		pixi?.resumeViewport();
	}
}

function handleClick(e: MouseEvent) {
	if (hasDragged) {
		hasDragged = false;
		return;
	}
	if (lassoJustFinished) {
		lassoJustFinished = false;
		return;
	}
	if (!pixi) return;

	const rect = pixi.canvas.getBoundingClientRect();
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

// Wheel is handled by pixi-viewport — no manual handleWheel needed.
// We just need a render on viewport move to update overlays.

/**
 * Fire the hover-link preview for a node exactly once.
 * Positions the invisible anchor at the node's screen location.
 */
function triggerNodePreview(event: MouseEvent | KeyboardEvent, node: GraphNode) {
	if (!pixi) return;
	const screen = pixi.worldToScreen(node.x ?? 0, node.y ?? 0);
	hoverAnchorEl.style.left = `${screen.x}px`;
	hoverAnchorEl.style.top = `${screen.y}px`;
	previewTriggeredForNode = node.id;
	onHoverPreview?.(event as MouseEvent, node.path, hoverAnchorEl);
}

function handleMouseLeave() {
	hoveredNode = null;
	previewTriggeredForNode = null;
	render();
}

function handleContextMenu(e: MouseEvent) {
	e.preventDefault();
	if (!pixi) return;
	const rect = pixi.canvas.getBoundingClientRect();
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
		const projTargets = new Map<string, { x: number; y: number }>();
		for (const n of data.nodes) {
			if (n.x != null && n.y != null) {
				projTargets.set(n.id, { x: n.x, y: n.y });
			}
		}

		const TRANSITION_DURATION = 1800; // ms — long enough to feel balanced with the force settling
		const startTime = performance.now();
		// Snapshot start positions (in the old coordinate space)
		const startPositions = new Map<string, { x: number; y: number }>();
		for (const sn of simNodes) {
			startPositions.set(sn.id, { x: sn.x ?? 0, y: sn.y ?? 0 });
		}

		needsInitialFit = false;

		// Kick off a single smooth camera animation to the target bounding box.
		// This replaces per-frame moveCenter snaps with one fluid motion.
		if (pixi) {
			// Compute target bounds from the final projected positions
			const targetNodes = simNodes.map((sn) => {
				const t = projTargets.get(sn.id);
				return t ? { ...sn, x: t.x, y: t.y } : sn;
			});
			const targetBounds = computeNodeBounds(targetNodes);
			if (targetBounds) {
				const frame = framingTransform(targetBounds, { width: pixi.width, height: pixi.height }, 20);
				const cx = (targetBounds.minX + targetBounds.maxX) / 2;
				const cy = (targetBounds.minY + targetBounds.maxY) / 2;
				pixi.animateToFrame(cx, cy, frame.scale, TRANSITION_DURATION);
			}
		}

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

			render();

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

		if (!isSmooth && pixi) {
			// Snap the camera to frame all nodes, then render.
			const bounds = computeNodeBounds(simNodes);
			if (bounds) {
				const frame = framingTransform(bounds, { width: pixi.width, height: pixi.height }, 20);
				const cx = (bounds.minX + bounds.maxX) / 2;
				const cy = (bounds.minY + bounds.maxY) / 2;
				pixi.snapToFrame(cx, cy, frame.scale);
			}
		}
		render();
	}
}

// ============================================================================
// Wiki mode: d3-force simulation setup
// ============================================================================

function setupForceSimulation(data: GraphData, oldPositions: Map<string, { x: number; y: number }>, isSmooth: boolean) {
	// Save the default d3 link strength function so we can apply linkStrength as
	// a multiplier, matching how Obsidian's native graph works.
	const baseLinkForce = forceLink<SimNode, SimLink>(simLinks)
		.id((d) => d.id)
		.distance(linkDistance);
	const defaultLinkStrengthFn = baseLinkForce.strength() as (link: SimLink, i: number, links: SimLink[]) => number;
	cachedDefaultLinkStrengthFn = defaultLinkStrengthFn;
	baseLinkForce.strength((l, i, links) => linkStrength * defaultLinkStrengthFn(l, i, links));

	simulation = forceSimulation<SimNode>(simNodes)
		.force("link", baseLinkForce)
		.force("charge", forceManyBody().strength(chargeStrength).distanceMin(30))
		// Obsidian uses forceX + forceY for centering (spring toward origin),
		// NOT forceCenter (which shifts the centroid). This is the key difference.
		.force("centerX", forceX<SimNode>(0).strength(centerStrength))
		.force("centerY", forceY<SimNode>(0).strength(centerStrength))
		.force("cluster", clusterCohesionForce(simNodes, 0.15))
		.force(
			"collide",
			forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 2),
		)
		.on("tick", () => {
			// During initial settling, continuously refit the camera so it
			// tracks the expanding layout smoothly instead of staying zoomed-in.
			if (needsInitialFit && pixi) {
				forceTickCount++;
				// Refit every 3 ticks (~50ms) with a short animation that
				// overlaps the next refit, producing fluid camera motion.
				if (forceTickCount % 3 === 0) {
					const bounds = computeNodeBounds(simNodes);
					if (bounds) {
						const frame = framingTransform(bounds, { width: pixi.width, height: pixi.height }, 20);
						const cx = (bounds.minX + bounds.maxX) / 2;
						const cy = (bounds.minY + bounds.maxY) / 2;
						pixi.animateToFrame(cx, cy, frame.scale, 150);
					}
				}
				// Once settled, do one final smooth fit and stop tracking.
				if (simulation && simulation.alpha() < 0.05) {
					needsInitialFit = false;
					forceTickCount = 0;
					animateCameraToNodes(undefined, 20, 500);
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
			forceTickCount = 0;
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

	// Detect mode-only changes: if the mode changed but graphData is the
	// same reference, the parent hasn't rebuilt the data yet (e.g. waiting
	// for an async UMAP projection). Freeze the current view and wait.
	const modeChanged = lastMode !== null && lastMode !== mode;
	const dataChanged = lastGraphDataRef !== data;
	lastMode = mode;
	lastGraphDataRef = data;

	if (modeChanged && !dataChanged) {
		// Mode switched but data is stale — just render the frozen state
		render();
		return;
	}

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

// Re-render when appearance settings change (nodeSize, labelZoomThreshold, showWikiLinks)
$effect(() => {
	// Track reactive appearance props so the effect re-fires
	const _nodeSize = nodeSize;
	const _labelZoom = labelZoomThreshold;
	const _showWiki = showWikiLinks;
	if (pixi) render();
});

// Hot-update force parameters without full rebuild (wiki mode only)
$effect(() => {
	if (!simulation || !isForceMode) return;
	const _charge = chargeStrength;
	const _link = linkDistance;
	const _center = centerStrength;
	const _linkStr = linkStrength;

	const charge = simulation.force("charge") as ReturnType<typeof forceManyBody> | undefined;
	if (charge) charge.strength(_charge);

	// Center force uses forceX + forceY (spring toward origin), matching Obsidian
	const cx = simulation.force("centerX") as ReturnType<typeof forceX> | undefined;
	if (cx) cx.strength(_center);
	const cy = simulation.force("centerY") as ReturnType<typeof forceY> | undefined;
	if (cy) cy.strength(_center);

	const link = simulation.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | undefined;
	if (link) {
		link.distance(_link);
		if (cachedDefaultLinkStrengthFn) {
			const baseFn = cachedDefaultLinkStrengthFn;
			link.strength((l: SimLink, i: number, links: SimLink[]) => _linkStr * baseFn(l, i, links));
		}
	}

	const collide = simulation.force("collide") as ReturnType<typeof forceCollide<SimNode>> | undefined;
	if (collide) collide.radius((d: SimNode) => getNodeRadius(d) + 2);

	simulation.alpha(0.5).restart();
});

onMount(() => {
	// Initialize Pixi renderer
	const theme = readThemeColors(containerEl);
	const renderer = new PixiRenderer();
	pixi = renderer;

	renderer.init(containerEl, theme).then(() => {
		// Re-render overlays (cluster pills, legends, labels) when viewport moves
		renderer.onViewportMoved(() => render());

		// Setup keyboard shortcuts
		function handleKeyDown(e: KeyboardEvent) {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

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
						pixi?.resumeViewport();
						render();
					} else if (selectedNodes.size > 0) {
						clearSelection();
					} else if (focusedClusters.size > 0) {
						onClearFocusedClusters?.();
					}
					break;
				case "f":
					if (selectedNodes.size > 0) {
						panToSelection();
					} else {
						fitToView();
					}
					break;
				case "=":
				case "+": {
					// Zoom in — pixi-viewport handles it via its wheel plugin,
					// but we provide keyboard zoom too
					const currentScale = renderer.scale;
					const newScale = Math.min(10, currentScale * 1.2);
					renderer.moveCenter(
						renderer.screenToWorld(renderer.width / 2, renderer.height / 2).x,
						renderer.screenToWorld(renderer.width / 2, renderer.height / 2).y,
						newScale,
					);
					render();
					break;
				}
				case "-": {
					const currentScale = renderer.scale;
					const newScale = Math.max(0.05, currentScale / 1.2);
					renderer.moveCenter(
						renderer.screenToWorld(renderer.width / 2, renderer.height / 2).x,
						renderer.screenToWorld(renderer.width / 2, renderer.height / 2).y,
						newScale,
					);
					render();
					break;
				}
			}
		}
		containerEl.addEventListener("keydown", handleKeyDown);
		if (!containerEl.hasAttribute("tabindex")) {
			containerEl.setAttribute("tabindex", "0");
		}

		const resizeObserver = new ResizeObserver(() => {
			const rect = containerEl.getBoundingClientRect();
			renderer.resize(rect.width, rect.height);
			render();
		});
		resizeObserver.observe(containerEl);

		// Listen for Obsidian theme changes
		const handleCssChange = () => {
			const newTheme = readThemeColors(containerEl);
			renderer.updateTheme(newTheme);
			render();
		};
		document.body.addEventListener("css-change", handleCssChange);

		// Store cleanup references
		(containerEl as any).__graphCleanup = () => {
			containerEl.removeEventListener("keydown", handleKeyDown);
			resizeObserver.disconnect();
			document.body.removeEventListener("css-change", handleCssChange);
		};
	});

	return () => {
		(containerEl as any).__graphCleanup?.();
		if (hoverAnimFrameId != null) cancelAnimationFrame(hoverAnimFrameId);
		if (simulation) {
			simulation.stop();
			simulation = null;
		}
		stopSmartRaf();
		renderer.destroy();
		pixi = null;
	};
});

/** Animate the camera to frame the given nodes with the specified padding and duration. */
function animateCameraToNodes(filter?: (node: SimNode) => boolean, padding = 40, duration = 400) {
	if (!pixi) return;
	const bounds = computeNodeBounds(simNodes, filter);
	if (!bounds) return;
	const target = framingTransform(bounds, { width: pixi.width, height: pixi.height }, padding);
	const centerX = (bounds.minX + bounds.maxX) / 2;
	const centerY = (bounds.minY + bounds.maxY) / 2;
	pixi.animateToFrame(centerX, centerY, target.scale, duration);
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

<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
<div
  class="graph-canvas-container"
  bind:this={containerEl}
  onpointerdown={handleMouseDown}
  onpointermove={handleMouseMove}
  onpointerup={handleMouseUp}
  onclick={handleClick}
  onmouseleave={handleMouseLeave}
  oncontextmenu={handleContextMenu}
>
  <!-- Pixi.js creates its own <canvas> inside this container via pixi.init() -->
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
    cursor: grab;
    touch-action: none; /* Required for pointer capture to work */
  }

  .graph-canvas-container:active {
    cursor: grabbing;
  }

  /* Pixi creates a <canvas> child — ensure it fills the container */
  .graph-canvas-container :global(canvas) {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }

  .hover-anchor {
    position: absolute;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
</style>
