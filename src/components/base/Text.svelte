<script lang="ts">
    export let inputType: 'text' | 'number' = 'text';
    export let placeholder: string = '';
    export let styles: string = '';
    export let changeFunc: (inputValue: string | number) => void;
    export let focusFunc = () => {};
    export let blurFunc = () => {};
    let inputValue: string | number = '';

    let inputElem: HTMLInputElement;
    export function setInputValue(value: string | number) {
        inputValue = value;
    }
</script>

{#if inputType === 'text'}
    <input
        bind:this={inputElem}
        class="!{styles}"
        type="text"
        spellcheck="false"
        {placeholder}
        on:focus={focusFunc}
        on:blur={blurFunc}
        bind:value={inputValue}
        on:change={() => changeFunc(inputValue)}
    />
{:else if inputType === 'number'}
    <input
        type="number"
        spellcheck="false"
        {placeholder}
        bind:value={inputValue}
        on:blur={blurFunc}
        on:focus={() => focusFunc}
        on:change={() => changeFunc(inputValue)}
    />
{/if}
