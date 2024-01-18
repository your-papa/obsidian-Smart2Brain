<script lang="ts">
    import { plugin } from '../../store';
    import { FFSuggest } from '../../utils/Suggester';
    import ChatView from '../ChatView.svelte';

    export let settingName: string;
    export let settingDesc: string = '';
    export let placeholder: string = '';
    export let changeFunc: (value: string) => void;

    export let inputValue: string = '';

    let inputElem: HTMLInputElement;

    function clearSearch() {
        inputValue = '';
    }
    $: if (inputElem) {
        new FFSuggest($plugin.app, inputElem);
    }
</script>

<div class="setting-item">
    <div class="setting-item-info">
        <div class="setting-item-name">{settingName}</div>
        <div class="setting-item-description">{settingDesc}</div>
    </div>
    <div class="setting-item-control">
        <slot />
        <div class="search-input-container">
            <input
                enterkeyhint="search"
                type="search"
                spellcheck="false"
                {placeholder}
                bind:this={inputElem}
                bind:value={inputValue}
                on:blur={() => changeFunc(inputValue)}
            />
            {#if inputValue.length > 0}
                <div class="search-input-clear-button" on:click={clearSearch}></div>
            {/if}
        </div>
    </div>
</div>
