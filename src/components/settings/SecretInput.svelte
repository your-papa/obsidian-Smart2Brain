<script lang="ts">
import { SecretComponent } from "obsidian";
import { onMount } from "svelte";
import { getPlugin } from "../../stores/state.svelte";

interface Props {
	value: string;
	onChange: (value: string) => void;
}

const { value, onChange }: Props = $props();

const plugin = getPlugin();
let containerEl: HTMLElement;

onMount(() => {
	const secretComponent = new SecretComponent(plugin.app, containerEl);
	secretComponent.setValue(value);
	secretComponent.onChange(onChange);

	return () => {
		containerEl.empty();
	};
});
</script>

<div bind:this={containerEl} class="secret-input-container"></div>
