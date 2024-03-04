<script lang="ts">
    export let inputType: 'text' | 'number' = 'text';
    export let placeholder: string = '';
    export let styles: string = '';
    export let changeFunc: (value: string | number) => void;
    export let focusFunc = () => {};
    export let blurFunc = () => {};
    export let value: string | number = '';
</script>

{#if inputType === 'text'}
    <input
        class="!{styles}"
        type="text"
        spellcheck="false"
        {placeholder}
        on:focus={focusFunc}
        on:blur={blurFunc}
        bind:value
        on:change={() => changeFunc(value)}
    />
{:else if inputType === 'number'}
    <input type="number" spellcheck="false" {placeholder} bind:value on:blur={blurFunc} on:focus={() => focusFunc} on:change={() => changeFunc(value)} />
{/if}
