<script lang="ts">
import { QueryClientProvider } from "@tanstack/svelte-query";
import Input from "../../components/chat/Input.svelte";
import MessageContainer from "../../components/chat/MessageContainer.svelte";
import { getSessionRegistry } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";
import type { ThreadPathStore } from "./threadPathStore.svelte";

interface Props {
	threadPathStore: ThreadPathStore;
}

const { threadPathStore }: Props = $props();

const threadPath = $derived(threadPathStore.current);

const plugin = getPlugin();

const registry = getSessionRegistry();

let messageContainer = $state<ReturnType<typeof MessageContainer> | undefined>();
let input = $state<ReturnType<typeof Input> | undefined>();
let lastSessionId: string | null = null;
let isDragging = $state(false);
let dragMessage = $state("Drop files here");
let dragHasIssue = $state(false);

$effect(() => {
	const sessionId = registry?.sessionFor(threadPath)?.id ?? null;
	if (!sessionId || sessionId === lastSessionId) return;
	lastSessionId = sessionId;
	input?.focusEditor();
});

function handleRootDragEnter(event: DragEvent) {
	input?.handleDragEnter(event);
}

function handleRootDragOver(event: DragEvent) {
	input?.handleDragOver(event);
}

function handleRootDragLeave(event: DragEvent) {
	input?.handleDragLeave(event);
}

async function handleRootDrop(event: DragEvent) {
	await input?.handleDrop(event);
}
</script>

<QueryClientProvider client={plugin.queryClient}>
  <div
    class="chat-root relative h-full flex flex-col gap-0 overflow-hidden"
    data-testid="chat-root"
    role="region"
    ondragenter={handleRootDragEnter}
    ondragover={handleRootDragOver}
    ondragleave={handleRootDragLeave}
    ondrop={handleRootDrop}
  >
    {#if registry}
      <MessageContainer bind:this={messageContainer} {registry} {threadPath} />
      <Input
        bind:this={input}
        {registry}
        {threadPath}
        dropTargetMode="view"
        externalDragActive={isDragging}
        onDragStateChange={(state) => {
          isDragging = state.isDragging;
          dragMessage = state.dragMessage;
          dragHasIssue = state.dragHasIssue;
        }}
        onMessageSent={() => messageContainer?.scrollToLatestMessage()}
      />
    {:else}
      <div
        class="flex h-full items-center justify-center p-4 text-center text-sm text-[--text-muted]"
      >
        Chat session is not available yet. Reopen this view after plugin initialization completes.
      </div>
    {/if}

    {#if isDragging}
      <div
        class="chat-drop-overlay absolute inset-0 z-30 pointer-events-none flex items-center justify-center p-6"
      >
        <div
          class="chat-drop-overlay-panel flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-medium shadow-lg {dragHasIssue
            ? 'chat-drop-overlay-panel-issue'
            : 'chat-drop-overlay-panel-active'}"
        >
          <div
            class="h-icon-s w-icon-s"
            style="--icon-size: var(--icon-s)"
            data-testid="chat-drop-overlay-icon"
            use:icon={dragHasIssue ? "alert-triangle" : "upload"}
          ></div>
          <span data-testid="chat-drop-overlay-message">{dragMessage}</span>
        </div>
      </div>
    {/if}
  </div>
</QueryClientProvider>

<style>
  :global(.chat-root .scroll-container) {
    padding-top: 44px;
  }

  :global(.chat-root > .chat-input-container) {
    margin-top: -12px;
    padding-top: 12px;
    z-index: 10;
  }

  .chat-root::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 140ms ease;
    background: radial-gradient(
        circle at top,
        color-mix(in srgb, var(--interactive-accent) 16%, transparent),
        transparent 58%
      ),
      color-mix(in srgb, var(--chat-bg) 72%, transparent);
  }

  .chat-root {
    --chat-bg: var(--background-primary);
  }

  :global(.mod-left-split .chat-root),
  :global(.mod-right-split .chat-root) {
    --chat-bg: var(--background-secondary);
  }

  .chat-root::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 32px;
    pointer-events: none;
    z-index: 25;
    background: linear-gradient(
        to bottom,
        color-mix(in srgb, var(--chat-bg) 60%, transparent) 0%,
        transparent 100%
      );
  }

  .chat-root:has(.chat-drop-overlay)::before {
    opacity: 1;
  }

  .chat-drop-overlay-panel {
    border: 1px dashed transparent;
    backdrop-filter: blur(6px);
  }

  .chat-drop-overlay-panel-active {
    color: var(--text-accent);
    background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-primary));
    border-color: color-mix(in srgb, var(--interactive-accent) 55%, transparent);
  }

  .chat-drop-overlay-panel-issue {
    color: var(--text-error);
    background: color-mix(in srgb, var(--background-modifier-error) 70%, var(--background-primary));
    border-color: color-mix(in srgb, var(--text-error) 45%, transparent);
  }

</style>
