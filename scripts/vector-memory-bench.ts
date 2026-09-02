/**
 * Vector index memory benchmark (#432 part 1).
 *
 * Measures the resident heap of a loaded HNSW index, per vector representation,
 * on a synthetic corpus shaped like the reference vault. Run with:
 *
 *   bun run bench:vector-memory            # 20 000 chunks × 1536 dims
 *   bun run bench:vector-memory 25000 1536 # custom chunk count / dims
 *
 * Three shapes are measured, all holding the same graph nodes (id, level,
 * neighbour lists) so only the vector representation differs:
 *
 *   before (build session)  — nodes whose vector is a `number[]`: what the pre-v3
 *                             store handed the `hnsw` library during a build and on
 *                             every incremental upsert (`Array.from(vector)`).
 *   before (load peak)      — the pre-v3 `loadIndex()` transient: the persisted JSON
 *                             blob (`number[]` per node) fully materialised alongside
 *                             the `Float32Array` nodes `fromJSON` builds from it.
 *   after                   — v3: one `Float32Array` per node, the same array that
 *                             came out of IndexedDB, and nothing else.
 *
 * Each shape is measured in its own child process (resident-set delta over the
 * process's baseline, after a forced GC), because an allocator hands freed
 * pages back to the next allocation rather than to the OS — measuring the three
 * shapes back to back in one process would make the later ones look free. The
 * printed bytes are what the WebContent process must keep resident for the
 * index alone.
 */

const SHAPES = ["before (build session)", "before (load peak)", "after (v3, Float32Array)"] as const;
type Shape = (typeof SHAPES)[number];

const chunkCount = Number(process.argv[2] ?? 20_000);
const dims = Number(process.argv[3] ?? 1536);
/** Set on the child invocations; the parent runs one child per shape. */
const shapeArg = process.argv[4] as Shape | undefined;
const M = 16;

interface NodeShape {
	id: number;
	level: number;
	vector: number[] | Float32Array;
	neighbors: number[][];
}

function gc(): void {
	// Bun exposes a synchronous full collection; Node needs --expose-gc.
	const g = (globalThis as { Bun?: { gc: (full: boolean) => void }; gc?: () => void }).Bun?.gc ?? globalThis.gc;
	if (!g) throw new Error("Run under bun (or node --expose-gc) so the heap can be collected between measurements.");
	for (let i = 0; i < 3; i++) g(true);
}

/**
 * Resident set size, not `heapUsed`: typed-array backing stores live outside the
 * JS heap in both JavaScriptCore and V8, so the heap counter would report the
 * Float32Array shape as nearly free. RSS is what the OS (and iOS's jetsam) sees.
 */
function residentBytes(): number {
	gc();
	return process.memoryUsage().rss;
}

/** Deterministic pseudo-random unit-ish vector so every shape holds identical values. */
function fillVector(target: Float32Array | number[], seed: number): void {
	let state = seed * 2654435761 + 1;
	for (let i = 0; i < target.length; i++) {
		state = (state * 1664525 + 1013904223) >>> 0;
		target[i] = state / 0xffffffff - 0.5;
	}
}

/** HNSW neighbour lists: M links on level 0, geometrically fewer nodes on higher levels. */
function makeNeighbors(id: number, level: number): number[][] {
	const lists: number[][] = [];
	for (let l = 0; l <= level; l++) {
		const links: number[] = [];
		for (let k = 0; k < M; k++) links.push((id * 31 + k * 7919 + l) % chunkCount);
		lists.push(links);
	}
	return lists;
}

function levelFor(id: number): number {
	let level = 0;
	let x = id;
	while (x % M === 0 && x > 0 && level < 4) {
		level++;
		x /= M;
	}
	return level;
}

function buildNodes(kind: "double" | "float32"): Map<number, NodeShape> {
	const nodes = new Map<number, NodeShape>();
	for (let id = 0; id < chunkCount; id++) {
		const vector = kind === "double" ? new Array<number>(dims) : new Float32Array(dims);
		fillVector(vector, id);
		nodes.set(id, { id, level: levelFor(id), vector, neighbors: makeNeighbors(id, levelFor(id)) });
	}
	return nodes;
}

/** The pre-v3 persisted blob as `hnsw`'s `toJSON()` produced it, then `fromJSON()`'s Float32 nodes beside it. */
function buildLegacyLoadPeak(): { blob: unknown; nodes: Map<number, NodeShape> } {
	const blobNodes: Array<[number, { id: number; level: number; vector: number[]; neighbors: number[][] }]> = [];
	for (let id = 0; id < chunkCount; id++) {
		const vector = new Array<number>(dims);
		fillVector(vector, id);
		blobNodes.push([id, { id, level: levelFor(id), vector, neighbors: makeNeighbors(id, levelFor(id)) }]);
	}
	const blob = { M, efConstruction: 100, efSearch: 100, metric: "cosine", d: dims, nodes: blobNodes };
	const nodes = new Map<number, NodeShape>();
	for (const [id, node] of blobNodes) {
		nodes.set(id, {
			id,
			level: node.level,
			vector: new Float32Array(node.vector),
			neighbors: node.neighbors.map((l) => [...l]),
		});
	}
	return { blob, nodes };
}

function mb(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildShape(shape: Shape): unknown {
	switch (shape) {
		case "before (build session)":
			return buildNodes("double");
		case "before (load peak)":
			return buildLegacyLoadPeak();
		case "after (v3, Float32Array)":
			return buildNodes("float32");
	}
}

if (shapeArg) {
	// Child: build one shape, keep it alive, report the resident delta.
	const baseline = residentBytes();
	const keep = buildShape(shapeArg);
	const bytes = residentBytes() - baseline;
	console.log(String(bytes));
	// Keep the shape reachable until after the measurement.
	if (keep === null) throw new Error("unreachable");
} else {
	console.log(`Synthetic index: ${chunkCount} chunks × ${dims} dims (M=${M})`);
	console.log(
		`Raw vector payload as float32: ${mb(chunkCount * dims * 4)}; as doubles: ${mb(chunkCount * dims * 8)}\n`,
	);

	const results = new Map<Shape, number>();
	for (const shape of SHAPES) {
		const child = Bun.spawnSync([
			process.execPath,
			"run",
			import.meta.path,
			String(chunkCount),
			String(dims),
			shape,
		]);
		const output = child.stdout.toString().trim();
		const bytes = Number(output);
		if (!child.success || !Number.isFinite(bytes)) {
			throw new Error(`Measuring "${shape}" failed: ${child.stderr.toString() || output}`);
		}
		results.set(shape, bytes);
		console.log(`${shape.padEnd(28)} ${mb(bytes).padStart(10)}`);
	}

	const after = results.get("after (v3, Float32Array)") ?? 0;
	console.log("");
	for (const shape of SHAPES.slice(0, 2)) {
		const before = results.get(shape) ?? 0;
		console.log(`${shape.padEnd(28)} → after: ${((100 * after) / before).toFixed(0)}% of before`);
	}
}
