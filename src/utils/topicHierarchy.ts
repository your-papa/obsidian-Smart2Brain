/**
 * Topic Hierarchy
 *
 * Nests fine-grained topics inside broader ones so the graph can answer "what
 * is this vault about?" at more than one altitude.
 *
 * Leiden returns a flat partition, so the hierarchy is built by running it
 * twice — once at a coarse resolution and once at a fine one — and assigning
 * each fine topic to the coarse topic that holds most of its notes. That keeps
 * the levels consistent with each other (every note rolls up somewhere) while
 * leaving both resolutions under user control.
 *
 * Pure and dependency-free so it can be unit tested and, if it ever gets
 * expensive, moved into the compute worker.
 */

/** A community assignment: node id → community id. */
export type CommunityMap = Record<string, number>;

export interface TopicHierarchyNode {
	/** Fine-level (child) topic id. */
	id: number;
	/** Coarse-level (parent) topic id this child rolls up into. */
	parentId: number;
	/** Node ids belonging to this child topic. */
	members: string[];
}

export interface TopicHierarchy {
	/** Child topics, each pointing at its parent. */
	children: TopicHierarchyNode[];
	/** Parent topic id → the node ids of every child beneath it. */
	parents: Map<number, string[]>;
	/** Node id → parent topic id, for colouring/rollup at the coarse level. */
	parentOfNode: CommunityMap;
}

/**
 * Build a two-level hierarchy from a coarse and a fine partition of the same
 * graph.
 *
 * A child is placed under whichever parent claims the plurality of its members;
 * ties break on the lower parent id so the result is deterministic. Nodes the
 * coarse run left unassigned don't vote — a child whose members are entirely
 * unassigned at the coarse level is dropped, since it has nothing to roll up
 * into.
 */
export function buildTopicHierarchy(coarse: CommunityMap, fine: CommunityMap): TopicHierarchy {
	const membersByChild = new Map<number, string[]>();
	for (const [nodeId, childId] of Object.entries(fine)) {
		const list = membersByChild.get(childId);
		if (list) list.push(nodeId);
		else membersByChild.set(childId, [nodeId]);
	}

	const children: TopicHierarchyNode[] = [];
	const parents = new Map<number, string[]>();
	const parentOfNode: CommunityMap = {};

	for (const [childId, members] of [...membersByChild.entries()].sort((a, b) => a[0] - b[0])) {
		// Vote: which coarse topic do most of this child's notes belong to?
		const votes = new Map<number, number>();
		for (const nodeId of members) {
			const parentId = coarse[nodeId];
			if (parentId === undefined) continue;
			votes.set(parentId, (votes.get(parentId) ?? 0) + 1);
		}
		if (votes.size === 0) continue;

		let parentId = Number.POSITIVE_INFINITY;
		let best = -1;
		for (const [candidate, count] of votes) {
			if (count > best || (count === best && candidate < parentId)) {
				best = count;
				parentId = candidate;
			}
		}

		children.push({ id: childId, parentId, members: [...members].sort() });

		const bucket = parents.get(parentId);
		if (bucket) bucket.push(...members);
		else parents.set(parentId, [...members]);

		for (const nodeId of members) {
			parentOfNode[nodeId] = parentId;
		}
	}

	for (const [parentId, nodeIds] of parents) {
		parents.set(parentId, nodeIds.sort());
	}

	return { children, parents, parentOfNode };
}

/**
 * Count how many distinct child topics sit under each parent. Used to label a
 * collapsed parent ("Marine Biology · 4 subtopics").
 */
export function countChildrenByParent(hierarchy: TopicHierarchy): Map<number, number> {
	const counts = new Map<number, number>();
	for (const child of hierarchy.children) {
		counts.set(child.parentId, (counts.get(child.parentId) ?? 0) + 1);
	}
	return counts;
}

/**
 * Resolution multiplier applied to the user's γ to obtain the coarse level.
 *
 * Leiden's γ is inverse to community count — lower γ yields fewer, broader
 * communities — so the parent level uses a fraction of the current value.
 */
export const COARSE_RESOLUTION_FACTOR = 0.35;

/** Derive the coarse resolution for a given fine resolution. */
export function coarseResolutionFor(fineResolution: number): number {
	// Clamped so an already-low γ doesn't collapse to a single meaningless blob.
	return Math.max(0.05, fineResolution * COARSE_RESOLUTION_FACTOR);
}

// ============================================================================
// Granularity
// ============================================================================

/**
 * Granularity exposes Leiden's resolution γ as a small ladder of named levels.
 *
 * γ itself is a poor thing to show a user: the useful range is non-linear (0.1 →
 * 0.4 reshapes the graph far more than 2.0 → 2.3), and a continuous control
 * implies precision that doesn't exist — dozens of nearby γ values collapse to
 * the exact same partition while each one still costs a Leiden run.
 *
 * Discrete levels instead, each a distinct grouping the user can return to.
 *
 * Which γ values become levels is **derived per vault** ({@link deriveGranularityLadder}),
 * not fixed: how many distinct groupings exist depends entirely on a vault's size
 * and structure. A small, uniform vault may only support four meaningfully
 * different partitions; a large varied one may support a dozen. This ladder is
 * only the fallback used before the probe has run.
 */
export const GRANULARITY_LEVEL_RESOLUTIONS = [0.15, 0.5, 1.0, 1.5, 2.2, 3.0, 4.2, 6.0] as const;

/**
 * γ values probed when deriving a vault's ladder.
 *
 * Spans well past the fallback's range at both ends, since a very large vault
 * needs high γ to split at all while a tiny one saturates early. Probing is
 * cheap relative to its payoff: each result also warms the Leiden cache, so
 * every granularity step afterwards is instant.
 */
export const GRANULARITY_PROBE_RESOLUTIONS = [
	0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.4, 1.8, 2.4, 3.0, 4.0, 5.0, 6.5, 8.0,
] as const;

/** Never derive a ladder longer than this, however varied the vault. */
export const MAX_DERIVED_GRANULARITY_LEVELS = 10;

/**
 * Smallest group that counts as a topic.
 *
 * A single note isn't a topic — it's a note that failed to join one. Push γ high
 * enough and Leiden will happily shatter a vault into hundreds of one-note
 * "topics", which is noise rather than a level worth offering.
 */
export const MIN_TOPIC_SIZE = 2;

/**
 * Fraction of a partition that may be singletons before the level is rejected.
 *
 * Some strays are unavoidable — a genuinely unrelated note has nowhere to go —
 * but once most groups are single notes the partition has stopped describing
 * structure.
 */
export const MAX_SINGLETON_SHARE = 0.5;

/**
 * Summarise a partition for laddering: how many real topics it has, and whether
 * it has fragmented into mostly singletons.
 *
 * Takes the community map directly so callers don't each re-derive group sizes.
 */
export function summarizePartition(communities: CommunityMap): { topicCount: number; isFragmented: boolean } {
	const sizes = new Map<number, number>();
	for (const community of Object.values(communities)) {
		sizes.set(community, (sizes.get(community) ?? 0) + 1);
	}
	if (sizes.size === 0) return { topicCount: 0, isFragmented: false };

	let realTopics = 0;
	let singletons = 0;
	for (const size of sizes.values()) {
		if (size >= MIN_TOPIC_SIZE) realTopics++;
		else singletons++;
	}

	return {
		topicCount: realTopics,
		isFragmented: singletons / sizes.size > MAX_SINGLETON_SHARE,
	};
}

/**
 * Choose the ladder's rungs from probe results.
 *
 * Keeps the *first* γ producing each distinct topic count, so every step visibly
 * changes the grouping and adjacent rungs are never duplicates. Two kinds of
 * probe are discarded outright: those that found no topics (γ too low to
 * separate anything, or a graph with no edges), and those flagged as fragmented
 * — a γ so high that the vault shattered into mostly one-note groups is not a
 * level worth offering.
 *
 * Returns null when fewer than two usable levels exist — the caller falls back
 * to the static ladder rather than showing a slider that cannot move.
 */
export function deriveGranularityLadder(
	probes: Array<{ resolution: number; topicCount: number; isFragmented?: boolean }>,
): number[] | null {
	const byCount = new Map<number, number>();
	for (const probe of [...probes].sort((a, b) => a.resolution - b.resolution)) {
		if (probe.topicCount <= 0 || probe.isFragmented) continue;
		// First γ to reach this count wins — the lowest γ giving a grouping is the
		// most stable representative of it.
		if (!byCount.has(probe.topicCount)) byCount.set(probe.topicCount, probe.resolution);
	}

	const ladder = [...byCount.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, resolution]) => resolution)
		.sort((a, b) => a - b);

	if (ladder.length < 2) return null;
	if (ladder.length <= MAX_DERIVED_GRANULARITY_LEVELS) return ladder;

	// Too many distinct groupings — keep the endpoints and sample evenly between
	// them so the slider stays a manageable length.
	const trimmed: number[] = [];
	for (let i = 0; i < MAX_DERIVED_GRANULARITY_LEVELS; i++) {
		const index = Math.round((i / (MAX_DERIVED_GRANULARITY_LEVELS - 1)) * (ladder.length - 1));
		const value = ladder[index];
		if (!trimmed.includes(value)) trimmed.push(value);
	}
	return trimmed;
}

/** Lowest selectable granularity level (broadest topics). */
export const MIN_GRANULARITY_LEVEL = 1;

/** Highest level on a given ladder. */
export function maxGranularityLevel(ladder: readonly number[] = GRANULARITY_LEVEL_RESOLUTIONS): number {
	return Math.max(MIN_GRANULARITY_LEVEL, ladder.length);
}

export const MIN_GRANULARITY_RESOLUTION = GRANULARITY_LEVEL_RESOLUTIONS[0];
export const MAX_GRANULARITY_RESOLUTION = GRANULARITY_LEVEL_RESOLUTIONS[GRANULARITY_LEVEL_RESOLUTIONS.length - 1];

/** Convert a 1-based granularity level to a Leiden resolution. Level 1 = broadest. */
export function granularityToResolution(
	level: number,
	ladder: readonly number[] = GRANULARITY_LEVEL_RESOLUTIONS,
): number {
	const rungs = ladder.length > 0 ? ladder : GRANULARITY_LEVEL_RESOLUTIONS;
	const clamped = Math.min(rungs.length, Math.max(MIN_GRANULARITY_LEVEL, Math.round(level)));
	return rungs[clamped - 1];
}

/**
 * Inverse of {@link granularityToResolution}, for restoring the slider from a stored γ.
 *
 * A stored γ needn't be one of the ladder values — it may predate this mapping,
 * come from the dev panel, or belong to a ladder derived before the vault
 * changed — so this snaps to the nearest level rather than requiring an exact
 * match.
 */
export function resolutionToGranularity(
	resolution: number,
	ladder: readonly number[] = GRANULARITY_LEVEL_RESOLUTIONS,
): number {
	const rungs = ladder.length > 0 ? ladder : GRANULARITY_LEVEL_RESOLUTIONS;
	let bestLevel = MIN_GRANULARITY_LEVEL;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < rungs.length; i++) {
		const distance = Math.abs(rungs[i] - resolution);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestLevel = i + 1;
		}
	}
	return bestLevel;
}
