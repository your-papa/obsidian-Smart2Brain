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
