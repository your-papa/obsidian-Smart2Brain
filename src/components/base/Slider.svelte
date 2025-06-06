<script lang="ts">
    import { crossfade } from 'svelte/transition';

    interface Props {
        options: string[];
        selected?: string;
    }

    let { options, selected = $bindable(options[0]) }: Props = $props();
    const [send, recieve] = crossfade({ duration: 500 });
</script>

<ul class="m-0 flex list-none p-0 transition-all">
    {#each options as option}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
            class="flex h-full flex-col items-center justify-center rounded-md p-2 text-center font-bold hover:bg-[--background-modifier-hover]"
            onclick={() => (selected = option)}
        >
            <span>{option}</span>
            {#if option === selected}
                <div in:send={{ key: 0 }} out:recieve={{ key: 0 }} class="border-1 border-primary w-full border border-solid"></div>
            {/if}
        </li>
    {/each}
</ul>
