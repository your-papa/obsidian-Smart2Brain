<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import type { TFile } from "obsidian";

	export let suggestions: TFile[] = [];
	export let selectedIndex: number = 0;

	const dispatch = createEventDispatcher();

	function select(index: number) {
		if (index >= 0 && index < suggestions.length) {
			dispatch("select", suggestions[index]);
		}
	}
</script>

<div class="suggestion-container">
	{#each suggestions as file, index}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="suggestion-item"
			class:is-selected={index === selectedIndex}
			on:mousedown|preventDefault={() => select(index)}
			on:mouseenter={() => dispatch("hover", index)}
		>
			<div class="suggestion-content">
				<div class="suggestion-title">{file.basename}</div>
				<div class="suggestion-note">{file.path}</div>
			</div>
		</div>
	{/each}
</div>

<style>
	.suggestion-container {
		max-height: 300px;
		overflow-y: auto;
		background-color: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		box-shadow: var(--shadow-s);
		z-index: 1000;
		padding: 0;
		margin: 0;
		position: absolute;
		bottom: 100%; /* Position above the input */
		left: 0;
		right: 0;
		margin-bottom: 8px;
	}

	.suggestion-item {
		display: flex;
		align-items: center;
		padding: 6px 10px;
		cursor: pointer;
		border-radius: 0;
		color: var(--text-normal);
		font-size: var(--font-ui-small);
	}

	.suggestion-item.is-selected {
		background-color: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.suggestion-content {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		width: 100%;
	}

	.suggestion-title {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.suggestion-note {
		font-size: 0.8em;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>

