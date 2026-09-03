<script lang="ts">
interface Props {
	id?: string;
	value?: string;
	placeholder?: string;
	rows?: number;
	disabled?: boolean;
	class?: string;
	onchange?: (value: string) => void;
	onblur?: (value: string) => void;
}

let {
	id,
	value = $bindable(""),
	placeholder = "",
	rows = 4,
	disabled = false,
	class: className = "",
	onchange,
	onblur,
}: Props = $props();
</script>

<textarea
	{id}
	bind:value
	{placeholder}
	{rows}
	{disabled}
	class={className}
	oninput={() => onchange?.(value)}
	onblur={() => onblur?.(value)}
></textarea>
