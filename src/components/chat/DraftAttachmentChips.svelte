<script lang="ts">
import { Keymap } from "obsidian";
import type { ChatAttachment } from "../../types/shared";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";

interface Props {
	attachments: ChatAttachment[];
	onRemoveAttachment: (attachment: ChatAttachment) => void;
}

const { attachments, onRemoveAttachment }: Props = $props();

const MAX_VISIBLE = 5;
let expanded = $state(false);
const hiddenCount = $derived(Math.max(0, attachments.length - MAX_VISIBLE));
const visibleAttachments = $derived(expanded ? attachments : attachments.slice(0, MAX_VISIBLE));

const sourcePath = $derived(getPlugin().app.workspace.getActiveFile()?.path ?? "");

function attachmentIcon(attachment: ChatAttachment): string {
	return attachment.mimeType.startsWith("image/") ? "image" : "paperclip";
}

function previewAttachment(evt: Event, vaultPath: string): void {
	const target = evt.currentTarget;
	if (!(target instanceof HTMLElement)) return;

	getPlugin().app.workspace.trigger("hover-link", {
		event: evt,
		source: VIEW_TYPE_CHAT,
		hoverParent: getPlugin(),
		targetEl: target,
		linktext: vaultPath,
		sourcePath,
	});
}

function onAttachmentClick(evt: MouseEvent, attachment: ChatAttachment): void {
	if (Keymap.isModEvent(evt)) {
		evt.preventDefault();
		evt.stopPropagation();
		getPlugin().app.workspace.openLinkText(attachment.vaultPath, sourcePath, true);
		return;
	}

	onRemoveAttachment(attachment);
}
</script>

{#if attachments.length > 0}
  <div class="draft-attachment-chips flex flex-row flex-wrap gap-1.5">
    {#each visibleAttachments as attachment (attachment.vaultPath)}
      <button
        type="button"
        class="draft-attachment-chip"
        title={`${attachment.vaultPath} (click to remove attachment)`}
        onclick={(evt) => onAttachmentClick(evt, attachment)}
        onmouseover={(evt) => previewAttachment(evt, attachment.vaultPath)}
        onfocus={(evt) => previewAttachment(evt, attachment.vaultPath)}
      >
        <div class="chip-icon" use:icon={attachmentIcon(attachment)} style="--icon-size: 12px"></div>
        <span>{attachment.name}</span>
      </button>
    {/each}
    {#if !expanded && hiddenCount > 0}
      <button type="button" class="more-chip" onclick={() => (expanded = true)}>+{hiddenCount} more</button>
    {:else if expanded && attachments.length > MAX_VISIBLE}
      <button type="button" class="more-chip" onclick={() => (expanded = false)}>show less</button>
    {/if}
  </div>
{/if}

<style>
  .draft-attachment-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    font-size: 11px;
    line-height: 1.15;
    background: color-mix(in srgb, var(--color-green) 18%, var(--background-secondary));
    border: 1px solid color-mix(in srgb, var(--color-green) 18%, transparent);
    border-radius: 999px;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 10%, transparent),
      0 1px 2px color-mix(in srgb, black 10%, transparent);
    color: var(--text-normal);
    white-space: nowrap;
    text-align: left;
    cursor: pointer;
    transition:
      background 0.15s ease,
      opacity 0.15s ease,
      border-color 0.15s ease,
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }

  .draft-attachment-chip:hover {
    background: color-mix(in srgb, var(--color-green) 24%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--color-green) 24%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 3px 8px color-mix(in srgb, black 12%, transparent);
    transform: translateY(-1px);
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .draft-attachment-chip:focus-visible {
    outline: none;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 0 0 2px color-mix(in srgb, var(--color-green) 28%, transparent),
      0 3px 8px color-mix(in srgb, black 12%, transparent);
  }

  .more-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    font-size: 11px;
    line-height: 1.15;
    background: var(--background-modifier-hover);
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    color: var(--text-muted);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .more-chip:hover {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }
</style>
