<script lang="ts">
import type { Snippet } from "svelte";
import SettingGroup from "./SettingGroup.svelte";

interface Props {
	heading: string;
	headingDesc?: string;
	description?: string;
	emptyMessage?: string;
	hasItems?: boolean;
	actionsLayout?: "control" | "full-width";
	actions?: Snippet;
	children?: Snippet;
	class?: string;
}

let {
	heading,
	headingDesc,
	description,
	emptyMessage,
	hasItems,
	actionsLayout = "control",
	actions,
	children,
	class: className = "",
}: Props = $props();

const shouldRenderChildren = $derived(hasItems ?? !!children);
</script>

<SettingGroup {heading} {headingDesc} class={className}>
  {#if actionsLayout === "control" && (description || actions)}
    <div class="setting-item managed-entity-section-header">
      <div class="setting-item-info managed-entity-section-header-info">
        {#if description}
          <div class="managed-entity-section-description setting-item-description">
            {description}
          </div>
        {/if}
      </div>

      {#if actions}
        <div class="setting-item-control managed-entity-section-actions">
          {@render actions()}
        </div>
      {/if}
    </div>
  {:else}
    {#if description}
      <div class="setting-item managed-entity-section-description-row">
        <div class="setting-item-info">
          <div class="managed-entity-section-description setting-item-description">
            {description}
          </div>
        </div>
      </div>
    {/if}

    {#if actions}
      <div class="setting-item managed-entity-section-actions-row">
        <div class="managed-entity-section-actions managed-entity-section-actions--full">
          {@render actions()}
        </div>
      </div>
    {/if}
  {/if}

  {#if shouldRenderChildren && children}
    <div class="managed-entity-section-list">
      {@render children()}
    </div>
  {:else if emptyMessage}
    <div class="managed-entity-section-empty setting-item-description">{emptyMessage}</div>
  {/if}
</SettingGroup>

<style>
  .managed-entity-section-description {
    margin: 0;
  }

  .managed-entity-section-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .managed-entity-section-header-info {
    flex: 1 1 auto;
    min-width: 0;
  }

  .managed-entity-section-actions--full {
    width: 100%;
  }

  .managed-entity-section-list {
    display: flex;
    flex-direction: column;
    padding: 4px 6px;
  }

  .managed-entity-section-list :global(.managed-entity-item) {
    border: 0 !important;
    box-shadow: none;
  }

  .managed-entity-section-list :global(.managed-entity-item:not(:last-child))::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -2px;
    height: 1px;
    background: var(--background-modifier-border);
    pointer-events: none;
  }

  .managed-entity-section-list :global(.managed-entity-item.clickable:hover)::after {
    opacity: 0;
  }

  .managed-entity-section-empty {
    margin: 0;
  }

  .managed-entity-section-description-row,
  .managed-entity-section-actions-row {
    display: block;
  }
</style>
