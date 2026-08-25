import { diffLines } from "diff";

/**
 * A contiguous group of line-level changes in a pending update's diff.
 *
 * Group identity (its index in the returned array) is load-bearing: it is the
 * `groupIndex` the store's `acceptChangeGroup` / `rejectChangeGroup` operate
 * on, so every surface that renders or acts on groups — the inline editor
 * decorations, the reading-view cards, and the chat bar's diff hunks — must
 * derive them from this one function to stay in agreement with the store
 * (which re-derives the same grouping from `diffLines` internally, see
 * `buildPartialContent`).
 */
export interface ChangeGroup {
	removedText: string;
	addedText: string;
	/** Offset of the group's first removed char in originalContent-space. */
	docOffset: number;
	/** Total length of the group's removed text (0 for a pure insertion). */
	docLength: number;
}

/**
 * Identify contiguous change groups from a line-level diff.
 * Each group tracks its removed/added text and position relative to the first text.
 */
export function identifyGroups(fromText: string, toText: string): ChangeGroup[] {
	const lineChanges = diffLines(fromText, toText);
	const groups: ChangeGroup[] = [];
	let docPos = 0;
	let current: ChangeGroup | null = null;

	for (const part of lineChanges) {
		if (part.removed) {
			if (!current) {
				current = { removedText: "", addedText: "", docOffset: docPos, docLength: 0 };
			}
			current.removedText += part.value;
			current.docLength += part.value.length;
			docPos += part.value.length;
		} else if (part.added) {
			if (!current) {
				current = { removedText: "", addedText: "", docOffset: docPos, docLength: 0 };
			}
			current.addedText += part.value;
		} else {
			if (current) {
				groups.push(current);
				current = null;
			}
			docPos += part.value.length;
		}
	}
	if (current) groups.push(current);

	return groups;
}
