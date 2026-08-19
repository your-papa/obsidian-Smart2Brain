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

/** Blend fg over bg at the given alpha, returning a fully-opaque hex color.
 *  Prevents semi-transparent edges from stacking into a bright hotspot near nodes. */
function blendColor(fg: string, bg: string, alpha: number): string {
	const safeAlpha = clampUnitInterval(alpha, 1);
	const [pr, pg, pb] = parseHexColorChannels(fg, [255, 255, 255]);
	const [br, bg_, bb] = parseHexColorChannels(bg, [0, 0, 0]);
	const r = Math.round(br + (pr - br) * safeAlpha);
	const g = Math.round(bg_ + (pg - bg_) * safeAlpha);
	const b = Math.round(bb + (pb - bb) * safeAlpha);
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function clampUnitInterval(value: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(1, Math.max(0, value));
}

function parseHexColorChannels(color: string, fallback: [number, number, number]): [number, number, number] {
	if (!color.startsWith("#") || color.length !== 7) return fallback;
	const red = Number.parseInt(color.slice(1, 3), 16);
	const green = Number.parseInt(color.slice(3, 5), 16);
	const blue = Number.parseInt(color.slice(5, 7), 16);
	if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) {
		return fallback;
	}
	return [red, green, blue];
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

// ── Renderer ─────────────────────────────────────────────────

export class PixiRenderer {
	// Pixi core
	private app!: Application;
	private viewport!: Viewport;
	private containerEl!: HTMLElement;

	// Layers (world-space, inside viewport)
	private hullLayer!: Container;
	private edgeLayer!: Container;
	private nodeLayer!: Container;
	private labelLayer!: Container;
	private lassoLayer!: Container;

	// Overlay (screen-space, outside viewport)
	private overlayStage!: Container;
	private clusterPillLayer!: Container;
	private tooltipLayer!: Container;

	// Display objects
	private hullGraphics!: Graphics;
	private edgeGraphics!: Graphics;
	private lassoGraphics!: Graphics;
	private nodeGraphicsMap: Map<string, Graphics> = new Map();

	// Cached visual state per node — skip geometry rebuild when unchanged
	private nodeVisualCache: Map<
		string,
		{
			radius: number;
			fillColor: string;
			fillAlpha: number;
			strokeColor: string | null;
			strokeAlpha: number;
			strokeWidth: number;
		}
	> = new Map();

	// Label pool
	private labelPool: Text[] = [];
	private activeLabelCount = 0;
	private readonly LABEL_POOL_SIZE = 250;
	// Last-written values per pool slot — used to skip redundant property updates
	private labelPoolCache: Array<{
		text: string;
		nodeX: number;
		nodeY: number;
		fontSize: number;
		color: string;
		alpha: number;
		scale: number;
	} | null> = [];

	// Overlay objects
	private clusterPillObjects: Array<{ container: Container; graphics: Graphics; text: Text }> = [];
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
			passiveWheel: true,
		});
		this.app.stage.addChild(this.viewport);

		this.viewport
			.drag()
			.pinch()
			.wheel({ smooth: 5, trackpadPinch: true })
			.decelerate({ friction: 0.92 })
			.animate({})
			.clampZoom({
				minScale: 0.05,
				maxScale: 10,
			});

		// Fire callback when viewport moves (pan/zoom/pinch/decelerate)
		this.viewport.on("moved", () => {
			this._onViewportMoved?.();
		});

		// World-space layers (inside viewport). Hulls sit at the bottom so topic
		// regions read as background, never over edges or nodes.
		this.hullLayer = new Container();
		this.edgeLayer = new Container();
		this.nodeLayer = new Container();
		this.labelLayer = new Container();
		this.lassoLayer = new Container();
		this.viewport.addChild(this.hullLayer);
		this.viewport.addChild(this.edgeLayer);
		this.viewport.addChild(this.nodeLayer);
		this.viewport.addChild(this.labelLayer);
		this.viewport.addChild(this.lassoLayer);

		// Hull graphics (single batched)
		this.hullGraphics = new Graphics();
		this.hullLayer.addChild(this.hullGraphics);

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
		this.tooltipLayer = new Container();
		this.overlayStage.addChild(this.clusterPillLayer);
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
			this.labelPoolCache.push(null);
		}

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
		// Invalidate label cache so font/color changes are picked up on the next draw
		this.labelPoolCache.fill(null);
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

	/** Cancel any running camera animation (e.g. when the user starts panning). */
	abortAnimation(): void {
		this.viewport.plugins.remove("animate");
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
		nodes: Array<{
			id: string;
			x: number;
			y: number;
			color?: string;
			degree?: number;
			highlighted?: boolean;
			centrality?: number;
		}>,
		nodeSize: number,
		opts: {
			selectedNodes: Set<string>;
			hoveredNodeId: string | null;
			draggedNodeId: string | null;
			focusedClusters: Set<number>;
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
			gfx.alpha = 1;

			// Compute visual state
			const base = Math.max(1, nodeSize);
			const degree = node.degree ?? 0;
			const radius = base + Math.min(Math.log1p(degree) * 2.5, base * 5);
			const rawFill = node.highlighted ? c.accent : (node.color ?? c.graphNode);
			// Resolve hsl()/calc() colors to hex so Pixi.js can parse them
			const resolvedFillColor = rawFill.startsWith("#") ? rawFill : resolveColor(rawFill, c.graphNode);
			const fillColor = alpha < 1 ? blendColor(resolvedFillColor, c.bgPrimary, alpha) : resolvedFillColor;

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
			const strokeAlpha = strokeColor ? alpha : 1;
			const blendedStrokeColor =
				strokeColor && strokeAlpha < 1 ? blendColor(strokeColor, c.bgPrimary, strokeAlpha) : strokeColor;

			// Check cache — skip geometry rebuild if nothing visual changed
			const cached = this.nodeVisualCache.get(node.id);
			const geometryDirty =
				isNew ||
				!cached ||
				cached.radius !== radius ||
				cached.fillColor !== fillColor ||
				cached.fillAlpha !== alpha ||
				cached.strokeColor !== blendedStrokeColor ||
				cached.strokeAlpha !== strokeAlpha ||
				cached.strokeWidth !== strokeWidth;

			if (geometryDirty) {
				gfx.clear();

				gfx.circle(0, 0, radius).fill({ color: fillColor });

				if (blendedStrokeColor) {
					gfx.circle(0, 0, radius).stroke({ color: blendedStrokeColor, width: strokeWidth });
				}

				gfx.hitArea = {
					contains: (px: number, py: number) => px * px + py * py <= (radius + 4 / scale) ** 2,
				};

				this.nodeVisualCache.set(node.id, {
					radius,
					fillColor,
					fillAlpha: alpha,
					strokeColor: blendedStrokeColor,
					strokeAlpha,
					strokeWidth,
				});
			}
		}
	}

	/** Get the Graphics object for a node ID. */
	getNodeGfx(id: string): Graphics | undefined {
		return this.nodeGraphicsMap.get(id);
	}

	// ── Hull rendering ─────────────────────────────────────

	/**
	 * Draw a tinted region behind each topic.
	 *
	 * Colour alone makes grouping hard to read once topics interleave — a region
	 * gives each one a visible extent, so hierarchy is legible at any zoom rather
	 * than inferred from dot colours.
	 *
	 * Paths arrive already smoothed and padded in world space
	 * ({@link buildTopicRegion}); this only fills and strokes them.
	 */
	drawHulls(
		hulls: Array<{ cluster: number; color: string; path: Array<{ x: number; y: number }> }>,
		opts: {
			focusedClusters: Set<number>;
			fadeAlpha: number;
			/**
			 * Hull shapes from the previous topic grouping, drawn underneath at
			 * `outgoingAlpha`. Zoom changes reassign every cluster id at once, so
			 * there is no stable identity to tween between — cross-fading the two
			 * sets turns that hard cut into a dissolve.
			 */
			outgoing?: Array<{ cluster: number; color: string; path: Array<{ x: number; y: number }> }>;
			outgoingAlpha?: number;
		},
	): void {
		const g = this.hullGraphics;
		g.clear();

		const outgoing = opts.outgoing ?? [];
		const outgoingAlpha = clampUnitInterval(opts.outgoingAlpha ?? 0, 0);
		if (hulls.length === 0 && outgoing.length === 0) return;

		const c = this._theme;
		const scale = this.viewport.scaled || 1;
		const fade = clampUnitInterval(opts.fadeAlpha, 1);

		const paint = (
			set: Array<{ cluster: number; color: string; path: Array<{ x: number; y: number }> }>,
			multiplier: number,
		) => {
			if (multiplier <= 0) return;
			for (const hull of set) {
				if (hull.path.length < 3) continue;

				// Dim topics outside the focus, matching how nodes and edges behave.
				const isFocused = opts.focusedClusters.size === 0 || opts.focusedClusters.has(hull.cluster);
				const fillAlpha = (isFocused ? 0.1 : 0.02) * fade * multiplier;
				const strokeAlpha = (isFocused ? 0.35 : 0.08) * fade * multiplier;
				if (fillAlpha <= 0 && strokeAlpha <= 0) continue;

				const color = hull.color.startsWith("#") ? hull.color : resolveColor(hull.color, c.accent);

				g.moveTo(hull.path[0].x, hull.path[0].y);
				for (let i = 1; i < hull.path.length; i++) {
					g.lineTo(hull.path[i].x, hull.path[i].y);
				}
				g.closePath();
				g.fill({ color, alpha: fillAlpha });
				// Counter-scale so the outline keeps a constant on-screen weight.
				g.stroke({ color, width: 1.5 / scale, alpha: strokeAlpha });
			}
		};

		// Outgoing first so the incoming grouping reads on top as it resolves.
		paint(outgoing, outgoingAlpha);
		paint(hulls, 1 - outgoingAlpha);
	}

	// ── Edge rendering ─────────────────────────────────────

	/**
	 * Redraw all edges. Called when edges change or hover state changes.
	 */
	drawEdges(
		edges: Array<{
			source: { id: string; x: number; y: number; kind?: string };
			target: { id: string; x: number; y: number; kind?: string };
			type: string;
			weight?: number;
		}>,
		opts: {
			showWikiLinks: boolean;
			showSemanticLinks?: boolean;
			directedWikiEdges?: boolean;
			hoveredNodeId: string | null;
			adjacency: Map<string, Set<string>>;
			focusedClusters: Set<number>;
			selectedNodes: Set<string>;
			hoverAlphas: Map<string, number>;
			edgeFadeAlpha: number;
			baseEdgeAlpha: number;
			nodeClusterMap: Map<string, number | undefined>;
		},
	): void {
		const g = this.edgeGraphics;
		g.clear();

		const showWiki = opts.showWikiLinks;
		const showSemantic = opts.showSemanticLinks !== false;
		if (!showWiki && !showSemantic) return;

		const c = this._theme;
		const scale = this.viewport.scaled || 1;
		const normalWidth = 1.2 / scale;
		const highlightWidth = 1.6 / scale;
		// Inferred edges read as a quieter background layer behind authored links.
		const semanticWidth = 0.9 / scale;
		const semanticAlphaScale = 0.45;
		const dash = 5 / scale;
		const dashGap = 4 / scale;

		// Dashed segments can't share the batched line buckets (each needs its own
		// sub-path walk), so they collect separately and draw underneath.
		const semanticLineBuckets = new Map<string, Array<{ sx: number; sy: number; tx: number; ty: number }>>();

		// Batch edges by style bucket to minimize draw calls.
		// Key: "color|width|alpha" → list of segments
		const normalLineBuckets = new Map<string, Array<{ sx: number; sy: number; tx: number; ty: number }>>();
		const highlightLineBuckets = new Map<string, Array<{ sx: number; sy: number; tx: number; ty: number }>>();
		const normalArrowBuckets = new Map<
			string,
			Array<{ ax: number; ay: number; lx: number; ly: number; rx: number; ry: number }>
		>();
		const highlightArrowBuckets = new Map<
			string,
			Array<{ ax: number; ay: number; lx: number; ly: number; rx: number; ry: number }>
		>();

		for (const edge of edges) {
			const isSemantic = edge.type === "semantic";
			if (isSemantic ? !showSemantic : !showWiki) continue;

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
				? clampUnitInterval(
						Math.max(
							opts.hoverAlphas.get(edge.source.id) ?? 0.85,
							opts.hoverAlphas.get(edge.target.id) ?? 0.85,
						),
						0.85,
					)
				: 1;
			const safeBaseEdgeAlpha = clampUnitInterval(opts.baseEdgeAlpha, 0.25);
			const safeEdgeFadeAlpha = clampUnitInterval(opts.edgeFadeAlpha, 1);

			const rawAlpha =
				(!inFocus ? 0.05 : !inSelection ? 0.05 : isHighlighted ? 0.9 : safeBaseEdgeAlpha) *
				safeEdgeFadeAlpha *
				(isHighlighted ? 1 : edgeHoverAlpha / 0.85) *
				// Fade inferred edges unless they're the ones being hovered, so hovering a
				// note still reveals why it sits where it does.
				(isSemantic && !isHighlighted ? semanticAlphaScale : 1);

			// Quantize alpha to reduce unique buckets (round to nearest 0.05)
			const alpha = clampUnitInterval(Math.round(rawAlpha * 20) / 20, 0);
			if (alpha <= 0) continue;

			const color = isHighlighted ? c.accent : c.graphLine;
			const baseWidth = isHighlighted ? highlightWidth : isSemantic ? semanticWidth : normalWidth;
			// A collapsed topic edge's weight counts how many note-level links cross
			// between the two topics, so thickness is the at-a-glance read of which
			// areas of the vault are actually coupled. Log-scaled: crossing counts
			// are heavy-tailed and a linear map would leave weak pairs invisible.
			const isTopicEdge = edge.source.kind === "topic" || edge.target.kind === "topic";
			const weightScale = isTopicEdge ? Math.min(4, 1 + Math.log2(Math.max(1, edge.weight ?? 1)) * 0.45) : 1;
			const width = baseWidth * weightScale;
			const key = `${color}|${width.toFixed(4)}|${alpha.toFixed(2)}`;

			if (isSemantic) {
				let semanticBucket = semanticLineBuckets.get(key);
				if (!semanticBucket) {
					semanticBucket = [];
					semanticLineBuckets.set(key, semanticBucket);
				}
				semanticBucket.push({ sx, sy, tx, ty });
				// Arrowheads denote authored direction; an inferred similarity has none.
				continue;
			}

			const targetLineBuckets = isHighlighted ? highlightLineBuckets : normalLineBuckets;
			let bucket = targetLineBuckets.get(key);
			if (!bucket) {
				bucket = [];
				targetLineBuckets.set(key, bucket);
			}
			bucket.push({ sx, sy, tx, ty });

			if (opts.directedWikiEdges) {
				const dx = tx - sx;
				const dy = ty - sy;
				const len = Math.hypot(dx, dy);
				if (len > 0.0001) {
					const ux = dx / len;
					const uy = dy / len;
					const arrowLength = isHighlighted ? Math.max(7 / scale, width * 5) : 11;
					const arrowWidth = isHighlighted ? Math.max(4 / scale, width * 2.6) : 5.5;
					const tipInset = isHighlighted ? Math.max(width * 1.5, 2 / scale) : 3;
					const ax = tx - ux * tipInset;
					const ay = ty - uy * tipInset;
					const baseX = ax - ux * arrowLength;
					const baseY = ay - uy * arrowLength;
					const perpX = -uy;
					const perpY = ux;
					const targetArrowBuckets = isHighlighted ? highlightArrowBuckets : normalArrowBuckets;
					let arrows = targetArrowBuckets.get(key);
					if (!arrows) {
						arrows = [];
						targetArrowBuckets.set(key, arrows);
					}
					arrows.push({
						ax,
						ay,
						lx: baseX + perpX * arrowWidth,
						ly: baseY + perpY * arrowWidth,
						rx: baseX - perpX * arrowWidth,
						ry: baseY - perpY * arrowWidth,
					});
				}
			}
		}

		const drawLineBuckets = (buckets: Map<string, Array<{ sx: number; sy: number; tx: number; ty: number }>>) => {
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
		};

		const drawArrowBuckets = (
			buckets: Map<string, Array<{ ax: number; ay: number; lx: number; ly: number; rx: number; ry: number }>>,
		) => {
			for (const [key, arrows] of buckets) {
				const [color, , alphaStr] = key.split("|");
				const alpha = Number(alphaStr);
				for (const arrow of arrows) {
					g.moveTo(arrow.ax, arrow.ay);
					g.lineTo(arrow.lx, arrow.ly);
					g.lineTo(arrow.rx, arrow.ry);
					g.closePath();
				}
				g.fill({ color, alpha });
			}
		};

		const drawDashedBuckets = (buckets: Map<string, Array<{ sx: number; sy: number; tx: number; ty: number }>>) => {
			for (const [key, segments] of buckets) {
				const [color, widthStr, alphaStr] = key.split("|");
				const width = Number(widthStr);
				const alpha = Number(alphaStr);

				for (const seg of segments) {
					drawDashedLine(g, seg.sx, seg.sy, seg.tx, seg.ty, dash, dashGap);
				}
				g.stroke({ color, width, alpha });
			}
		};

		// Inferred edges sit underneath, then authored links, then hovered connections
		// last so dim edges/arrows never sit on top of them.
		drawDashedBuckets(semanticLineBuckets);
		drawLineBuckets(normalLineBuckets);
		if (opts.directedWikiEdges) {
			drawArrowBuckets(normalArrowBuckets);
		}
		drawLineBuckets(highlightLineBuckets);
		if (opts.directedWikiEdges) {
			drawArrowBuckets(highlightArrowBuckets);
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
		const invScale = 1 / scale;
		const font = this._theme.font;
		let i = 0;

		for (const label of labels) {
			if (i >= this.LABEL_POOL_SIZE) break;
			const t = this.labelPool[i];
			const prev = this.labelPoolCache[i];

			// Position and scale change every force-tick — always update these
			t.position.set(label.nodeX, label.nodeY);
			t.scale.set(invScale);
			t.alpha = label.alpha;
			t.visible = true;

			// Text and style only change when the label itself changes
			if (
				prev === null ||
				prev.text !== label.text ||
				prev.fontSize !== label.fontSize ||
				prev.color !== label.color
			) {
				t.text = label.text;
				t.style.fontSize = label.fontSize;
				t.style.fill = label.color;
				t.style.fontFamily = font;
			}

			this.labelPoolCache[i] = {
				text: label.text,
				nodeX: label.nodeX,
				nodeY: label.nodeY,
				fontSize: label.fontSize,
				color: label.color,
				alpha: label.alpha,
				scale: invScale,
			};
			i++;
		}

		// Hide pool slots that were active last frame but aren't needed now
		const prevActive = this.activeLabelCount;
		for (let j = i; j < prevActive; j++) {
			this.labelPool[j].visible = false;
			this.labelPoolCache[j] = null;
		}
		this.activeLabelCount = i;
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
					obj.text.text = `${txt}…`;
					if (obj.text.width <= maxTextW) break;
				}
			}

			hitAreas.push({ x: p.x, y: p.y, w: p.pillW, h: p.pillH, cluster: p.cluster });
		}

		return hitAreas;
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
