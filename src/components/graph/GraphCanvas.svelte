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
    focusedCluster?: number | null;
    clusterLabels?: Record<number, string>;
    isLabeling?: boolean;
    onNodeClick?: (path: string) => void;
    onRevealFile?: (path: string) => void;
    onFocusCluster?: (cluster: number) => void;
  }

  let {
    graphData,
    nodeSize,
    linkDistance,
    chargeStrength = -150,
    labelZoomThreshold = 2.5,
    discoveryMode = false,
    showSemanticEdges = true,
    focusedCluster = null,
    clusterLabels = {},
    isLabeling = false,
    onNodeClick,
    onRevealFile,
    onFocusCluster,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement;
  let containerEl: HTMLDivElement;

  // Transform state for zoom/pan
  let transform = $state({ x: 0, y: 0, scale: 1 });

  // Interaction state
  let hoveredNode: GraphNode | null = $state(null);
  let draggedNode: GraphNode | null = $state(null);
  let isPanning = $state(false);
  let panStart = { x: 0, y: 0 };

  // Pinned nodes: nodes with fixed positions (fx/fy set)
  let pinnedNodes: Set<string> = new Set();

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
  function distToSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number {
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

    const width = canvasEl.width;
    const height = canvasEl.height;

    // Resolve theme CSS variables (Canvas 2D can't use var() directly)
    const c = resolveThemeColors();

    // Clear
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    // Draw edges — wiki first (solid, below), then semantic (dashed, on top)
    // This lets users spot new semantic connections that don't exist as wiki links.
    // Uses pre-split arrays (built in setupSimulation) to avoid filtering every frame.

    for (const link of wikiSimLinks) {
      const source = link.source as SimNode;
      const target = link.target as SimNode;

      if (source.x == null || source.y == null || target.x == null || target.y == null) continue;

      // Dim edges outside focused cluster
      const inFocus =
        focusedCluster == null ||
        source.cluster === focusedCluster ||
        target.cluster === focusedCluster;

      const isHighlighted =
        hoveredNode && (source.id === hoveredNode.id || target.id === hoveredNode.id);

      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = isHighlighted ? c.accent : c.textFaint;
      ctx.lineWidth = isHighlighted ? 2 / transform.scale : 1 / transform.scale;
      ctx.globalAlpha = !inFocus ? 0.05 : isHighlighted ? 0.9 : 0.45;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (showSemanticEdges) {
      for (const link of semanticSimLinks) {
        const source = link.source as SimNode;
        const target = link.target as SimNode;

        if (source.x == null || source.y == null || target.x == null || target.y == null) continue;

        // Dim edges outside focused cluster
        const inFocus =
          focusedCluster == null ||
          source.cluster === focusedCluster ||
          target.cluster === focusedCluster;

        const isHighlighted =
          hoveredNode && (source.id === hoveredNode.id || target.id === hoveredNode.id);

        ctx.beginPath();
        const dash = 4 / transform.scale;
        ctx.setLineDash([dash, dash]);
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = isHighlighted ? c.accent : c.graphLine;
        ctx.lineWidth = isHighlighted
          ? 2 / transform.scale
          : Math.max(0.5, link.weight * 3) / transform.scale;
        ctx.globalAlpha = !inFocus
          ? 0.03
          : isHighlighted
            ? 0.9
            : Math.min(0.15 + link.weight * 0.3, 0.6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } // end showSemanticEdges
    ctx.setLineDash([]);

    // Draw nodes
    for (const node of simNodes) {
      if (node.x == null || node.y == null) continue;

      const radius = getNodeRadius(node);
      const isHovered = hoveredNode?.id === node.id;
      const isDragged = draggedNode?.id === node.id;

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);

      // Fill
      if (node.highlighted) {
        ctx.fillStyle = c.accent;
        ctx.globalAlpha = 1;
      } else if (isHovered || isDragged) {
        ctx.fillStyle = node.color ?? c.graphNode;
        ctx.globalAlpha = 1;
      } else if (focusedCluster != null && node.cluster !== focusedCluster) {
        // Dim nodes outside the focused cluster
        ctx.fillStyle = node.color ?? c.graphNode;
        ctx.globalAlpha = 0.1;
      } else if (hoveredNode) {
        // Dim non-connected nodes when hovering (O(1) adjacency lookup)
        const isConnected = adjacency.get(hoveredNode.id)?.has(node.id) ?? false;
        ctx.fillStyle = node.color ?? c.graphNode;
        ctx.globalAlpha = isConnected ? 1 : 0.15;
      } else {
        ctx.fillStyle = node.color ?? c.graphNode;
        ctx.globalAlpha = 0.85;
      }

      ctx.fill();
      ctx.globalAlpha = 1;

      // Stroke for highlighted/hovered nodes
      if (node.highlighted || isHovered) {
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

    // Show all labels when zoomed in past threshold
    const showAllLabels = labelZoomThreshold > 0 && transform.scale >= labelZoomThreshold;

    if (showAllLabels && !hoveredNode) {
      const fontSize = Math.max(10 / transform.scale, 6);
      ctx.font = `${fontSize}px ${c.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      for (const node of simNodes) {
        if (node.x == null || node.y == null) continue;
        const radius = getNodeRadius(node);
        const labelY = node.y - radius - 3 / transform.scale;

        ctx.fillStyle = node.highlighted ? c.textAccent : c.textNormal;
        ctx.globalAlpha = node.highlighted ? 1 : 0.85;
        ctx.fillText(node.label, node.x, labelY);
        ctx.globalAlpha = 1;
      }
    }

    // Draw labels for hovered node and its neighbors
    if (hoveredNode && hoveredNode.x != null && hoveredNode.y != null) {
      const nodesToLabel: SimNode[] = [hoveredNode as SimNode];

      // Find connected nodes via adjacency map (O(1) lookup)
      const neighborIds = adjacency.get(hoveredNode.id);
      if (neighborIds) {
        for (const nid of neighborIds) {
          const sn = simNodes.find((n) => n.id === nid);
          if (sn) nodesToLabel.push(sn);
        }
      }

      const fontSize = Math.max(12 / transform.scale, 8);
      ctx.font = `${fontSize}px ${c.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      for (const node of nodesToLabel) {
        if (node.x == null || node.y == null) continue;
        const radius = getNodeRadius(node);
        const labelY = node.y - radius - 4 / transform.scale;

        // Show similarity to hovered node for neighbors
        if (node.id !== hoveredNode.id) {
          // O(1) edge weight lookup
          const link = edgeLookup.get(edgeKey(hoveredNode.id, node.id));
          const simLabel = link
            ? link.type === "semantic"
              ? ` (${link.weight.toFixed(2)})`
              : " (wiki)"
            : "";
          ctx.fillStyle = c.textMuted;
          ctx.fillText(`${node.label}${simLabel}`, node.x, labelY);
        } else {
          ctx.fillStyle = c.textNormal;
          ctx.fillText(node.label, node.x, labelY);
        }
      }
    }

    // Draw labels for highlighted (search) nodes even without hover
    if (!hoveredNode && !showAllLabels) {
      const highlighted = simNodes.filter((n) => n.highlighted);

      if (highlighted.length > 0 && highlighted.length < 50) {
        const fontSize = Math.max(11 / transform.scale, 7);
        ctx.font = `${fontSize}px ${c.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        for (const node of highlighted) {
          if (node.x == null || node.y == null) continue;
          const radius = getNodeRadius(node);
          const labelY = node.y - radius - 3 / transform.scale;

          ctx.fillStyle = c.textAccent;
          ctx.fillText(node.label, node.x, labelY);
        }
      }
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

      ctx.font = `${11}px ${c.font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 0.7;

      // Wiki link line (solid)
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 28, ly);
      ctx.strokeStyle = c.textFaint;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = c.textMuted;
      ctx.fillText("Wiki link", lx + 34, ly);

      // Semantic line (dashed)
      const row2Y = ly + 18;
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
          ctx.fillText(
            legendLabel,
            legendX + padX + swatchSize + 6,
            rowY,
            legendW - padX - swatchSize - 16,
          );
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
          hoveredEdge.type === "wiki"
            ? `wiki · ${hoveredEdge.weight}`
            : `sim · ${hoveredEdge.weight.toFixed(3)}`;

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

  function handleMouseDown(e: MouseEvent) {
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = findNodeAt(x, y);

    if (node) {
      // Start dragging a node
      draggedNode = node;
      if (simulation) {
        simulation.alphaTarget(0.3).restart();
        (node as SimNode).fx = node.x;
        (node as SimNode).fy = node.y;
      }
    } else {
      // Start panning
      isPanning = true;
      panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
    }
  }

  function handleMouseMove(e: MouseEvent) {
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (draggedNode) {
      // Drag node
      const graphPos = screenToGraph(x, y);
      (draggedNode as SimNode).fx = graphPos.x;
      (draggedNode as SimNode).fy = graphPos.y;
      render();
    } else if (isPanning) {
      // Pan
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
        const node = findNodeAt(x, y);
        if (node !== hoveredNode) {
          hoveredNode = node;
          hoveredEdge = null;
          canvasEl.style.cursor = node ? "pointer" : "grab";
          render();
        } else if (!node) {
          // No node hovered — check edges
          const edge = findEdgeAt(x, y);
          if (edge !== hoveredEdge) {
            hoveredEdge = edge;
            canvasEl.style.cursor = edge ? "crosshair" : "grab";
            render();
          }
        }
      }
    }
  }

  function handleMouseUp(_e: MouseEvent) {
    if (draggedNode) {
      if (simulation) {
        simulation.alphaTarget(0);
        // Keep pinned nodes fixed; unpin others
        if (!pinnedNodes.has(draggedNode.id)) {
          (draggedNode as SimNode).fx = null;
          (draggedNode as SimNode).fy = null;
        }
      }
      draggedNode = null;
    }
    isPanning = false;
  }

  function handleClick(e: MouseEvent) {
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check cluster legend hit areas first (screen space)
    for (const area of clusterLegendHitAreas) {
      if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
        onFocusCluster?.(area.cluster);
        render();
        return;
      }
    }

    const node = findNodeAt(x, y);

    if (node && onNodeClick) {
      onNodeClick(node.path);
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
    if (draggedNode) {
      if (simulation) {
        // Respect pinned state: only release fx/fy for unpinned nodes
        if (!pinnedNodes.has(draggedNode.id)) {
          (draggedNode as SimNode).fx = null;
          (draggedNode as SimNode).fy = null;
        }
        simulation.alphaTarget(0);
      }
      draggedNode = null;
    }
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
          const simNode = simNodes.find((n) => n.id === node.id);
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

          if (simulation) {
            simulation.alpha(0.1).restart();
          }
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
  function clusterCohesionForce(
    nodes: SimNode[],
    _initialCentroids: Map<number, { x: number; y: number }>,
    strength: number,
  ) {
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

    // Create mutable copies for d3-force
    simNodes = data.nodes.map((n) => {
      const sn: SimNode = { ...n };
      // Restore previous positions if the node existed before
      const old = oldPositions.get(n.id);
      if (old) {
        sn.x = old.x;
        sn.y = old.y;
      }
      // Restore pinned state
      if (pinnedNodes.has(n.id) && old) {
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
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    simLinks = data.edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
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

    // Compute per-cluster centroids in 2D for cluster cohesion force
    const clusterCentroids = computeClusterCentroids(simNodes);

    simulation = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(linkDistance)
          .strength((l) => Math.min(l.weight * 0.5, 1)),
      )
      .force("charge", forceManyBody().strength(chargeStrength).distanceMax(3000))
      .force("center", forceCenter(0, 0))
      .force("gravityX", forceX<SimNode>(0).strength(0.08))
      .force("gravityY", forceY<SimNode>(0).strength(0.08))
      .force("cluster", clusterCohesionForce(simNodes, clusterCentroids, 0.15))
      .force(
        "collide",
        forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 2),
      )
      .on("tick", () => {
        render();
      })
      .alphaDecay(0.02)
      .velocityDecay(0.3);

    // If nodes already had positions, start with low alpha for gentle transition
    if (oldPositions.size > 0) {
      simulation.alpha(0.3);
    }
  }

  // React to graphData changes
  $effect(() => {
    // Access graphData to track it
    const data = graphData;
    setupSimulation(data);

    return () => {
      if (simulation) {
        simulation.stop();
        simulation = null;
      }
    };
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

    const link = simulation.force("link") as
      | ReturnType<typeof forceLink<SimNode, SimLink>>
      | undefined;
    if (link) link.distance(_link);

    const collide = simulation.force("collide") as
      | ReturnType<typeof forceCollide<SimNode>>
      | undefined;
    if (collide) collide.radius((d: SimNode) => getNodeRadius(d) + 2);

    simulation.alpha(0.5).restart();
  });

  onMount(() => {
    resizeCanvas();

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    resizeObserver.observe(containerEl);

    // Listen for Obsidian theme changes to invalidate cached colors
    const handleCssChange = () => invalidateThemeColors();
    document.body.addEventListener("css-change", handleCssChange);

    return () => {
      resizeObserver.disconnect();
      document.body.removeEventListener("css-change", handleCssChange);
      if (animFrameId != null) cancelAnimationFrame(animFrameId);
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
    const padding = 60;

    const scaleX = (rect.width - padding * 2) / graphWidth;
    const scaleY = (rect.height - padding * 2) / graphHeight;
    const targetScale = Math.min(scaleX, scaleY, 2);

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
</script>

<div class="graph-canvas-container" bind:this={containerEl}>
  <canvas
    bind:this={canvasEl}
    onmousedown={handleMouseDown}
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
    onclick={handleClick}
    onwheel={handleWheel}
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
  }

  canvas {
    display: block;
    cursor: grab;
  }

  canvas:active {
    cursor: grabbing;
  }
</style>
