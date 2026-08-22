/**
 * Canonical edge key for deduplication.
 * Sorts the two node IDs so that edgeKey(a, b) === edgeKey(b, a).
 */
export function edgeKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/**
 * Inverse of {@link edgeKey} — recover the two node IDs from a canonical key.
 * Safe because `\0` cannot occur in a vault path.
 */
export function splitEdgeKey(key: string): [string, string] {
	const separator = key.indexOf("\0");
	if (separator === -1) return [key, key];
	return [key.slice(0, separator), key.slice(separator + 1)];
}

/**
 * Ceiling (in world px, on top of the base size) that a collapsed topic's
 * radius approaches asymptotically as its connection count grows.
 */
const TOPIC_RADIUS_CEILING = 26;
/**
 * √degree at which a topic reaches half the ceiling. Chosen so the everyday
 * range differentiates most: half size at ~320 crossing links, with real
 * growth still visible out past a few thousand.
 */
const TOPIC_RADIUS_HALF_POINT = 18;

/**
 * Draw radius for a graph node, from its degree and the auto-tuned base size.
 *
 * Size encodes exactly one thing — connectedness — so it stays unambiguous.
 * The single source of truth shared by the canvas (hit-testing, collision
 * spacing, label offsets) and the Pixi renderer (sprite/ring radius); the two
 * must agree or hover targets drift off the drawn circles.
 *
 * Notes use a log curve under a hard cap: their degrees are small and
 * heavy-tailed, and past a point "very connected" is all a size can say.
 * Collapsed topics get their own curve because their degree is a *crossing
 * link count* spanning a few to several thousand — under the note formula
 * everything past ~55 links saturated, so a 180-note and a 2000-note topic
 * rendered identically. A smooth saturating curve over √degree keeps every
 * doubling of connections visible while approaching the ceiling
 * asymptotically instead of hitting it.
 */
/**
 * Auto-tuned base node radius from how many notes the graph *represents* —
 * larger for small vaults, smaller for dense ones, on a continuous log scale.
 * A collapsed topic counts as its members, not as one node, so folding doesn't
 * change the sizing regime (see the canvas's representedNoteCount).
 */
export function autoNodeSize(representedNoteCount: number): number {
	return Math.max(2, Math.round(7 - Math.log10(Math.max(representedNoteCount, 10)) * 1.8));
}

export function nodeDrawRadius(node: { degree?: number; kind?: string }, nodeSize: number): number {
	const base = Math.max(1, nodeSize);
	const degree = Math.max(0, node.degree ?? 0);
	if (node.kind === "topic") {
		const spread = Math.sqrt(degree);
		return base + TOPIC_RADIUS_CEILING * (spread / (spread + TOPIC_RADIUS_HALF_POINT));
	}
	return base + Math.min(Math.log1p(degree) * 2.5, base * 5);
}

/** Visible-node count at which the density spread factor is exactly 1. */
const SPREAD_REFERENCE_NODES = 400;
/** Compaction floor for very large graphs. */
const SPREAD_FACTOR_MIN = 0.65;
/**
 * Spread ceiling — reached only by the sparsest graphs via the extra boost
 * below {@link SPARSE_SPREAD_BOOST_NODES}.
 */
const SPREAD_FACTOR_MAX = 4.5;

/**
 * Below this node count an extra spread boost kicks in on top of the base
 * ¼-power curve.
 *
 * The base curve is sized for note-level graphs; on a collapsed view of a
 * handful of topics it tops out around 2.5×, which still lays 8 topics out in
 * ~300 world px — a knot the overview zoom cap then refuses to magnify, so
 * most of the viewport stays white. The layout has to be bigger in *world*
 * units: no camera policy can fill a screen with a knot without inflating
 * nodes into discs. The boost is continuous at the threshold (its factor is
 * exactly 1 there).
 */
const SPARSE_SPREAD_BOOST_NODES = 60;
const SPARSE_SPREAD_BOOST_EXPONENT = 0.35;

/**
 * Base spread multiplier from how many nodes are on screen — the raw signal
 * behind {@link densityForceProfile}, which maps it onto each force.
 *
 * Fit zoom is roughly `viewport / (spacing × √n)`, so with constant spacing a
 * large graph forces the camera far out (nodes shrink to dust) while a small
 * one huddles in a blob the camera merely magnifies. Scaling spacing by
 * `(reference / n)^¼` splits the burden: big graphs compact, small graphs
 * spread into the room they have — deliberately gentler than the `1/√n` that
 * would hold fit zoom constant, because {@link zoomNodeScale} carries the
 * other half by keeping far-out nodes visible. Clamped so the extremes can't
 * push the tuned force balance into a regime it was never tested in.
 */
export function densitySpreadFactor(visibleNodeCount: number): number {
	const count = Math.max(1, visibleNodeCount);
	let factor = (SPREAD_REFERENCE_NODES / count) ** 0.25;
	if (count < SPARSE_SPREAD_BOOST_NODES) {
		factor *= (SPARSE_SPREAD_BOOST_NODES / count) ** SPARSE_SPREAD_BOOST_EXPONENT;
	}
	return Math.min(SPREAD_FACTOR_MAX, Math.max(SPREAD_FACTOR_MIN, factor));
}

/**
 * Node count below which centering starts easing off, reaching its floor at a
 * handful of nodes. Sized so a typical collapsed view (a dozen or two topics)
 * opens up, while anything approaching a real note-level graph is untouched.
 */
const SPARSE_CENTER_RELAX_NODES = 60;
/** How weak the centering may get on the sparsest graphs. */
const SPARSE_CENTER_RELAX_FLOOR = 0.35;

/** Per-force multipliers derived from the visible-node density. */
export interface DensityForceProfile {
	/** Link distance — spacing of the connected structure. */
	spacing: number;
	/** Charge strength. */
	charge: number;
	/** Centering force. */
	center: number;
	/** Cluster cohesion. */
	cohesion: number;
}

/**
 * How each layout force scales with graph density.
 *
 * One uniform factor compacts everything equally, but the two length scales
 * want opposite treatment: on a large vault the *between-cluster* gaps should
 * shrink while the *inside* of each cluster gets room to breathe (a uniform
 * squeeze produced tight solid blobs floating far apart). So the forces that
 * act on only one of the scales carry the asymmetry:
 *
 * - **spacing** follows the spread factor directly.
 * - **charge** follows √spread when spreading and spread^0.35 when
 *   compacting — charge acts on both scales at once
 *   (it separates notes within a cluster *and* pushes clusters apart), so
 *   scaling it fully squeezed cluster interiors on big graphs and flung
 *   unlinked satellites to the horizon on small ones. Softened, it keeps more
 *   note-to-note breathing room at high density and calmer satellites at low.
 * - **center** strengthens on dense graphs, supra-quadratically in the
 *   compaction (exponent 2.5, capped 2.2× — the cap was 2.8 until the layout
 *   benchmark showed the extra pull compressing cluster *interiors* about as
 *   hard as cohesion itself, right when gaps sat at the tight end of their
 *   band already) — it's the only inward force an
 *   unlinked node feels, and negligible against local forces inside a
 *   cluster, so it closes inter-cluster gaps without compressing anything.
 *   Steep because the pull must *outpace* the compaction: a linear response
 *   barely engaged before the spread floor bound it, and clusters still
 *   floated far apart. Below the reference density it relaxes instead
 *   (floored at 0.55): on a sparse graph centering is what holds the few
 *   nodes in a knot, and there is no crowding for it to counteract.
 * - **cohesion** relaxes on dense graphs, faster than spacing (spread^1.8,
 *   floored at 0.4) — it is the intra-cluster crush, and letting clusters
 *   expand fills the very gaps the center pull is closing. Never strengthened
 *   above 1×.
 *
 * All multipliers are exactly 1 at the reference density, so the tuned
 * defaults are the behaviour at "normal" vault size.
 */
export function densityForceProfile(visibleNodeCount: number): DensityForceProfile {
	const spread = densitySpreadFactor(visibleNodeCount);
	// Node count, not the spread factor, decides which side of the reference
	// density we are on: `spread` saturates at both clamps, so comparing it
	// against 1 misclassifies every graph past a clamp.
	const isSparse = visibleNodeCount < SPREAD_REFERENCE_NODES;
	return {
		spacing: spread,
		// Asymmetric: small graphs keep the stronger √spread (their satellites
		// and sparse clusters need real repulsion to spread out), dense graphs
		// get the gentler power (their interiors must not be squeezed as hard
		// as the global structure compacts).
		charge: isSparse ? Math.sqrt(spread) : spread ** 0.35,
		// Very sparse graphs relax the centering: it is the force holding a
		// handful of nodes in a knot, and there is no crowding for it to
		// counteract. Only below SPARSE_CENTER_RELAX_NODES, and floored, so a
		// small graph still reads as one object rather than a scatter.
		center: isSparse
			? Math.max(SPARSE_CENTER_RELAX_FLOOR, Math.min(1, visibleNodeCount / SPARSE_CENTER_RELAX_NODES))
			: Math.min(2.2, (1 / spread) ** 2.5),
		cohesion: Math.min(1, Math.max(0.4, spread ** 1.8)),
	};
}

/** How strongly node radii resist the camera zoom (0 = not at all, 1 = fully). */
const NODE_ZOOM_EXPONENT = 0.28;
const NODE_ZOOM_SCALE_MIN = 1 / 3;
const NODE_ZOOM_SCALE_MAX = 4;

/**
 * Partial counter-zoom for node radii: the drawn radius is multiplied by
 * `viewportScale^-0.28`, so on screen nodes scale with `zoom^0.72` instead of
 * linearly. (Higher exponents made nodes visually crowd into each other at
 * overview zoom, reading as cramped clusters even where the layout had room.)
 *
 * Edges and labels already counter-scale fully — nodes were the only element
 * shrinking 1:1 with zoom-out, which is why a fitted large vault read as
 * "edges with no nodes". Partial (rather than full) so zoom still conveys
 * depth: zoomed far out nodes stay visible, zoomed far in they stop
 * ballooning. Exactly 1 at unit zoom, so the tuned world-space sizes are
 * unchanged where layout and camera agree. Render/hit-test only — the physics
 * (collide spacing) must never see a camera-dependent radius.
 */
export function zoomNodeScale(viewportScale: number): number {
	if (!Number.isFinite(viewportScale) || viewportScale <= 0) return 1;
	const factor = viewportScale ** -NODE_ZOOM_EXPONENT;
	return Math.min(NODE_ZOOM_SCALE_MAX, Math.max(NODE_ZOOM_SCALE_MIN, factor));
}

/** Zoom at and below which edges get no lift — the overview, where crowding is real. */
const EDGE_ALPHA_LIFT_START_SCALE = 1;
/** Zoom at which the lift is fully applied. */
const EDGE_ALPHA_LIFT_FULL_SCALE = 4;
/** Strongest multiplier applied to the base edge alpha when fully zoomed in. */
const EDGE_ALPHA_LIFT_MAX = 2.6;

/**
 * Multiplier that makes edges more opaque as the camera zooms in.
 *
 * The base alpha is tuned for the *overview* of a dense vault, where thousands
 * of overlapping edges would otherwise compound into a dark mass — on a large
 * graph it pins to its floor. But that floor then applied at every zoom level,
 * so zooming into a handful of nodes left their edges nearly invisible even
 * though almost none were on screen to crowd each other. Interpolating on
 * zoom restores them where the crowding it guards against no longer exists.
 *
 * Ramps between {@link EDGE_ALPHA_LIFT_START_SCALE} and
 * {@link EDGE_ALPHA_LIFT_FULL_SCALE}; exactly 1 at or below the start, so the
 * fitted overview keeps the tuned appearance.
 */
export function edgeAlphaZoomLift(viewportScale: number): number {
	if (!Number.isFinite(viewportScale) || viewportScale <= EDGE_ALPHA_LIFT_START_SCALE) return 1;
	const span = EDGE_ALPHA_LIFT_FULL_SCALE - EDGE_ALPHA_LIFT_START_SCALE;
	const t = Math.min(1, (viewportScale - EDGE_ALPHA_LIFT_START_SCALE) / span);
	return 1 + (EDGE_ALPHA_LIFT_MAX - 1) * t;
}

function djb2(text: string): number {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) {
		hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
	}
	return hash;
}

/**
 * Cheap structural signature of a graph: node identities plus edge
 * `(source, target, type, weight)`.
 *
 * Used to decide whether derived topic state (the Leiden cache, the topic
 * hierarchy, the granularity ladder) still describes the graph after a
 * rebuild — a Refresh over an unchanged vault should keep them rather than
 * recompute seconds of worker time for identical results.
 *
 * Per-element hashes are combined order-independently (sum and xor), so two
 * builds that enumerate the same nodes and edges in different orders produce
 * the same signature. Counts are included so the accumulators can't be walked
 * back into a collision by adding and removing offsetting elements.
 */
export function graphTopologySignature(graph: {
	nodes: Array<{ id: string }>;
	edges: Array<{ source: string; target: string; type: string; weight: number }>;
}): string {
	let nodeSum = 0;
	let nodeXor = 0;
	for (const node of graph.nodes) {
		const hash = djb2(node.id);
		nodeSum = (nodeSum + hash) >>> 0;
		nodeXor = (nodeXor ^ hash) >>> 0;
	}
	let edgeSum = 0;
	let edgeXor = 0;
	for (const edge of graph.edges) {
		const hash = djb2(`${edge.source}\0${edge.target}\0${edge.type}\0${edge.weight}`);
		edgeSum = (edgeSum + hash) >>> 0;
		edgeXor = (edgeXor ^ hash) >>> 0;
	}
	return [
		graph.nodes.length,
		nodeSum.toString(36),
		nodeXor.toString(36),
		graph.edges.length,
		edgeSum.toString(36),
		edgeXor.toString(36),
	].join(":");
}
