<script lang="ts">
interface Props {
	name: string;
	namePrefix?: import("svelte").Snippet;
	nameSuffix?: import("svelte").Snippet;
	isHeading?: boolean;
	class?: string;
	desc?: string;
	disabled?: boolean;
	isDisabled?: boolean;
	/** When true, hides the description text and shows it as a tooltip on the name instead. */
	compact?: boolean;
	children?: import("svelte").Snippet;
}

let {
	name,
	namePrefix,
	nameSuffix,
	isHeading = false,
	desc = "",
	disabled = false,
	isDisabled = false,
	compact = false,
	children,
	class: className = "",
}: Props = $props();

const isRowDisabled = $derived(disabled || isDisabled);
</script>

<div
  class="setting-item {isHeading ? 'setting-item-heading' : ''} {isRowDisabled
    ? 'opacity-50 pointer-events-none'
    : ''} {compact ? 'setting-item--compact' : ''} {className}"
>
  <div class="setting-item-info">
    <div class="setting-item-name" aria-label={compact && desc ? desc : undefined}>
      {#if namePrefix}
        <span class="setting-item-name-prefix">{@render namePrefix()}</span>
      {/if}
      <span>{name}</span>
      {#if nameSuffix}
        <span class="setting-item-name-suffix">{@render nameSuffix()}</span>
      {/if}
    </div>
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

  .setting-item-name {
    display: inline-flex;
    align-items: center;
    gap: 0;
    line-height: 1.4;
  }

  .setting-item-name-prefix {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: 6px;
    align-self: center;
  }

  .setting-item-name-suffix {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 6px;
    align-self: center;
  }

  .setting-item--compact .setting-item-name {
    cursor: help;
  }
</style>
