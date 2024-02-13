<script lang="ts">
    import { onMount } from 'svelte';
    import { plugin } from '../../store';
    import { FFSuggest } from './Suggester';

    export let placeholder: string = '';
    export let changeFunc: (value: string) => void;

    export let inputValue: string = '';

    let inputElem: HTMLInputElement;

    function clearSearch() {
        inputValue = '';
    }

    onMount(() => {
        new FFSuggest($plugin.app, inputElem);
        setTimeout(() => inputElem.blur(), 100);
    });
</script>

<input
    enterkeyhint="search"
    type="search"
    spellcheck="false"
    {placeholder}
    bind:value={inputValue}
    bind:this={inputElem}
    on:blur={() => changeFunc(inputValue)}
/>
{#if inputValue.length > 0}
    <div class="search-input-clear-button" on:click={clearSearch} />
{/if}
