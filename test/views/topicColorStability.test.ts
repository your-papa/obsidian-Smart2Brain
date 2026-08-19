import { describe, expect, it, vi } from "vitest";
import { resolveSegments } from "../../src/views/smart-graph/graphDataBuilder";
import type { App } from "obsidian";
import type { GraphData, GraphNode } from "../../src/types/graph";

const app = { metadataCache: { getCache: () => null } } as unknown as App;

function note(id: string): GraphNode {
	return { id, path: id, label: id, x: 0, y: 0, degree: 1, highlighted: false };
}

/** Colour a topic ends up with, keyed by the note that anchors it. */
function colorByAnchor(graph: GraphData, communities: Record<string, number>): Map<string, string> {
	const segments = resolveSegments(app, graph, "leiden", { leidenCommunities: communities });
	const result = new Map<string, string>();
	for (const segment of segments) {
		// Label is the representative note, which is what the colour is keyed to.
		result.set(segment.label, segment.color);
	}
	return result;
}

describe("topic colour stability across granularity levels", () => {
	/**
	 * Two topics whose *relative sizes* swap between granularity levels. Under the old
	 * rank-based colouring this alone repainted both topics; colour must instead
	 * follow the group's content.
	 */
	const nodes = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"].map(note);
	const edges = [
		{ source: "a1", target: "a2", weight: 1, type: "wiki" as const },
		{ source: "a2", target: "a3", weight: 1, type: "wiki" as const },
		{ source: "b1", target: "b2", weight: 1, type: "wiki" as const },
		{ source: "b2", target: "b3", weight: 1, type: "wiki" as const },
	];
	const graph: GraphData = { nodes, edges };

	it("keeps a topic's colour when another topic grows past it", () => {
		// Level 1: topic A is larger. Level 2: topic B is larger — ranks swap.
		const level1 = { a1: 0, a2: 0, a3: 0, a4: 0, b1: 1, b2: 1, b3: 1 };
		const level2 = { a1: 0, a2: 0, a3: 0, b1: 1, b2: 1, b3: 1, b4: 1 };

		const first = colorByAnchor(graph, level1);
		const second = colorByAnchor(graph, level2);

		// Every topic present in both levels must keep its colour.
		for (const [anchor, color] of first) {
			if (second.has(anchor)) expect(second.get(anchor)).toBe(color);
		}
	});

	it("still gives distinct colours to distinct topics", () => {
		const communities = { a1: 0, a2: 0, a3: 0, b1: 1, b2: 1, b3: 1 };
		const colors = [...colorByAnchor(graph, communities).values()];

		expect(new Set(colors).size).toBe(colors.length);
	});

	it("is deterministic for the same grouping", () => {
		const communities = { a1: 0, a2: 0, a3: 0, b1: 1, b2: 1, b3: 1 };

		expect(colorByAnchor(graph, communities)).toEqual(colorByAnchor(graph, communities));
	});

	it("does not depend on community id numbering", () => {
		// Leiden may renumber communities between runs; colour must not follow the id.
		const asZeroOne = { a1: 0, a2: 0, a3: 0, b1: 1, b2: 1, b3: 1 };
		const asFiveNine = { a1: 5, a2: 5, a3: 5, b1: 9, b2: 9, b3: 9 };

		expect(colorByAnchor(graph, asFiveNine)).toEqual(colorByAnchor(graph, asZeroOne));
	});
});
