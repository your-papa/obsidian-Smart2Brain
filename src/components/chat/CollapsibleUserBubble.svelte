<script lang="ts">
import { useResizeObserver } from "runed";
import type { ChatAttachment } from "../../types/shared";
import IconButton from "../ui/IconButton.svelte";
import MarkdownRenderer from "../ui/MarkdownRenderer.svelte";

interface Props {
	content: string;
	attachments?: ChatAttachment[];
	class?: string;
}

const { content, attachments, class: className = "" }: Props = $props();

const COLLAPSED_HEIGHT = 96; // ~4 lines at 24px line-height

let isExpanded = $state(false);
let contentEl: HTMLElement | null = $state(null);
let isTruncated = $state(false);

// Check if content exceeds collapsed height when element resizes
useResizeObserver(
	() => contentEl,
	() => {
		if (contentEl) {
			isTruncated = contentEl.scrollHeight > COLLAPSED_HEIGHT;
		}
	},
);

function handleClick(evt: MouseEvent) {
	// Don't toggle if clicking a link
	const target = evt.target as HTMLElement;
	if (target.closest("a")) {
		return;
	}

	if (isTruncated) {
		isExpanded = !isExpanded;
	}
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="group relative {className} {isTruncated ? 'cursor-pointer' : ''}" onclick={handleClick}>
  <!-- Inner content with collapse behavior -->
  <div
    bind:this={contentEl}
    class="overflow-hidden transition-[max-height] duration-200 ease-out break-words [overflow-wrap:anywhere]"
    style:max-height={isExpanded || !isTruncated ? "none" : `${COLLAPSED_HEIGHT}px`}
  >
    <MarkdownRenderer {content} class="[&>p]:m-0 break-words [overflow-wrap:anywhere]" />
  </div>

  {#if isTruncated && !isExpanded}
    <!-- Fade gradient overlay -->
    <div
      class="absolute bottom-0 left-0 right-0 h-8 pointer-events-none rounded-bl-lg"
      style="background: linear-gradient(to top, color-mix(in srgb, var(--color-accent) 20%, var(--background-primary)), transparent);"
    ></div>
  {/if}

  {#if isTruncated}
    <!-- Expand/collapse icon button (visible on hover) -->
    <div
      class="absolute bottom-1 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
    >
      <IconButton
        icon="chevron-down"
        label={isExpanded ? "Collapse message" : "Expand message"}
        size="xs"
        class="transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}"
        onclick={(e) => {
          e.stopPropagation();
          isExpanded = !isExpanded;
        }}
      />
    </div>
  {/if}
</div>
