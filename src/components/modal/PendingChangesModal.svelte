<script lang="ts">
  import { Notice } from "obsidian";
  import type SecondBrainPlugin from "../../main";
  import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
  import type { PendingChangeEntry } from "../../types/shared";
  import Button from "../ui/Button.svelte";
  import DiffView from "../ui/DiffView.svelte";
  import type { PendingChangesModal } from "./PendingChangesModal";

  interface Props {
    modal: PendingChangesModal;
    plugin: SecondBrainPlugin;
    threadId: string;
  }

  const { modal, plugin, threadId }: Props = $props();
  const store = getPendingChangesStore();

  let entries = $derived(store.getEntriesForThread(threadId));
  let pendingCount = $derived(entries.filter((e) => e.status === "pending").length);
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

  function changeTypeBadgeClass(entry: PendingChangeEntry): string {
    switch (entry.change.type) {
      case "create":
        return "ssb-badge-create";
      case "update":
        return "ssb-badge-update";
      case "delete":
        return "ssb-badge-delete";
    }
  }

  function statusLabel(entry: PendingChangeEntry): string {
    switch (entry.status) {
      case "pending":
        return "Pending";
      case "accepted":
        return "Accepted";
      case "rejected":
        return "Rejected";
    }
  }

  function statusClass(entry: PendingChangeEntry): string {
    switch (entry.status) {
      case "pending":
        return "ssb-status-pending";
      case "accepted":
        return "ssb-status-accepted";
      case "rejected":
        return "ssb-status-rejected";
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
    try {
      await store.acceptAll(threadId);
      new Notice(`Applied all ${pendingCount} changes`);
    } catch (e) {
      new Notice(`Error applying changes: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handleRejectAll() {
    store.rejectAll(threadId);
    new Notice("Rejected all pending changes");
  }
</script>

<div class="ssb-pending-changes-modal">
  <h2 class="ssb-pending-header">Pending Changes</h2>

  {#if entries.length === 0}
    <div class="ssb-pending-empty">No changes proposed in this conversation.</div>
  {:else}
    <div class="ssb-pending-list">
      {#each entries as entry (entry.id)}
        <div class="ssb-pending-entry" class:ssb-pending-resolved={entry.status !== "pending"}>
          <!-- Header row -->
          <button
            class="ssb-pending-entry-header"
            onclick={() => toggleExpand(entry.id)}
            type="button"
          >
            <span class="ssb-pending-path">
              <span class="ssb-badge {changeTypeBadgeClass(entry)}">{changeTypeLabel(entry)}</span>
              {entry.change.path}
            </span>
            <span class="ssb-pending-entry-right">
              <span class="ssb-status {statusClass(entry)}">{statusLabel(entry)}</span>
              <span class="ssb-chevron" class:ssb-chevron-open={expandedIds[entry.id]}>▸</span>
            </span>
          </button>

          <!-- Expandable diff + actions -->
          {#if expandedIds[entry.id]}
            <div class="ssb-pending-entry-body">
              <DiffView change={entry.change} />

              {#if entry.status === "pending"}
                <div class="ssb-pending-actions">
                  <Button
                    buttonText="Accept"
                    cta
                    styles="ssb-accept-btn"
                    onClick={() => handleAccept(entry)}
                  />
                  <Button
                    buttonText="Reject"
                    styles="ssb-reject-btn"
                    onClick={() => handleReject(entry)}
                  />
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Bulk actions -->
    {#if pendingCount > 0}
      <div class="ssb-pending-bulk">
        <span class="ssb-pending-count"
          >{pendingCount} pending change{pendingCount !== 1 ? "s" : ""}</span
        >
        <div class="ssb-pending-bulk-buttons">
          <Button buttonText="Accept All" cta onClick={handleAcceptAll} />
          <Button buttonText="Reject All" onClick={handleRejectAll} />
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .ssb-pending-changes-modal {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-3);
  }

  .ssb-pending-header {
    margin: 0;
    font-size: var(--font-ui-large);
    color: var(--text-normal);
  }

  .ssb-pending-empty {
    color: var(--text-muted);
    padding: var(--size-4-4);
    text-align: center;
  }

  .ssb-pending-list {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  .ssb-pending-entry {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    overflow: hidden;
  }

  .ssb-pending-resolved {
    opacity: 0.6;
  }

  .ssb-pending-entry-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--size-4-2) var(--size-4-3);
    background: var(--background-secondary);
    border: none;
    cursor: pointer;
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    text-align: left;
  }

  .ssb-pending-entry-header:hover {
    background: var(--background-modifier-hover);
  }

  .ssb-pending-path {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ssb-pending-entry-right {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    flex-shrink: 0;
  }

  .ssb-badge {
    padding: 1px 6px;
    border-radius: var(--radius-s);
    font-size: var(--font-smallest);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }

  .ssb-badge-create {
    background: hsla(var(--color-green-hsl), 0.2);
    color: var(--color-green);
  }

  .ssb-badge-update {
    background: hsla(var(--color-yellow-hsl), 0.2);
    color: var(--color-yellow);
  }

  .ssb-badge-delete {
    background: hsla(var(--color-red-hsl), 0.2);
    color: var(--color-red);
  }

  .ssb-status {
    font-size: var(--font-smallest);
    font-weight: var(--font-medium);
  }

  .ssb-status-pending {
    color: var(--text-muted);
  }

  .ssb-status-accepted {
    color: var(--color-green);
  }

  .ssb-status-rejected {
    color: var(--color-red);
  }

  .ssb-chevron {
    transition: transform 100ms ease;
    color: var(--text-faint);
    font-size: var(--font-smaller);
  }

  .ssb-chevron-open {
    transform: rotate(90deg);
  }

  .ssb-pending-entry-body {
    padding: var(--size-4-3);
    display: flex;
    flex-direction: column;
    gap: var(--size-4-3);
  }

  .ssb-pending-actions {
    display: flex;
    gap: var(--size-4-2);
    justify-content: flex-end;
  }

  .ssb-pending-bulk {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--size-4-3);
    border-top: 1px solid var(--background-modifier-border);
    margin-top: var(--size-4-2);
  }

  .ssb-pending-count {
    font-size: var(--font-ui-small);
    color: var(--text-muted);
  }

  .ssb-pending-bulk-buttons {
    display: flex;
    gap: var(--size-4-2);
  }
</style>
