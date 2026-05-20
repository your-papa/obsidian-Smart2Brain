/**
 * View filter resolution utilities.
 *
 * Resolves a `ViewFilter` tree against the vault to produce a concrete
 * set of file paths.  Dynamic leaves (folder / tag / extension)
 * re-evaluate each time so saved views stay up-to-date as the vault
 * changes.  Frozen `paths` leaves are checked for existence — any
 * stale (deleted / renamed) paths are reported separately.
 *
 * `query` leaves are resolved asynchronously via a caller-supplied
 * `searchFn` to avoid circular imports (views.ts must not import searchNotes.ts).
 * The sync resolver returns empty paths for `query` leaves as a safe fallback.
 */

import { type App, type TFile, getAllTags } from "obsidian";
import type { RegionSegment, Space, ViewFilter, ViewFilterGroup, ViewFilterLeaf } from "../types/graph";
import type { SearchFilter } from "../vectorstore/types";
import { matchesPathPrefix } from "../utils/pathUtils";

type RegionLike = Pick<Space, "filter">;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolvedView {
	/** File paths that matched the filter */
	paths: Set<string>;
	/** Frozen paths that no longer exist in the vault */
	stalePaths: string[];
}

export type SpaceMembershipRule =
	| { type: "folder"; value: string }
	| { type: "tag"; value: string }
	| { type: "extension"; value: string }
	| { type: "query"; value: string; algorithm: "lexical" | "semantic" | "hybrid" };

export interface SpaceMembershipDraft {
	manualPaths: string[];
	autoIncludeRules: SpaceMembershipRule[];
	excludedPaths: string[];
}

export interface ParsedSpaceMembershipDraft {
	draft: SpaceMembershipDraft;
	isAdvanced: boolean;
}

export interface ResolvedSpaceMembership extends ResolvedView {
	provenance: Map<string, string[]>;
	excludedPaths: Set<string>;
}

export function cloneViewFilter(filter: ViewFilter): ViewFilter {
	if (isLeaf(filter)) {
		return cloneViewFilterLeaf(filter);
	}

	return {
		type: filter.type,
		conditions: filter.conditions.map((condition) => cloneViewFilter(condition)),
	};
}

export function cloneSpaceMembershipDraft(draft: SpaceMembershipDraft): SpaceMembershipDraft {
	return {
		manualPaths: [...draft.manualPaths],
		autoIncludeRules: draft.autoIncludeRules.map((rule) => cloneSpaceMembershipRule(rule)),
		excludedPaths: [...draft.excludedPaths],
	};
}

/**
 * Recursively resolve a `ViewFilter` tree against the current vault state.
 * `query` leaves are not resolved here — they return empty paths.
 * Use `resolveViewFilterAsync` when `query` leaves must be resolved.
 *
 * @param app       - Obsidian `App` instance (provides vault + metadata cache)
 * @param filter    - The filter tree to resolve
 * @param universe  - Optional pre-computed universe of paths to resolve against.
 *                    When omitted, all markdown files in the vault are used.
 */
export function resolveViewFilter(app: App, filter: ViewFilter, universe?: Set<string>): ResolvedView {
	const allPaths = universe ?? getAllMarkdownPaths(app);
	return resolveNode(app, filter, allPaths);
}

export function createEmptySpaceFilter(): ViewFilter {
	return { type: "paths", value: [] };
}

export function compileSpaceMembershipDraft(draft: SpaceMembershipDraft): ViewFilter {
	const normalized = normalizeSpaceMembershipDraft(draft);
	const includeLeaves: ViewFilterLeaf[] = [];

	if (normalized.manualPaths.length > 0) {
		includeLeaves.push({ type: "paths", value: normalized.manualPaths });
	}

	for (const rule of normalized.autoIncludeRules) {
		includeLeaves.push(cloneSpaceMembershipRule(rule));
	}

	if (includeLeaves.length === 0) {
		return createEmptySpaceFilter();
	}

	const includeNode: ViewFilter =
		includeLeaves.length === 1 ? includeLeaves[0] : { type: "any", conditions: includeLeaves };

	if (normalized.excludedPaths.length === 0) {
		return includeNode;
	}

	return {
		type: "all",
		conditions: [includeNode, { type: "none", conditions: [{ type: "paths", value: normalized.excludedPaths }] }],
	};
}

export function parseSpaceMembershipFilter(filter: ViewFilter): ParsedSpaceMembershipDraft {
	const draft: SpaceMembershipDraft = {
		manualPaths: [],
		autoIncludeRules: [],
		excludedPaths: [],
	};

	if (!extractSimpleSpaceMembership(filter, draft)) {
		return {
			draft: {
				manualPaths: [],
				autoIncludeRules: [],
				excludedPaths: [],
			},
			isAdvanced: true,
		};
	}

	return {
		draft: normalizeSpaceMembershipDraft(draft),
		isAdvanced: false,
	};
}

export function resolveSpaceMembershipDraft(
	app: App,
	draft: SpaceMembershipDraft,
	universe?: Set<string>,
): ResolvedSpaceMembership {
	const normalized = normalizeSpaceMembershipDraft(draft);
	const resolvedPaths = new Set<string>();
	const provenance = new Map<string, string[]>();
	const stalePaths = new Set<string>();
	const allPaths = universe ?? getAllMarkdownPaths(app);

	if (normalized.manualPaths.length > 0) {
		const manual = resolveViewFilter(app, { type: "paths", value: normalized.manualPaths }, allPaths);
		mergeResolvedMembership(resolvedPaths, provenance, manual, "Manual", stalePaths);
	}

	for (const rule of normalized.autoIncludeRules) {
		const resolved = resolveViewFilter(app, rule, allPaths);
		mergeResolvedMembership(resolvedPaths, provenance, resolved, describeMembershipRule(rule), stalePaths);
	}

	const excluded =
		normalized.excludedPaths.length > 0
			? resolveViewFilter(app, { type: "paths", value: normalized.excludedPaths }, allPaths)
			: { paths: new Set<string>(), stalePaths: [] };

	for (const path of excluded.paths) {
		resolvedPaths.delete(path);
		provenance.delete(path);
	}

	for (const stalePath of excluded.stalePaths) {
		stalePaths.add(stalePath);
	}

	return {
		paths: resolvedPaths,
		stalePaths: [...stalePaths],
		provenance,
		excludedPaths: excluded.paths,
	};
}

/**
 * Async variant that rewrites `query` leaves to `paths` leaves by calling
 * `searchFn`, then delegates to the sync resolver.
 *
 * `searchFn` is passed as a parameter to avoid circular imports — callers
 * (e.g. SmartGraphView) supply their own search implementation.
 *
 * @param app       - Obsidian `App` instance
 * @param filter    - The filter tree (may contain `query` leaves)
 * @param searchFn  - Async function resolving a query string to file paths
 * @param universe  - Optional pre-computed universe of paths
 */
export async function resolveViewFilterAsync(
	app: App,
	filter: ViewFilter,
	searchFn: (q: string, algorithm: "lexical" | "semantic" | "hybrid") => Promise<{ path: string }[]>,
	universe?: Set<string>,
): Promise<ResolvedView> {
	const rewritten = await rewriteQueryLeaves(filter, searchFn);
	return resolveViewFilter(app, rewritten, universe);
}

// ---------------------------------------------------------------------------
// Helpers — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Build the full set of markdown file paths in the vault.
 */
export function getAllMarkdownPaths(app: App): Set<string> {
	const paths = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		paths.add(file.path);
	}
	return paths;
}

/**
 * Describe a `ViewFilter` as a short human-readable string for UI display.
 * Examples: "folder:Work", "tag:#ml", "all(folder:Work, tag:#ml)"
 */
export function describeViewFilter(filter: ViewFilter): string {
	if (isLeaf(filter)) {
		return describeLeaf(filter);
	}
	const inner = filter.conditions.map(describeViewFilter).join(", ");
	return `${filter.type}(${inner})`;
}

/**
 * Resolve a `Region` to a concrete set of paths.
 *
 * Convenience wrapper around `resolveViewFilter` for cross-cutting use
 * (search modal, agent) that only needs the paths.
 */
export function resolveRegionPaths(app: App, region: RegionLike, universe?: Set<string>): Set<string> {
	return resolveViewFilter(app, region.filter, universe).paths;
}

/**
 * @deprecated Use `resolveRegionPaths` instead.
 */
export const resolveSpacePaths = resolveRegionPaths;

/**
 * Bridge a `Region` (or `Space`) to a `SearchFilter` suitable for the vector
 * store / search modal / agent.
 *
 * If the Region's filter consists solely of simple folder / tag leaves, this
 * produces a native `SearchFilter` with `pathPrefixes` / `tags` — which lets
 * the vector store pre-filter efficiently.  For complex or mixed filters it
 * falls back to resolving the filter to paths and using `pathPrefixes`.
 */
export function resolveRegionToSearchFilter(app: App, region: RegionLike, universe?: Set<string>): SearchFilter {
	const filter = region.filter;

	// Optimised path: single simple leaf
	if (isLeaf(filter)) {
		const native = leafToSearchFilter(filter);
		if (native) return native;
	}

	// Optimised path: flat ANY of simple leaves
	if (!isLeaf(filter) && filter.type === "any" && filter.conditions.every(isLeaf)) {
		return mergeLeafFilters(filter.conditions as ViewFilterLeaf[]);
	}

	// Fallback: resolve to paths and wrap as pathPrefixes
	const paths = resolveRegionPaths(app, region, universe);
	return { pathPrefixes: [...paths] };
}

/**
 * @deprecated Use `resolveRegionToSearchFilter` instead.
 */
export const resolveSpaceToSearchFilter = resolveRegionToSearchFilter;

/**
 * Build a `ViewFilter` from a set of selected `RegionSegment`s.
 *
 * - If every segment maps cleanly to a dynamic leaf (folder/tag/extension),
 *   produce a single leaf or `any(…)` group.
 * - Otherwise fall back to a frozen `paths` leaf.
 */
export function buildFilterFromSegments(segments: RegionSegment[]): { filter: ViewFilter; label: string } {
	const labels: string[] = [];
	const leaves: ViewFilter[] = [];

	for (const g of segments) {
		labels.push(g.label);
		const leaf = segmentToLeaf(g);
		if (leaf) {
			leaves.push(leaf);
		} else {
			// Fallback: freeze paths for segments without a clean dynamic mapping
			leaves.push({ type: "paths", value: [...g.paths] });
		}
	}

	const filter: ViewFilter = leaves.length === 1 ? leaves[0] : { type: "any", conditions: leaves };
	return { filter, label: labels.join(" + ") };
}

/**
 * @deprecated Use `buildFilterFromSegments` instead.
 */
export const buildFilterFromGroups = buildFilterFromSegments;

/**
 * Build a composite `ViewFilter` from the full drill stack.
 * - 0 entries → `{ type: "all", conditions: [] }` (matches everything)
 * - 1 entry  → that entry's filter directly
 * - N entries → `{ type: "all", conditions: [each entry's filter] }`
 * @deprecated Drill stack replaced by working Region filter tree.
 */
export function buildFilterFromDrillStack(stack: Array<{ filter: ViewFilter }>): ViewFilter {
	if (stack.length === 0) return { type: "all", conditions: [] };
	if (stack.length === 1) return stack[0].filter;
	return { type: "all", conditions: stack.map((e) => e.filter) };
}

function normalizeSpaceMembershipDraft(draft: SpaceMembershipDraft): SpaceMembershipDraft {
	return {
		manualPaths: dedupeStrings(draft.manualPaths),
		autoIncludeRules: draft.autoIncludeRules.map((rule) => cloneSpaceMembershipRule(rule)),
		excludedPaths: dedupeStrings(draft.excludedPaths),
	};
}

function extractSimpleSpaceMembership(filter: ViewFilter, draft: SpaceMembershipDraft): boolean {
	if (isLeaf(filter)) {
		return extractSimpleIncludeNode(filter, draft);
	}

	if (filter.type === "any") {
		return filter.conditions.every((condition) => extractSimpleIncludeNode(condition, draft));
	}

	if (filter.type !== "all") {
		return false;
	}

	let includeCount = 0;
	for (const condition of filter.conditions) {
		if (isSimpleExclusionNode(condition)) {
			draft.excludedPaths.push(...collectExcludedPaths(condition));
			continue;
		}

		includeCount += 1;
		if (includeCount > 1) {
			return false;
		}

		if (!extractSimpleIncludeNode(condition, draft)) {
			return false;
		}
	}

	return includeCount === 1;
}

function extractSimpleIncludeNode(filter: ViewFilter, draft: SpaceMembershipDraft): boolean {
	if (isLeaf(filter)) {
		if (filter.type === "paths") {
			draft.manualPaths.push(...filter.value);
			return true;
		}

		if (isSpaceMembershipRule(filter)) {
			draft.autoIncludeRules.push(cloneSpaceMembershipRule(filter));
			return true;
		}

		return false;
	}

	if (filter.type !== "any") {
		return false;
	}

	return filter.conditions.every((condition) => extractSimpleIncludeNode(condition, draft));
}

function isSimpleExclusionNode(filter: ViewFilter): filter is ViewFilterGroup {
	return (
		filter.type === "none" &&
		filter.conditions.every((condition) => isLeaf(condition) && condition.type === "paths")
	);
}

function collectExcludedPaths(filter: ViewFilterGroup): string[] {
	const paths: string[] = [];
	for (const condition of filter.conditions) {
		if (isLeaf(condition) && condition.type === "paths") {
			paths.push(...condition.value);
		}
	}
	return paths;
}

function isSpaceMembershipRule(filter: ViewFilter): filter is SpaceMembershipRule {
	return filter.type === "folder" || filter.type === "tag" || filter.type === "extension" || filter.type === "query";
}

function mergeResolvedMembership(
	resolvedPaths: Set<string>,
	provenance: Map<string, string[]>,
	resolved: ResolvedView,
	source: string,
	stalePaths: Set<string>,
): void {
	for (const path of resolved.paths) {
		resolvedPaths.add(path);
		const current = provenance.get(path) ?? [];
		if (!current.includes(source)) {
			provenance.set(path, [...current, source]);
		}
	}

	for (const stalePath of resolved.stalePaths) {
		stalePaths.add(stalePath);
	}
}

function describeMembershipRule(rule: SpaceMembershipRule): string {
	switch (rule.type) {
		case "folder":
			return `Folder: ${rule.value}`;
		case "tag":
			return `Tag: ${rule.value.startsWith("#") ? rule.value : `#${rule.value}`}`;
		case "extension":
			return `Type: ${rule.value.startsWith(".") ? rule.value.slice(1) : rule.value}`;
		case "query":
			return `Query: ${rule.value}`;
	}
}

function cloneSpaceMembershipRule(rule: SpaceMembershipRule): SpaceMembershipRule {
	switch (rule.type) {
		case "folder":
			return { type: "folder", value: rule.value };
		case "tag":
			return { type: "tag", value: rule.value };
		case "extension":
			return { type: "extension", value: rule.value };
		case "query":
			return { type: "query", value: rule.value, algorithm: rule.algorithm };
	}
}

function cloneViewFilterLeaf(filter: ViewFilterLeaf): ViewFilterLeaf {
	switch (filter.type) {
		case "folder":
			return { type: "folder", value: filter.value };
		case "tag":
			return { type: "tag", value: filter.value };
		case "extension":
			return { type: "extension", value: filter.value };
		case "paths":
			return { type: "paths", value: [...filter.value] };
		case "query":
			return { type: "query", value: filter.value, algorithm: filter.algorithm };
	}
}

function dedupeStrings(values: string[]): string[] {
	return [...new Set(values)];
}

/**
 * Try to map a `RegionSegment` to a dynamic `ViewFilterLeaf`.
 * Returns `null` if the segment can't be represented as a single leaf
 * (e.g. semantic clusters, lasso selections).
 */
function segmentToLeaf(segment: RegionSegment): ViewFilterLeaf | null {
	switch (segment.source) {
		case "folder":
			return { type: "folder", value: segment.label };
		case "tag":
			return { type: "tag", value: segment.label.startsWith("#") ? segment.label : `#${segment.label}` };
		case "extension":
			return { type: "extension", value: segment.label.startsWith(".") ? segment.label.slice(1) : segment.label };
		default:
			// semantic clusters, "none", "regions", etc. → freeze paths
			return null;
	}
}

// ---------------------------------------------------------------------------
// Internal resolution
// ---------------------------------------------------------------------------

function isLeaf(filter: ViewFilter): filter is ViewFilterLeaf {
	return (
		filter.type === "folder" ||
		filter.type === "tag" ||
		filter.type === "extension" ||
		filter.type === "paths" ||
		filter.type === "query"
	);
}

function resolveNode(app: App, filter: ViewFilter, universe: Set<string>): ResolvedView {
	if (isLeaf(filter)) {
		return resolveLeaf(app, filter, universe);
	}
	return resolveGroup(app, filter, universe);
}

// ── Leaf resolution ─────────────────────────────────────────────────────

function resolveLeaf(app: App, leaf: ViewFilterLeaf, universe: Set<string>): ResolvedView {
	switch (leaf.type) {
		case "folder":
			return resolveFolder(leaf.value, universe);
		case "tag":
			return resolveTag(app, leaf.value, universe);
		case "extension":
			return resolveExtension(leaf.value, universe);
		case "paths":
			return resolvePaths(app, leaf.value);
		case "query":
			// Query leaves must be resolved async via resolveViewFilterAsync.
			// Sync fallback returns empty — callers needing real results use the async path.
			return { paths: new Set(), stalePaths: [] };
	}
}

function resolveFolder(folder: string, universe: Set<string>): ResolvedView {
	const paths = new Set<string>();
	for (const p of universe) {
		if (matchesPathPrefix(p, folder)) {
			paths.add(p);
		}
	}
	return { paths, stalePaths: [] };
}

function resolveTag(app: App, tag: string, universe: Set<string>): ResolvedView {
	const normalizedFilter = tag.startsWith("#") ? tag : `#${tag}`;
	const paths = new Set<string>();
	for (const p of universe) {
		const file = app.vault.getAbstractFileByPath(p);
		if (!file || !("extension" in file)) continue;
		const cache = app.metadataCache.getFileCache(file as TFile);
		const fileTags = cache ? (getAllTags(cache) ?? []) : [];
		const normalizedDocTags = fileTags.map((t) => (t.startsWith("#") ? t : `#${t}`));
		const matches = normalizedDocTags.some(
			(docTag) => docTag === normalizedFilter || docTag.startsWith(`${normalizedFilter}/`),
		);
		if (matches) {
			paths.add(p);
		}
	}
	return { paths, stalePaths: [] };
}

function resolveExtension(ext: string, universe: Set<string>): ResolvedView {
	const normalizedExt = ext.startsWith(".") ? ext.slice(1).toLowerCase() : ext.toLowerCase();
	const paths = new Set<string>();
	for (const p of universe) {
		const fileExt = p.split(".").pop()?.toLowerCase() ?? "";
		if (fileExt === normalizedExt) {
			paths.add(p);
		}
	}
	return { paths, stalePaths: [] };
}

function resolvePaths(app: App, frozenPaths: string[]): ResolvedView {
	const paths = new Set<string>();
	const stalePaths: string[] = [];
	for (const p of frozenPaths) {
		const file = app.vault.getAbstractFileByPath(p);
		if (file) {
			paths.add(p);
		} else {
			stalePaths.push(p);
		}
	}
	return { paths, stalePaths };
}

// ── Group (composite) resolution ────────────────────────────────────────

function resolveGroup(app: App, group: ViewFilterGroup, universe: Set<string>): ResolvedView {
	if (group.conditions.length === 0) {
		// Empty "all" = everything (vacuous truth)
		// Empty "any" = nothing (no child matches)
		// Empty "none" = everything (complement of nothing)
		if (group.type === "any") return { paths: new Set(), stalePaths: [] };
		return { paths: new Set(universe), stalePaths: [] };
	}

	const childResults = group.conditions.map((c) => resolveNode(app, c, universe));
	const allStale = childResults.flatMap((r) => r.stalePaths);

	switch (group.type) {
		case "all":
			return { paths: intersect(childResults.map((r) => r.paths)), stalePaths: allStale };
		case "any":
			return { paths: union(childResults.map((r) => r.paths)), stalePaths: allStale };
		case "none":
			return { paths: difference(universe, union(childResults.map((r) => r.paths))), stalePaths: allStale };
	}
}

// ── Set operations ──────────────────────────────────────────────────────

function intersect(sets: Set<string>[]): Set<string> {
	if (sets.length === 0) return new Set();
	// Start with the smallest set for efficiency
	const sorted = [...sets].sort((a, b) => a.size - b.size);
	const result = new Set(sorted[0]);
	for (let i = 1; i < sorted.length; i++) {
		for (const item of result) {
			if (!sorted[i].has(item)) {
				result.delete(item);
			}
		}
	}
	return result;
}

function union(sets: Set<string>[]): Set<string> {
	const result = new Set<string>();
	for (const s of sets) {
		for (const item of s) {
			result.add(item);
		}
	}
	return result;
}

function difference(base: Set<string>, subtract: Set<string>): Set<string> {
	const result = new Set<string>();
	for (const item of base) {
		if (!subtract.has(item)) {
			result.add(item);
		}
	}
	return result;
}

// ── Description helpers ─────────────────────────────────────────────────

function describeLeaf(leaf: ViewFilterLeaf): string {
	switch (leaf.type) {
		case "folder":
			return `folder:${leaf.value}`;
		case "tag":
			return leaf.value.startsWith("#") ? `tag:${leaf.value}` : `tag:#${leaf.value}`;
		case "extension":
			return `ext:.${leaf.value}`;
		case "paths":
			return `${leaf.value.length} note${leaf.value.length === 1 ? "" : "s"}`;
		case "query":
			return `query(${leaf.algorithm}):${leaf.value.slice(0, 30)}${leaf.value.length > 30 ? "…" : ""}`;
	}
}

// ── Query leaf rewriting ────────────────────────────────────────────────

/**
 * Recursively rewrite `query` leaves in a `ViewFilter` tree to `paths` leaves
 * by calling `searchFn`. All other leaf types are left unchanged.
 */
async function rewriteQueryLeaves(
	filter: ViewFilter,
	searchFn: (q: string, algorithm: "lexical" | "semantic" | "hybrid") => Promise<{ path: string }[]>,
): Promise<ViewFilter> {
	if (isLeaf(filter)) {
		if (filter.type === "query") {
			const results = await searchFn(filter.value, filter.algorithm);
			return { type: "paths", value: results.map((r) => r.path) };
		}
		return filter;
	}
	// Composite node: recurse into conditions
	const rewrittenConditions = await Promise.all(filter.conditions.map((c) => rewriteQueryLeaves(c, searchFn)));
	return { ...filter, conditions: rewrittenConditions };
}

// ── Region → SearchFilter helpers ────────────────────────────────────────

/**
 * Try to convert a single leaf to a native `SearchFilter`.
 * Returns `null` for leaf types that don't map cleanly.
 */
function leafToSearchFilter(leaf: ViewFilterLeaf): SearchFilter | null {
	switch (leaf.type) {
		case "folder":
			return { pathPrefixes: [leaf.value] };
		case "tag":
			return { tags: [leaf.value.startsWith("#") ? leaf.value : `#${leaf.value}`] };
		case "extension":
		case "paths":
		case "query":
			return null;
	}
}

/**
 * Merge multiple simple leaves into one `SearchFilter`.
 * Collects all folder and tag leaves; falls back to `null` if any
 * unsupported leaf type is present.
 */
function mergeLeafFilters(leaves: ViewFilterLeaf[]): SearchFilter {
	const pathPrefixes: string[] = [];
	const tags: string[] = [];

	for (const leaf of leaves) {
		switch (leaf.type) {
			case "folder":
				pathPrefixes.push(leaf.value);
				break;
			case "tag":
				tags.push(leaf.value.startsWith("#") ? leaf.value : `#${leaf.value}`);
				break;
			default:
				// extension / paths / query can't be natively represented → skip
				break;
		}
	}

	const result: SearchFilter = {};
	if (pathPrefixes.length > 0) result.pathPrefixes = pathPrefixes;
	if (tags.length > 0) result.tags = tags;
	return result;
}
