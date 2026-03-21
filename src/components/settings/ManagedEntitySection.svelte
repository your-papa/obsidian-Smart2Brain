<script lang="ts">
  import type { Snippet } from "svelte";
  import SettingGroup from "./SettingGroup.svelte";

  interface Props {
    heading: string;
    headingDesc?: string;
    description?: string;
    emptyMessage?: string;
    actions?: Snippet;
    children?: Snippet;
    class?: string;
  }

  let {
    heading,
    headingDesc,
    description,
    emptyMessage,
    actions,
    children,
    class: className = "",
  }: Props = $props();
</script>

<SettingGroup {heading} {headingDesc} class={className}>
  {#if description}
    <div class="managed-entity-section-description setting-item-description">{description}</div>
  {/if}

  {#if actions}
    <div class="managed-entity-section-actions">
      {@render actions()}
    </div>
  {/if}

  {#if children}
    <div class="managed-entity-section-list">
      {@render children()}
    </div>
  {:else if emptyMessage}
    <div class="managed-entity-section-empty setting-item-description">{emptyMessage}</div>
  {/if}
</SettingGroup>

<style>
  .managed-entity-section-description {
    padding: 0 16px 12px;
  }

  .managed-entity-section-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 16px 12px;
  }

  .managed-entity-section-list {
    display: flex;
    flex-direction: column;
  }

  .managed-entity-section-empty {
    padding: 0 16px 12px;
  }
</style>
