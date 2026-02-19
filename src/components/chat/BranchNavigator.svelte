<script lang="ts">
import type { BranchInfo } from "../../stores/chatStore.svelte";
import { icon } from "../../utils/utils";

interface Props {
	/** Branch information for navigation */
	branchInfo: BranchInfo;
	/** Called when user navigates to a different branch */
	onNavigate: (checkpointId: string) => void;
}

const { branchInfo, onNavigate }: Props = $props();

const canGoLeft = $derived(branchInfo.currentIndex > 1);
const canGoRight = $derived(branchInfo.currentIndex < branchInfo.totalBranches);

function navigateLeft() {
	if (!canGoLeft) return;
	const prevCheckpointId = branchInfo.siblingCheckpointIds[branchInfo.currentIndex - 2];
	if (prevCheckpointId) {
		onNavigate(prevCheckpointId);
	}
}

function navigateRight() {
	if (!canGoRight) return;
	const nextCheckpointId = branchInfo.siblingCheckpointIds[branchInfo.currentIndex];
	if (nextCheckpointId) {
		onNavigate(nextCheckpointId);
	}
}
</script>

{#if branchInfo.totalBranches > 1}
	<div class="flex items-center gap-1 text-xs text-text-muted select-none">
		<button
			class="p-0.5 rounded border-none bg-transparent cursor-pointer flex items-center justify-center hover:bg-background-modifier-hover hover:text-text-normal disabled:opacity-30 disabled:cursor-not-allowed"
			disabled={!canGoLeft}
			onclick={navigateLeft}
			aria-label="Previous branch"
			title="Previous branch"
		>
			<div
				class="w-3 h-3"
				use:icon={"chevron-left"}
				style="--icon-size: 12px"
			></div>
		</button>
		<span class="font-medium tabular-nums">
			{branchInfo.currentIndex} / {branchInfo.totalBranches}
		</span>
		<button
			class="p-0.5 rounded border-none bg-transparent cursor-pointer flex items-center justify-center hover:bg-background-modifier-hover hover:text-text-normal disabled:opacity-30 disabled:cursor-not-allowed"
			disabled={!canGoRight}
			onclick={navigateRight}
			aria-label="Next branch"
			title="Next branch"
		>
			<div
				class="w-3 h-3"
				use:icon={"chevron-right"}
				style="--icon-size: 12px"
			></div>
		</button>
	</div>
{/if}
