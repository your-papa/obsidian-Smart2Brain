<script lang="ts">
import { Keymap } from "obsidian";
import { onDestroy } from "svelte";
import {
	VisibleNotesTracker,
	toVisibleNoteRefs,
	type VisibleNote,
	type VisibleNoteRef,
} from "../../hooks/useVisibleNotes.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";

interface Props {
	/** Bindable: the currently active (non-deactivated) notes as serializable refs. */
	activeNotes?: VisibleNoteRef[];
	/** One-shot queued refs to activate as visible/pinned notes. */
	queuedNotes?: VisibleNoteRef[];
	/** Path to exclude from display (e.g. when a selection chip covers this note). */
	excludePath?: string;
	/** Current attachment paths so visible notes can toggle between reference and attachment mode. */
	attachmentPaths?: string[];
	/** Called when a visible note pill toggles between reference and attachment mode. */
	onToggleAttachment?: (note: VisibleNote, currentlyAttached: boolean) => void | Promise<void>;
	/** Optional predicate that controls whether a visible note can be promoted to attachment mode. */
	canPromoteToAttachment?: (note: VisibleNote) => boolean;
	/** Reports currently displayed visible note paths so parent can dedupe pills. */
	onDisplayedPathsChange?: (paths: string[]) => void;
	/** Called after queued notes were consumed. */
	onQueuedNotesHandled?: () => void;
}

function linkPathForNote(path: string, viewType: string, context?: string, isAttached = false): string {
	if (isAttached) return path;
	if (viewType !== "pdf" || !context) return path;
	const match = context.match(/^p\.\s+([^/]+)\s*\/\s*/);
	if (!match) return path;
	const pageLabel = match[1]?.trim();
	if (!pageLabel || !/^\d+$/.test(pageLabel)) return path;
	return `${path}#page=${pageLabel}`;
}

let {
	activeNotes = $bindable([]),
	queuedNotes = [],
	excludePath,
	attachmentPaths = [],
	onToggleAttachment,
	canPromoteToAttachment,
	onDisplayedPathsChange,
	onQueuedNotesHandled,
}: Props = $props();

const tracker = new VisibleNotesTracker();
const attachmentPathSet = $derived.by(() => new Set(attachmentPaths));
const visiblePathSet = $derived.by(() => new Set(tracker.notes.map((n) => n.file.path)));
let noteMemory = $state(new Map<string, VisibleNote>());
let activeMarkdownPaths = $state(new Set<string>());
let activeFilePaths = $state(new Set<string>());
const sourcePath = $derived(getPlugin().app.workspace.getActiveFile()?.path ?? "");

$effect(() => {
	const next = new Map(noteMemory);
	let changed = false;
	for (const note of tracker.notes) {
		const prev = next.get(note.file.path);
		if (prev !== note) {
			next.set(note.file.path, note);
			changed = true;
		}
	}
	if (changed) {
		noteMemory = next;
	}
});

$effect(() => {
	if (queuedNotes.length === 0) {
		return;
	}

	const nextMemory = new Map(noteMemory);
	let memoryChanged = false;
	let nextMarkdownPaths = activeMarkdownPaths;
	let nextFilePaths = activeFilePaths;

	for (const note of queuedNotes) {
		const file = getPlugin().app.vault.getFileByPath(note.path);
		if (!file) {
			continue;
		}

		if (!nextMemory.has(note.path)) {
			nextMemory.set(note.path, {
				file,
				viewType: note.viewType,
				context: note.context,
				icon: note.icon,
			});
			memoryChanged = true;
		}

		if (note.viewType === "markdown") {
			if (!nextMarkdownPaths.has(note.path)) {
				nextMarkdownPaths = new Set(nextMarkdownPaths);
				nextMarkdownPaths.add(note.path);
			}
			continue;
		}

		if (!nextFilePaths.has(note.path)) {
			nextFilePaths = new Set(nextFilePaths);
			nextFilePaths.add(note.path);
		}
	}

	if (memoryChanged) {
		noteMemory = nextMemory;
	}
	activeMarkdownPaths = nextMarkdownPaths;
	activeFilePaths = nextFilePaths;
	onQueuedNotesHandled?.();
});

function getRenderableNotes(): VisibleNote[] {
	const result: VisibleNote[] = [];
	const included = new Set<string>();

	for (const note of tracker.notes) {
		if (note.file.path === excludePath) continue;
		result.push(note);
		included.add(note.file.path);
	}

	for (const path of activeMarkdownPaths) {
		if (path === excludePath || included.has(path)) continue;
		const remembered = noteMemory.get(path);
		if (!remembered) continue;
		result.push(remembered);
		included.add(path);
	}

	for (const path of activeFilePaths) {
		if (path === excludePath || included.has(path)) continue;
		const remembered = noteMemory.get(path);
		if (!remembered) continue;
		result.push(remembered);
		included.add(path);
	}

	for (const path of attachmentPathSet) {
		if (path === excludePath || included.has(path)) continue;
		const remembered = noteMemory.get(path);
		if (!remembered) continue;
		result.push(remembered);
		included.add(path);
	}

	return result;
}

function getDisplayedPaths(): string[] {
	return getRenderableNotes().map((n) => n.file.path);
}

// Keep activeNotes in sync with currently visible refs plus hidden markdown refs.
$effect(() => {
	const active = tracker.notes.filter((n) => {
		if (n.file.path === excludePath) return false;
		if (n.viewType === "markdown") return activeMarkdownPaths.has(n.file.path);
		return activeFilePaths.has(n.file.path) && !attachmentPathSet.has(n.file.path);
	});
	const hiddenPinnedMarkdown = [...activeMarkdownPaths]
		.filter((path) => !visiblePathSet.has(path) && path !== excludePath)
		.map((path) => noteMemory.get(path))
		.filter((note): note is VisibleNote => Boolean(note));
	const hiddenPinnedFiles = [...activeFilePaths]
		.filter((path) => !visiblePathSet.has(path) && path !== excludePath && !attachmentPathSet.has(path))
		.map((path) => noteMemory.get(path))
		.filter((note): note is VisibleNote => Boolean(note));
	activeNotes = toVisibleNoteRefs([...active, ...hiddenPinnedMarkdown, ...hiddenPinnedFiles]);
});

$effect(() => {
	onDisplayedPathsChange?.(getDisplayedPaths());
});

function setActiveMarkdown(path: string, value: boolean): void {
	const next = new Set(activeMarkdownPaths);
	if (value) {
		next.add(path);
	} else {
		next.delete(path);
	}
	activeMarkdownPaths = next;
}

function setActiveFile(path: string, value: boolean): void {
	const next = new Set(activeFilePaths);
	if (value) {
		next.add(path);
	} else {
		next.delete(path);
	}
	activeFilePaths = next;
}

function onPillClick(note: VisibleNote, isHidden: boolean) {
	const { path } = note.file;

	if (note.viewType === "markdown") {
		setActiveMarkdown(path, !activeMarkdownPaths.has(path));
		return;
	}

	const promotable = canPromoteToAttachment?.(note) ?? true;
	if (!promotable || !onToggleAttachment) {
		return;
	}

	if (attachmentPathSet.has(path)) {
		setActiveFile(path, false);
		void onToggleAttachment(note, true);
		return;
	}

	if (activeFilePaths.has(path)) {
		if (isHidden) {
			setActiveFile(path, false);
			return;
		}
		void onToggleAttachment(note, false);
		return;
	}

	if (isHidden) {
		return;
	}

	setActiveFile(path, true);
}

function onPillMouseClick(evt: MouseEvent, note: VisibleNote, isHidden: boolean, noteLinkPath: string): void {
	if (Keymap.isModEvent(evt)) {
		evt.preventDefault();
		evt.stopPropagation();
		getPlugin().app.workspace.openLinkText(noteLinkPath, sourcePath, true);
		return;
	}

	onPillClick(note, isHidden);
}

function previewNoteLink(evt: Event, path: string): void {
	const target = evt.currentTarget;
	if (!(target instanceof HTMLElement)) return;

	getPlugin().app.workspace.trigger("hover-link", {
		event: evt,
		source: VIEW_TYPE_CHAT,
		hoverParent: getPlugin(),
		targetEl: target,
		linktext: path,
		sourcePath,
	});
}

onDestroy(() => tracker.destroy());
</script>

{#if getRenderableNotes().length > 0}
  <div class="visible-notes-chips inline-flex flex-row flex-wrap gap-1.5">
	    {#each getRenderableNotes() as note (note.file.path)}
	      {#if note.file.path !== excludePath}
	        {@const isAttached = attachmentPathSet.has(note.file.path)}
	        {@const isHidden = !visiblePathSet.has(note.file.path)}
	        {@const isMarkdownActive = note.viewType === "markdown" && activeMarkdownPaths.has(note.file.path)}
	        {@const isFileVisible = note.viewType !== "markdown" && activeFilePaths.has(note.file.path) && !isAttached}
	        {@const isActive = note.viewType === "markdown" ? isMarkdownActive : isFileVisible || isAttached}
	        {@const noteLinkPath = linkPathForNote(note.file.path, note.viewType, note.context, isAttached)}
	        {@const displayContext = isAttached && note.viewType !== "markdown" ? undefined : note.context}
	        <span
	          class="visible-note-chip"
          class:deactivated={!isActive}
          class:hidden-state={isActive && isHidden}
          class:attached={isActive && isAttached}
          class:reference={isActive && note.viewType === "markdown"}
	        >
	          <button
	            type="button"
	            class="chip-toggle"
	            onclick={(evt) => onPillMouseClick(evt, note, isHidden, noteLinkPath)}
	            onmouseover={(evt) => previewNoteLink(evt, noteLinkPath)}
	            onfocus={(evt) => previewNoteLink(evt, noteLinkPath)}
            title={!isActive
              ? `${note.file.path} (inactive — click to reference)`
              : note.viewType === "markdown"
                ? isHidden
                  ? `${note.file.path} (pinned reference — click to remove)`
                  : `${note.file.path} (active while visible — click to remove)`
                : isAttached
                  ? `${note.file.path} (attached pinned reference — click to remove)`
                  : isHidden
                    ? `${note.file.path} (pinned reference — click to remove)`
                    : `${note.file.path} (pinned reference — click to attach)`}
          >
            {#if !isActive}
              <div class="chip-icon" use:icon={"eye-off"} style="--icon-size: 12px"></div>
            {:else if note.viewType !== "markdown" && isAttached}
              <div class="chip-icon" use:icon={note.viewType === "image" ? "image" : "paperclip"} style="--icon-size: 12px"></div>
            {:else if note.viewType !== "markdown" && isFileVisible}
              <div class="chip-icon" use:icon={"eye"} style="--icon-size: 12px"></div>
	            {:else}
	              <div class="chip-icon" use:icon={"eye"} style="--icon-size: 12px"></div>
	            {/if}
	            <span
	              >{note.file.basename}{#if displayContext}<span class="chip-context">
	                  · {displayContext}</span
	                >{/if}</span
	            >
	          </button>
	        </span>
	      {/if}
	    {/each}
  </div>
{/if}

<style>
  .visible-note-chip {
    display: inline-flex;
    align-items: center;
    gap: 0;
    font-size: 11px;
    line-height: 1.15;
    background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-secondary));
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 16%, transparent);
    border-radius: 999px;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 10%, transparent),
      0 1px 2px color-mix(in srgb, black 10%, transparent);
    color: var(--text-normal);
    white-space: nowrap;
    transition:
      background 0.15s ease,
      transform 0.15s ease,
      opacity 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .visible-note-chip:hover {
    background: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--interactive-accent) 24%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 3px 8px color-mix(in srgb, black 12%, transparent);
    transform: translateY(-1px);
  }

  .visible-note-chip.deactivated {
    background: var(--background-primary);
    border-color: color-mix(in srgb, var(--background-modifier-border) 85%, transparent);
    color: var(--text-muted);
    box-shadow: none;
    opacity: 0.6;
  }

  .visible-note-chip.hidden-state {
    opacity: 0.82;
  }

  .visible-note-chip.reference {
    background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--interactive-accent) 16%, transparent);
  }

  .visible-note-chip.attached {
    background: color-mix(in srgb, var(--color-green) 18%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--color-green) 20%, transparent);
  }

  .visible-note-chip:has(.chip-toggle:focus-visible) {
    outline: none;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 0 0 2px color-mix(in srgb, var(--interactive-accent) 28%, transparent),
      0 3px 8px color-mix(in srgb, black 12%, transparent);
  }

  .visible-note-chip.deactivated:hover {
    transform: none;
    opacity: 0.75;
    box-shadow: none;
  }

  .chip-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    justify-content: center;
    padding: 4px 10px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    border-radius: 999px;
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .chip-context {
    opacity: 0.62;
  }
</style>
