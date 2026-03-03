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

  // Non-image attachments to display as pills inside the bubble
  const fileAttachments = $derived(
    attachments?.filter((a) => !a.mimeType.startsWith("image/")) ?? [],
  );

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
    {#if fileAttachments.length > 0}
      <div class="flex flex-wrap gap-2 mb-2">
        {#each fileAttachments as att (att.vaultPath)}
          {#if att.mimeType === "application/pdf"}
            <div
              class="flex items-center gap-1 text-xs text-[--text-muted] bg-[--background-modifier-hover] rounded px-2 py-1"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline
                  points="14 2 14 8 20 8"
                /></svg
              >
              <span>{att.name}</span>
            </div>
          {:else}
            <div
              class="flex items-center gap-1 text-xs text-[--text-muted] bg-[--background-modifier-hover] rounded px-2 py-1"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline
                  points="14 2 14 8 20 8"
                /><line x1="16" y1="13" x2="8" y2="13" /><line
                  x1="16"
                  y1="17"
                  x2="8"
                  y2="17"
                /><polyline points="10 9 9 9 8 9" /></svg
              >
              <span>{att.name}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
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
