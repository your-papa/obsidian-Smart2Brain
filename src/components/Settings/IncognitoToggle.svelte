<script lang="ts">
    import { Notice } from 'obsidian';
    import { isIncognitoMode } from '../../store';
    import { plugin, papaState, type PapaState } from '../../store';
    import { crossfade } from 'svelte/transition';

    const [send, recieve] = crossfade({ duration: 500 });

    let oldPapaState: PapaState;
    function setIncognitoMode(incognito: boolean) {
        if (incognito === $isIncognitoMode) return;
        if ($papaState === 'running') return new Notice('Please wait for the current query to finish', 4000);
        else if ($papaState === 'indexing' || $papaState === 'indexing-pause' || $papaState === 'loading')
            return new Notice('Please wait for the indexing to finish', 4000);
        $isIncognitoMode = incognito;
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
        if ($papaState === 'mode-change') {
            // Already in mode-change state so we restore the previous state (there are only two states)
            $papaState = oldPapaState;
            return;
        }
        oldPapaState = $papaState;
        $papaState = 'mode-change';
    }
</script>

<ul class="m-0 flex list-none p-0 transition-all">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <li
        class="flex h-full flex-col items-center justify-center rounded-md p-2 text-center font-bold hover:bg-[--background-modifier-hover]"
        on:click={() => setIncognitoMode(true)}
    >
        Run on your machine
        {#if $isIncognitoMode}
            <div in:send={{ key: 0 }} out:recieve={{ key: 0 }} class="border-1 border-primary w-full border border-solid" />
        {/if}
    </li>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <li
        class="flex h-full flex-col items-center justify-center rounded-md p-2 text-center font-bold hover:bg-[--background-modifier-hover]"
        on:click={() => setIncognitoMode(false)}
    >
        Run via Third-Parties
        {#if !$isIncognitoMode}
            <div in:send={{ key: 0 }} out:recieve={{ key: 0 }} class="border-1 border-primary w-full border border-solid" />
        {/if}
    </li>
</ul>
