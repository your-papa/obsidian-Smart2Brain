<script lang="ts">
  import type { Snippet } from "svelte";

  type BadgeTone = "neutral" | "muted" | "accent" | "success" | "warning" | "error";

  interface Props {
    label?: string;
    tone?: BadgeTone;
    pill?: boolean;
    uppercase?: boolean;
    interactive?: boolean;
    class?: string;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
  }

  let {
    label,
    tone = "neutral",
    pill = true,
    uppercase = false,
    interactive = false,
    class: className = "",
    onclick,
    children,
  }: Props = $props();
</script>

{#if interactive}
  <button
    type="button"
    class={`badge tone-${tone} ${pill ? "pill" : "block"} ${uppercase ? "uppercase" : ""} ${className}`}
    {onclick}
  >
    {#if children}
      {@render children()}
    {/if}
    {#if label}
      <span>{label}</span>
    {/if}
  </button>
{:else}
  <span
    class={`badge tone-${tone} ${pill ? "pill" : "block"} ${uppercase ? "uppercase" : ""} ${className}`}
  >
    {#if children}
      {@render children()}
    {/if}
    {#if label}
      <span>{label}</span>
    {/if}
  </span>
{/if}

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 500;
    line-height: 1.2;
  }

  .badge.pill {
    border-radius: 999px;
  }

  .badge.block {
    border-radius: 4px;
  }

  .badge.uppercase {
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  button.badge {
    cursor: pointer;
  }

  button.badge:hover {
    filter: brightness(1.05);
  }

  .badge.tone-muted {
    background: var(--background-secondary);
    color: var(--text-muted);
  }

  .badge.tone-accent {
    background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
    color: var(--text-accent);
    border-color: var(--interactive-accent);
  }

  .badge.tone-success {
    background: color-mix(in srgb, var(--text-success, #4caf50) 14%, transparent);
    color: var(--text-success, #4caf50);
    border-color: var(--text-success, #4caf50);
  }

  .badge.tone-warning {
    background: color-mix(in srgb, var(--text-warning, #ffc107) 14%, transparent);
    color: var(--text-warning, #ffc107);
    border-color: var(--text-warning, #ffc107);
  }

  .badge.tone-error {
    background: color-mix(in srgb, var(--text-error, #f44336) 14%, transparent);
    color: var(--text-error, #f44336);
    border-color: var(--text-error, #f44336);
  }
</style>
