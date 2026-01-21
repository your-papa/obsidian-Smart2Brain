<script lang="ts">
interface Props {
	value?: number;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	showValue?: boolean;
	class?: string;
	onchange?: (value: number) => void;
	oncommit?: (value: number) => void;
}

let {
	value = $bindable(50),
	min = 0,
	max = 100,
	step = 1,
	disabled = false,
	showValue = false,
	class: className = "",
	onchange,
	oncommit,
}: Props = $props();

function handleInput(e: Event) {
	const target = e.target as HTMLInputElement;
	value = Number(target.value);
	onchange?.(value);
}

function handleChange(e: Event) {
	const target = e.target as HTMLInputElement;
	value = Number(target.value);
	oncommit?.(value);
}
</script>

<div class="flex items-center gap-2 {className}">
	{#if showValue}
		<output class="text-ui-small text-text-muted w-8 text-right">{value}</output>
	{/if}
	<input
		type="range"
		class="w-full h-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
		{value}
		{min}
		{max}
		{step}
		{disabled}
		oninput={handleInput}
		onchange={handleChange}
	/>
</div>
