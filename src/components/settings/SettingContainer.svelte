<script lang="ts">
interface Props {
	name: string;
	isHeading?: boolean;
	class?: string;
	desc?: string;
	isDisabled?: boolean;
	/** When true, hides the description text and shows it as a tooltip on the name instead. */
	compact?: boolean;
	children?: import("svelte").Snippet;
}

let {
	name,
	isHeading = false,
	desc = "",
	isDisabled = false,
	compact = false,
	children,
	class: className = "",
}: Props = $props();
</script>

<div
    class="setting-item {isHeading ? 'setting-item-heading' : ''} {isDisabled
        ? 'opacity-50 pointer-events-none'
        : ''} {compact ? 'setting-item--compact' : ''} {className}"
>
    <div class="setting-item-info">
        <div class="setting-item-name" title={compact && desc ? desc : ""}>{name}</div>
        {#if !compact}
            <div class="setting-item-description">{desc}</div>
        {/if}
    </div>
    <div class="setting-item-control">
        {@render children?.()}
    </div>
</div>

<style>
    .setting-item--compact {
        padding-top: 4px;
        padding-bottom: 4px;
    }
    .setting-item--compact .setting-item-name {
        cursor: help;
    }
</style>
