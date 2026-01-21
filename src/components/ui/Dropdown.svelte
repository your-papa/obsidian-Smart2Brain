<script lang="ts" generics="T">
type DropdownOption<T> = {
	display: string;
	value: T;
	disabled?: boolean;
};

type DropdownGroup<T> = {
	label: string;
	options: DropdownOption<T>[];
};

type DropdownProps<T> = {
	onSelect?: (selected: T) => void;
	onchange?: (selected: T) => void;
	selected?: T;
	disabled?: boolean;
	class?: string;
	style?: string;
} & ({ type: "options"; dropdown: DropdownOption<T>[] } | { type: "groups"; dropdown: DropdownGroup<T>[] });

let {
	dropdown,
	onSelect,
	onchange,
	selected = $bindable(),
	disabled = false,
	class: className = "",
	style,
	type,
}: DropdownProps<T> = $props();

// Create typed variables for proper type narrowing
let groups = $derived(type === "groups" ? (dropdown as DropdownGroup<T>[]) : undefined);
let options = $derived(type === "options" ? (dropdown as DropdownOption<T>[]) : undefined);

function handleChange() {
	onSelect?.(selected as T);
	onchange?.(selected as T);
}
</script>

<select
	class="dropdown {className}"
	{style}
	bind:value={selected}
	onchange={handleChange}
	{disabled}
>
	{#if groups}
		{#each groups as group}
			<optgroup label={group.label}>
				{#each group.options as option}
					<option value={option.value} disabled={option.disabled}>
						{option.display}
					</option>
				{/each}
			</optgroup>
		{/each}
	{:else if options}
		{#each options as option}
			<option value={option.value} disabled={option.disabled}>
				{option.display}
			</option>
		{/each}
	{/if}
</select>
