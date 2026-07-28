<script lang="ts">
import { diffLines, type Change } from "diff";
import type { PendingChange } from "../../types/shared";

interface Props {
	change: PendingChange;
}

const { change }: Props = $props();

const hunks = $derived.by(() => {
	if (change.type === "create") {
		return diffLines("", change.content);
	}
	if (change.type === "delete") {
		return diffLines(change.originalContent, "");
	}
	if (change.type === "move") {
		return null;
	}
	// update
	return diffLines(change.originalContent, change.newContent);
});

interface LineEntry {
	type: "added" | "removed" | "context";
	content: string;
	oldLineNo?: number;
	newLineNo?: number;
}

/** A collapsed gap standing in for `hidden` unchanged lines the diff elided. */
interface SeparatorEntry {
	type: "separator";
	hidden: number;
}

type DisplayEntry = LineEntry | SeparatorEntry;

/** Unchanged context lines kept on each side of a change run (git's -U3 default). */
const CONTEXT = 3;

function computeLines(changes: Change[]): LineEntry[] {
	let oldLine = 1;
	let newLine = 1;
	const result: LineEntry[] = [];

	for (const part of changes) {
		const lines = part.value.replace(/\n$/, "").split("\n");
		// Skip empty last element from trailing newline
		if (part.value === "") continue;

		for (const line of lines) {
			if (part.added) {
				result.push({ type: "added", content: line, newLineNo: newLine });
				newLine++;
			} else if (part.removed) {
				result.push({ type: "removed", content: line, oldLineNo: oldLine });
				oldLine++;
			} else {
				result.push({ type: "context", content: line, oldLineNo: oldLine, newLineNo: newLine });
				oldLine++;
				newLine++;
			}
		}
	}

	return result;
}

/**
 * Collapse long runs of unchanged (context) lines into a single separator, the
 * way `git diff` shows hunks: keep every added/removed line, keep up to
 * {@link CONTEXT} context lines adjacent to each change, and replace the rest
 * of each gap (plus any leading/trailing context far from a change) with a
 * `{ type: "separator", hidden }` row. A gap short enough to keep entirely
 * (≤ 2*CONTEXT between two changes, or ≤ CONTEXT at the head/tail) is left as-is.
 */
function collapseContext(lines: LineEntry[], context = CONTEXT): DisplayEntry[] {
	const changeIdx = lines.map((l, i) => (l.type !== "context" ? i : -1)).filter((i) => i >= 0);
	// No changes at all (shouldn't happen for a real diff): show everything.
	if (changeIdx.length === 0) return lines;

	const firstChange = changeIdx[0];
	const lastChange = changeIdx[changeIdx.length - 1];

	// A context line is visible if it's within `context` of ANY change line.
	const visible = new Array<boolean>(lines.length).fill(false);
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].type !== "context") {
			visible[i] = true;
			continue;
		}
		if (i < firstChange) {
			// Leading run: keep only the last `context` lines before the first change.
			visible[i] = i >= firstChange - context;
		} else if (i > lastChange) {
			// Trailing run: keep only the first `context` lines after the last change.
			visible[i] = i <= lastChange + context;
		} else {
			// Interior gap: keep lines within `context` of the nearest change on either side.
			visible[i] = false;
		}
	}
	// Interior gaps: mark the `context` lines on each side of every change visible.
	for (const idx of changeIdx) {
		for (let d = 1; d <= context; d++) {
			if (idx - d >= 0 && lines[idx - d].type === "context") visible[idx - d] = true;
			if (idx + d < lines.length && lines[idx + d].type === "context") visible[idx + d] = true;
		}
	}

	const out: DisplayEntry[] = [];
	let hiddenRun = 0;
	for (let i = 0; i < lines.length; i++) {
		if (visible[i]) {
			if (hiddenRun > 0) {
				out.push({ type: "separator", hidden: hiddenRun });
				hiddenRun = 0;
			}
			out.push(lines[i]);
		} else {
			hiddenRun++;
		}
	}
	if (hiddenRun > 0) out.push({ type: "separator", hidden: hiddenRun });

	return out;
}

const entries = $derived(hunks ? collapseContext(computeLines(hunks)) : []);
</script>

<div class="s2b-diff-view">
  {#if change.type === "move"}
    <div class="s2b-move-summary">
      <div><strong>From:</strong> {change.path}</div>
      <div><strong>To:</strong> {change.newPath}</div>
    </div>
  {:else}
    <div class="s2b-diff-table">
      {#each entries as entry}
        {#if entry.type === "separator"}
          <div class="s2b-diff-separator">
            ⋯ {entry.hidden} unchanged line{entry.hidden !== 1 ? "s" : ""}
          </div>
        {:else}
          <div
            class="s2b-diff-line"
            class:s2b-diff-added={entry.type === "added"}
            class:s2b-diff-removed={entry.type === "removed"}
          >
            <span class="s2b-diff-content">{entry.content}</span>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .s2b-diff-view {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    overflow: auto;
    max-height: 400px;
    background-color: var(--background-primary);
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    line-height: 1.5;
  }

  .s2b-diff-table {
    width: 100%;
    min-width: max-content;
  }

  .s2b-move-summary {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--text-normal);
  }

  .s2b-diff-line {
    display: flex;
    white-space: pre;
  }

  .s2b-diff-added {
    background-color: color-mix(in srgb, var(--color-green) 22%, var(--background-primary));
  }

  .s2b-diff-removed {
    background-color: color-mix(in srgb, var(--color-red) 22%, var(--background-primary));
  }

  .s2b-diff-content {
    flex: 1;
    padding-left: 0.75em;
    padding-right: 1em;
  }

  .s2b-diff-separator {
    padding: 3px 0;
    text-align: center;
    color: var(--text-faint);
    background-color: var(--background-secondary);
    font-size: var(--font-smallest);
    user-select: none;
    border-top: 1px solid var(--background-modifier-border);
    border-bottom: 1px solid var(--background-modifier-border);
  }
</style>
