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

const lines = $derived(hunks ? computeLines(hunks) : []);
</script>

<div class="s2b-diff-view">
  {#if change.type === "move"}
    <div class="s2b-move-summary">
      <div><strong>From:</strong> {change.path}</div>
      <div><strong>To:</strong> {change.newPath}</div>
    </div>
  {:else}
    <div class="s2b-diff-table">
      {#each lines as line}
        <div
          class="s2b-diff-line"
          class:s2b-diff-added={line.type === "added"}
          class:s2b-diff-removed={line.type === "removed"}
        >
          <span class="s2b-diff-gutter s2b-diff-gutter-old">
            {line.oldLineNo ?? ""}
          </span>
          <span class="s2b-diff-gutter s2b-diff-gutter-new">
            {line.newLineNo ?? ""}
          </span>
          <span class="s2b-diff-marker">
            {#if line.type === "added"}+{:else if line.type === "removed"}-{:else}&nbsp;{/if}
          </span>
          <span class="s2b-diff-content">{line.content}</span>
        </div>
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
    background-color: hsla(var(--color-green-hsl), 0.15);
  }

  .s2b-diff-removed {
    background-color: hsla(var(--color-red-hsl), 0.15);
  }

  .s2b-diff-gutter {
    display: inline-block;
    width: 3.5em;
    text-align: right;
    padding-right: 0.5em;
    color: var(--text-faint);
    user-select: none;
    flex-shrink: 0;
  }

  .s2b-diff-marker {
    display: inline-block;
    width: 1.5em;
    text-align: center;
    color: var(--text-muted);
    user-select: none;
    flex-shrink: 0;
  }

  .s2b-diff-added .s2b-diff-marker {
    color: var(--color-green);
  }

  .s2b-diff-removed .s2b-diff-marker {
    color: var(--color-red);
  }

  .s2b-diff-content {
    flex: 1;
    padding-right: 1em;
  }
</style>
