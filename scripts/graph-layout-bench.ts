/**
 * Headless layout benchmark for the smart graph's physics tuning.
 *
 * Runs the *production* force assembly (src/utils/graphLayout.ts — the same
 * code GraphCanvas installs) on seeded synthetic vaults across the density
 * range, settles each simulation, and measures the qualities that tuning
 * rounds previously judged by screenshot:
 *
 * - `fit`      — the zoom the camera lands at to frame the layout in a
 *                1200×800 viewport. Too small = user must zoom out far.
 * - `nodePx`   — median on-screen node radius at that fit (counter-scale
 *                applied). Too small = dust; too big = discs.
 * - `breathe`  — median nearest-neighbour distance between clustered notes,
 *                as a multiple of touching distance (sum of collide radii).
 *                1.0 = collide-bound crush; higher = air between notes.
 * - `gap`      — mean distance to the nearest other topic centroid, as a
 *                multiple of the two topics' combined RMS radii.
 *                ~1 = hulls touching; large = topics floating far apart.
 * - `sat`      — median orbit of unlinked satellite notes, as a multiple of
 *                the clustered core's 95th-percentile radius.
 * - `ovl%`     — share of nodes overlapping their nearest neighbour on
 *                screen at fit zoom (drawn, counter-scaled radii).
 * - `fill`     — the on-screen extent of the graph's *core* (the central 90%
 *                of nodes) as a fraction of the viewport at fit zoom. Low = a
 *                small knot marooned in white space; once the overview zoom
 *                cap binds, the camera can't fix it. Deliberately ignores
 *                outliers: the camera frames the full bounding box, so a
 *                couple of far-flung unsorted notes can stretch the box while
 *                everything the user cares about huddles in one corner —
 *                measuring the box would score that as a good fill.
 * - `waste`    — full bounding box area ÷ core area. ~1 = the frame is all
 *                content; high = the camera is zoomed out to include
 *                outliers, shrinking the core.
 *
 * Each scenario carries guardrail bands (see `Expectations`); `--assert`
 * exits non-zero when any are violated, so a tuning change that fixes one
 * density while wrecking another can't pass unnoticed.
 *
 * Deterministic end to end: mulberry32-seeded generation, d3-force's default
 * deterministic randomSource, phyllotaxis initial placement. Run:
 *
 *   bun run bench:layout            # table
 *   bun run bench:layout --assert   # non-zero exit on band violations
 *   bun run bench:layout --json     # machine-readable
 */

import { GRAPH_FIT_MAX_SCALE, computeCoreNodeBounds } from "../src/utils/graphAnimation";
import {
	type LayoutLink,
	type LayoutNode,
	type LayoutPhysicsConfig,
	createLayoutSimulation,
} from "../src/utils/graphLayout";
import { autoNodeSize, densityForceProfile, nodeDrawRadius, zoomNodeScale } from "../src/utils/graphUtils";
import { mulberry32 } from "../src/utils/seededRandom";

// The user-facing defaults from DEFAULT_SMART_GRAPH_SETTINGS (types/graph.ts
// imports Svelte-adjacent modules, so the values are mirrored here — if they
// drift, the bench header shows what it ran with).
const BASE_PHYSICS = {
	linkDistance: 60,
	chargeStrength: -120,
	centerStrength: 0.07,
	linkStrength: 1,
	clusterCohesionStrength: 0.45,
};

const VIEWPORT_W = 1200;
const VIEWPORT_H = 800;
const FIT_PADDING = 40;

const MAX_TICKS = 400;

interface BenchNode extends LayoutNode {
	x: number;
	y: number;
}

interface BenchLink extends LayoutLink {
	source: string | BenchNode;
	target: string | BenchNode;
}

/**
 * Guardrail bands per scenario, set ~10% under the tuned values so
 * deterministic drift and small legitimate tweaks pass, while the class of
 * regression the benchmark has actually caught (the unclustered-cohesion
 * glue, the distanceMin crush — 20–50% metric swings) fails loudly.
 *
 * Collapsed scenarios allow breathe ≈ 1 by design: their topic graphs are
 * near-complete, and a complete graph cannot embed in the plane with every
 * pair at rest length — heavily-coupled topics sitting adjacent (touching,
 * never overlapping) is the intended reading of coupling.
 */
interface Expectations {
	breatheMin?: number;
	fillMin?: number;
	wasteMax?: number;
	gapMin?: number;
	gapMax?: number;
	satMax?: number;
	nodePxMax?: number;
	ovlMax?: number;
}

interface Scenario {
	name: string;
	nodes: BenchNode[];
	links: BenchLink[];
	/** Notes the graph stands for (drives nodeSize; ≥ nodes.length when collapsed). */
	representedNotes: number;
	expect: Expectations;
}

// ── Synthetic vault generation ──────────────────────────────────────────────

interface VaultShape {
	noteCount: number;
	topicCount: number;
	/** Fraction of notes with no links at all (the "unsorted" satellites). */
	satelliteFraction: number;
	/** Mean authored links per clustered note. */
	wikiLinksPerNote: number;
	/** Mean inferred links per clustered note (weights 0.55–0.95). */
	semanticLinksPerNote: number;
	/** Fraction of links that cross topic boundaries. */
	interTopicFraction: number;
}

/** Heavy-tailed topic sizes (Zipf-ish), matching how real vaults distribute. */
function topicSizes(rng: () => number, noteCount: number, topicCount: number): number[] {
	const weights = Array.from({ length: topicCount }, (_, i) => 1 / (i + 1 + rng() * 0.5));
	const total = weights.reduce((a, b) => a + b, 0);
	const sizes = weights.map((w) => Math.max(2, Math.round((w / total) * noteCount)));
	// Fix rounding drift so sizes sum to noteCount.
	let drift = noteCount - sizes.reduce((a, b) => a + b, 0);
	for (let i = 0; drift !== 0; i = (i + 1) % sizes.length) {
		const step = Math.sign(drift);
		if (sizes[i] + step >= 2) {
			sizes[i] += step;
			drift -= step;
		}
	}
	return sizes;
}

/** Skewed pick of an earlier note in the topic — low indices act as hubs. */
function pickHubIndex(rng: () => number, upperExclusive: number): number {
	return Math.floor(upperExclusive * rng() ** 2);
}

function generateExpandedVault(seed: number, shape: VaultShape): Pick<Scenario, "nodes" | "links"> {
	const rng = mulberry32(seed);
	const satelliteCount = Math.round(shape.noteCount * shape.satelliteFraction);
	const clusteredCount = shape.noteCount - satelliteCount;
	const sizes = topicSizes(rng, clusteredCount, shape.topicCount);

	const nodes: BenchNode[] = [];
	const byTopic: BenchNode[][] = [];
	let noteIndex = 0;
	for (let topic = 0; topic < sizes.length; topic++) {
		const members: BenchNode[] = [];
		for (let i = 0; i < sizes[topic]; i++) {
			const node: BenchNode = { id: `n${noteIndex++}`, cluster: topic, degree: 0, x: 0, y: 0 };
			members.push(node);
			nodes.push(node);
		}
		byTopic.push(members);
	}
	for (let i = 0; i < satelliteCount; i++) {
		nodes.push({ id: `sat${i}`, degree: 0, x: 0, y: 0 });
	}

	const links: BenchLink[] = [];
	const seen = new Set<string>();
	const addLink = (a: BenchNode, b: BenchNode, weight: number, type: string) => {
		if (a === b) return;
		const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
		if (seen.has(key)) return;
		seen.add(key);
		links.push({ source: a.id, target: b.id, weight, type });
		a.degree = (a.degree ?? 0) + 1;
		b.degree = (b.degree ?? 0) + 1;
	};

	for (const members of byTopic) {
		for (let i = 1; i < members.length; i++) {
			const wikiCount = Math.max(0, Math.round(shape.wikiLinksPerNote * (0.5 + rng())));
			for (let l = 0; l < wikiCount; l++) {
				if (rng() < shape.interTopicFraction) {
					const other = byTopic[Math.floor(rng() * byTopic.length)];
					addLink(members[i], other[pickHubIndex(rng, other.length)], 1 + Math.floor(rng() * 3), "wiki");
				} else {
					addLink(members[i], members[pickHubIndex(rng, i)], 1 + Math.floor(rng() * 3), "wiki");
				}
			}
			const semCount = Math.max(0, Math.round(shape.semanticLinksPerNote * (0.5 + rng())));
			for (let l = 0; l < semCount; l++) {
				if (rng() < shape.interTopicFraction / 2) {
					const other = byTopic[Math.floor(rng() * byTopic.length)];
					addLink(members[i], other[pickHubIndex(rng, other.length)], 0.55 + rng() * 0.4, "semantic");
				} else {
					addLink(members[i], members[pickHubIndex(rng, i)], 0.55 + rng() * 0.4, "semantic");
				}
			}
		}
	}

	return { nodes, links };
}

/** A collapsed view of the same shape: one topic node each + the satellites. */
function generateCollapsedVault(seed: number, shape: VaultShape): Pick<Scenario, "nodes" | "links"> {
	const rng = mulberry32(seed);
	const satelliteCount = Math.round(shape.noteCount * shape.satelliteFraction);
	const clusteredCount = shape.noteCount - satelliteCount;
	const sizes = topicSizes(rng, clusteredCount, shape.topicCount);

	const nodes: BenchNode[] = sizes.map((size, topic) => ({
		id: `topic:${topic}`,
		kind: "topic",
		cluster: topic,
		// Crossing-link count scales with topic size, heavy-tailed like reality.
		degree: Math.round(size * shape.wikiLinksPerNote * shape.interTopicFraction * (2 + rng() * 3)),
		// Member count drives the topic radius (and thus collide spacing) — the
		// paths themselves are never dereferenced, only counted. The radius is
		// normalized to the largest topic, exactly as buildCollapsedGraph stamps it.
		memberPaths: Array.from({ length: size }, (_, i) => `topic${topic}/note${i}`),
		largestTopicSize: Math.max(...sizes),
		x: 0,
		y: 0,
	}));
	for (let i = 0; i < satelliteCount; i++) {
		nodes.push({ id: `sat${i}`, degree: 0, x: 0, y: 0 });
	}

	const links: BenchLink[] = [];
	for (let a = 0; a < sizes.length; a++) {
		for (let b = a + 1; b < sizes.length; b++) {
			// Bigger topic pairs cross more; small pairs often not at all.
			const crossings = Math.round(Math.min(sizes[a], sizes[b]) * shape.interTopicFraction * rng() * 2);
			if (crossings > 0) {
				links.push({ source: `topic:${a}`, target: `topic:${b}`, weight: crossings, type: "wiki" });
			}
		}
	}
	return { nodes, links };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

function median(values: number[]): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values: number[], p: number): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** Nearest neighbour per node via a uniform grid — O(n) for settled layouts. */
function nearestNeighbours(nodes: BenchNode[]): Map<string, { other: BenchNode; distance: number }> {
	const result = new Map<string, { other: BenchNode; distance: number }>();
	if (nodes.length < 2) return result;
	const cell = 80;
	const grid = new Map<string, BenchNode[]>();
	const keyOf = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
	for (const node of nodes) {
		const key = keyOf(node.x, node.y);
		const bucket = grid.get(key);
		if (bucket) bucket.push(node);
		else grid.set(key, [node]);
	}
	for (const node of nodes) {
		let best: BenchNode | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		// Widen the ring search until a neighbour is found (sparse layouts).
		for (let ring = 1; ring <= 64 && best === null; ring *= 2) {
			const cx = Math.floor(node.x / cell);
			const cy = Math.floor(node.y / cell);
			for (let gx = cx - ring; gx <= cx + ring; gx++) {
				for (let gy = cy - ring; gy <= cy + ring; gy++) {
					for (const other of grid.get(`${gx}:${gy}`) ?? []) {
						if (other === node) continue;
						const d = Math.hypot(other.x - node.x, other.y - node.y);
						if (d < bestDistance) {
							bestDistance = d;
							best = other;
						}
					}
				}
			}
		}
		if (best) result.set(node.id, { other: best, distance: bestDistance });
	}
	return result;
}

interface Metrics {
	ticks: number;
	ms: number;
	extentW: number;
	extentH: number;
	fitScale: number;
	nodeScreenPx: number;
	breathingRatio: number;
	topicGapRatio: number;
	satelliteOrbit: number;
	screenOverlapPct: number;
	viewportFill: number;
	framingWaste: number;
}

function measure(scenario: Scenario, config: LayoutPhysicsConfig): Metrics {
	const start = performance.now();
	const simulation = createLayoutSimulation(scenario.nodes, scenario.links, config);
	let ticks = 0;
	while (simulation.alpha() > simulation.alphaMin() && ticks < MAX_TICKS) {
		simulation.tick();
		ticks++;
	}
	const ms = performance.now() - start;

	const xs = scenario.nodes.map((n) => n.x);
	const ys = scenario.nodes.map((n) => n.y);
	const extentW = Math.max(...xs) - Math.min(...xs);
	const extentH = Math.max(...ys) - Math.min(...ys);
	// Frame exactly the way the app does: full bounds (an explicit fit shows
	// everything) under the same overview zoom cap. The core-vs-full split
	// lives in the *metrics*: `fill`/`waste` measure how much of that honest
	// frame the graph's core actually uses.
	const fitScale = Math.min(
		(VIEWPORT_W - FIT_PADDING * 2) / Math.max(extentW, 1),
		(VIEWPORT_H - FIT_PADDING * 2) / Math.max(extentH, 1),
		GRAPH_FIT_MAX_SCALE,
	);
	const zoomScale = zoomNodeScale(fitScale);

	const radiusOf = (n: BenchNode) => nodeDrawRadius(n, config.nodeSize);
	const nodeScreenPx = median(scenario.nodes.map((n) => radiusOf(n) * zoomScale * fitScale));

	const neighbours = nearestNeighbours(scenario.nodes);
	// Breathing covers every connected node — in the collapsed view the topic
	// nodes *are* the cluster interior being judged.
	const connected = scenario.nodes.filter((n) => (n.degree ?? 0) > 0);
	const breathingSamples: number[] = [];
	for (const node of connected) {
		const nn = neighbours.get(node.id);
		if (!nn) continue;
		const touch = radiusOf(node) + radiusOf(nn.other) + 4; // +2 collide padding each
		breathingSamples.push(nn.distance / touch);
	}

	// Topic separation: centroid distance to the nearest other topic, relative
	// to the two topics' combined RMS radii.
	const byTopic = new Map<number, BenchNode[]>();
	for (const node of scenario.nodes) {
		if (node.cluster == null) continue;
		const bucket = byTopic.get(node.cluster);
		if (bucket) bucket.push(node);
		else byTopic.set(node.cluster, [node]);
	}
	// A singleton "cluster" (a collapsed topic node) has no spatial spread of
	// its own — its drawn radius stands in for the RMS radius, so the gap
	// metric stays meaningful in collapsed scenarios.
	const topicStats = [...byTopic.values()].map((members) => {
		const cx = members.reduce((s, n) => s + n.x, 0) / members.length;
		const cy = members.reduce((s, n) => s + n.y, 0) / members.length;
		const rms =
			members.length >= 2
				? Math.sqrt(members.reduce((s, n) => s + (n.x - cx) ** 2 + (n.y - cy) ** 2, 0) / members.length)
				: radiusOf(members[0]);
		return { cx, cy, rms };
	});
	const gapSamples: number[] = [];
	for (const topic of topicStats) {
		let best = Number.POSITIVE_INFINITY;
		for (const other of topicStats) {
			if (other === topic) continue;
			const d = Math.hypot(other.cx - topic.cx, other.cy - topic.cy) / Math.max(topic.rms + other.rms, 1);
			if (d < best) best = d;
		}
		if (Number.isFinite(best)) gapSamples.push(best);
	}

	// Satellites: unlinked nodes' orbit relative to the clustered core.
	const satellites = scenario.nodes.filter((n) => (n.degree ?? 0) === 0);
	const core = scenario.nodes.filter((n) => (n.degree ?? 0) > 0);
	const coreRadius = percentile(
		core.map((n) => Math.hypot(n.x, n.y)),
		0.95,
	);
	const satelliteOrbit = median(satellites.map((n) => Math.hypot(n.x, n.y))) / Math.max(coreRadius, 1);

	let overlapping = 0;
	for (const node of scenario.nodes) {
		const nn = neighbours.get(node.id);
		if (!nn) continue;
		if (nn.distance < (radiusOf(node) + radiusOf(nn.other)) * zoomScale * 0.95) overlapping++;
	}

	// How much of the viewport the settled layout's *core* covers once framed.
	// The core trims the most extreme 5% per axis, so a handful of stranded
	// outliers can't inflate the score — they inflate the camera's bounding box
	// instead, which is exactly the failure this is meant to detect.
	// One definition of "core" — the shared rank-trimmed bounds helper.
	const coreBounds = computeCoreNodeBounds(scenario.nodes) ?? { minX: 0, maxX: 1, minY: 0, maxY: 1 };
	const coreW = Math.max(coreBounds.maxX - coreBounds.minX, 1);
	const coreH = Math.max(coreBounds.maxY - coreBounds.minY, 1);
	const viewportFill = Math.max((coreW * fitScale) / VIEWPORT_W, (coreH * fitScale) / VIEWPORT_H);
	// How much of the framed area is empty because outliers stretched the box.
	const framingWaste = (Math.max(extentW, 1) * Math.max(extentH, 1)) / (coreW * coreH);

	return {
		ticks,
		ms,
		extentW,
		extentH,
		fitScale,
		nodeScreenPx,
		breathingRatio: median(breathingSamples),
		topicGapRatio: gapSamples.length > 0 ? gapSamples.reduce((a, b) => a + b, 0) / gapSamples.length : Number.NaN,
		satelliteOrbit,
		screenOverlapPct: (overlapping / scenario.nodes.length) * 100,
		viewportFill,
		framingWaste,
	};
}

// ── Scenarios ───────────────────────────────────────────────────────────────

function buildScenarios(): Scenario[] {
	const shapes: Array<{ name: string; shape: VaultShape; collapsed?: boolean; expect: Expectations }> = [
		{
			name: "tiny (15)",
			// gapMax is generous for the sparsest graphs on purpose: with the
			// centering relaxed so a handful of nodes can fill the viewport, its
			// few topics necessarily sit further apart in relative terms.
			expect: { breatheMin: 2.5, gapMin: 1.5, gapMax: 3.0, satMax: 0.6, nodePxMax: 10.5, fillMin: 0.65 },
			shape: {
				noteCount: 15,
				topicCount: 3,
				satelliteFraction: 0.15,
				wikiLinksPerNote: 1.2,
				semanticLinksPerNote: 2,
				interTopicFraction: 0.1,
			},
		},
		{
			name: "small (60)",
			expect: { breatheMin: 1.3, gapMin: 1.7, gapMax: 2.9, satMax: 0.7, nodePxMax: 10.5, fillMin: 0.55 },
			shape: {
				noteCount: 60,
				topicCount: 6,
				satelliteFraction: 0.12,
				wikiLinksPerNote: 1.2,
				semanticLinksPerNote: 2.5,
				interTopicFraction: 0.1,
			},
		},
		{
			name: "immersed (120)",
			expect: { breatheMin: 1.05, gapMin: 2.0, gapMax: 3.2, satMax: 1.1, fillMin: 0.5 },
			shape: {
				noteCount: 120,
				topicCount: 2,
				satelliteFraction: 0.05,
				wikiLinksPerNote: 1.5,
				semanticLinksPerNote: 3,
				interTopicFraction: 0.08,
			},
		},
		{
			name: "reference (400)",
			expect: { breatheMin: 1.2, gapMin: 1.5, gapMax: 2.4, satMax: 1.0, fillMin: 0.6 },
			shape: {
				noteCount: 400,
				topicCount: 10,
				satelliteFraction: 0.1,
				wikiLinksPerNote: 1.3,
				semanticLinksPerNote: 3,
				interTopicFraction: 0.1,
			},
		},
		{
			name: "large (2000)",
			expect: { breatheMin: 1.05, gapMin: 1.1, satMax: 0.5, ovlMax: 12, fillMin: 0.6 },
			shape: {
				noteCount: 2000,
				topicCount: 14,
				satelliteFraction: 0.08,
				wikiLinksPerNote: 1.3,
				semanticLinksPerNote: 3,
				interTopicFraction: 0.12,
			},
		},
		{
			name: "huge (8000)",
			expect: { breatheMin: 1.0, gapMin: 0.9, satMax: 0.5, fillMin: 0.55 },
			shape: {
				noteCount: 8000,
				topicCount: 18,
				satelliteFraction: 0.06,
				wikiLinksPerNote: 1.4,
				semanticLinksPerNote: 3,
				interTopicFraction: 0.12,
			},
		},
		{
			// The everyday collapsed view: a handful of topics, near-complete
			// coupling. Small enough that the fit cap binds, so the layout's own
			// extent — not the camera — decides how much viewport it fills.
			name: "collapsed small",
			expect: { breatheMin: 1.2, gapMin: 1.4, satMax: 1.2, fillMin: 0.35, wasteMax: 3.5 },
			shape: {
				noteCount: 600,
				topicCount: 8,
				satelliteFraction: 0.004,
				wikiLinksPerNote: 1.3,
				semanticLinksPerNote: 0,
				interTopicFraction: 0.12,
			},
			collapsed: true,
		},
		{
			// breathe/gap bands sit near 1 like collapsed huge's: both are ratios
			// over the topic radii, and member-count sizing draws this scenario's
			// Zipf-tail mega-topics as much larger discs in a similar footprint —
			// adjacent-but-not-overlapping is the intended reading (ovl% guards
			// actual overlap).
			name: "collapsed large",
			expect: { breatheMin: 1.0, gapMin: 1.1, satMax: 1.1, fillMin: 0.55, wasteMax: 2.0, ovlMax: 5 },
			shape: {
				noteCount: 2000,
				topicCount: 14,
				satelliteFraction: 0.012,
				wikiLinksPerNote: 1.3,
				semanticLinksPerNote: 0,
				interTopicFraction: 0.12,
			},
			collapsed: true,
		},
		{
			name: "collapsed huge",
			expect: { breatheMin: 0.95, gapMin: 1.05, satMax: 0.9, fillMin: 0.55, wasteMax: 2.0 },
			shape: {
				noteCount: 8000,
				topicCount: 18,
				satelliteFraction: 0.005,
				wikiLinksPerNote: 1.4,
				semanticLinksPerNote: 0,
				interTopicFraction: 0.12,
			},
			collapsed: true,
		},
	];

	return shapes.map(({ name, shape, collapsed, expect }, index) => {
		const seed = 1000 + index;
		const { nodes, links } = collapsed ? generateCollapsedVault(seed, shape) : generateExpandedVault(seed, shape);
		return { name, nodes, links, representedNotes: shape.noteCount, expect };
	});
}

// ── Main ────────────────────────────────────────────────────────────────────

function violations(expect: Expectations, m: Metrics): string[] {
	const out: string[] = [];
	if (expect.breatheMin !== undefined && !(m.breathingRatio >= expect.breatheMin))
		out.push(`breathe ${m.breathingRatio.toFixed(2)} < ${expect.breatheMin}`);
	if (expect.gapMin !== undefined && !(m.topicGapRatio >= expect.gapMin))
		out.push(`gap ${m.topicGapRatio.toFixed(2)} < ${expect.gapMin}`);
	if (expect.gapMax !== undefined && !(m.topicGapRatio <= expect.gapMax))
		out.push(`gap ${m.topicGapRatio.toFixed(2)} > ${expect.gapMax}`);
	if (expect.satMax !== undefined && !(m.satelliteOrbit <= expect.satMax))
		out.push(`sat ${m.satelliteOrbit.toFixed(2)} > ${expect.satMax}`);
	if (expect.nodePxMax !== undefined && !(m.nodeScreenPx <= expect.nodePxMax))
		out.push(`nodePx ${m.nodeScreenPx.toFixed(1)} > ${expect.nodePxMax}`);
	if (expect.ovlMax !== undefined && !(m.screenOverlapPct <= expect.ovlMax))
		out.push(`ovl% ${m.screenOverlapPct.toFixed(1)} > ${expect.ovlMax}`);
	if (expect.fillMin !== undefined && !(m.viewportFill >= expect.fillMin))
		out.push(`fill ${m.viewportFill.toFixed(2)} < ${expect.fillMin}`);
	if (expect.wasteMax !== undefined && !(m.framingWaste <= expect.wasteMax))
		out.push(`waste ${m.framingWaste.toFixed(1)} > ${expect.wasteMax}`);
	return out;
}

function run() {
	const asJson = process.argv.includes("--json");
	const asAssert = process.argv.includes("--assert");
	const scenarios = buildScenarios();
	const rows: Array<Record<string, unknown>> = [];
	const failures: string[] = [];

	for (const scenario of scenarios) {
		const nodeSize = autoNodeSize(scenario.representedNotes);
		const config: LayoutPhysicsConfig = {
			...BASE_PHYSICS,
			nodeSize,
			visibleNodeCount: scenario.nodes.length,
		};
		const profile = densityForceProfile(scenario.nodes.length);
		const m = measure(scenario, config);
		const broken = violations(scenario.expect, m);
		for (const violation of broken) failures.push(`${scenario.name}: ${violation}`);
		rows.push({
			ok: broken.length === 0 ? "✓" : "✗",
			scenario: scenario.name,
			nodes: scenario.nodes.length,
			links: scenario.links.length,
			ticks: m.ticks,
			ms: Math.round(m.ms),
			extent: `${Math.round(m.extentW)}×${Math.round(m.extentH)}`,
			fit: Number(m.fitScale.toFixed(3)),
			nodePx: Number(m.nodeScreenPx.toFixed(1)),
			breathe: Number(m.breathingRatio.toFixed(2)),
			gap: Number(m.topicGapRatio.toFixed(2)),
			sat: Number(m.satelliteOrbit.toFixed(2)),
			"ovl%": Number(m.screenOverlapPct.toFixed(1)),
			fill: Number(m.viewportFill.toFixed(2)),
			waste: Number(m.framingWaste.toFixed(1)),
			profile: `s${profile.spacing.toFixed(2)}/q${profile.charge.toFixed(2)}/c${profile.center.toFixed(2)}/h${profile.cohesion.toFixed(2)}`,
		});
	}

	if (asJson) {
		console.log(JSON.stringify({ physics: BASE_PHYSICS, rows }, null, 2));
		return;
	}

	console.log(`\nLayout benchmark — physics ${JSON.stringify(BASE_PHYSICS)}`);
	console.log("Guardrail bands are per scenario (see Expectations in this file); ✗ rows list violations below.\n");
	console.table(rows);
	if (failures.length > 0) {
		console.log(`\n${failures.length} band violation(s):`);
		for (const failure of failures) console.log(`  ✗ ${failure}`);
		if (asAssert) process.exitCode = 1;
	} else {
		console.log("\nAll scenarios within bands.");
	}
}

run();
