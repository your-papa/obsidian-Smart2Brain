<script lang="ts">
    interface Props {
        options: { display: string; value: string }[];
        changeFunc: (selected: string) => void;
        selected: string;
    }

    let { options, changeFunc, selected = $bindable() }: Props = $props();
</script>

<select class="dropdown" bind:value={selected} onchange={() => changeFunc(selected)}>
    {#each options as option}
        <option value={option.value}>{option.display}</option>
    {/each}
</select>
