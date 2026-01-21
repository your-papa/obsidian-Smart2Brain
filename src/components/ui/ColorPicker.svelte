<script lang="ts">
interface Props {
	value?: string;
	disabled?: boolean;
	class?: string;
	onchange?: (value: string) => void;
}

let { value = $bindable("#000000"), disabled = false, class: className = "", onchange }: Props = $props();
</script>

<input
	type="color"
	bind:value
	{disabled}
	oninput={() => onchange?.(value)}
	class="appearance-none border border-solid border-[--background-modifier-border] w-[--input-height] h-[--input-height] rounded-[--radius-s] cursor-pointer p-0 bg-transparent disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[--background-modifier-border-focus] focus-visible:outline-offset-2 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-none [&::-moz-color-swatch]:rounded-sm {className}"
/>
