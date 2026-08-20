import { describe, expect, it } from "vitest";
import { edgeKey, graphTopologySignature, splitEdgeKey } from "../../src/utils/graphUtils";

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
