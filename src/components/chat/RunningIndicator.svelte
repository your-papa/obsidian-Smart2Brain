<script lang="ts">
import { getMessenger } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";

const messenger = $derived(getMessenger());

const runningPath = $derived(messenger?.runningThreadPath ?? null);
const runningName = $derived.by(() => {
	if (!runningPath) return null;
	return (
		runningPath
			.split("/")
			.pop()
			?.replace(/\.chat$/, "") ?? runningPath
	);
});

function openRunningChat() {
	if (runningPath) void getPlugin().agentManager.openChatByThreadId(runningPath);
}

function stopRunning() {
	messenger?.stopRunning();
}
</script>

{#if runningPath}
	<span class="s2b-running-indicator flex items-center gap-1">
		<button
			type="button"
			class="flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-[--text-muted] hover:text-[--text-normal]"
			onclick={openRunningChat}
			title="Go to the running chat"
		>
			<span
				class="s2b-running-spinner w-[--icon-xs] h-[--icon-xs]"
				style="--icon-size: var(--icon-xs)"
				use:icon={"loader-circle"}
			></span>
			<span>Agent running in {runningName}</span>
		</button>
		<button
			type="button"
			class="flex items-center bg-transparent border-none p-0 cursor-pointer text-[--text-muted] hover:text-[--text-error]"
			onclick={stopRunning}
			title="Stop the running agent"
			aria-label="stop the running agent"
		>
			<span class="w-[--icon-xs] h-[--icon-xs]" style="--icon-size: var(--icon-xs)" use:icon={"square"}></span>
		</button>
	</span>
{/if}

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
