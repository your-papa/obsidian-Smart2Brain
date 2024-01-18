<script lang="ts">
    import TextComponent from './SettingComponents/Text.svelte';
    import SearchComponent from './SettingComponents/Search.svelte';
    import { plugin } from '../store';
    import { Notice, setIcon } from 'obsidian';
    import { afterUpdate, onMount } from 'svelte';

    let baseFontSize: number;
    let searchValue: string;
    let excludeComponent: HTMLDivElement;
    let isExpanded: boolean = false;
    let isOverflowingVertically: boolean = false;

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    function addFolder(ff: string) {
        ff = ff.trim();
        if (!$plugin.data.excludeFF.includes(ff) && ff !== '') {
            $plugin.data.excludeFF = [...$plugin.data.excludeFF, ff];
            searchValue = '';
            $plugin.saveSettings();
        } else {
            searchValue = '';
            new Notice('Folder already exists or value is empty');
        }
    }

    function deleteFolder(ff: string) {
        $plugin.data.excludeFF = $plugin.data.excludeFF.filter((f: string) => f !== ff);
        $plugin.saveSettings();
    }

    function toggleExpand() {
        isExpanded = !isExpanded;
    }

    function checkOverflow(excludeComponent: HTMLDivElement) {
        isOverflowingVertically = excludeComponent.scrollHeight > baseFontSize * 1.5; //convert to rem
        if (!isOverflowingVertically) isExpanded = false;
    }

    onMount(() => {
        baseFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        if (excludeComponent) checkOverflow(excludeComponent);
    });

    afterUpdate(() => {
        if (excludeComponent) checkOverflow(excludeComponent);
    });
</script>

<SearchComponent settingName="Exclude Files and Folders" placeholder="Folder/SubFolder" bind:inputValue={searchValue} changeFunc={addFolder} />
{#if $plugin.data.excludeFF.length !== 0}
    <div class="flex justify-between">
        <div bind:this={excludeComponent} class="{isExpanded ? 'max-h-auto' : 'max-h-6 overflow-hidden'} gap-1 flex flex-row flex-wrap mb-3">
            {#each $plugin.data.excludeFF as ff ($plugin.data.excludeFF)}
                <div class="setting-command-hotkeys h-6">
                    <span class="setting-hotkey">
                        {ff}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            aria-label="Delete from Exclusions"
                            class="setting-hotkey-icon setting-delete-hotkey w-4"
                            use:icon={'x'}
                            on:click={() => deleteFolder(ff)}
                        />
                    </span>
                </div>
            {/each}
        </div>
        {#if isExpanded}
            <span class="clickable-icon algin-baseline h-6" use:icon={'chevron-up'} on:click={toggleExpand} />
        {/if}
        {#if isOverflowingVertically && !isExpanded}
            <span class="clickable-icon mb-3" use:icon={'chevron-down'} on:click={toggleExpand} />
        {/if}
    </div>
{/if}
