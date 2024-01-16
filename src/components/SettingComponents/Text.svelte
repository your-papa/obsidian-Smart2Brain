<script lang="ts">
    export let settingName: string;
    export let settingDesc:string =  "";
    export let placeholder: string = "";
    export let changeFunc: (inputValue: string) => void;

    let inputValue: string = "";

</script>

<div class="setting-item">
    <div class="setting-item-info">
        <div class="setting-item-name">{settingName}</div>
        <div class="setting-item-description">{settingDesc}</div>
    </div>
    <div class="setting-item-control">
        <slot></slot>
        <input type="text" spellcheck="false" placeholder={placeholder} bind:value={inputValue} on:change={() => changeFunc(inputValue)}>
    </div>
</div>