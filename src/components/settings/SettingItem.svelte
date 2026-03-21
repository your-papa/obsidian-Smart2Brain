<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    name: string;
    namePrefix?: Snippet;
    nameSuffix?: Snippet;
    desc?: string;
    disabled?: boolean;
    class?: string;
    children?: Snippet;
  }

  let {
    name,
    namePrefix,
    nameSuffix,
    desc,
    disabled = false,
    class: className = "",
    children,
  }: Props = $props();
</script>

<div
  class="setting-item {className}"
  class:opacity-50={disabled}
  class:pointer-events-none={disabled}
>
  <div class="setting-item-info">
    <div class="setting-item-name">
      {#if namePrefix}
        <span class="setting-item-name-prefix">{@render namePrefix()}</span>
      {/if}
      <span>{name}</span>
      {#if nameSuffix}
        <span class="setting-item-name-suffix">{@render nameSuffix()}</span>
      {/if}
    </div>
    {#if desc}
      <div class="setting-item-description">{desc}</div>
    {/if}
  </div>
  <div class="setting-item-control">
    {@render children?.()}
  </div>
</div>

<style>
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
</style>
