<script lang="ts">
import { Keymap } from "obsidian";
import type { ChatAttachment } from "../../types/shared";
import { getPlugin } from "../../stores/state.svelte";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";

interface Props {
	attachments: ChatAttachment[];
}

const { attachments }: Props = $props();

const sourcePath = $derived(getPlugin().app.workspace.getActiveFile()?.path ?? "");

function iconNameForAttachment(att: ChatAttachment): string {
	if (att.mimeType === "application/pdf") return "📄";
	if (att.mimeType === "application/json") return "🧩";
	if (att.mimeType.startsWith("text/")) return "📝";
	return "📎";
}

function onAttachmentClick(evt: MouseEvent, attachment: ChatAttachment): void {
	evt.preventDefault();
	evt.stopPropagation();
	getPlugin().app.workspace.openLinkText(attachment.vaultPath, sourcePath, Keymap.isModEvent(evt));
}

function onAttachmentHover(evt: Event, attachment: ChatAttachment): void {
	const target = evt.currentTarget;
	if (!(target instanceof HTMLElement)) return;

	getPlugin().app.workspace.trigger("hover-link", {
		event: evt,
		source: VIEW_TYPE_CHAT,
		hoverParent: getPlugin(),
		targetEl: target,
		linktext: attachment.vaultPath,
		sourcePath,
	});
}
</script>

{#if attachments.length > 0}
  <div class="flex flex-wrap gap-2 justify-end">
    {#each attachments as attachment (attachment.vaultPath)}
      <a
        class="internal-link flex items-center gap-1 rounded-lg bg-[--background-modifier-hover] px-3 py-2 text-xs text-[--text-muted] no-underline hover:text-[--text-accent]"
        href={attachment.vaultPath}
        data-href={attachment.vaultPath}
        onclick={(evt) => onAttachmentClick(evt, attachment)}
        onmouseover={(evt) => onAttachmentHover(evt, attachment)}
        onfocus={(evt) => onAttachmentHover(evt, attachment)}
      >
        <span>{iconNameForAttachment(attachment)}</span>
        <span>{attachment.name}</span>
      </a>
    {/each}
  </div>
{/if}
