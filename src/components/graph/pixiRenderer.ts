/**
 * Pixi.js WebGL renderer for the Smart Graph.
 *
 * Encapsulates all Pixi.js display-object management, hit detection,
 * viewport zoom/pan, and theme-aware rendering. The Svelte component
 * (`GraphCanvas.svelte`) remains the orchestrator for layout engines
 * (d3-force / UMAP) and reactive state.
 */

import { Application, Container, Graphics, Text, TextStyle, type PointData } from "pixi.js";
import { Viewport } from "pixi-viewport";

// ── Helpers ──────────────────────────────────────────────────

/** Draw a dashed line on a Pixi Graphics object (Pixi has no native setLineDash). */
function drawDashedLine(g: Graphics, x1: number, y1: number, x2: number, y2: number, dash: number, gap: number): void {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.sqrt(dx * dx + dy * dy);
	const ux = dx / len;
	const uy = dy / len;
	let drawn = 0;
	let drawing = true;
	while (drawn < len) {
		const seg = drawing ? dash : gap;
		const end = Math.min(drawn + seg, len);
		if (drawing) {
			g.moveTo(x1 + ux * drawn, y1 + uy * drawn);
			g.lineTo(x1 + ux * end, y1 + uy * end);
		}
		drawn = end;
		drawing = !drawing;
	}
}

// ── Color utilities ──────────────────────────────────────────

/**
 * Resolve any CSS color value (including calc(), var(), hsl(), etc.) to a
 * hex string that Pixi.js can understand.  Uses a hidden 2D canvas context
 * to let the browser resolve the value.
 */
let _colorCtx: CanvasRenderingContext2D | null = null;
function resolveColor(raw: string, fallback: string): string {
	if (!raw || raw === "none" || raw === "transparent") return fallback;
	// Already a hex color — fast path
	if (raw.startsWith("#")) return raw;

	try {
		if (!_colorCtx) {
			const c = document.createElement("canvas");
			c.width = 1;
			c.height = 1;
			_colorCtx = c.getContext("2d")!;
		}
		_colorCtx.fillStyle = "#000000"; // reset
		_colorCtx.fillStyle = raw;
		const resolved = _colorCtx.fillStyle; // browser-resolved hex or rgb()
		// fillStyle returns a hex string like "#rrggbb" or "rgba(r,g,b,a)"
		if (resolved.startsWith("#")) return resolved;
		// Parse rgb/rgba → hex
		const m = resolved.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (m) {
			const r = Number(m[1]).toString(16).padStart(2, "0");
			const g = Number(m[2]).toString(16).padStart(2, "0");
			const b = Number(m[3]).toString(16).padStart(2, "0");
			return `#${r}${g}${b}`;
		}
		return fallback;
	} catch {
		return fallback;
	}
}

// ── Theme colors ─────────────────────────────────────────────

export interface ThemeColors {
	accent: string;
	textNormal: string;
	textMuted: string;
	textFaint: string;
	textAccent: string;
	graphLine: string;
	graphNode: string;
	textOnAccent: string;
	bgPrimary: string;
	font: string;
}

export function readThemeColors(el: HTMLElement): ThemeColors {
	const style = getComputedStyle(el);
	// Resolve every color through the canvas context so CSS calc(), var(),
	// and other dynamic expressions are converted to hex for Pixi.js.
	const get = (prop: string, fallback: string) => resolveColor(style.getPropertyValue(prop).trim(), fallback);
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
		font: style.getPropertyValue("--font-interface").trim() || "-apple-system, BlinkMacSystemFont, sans-serif",
	};
}

// ── Types ────────────────────────────────────────────────────

/** Hit area info for screen-space cluster pills (stored for click/hover). */
export interface ClusterPillHit {
	x: number;
	y: number;
	w: number;
	h: number;
	cluster: number;
}

export interface EdgeLegendHit {
	x: number;
	y: number;
	w: number;
	h: number;
	type: "wiki";
}

// ── Renderer ─────────────────────────────────────────────────

export class PixiRenderer {
	// Pixi core
	private app!: Application;
	private viewport!: Viewport;
	private containerEl!: HTMLElement;

	// Layers (world-space, inside viewport)
	private edgeLayer!: Container;
	private nodeLayer!: Container;
	private labelLayer!: Container;
	private lassoLayer!: Container;

	// Overlay (screen-space, outside viewport)
	private overlayStage!: Container;
	private clusterPillLayer!: Container;
	private legendLayer!: Container;
	private tooltipLayer!: Container;

	// Display objects
	private edgeGraphics!: Graphics;
	private lassoGraphics!: Graphics;
	private nodeGraphicsMap: Map<string, Graphics> = new Map();

	// Cached visual state per node — skip geometry rebuild when unchanged
	private nodeVisualCache: Map<
		string,
		{
			radius: number;
			fillColor: string;
			strokeColor: string | null;
			strokeWidth: number;
			pinned: boolean;
		}
	> = new Map();

	// Label pool
	private labelPool: Text[] = [];
	private activeLabelCount = 0;
	private readonly LABEL_POOL_SIZE = 250;

	// Overlay objects
	private clusterPillObjects: Array<{ container: Container; graphics: Graphics; text: Text }> = [];
	private legendContainer!: Container;
	private legendGraphics!: Graphics;
	private legendText!: Text;
	private tooltipContainer!: Container;
	private tooltipGraphics!: Graphics;
	private tooltipTexts: Text[] = [];

	// State
	private _theme!: ThemeColors;
	private _width = 0;
	private _height = 0;
	private _destroyed = false;
	private _ready = false;

	// Callback fired whenever the viewport moves (pan/zoom/pinch)
	private _onViewportMoved: (() => void) | null = null;

	// Public accessors
	get theme(): ThemeColors {
		return this._theme;
	}
	get width(): number {
		return this._width;
	}
	get height(): number {
		return this._height;
	}

	/** Whether the renderer has been fully initialized. */
	get ready(): boolean {
		return this._ready;
	}

	/** Register a callback that fires whenever the viewport moves (pan/zoom). */
	onViewportMoved(cb: () => void): void {
		this._onViewportMoved = cb;
	}

	// ── Lifecycle ──────────────────────────────────────────

	async init(containerEl: HTMLElement, theme: ThemeColors): Promise<void> {
		this.containerEl = containerEl;
		this._theme = theme;

		const rect = containerEl.getBoundingClientRect();
		this._width = rect.width;
		this._height = rect.height;

		this.app = new Application();
		await this.app.init({
			width: this._width,
			height: this._height,
			antialias: true,
			backgroundAlpha: 0,
			resolution: window.devicePixelRatio || 1,
			autoDensity: true,
			preference: "webgl",
		});

		// Style the canvas
		const canvas = this.app.canvas as HTMLCanvasElement;
		canvas.style.display = "block";
		canvas.style.width = "100%";
		canvas.style.height = "100%";
		canvas.style.touchAction = "none";
		containerEl.prepend(canvas);

		// Viewport (zoom, pan, pinch)
		// worldWidth/worldHeight must be set so the internal hit-area is non-zero;
		// otherwise wheel and pointer events are silently dropped.
		this.viewport = new Viewport({
			screenWidth: this._width,
			screenHeight: this._height,
			worldWidth: this._width * 10,
			worldHeight: this._height * 10,
			events: this.app.renderer.events,
			passiveWheel: false,
		});
		this.app.stage.addChild(this.viewport);

		this.viewport
			.drag()
			.pinch()
			.wheel({ smooth: 5, trackpadPinch: true })
			.decelerate({ friction: 0.92 })
			.clampZoom({
				minScale: 0.05,
				maxScale: 10,
			});

		// Fire callback when viewport moves (pan/zoom/pinch/decelerate)
		this.viewport.on("moved", () => {
			this._onViewportMoved?.();
		});

		// World-space layers (inside viewport)
		this.edgeLayer = new Container();
		this.nodeLayer = new Container();
		this.labelLayer = new Container();
		this.lassoLayer = new Container();
		this.viewport.addChild(this.edgeLayer);
		this.viewport.addChild(this.nodeLayer);
		this.viewport.addChild(this.labelLayer);
		this.viewport.addChild(this.lassoLayer);

		// Edge graphics (single batched)
		this.edgeGraphics = new Graphics();
		this.edgeLayer.addChild(this.edgeGraphics);

		// Lasso graphics
		this.lassoGraphics = new Graphics();
		this.lassoLayer.addChild(this.lassoGraphics);

		// Screen-space overlay (outside viewport)
		this.overlayStage = new Container();
		this.app.stage.addChild(this.overlayStage);

		this.clusterPillLayer = new Container();
		this.legendLayer = new Container();
		this.tooltipLayer = new Container();
		this.overlayStage.addChild(this.clusterPillLayer);
		this.overlayStage.addChild(this.legendLayer);
		this.overlayStage.addChild(this.tooltipLayer);

		// Pre-allocate label pool
		for (let i = 0; i < this.LABEL_POOL_SIZE; i++) {
			const t = new Text({
				text: "",
				style: new TextStyle({
					fontFamily: theme.font,
					fontSize: 12,
					fill: theme.textNormal,
				}),
			});
			t.anchor.set(0.5, 1); // center-bottom
			t.visible = false;
			this.labelLayer.addChild(t);
			this.labelPool.push(t);
		}

		// Legend setup
		this.legendContainer = new Container();
		this.legendGraphics = new Graphics();
		this.legendText = new Text({
			text: "Wiki link",
			style: new TextStyle({
				fontFamily: theme.font,
				fontSize: 11,
				fill: theme.textMuted,
			}),
		});
		this.legendText.anchor.set(0, 0.5);
		this.legendContainer.addChild(this.legendGraphics);
		this.legendContainer.addChild(this.legendText);
		this.legendLayer.addChild(this.legendContainer);

		// Tooltip setup
		this.tooltipContainer = new Container();
		this.tooltipContainer.visible = false;
		this.tooltipGraphics = new Graphics();
		this.tooltipContainer.addChild(this.tooltipGraphics);
		// Create 3 text lines for tooltip
		for (let i = 0; i < 3; i++) {
			const t = new Text({
				text: "",
				style: new TextStyle({
					fontFamily: theme.font,
					fontSize: 11,
					fill: i === 0 ? theme.textNormal : theme.textMuted,
					fontWeight: i === 0 ? "bold" : "normal",
				}),
			});
			t.anchor.set(0, 0);
			this.tooltipContainer.addChild(t);
			this.tooltipTexts.push(t);
		}
		this.tooltipLayer.addChild(this.tooltipContainer);

		this._ready = true;
	}

	destroy(): void {
		if (this._destroyed) return;
		this._destroyed = true;
		this._ready = false;
		this.app.destroy(true, { children: true });
	}

	// ── Canvas access ──────────────────────────────────────

	get canvas(): HTMLCanvasElement {
		return this.app.canvas as HTMLCanvasElement;
	}

	// ── Resize ─────────────────────────────────────────────

	resize(width: number, height: number): void {
		this._width = width;
		this._height = height;
		this.app.renderer.resize(width, height);
		this.viewport.resize(width, height, width * 10, height * 10);
	}

	// ── Theme ──────────────────────────────────────────────

	updateTheme(theme: ThemeColors): void {
		this._theme = theme;
		// Update legend text
		this.legendText.style.fill = theme.textMuted;
		this.legendText.style.fontFamily = theme.font;
		// Update tooltip text styles
		for (let i = 0; i < this.tooltipTexts.length; i++) {
			this.tooltipTexts[i].style.fontFamily = theme.font;
			this.tooltipTexts[i].style.fill = i === 0 ? theme.textNormal : theme.textMuted;
		}
		// Node colors are refreshed on the next updateNodes() call
	}

	// ── Viewport / camera ──────────────────────────────────

	/** Convert screen coords to world (graph) coords. */
	screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
		const pt = this.viewport.toWorld(screenX, screenY);
		return { x: pt.x, y: pt.y };
	}

	/** Get current viewport transform in the same format as the old code. */
	getTransform(): { x: number; y: number; scale: number } {
		return {
			x: this.viewport.x,
			y: this.viewport.y,
			scale: this.viewport.scaled,
		};
	}

	/** Set the viewport transform directly (for animation). */
	setTransform(x: number, y: number, scale: number): void {
		this.viewport.moveCenter(-x / scale + this._width / 2 / scale, -y / scale + this._height / 2 / scale);
		this.viewport.setZoom(scale, true);
	}

	/** Move the viewport to center on a world point at a given scale. */
	moveCenter(worldX: number, worldY: number, scale?: number): void {
		this.viewport.moveCenter(worldX, worldY);
		if (scale != null) {
			this.viewport.setZoom(scale, true);
		}
	}

	/** Animate the viewport to frame a bounding box. */
	animateToFrame(centerX: number, centerY: number, scale: number, duration: number): void {
		this.viewport.animate({
			position: { x: centerX, y: centerY } as PointData,
			scale: scale,
			time: duration,
			ease: "easeOutCubic",
			callbackOnComplete: () => {},
		});
	}

	/** Snap the viewport to frame a bounding box without animation. */
	snapToFrame(centerX: number, centerY: number, scale: number): void {
		this.viewport.moveCenter(centerX, centerY);
		this.viewport.setZoom(scale, true);
	}

	/** Get the current viewport scale. */
	get scale(): number {
		return this.viewport.scaled;
	}

	// Pause/resume viewport interaction (e.g. during node drag)
	pauseViewport(): void {
		this.viewport.plugins.pause("drag");
		this.viewport.plugins.pause("decelerate");
	}

	resumeViewport(): void {
		this.viewport.plugins.resume("drag");
		this.viewport.plugins.resume("decelerate");
	}

	// ── Node management ────────────────────────────────────

	/**
	 * Sync node display objects with the current simNodes array.
	 * Fast path: only updates positions + alpha when geometry hasn't changed.
	 * Slow path: rebuilds circles/strokes only when visual state differs.
	 */
	syncNodes(
		nodes: Array<{ id: string; x: number; y: number; color?: string; degree?: number; highlighted?: boolean }>,
		nodeSize: number,
		opts: {
			selectedNodes: Set<string>;
			hoveredNodeId: string | null;
			draggedNodeId: string | null;
			focusedClusters: Set<number>;
			pinnedNodes: Set<string>;
			isForceMode: boolean;
			hoverAlphas: Map<string, number>;
			nodeClusterMap: Map<string, number | undefined>;
		},
	): void {
		const nodeIds = new Set(nodes.map((n) => n.id));
		const c = this._theme;
		const scale = this.viewport.scaled || 1;

		// Remove stale nodes
		for (const [id, gfx] of this.nodeGraphicsMap) {
			if (!nodeIds.has(id)) {
				this.nodeLayer.removeChild(gfx);
				gfx.destroy();
				this.nodeGraphicsMap.delete(id);
				this.nodeVisualCache.delete(id);
			}
		}

		// Create or update nodes
		for (const node of nodes) {
			let gfx = this.nodeGraphicsMap.get(node.id);
			let isNew = false;
			if (!gfx) {
				gfx = new Graphics();
				gfx.eventMode = "static";
				gfx.cursor = "pointer";
				this.nodeLayer.addChild(gfx);
				this.nodeGraphicsMap.set(node.id, gfx);
				isNew = true;
			}

			// Always update position + alpha (cheap)
			gfx.position.set(node.x, node.y);
			const alpha = opts.hoverAlphas.get(node.id) ?? 0.85;
			gfx.alpha = alpha;

			// Compute visual state
			const base = Math.max(1, nodeSize);
			const degree = node.degree ?? 0;
			const radius = base + Math.min(Math.log1p(degree) * 2.5, base * 5);
			const rawFill = node.highlighted ? c.accent : (node.color ?? c.graphNode);
			// Resolve hsl()/calc() colors to hex so Pixi.js can parse them
			const fillColor = rawFill.startsWith("#") ? rawFill : resolveColor(rawFill, c.graphNode);

			const isSelected = opts.selectedNodes.has(node.id);
			const isHovered = opts.hoveredNodeId === node.id;
			let strokeColor: string | null = null;
			let strokeWidth = 0;
			if (isSelected) {
				strokeColor = c.accent;
				strokeWidth = 3 / scale;
			} else if (node.highlighted || isHovered) {
				strokeColor = isHovered ? c.textNormal : c.accent;
				strokeWidth = 2 / scale;
			}

			const pinned = opts.isForceMode && opts.pinnedNodes.has(node.id);

			// Check cache — skip geometry rebuild if nothing visual changed
			const cached = this.nodeVisualCache.get(node.id);
			const geometryDirty =
				isNew ||
				!cached ||
				cached.radius !== radius ||
				cached.fillColor !== fillColor ||
				cached.strokeColor !== strokeColor ||
				cached.strokeWidth !== strokeWidth ||
				cached.pinned !== pinned;

			if (geometryDirty) {
				gfx.clear();
				gfx.circle(0, 0, radius).fill({ color: fillColor });

				if (strokeColor) {
					gfx.circle(0, 0, radius).stroke({ color: strokeColor, width: strokeWidth });
				}

				if (pinned) {
					const pinR = Math.max(2 / scale, 1);
					gfx.circle(0, 0, pinR).fill({ color: c.textOnAccent });
				}

				gfx.hitArea = {
					contains: (px: number, py: number) => px * px + py * py <= (radius + 4 / scale) ** 2,
				};

				this.nodeVisualCache.set(node.id, { radius, fillColor, strokeColor, strokeWidth, pinned });
			}
		}
	}

	/** Get the Graphics object for a node ID. */
	getNodeGfx(id: string): Graphics | undefined {
		return this.nodeGraphicsMap.get(id);
	}

	// ── Edge rendering ─────────────────────────────────────

	/**
	 * Redraw all edges. Called when edges change or hover state changes.
	 */
	drawEdges(
		edges: Array<{
			source: { id: string; x: number; y: number };
			target: { id: string; x: number; y: number };
			type: string;
		}>,
		opts: {
			showWikiLinks: boolean;
			hoveredNodeId: string | null;
			adjacency: Map<string, Set<string>>;
			focusedClusters: Set<number>;
			selectedNodes: Set<string>;
			hoverAlphas: Map<string, number>;
			edgeFadeAlpha: number;
			nodeClusterMap: Map<string, number | undefined>;
		},
	): void {
		const g = this.edgeGraphics;
		g.clear();

		if (!opts.showWikiLinks) return;

		const c = this._theme;
		const scale = this.viewport.scaled || 1;
		const normalWidth = 0.5 / scale;
		const highlightWidth = 2 / scale;

		// Batch edges by style bucket to minimize draw calls.
		// Key: "color|width|alpha" → list of segments
		const buckets = new Map<string, Array<{ sx: number; sy: number; tx: number; ty: number }>>();

		for (const edge of edges) {
			const sx = edge.source.x;
			const sy = edge.source.y;
			const tx = edge.target.x;
			const ty = edge.target.y;
			if (sx == null || sy == null || tx == null || ty == null) continue;

			const sourceCluster = opts.nodeClusterMap.get(edge.source.id);
			const targetCluster = opts.nodeClusterMap.get(edge.target.id);

			const inFocus =
				opts.focusedClusters.size === 0 ||
				(sourceCluster != null && opts.focusedClusters.has(sourceCluster)) ||
				(targetCluster != null && opts.focusedClusters.has(targetCluster));

			const inSelection =
				opts.selectedNodes.size === 0 ||
				(opts.selectedNodes.has(edge.source.id) && opts.selectedNodes.has(edge.target.id));

			const isHighlighted =
				opts.hoveredNodeId != null &&
				(edge.source.id === opts.hoveredNodeId || edge.target.id === opts.hoveredNodeId);

			const edgeHoverAlpha = opts.hoveredNodeId
				? Math.max(opts.hoverAlphas.get(edge.source.id) ?? 0.85, opts.hoverAlphas.get(edge.target.id) ?? 0.85)
				: 1;

			const rawAlpha =
				(!inFocus ? 0.05 : !inSelection ? 0.05 : isHighlighted ? 0.9 : 0.25) *
				opts.edgeFadeAlpha *
				(isHighlighted ? 1 : edgeHoverAlpha / 0.85);

			// Quantize alpha to reduce unique buckets (round to nearest 0.05)
			const alpha = Math.round(rawAlpha * 20) / 20;

			const color = isHighlighted ? c.accent : c.textFaint;
			const width = isHighlighted ? highlightWidth : normalWidth;

			const key = `${color}|${width.toFixed(4)}|${alpha}`;
			let bucket = buckets.get(key);
			if (!bucket) {
				bucket = [];
				buckets.set(key, bucket);
			}
			bucket.push({ sx, sy, tx, ty });
		}

		// Draw each bucket as a single batched stroke
		for (const [key, segments] of buckets) {
			const [color, widthStr, alphaStr] = key.split("|");
			const width = Number(widthStr);
			const alpha = Number(alphaStr);

			for (const seg of segments) {
				g.moveTo(seg.sx, seg.sy);
				g.lineTo(seg.tx, seg.ty);
			}
			g.stroke({ color, width, alpha });
		}
	}

	// ── Label rendering ────────────────────────────────────

	/**
	 * Update visible labels using the object pool.
	 * Caller provides the list of nodes that should have labels, already
	 * sorted by priority and filtered by occlusion.
	 */
	drawLabels(
		labels: Array<{
			nodeX: number;
			nodeY: number;
			text: string;
			color: string;
			alpha: number;
			fontSize: number;
		}>,
	): void {
		const scale = this.viewport.scaled || 1;
		let i = 0;

		for (const label of labels) {
			if (i >= this.LABEL_POOL_SIZE) break;
			const t = this.labelPool[i];
			t.text = label.text;
			t.position.set(label.nodeX, label.nodeY);
			t.style.fontSize = label.fontSize;
			t.style.fill = label.color;
			t.style.fontFamily = this._theme.font;
			t.alpha = label.alpha;
			t.scale.set(1 / scale); // Counter-scale so labels appear fixed-size in screen space
			t.visible = true;
			i++;
		}

		// Hide unused pool members
		for (; i < this.LABEL_POOL_SIZE; i++) {
			this.labelPool[i].visible = false;
		}
		this.activeLabelCount = labels.length;
	}

	// ── Lasso rendering ────────────────────────────────────

	drawLasso(points: Array<{ x: number; y: number }>): void {
		const g = this.lassoGraphics;
		g.clear();
		if (points.length < 2) return;

		const c = this._theme;
		const scale = this.viewport.scaled || 1;

		// Fill
		const flatPoints = points.flatMap((p) => [p.x, p.y]);
		g.poly(flatPoints, true).fill({ color: c.accent, alpha: 0.08 });

		// Dashed stroke
		const dash = 4 / scale;
		const gap = 4 / scale;
		for (let i = 0; i < points.length; i++) {
			const a = points[i];
			const b = points[(i + 1) % points.length];
			drawDashedLine(g, a.x, a.y, b.x, b.y, dash, gap);
		}
		g.stroke({ color: c.accent, width: 2 / scale, alpha: 0.6 });
	}

	clearLasso(): void {
		this.lassoGraphics.clear();
	}

	// ── Cluster anchor pills (screen-space) ────────────────

	drawClusterPills(
		placements: Array<{
			cluster: number;
			nodeScreenX: number;
			nodeScreenY: number;
			x: number;
			y: number;
			pillW: number;
			pillH: number;
			text: string;
			color: string;
			isFocused: boolean;
		}>,
	): ClusterPillHit[] {
		const c = this._theme;
		const hitAreas: ClusterPillHit[] = [];

		// Ensure we have enough pill objects
		while (this.clusterPillObjects.length < placements.length) {
			const container = new Container();
			const graphics = new Graphics();
			const text = new Text({
				text: "",
				style: new TextStyle({
					fontFamily: c.font,
					fontSize: 11,
					fontWeight: "600",
					fill: c.textNormal,
				}),
			});
			text.anchor.set(0, 0.5);
			container.addChild(graphics);
			container.addChild(text);
			this.clusterPillLayer.addChild(container);
			this.clusterPillObjects.push({ container, graphics, text });
		}

		// Hide excess
		for (let i = placements.length; i < this.clusterPillObjects.length; i++) {
			this.clusterPillObjects[i].container.visible = false;
		}

		for (let i = 0; i < placements.length; i++) {
			const p = placements[i];
			const obj = this.clusterPillObjects[i];
			obj.container.visible = true;

			const g = obj.graphics;
			g.clear();

			// Resolve cluster color to hex for Pixi
			const pillColor = p.color.startsWith("#") ? p.color : resolveColor(p.color, c.accent);

			// Leader line (dashed) if pill drifted from node
			const pillCenterX = p.x + p.pillW / 2;
			const pillCenterY = p.y + p.pillH / 2;
			const dist = Math.sqrt((pillCenterX - p.nodeScreenX) ** 2 + (pillCenterY - p.nodeScreenY) ** 2);
			if (dist > p.pillW * 0.6) {
				drawDashedLine(g, pillCenterX, pillCenterY, p.nodeScreenX, p.nodeScreenY, 3, 3);
				g.stroke({ color: pillColor, width: 0.75, alpha: p.isFocused ? 0.5 : 0.25 });
			}

			// Pill background
			g.roundRect(p.x, p.y, p.pillW, p.pillH, 999);
			g.fill({ color: c.bgPrimary, alpha: p.isFocused ? 0.96 : 0.88 });
			g.stroke({ color: pillColor, width: p.isFocused ? 1.75 : 1 });

			// Text
			obj.text.text = p.text;
			obj.text.style.fill = c.textNormal;
			obj.text.style.fontFamily = c.font;
			obj.text.position.set(p.x + 8, p.y + p.pillH / 2 + 0.5);

			// Truncate text if needed
			const maxTextW = p.pillW - 16;
			if (obj.text.width > maxTextW) {
				// Simple truncation via Pixi — adjust text
				let txt = p.text;
				while (txt.length > 1) {
					txt = txt.slice(0, -1);
					obj.text.text = txt + "…";
					if (obj.text.width <= maxTextW) break;
				}
			}

			hitAreas.push({ x: p.x, y: p.y, w: p.pillW, h: p.pillH, cluster: p.cluster });
		}

		return hitAreas;
	}

	// ── Edge legend (screen-space) ─────────────────────────

	drawEdgeLegend(showWikiLinks: boolean): EdgeLegendHit {
		const c = this._theme;
		const lx = 16;
		const ly = this._height - 40;
		const rowH = 18;

		this.legendContainer.position.set(0, 0);
		const g = this.legendGraphics;
		g.clear();

		const alpha = showWikiLinks ? 0.7 : 0.25;

		// Wiki link line (solid)
		g.moveTo(lx, ly).lineTo(lx + 28, ly);
		g.stroke({ color: c.textFaint, width: 1.5, alpha });

		// Strikethrough when disabled
		if (!showWikiLinks) {
			const textW = 50; // approximate "Wiki link" width
			g.moveTo(lx + 34, ly).lineTo(lx + 34 + textW, ly);
			g.stroke({ color: c.textMuted, width: 1, alpha: 0.25 });
		}

		this.legendText.position.set(lx + 34, ly);
		this.legendText.alpha = alpha;
		this.legendText.style.fill = c.textMuted;

		return { x: lx, y: ly - rowH / 2, w: 120, h: rowH, type: "wiki" };
	}

	// ── Node tooltip (screen-space) ────────────────────────

	showNodeTooltip(
		node: { label: string; cluster?: number; degree?: number; id: string; x: number; y: number },
		clusterLabels: Record<number, string>,
		isPinned: boolean,
		isForceMode: boolean,
	): void {
		const c = this._theme;
		const sx = this.viewport.toScreen(node.x, node.y).x;
		const sy = this.viewport.toScreen(node.x, node.y).y;

		const lines: string[] = [node.label];
		if (node.cluster != null) {
			const clusterLabel = clusterLabels[node.cluster] ?? `Cluster ${node.cluster}`;
			lines.push(`${clusterLabel}  ·  ${node.degree ?? 0} connections`);
		} else {
			lines.push(`${node.degree ?? 0} connections`);
		}
		if (isForceMode && isPinned) {
			lines.push("📌 Pinned");
		}

		const fontSize = 11;
		const lineH = 16;
		const padX = 10;
		const padY = 8;

		// Measure widths
		let maxW = 0;
		for (let i = 0; i < lines.length && i < this.tooltipTexts.length; i++) {
			this.tooltipTexts[i].text = lines[i];
			this.tooltipTexts[i].style.fontSize = fontSize;
			this.tooltipTexts[i].style.fontWeight = i === 0 ? "bold" : "normal";
			this.tooltipTexts[i].style.fill = i === 0 ? c.textNormal : c.textMuted;
			this.tooltipTexts[i].visible = true;
			const w = this.tooltipTexts[i].width;
			if (w > maxW) maxW = w;
		}
		// Hide unused lines
		for (let i = lines.length; i < this.tooltipTexts.length; i++) {
			this.tooltipTexts[i].visible = false;
		}

		const boxW = maxW + padX * 2;
		const boxH = lines.length * lineH + padY * 2;

		// Position: right of node, flip if near edge
		let bx = sx + 14;
		if (bx + boxW > this._width - 8) bx = sx - boxW - 14;
		const by = sy - boxH / 2;

		this.tooltipGraphics.clear();
		this.tooltipGraphics.roundRect(bx, by, boxW, boxH, 6);
		this.tooltipGraphics.fill({ color: c.bgPrimary, alpha: 0.92 });
		this.tooltipGraphics.stroke({ color: c.textFaint, width: 0.5 });

		for (let i = 0; i < lines.length && i < this.tooltipTexts.length; i++) {
			this.tooltipTexts[i].position.set(bx + padX, by + padY + i * lineH);
		}

		this.tooltipContainer.visible = true;
	}

	hideTooltip(): void {
		this.tooltipContainer.visible = false;
	}

	// ── World-to-screen conversion ─────────────────────────

	worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
		const pt = this.viewport.toScreen(worldX, worldY);
		return { x: pt.x, y: pt.y };
	}
}
