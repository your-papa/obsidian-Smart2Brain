<script lang="ts">
    interface Props {
        name: string;
        isHeading?: boolean;
        class?: string;
        desc?: string;
        isDisabled?: boolean;
        children?: import("svelte").Snippet;
    }

    let {
        name,
        isHeading = false,
        desc = "",
        isDisabled = false,
        children,
        class: className = "",
    }: Props = $props();
</script>

<div
    class="setting-item {isHeading ? 'setting-item-heading' : ''} {isDisabled
        ? 'opacity-50 pointer-events-none'
        : ''} {className}"
>
    <div class="setting-item-info">
        <div class="setting-item-name">{name}</div>
        <div class="setting-item-description">{desc}</div>
    </div>
    <div class="setting-item-control">
        {@render children?.()}
    </div>
</div>
