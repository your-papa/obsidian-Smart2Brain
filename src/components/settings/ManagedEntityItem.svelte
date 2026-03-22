<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	name: string;
	desc?: string;
	meta?: string;
	selected?: boolean;
	disabled?: boolean;
	clickable?: boolean;
	interactiveRole?: "button" | "radio";
	class?: string;
	onclick?: (event: MouseEvent) => void;
	leading?: Snippet;
	badges?: Snippet;
	children?: Snippet;
	trailing?: Snippet;
	actions?: Snippet;
}

let {
	name,
	desc,
	meta,
	selected = false,
	disabled = false,
	clickable = false,
	interactiveRole = "button",
	class: className = "",
	onclick,
	leading,
	badges,
	children,
	trailing,
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
  role={clickable ? interactiveRole : undefined}
  aria-checked={clickable && interactiveRole === "radio" ? selected : undefined}
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

  {#if trailing}
    <div class="managed-entity-item-trailing">
      {@render trailing()}
    </div>
  {/if}
</div>

<style>
  .managed-entity-item {
    position: relative;
    gap: 12px;
    padding: 6px 8px;
    border-radius: 14px;
  }

  .managed-entity-item::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 12px;
    background: var(--background-modifier-hover);
    opacity: 0;
    pointer-events: none;
    transition: opacity 140ms ease;
  }

  .managed-entity-item.clickable {
    cursor: pointer;
  }

  .managed-entity-item.clickable:hover::before {
    opacity: 1;
  }

  .managed-entity-item.clickable:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--interactive-accent) 60%, transparent);
    outline-offset: 2px;
  }

  .managed-entity-item.disabled {
    opacity: 0.65;
  }

  .managed-entity-item-main {
    position: relative;
    z-index: 1;
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

  .managed-entity-item-trailing {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    min-width: 16px;
  }

  .managed-entity-item-actions {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
</style>
