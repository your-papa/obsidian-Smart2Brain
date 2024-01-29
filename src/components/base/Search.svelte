<script lang="ts">
    import { plugin } from '../../globals/store';
    import { FFSuggest } from '../../utils/Suggester';

    export let placeholder: string = '';
    export let changeFunc: (value: string) => void;

    export let inputValue: string = '';

    let inputElem: HTMLInputElement;

    function clearSearch() {
        inputValue = '';
    }
    $: if (inputElem) {
        new FFSuggest($plugin.app, inputElem, $plugin.data.excludeFF);
    }
</script>

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
