import { TFile, type App } from "obsidian";
import type { GraphData, GraphEdge, GraphNode } from "../../types/graph";
import { isAgentFilePath } from "../../utils/fileFiltering";
import { edgeKey } from "../../utils/graphUtils";
import type { NoteNeighbor } from "../../vectorstore";

export const DEFAULT_NOTE_CONTEXT_SEMANTIC_THRESHOLD = 0.35;

function getMarkdownFileMap(app: App): Map<string, TFile> {
	return new Map(
		app.vault
			.getMarkdownFiles()
			.filter((file) => !isAgentFilePath(file.path))
			.map((file) => [file.path, file]),
	);
}

function buildDegreeMap(edges: GraphEdge[]): Map<string, number> {
	const degreeMap = new Map<string, number>();
	for (const edge of edges) {
		degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
		degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
	}
	return degreeMap;
}

function createNodes(
	fileMap: Map<string, TFile>,
	paths: Iterable<string>,
	edges: GraphEdge[],
	activePath: string,
): GraphNode[] {
	const degreeMap = buildDegreeMap(edges);
	const nodes: GraphNode[] = [];

	for (const path of paths) {
		const file = fileMap.get(path);
		if (!file) continue;
		nodes.push({
			id: file.path,
			path: file.path,
			label: file.basename,
			x: 0,
			y: 0,
			degree: degreeMap.get(file.path) ?? 0,
			highlighted: file.path === activePath,
		});
	}

	return nodes;
}

function buildEdgesForPaths(app: App, paths: Set<string>): GraphEdge[] {
	const edges: GraphEdge[] = [];
	const seen = new Set<string>();

	for (const [sourcePath, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (!paths.has(sourcePath)) continue;

		for (const [targetPath, count] of Object.entries(targets)) {
			if (!paths.has(targetPath) || sourcePath === targetPath) continue;
			const key = edgeKey(sourcePath, targetPath);
			if (seen.has(key)) continue;
			seen.add(key);
			edges.push({
				source: sourcePath,
				target: targetPath,
				weight: count,
				type: "wiki",
			});
		}
	}

	return edges;
}

export function buildNoteContextWikiGraph(app: App, activePath: string): GraphData {
	const fileMap = getMarkdownFileMap(app);
	if (!fileMap.has(activePath)) {
		return { nodes: [], edges: [] };
	}

	const noteContextPaths = new Set<string>([activePath]);
	const outgoing = app.metadataCache.resolvedLinks[activePath] ?? {};

	for (const targetPath of Object.keys(outgoing)) {
		if (targetPath !== activePath && fileMap.has(targetPath)) {
			noteContextPaths.add(targetPath);
		}
	}

	for (const [sourcePath, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (sourcePath === activePath || !fileMap.has(sourcePath)) continue;
		if (targets[activePath] != null) {
			noteContextPaths.add(sourcePath);
		}
	}

	const edges = buildEdgesForPaths(app, noteContextPaths);
	const nodes = createNodes(fileMap, noteContextPaths, edges, activePath);

	return { nodes, edges };
}

/**
 * The active note's semantic neighbourhood. `neighbors` is the store's
 * `noteNeighbors(activePath, threshold)` result — already thresholded and
 * sorted — so this only maps it onto the vault's current markdown files.
 */
export function buildNoteContextSemanticGraph(app: App, activePath: string, neighbors: NoteNeighbor[]): GraphData {
	const fileMap = getMarkdownFileMap(app);
	if (!fileMap.has(activePath)) {
		return { nodes: [], edges: [] };
	}

	const neighborPaths = new Set<string>([activePath]);
	const edges: GraphEdge[] = [];
	for (const { path, score } of neighbors) {
		if (path === activePath || !fileMap.has(path) || neighborPaths.has(path)) continue;
		neighborPaths.add(path);
		edges.push({
			source: activePath,
			target: path,
			weight: score,
			type: "semantic",
		});
	}

	const nodes = createNodes(fileMap, neighborPaths, edges, activePath);
	return { nodes, edges };
}

export function mergeNoteContextGraph(wikiGraph: GraphData, semanticGraph: GraphData, activePath: string): GraphData {
	const nodeMap = new Map<string, GraphNode>();
	for (const node of [...wikiGraph.nodes, ...semanticGraph.nodes]) {
		nodeMap.set(node.id, {
			...node,
			highlighted: node.id === activePath,
		});
	}

	const edgeMap = new Map<string, GraphEdge>();
	for (const edge of [...wikiGraph.edges, ...semanticGraph.edges]) {
		edgeMap.set(`${edge.type}:${edgeKey(edge.source, edge.target)}`, edge);
	}

	const edges = [...edgeMap.values()];
	const degreeMap = buildDegreeMap(edges);
	const nodes = [...nodeMap.values()].map((node) => ({
		...node,
		degree: degreeMap.get(node.id) ?? 0,
		highlighted: node.id === activePath,
	}));

	return { nodes, edges };
}
