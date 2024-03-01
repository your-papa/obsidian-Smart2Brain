<script lang="ts">
    export let options: { display: string; value: string }[];
    export let changeFunc: (selected: string) => void;
    export let selected: string;
    $: console.log(options);
</script>

<select class="dropdown" bind:value={selected} on:change={() => changeFunc(selected)}>
    {#each options as option}
        <option value={option.value}>{option.display}</option>
    {/each}
</select>
