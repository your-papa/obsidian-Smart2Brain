<script lang="ts">
    export let inputType: 'text' | 'number' = 'text';
    export let settingName: string;
    export let settingDesc: string = '';
    export let placeholder: string = '';
    export let changeFunc: (inputValue: string) => void;

    export let inputValue: string | number = '';
</script>

<div class="setting-item">
    <div class="setting-item-info">
        <div class="setting-item-name">{settingName}</div>
        <div class="setting-item-description">{settingDesc}</div>
    </div>
    <div class="setting-item-control">
        <slot />
        {#if inputType === 'text'}
            <input type="text" spellcheck="false" {placeholder} bind:value={inputValue} on:input={() => changeFunc(inputValue)} />
        {:else if inputType === 'number'}
            <input type="number" spellcheck="false" {placeholder} bind:value={inputValue} on:change={() => changeFunc(inputValue)} />
        {/if}
    </div>
</div>
