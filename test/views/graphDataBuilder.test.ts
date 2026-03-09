import { describe, expect, it, vi, beforeEach } from "vitest";
import {
    buildGraph,
    buildWikiGraph,
    applyColorGroups,
    applySearchHighlight,
} from "../../src/views/smart-graph/graphDataBuilder";
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
        basename: path.replace(/\.md$/, "").split("/").pop(),
        extension: "md",
        name: path.split("/").pop(),
        constructor: { name: "TFile" },
    }));

    const getFileCache = vi.fn((file: TFile): CachedMetadata | null => {
        const tags = fileTags[file.path];
        if (!tags) return null;
        return {
            tags: tags.map((tag) => ({ tag, position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } })),
        } as unknown as CachedMetadata;
    });

    return {
        metadataCache: {
            resolvedLinks,
            getFileCache,
        },
        vault: {
            getMarkdownFiles: () => mockFiles,
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

const defaultSettings = {
    defaultK: 3,
    autoK: false,
    semanticNeighbors: 3,
    similarityThreshold: 0.3,
    showOrphans: true,
    projectionMethod: "pca" as const,
    umapNeighbors: 15,
    umapMinDist: 0.1,
    showWikiLinks: true,
    showSemanticEdges: true,
    clusteringAlgorithm: "kmeans" as const,
    minClusterSize: 5,
};

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
            semanticNeighbors: 2,
            similarityThreshold: 0,
        });
        expect(result.nodes).toHaveLength(3);
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
            semanticNeighbors: 2,
            similarityThreshold: 0,
        });

        for (const node of result.nodes) {
            expect(node.color).toBeDefined();
            expect(node.cluster).toBeDefined();
        }
    });

    it("should always include wiki edges in graph data", async () => {
        const docs = [
            createMockDocumentVector("a.md", [1, 0.9, 0, 0]),
            createMockDocumentVector("b.md", [0.9, 1, 0, 0]),
            createMockDocumentVector("c.md", [0, 0, 1, 0]),
        ];
        const app = createMockApp({ "a.md": { "b.md": 1 } }, ["a.md", "b.md", "c.md"]);
        const result = await buildGraph(app, docs, {
            ...defaultSettings,
            showWikiLinks: true,
            showSemanticEdges: true,
            semanticNeighbors: 2,
            similarityThreshold: 0,
        });

        const wikiEdges = result.edges.filter((e) => e.type === "wiki");
        const semanticEdges = result.edges.filter((e) => e.type === "semantic");

        expect(wikiEdges.length).toBeGreaterThan(0);
        expect(semanticEdges.length).toBeGreaterThan(0);
    });

    it("should overlay wiki link edges when showWikiLinks is true", async () => {
        const docs = [
            createMockDocumentVector("a.md", [1, 0, 0, 0]),
            createMockDocumentVector("b.md", [0, 1, 0, 0]),
            createMockDocumentVector("c.md", [0, 0, 1, 0]),
        ];
        const app = createMockApp(
            { "a.md": { "b.md": 1 }, "b.md": { "c.md": 2 } },
            ["a.md", "b.md", "c.md"],
        );
        const result = await buildGraph(app, docs, {
            ...defaultSettings,
            semanticNeighbors: 1,
            similarityThreshold: 0,
        });

        const wikiEdges = result.edges.filter((e) => e.type === "wiki");
        const semanticEdges = result.edges.filter((e) => e.type === "semantic");

        expect(wikiEdges.length).toBeGreaterThan(0);
        expect(semanticEdges.length).toBeGreaterThan(0);
    });

    it("should not duplicate wiki edges", async () => {
        const docs = [
            createMockDocumentVector("a.md", [1, 0, 0, 0]),
            createMockDocumentVector("b.md", [0, 1, 0, 0]),
        ];
        // Both directions in resolvedLinks
        const app = createMockApp(
            { "a.md": { "b.md": 1 }, "b.md": { "a.md": 1 } },
            ["a.md", "b.md"],
        );
        const result = await buildGraph(app, docs, {
            ...defaultSettings,
            similarityThreshold: 0.99, // high threshold to minimize semantic edges
        });

        const wikiEdges = result.edges.filter((e) => e.type === "wiki");
        // Should only have one wiki edge between a and b, not two
        expect(wikiEdges).toHaveLength(1);
    });

    it("should not create self-loop wiki edges", async () => {
        const docs = [
            createMockDocumentVector("a.md", [1, 0, 0, 0]),
        ];
        const app = createMockApp({ "a.md": { "a.md": 1 } }, ["a.md"]);
        const result = await buildGraph(app, docs, {
            ...defaultSettings,
        });

        const wikiEdges = result.edges.filter((e) => e.type === "wiki");
        expect(wikiEdges).toHaveLength(0);
    });

    it("should hide orphans when showOrphans is false", async () => {
        const docs = [
            createMockDocumentVector("a.md", [1, 0.9, 0, 0]),
            createMockDocumentVector("b.md", [0.9, 1, 0, 0]),
            createMockDocumentVector("orphan.md", [0, 0, 0, 1]),
        ];
        const app = createMockApp({}, ["a.md", "b.md", "orphan.md"]);
        const result = await buildGraph(app, docs, {
            ...defaultSettings,
            showOrphans: false,
            semanticNeighbors: 1,
            similarityThreshold: 0.5,
        });

        // orphan.md should be excluded if it has no edges
        const orphanNode = result.nodes.find((n) => n.id === "orphan.md");
        if (orphanNode) {
            // If it exists, it must have at least one edge
            const hasEdge = result.edges.some(
                (e) => e.source === "orphan.md" || e.target === "orphan.md",
            );
            expect(hasEdge).toBe(true);
        }
    });

    it("should set node labels from file basename", async () => {
        const docs = [
            createMockDocumentVector("folder/My Note.md", [1, 0, 0, 0]),
        ];
        const app = createMockApp({}, ["folder/My Note.md"]);
        const result = await buildGraph(app, docs, defaultSettings);
        expect(result.nodes[0].label).toBe("My Note");
    });
});

describe("buildWikiGraph", () => {
    it("should create wiki nodes from vault markdown files without vectors", () => {
        const app = createMockApp(
            { "a.md": { "b.md": 1 }, "b.md": { "c.md": 1 } },
            ["a.md", "b.md", "c.md"],
        );

        const result = buildWikiGraph(app, { showOrphans: true });

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

        const result = buildWikiGraph(
            app,
            { showOrphans: true },
            { folders: ["Work"], tags: ["#focus"] },
        );

        expect(result.graphData.nodes.map((n) => n.id).sort()).toEqual(["Work/a.md", "Work/b.md"]);
        expect(result.graphData.edges).toHaveLength(1);
    });
});

describe("applyColorGroups", () => {
    it("should color wiki nodes by first matching folder or tag rule", () => {
        const app = createMockApp(
            {},
            ["Work/a.md", "Ideas/b.md"],
            { "Work/a.md": ["#focus"], "Ideas/b.md": ["#focus"] },
        );

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

describe("applySearchHighlight", () => {
    const baseData = {
        nodes: [
            { id: "note1.md", path: "note1.md", label: "Note One", x: 0, y: 0 },
            { id: "folder/note2.md", path: "folder/note2.md", label: "Note Two", x: 0, y: 0 },
            { id: "other.md", path: "other.md", label: "Other", x: 0, y: 0 },
        ],
        edges: [],
    };

    it("should highlight matching nodes by label", () => {
        const result = applySearchHighlight(baseData, "One");
        expect(result.nodes[0].highlighted).toBe(true);
        expect(result.nodes[1].highlighted).toBe(false);
        expect(result.nodes[2].highlighted).toBe(false);
    });

    it("should highlight matching nodes by path", () => {
        const result = applySearchHighlight(baseData, "folder");
        expect(result.nodes[0].highlighted).toBe(false);
        expect(result.nodes[1].highlighted).toBe(true);
        expect(result.nodes[2].highlighted).toBe(false);
    });

    it("should be case-insensitive", () => {
        const result = applySearchHighlight(baseData, "note");
        expect(result.nodes[0].highlighted).toBe(true);
        expect(result.nodes[1].highlighted).toBe(true);
        expect(result.nodes[2].highlighted).toBe(false);
    });

    it("should clear highlights for empty query", () => {
        const result = applySearchHighlight(baseData, "");
        expect(result.nodes.every((n) => n.highlighted === false)).toBe(true);
    });
});
