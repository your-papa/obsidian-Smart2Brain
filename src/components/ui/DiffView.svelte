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

<div class="ssb-diff-view">
  {#if change.type === "move"}
    <div class="ssb-move-summary">
      <div><strong>From:</strong> {change.path}</div>
      <div><strong>To:</strong> {change.newPath}</div>
    </div>
  {:else}
    <div class="ssb-diff-table">
      {#each lines as line}
        <div
          class="ssb-diff-line"
          class:ssb-diff-added={line.type === "added"}
          class:ssb-diff-removed={line.type === "removed"}
        >
          <span class="ssb-diff-gutter ssb-diff-gutter-old">
            {line.oldLineNo ?? ""}
          </span>
          <span class="ssb-diff-gutter ssb-diff-gutter-new">
            {line.newLineNo ?? ""}
          </span>
          <span class="ssb-diff-marker">
            {#if line.type === "added"}+{:else if line.type === "removed"}-{:else}&nbsp;{/if}
          </span>
          <span class="ssb-diff-content">{line.content}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ssb-diff-view {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    overflow: auto;
    max-height: 400px;
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    line-height: 1.5;
  }

  .ssb-diff-table {
    width: 100%;
    min-width: max-content;
  }

  .ssb-move-summary {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--text-normal);
  }

  .ssb-diff-line {
    display: flex;
    white-space: pre;
  }

  .ssb-diff-added {
    background-color: hsla(var(--color-green-hsl), 0.15);
  }

  .ssb-diff-removed {
    background-color: hsla(var(--color-red-hsl), 0.15);
  }

  .ssb-diff-gutter {
    display: inline-block;
    width: 3.5em;
    text-align: right;
    padding-right: 0.5em;
    color: var(--text-faint);
    user-select: none;
    flex-shrink: 0;
  }

  .ssb-diff-marker {
    display: inline-block;
    width: 1.5em;
    text-align: center;
    color: var(--text-muted);
    user-select: none;
    flex-shrink: 0;
  }

  .ssb-diff-added .ssb-diff-marker {
    color: var(--color-green);
  }

  .ssb-diff-removed .ssb-diff-marker {
    color: var(--color-red);
  }

  .ssb-diff-content {
    flex: 1;
    padding-right: 1em;
  }
</style>
