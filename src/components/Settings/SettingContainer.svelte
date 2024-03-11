<script lang="ts">
    export let name: string;
    export let isHeading: boolean = false;
    export let desc: string = '';
</script>

<div class="setting-item {isHeading ? 'setting-item-heading' : ''}">
    <div class="setting-item-info">
        <div class="setting-item-name">{name}</div>
        <div class="setting-item-description">{desc}</div>
    </div>
    <div class="setting-item-control">
        <slot />
    </div>
</div>
