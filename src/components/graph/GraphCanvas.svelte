<script lang="ts">
import { onMount, untrack } from "svelte";
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
import type { GraphData, GraphNode, EdgeType } from "../../types/graph";
import { deriveClusterRepresentativesFromGraph } from "../../views/smart-graph/graphDataBuilder";
import { edgeKey } from "../../utils/graphUtils";
import { computeNodeBounds, framingTransform } from "../../utils/graphAnimation";
import { PixiRenderer, readThemeColors, type ClusterPillHit } from "./pixiRenderer";

interface Props {
	graphData: GraphData;
	linkDistance: number;
	chargeStrength?: number;
	centerStrength?: number;
	linkStrength?: number;
	showWikiLinks?: boolean;
	focusedClusters?: Set<number>;
	clusterLabels?: Record<number, string>;
	isLabeling?: boolean;
	/**
	 * Strength of the cluster cohesion force (0 = off, default 0.15).
	 * Pulls nodes toward their cluster centroid each simulation tick.
	 */
	clusterCohesionStrength?: number;
	onNodeClick?: (path: string) => void;
	onRevealFile?: (path: string) => void;
	onFocusCluster?: (cluster: number) => void;
	onToggleWikiLinks?: () => void;
	onImmerseDraft?: () => void;
	onExitImmersion?: () => void;
	immersedInDraft?: boolean;
	lassoMode?: boolean;
	onSelectionChange?: (paths: string[]) => void;
	onClearFocusedClusters?: () => void;
	onHoverPreview?: (event: MouseEvent, path: string, targetEl: HTMLElement) => void;
}

let {
	graphData,
	linkDistance,
	chargeStrength = -1000,
	centerStrength = 0.1,
	linkStrength = 1,
	showWikiLinks = true,
	focusedClusters = new Set<number>(),
	clusterLabels = {},
	isLabeling = false,
	clusterCohesionStrength = 0.15,
	onNodeClick,
	onRevealFile,
	onFocusCluster,
	onToggleWikiLinks,
	onImmerseDraft,
	onExitImmersion,
	immersedInDraft = false,
	lassoMode = false,
	onSelectionChange,
	onClearFocusedClusters,
	onHoverPreview,
}: Props = $props();

let containerEl: HTMLButtonElement;

// Invisible anchor element repositioned over hovered nodes for Obsidian's hover popover
let hoverAnchorEl: HTMLDivElement;

// Pixi renderer instance
let pixi: PixiRenderer | null = null;

// Node size auto-tuned from graph size: larger for small graphs, smaller for dense ones.
// Uses a continuous log scale so the transition is smooth, clamped to a readable range.
let nodeSize = $derived(Math.max(2, Math.round(7 - Math.log10(Math.max(graphData.nodes.length, 10)) * 1.8)));

// Edge alpha auto-tuned from edge count: fade edges as the graph grows denser so
// overlapping edges don't compound into a dark mass.  Clamped to [0.18, 0.60].
let baseEdgeAlpha = $derived(Math.max(0.18, Math.min(0.6, 1.0 / Math.sqrt(Math.max(graphData.edges.length, 4)))));

// Interaction state
let hoveredNode: GraphNode | null = $state(null);
let draggedNode: GraphNode | null = $state(null);
let hasDragged = false;
// Track pointer-down position to detect viewport pans (which also fire click)
let pointerDownScreenPos: { x: number; y: number } | null = null;

// Non-reactive drag reference — directly mutates the d3 SimNode's fx/fy
// without going through Svelte's $state proxy (wiki mode only)
let dragSimNode: SimNode | null = null;

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

// Simulation reference — $state so the hot-update $effect re-runs when simulation is (re)created
let simulation: ReturnType<typeof forceSimulation<SimNode>> | null = $state(null);
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

// Adjacency map: nodeId → Set of connected node ids (O(1) hover lookup)
let adjacency: Map<string, Set<string>> = new Map();

// Hover alpha stability tracking.
// When the hover fingerprint is unchanged and alphas have fully settled,
// skip the O(n) lerp loop on subsequent render calls (e.g. viewport pan/zoom).
let hoverAlphasSettled = false;
let lastHoverFingerprint = "";

// Cluster legend hit areas for click detection (screen space)
let clusterAnchorHitAreas: ClusterPillHit[] = [];

// Labeling animation loop
let labelAnimFrameId: number | null = null;

function stopLabelAnimation() {
	if (labelAnimFrameId != null) {
		cancelAnimationFrame(labelAnimFrameId);
		labelAnimFrameId = null;
	}
}

$effect(() => {
	if (isLabeling) {
		function tick() {
			render();
			labelAnimFrameId = requestAnimationFrame(tick);
		}
		labelAnimFrameId = requestAnimationFrame(tick);
		return () => {
			stopLabelAnimation();
			// One final render to clear the animated border
			render();
		};
	}
});

function handleKeyDown(e: KeyboardEvent) {
	const tag = (e.target as HTMLElement | null)?.tagName;
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

	const renderer = pixi;
	if (!renderer) return;

	switch (e.key) {
		case "Escape":
			if (isLassoing) {
				isLassoing = false;
				lassoPoints = [];
				pixi?.resumeViewport();
				render();
			} else if (selectedNodes.size > 0) {
				clearSelection();
			} else if (immersedInDraft) {
				onExitImmersion?.();
			} else if (focusedClusters.size > 0) {
				onClearFocusedClusters?.();
			}
			break;
		case "i":
			if (selectedNodes.size > 0 && !immersedInDraft) {
				onImmerseDraft?.();
			} else if (immersedInDraft) {
				onExitImmersion?.();
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
			const currentScale = renderer.scale;
			const newScale = Math.min(10, currentScale * 1.2);
			const center = renderer.screenToWorld(renderer.width / 2, renderer.height / 2);
			renderer.moveCenter(center.x, center.y, newScale);
			render();
			break;
		}
		case "-": {
			const currentScale = renderer.scale;
			const newScale = Math.max(0.05, currentScale / 1.2);
			const center = renderer.screenToWorld(renderer.width / 2, renderer.height / 2);
			renderer.moveCenter(center.x, center.y, newScale);
			render();
			break;
		}
	}
}

// Edge lookup map: "nodeA\0nodeB" → SimLink (built once in setupSimulation)
// Enables O(1) edge weight lookups for hover labels instead of O(n) scan.
let edgeLookup: Map<string, SimLink> = new Map();

// Persistent label occlusion grid — allocated once, zeroed at the start of each render.
// Avoids a ~10KB allocation + GC at 60fps. Resized only when canvas dimensions change.
let labelGrid: Uint8Array = new Uint8Array(0);
let labelGridCols = 0;
let labelGridRows = 0;

// Node ID → SimNode map for O(1) lookups (built once in setupSimulation)
let simNodeMap: Map<string, SimNode> = new Map();
let clusterRepresentativeIds: Set<string> = new Set();
let clusterRepresentativeNodes: Map<number, SimNode> = new Map();
let clusterNodeCounts: Map<number, number> = new Map();

// Cached label sort order — rebuilt only when hover/selection/highlight state changes.
// Between frames where only positions move, the priority of each node is stable.
let cachedSortedLabelNodes: SimNode[] = [];
let cachedSortKey = "";
// Incremented every time simNodes is fully rebuilt (graph data change).
// Including this in the sort key ensures stale node references are never reused.
let simNodesVersion = 0;

// Persistent position memory — survives across buildInternalData calls.
// Nodes that leave the view (e.g. during immersion) retain their last-known
// positions here so they are restored instantly when they re-appear, avoiding
// a full force-simulation re-settle on immersion exit.
const persistentPositionCache = new Map<string, { x: number; y: number }>();

// Cached cluster map for edge rendering (nodeId → cluster).
// Rebuilt only when simNodes changes — cluster assignments are stable between renders.
let cachedNodeClusterMap: Map<string, number | undefined> = new Map();
let cachedNodeClusterMapVersion = -1;

function getNodeClusterMap(): Map<string, number | undefined> {
	if (cachedNodeClusterMapVersion !== simNodesVersion) {
		cachedNodeClusterMap = new Map(simNodes.map((n) => [n.id, n.cluster]));
		cachedNodeClusterMapVersion = simNodesVersion;
	}
	return cachedNodeClusterMap;
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
 * Get the draw radius for a node based on its degree, centrality, and the user-configurable nodeSize.
 *
 * When betweenness centrality is available (Louvain mode), it is blended with degree:
 * - degree gives a +log bonus for highly-connected hubs
 * - centrality gives a larger bonus for bridge nodes whose removal would fragment the graph
 * The two signals are additive so a hub that is also a bridge gets the largest radius.
 */
function getNodeRadius(node: GraphNode): number {
	const base = Math.max(1, nodeSize);
	const degree = node.degree ?? 0;
	const degreeBonus = Math.min(Math.log1p(degree) * 2.5, base * 5);
	if (node.centrality != null && node.centrality > 0) {
		// centrality is 0–1; scale it to the same ceiling as the degree bonus
		const centralityBonus = Math.min(node.centrality * base * 8, base * 8);
		return base + Math.max(degreeBonus, centralityBonus * 0.6 + degreeBonus * 0.4);
	}
	return base + degreeBonus;
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
	// Build a fingerprint of everything that determines alpha targets.
	// If it matches the previous frame and alphas have fully settled, skip the
	// O(n) lerp loop — nothing would change anyway (e.g. during viewport pan).
	const hoverFingerprint = `${hoveredNode?.id ?? ""}|${draggedNode?.id ?? ""}|${selectedNodes.size}|${focusedClusters.size}|${simNodesVersion}`;
	const skipHoverLoop = hoverAlphasSettled && hoverFingerprint === lastHoverFingerprint;
	lastHoverFingerprint = hoverFingerprint;

	let hoverSettled = true;
	if (!skipHoverLoop) {
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
	}
	hoverAlphasSettled = hoverSettled;

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
			baseEdgeAlpha,
			nodeClusterMap,
		},
	);

	// ── Nodes ──────────────────────────────────────────────────
	pixi.syncNodes(simNodes, nodeSize, {
		selectedNodes,
		hoveredNodeId: hoveredNode?.id ?? null,
		draggedNodeId: draggedNode?.id ?? null,
		focusedClusters,
		isForceMode: true,
		hoverAlphas,
		nodeClusterMap,
	});

	// ── Labels ─────────────────────────────────────────────────
	// Labels appear automatically when a node's screen-space radius reaches a
	// readable threshold — no manual zoom setting needed. The occlusion grid
	// handles crowding; this threshold handles legibility.
	const MIN_LABEL_SCREEN_RADIUS = 5; // px — node must be at least this big on screen
	const showClusterAnchors = clusterRepresentativeNodes.size > 0;
	const hovId = hoveredNode?.id ?? null;
	const hoverNeighbors = hovId ? adjacency.get(hovId) : undefined;

	// Label font size in CSS pixels (screen space).
	// The renderer counter-scales each label with t.scale.set(1/viewport_scale), which
	// makes the effective screen size equal to t.style.fontSize exactly — so this value
	// is the on-screen pixel height at every zoom level, no division by scale needed.
	// Tied to nodeSize so labels feel proportional when the user adjusts node size.
	const LABEL_FONT_PX = Math.max(Math.round(nodeSize * 2.5), 10);

	// Label occlusion culling — grid-based O(n) instead of O(n²) linear scan.
	// The canvas is divided into LABEL_CELL_W×LABEL_CELL_H px cells (screen space).
	// A label is allowed only if none of the cells it spans are already occupied.
	const LABEL_CELL_W = 60; // px — approx half an average label width
	const LABEL_CELL_H = LABEL_FONT_PX + 6; // px — label height + padding
	const LABEL_PAD_X = 2;
	const LABEL_PAD_Y = 1;
	const neededCols = Math.ceil(width / LABEL_CELL_W) + 1;
	const neededRows = Math.ceil(height / LABEL_CELL_H) + 1;
	// Resize persistent grid only when canvas dimensions change; otherwise just zero it
	if (neededCols !== labelGridCols || neededRows !== labelGridRows) {
		labelGridCols = neededCols;
		labelGridRows = neededRows;
		labelGrid = new Uint8Array(labelGridCols * labelGridRows);
	} else {
		labelGrid.fill(0);
	}

	function canDrawLabel(nodeX: number, labelY: number, approxCharCount: number): boolean {
		// LABEL_FONT_PX is already in screen px, so sw/sh are screen px directly
		const sw = approxCharCount * LABEL_FONT_PX * 0.55;
		const sh = LABEL_FONT_PX;
		const screen = pixi!.worldToScreen(nodeX, labelY);
		const x1 = screen.x - sw / 2 - LABEL_PAD_X;
		const y1 = screen.y - sh - LABEL_PAD_Y;
		const x2 = screen.x + sw / 2 + LABEL_PAD_X;
		const y2 = screen.y + LABEL_PAD_Y;

		// Convert to grid cell range
		const col0 = Math.max(0, Math.floor(x1 / LABEL_CELL_W));
		const col1 = Math.min(labelGridCols - 1, Math.floor(x2 / LABEL_CELL_W));
		const row0 = Math.max(0, Math.floor(y1 / LABEL_CELL_H));
		const row1 = Math.min(labelGridRows - 1, Math.floor(y2 / LABEL_CELL_H));

		// Check — any occupied cell means overlap
		for (let r = row0; r <= row1; r++) {
			for (let c = col0; c <= col1; c++) {
				if (labelGrid[r * labelGridCols + c]) return false;
			}
		}
		// Mark cells as occupied
		for (let r = row0; r <= row1; r++) {
			for (let c = col0; c <= col1; c++) {
				labelGrid[r * labelGridCols + c] = 1;
			}
		}
		return true;
	}

	// Sort nodes by label priority — cached between frames where priority hasn't changed.
	// Priority depends on: hovered node, hover neighbors, highlighted nodes, cluster reps, degree.
	// Positions change every force-tick but priority doesn't — skip the O(n log n) sort those frames.
	let highlightedCount = 0;
	for (const n of simNodes) if (n.highlighted) highlightedCount++;
	const sortKey = `${hovId ?? ""}|${simNodesVersion}|${clusterRepresentativeIds.size}|${highlightedCount}`;
	if (sortKey !== cachedSortKey) {
		cachedSortKey = sortKey;
		cachedSortedLabelNodes = simNodes.filter((n) => n.x != null && n.y != null);
		cachedSortedLabelNodes.sort((a, b) => {
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
	}
	const sortedLabelNodes = cachedSortedLabelNodes;

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
		// Screen-space radius: how large the node circle appears on screen
		const screenRadius = radius * scale;

		if (hovId && node.id === hovId) {
			// Hovered node: always show label, skip occlusion check (it wins)
			canDrawLabel(node.x, labelY, node.label.length);
			labelEntries.push({
				nodeX: node.x,
				nodeY: labelY,
				text: node.label,
				color: c.textNormal,
				alpha: 1,
				fontSize: LABEL_FONT_PX,
			});
		} else if (hovId && hoverNeighbors?.has(node.id)) {
			if (!canDrawLabel(node.x, labelY, node.label.length)) continue;
			labelEntries.push({
				nodeX: node.x,
				nodeY: labelY,
				text: node.label,
				color: c.textMuted,
				alpha: nodeAlpha,
				fontSize: LABEL_FONT_PX,
			});
		} else if (node.highlighted && !hovId) {
			if (!canDrawLabel(node.x, labelY, node.label.length)) continue;
			labelEntries.push({
				nodeX: node.x,
				nodeY: labelY,
				text: node.label,
				color: c.textAccent,
				alpha: 1,
				fontSize: LABEL_FONT_PX,
			});
		} else if (screenRadius >= MIN_LABEL_SCREEN_RADIUS) {
			// Node is large enough on screen to anchor a label — show it if space allows
			if (!canDrawLabel(node.x, labelY, node.label.length)) continue;
			// Smooth fade-in over a 2px radius window so labels don't pop in abruptly
			const fadeAlpha = Math.min(1, (screenRadius - MIN_LABEL_SCREEN_RADIUS) / 2);
			labelEntries.push({
				nodeX: node.x,
				nodeY: labelY,
				text: node.label,
				color: node.highlighted ? c.textAccent : c.textNormal,
				alpha: nodeAlpha * fadeAlpha,
				fontSize: LABEL_FONT_PX,
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

	// ── Node tooltip ───────────────────────────────────────────
	if (hoveredNode && hoveredNode.x != null && hoveredNode.y != null) {
		pixi.showNodeTooltip(hoveredNode, clusterLabels, false, true);
	} else {
		pixi.hideTooltip();
	}
}

// ============================================================================
// Event handlers
// ============================================================================

function handleMouseDown(e: PointerEvent) {
	e.preventDefault();
	// Don't steal focus when a modal (e.g. search modal) is open — that would
	// trap keyboard events in the graph container and make the modal unresponsive.
	if (!document.querySelector(".modal-container")) {
		containerEl.focus();
	}
	if (!pixi) return;

	// Any pointer-down is user intent — abort auto-fit and stop periodic refits
	pixi.abortAnimation();
	needsInitialFit = false;
	const canvas = pixi.canvas;
	const rect = canvas.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;
	pointerDownScreenPos = { x, y };

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

	if (node) {
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
		dragSimNode.fx = null;
		dragSimNode.fy = null;
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

	// If the pointer moved more than 4px since mousedown the user was panning — ignore
	if (pointerDownScreenPos) {
		const dx = x - pointerDownScreenPos.x;
		const dy = y - pointerDownScreenPos.y;
		pointerDownScreenPos = null;
		if (dx * dx + dy * dy > 16) return;
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

function handleWheel() {
	// User is zooming — abort any running camera animation immediately
	pixi?.abortAnimation();
	needsInitialFit = false;
}

/**
 * Fire the hover-link preview for a node exactly once.
 * Positions the invisible anchor at the node's screen location.
 */
function triggerNodePreview(event: MouseEvent | KeyboardEvent, node: GraphNode) {
	if (!pixi) return;
	const screen = pixi.worldToScreen(node.x ?? 0, node.y ?? 0);
	// worldToScreen returns coords relative to the canvas element.
	// hoverAnchorEl is position:absolute within containerEl, so we must
	// subtract the canvas offset relative to the container.
	const canvasRect = pixi.canvas.getBoundingClientRect();
	const containerRect = containerEl.getBoundingClientRect();
	const offsetX = canvasRect.left - containerRect.left;
	const offsetY = canvasRect.top - containerRect.top;
	hoverAnchorEl.style.left = `${screen.x + offsetX}px`;
	hoverAnchorEl.style.top = `${screen.y + offsetY}px`;
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
	allPositionsKnown: boolean;
} {
	// Save old positions for smooth transitions and persist them for future restores
	const oldPositions = new Map<string, { x: number; y: number }>();
	for (const n of simNodes) {
		if (n.x != null && n.y != null) {
			oldPositions.set(n.id, { x: n.x, y: n.y });
			persistentPositionCache.set(n.id, { x: n.x, y: n.y });
		}
	}

	// Compute centroid from all known positions (old + cached) for scattering new nodes
	let centroidX = 0;
	let centroidY = 0;
	const knownForCentroid = oldPositions.size > 0 ? oldPositions : persistentPositionCache;
	if (knownForCentroid.size > 0) {
		for (const { x, y } of knownForCentroid.values()) {
			centroidX += x;
			centroidY += y;
		}
		centroidX /= knownForCentroid.size;
		centroidY /= knownForCentroid.size;
	}

	// Create mutable copies.
	// Priority: oldPositions (current frame) → persistentPositionCache (prior view) → scatter near centroid.
	let newNodeIndex = 0;
	let allPositionsKnown = true;
	simNodesVersion++;
	hoverAlphasSettled = false;
	const hasAnyKnown = oldPositions.size > 0 || persistentPositionCache.size > 0;
	simNodes = data.nodes.map((n) => {
		const sn: SimNode = { ...n };
		const old = oldPositions.get(n.id) ?? persistentPositionCache.get(n.id);
		if (old) {
			sn.x = old.x;
			sn.y = old.y;
		} else {
			allPositionsKnown = false;
			if (hasAnyKnown) {
				// Scatter new nodes in a ring around the centroid of the known layout
				const angle = (2 * Math.PI * newNodeIndex) / Math.max(1, data.nodes.length - oldPositions.size);
				const radius = 80 + Math.random() * 60;
				sn.x = centroidX + Math.cos(angle) * radius;
				sn.y = centroidY + Math.sin(angle) * radius;
				newNodeIndex++;
			}
		}
		return sn;
	});

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

	// Start edge fade-in on full data change
	edgeFadeAlpha = 0;

	return { oldPositions, isSmooth: false, allPositionsKnown };
}

// ============================================================================
// Wiki mode: d3-force simulation setup
// ============================================================================

function setupForceSimulation(
	_data: GraphData,
	oldPositions: Map<string, { x: number; y: number }>,
	isSmooth: boolean,
	allPositionsKnown: boolean,
) {
	// Save the default d3 link strength function so we can apply linkStrength as
	// a multiplier, matching how Obsidian's native graph works.
	const baseLinkForce = forceLink<SimNode, SimLink>(simLinks)
		.id((d) => d.id)
		.distance(linkDistance);
	const defaultLinkStrengthFn = baseLinkForce.strength() as (link: SimLink, i: number, links: SimLink[]) => number;
	cachedDefaultLinkStrengthFn = defaultLinkStrengthFn;
	baseLinkForce.strength((l, i, links) => linkStrength * defaultLinkStrengthFn(l, i, links));

	simulation = forceSimulation<SimNode>(simNodes);
	simulation
		.force("link", baseLinkForce)
		.force("charge", forceManyBody().strength(chargeStrength).distanceMin(30))
		// Obsidian uses forceX + forceY for centering (spring toward origin),
		// NOT forceCenter (which shifts the centroid). This is the key difference.
		.force("centerX", forceX<SimNode>(0).strength(centerStrength))
		.force("centerY", forceY<SimNode>(0).strength(centerStrength))
		.force("cluster", clusterCohesionForce(simNodes, clusterCohesionStrength))
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

	// All nodes restored from cache → gentle settle, no camera refit needed.
	// Some nodes had prior positions (mode switch) → slow drift into place.
	// No prior positions → full simulation from scratch.
	if (allPositionsKnown || isSmooth) {
		simulation.alpha(0.05);
		needsInitialFit = false;
	} else if (oldPositions.size > 0) {
		simulation.alpha(0.15).alphaDecay(0.008).velocityDecay(0.4);
		needsInitialFit = true;
		forceTickCount = 0;
	}
}

// ============================================================================
// Main graph setup — dispatches to wiki or smart layout engine
// ============================================================================

/**
 * Returns true when only node colors / cluster indices changed — the topology
 * (node IDs, count, edges) is identical to the current simNodes/simLinks.
 * Used to short-circuit a full layout restart on color-mode switches.
 */
function isColorOnlyChange(data: GraphData): boolean {
	if (simNodes.length === 0) return false;
	if (simNodes.length !== data.nodes.length) return false;
	const existingIds = new Set(simNodes.map((n) => n.id));
	if (!data.nodes.every((n) => existingIds.has(n.id))) return false;
	// Compare filtered edge count — simLinks excludes edges whose endpoints are
	// outside the rendered node set, so comparing against data.edges directly
	// produces a false mismatch whenever dangling edges exist.
	const filteredEdgeCount = data.edges.filter((e) => existingIds.has(e.source) && existingIds.has(e.target)).length;
	return simLinks.length === filteredEdgeCount;
}

function setupGraph(data: GraphData) {
	if (data.nodes.length === 0) {
		if (simulation) {
			simulation.stop();
			simulation = null;
		}
		return;
	}

	// Color-only update: topology unchanged, only colors/clusters differ.
	// Patch simNodes in-place and re-render — do NOT touch the simulation.
	// If cohesion > 0 it will naturally pull nodes toward their new cluster centroids.
	// If cohesion = 0 no force acts on the reassigned clusters so nodes stay put.
	if (isColorOnlyChange(data)) {
		for (const node of data.nodes) {
			const sn = simNodeMap.get(node.id);
			if (sn !== undefined) {
				sn.color = node.color;
				sn.cluster = node.cluster;
			}
		}
		// Sync the cohesion force strength to the current prop value.
		const clusterForce = simulation?.force("cluster") as ReturnType<typeof clusterCohesionForce> | undefined;
		if (clusterForce) clusterForce.strength(clusterCohesionStrength);
		// Re-derive cluster metadata so pills on the canvas reflect the new segmentation.
		// (buildInternalData is not called in this path, so we update it explicitly.)
		const clusterRepresentatives = deriveClusterRepresentativesFromGraph(data);
		clusterRepresentativeIds = new Set([...clusterRepresentatives.values()].map((n) => n.id));
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
		if (pixi) render();
		return;
	}

	// Full setup needed — stop existing simulation first
	if (simulation) {
		simulation.stop();
		simulation = null;
	}

	const { oldPositions, isSmooth, allPositionsKnown } = buildInternalData(data);
	setupForceSimulation(data, oldPositions, isSmooth, allPositionsKnown);
}

// React to graphData changes — setupGraph is called via untrack so that writes
// to $state simulation inside setupForceSimulation don't re-trigger this effect.
$effect(() => {
	const _data = graphData;
	void _data;
	untrack(() => setupGraph(graphData));
});

// Re-render when appearance settings change (nodeSize, showWikiLinks)
$effect(() => {
	void nodeSize;
	void showWikiLinks;
	if (pixi) render();
});

// Hot-update force parameters without full rebuild.
// Reheats the simulation when it has settled so changes are visible immediately.
// Reading `simulation` ($state) means this effect re-runs when a new simulation
// is created (e.g. after a full graph rebuild), so slider changes always apply.
$effect(() => {
	const _charge = chargeStrength;
	const _link = linkDistance;
	const _center = centerStrength;
	const _linkStr = linkStrength;
	const _cohesion = clusterCohesionStrength;
	const sim = simulation; // $state — tracks simulation creation

	if (!sim) return;

	const charge = sim.force("charge") as ReturnType<typeof forceManyBody> | undefined;
	if (charge) charge.strength(_charge);

	const cx = sim.force("centerX") as ReturnType<typeof forceX> | undefined;
	if (cx) cx.strength(_center);
	const cy = sim.force("centerY") as ReturnType<typeof forceY> | undefined;
	if (cy) cy.strength(_center);

	const link = sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | undefined;
	if (link) {
		link.distance(_link);
		if (cachedDefaultLinkStrengthFn) {
			const baseFn = cachedDefaultLinkStrengthFn;
			link.strength((l: SimLink, i: number, links: SimLink[]) => _linkStr * baseFn(l, i, links));
		}
	}

	const collide = sim.force("collide") as ReturnType<typeof forceCollide<SimNode>> | undefined;
	if (collide) collide.radius((d: SimNode) => getNodeRadius(d) + 2);

	const clusterForce = sim.force("cluster") as ReturnType<typeof clusterCohesionForce> | undefined;
	if (clusterForce) clusterForce.strength(_cohesion);

	// Reheat if settled so the param change is immediately visible.
	if (sim.alpha() < 0.05) {
		sim.alpha(0.3).restart();
	}
});

onMount(() => {
	// Initialize Pixi renderer
	const theme = readThemeColors(containerEl);
	const renderer = new PixiRenderer();
	pixi = renderer;

	renderer.init(containerEl, theme).then(() => {
		// Re-render overlays (cluster pills, legends, labels) when viewport moves
		renderer.onViewportMoved(() => render());

		// If graphData arrived before pixi was ready (happens when GraphCanvas
		// mounts while a build completes, e.g. on first open), do the initial
		// snap/fit that setupForceSimulation missed.
		if (simNodes.length > 0) {
			// Force mode: simulation is already running.
			// If it has already settled (alpha low), snap the camera immediately
			// since the tick loop won't fire again to do the initial fit.
			const alpha = simulation?.alpha() ?? 0;
			if (alpha < 0.05) {
				const bounds = computeNodeBounds(simNodes);
				if (bounds) {
					const frame = framingTransform(bounds, { width: renderer.width, height: renderer.height }, 20);
					const cx = (bounds.minX + bounds.maxX) / 2;
					const cy = (bounds.minY + bounds.maxY) / 2;
					renderer.snapToFrame(cx, cy, frame.scale);
				}
			} else {
				// Simulation still running — tick loop will handle fitting.
				needsInitialFit = true;
				forceTickCount = 0;
			}
			render();
		}

		const resizeObserver = new ResizeObserver(() => {
			const rect = containerEl.getBoundingClientRect();
			renderer.resize(rect.width, rect.height);
			render();
		});
		resizeObserver.observe(containerEl);

		// Listen for Obsidian theme changes — covers both "css-change" events (CSS
		// snippets) and class mutations on body (.theme-dark / .theme-light toggle).
		const handleCssChange = () => {
			const newTheme = readThemeColors(containerEl);
			renderer.updateTheme(newTheme);
			render();
		};
		document.body.addEventListener("css-change", handleCssChange);

		const themeMutationObserver = new MutationObserver((mutations) => {
			for (const m of mutations) {
				if (m.type === "attributes" && m.attributeName === "class") {
					handleCssChange();
					break;
				}
			}
		});
		themeMutationObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});

		// Store cleanup references
		(containerEl as any).__graphCleanup = () => {
			resizeObserver.disconnect();
			document.body.removeEventListener("css-change", handleCssChange);
			themeMutationObserver.disconnect();
		};
	});

	return () => {
		(containerEl as any).__graphCleanup?.();
		if (hoverAnimFrameId != null) cancelAnimationFrame(hoverAnimFrameId);
		if (simulation) {
			simulation.stop();
			simulation = null;
		}
		stopLabelAnimation();
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

<button
  type="button"
  class="graph-canvas-container"
  bind:this={containerEl}
  aria-label="Interactive graph canvas"
  onpointerdown={handleMouseDown}
  onpointermove={handleMouseMove}
  onpointerup={handleMouseUp}
  onclick={handleClick}
  onkeydown={handleKeyDown}
  onwheel={handleWheel}
  onmouseleave={handleMouseLeave}
  oncontextmenu={handleContextMenu}
>
  <!-- Pixi.js creates its own <canvas> inside this container via pixi.init() -->
  <!-- Invisible anchor for Obsidian hover-link popover positioning -->
  <div bind:this={hoverAnchorEl} class="hover-anchor"></div>
</button>

<style>
  .graph-canvas-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
    display: block;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: initial;
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
