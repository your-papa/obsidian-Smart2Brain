<script lang="ts">
    import { get } from 'svelte/store';
    import { plugin, papaState, papaIndexingProgress, isOnboarded } from '../../store';
    import { setIcon } from 'obsidian';
    import ProgressBar from '../base/ProgressBar.svelte';

    // TODO redundant
    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    function completeOnboarding() {
        $isOnboarded = true;
        $plugin.data.isOnboarded = true;
        $plugin.saveSettings();
        $plugin.activateView();
        console.log(get(papaState));
    }
</script>

{#if $papaState === 'uninitialized'}
    <button class="mod-cta" on:click={() => $plugin.initPapa()}>Initialize your Second Brain</button>
{:else if $papaState === 'loading'}
    <p>Initializing...</p>
{:else if $papaState === 'indexing'}
    <p>Indexing vault...</p>
    <div class="w-full flex gap-1 items-center">
        <button
            aria-label="Pause indexing"
            on:click={() => ($papaState = 'indexing-paused')}
            class="h-8 px-4 py-2 rounded-l-md hover:bg-[--text-accent-hover] transition duration-300 ease-in-out"
            use:icon={'pause'}
        />
        <ProgressBar progress={$papaIndexingProgress} />
    </div>
{:else if $papaState === 'indexing-paused'}
    <p>Paused indexing vault</p>
    <div class="w-full flex gap-1 items-center">
        <button
            aria-label="Resume indexing"
            on:click={() => $plugin.initPapa()}
            class="h-8 px-4 py-2 rounded-l-md hover:bg-[--text-accent-hover] transition duration-300 ease-in-out"
            use:icon={'play'}
        />
        <ProgressBar progress={$papaIndexingProgress} />
    </div>
{:else if $papaState === 'idle'}
    <p>Hurray! Your Smart Second Brain is ready!</p>
    <button aria-label="Start chatting" class="mod-cta" on:click={() => completeOnboarding()}>Start chatting</button>
{:else if $papaState === 'error'}
    <p>An error occured.<br />Please retry initialization...</p>
    <button
        aria-label="Retry initializing"
        on:click={() => $plugin.initPapa()}
        class="h-8 px-4 py-2 rounded-l-md hover:bg-[--text-accent-hover] transition duration-300 ease-in-out"
        use:icon={'refresh-cw'}
    />
{/if}
