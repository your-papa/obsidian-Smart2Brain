import { describe, expect, it, vi } from "vitest";
import {
	buildGraph,
	buildGraphStructure,
	buildSemanticEdges,
	buildWikiGraph,
	applyColorGroups,
	computeClusters,
	deriveClusterLabelsFromGraph,
} from "../../src/views/smart-graph/graphDataBuilder";
import { edgeKey } from "../../src/utils/graphUtils";
import type { App, CachedMetadata, TFile } from "obsidian";
import type { DocumentVector } from "../../src/vectorstore/types";

// Mock App with resolvedLinks
function createMockApp(
	resolvedLinks: Record<string, Record<string, number>>,
	files: string[],
	fileTags: Record<string, string[]> = {},
): App {
	const mockFiles = files.map((path) => ({
		path,
		basename: path
			.replace(/\.[^.]+$/, "")
			.split("/")
			.pop(),
		extension: path.split(".").pop() ?? "md",
		name: path.split("/").pop(),
		constructor: { name: "TFile" },
	}));

	const getFileCache = vi.fn((file: TFile): CachedMetadata | null => {
		const tags = fileTags[file.path];
		if (!tags) return null;
		return {
			tags: tags.map((tag) => ({
				tag,
				position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
			})),
		} as unknown as CachedMetadata;
	});

	return {
		metadataCache: {
			resolvedLinks,
			getFileCache,
		},
		vault: {
			getMarkdownFiles: () => mockFiles.filter((f) => f.extension === "md"),
			getFiles: () => mockFiles,
			getAbstractFileByPath: (path: string) => mockFiles.find((f) => f.path === path) ?? null,
		},
	} as unknown as App;
}

function createMockDocumentVector(path: string, vector: number[]): DocumentVector {
	return {
		id: path,
		path,
		mtime: Date.now(),
		checksum: "abc123",
		vector: new Float32Array(vector),
	};
}

function createCluster(center: Float32Array, count: number, noise: number, startSeed = 0): Float32Array[] {
	const vectors: Float32Array[] = [];
	for (let i = 0; i < count; i++) {
		const vec = new Float32Array(center.length);
		for (let d = 0; d < center.length; d++) {
			const x = Math.sin((startSeed + i) * 9301 + d * 49297 + 233280) * 10000;
			const r = (x - Math.floor(x)) * 2 - 1;
			vec[d] = center[d] + r * noise;
		}
		vectors.push(vec);
	}
	return vectors;
}

const defaultSettings = {
	defaultK: 3,
	autoK: false,
	projectionMethod: "pca" as const,
	umapNeighbors: 15,
	umapMinDist: 0.1,
	layoutFidelity: 50,
	showWikiLinks: true,
	clusteringAlgorithm: "kmeans" as const,
	minClusterSize: 5,
};

describe("buildSemanticEdges", () => {
	/** Two tight topics that share no vocabulary — the shape a folder-organised vault has. */
	function createTwoTopicDocs(): DocumentVector[] {
		return [
			createMockDocumentVector("bio1.md", [1, 0, 0, 0]),
			createMockDocumentVector("bio2.md", [0.98, 0.02, 0, 0]),
			createMockDocumentVector("bio3.md", [0.96, 0.05, 0, 0]),
			createMockDocumentVector("type1.md", [0, 0, 1, 0]),
			createMockDocumentVector("type2.md", [0, 0, 0.98, 0.02]),
			createMockDocumentVector("type3.md", [0, 0.02, 0.96, 0]),
		];
	}
	const allPaths = (docs: DocumentVector[]) => new Set(docs.map((d) => d.path));

	it("connects notes within a topic and not across topics", async () => {
		const docs = createTwoTopicDocs();
		const edges = await buildSemanticEdges(docs, allPaths(docs), { threshold: 0.5 });

		expect(edges.length).toBeGreaterThan(0);
		for (const edge of edges) {
			expect(edge.type).toBe("semantic");
			// Every edge should stay inside one topic ("bio" or "type").
			expect(edge.source.slice(0, 3)).toBe(edge.target.slice(0, 3));
		}
	});

	it("emits each pair only once", async () => {
		const docs = createTwoTopicDocs();
		const edges = await buildSemanticEdges(docs, allPaths(docs), { threshold: 0.5 });

		const keys = edges.map((e) => edgeKey(e.source, e.target));
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("skips pairs that already have a wiki link", async () => {
		const docs = createTwoTopicDocs();
		const excluded = edgeKey("bio1.md", "bio2.md");
		const edges = await buildSemanticEdges(docs, allPaths(docs), {
			threshold: 0.5,
			excludeEdgeKeys: new Set([excluded]),
		});

		expect(edges.map((e) => edgeKey(e.source, e.target))).not.toContain(excluded);
	});

	it("respects the similarity threshold", async () => {
		// Deliberately graded similarities so a mid threshold discriminates:
		// a↔b are near-identical, c is loosely related, d is unrelated.
		const docs = [
			createMockDocumentVector("a.md", [1, 0, 0, 0]),
			createMockDocumentVector("b.md", [0.99, 0.14, 0, 0]),
			createMockDocumentVector("c.md", [0.7, 0.7, 0, 0]),
			createMockDocumentVector("d.md", [0, 0, 1, 0]),
		];
		const paths = allPaths(docs);

		const permissive = await buildSemanticEdges(docs, paths, { threshold: 0.5 });
		const strict = await buildSemanticEdges(docs, paths, { threshold: 0.95 });

		expect(strict.length).toBeLessThan(permissive.length);
		// Every surviving edge must clear the bar it was given.
		for (const edge of strict) {
			expect(edge.weight).toBeGreaterThanOrEqual(0.95);
		}
		// The unrelated note is never connected at a sane threshold.
		expect(strict.some((e) => e.source === "d.md" || e.target === "d.md")).toBe(false);
	});

	it("caps how many neighbours each note contributes", async () => {
		const docs = createTwoTopicDocs();
		const edges = await buildSemanticEdges(docs, allPaths(docs), { threshold: 0.0, neighborCount: 1 });

		// With k=1 each of the 6 notes proposes one partner; dedup collapses mutual picks.
		expect(edges.length).toBeLessThanOrEqual(6);
		expect(edges.length).toBeGreaterThan(0);
	});

	it("returns nothing when neighbourCount is zero", async () => {
		const docs = createTwoTopicDocs();
		expect(await buildSemanticEdges(docs, allPaths(docs), { neighborCount: 0 })).toHaveLength(0);
	});

	it("only connects notes in the include set", async () => {
		const docs = createTwoTopicDocs();
		const edges = await buildSemanticEdges(docs, new Set(["bio1.md", "bio2.md"]), { threshold: 0.5 });

		for (const edge of edges) {
			expect(["bio1.md", "bio2.md"]).toContain(edge.source);
			expect(["bio1.md", "bio2.md"]).toContain(edge.target);
		}
	});

	it("scores multi-chunk notes by their best matching chunk", async () => {
		// A note whose *second* chunk matches the target. A mean-vector approach would
		// dilute this below threshold; best-chunk keeps the pair connected.
		const docs: DocumentVector[] = [
			{ ...createMockDocumentVector("multi.md", [1, 0, 0, 0]), id: "multi.md#0", chunkIndex: 0 },
			{ ...createMockDocumentVector("multi.md", [0, 0, 1, 0]), id: "multi.md#1", chunkIndex: 1 },
			createMockDocumentVector("target.md", [0, 0, 1, 0]),
		];
		const edges = await buildSemanticEdges(docs, allPaths(docs), { threshold: 0.9 });

		expect(edges).toHaveLength(1);
		expect(edgeKey(edges[0].source, edges[0].target)).toBe(edgeKey("multi.md", "target.md"));
		expect(edges[0].weight).toBeCloseTo(1, 5);
	});

	it("returns nothing for fewer than two notes", async () => {
		const docs = [createMockDocumentVector("only.md", [1, 0, 0, 0])];
		expect(await buildSemanticEdges(docs, allPaths(docs), { threshold: 0 })).toHaveLength(0);
	});

	it("connects an unlinked note to its topic — the link-sparse vault case", async () => {
		const docs = createTwoTopicDocs();
		// bio3 has no wiki links at all; it must still reach its topic semantically.
		const edges = await buildSemanticEdges(docs, allPaths(docs), { threshold: 0.5 });
		const touchingBio3 = edges.filter((e) => e.source === "bio3.md" || e.target === "bio3.md");

		expect(touchingBio3.length).toBeGreaterThan(0);
	});
});

describe("buildGraph", () => {
	it("should return empty graph for no documents", async () => {
		const app = createMockApp({}, []);
		const result = await buildGraph(app, [], defaultSettings);
		expect(result.nodes).toHaveLength(0);
		expect(result.edges).toHaveLength(0);
	});

	it("should create nodes for all documents", async () => {
		const docs = [
			createMockDocumentVector("a.md", [1, 0, 0, 0]),
			createMockDocumentVector("b.md", [0, 1, 0, 0]),
			createMockDocumentVector("c.md", [0, 0, 1, 0]),
		];
		const app = createMockApp({}, ["a.md", "b.md", "c.md"]);
		const result = await buildGraph(app, docs, {
			...defaultSettings,
			defaultK: 2,
		});
		expect(result.nodes).toHaveLength(3);
		expect(result.edges).toHaveLength(0);
	});

	it("should assign cluster colors", async () => {
		const docs = [
			createMockDocumentVector("a.md", [1, 0.9, 0, 0]),
			createMockDocumentVector("b.md", [0.9, 1, 0, 0]),
			createMockDocumentVector("c.md", [0, 0, 1, 0.9]),
			createMockDocumentVector("d.md", [0, 0, 0.9, 1]),
		];
		const app = createMockApp({}, ["a.md", "b.md", "c.md", "d.md"]);
		const result = await buildGraph(app, docs, {
			...defaultSettings,
			defaultK: 2,
		});

		for (const node of result.nodes) {
			expect(node.color).toBeDefined();
			expect(node.cluster).toBeDefined();
		}
	});

	it("should include wiki edges when showWikiLinks is true", async () => {
		const docs = [
			createMockDocumentVector("a.md", [1, 0.9, 0, 0]),
			createMockDocumentVector("b.md", [0.9, 1, 0, 0]),
			createMockDocumentVector("c.md", [0, 0, 1, 0]),
		];
		const app = createMockApp({ "a.md": { "b.md": 1 } }, ["a.md", "b.md", "c.md"]);
		const result = await buildGraph(app, docs, {
			...defaultSettings,
			showWikiLinks: true,
		});

		const wikiEdges = result.edges.filter((e) => e.type === "wiki");

		expect(wikiEdges.length).toBeGreaterThan(0);
		expect(result.edges).toEqual(wikiEdges);
	});

	it("should omit wiki edges when showWikiLinks is false", async () => {
		const docs = [
			createMockDocumentVector("a.md", [1, 0, 0, 0]),
			createMockDocumentVector("b.md", [0, 1, 0, 0]),
			createMockDocumentVector("c.md", [0, 0, 1, 0]),
		];
		const app = createMockApp({ "a.md": { "b.md": 1 }, "b.md": { "c.md": 2 } }, ["a.md", "b.md", "c.md"]);
		const result = await buildGraph(app, docs, {
			...defaultSettings,
			showWikiLinks: false,
		});

		expect(result.edges).toHaveLength(0);
	});

	it("should not duplicate wiki edges", async () => {
		const docs = [createMockDocumentVector("a.md", [1, 0, 0, 0]), createMockDocumentVector("b.md", [0, 1, 0, 0])];
		// Both directions in resolvedLinks
		const app = createMockApp({ "a.md": { "b.md": 1 }, "b.md": { "a.md": 1 } }, ["a.md", "b.md"]);
		const result = await buildGraph(app, docs, {
			...defaultSettings,
		});

		const wikiEdges = result.edges.filter((e) => e.type === "wiki");
		// Should only have one wiki edge between a and b, not two
		expect(wikiEdges).toHaveLength(1);
	});

	it("should not create self-loop wiki edges", async () => {
		const docs = [createMockDocumentVector("a.md", [1, 0, 0, 0])];
		const app = createMockApp({ "a.md": { "a.md": 1 } }, ["a.md"]);
		const result = await buildGraph(app, docs, {
			...defaultSettings,
		});

		const wikiEdges = result.edges.filter((e) => e.type === "wiki");
		expect(wikiEdges).toHaveLength(0);
	});

	it("should include unlinked notes in the projected smart graph", async () => {
		const docs = [
			createMockDocumentVector("a.md", [1, 0.9, 0, 0]),
			createMockDocumentVector("b.md", [0.9, 1, 0, 0]),
			createMockDocumentVector("orphan.md", [0, 0, 0, 1]),
		];
		const app = createMockApp({ "a.md": { "b.md": 1 } }, ["a.md", "b.md", "orphan.md"]);
		const result = await buildGraph(app, docs, {
			...defaultSettings,
		});

		const orphanNode = result.nodes.find((n) => n.id === "orphan.md");
		expect(orphanNode).toBeDefined();
	});

	it("should set node labels from file basename", async () => {
		const docs = [createMockDocumentVector("folder/My Note.md", [1, 0, 0, 0])];
		const app = createMockApp({}, ["folder/My Note.md"]);
		const result = await buildGraph(app, docs, defaultSettings);
		expect(result.nodes[0].label).toBe("My Note");
	});

	it("should reduce projection dimensions more aggressively when layout fidelity is lower", async () => {
		const docs = Array.from({ length: 520 }, (_, index) => {
			const vector = Array.from({ length: 64 }, (_, dim) => Math.sin(index * 0.07 + dim * 0.11));
			return createMockDocumentVector(`doc-${index}.md`, vector);
		});
		const app = createMockApp(
			{},
			docs.map((doc) => doc.path),
		);

		const fast = await buildGraphStructure(app, docs, {
			projectionMethod: "pca",
			umapNeighbors: 15,
			umapMinDist: 0.1,
			layoutFidelity: 0,
			showWikiLinks: true,
		});
		const faithful = await buildGraphStructure(app, docs, {
			projectionMethod: "pca",
			umapNeighbors: 15,
			umapMinDist: 0.1,
			layoutFidelity: 100,
			showWikiLinks: true,
		});

		expect(fast.reducedVectors[0].length).toBeLessThan(faithful.reducedVectors[0].length);
	});
});

describe("computeClusters", () => {
	it("should keep graph nodes unclustered when HDBSCAN finds no real clusters", async () => {
		const docs = [
			createMockDocumentVector("a.md", [0, 0]),
			createMockDocumentVector("b.md", [100, 0]),
			createMockDocumentVector("c.md", [0, 100]),
		];

		const result = await computeClusters(
			docs,
			docs.map((doc) => doc.vector),
			{
				...defaultSettings,
				clusteringAlgorithm: "hdbscan",
				minClusterSize: 5,
			},
		);

		expect(result.k).toBe(0);
		for (const assignment of result.clusterMap.values()) {
			expect(assignment.cluster).toBeUndefined();
			expect(assignment.color).toBe("hsl(0, 0%, 50%)");
		}
	});

	it("should keep HDBSCAN noise points gray by default", async () => {
		const docs = [
			...createCluster(new Float32Array([0, 0]), 10, 0.15, 10).map((vector, index) =>
				createMockDocumentVector(`left-${index}.md`, [...vector]),
			),
			...createCluster(new Float32Array([8, 8]), 10, 0.15, 40).map((vector, index) =>
				createMockDocumentVector(`right-${index}.md`, [...vector]),
			),
			createMockDocumentVector("outlier.md", [4, 4]),
		];

		const vectors = docs.map((doc) => doc.vector);
		const result = await computeClusters(
			docs,
			vectors,
			{
				...defaultSettings,
				clusteringAlgorithm: "hdbscan",
				minClusterSize: 5,
			},
			undefined,
			vectors,
		);

		expect(result.k).toBe(2);
		const outlier = result.clusterMap.get("outlier.md");
		expect(outlier?.cluster).toBeUndefined();
		expect(outlier?.color).toBe("hsl(0, 0%, 50%)");
	});

	it("should use the large-graph HDBSCAN fast path for very large inputs", async () => {
		const docs = [
			...createCluster(new Float32Array([0, 0]), 1050, 0.2, 10).map((vector, index) =>
				createMockDocumentVector(`left-large-${index}.md`, [...vector]),
			),
			...createCluster(new Float32Array([10, 10]), 1050, 0.2, 2000).map((vector, index) =>
				createMockDocumentVector(`right-large-${index}.md`, [...vector]),
			),
			createMockDocumentVector("far-outlier.md", [100, 100]),
		];

		const vectors = docs.map((doc) => doc.vector);
		const result = await computeClusters(
			docs,
			vectors,
			{
				...defaultSettings,
				clusteringAlgorithm: "hdbscan",
				minClusterSize: 15,
			},
			undefined,
			vectors,
		);

		expect(result.k).toBeGreaterThanOrEqual(2);
		const assignedClusters = new Set(
			[...result.clusterMap.values()].flatMap((assignment) =>
				assignment.cluster === undefined ? [] : [assignment.cluster],
			),
		);
		expect(assignedClusters.size).toBeGreaterThanOrEqual(2);

		const outlier = result.clusterMap.get("far-outlier.md");
		expect(outlier?.cluster).toBeUndefined();
		expect(outlier?.color).toBe("hsl(0, 0%, 50%)");
	});
});

describe("deriveClusterLabelsFromGraph", () => {
	it("should prefer the node with the most internal cluster connections", () => {
		const graphData = {
			nodes: [
				{ id: "hub.md", path: "hub.md", label: "Hub", x: 0, y: 0, cluster: 0, degree: 5 },
				{ id: "leaf-a.md", path: "leaf-a.md", label: "Leaf A", x: 0, y: 0, cluster: 0, degree: 3 },
				{ id: "leaf-b.md", path: "leaf-b.md", label: "Leaf B", x: 0, y: 0, cluster: 0, degree: 2 },
				{ id: "other.md", path: "other.md", label: "Other", x: 0, y: 0, cluster: 1, degree: 1 },
			],
			edges: [
				{ source: "hub.md", target: "leaf-a.md", weight: 1, type: "wiki" as const },
				{ source: "hub.md", target: "leaf-b.md", weight: 1, type: "wiki" as const },
				{ source: "leaf-a.md", target: "other.md", weight: 1, type: "wiki" as const },
			],
		};

		const labels = deriveClusterLabelsFromGraph(graphData);

		expect(labels[0]).toBe("Hub");
		expect(labels[1]).toBe("Other");
	});

	it("should fall back to total degree when a cluster has no internal edges", () => {
		const graphData = {
			nodes: [
				{ id: "higher.md", path: "higher.md", label: "Higher", x: 0, y: 0, cluster: 0, degree: 4 },
				{ id: "lower.md", path: "lower.md", label: "Lower", x: 0, y: 0, cluster: 0, degree: 1 },
			],
			edges: [],
		};

		const labels = deriveClusterLabelsFromGraph(graphData);

		expect(labels[0]).toBe("Higher");
	});
});

describe("buildWikiGraph", () => {
	it("should create wiki nodes from vault markdown files without vectors", () => {
		const app = createMockApp({ "a.md": { "b.md": 1 }, "b.md": { "c.md": 1 } }, ["a.md", "b.md", "c.md"]);

		const result = buildWikiGraph(app);

		expect(result.graphData.nodes).toHaveLength(3);
		expect(result.graphData.edges).toHaveLength(2);
		expect(result.filteredPaths).toEqual(["a.md", "b.md", "c.md"]);
	});

	it("should respect folder and tag filters for wiki mode", () => {
		const app = createMockApp(
			{ "Work/a.md": { "Work/b.md": 1 }, "Ideas/c.md": { "Work/a.md": 1 } },
			["Work/a.md", "Work/b.md", "Ideas/c.md"],
			{ "Work/a.md": ["#focus"], "Work/b.md": ["#focus"], "Ideas/c.md": ["#other"] },
		);

		const result = buildWikiGraph(app, { folders: ["Work"], tags: ["#focus"] });

		expect(result.graphData.nodes.map((n) => n.id).sort((a, b) => a.localeCompare(b))).toEqual([
			"Work/a.md",
			"Work/b.md",
		]);
		expect(result.graphData.edges).toHaveLength(1);
	});
});

describe("applyColorGroups", () => {
	it("should color wiki nodes by first matching folder or tag rule", () => {
		const app = createMockApp({}, ["Work/a.md", "Ideas/b.md"], {
			"Work/a.md": ["#focus"],
			"Ideas/b.md": ["#focus"],
		});

		const graphData = {
			nodes: [
				{ id: "Work/a.md", path: "Work/a.md", label: "a", x: 0, y: 0 },
				{ id: "Ideas/b.md", path: "Ideas/b.md", label: "b", x: 0, y: 0 },
			],
			edges: [],
		};

		const result = applyColorGroups(app, graphData, [
			{ query: "#focus", color: "#ff0000" },
			{ query: "Work", color: "#00ff00" },
		]);

		expect(result.nodes[0].color).toBe("#ff0000");
		expect(result.nodes[1].color).toBe("#ff0000");
	});
});
