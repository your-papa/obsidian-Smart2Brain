<script lang="ts">
import { getSessionRegistry } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";

const registry = $derived(getSessionRegistry());

// All chats currently streaming. Concurrency-ready: one chip per running
// session. Under the Phase-1 one-at-a-time policy there is at most one.
const running = $derived(
	(registry?.runningSessions ?? []).map((s) => ({
		path: s.id,
		name:
			s.id
				.split("/")
				.pop()
				?.replace(/\.chat$/, "") ?? s.id,
		stop: () => s.stopStreaming(),
	})),
);

function openChat(path: string) {
	void getPlugin().agentManager.openChatByThreadId(path);
}
</script>

{#each running as chat (chat.path)}
	<span class="s2b-running-indicator flex items-center gap-1">
		<button
			type="button"
			class="flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-[--text-muted] hover:text-[--text-normal]"
			onclick={() => openChat(chat.path)}
			title="Go to the running chat"
		>
			<span
				class="s2b-running-spinner w-[--icon-xs] h-[--icon-xs]"
				style="--icon-size: var(--icon-xs)"
				use:icon={"loader-circle"}
			></span>
			<span>Agent running in {chat.name}</span>
		</button>
		<button
			type="button"
			class="flex items-center bg-transparent border-none p-0 cursor-pointer text-[--text-muted] hover:text-[--text-error]"
			onclick={chat.stop}
			title="Stop the running agent"
			aria-label="stop the running agent"
		>
			<span class="w-[--icon-xs] h-[--icon-xs]" style="--icon-size: var(--icon-xs)" use:icon={"square"}></span>
		</button>
	</span>
{/each}

<style>
	.s2b-running-spinner {
		animation: s2b-spin 1.2s linear infinite;
	}
	@keyframes s2b-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
