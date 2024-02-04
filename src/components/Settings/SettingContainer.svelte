<script lang="ts">
    export let settingName: string;
    export let isHeading: boolean = false;
    export let settingDesc: string = '';
</script>

<div class="setting-item {isHeading ? 'setting-item-heading' : ''}">
    <div class="setting-item-info">
        <div class="setting-item-name">{settingName}</div>
        <div class="setting-item-description">{settingDesc}</div>
    </div>
    <div class="setting-item-control">
        <slot />
    </div>
</div>
