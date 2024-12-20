<script lang="ts">
    import { crossfade } from 'svelte/transition';

    export let options: string[];
    export let selected: string = options[0];
    const [send, recieve] = crossfade({ duration: 500 });
</script>

<ul class="m-0 flex list-none p-0 transition-all">
    {#each options as option}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <li
            class="flex h-full flex-col items-center justify-center rounded-md p-2 text-center font-bold hover:bg-[--background-modifier-hover]"
            on:click={() => (selected = option)}
        >
            <span>{option}</span>
            {#if option === selected}
                <div in:send={{ key: 0 }} out:recieve={{ key: 0 }} class="border-1 border-primary w-full border border-solid" />
            {/if}
        </li>
    {/each}
</ul>
