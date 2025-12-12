<script lang="ts" generics="T">
type DropdownOption<T> = {
	display: string;
	value: T;
};

type DropdownGroup<T> = {
	label: string;
	options: DropdownOption<T>[];
};

type DropdownProps<T> = {
	onSelect: (selected: T) => void;
	selected: T;
	style?: string;
} & ({ type: "options"; dropdown: DropdownOption<T>[] } | { type: "groups"; dropdown: DropdownGroup<T>[] });

let { dropdown, onSelect, selected = $bindable(), style, type }: DropdownProps<T> = $props();

// Create typed variables for proper type narrowing
let groups = $derived(type === "groups" ? (dropdown as DropdownGroup<T>[]) : undefined);
let options = $derived(type === "options" ? (dropdown as DropdownOption<T>[]) : undefined);
</script>
<select class={`dropdown ${style}`} bind:value={selected} onchange={() => onSelect(selected)}>
    {#if groups}
        {#each groups as group}
            <optgroup label={group.label}>
                {#each group.options as option}
                    <option value={option.value}>{option.display}</option>
                {/each}
            </optgroup>
        {/each}
    {:else if options}
        {#each options as option}
            <option value={option.value}>{option.display}</option>
        {/each}
    {/if}
</select>
