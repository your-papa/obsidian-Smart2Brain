<script lang="ts">
import type { Snippet } from "svelte";

/**
 * A vertically-stacked form field for configuration modals: label on top,
 * optional description below it, then a full-width control. Complements the
 * horizontal `SettingContainer` (name/desc left, control right) used for
 * settings rows — this variant suits textareas, editors, and long inputs that
 * need the full modal width. `for` wires the label to a control by id.
 */
interface Props {
	label: string;
	desc?: string;
	for?: string;
	/** Render label + control on a single row (for short controls like toggles). */
	inline?: boolean;
	class?: string;
	children?: Snippet;
	hint?: Snippet;
}

let { label, desc, for: forId, inline = false, class: className = "", children, hint }: Props = $props();
</script>

<div class="modal-field {inline ? 'modal-field--inline' : ''} {className}">
  <div class="modal-field-info">
    {#if forId}
      <label class="modal-field-label" for={forId}>{label}</label>
    {:else}
      <div class="modal-field-label">{label}</div>
    {/if}
    {#if desc}
      <p class="modal-field-desc">{desc}</p>
    {/if}
  </div>
  <div class="modal-field-control">
    {@render children?.()}
  </div>
  {#if hint}
    <div class="modal-field-hint">{@render hint()}</div>
  {/if}
</div>

<style>
  .modal-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .modal-field--inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .modal-field--inline .modal-field-info {
    flex: 1 1 auto;
    min-width: 0;
  }

  .modal-field--inline .modal-field-control {
    flex-shrink: 0;
  }

  .modal-field-label {
    font-weight: 500;
    font-size: 0.95rem;
    color: var(--text-normal);
  }

  .modal-field-desc {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .modal-field-hint {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
</style>
