import { describe, expect, it } from "vitest";
import {
	densityForceProfile,
	densitySpreadFactor,
	edgeAlphaZoomLift,
	edgeKey,
	graphTopologySignature,
	nodeDrawRadius,
	splitEdgeKey,
	zoomNodeScale,
} from "../../src/utils/graphUtils";

describe("edgeKey / splitEdgeKey", () => {
	it("is order-independent and invertible", () => {
		expect(edgeKey("a.md", "b.md")).toBe(edgeKey("b.md", "a.md"));
		expect(splitEdgeKey(edgeKey("a.md", "b.md"))).toEqual(["a.md", "b.md"]);
	});
});

describe("graphTopologySignature", () => {
	const node = (id: string) => ({ id });
	const wiki = (source: string, target: string, weight = 1) => ({ source, target, type: "wiki", weight });

	const base = () => ({
		nodes: [node("a.md"), node("b.md"), node("c.md")],
		edges: [wiki("a.md", "b.md"), wiki("b.md", "c.md", 2)],
	});

	it("is stable for an identical graph", () => {
		expect(graphTopologySignature(base())).toBe(graphTopologySignature(base()));
	});

	it("ignores node and edge enumeration order", () => {
		const reordered = {
			nodes: [node("c.md"), node("a.md"), node("b.md")],
			edges: [wiki("b.md", "c.md", 2), wiki("a.md", "b.md")],
		};
		expect(graphTopologySignature(reordered)).toBe(graphTopologySignature(base()));
	});

	it("changes when a node is added or renamed", () => {
		const added = base();
		added.nodes.push(node("d.md"));
		expect(graphTopologySignature(added)).not.toBe(graphTopologySignature(base()));

		const renamed = base();
		renamed.nodes[0] = node("a-renamed.md");
		expect(graphTopologySignature(renamed)).not.toBe(graphTopologySignature(base()));
	});

	it("changes when an edge is added, rewired, retyped, or reweighted", () => {
		const reference = graphTopologySignature(base());

		const added = base();
		added.edges.push(wiki("a.md", "c.md"));
		expect(graphTopologySignature(added)).not.toBe(reference);

		const rewired = base();
		rewired.edges[0] = wiki("a.md", "c.md");
		expect(graphTopologySignature(rewired)).not.toBe(reference);

		const retyped = base();
		retyped.edges[0] = { ...retyped.edges[0], type: "semantic" };
		expect(graphTopologySignature(retyped)).not.toBe(reference);

		const reweighted = base();
		reweighted.edges[0] = wiki("a.md", "b.md", 3);
		expect(graphTopologySignature(reweighted)).not.toBe(reference);
	});

	it("distinguishes empty graphs from populated ones", () => {
		const empty = { nodes: [], edges: [] };
		expect(graphTopologySignature(empty)).toBe(graphTopologySignature({ nodes: [], edges: [] }));
		expect(graphTopologySignature(empty)).not.toBe(graphTopologySignature(base()));
	});
});

describe("nodeDrawRadius", () => {
	const NODE_SIZE = 2;

	const memberPaths = (count: number) => Array.from({ length: count }, (_, i) => `note${i}.md`);
	const topic = (members: number) => nodeDrawRadius({ kind: "topic", memberPaths: memberPaths(members) }, NODE_SIZE);

	it("caps note radius but never a topic's (smooth saturation)", () => {
		// Note formula saturates hard: past the cap, more degree changes nothing.
		const note = (degree: number) => nodeDrawRadius({ degree }, NODE_SIZE);
		expect(note(200)).toBe(note(2000));

		// Topic curve keeps growing: every doubling of members stays visible.
		let previous = topic(0);
		for (const members of [5, 10, 25, 50, 100, 200, 400, 800, 1600]) {
			const radius = topic(members);
			expect(radius).toBeGreaterThan(previous);
			previous = radius;
		}
	});

	it("differentiates topics across the realistic member-count range", () => {
		// The everyday spread in a few-hundred-note vault: a dozen-note topic vs
		// a fifty-note one must read as visibly different bubbles.
		expect(topic(50) - topic(12)).toBeGreaterThan(3);
		// And a mega-topic still clearly outranks an everyday one.
		expect(topic(1000) - topic(50)).toBeGreaterThan(5);
	});

	it("sizes topics by member count, not connectivity", () => {
		// Same members, wildly different crossing-link counts — identical radius.
		// Connectivity is edge width's job; encoding it here would double-encode.
		const linkHeavy = nodeDrawRadius({ kind: "topic", degree: 2000, memberPaths: memberPaths(30) }, NODE_SIZE);
		const linkLight = nodeDrawRadius({ kind: "topic", degree: 3, memberPaths: memberPaths(30) }, NODE_SIZE);
		expect(linkHeavy).toBe(linkLight);
	});

	it("stays bounded for a degenerate mega-topic", () => {
		const huge = topic(1_000_000);
		expect(huge).toBeLessThan(NODE_SIZE + 26);
	});

	it("keeps a small topic near note size", () => {
		const smallTopic = topic(4);
		const hubNote = nodeDrawRadius({ degree: 20 }, NODE_SIZE);
		expect(smallTopic).toBeLessThan(hubNote);
	});

	it("treats missing degree/members as zero and enforces the minimum base", () => {
		expect(nodeDrawRadius({}, 0)).toBe(1);
		expect(nodeDrawRadius({ kind: "topic" }, 0)).toBe(1);
	});
});

describe("densitySpreadFactor", () => {
	it("is exactly 1 at the reference density", () => {
		expect(densitySpreadFactor(400)).toBe(1);
	});

	it("spreads small graphs and compacts large ones, monotonically", () => {
		expect(densitySpreadFactor(12)).toBeGreaterThan(1);
		expect(densitySpreadFactor(5000)).toBeLessThan(1);
		let previous = densitySpreadFactor(1);
		for (const count of [10, 50, 400, 2000, 20000]) {
			const factor = densitySpreadFactor(count);
			expect(factor).toBeLessThanOrEqual(previous);
			previous = factor;
		}
	});

	it("clamps at both extremes so the force balance stays in its tested regime", () => {
		expect(densitySpreadFactor(1)).toBe(4.5);
		expect(densitySpreadFactor(1_000_000)).toBe(0.65);
		// Degenerate inputs behave like a tiny graph rather than exploding.
		expect(densitySpreadFactor(0)).toBe(4.5);
	});
});

describe("densityForceProfile", () => {
	it("is the identity at the reference density", () => {
		expect(densityForceProfile(400)).toEqual({ spacing: 1, charge: 1, center: 1, cohesion: 1 });
	});

	it("on dense graphs: compacts spacing, relaxes cohesion, boosts centering — charge softest", () => {
		const dense = densityForceProfile(5000);
		expect(dense.spacing).toBeLessThan(1);
		// Cohesion relaxes *faster* than spacing compacts, so cluster interiors
		// gain breathing room even as the global structure tightens.
		expect(dense.cohesion).toBeLessThan(dense.spacing);
		expect(dense.cohesion).toBeGreaterThanOrEqual(0.45);
		// Charge scales gentler than spacing: it also separates notes *within* a
		// cluster, which must not be squeezed as hard as the global structure.
		expect(dense.charge).toBeGreaterThan(dense.spacing);
		expect(dense.charge).toBeLessThan(1);
		// The center pull strengthens steeply to close inter-cluster gaps —
		// meaningfully past the linear response, but bounded.
		expect(dense.center).toBeGreaterThan(1.6);
		expect(dense.center).toBeLessThanOrEqual(2.8);
	});

	it("on small graphs: spreads spacing, softens the charge spread, relaxes centering, never boosts cohesion", () => {
		const small = densityForceProfile(12);
		expect(small.spacing).toBeGreaterThan(1);
		// Softer than spacing so unlinked satellites aren't flung to the horizon.
		expect(small.charge).toBeLessThan(small.spacing);
		expect(small.charge).toBeGreaterThan(1);
		// Centering eases off so a handful of nodes can open up to fill the
		// viewport instead of settling as a knot — but stays firm enough that
		// the graph still reads as one object.
		expect(small.center).toBeLessThan(1);
		expect(small.center).toBeGreaterThanOrEqual(0.35);
		expect(small.cohesion).toBe(1);
	});
});

describe("densityForceProfile sparse/dense split", () => {
	it("relaxes centering only for sparse graphs, never for dense ones", () => {
		// Regression: the sparse branch once keyed off the spread factor, which
		// saturates at both clamps — so every graph past the compaction floor
		// was misread as sparse and had its centering relaxed instead of
		// boosted, blowing dense layouts out to several times their extent.
		for (const count of [800, 2000, 8000, 100_000]) {
			expect(densityForceProfile(count).center).toBeGreaterThan(1);
		}
		for (const count of [5, 10, 30]) {
			expect(densityForceProfile(count).center).toBeLessThan(1);
		}
	});

	it("keeps the reference density exactly neutral on both sides of the split", () => {
		expect(densityForceProfile(400)).toEqual({ spacing: 1, charge: 1, center: 1, cohesion: 1 });
		// Just below the reference the profile must not jump discontinuously.
		const justBelow = densityForceProfile(399);
		expect(justBelow.center).toBeGreaterThan(0.9);
		expect(justBelow.spacing).toBeGreaterThanOrEqual(1);
	});
});

describe("edgeAlphaZoomLift", () => {
	it("leaves the overview untouched", () => {
		expect(edgeAlphaZoomLift(1)).toBe(1);
		expect(edgeAlphaZoomLift(0.25)).toBe(1);
	});

	it("ramps up monotonically as the camera zooms in, then saturates", () => {
		let previous = edgeAlphaZoomLift(1);
		for (const scale of [1.5, 2, 3, 4]) {
			const lift = edgeAlphaZoomLift(scale);
			expect(lift).toBeGreaterThan(previous);
			previous = lift;
		}
		expect(edgeAlphaZoomLift(4)).toBeCloseTo(2.6, 10);
		// Past the full-lift zoom it stops growing rather than running away.
		expect(edgeAlphaZoomLift(50)).toBe(edgeAlphaZoomLift(4));
	});

	it("tolerates degenerate scales", () => {
		expect(edgeAlphaZoomLift(0)).toBe(1);
		expect(edgeAlphaZoomLift(Number.NaN)).toBe(1);
	});
});

describe("zoomNodeScale", () => {
	it("is exactly 1 at unit zoom", () => {
		expect(zoomNodeScale(1)).toBe(1);
	});

	it("counter-scales partially: grows zoomed out, shrinks zoomed in — both sublinearly", () => {
		const zoomedOut = zoomNodeScale(0.25);
		expect(zoomedOut).toBeGreaterThan(1);
		// On screen the node still shrinks when zooming out (factor < 1/scale) —
		// the counter-scale is partial, not a fixed screen size.
		expect(zoomedOut).toBeLessThan(1 / 0.25);

		const zoomedIn = zoomNodeScale(4);
		expect(zoomedIn).toBeLessThan(1);
		// And it still grows on screen when zooming in (factor × scale > 1).
		expect(zoomedIn * 4).toBeGreaterThan(1);
	});

	it("clamps at extreme zooms and tolerates degenerate scales", () => {
		expect(zoomNodeScale(0.001)).toBe(4);
		expect(zoomNodeScale(1000)).toBeCloseTo(1 / 3, 10);
		expect(zoomNodeScale(0)).toBe(1);
		expect(zoomNodeScale(Number.NaN)).toBe(1);
	});
});
