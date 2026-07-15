<script lang="ts">
import type { Snippet } from "svelte";
import Icon from "./Icon.svelte";
import Toggle from "./Toggle.svelte";

interface Props {
	title: string;
	description?: string;
	icon?: string;
	summary?: string;
	masterEnabled?: boolean;
	onToggleMaster?: (next: boolean) => void;
	masterDisabled?: boolean;
	expandable?: boolean;
	defaultExpanded?: boolean;
	class?: string;
	badges?: Snippet;
	headerActions?: Snippet;
	body?: Snippet;
}

let {
	title,
	description,
	icon,
	summary,
	masterEnabled = false,
	onToggleMaster,
	masterDisabled = false,
	expandable = true,
	defaultExpanded = false,
	class: className = "",
	badges,
	headerActions,
	body,
}: Props = $props();

// defaultExpanded seeds the initial open state only; later changes to the prop are
// intentionally ignored (the user's expand/collapse takes over).
// svelte-ignore state_referenced_locally
let expanded = $state(defaultExpanded);
const canExpand = $derived(expandable && Boolean(body));

function toggleExpanded() {
	if (canExpand) expanded = !expanded;
}
</script>

<div class="capability-card {className}" class:expanded>
  <div class="capability-card-header" class:clickable={canExpand}>
    {#if canExpand}
      <button
        type="button"
        class="capability-card-chevron"
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
        onclick={toggleExpanded}
      >
        <Icon name={expanded ? "chevron-down" : "chevron-right"} size="s" />
      </button>
    {/if}

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="capability-card-main" onclick={toggleExpanded}>
      {#if icon}
        <span class="capability-card-icon"><Icon name={icon} size="s" /></span>
      {/if}
      <div class="capability-card-titles">
        <div class="capability-card-title-row">
          <span class="capability-card-title">{title}</span>
          {#if badges}
            <div class="capability-card-badges">{@render badges()}</div>
          {/if}
        </div>
        {#if description}
          <div class="capability-card-desc">{description}</div>
        {/if}
      </div>
    </div>

    {#if summary}
      <span class="capability-card-summary">{summary}</span>
    {/if}

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="capability-card-controls" onclick={(event) => event.stopPropagation()}>
      {#if headerActions}
        {@render headerActions()}
      {/if}
      {#if onToggleMaster}
        <Toggle
          checked={masterEnabled}
          disabled={masterDisabled}
          onchange={(v) => onToggleMaster?.(v)}
        />
      {/if}
    </div>
  </div>

  {#if canExpand && expanded && body}
    <div class="capability-card-body">{@render body()}</div>
  {/if}
</div>

<style>
  .capability-card {
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
    background: var(--background-primary);
    margin-bottom: 12px;
  }
  .capability-card:last-child {
    margin-bottom: 0;
  }

  .capability-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    min-width: 0;
  }

  .capability-card-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .capability-card-chevron:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .capability-card-main {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .capability-card-header.clickable .capability-card-main {
    cursor: pointer;
  }

  .capability-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .capability-card-titles {
    min-width: 0;
    flex: 1 1 auto;
  }

  .capability-card-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .capability-card-title {
    font-weight: 600;
  }

  .capability-card-badges {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .capability-card-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-top: 3px;
  }

  .capability-card-summary {
    flex-shrink: 0;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .capability-card-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .capability-card-body {
    padding: 4px 12px 12px;
    border-top: 1px solid var(--background-modifier-border);
  }

  /* Reflow the header on narrow modals so the summary + controls don't clip. */
  @container (max-width: 520px) {
    .capability-card-header {
      flex-wrap: wrap;
    }
    .capability-card-main {
      flex-basis: 100%;
    }
    .capability-card-summary {
      margin-left: auto;
    }
  }
</style>
