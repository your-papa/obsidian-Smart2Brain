<script lang="ts">
import { QueryClientProvider } from "@tanstack/svelte-query";
import Input from "../../components/chat/Input.svelte";
import MessageContainer from "../../components/chat/MessageContainer.svelte";
import { getMessenger } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const plugin = getPlugin();

const messenger = getMessenger();

let messageContainer = $state<ReturnType<typeof MessageContainer> | undefined>();
let input = $state<ReturnType<typeof Input> | undefined>();
let lastSessionId: string | null = null;

$effect(() => {
	const sessionId = messenger?.session?.id ?? null;
	if (!sessionId || sessionId === lastSessionId) return;
	lastSessionId = sessionId;
	input?.focusEditor();
});
</script>

<QueryClientProvider client={plugin.queryClient}>
	<div class="chat-root h-full flex flex-col" data-testid="chat-root">
		{#if messenger}
			<MessageContainer bind:this={messageContainer} {messenger} />
			<Input
				bind:this={input}
				{messenger}
				onMessageSent={() => messageContainer?.scrollToLatestMessage()}
			/>
		{:else}
			<div class="flex h-full items-center justify-center p-4 text-center text-sm text-[--text-muted]">
				Chat session is not available yet. Reopen this view after plugin initialization completes.
			</div>
		{/if}
	</div>
</QueryClientProvider>

<style>
  :global(.chat-root:has(.chat-input-wrapper:focus-within) .logo-container) {
    transform: translateY(-2px) scale(1.02);
  }

  :global(.chat-root:has(.chat-input-wrapper:focus-within) .logo-container svg) {
    fill: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
    stroke: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
    filter: drop-shadow(0 0 8px color-mix(in srgb, var(--interactive-accent) 30%, transparent))
      drop-shadow(0 4px 10px color-mix(in srgb, var(--interactive-accent) 18%, transparent));
  }
</style>
