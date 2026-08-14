<script lang="ts">
import { Keymap, type App } from "obsidian";
import type { Snippet } from "svelte";
import { getPlugin } from "../../stores/state.svelte";
import { getSearchResultNoteIcon } from "../../utils/noteIcons";
import { icon as iconDirective } from "../../utils/utils";

interface FileSetEntryRowEntry {
	path: string;
	displayName?: string;
	contextLabel?: string | null;
}

interface Props {
	app: App;
	entry: FileSetEntryRowEntry;
	sourcePath?: string;
	hoverSource: string;
	compact?: boolean;
	actions?: Snippet<[]>;
}

const FILE_ICON_MAP: Record<string, string> = {
	chat: "message-square",
	excalidraw: "pencil",
	canvas: "layout-dashboard",
	base: "database",
	pdf: "file-text",
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	svg: "image",
	webp: "image",
	mp3: "audio-lines",
	wav: "audio-lines",
	mp4: "film",
	mov: "film",
	mkv: "film",
	json: "braces",
	csv: "table",
	txt: "file-text",
};

let { app, entry, sourcePath = "", hoverSource, compact = false, actions }: Props = $props();

function getFileDisplayName(path: string): string {
	return path.split("/").pop() ?? path;
}

function getFileIconName(path: string): string {
	const lower = path.toLowerCase();
	const extension = lower.endsWith(".excalidraw.md") ? "excalidraw" : (lower.split(".").pop() ?? "");
	return FILE_ICON_MAP[extension] ?? "file-text";
}

interface LazyFileIconOptions {
	app: App;
	path: string;
}

function lazyFileIcon(node: HTMLElement, options: LazyFileIconOptions) {
	let currentOptions = options;
	let observer: IntersectionObserver | null = null;
	let idleCallbackHandle: number | null = null;
	let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;
	let hasRendered = false;

	const clearPending = () => {
		if (observer) {
			observer.disconnect();
			observer = null;
		}
		if (idleCallbackHandle !== null && "cancelIdleCallback" in globalThis) {
			globalThis.cancelIdleCallback(idleCallbackHandle);
			idleCallbackHandle = null;
		}
		if (timeoutHandle !== null) {
			globalThis.clearTimeout(timeoutHandle);
			timeoutHandle = null;
		}
	};

	const renderIcon = () => {
		if (hasRendered) return;
		const icon = getSearchResultNoteIcon(currentOptions.app, currentOptions.path);
		if (!icon) return;
		try {
			icon.render(node);
			hasRendered = true;
		} catch {
			// Keep the fallback icon if richer rendering fails.
		}
	};

	const scheduleRender = () => {
		if (hasRendered || idleCallbackHandle !== null || timeoutHandle !== null) return;
		if ("requestIdleCallback" in globalThis) {
			idleCallbackHandle = globalThis.requestIdleCallback(
				() => {
					idleCallbackHandle = null;
					renderIcon();
				},
				{ timeout: 250 },
			);
		} else {
			timeoutHandle = globalThis.setTimeout(() => {
				timeoutHandle = null;
				renderIcon();
			}, 0);
		}
	};

	const observe = () => {
		clearPending();
		if (typeof IntersectionObserver === "undefined") {
			scheduleRender();
			return;
		}

		const root = node.closest(".file-set-editor-list");
		observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((observerEntry) => observerEntry.isIntersecting)) {
					observer?.disconnect();
					observer = null;
					scheduleRender();
				}
			},
			{
				root: root instanceof Element ? root : null,
				rootMargin: "120px 0px",
				threshold: 0,
			},
		);
		observer.observe(node);
	};

	observe();

	return {
		update(nextOptions: LazyFileIconOptions) {
			currentOptions = nextOptions;
			hasRendered = false;
			observe();
		},
		destroy() {
			clearPending();
		},
	};
}

function handleFileLinkClick(event: MouseEvent): void {
	event.preventDefault();
	event.stopPropagation();
	app.workspace.openLinkText(entry.path, sourcePath, Keymap.isModEvent(event));
}

function previewFileLink(event: Event): void {
	const target = event.currentTarget;
	if (!(target instanceof HTMLElement)) return;

	app.workspace.trigger("hover-link", {
		event,
		source: hoverSource,
		hoverParent: getPlugin(),
		targetEl: target,
		linktext: entry.path,
		sourcePath,
	});
}
</script>

<div class="space-file-row" class:space-file-row--compact={compact} title={entry.path}>
  <div class="space-file-link-row">
    <span
      class="space-file-link-icon s2b-search-result-note-icon"
      aria-hidden="true"
      use:iconDirective={getFileIconName(entry.path)}
      use:lazyFileIcon={{ app, path: entry.path }}
    ></span>
    <a
      class="internal-link space-file-link truncate"
      href={entry.path}
      data-href={entry.path}
      onclick={handleFileLinkClick}
      onmouseover={previewFileLink}
      onfocus={previewFileLink}
    >
      {entry.displayName ?? getFileDisplayName(entry.path)}
    </a>
    {#if entry.contextLabel}
      <span class="space-file-context truncate">{entry.contextLabel}</span>
    {/if}
  </div>

  {#if actions}
    <div class="space-file-actions">
      {@render actions()}
    </div>
  {/if}
</div>

<style>
  /*
   * Flat rows with a hover highlight, matching Obsidian's own list surfaces
   * (file explorer, search results) rather than boxing each entry in a card.
   * Keeps long lists scannable and the row height uniform whether or not the
   * entry has a context label.
   */
  .space-file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 6px;
    border-radius: var(--radius-s);
    min-height: 28px;
  }

  .space-file-row:hover {
    background: var(--background-modifier-hover);
  }

  .space-file-row--compact {
    opacity: 0.85;
  }

  .space-file-link-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .space-file-link-icon {
    flex-shrink: 0;
    color: var(--text-faint);
    align-self: center;
    display: flex;
    align-items: center;
  }

  .space-file-link {
    min-width: 0;
    color: var(--text-normal);
    text-decoration: none;
  }

  .space-file-link:hover {
    color: var(--text-accent);
    text-decoration: underline;
  }

  /* Trails the filename inline; shrinks first so the name keeps priority. */
  .space-file-context {
    font-size: var(--font-smallest);
    color: var(--text-faint);
    flex-shrink: 1;
    min-width: 0;
  }

  .space-file-actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }

  /*
   * Shrink the action buttons to match the tighter row. Scoped to this row's
   * buttons so the modal's other controls keep their normal sizing.
   */
  .space-file-actions :global(button) {
    height: auto;
    padding: 3px 8px;
    font-size: var(--font-smaller);
    box-shadow: none;
  }
</style>
