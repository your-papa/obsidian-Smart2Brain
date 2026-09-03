/**
 * View Filter Types
 *
 * A recursive filter tree that describes a re-resolvable set of vault files.
 * Used by the privacy list's membership rules — not by the graph, despite
 * having originally lived in `types/graph.ts` alongside saved views.
 *
 * Resolution lives in `lib/views.ts`; the editor UI is
 * `components/settings/ViewFilterBuilder.svelte`.
 */

/**
 * A leaf filter condition — matches files by a single criterion.
 * - "folder": path prefix match (e.g. "Work" matches "Work/notes.md")
 * - "tag": tag match incl. hierarchical (e.g. "#ml" matches "#ml/transformers")
 * - "extension": file extension (e.g. "md", "pdf")
 * - "paths": explicit frozen path list (for semantic clusters / lasso selections)
 * - "property": frontmatter property match — key exists, or key equals one of `values`
 */
export type ViewFilterLeaf =
	| { type: "folder"; value: string }
	| { type: "tag"; value: string }
	| { type: "extension"; value: string }
	| { type: "paths"; value: string[] }
	| { type: "property"; value: string; values?: string[] };

/**
 * A composite filter that combines child conditions with a logic operator.
 * - "all": AND — every child must match (intersection)
 * - "any": OR — at least one child must match (union)
 * - "none": NOT-ANY — no child may match (complement)
 */
export interface ViewFilterGroup {
	type: "all" | "any" | "none";
	conditions: ViewFilter[];
}

/**
 * A recursive filter tree node — either a leaf criterion or a composite group.
 * Used to define dynamic, re-resolvable note sets for saved views.
 */
export type ViewFilter = ViewFilterLeaf | ViewFilterGroup;
