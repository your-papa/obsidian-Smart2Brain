<script lang="ts" generics="T">
type DropdownProps<T> = {
	options: { display: string; value: T }[];
	changeFunc: (selected: T) => void;
	selected: T;
};

let { options, changeFunc, selected = $bindable() }: DropdownProps<T> = $props();
</script>
<select class="dropdown" bind:value={selected} onchange={() => changeFunc(selected)}>
    {#each options as option}
        <option value={option.value}>{option.display}</option>
    {/each}
</select>
