<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	heading?: string;
	headingDesc?: string;
	class?: string;
	children: Snippet;
}

let { heading, headingDesc, class: className = "", children }: Props = $props();
</script>

<div class="setting-group {className}">
	{#if heading}
		<div class="setting-item setting-item-heading">
			<div class="setting-item-info">
				<div class="setting-item-name">{heading}</div>
				{#if headingDesc}
					<div class="setting-item-description">{headingDesc}</div>
				{/if}
			</div>
			<div class="setting-item-control"></div>
		</div>
	{/if}
	<div class="setting-items">
		{@render children()}
	</div>
</div>
