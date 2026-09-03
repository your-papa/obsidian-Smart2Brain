import { type Change, diffLines } from "diff";

/** Count lines in a diff part value. */
export function countPartLines(value: string): number {
	if (value === "") return 0;
	return value.replace(/\n$/, "").split("\n").length;
}

/** Total number of original lines represented by a line diff (removed + unchanged parts). */
export function countOriginalLines(changes: Change[]): number {
	let total = 0;
	for (const part of changes) {
		if (part.value === "" || part.added) continue;
		total += countPartLines(part.value);
	}
	return total;
}

/**
 * The original-content line a PURE INSERTION at `oldLine` anchors to, for the
 * purpose of matching it to a rendered section.
 *
 * A pure insertion removes no original line, so it has no natural home. We anchor
 * it to the line NOW FOLLOWING the insertion point (`oldLine`) when one exists —
 * that's the section that visually follows the inserted text. Only at end-of-file
 * (no following line) do we fall back to the line BEFORE it (`oldLine - 1`).
 *
 * This returns a SINGLE line on purpose: an earlier "match both oldLine-1 AND
 * oldLine" heuristic double-claimed an insertion that sat exactly on the boundary
 * between two rendered sections (the before-line owned by section A, the
 * following line by section B) — producing two review cards for one change group.
 * Anchoring to exactly one line keeps the change owned by exactly one section.
 */
export function insertionAnchorLine(oldLine: number, totalOriginalLines: number): number {
	return oldLine < totalOriginalLines ? oldLine : Math.max(0, oldLine - 1);
}

/**
 * Computes which lines in the *original* content are removed or modified.
 * Returns a Set of 0-based line numbers that are affected.
 */
export function computeOriginalAffectedLines(originalContent: string, newContent: string): Set<number> {
	const affected = new Set<number>();
	const changes = diffLines(originalContent, newContent);
	const totalOriginalLines = countOriginalLines(changes);
	let oldLine = 0; // 0-based
	let prevRemoved = false;

	for (const part of changes) {
		if (part.value === "") continue;
		const lines = countPartLines(part.value);

		if (part.removed) {
			for (let i = 0; i < lines; i++) {
				affected.add(oldLine + i);
			}
			oldLine += lines;
			prevRemoved = true;
		} else if (part.added) {
			// Only a PURE insertion needs an anchor line. An added part preceded by
			// a removed part is a REPLACEMENT: its home is the removed lines, which
			// are already in the set — and `oldLine` has already advanced past them,
			// so anchoring here would falsely mark the line AFTER the replaced run
			// (the next rendered section, when the run ends its section — e.g. any
			// single-line heading edit).
			if (!prevRemoved) {
				affected.add(insertionAnchorLine(oldLine, totalOriginalLines));
			}
			prevRemoved = false;
		} else {
			oldLine += lines;
			prevRemoved = false;
		}
	}

	return affected;
}

/**
 * Build a mapper from current-content line numbers to originalContent line numbers.
 * Returns null for lines that don't exist in the original (user additions/edits).
 */
