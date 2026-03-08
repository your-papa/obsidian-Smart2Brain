<script lang="ts">
  import { Notice } from "obsidian";
  import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
  import type { Messenger } from "../../stores/chatStore.svelte";
  import type { PendingChangeEntry } from "../../types/shared";
  import DiffView from "../ui/DiffView.svelte";
  import { icon } from "../../utils/utils";

  interface Props {
    messenger: Messenger;
  }

  const { messenger }: Props = $props();
  const store = getPendingChangesStore();

  const threadId = $derived(messenger.session?.id);
  const pendingEntries = $derived(
    threadId ? store.getEntriesForThread(threadId).filter((e) => e.status === "pending") : [],
  );
  const pendingCount = $derived(pendingEntries.length);

  let isExpanded = $state(false);
  let expandedIds: Record<string, boolean> = $state({});

  function toggleExpand(id: string) {
    expandedIds[id] = !expandedIds[id];
  }

  function changeTypeLabel(entry: PendingChangeEntry): string {
    switch (entry.change.type) {
      case "create":
        return "Create";
      case "update":
        return "Update";
      case "delete":
        return "Delete";
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
      default:
        return "";
    }
  }

  async function handleAccept(entry: PendingChangeEntry) {
    try {
      await store.acceptChange(entry.id);
      new Notice(`Applied: ${entry.change.path}`);
    } catch (e) {
      new Notice(`Failed to apply change: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handleReject(entry: PendingChangeEntry) {
    store.rejectChange(entry.id);
    new Notice(`Rejected: ${entry.change.path}`);
  }

  async function handleAcceptAll() {
    if (!threadId) return;
    const count = pendingCount;
    try {
      const failures = await store.acceptAll(threadId);
      if (failures.length === 0) {
        new Notice(`Applied all ${count} changes`);
      } else {
        new Notice(
          `Applied ${count - failures.length} changes, ${failures.length} failed: ${failures.join(", ")}`,
        );
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
            <div class="pcb-entry-header" onclick={() => toggleExpand(entry.id)}>
              <div class="pcb-entry-left">
                <span class="pcb-badge {changeTypeBadgeClass(entry.change.type)}">
                  {changeTypeLabel(entry)}
                </span>
                <span class="pcb-path">{entry.change.path}</span>
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
                <div class="pcb-chevron" class:pcb-chevron-open={expandedIds[entry.id]}>▸</div>
              </div>
            </div>

            {#if expandedIds[entry.id]}
              <div class="pcb-diff-body">
                <DiffView change={entry.change} />
              </div>
            {/if}
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
    cursor: pointer;
    color: var(--text-normal);
    font-size: var(--font-ui-smaller);
    text-align: left;
  }

  .pcb-entry-header:hover {
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

  .pcb-diff-body {
    padding: 0 10px 8px;
    max-height: 300px;
    overflow: auto;
  }
</style>
