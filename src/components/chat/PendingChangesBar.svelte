<script lang="ts">
import { Notice } from "obsidian";
import { firstChangedLine, revealAndScroll } from "../../lib/pendingChangeNavigation";
import { getPlugin } from "../../stores/state.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import type { PendingChangeEntry } from "../../types/shared";
import { icon } from "../../utils/utils";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";

interface Props {
	threadPath: string | null;
}

const { threadPath }: Props = $props();
const store = getPendingChangesStore();

const threadId = $derived(threadPath);
const pendingEntries = $derived.by(() => {
	void store.revision;
	return threadId ? store.getEntriesForThread(threadId).filter((e) => e.status === "pending") : [];
});
const pendingCount = $derived(pendingEntries.length);

let isExpanded = $state(false);

function changeTypeLabel(entry: PendingChangeEntry): string {
	switch (entry.change.type) {
		case "create":
			return "Create";
		case "update":
			return "Update";
		case "delete":
			return "Delete";
		case "move":
			return "Move";
	}
}

function changeTypeBadgeClass(type: string): string {
	switch (type) {
		case "create":
			return "badge-create";
		case "update":
			return "badge-update";
		case "delete":
			return "badge-delete";
		case "move":
			return "badge-update";
		default:
			return "";
	}
}

function changePathLabel(entry: PendingChangeEntry): string {
	return entry.change.type === "move" ? `${entry.change.path} -> ${entry.change.newPath}` : entry.change.path;
}

/** Number of OTHER chats that also have a pending update to this entry's file.
 * Only updates can collide cross-thread (create/delete/move aren't dedup-scoped
 * the same way, and only updates carry the stale-original-content hazard). */
function otherThreadCount(entry: PendingChangeEntry): number {
	void store.revision;
	if (entry.change.type !== "update" || !threadId) return 0;
	return store.countOtherThreadsPendingUpdate(entry.change.path, threadId);
}

async function handleAccept(entry: PendingChangeEntry) {
	try {
		await store.acceptChange(entry.id);
		new Notice(`Applied: ${changePathLabel(entry)}`);
	} catch (e) {
		new Notice(`Failed to apply change: ${e instanceof Error ? e.message : String(e)}`);
	}
}

function handleReject(entry: PendingChangeEntry) {
	store.rejectChange(entry.id);
	new Notice(`Rejected: ${changePathLabel(entry)}`);
}

async function handleAcceptAll() {
	if (!threadId) return;
	const count = pendingCount;
	try {
		const failures = await store.acceptAll(threadId);
		if (failures.length === 0) {
			new Notice(`Applied all ${count} changes`);
		} else {
			new Notice(`Applied ${count - failures.length} changes, ${failures.length} failed: ${failures.join(", ")}`);
		}
	} catch (e) {
		new Notice(`Error applying changes: ${e instanceof Error ? e.message : String(e)}`);
	}
}

async function handleRejectAll() {
	if (!threadId) return;
	await store.rejectAll(threadId);
	new Notice("Rejected all pending changes");
}

/** Jump to this change's position in the target note (its first changed line).
 * Only meaningful for updates; create/delete/move fall back to the top of file
 * and the button is only shown for updates. */
async function handleJump(entry: PendingChangeEntry) {
	const opened = await revealAndScroll(getPlugin(), entry.change.path, firstChangedLine(entry.change));
	if (!opened) new Notice("Could not open the note for this change.");
}

/** Fire Obsidian's native page-preview hover for this change's note. The Page
 * Preview core plugin reads modifier keys off the event, so this respects the
 * user's "require Cmd" setting. The rendered preview shows the note WITH its
 * in-note pending-change decorations, which the sidebar can't render itself. */
function previewChange(evt: MouseEvent, entry: PendingChangeEntry) {
	const target = evt.currentTarget;
	if (!(target instanceof HTMLElement)) return;
	getPlugin().app.workspace.trigger("hover-link", {
		event: evt,
		source: VIEW_TYPE_CHAT,
		hoverParent: getPlugin(),
		targetEl: target,
		linktext: entry.change.path,
		sourcePath: threadId ?? "",
	});
}
</script>

{#if pendingCount > 0}
  <div class="pcb-container">
    <!-- Summary bar -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pcb-summary" onclick={() => (isExpanded = !isExpanded)}>
      <div class="pcb-summary-left">
        <div class="pcb-icon" use:icon={"file-diff"} style="--icon-size: var(--icon-xs)"></div>
        <span class="pcb-count">
          {pendingCount} pending change{pendingCount !== 1 ? "s" : ""}
        </span>
      </div>
      <div class="pcb-summary-right">
        <button
          class="pcb-action pcb-action-accept"
          onclick={(e) => {
            e.stopPropagation();
            handleAcceptAll();
          }}
          title="Accept all changes"
          type="button"
        >
          <div use:icon={"check"} style="--icon-size: 12px"></div>
          <span>Accept All</span>
        </button>
        <button
          class="pcb-action pcb-action-reject"
          onclick={(e) => {
            e.stopPropagation();
            handleRejectAll();
          }}
          title="Reject all changes"
          type="button"
        >
          <div use:icon={"x"} style="--icon-size: 12px"></div>
          <span>Reject All</span>
        </button>
        <div class="pcb-chevron" class:pcb-chevron-open={isExpanded}>▸</div>
      </div>
    </div>

    <!-- Expanded change list -->
    {#if isExpanded}
      <div class="pcb-list">
        {#each pendingEntries as entry (entry.id)}
          <div class="pcb-entry">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_mouse_events_have_key_events -->
            <div
              class="pcb-entry-header"
              class:pcb-entry-openable={entry.change.type === "update"}
              onclick={() => {
                if (entry.change.type === "update") handleJump(entry);
              }}
              onmouseover={(e) => {
                if (entry.change.type === "update") previewChange(e, entry);
              }}
              title={entry.change.type === "update" ? "Open the note at this change (⌘/Ctrl-hover to preview)" : undefined}
            >
              <div class="pcb-entry-left">
                <span class="pcb-badge {changeTypeBadgeClass(entry.change.type)}">
                  {changeTypeLabel(entry)}
                </span>
                <span class="pcb-path">{changePathLabel(entry)}</span>
                {#if otherThreadCount(entry) > 0}
                  <span
                    class="pcb-cross-thread"
                    title={`${otherThreadCount(entry)} other chat${otherThreadCount(entry) !== 1 ? "s" : ""} also ${otherThreadCount(entry) !== 1 ? "have" : "has"} a pending edit to this file. Whichever is accepted first wins; the others may then fail to apply.`}
                  >
                    <span use:icon={"users"} style="--icon-size: 11px"></span>
                    {otherThreadCount(entry)}
                  </span>
                {/if}
              </div>
              <div class="pcb-entry-actions">
                <button
                  class="pcb-action-icon pcb-action-accept"
                  onclick={(e) => {
                    e.stopPropagation();
                    handleAccept(entry);
                  }}
                  title="Accept change"
                  type="button"
                >
                  <div use:icon={"check"} style="--icon-size: 12px"></div>
                </button>
                <button
                  class="pcb-action-icon pcb-action-reject"
                  onclick={(e) => {
                    e.stopPropagation();
                    handleReject(entry);
                  }}
                  title="Reject change"
                  type="button"
                >
                  <div use:icon={"x"} style="--icon-size: 12px"></div>
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .pcb-container {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    overflow: hidden;
    background: var(--background-secondary);
  }

  .pcb-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--background-secondary);
    border: none;
    cursor: pointer;
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    width: 100%;
    text-align: left;
  }

  .pcb-summary:hover {
    background: var(--background-modifier-hover);
  }

  .pcb-summary-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pcb-icon {
    color: var(--text-accent);
    display: flex;
    align-items: center;
  }

  .pcb-count {
    font-weight: var(--font-medium);
    font-size: var(--font-ui-smaller);
  }

  .pcb-summary-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .pcb-action {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
    font-size: var(--font-smallest);
    font-weight: var(--font-medium);
    background: transparent;
    transition: background 100ms ease;
  }

  .pcb-action-accept {
    color: var(--color-green);
  }

  .pcb-action-accept:hover {
    background: hsla(var(--color-green-hsl), 0.15);
  }

  .pcb-action-reject {
    color: var(--color-red);
  }

  .pcb-action-reject:hover {
    background: hsla(var(--color-red-hsl), 0.15);
  }

  .pcb-action-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
    background: transparent;
    transition: background 100ms ease;
  }

  .pcb-chevron {
    transition: transform 100ms ease;
    color: var(--text-faint);
    font-size: var(--font-smaller);
    margin-left: 2px;
  }

  .pcb-chevron-open {
    transform: rotate(90deg);
  }

  .pcb-list {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--background-modifier-border);
  }

  .pcb-entry {
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .pcb-entry:last-child {
    border-bottom: none;
  }

  .pcb-entry-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 4px 10px;
    background: transparent;
    border: none;
    cursor: default;
    color: var(--text-normal);
    font-size: var(--font-ui-smaller);
    text-align: left;
  }

  .pcb-entry-openable {
    cursor: pointer;
  }

  .pcb-entry-openable:hover {
    background: var(--background-modifier-hover);
  }

  .pcb-entry-left {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    min-width: 0;
  }

  .pcb-path {
    font-family: var(--font-monospace);
    font-size: var(--font-smallest);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pcb-cross-thread {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    padding: 1px 5px;
    border-radius: var(--radius-s);
    font-size: 10px;
    font-weight: var(--font-semibold);
    background: hsla(var(--color-orange-hsl), 0.2);
    color: var(--color-orange);
    cursor: help;
  }

  .pcb-entry-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .pcb-badge {
    padding: 1px 5px;
    border-radius: var(--radius-s);
    font-size: 10px;
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }

  .badge-create {
    background: hsla(var(--color-green-hsl), 0.2);
    color: var(--color-green);
  }

  .badge-update {
    background: hsla(var(--color-yellow-hsl), 0.2);
    color: var(--color-yellow);
  }

  .badge-delete {
    background: hsla(var(--color-red-hsl), 0.2);
    color: var(--color-red);
  }
</style>
