<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	name: string;
	desc?: string;
	disabled?: boolean;
	class?: string;
	children?: Snippet;
}

let { name, desc, disabled = false, class: className = "", children }: Props = $props();
</script>

<div class="setting-item {className}" class:opacity-50={disabled} class:pointer-events-none={disabled}>
	<div class="setting-item-info">
		<div class="setting-item-name">{name}</div>
		{#if desc}
			<div class="setting-item-description">{desc}</div>
		{/if}
	</div>
	<div class="setting-item-control">
		{@render children?.()}
	</div>
</div>
