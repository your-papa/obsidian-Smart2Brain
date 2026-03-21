<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	name: string;
	desc?: string;
	meta?: string;
	selected?: boolean;
	disabled?: boolean;
	clickable?: boolean;
	class?: string;
	onclick?: (event: MouseEvent) => void;
	leading?: Snippet;
	badges?: Snippet;
	children?: Snippet;
	actions?: Snippet;
}

let {
	name,
	desc,
	meta,
	selected = false,
	disabled = false,
	clickable = false,
	class: className = "",
	onclick,
	leading,
	badges,
	children,
	actions,
}: Props = $props();

function handleClick(event: MouseEvent) {
	if (disabled || !clickable) {
		return;
	}
	onclick?.(event);
}

function handleKeyDown(event: KeyboardEvent) {
	if (!clickable || disabled) {
		return;
	}
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		onclick?.(event as unknown as MouseEvent);
	}
}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="setting-item managed-entity-item {className}"
  class:selected
  class:disabled
  class:clickable
  role={clickable ? "button" : undefined}
  tabindex={clickable && !disabled ? 0 : undefined}
  onclick={handleClick}
  onkeydown={handleKeyDown}
>
  <div class="setting-item-info managed-entity-item-main">
    {#if leading}
      <div class="managed-entity-item-leading">
        {@render leading()}
      </div>
    {/if}

    <div class="managed-entity-item-body">
      <div class="managed-entity-item-header">
        <span class="managed-entity-item-name">{name}</span>
        {#if badges}
          <div class="managed-entity-item-badges">
            {@render badges()}
          </div>
        {/if}
      </div>

      {#if desc}
        <div class="managed-entity-item-desc">{desc}</div>
      {/if}

      {#if meta}
        <div class="managed-entity-item-meta">{meta}</div>
      {/if}

      {#if children}
        <div class="managed-entity-item-extra">
          {@render children()}
        </div>
      {/if}
    </div>
  </div>

  {#if actions}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="setting-item-control managed-entity-item-actions"
      onclick={(event) => event.stopPropagation()}
    >
      {@render actions()}
    </div>
  {/if}
</div>

<style>
  .managed-entity-item {
    gap: 12px;
  }

  .managed-entity-item.clickable {
    cursor: pointer;
  }

  .managed-entity-item.clickable:hover {
    background: var(--background-modifier-hover);
  }

  .managed-entity-item.disabled {
    opacity: 0.65;
  }

  .managed-entity-item-main {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }

  .managed-entity-item-leading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    padding-top: 2px;
  }

  .managed-entity-item-body {
    flex: 1;
    min-width: 0;
  }

  .managed-entity-item-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .managed-entity-item-name {
    font-weight: 500;
  }

  .managed-entity-item-badges {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .managed-entity-item-desc,
  .managed-entity-item-meta {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .managed-entity-item-extra {
    margin-top: 8px;
  }

  .managed-entity-item-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
</style>
