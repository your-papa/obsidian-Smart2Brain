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
	/**
	 * Force the description to render inline even in `compact` rows. Use this when
	 * the description is a *computed result* rather than static help — a value the
	 * user is meant to read is not something to hide behind a hover.
	 */
	showDesc?: boolean;
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
	showDesc = false,
	children,
	class: className = "",
}: Props = $props();

const isRowDisabled = $derived(disabled || isDisabled);
</script>

<div
  class="setting-item {isHeading ? 'setting-item-heading' : ''} {isRowDisabled
    ? 'opacity-50 pointer-events-none'
    : ''} {compact ? 'setting-item--compact' : ''} {compact && showDesc
    ? 'setting-item--show-desc'
    : ''} {className}"
>
  <div class="setting-item-info">
    <div class="setting-item-name" aria-label={compact && desc && !showDesc ? desc : undefined}>
      {#if namePrefix}
        <span class="setting-item-name-prefix">{@render namePrefix()}</span>
      {/if}
      <span>{name}</span>
      {#if nameSuffix}
        <span class="setting-item-name-suffix">{@render nameSuffix()}</span>
      {/if}
    </div>
    <!-- Normal rows keep the description stacked under the name, as Obsidian does. -->
    {#if !compact && desc}
      <div class="setting-item-description">{desc}</div>
    {/if}
  </div>
  <div class="setting-item-control">
    {@render children?.()}
  </div>
  <!-- Compact rows are too narrow for name + description + control on one line,
       so the description wraps onto its own line as a sibling of both. -->
  {#if compact && showDesc && desc}
    <div class="setting-item-description">{desc}</div>
  {/if}
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

  /* Only hint at a tooltip when there actually is one — a row showing its
     description inline has nothing hidden to reveal. */
  .setting-item--compact:not(.setting-item--show-desc) .setting-item-name {
    cursor: help;
  }

  /* A compact row is narrow: name, description and control cannot share one line
     without the name wrapping to a hard-to-read column. Drop the description onto
     its own full-width line beneath the name/control row instead. */
  .setting-item--show-desc {
    flex-wrap: wrap;
  }

  .setting-item--show-desc .setting-item-description {
    flex-basis: 100%;
    font-size: var(--font-ui-smaller);
    line-height: 1.35;
    margin-top: 4px;
    white-space: normal;
    text-wrap: pretty;
  }
</style>
