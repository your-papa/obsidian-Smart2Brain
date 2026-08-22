<script lang="ts">
import { Notice } from "obsidian";
import { firstChangedLine, revealAndScroll } from "../../lib/pendingChangeNavigation";
import { getPlugin } from "../../stores/state.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import type { PendingChangeEntry } from "../../types/shared";
import { icon } from "../../utils/utils";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";
import MarkdownRenderer from "../ui/MarkdownRenderer.svelte";

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

/**
 * Ids of entries whose content preview is open.
 *
 * An `update` can be reviewed in the note itself — the inline-diff decorations
 * render there, which is what the path link jumps to. A `create` has no note to
 * jump to yet and a `delete` is about to lose one, so their content was
 * reviewable nowhere: the row showed only a path. These two render their body
 * inline here instead.
 */
let previewedEntryIds = $state(new Set<string>());

function togglePreview(entryId: string) {
	const next = new Set(previewedEntryIds);
	if (!next.delete(entryId)) next.add(entryId);
	previewedEntryIds = next;
}

/** The content a row can preview inline, or null when the note itself is the review surface. */
function previewContentOf(entry: PendingChangeEntry): string | null {
	if (entry.change.type === "create") return entry.change.content;
	if (entry.change.type === "delete") return entry.change.originalContent;
	return null;
}

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

/** Whether this move takes a note out of a private location into a public one.
 * Not a provider-trust question — see `isDeprivatizingMove`. */
function isDeprivatizing(entry: PendingChangeEntry): boolean {
	void store.revision;
	return store.isDeprivatizingMove(entry.change);
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
	const skipped = await store.rejectAll(threadId);
	if (skipped.length === 0) {
		new Notice("Rejected all pending changes");
	} else {
		// A partially-accepted note that changed on disk since is left alone rather
		// than overwritten. Say so — otherwise "Rejected all" reads as "everything
		// was undone" while those files still hold the accepted groups.
		new Notice(
			`Rejected all pending changes. ${skipped.length} note(s) were left as-is because they changed after being partially applied: ${skipped.join(", ")}`,
		);
	}
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
function previewChange(evt: Event, entry: PendingChangeEntry) {
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
          {@const previewContent = previewContentOf(entry)}
          {@const isPreviewOpen = previewedEntryIds.has(entry.id)}
          <div class="pcb-entry">
            <div class="pcb-entry-header">
              <div class="pcb-entry-left">
                {#if previewContent !== null}
                  <button
                    class="pcb-preview-toggle"
                    class:pcb-preview-toggle-open={isPreviewOpen}
                    onclick={() => togglePreview(entry.id)}
                    title={isPreviewOpen ? "Hide content" : "Show content"}
                    aria-label={isPreviewOpen
                      ? `Hide content of ${entry.change.path}`
                      : `Show content of ${entry.change.path}`}
                    aria-expanded={isPreviewOpen}
                    type="button"
                  >
                    <div use:icon={"chevron-right"} style="--icon-size: 12px"></div>
                  </button>
                {/if}
                <span class="pcb-badge {changeTypeBadgeClass(entry.change.type)}">
                  {changeTypeLabel(entry)}
                </span>
                {#if entry.change.type === "update"}
                  <!-- svelte-ignore a11y_mouse_events_have_key_events -->
                  <a
                    class="internal-link pcb-path"
                    href={entry.change.path}
                    data-href={entry.change.path}
                    onclick={(e) => {
                      e.preventDefault();
                      handleJump(entry);
                    }}
                    onmouseover={(e) => previewChange(e, entry)}
                    onfocus={(e) => previewChange(e, entry)}
                  >{changePathLabel(entry)}</a>
                {:else}
                  <span class="pcb-path">{changePathLabel(entry)}</span>
                {/if}
                {#if isDeprivatizing(entry)}
                <span
                  class="pcb-deprivatizing"
                  title="This note is currently private. Moving it to this location takes it out of the privacy filter, so it will be indexed, searchable, and available to untrusted providers from then on."
                >
                  <span use:icon={"shield-off"} style="--icon-size: 11px"></span>
                  Leaves private
                </span>
              {/if}
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
                  aria-label="Accept change to {entry.change.path}"
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
                  aria-label="Reject change to {entry.change.path}"
                  type="button"
                >
                  <div use:icon={"x"} style="--icon-size: 12px"></div>
                </button>
              </div>
            </div>

            {#if previewContent !== null && isPreviewOpen}
              <div class="pcb-preview">
                {#if previewContent.trim() === ""}
                  <div class="pcb-preview-empty">This note is empty.</div>
                {:else}
                  <MarkdownRenderer content={previewContent} class="pcb-preview-body" />
                {/if}
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
    /* Matches `.chat-input-wrapper`, which this bar sits directly above: a
       transparent 1px border (so the box still reserves the same layout space
       as a bordered one) and the wrapper's literal 22px pill. 22px is hardcoded
       rather than a --radius-* token because Obsidian's largest, --radius-l, is
       only 12px — still visibly squarer than the composer next to it. */
    border: 1px solid transparent;
    border-radius: 22px;
    overflow: hidden;
    background: var(--background-secondary);
    /* Cap the whole bar, not just the list, so a long run of changes can't grow
       past the composer. The summary row is a flex sibling that never shrinks,
       so it stays pinned and Accept/Reject All remain reachable at any length. */
    min-height: 0;
    max-height: 45vh;
  }

  .pcb-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* Never give up height to the scrolling list below — the accept/reject-all
       controls have to stay reachable however many changes are pending. */
    flex-shrink: 0;
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
    /* The scroller. `min-height: 0` is required for a flex child to shrink below
       its content size — without it the list wins over the container's
       max-height and the bar overflows the composer instead of scrolling. */
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
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

  a.pcb-path {
    cursor: pointer;
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

  /* Same shape as .pcb-cross-thread, but color-mix against the hex --color-red
     rather than hsla(--color-red-hsl): the -hsl vars are undefined in some
     themes (Cupertino among them), which silently renders the badge
     transparent. */
  .pcb-deprivatizing {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    padding: 1px 5px;
    border-radius: var(--radius-s);
    font-size: 10px;
    font-weight: var(--font-semibold);
    background: color-mix(in srgb, var(--color-red) 20%, transparent);
    color: var(--color-red);
    cursor: help;
  }

  .pcb-entry-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  /* Reuses the summary chevron's rotate-on-open idiom so the two disclosure
     affordances in this component read the same. */
  .pcb-preview-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 100ms ease;
  }

  .pcb-preview-toggle:hover {
    color: var(--text-normal);
  }

  .pcb-preview-toggle-open {
    transform: rotate(90deg);
  }

  .pcb-preview {
    padding: 2px 10px 8px;
    border-top: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    /* Proposed notes can be long; cap the row so a single create can't push the
       accept/reject controls of the others out of reach. */
    max-height: 260px;
    overflow-y: auto;
  }

  .pcb-preview :global(.pcb-preview-body) {
    font-size: var(--font-ui-smaller);
  }

  /* The renderer's first/last block carry their own margins; drop them so the
     preview sits flush inside its padding. */
  .pcb-preview :global(.pcb-preview-body > :first-child) {
    margin-top: 0;
  }

  .pcb-preview :global(.pcb-preview-body > :last-child) {
    margin-bottom: 0;
  }

  .pcb-preview-empty {
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    font-style: italic;
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
