<script lang="ts">
import type { Component } from "svelte";
import Button from "../ui/Button.svelte";
import IconButton from "../ui/IconButton.svelte";

interface Props {
	available?: boolean;
	loading?: boolean;
	configureLabel?: string;
	onConfigure?: () => void;
	placeholder: string;
	selectedLabel?: string | null;
	selectedLogo?: Component<{ width?: number; height?: number }> | null;
	onSelect: () => void;
	secondaryLabel?: string;
	onSecondary?: () => void;
}

let {
	available = true,
	loading = false,
	configureLabel,
	onConfigure,
	placeholder,
	selectedLabel = null,
	selectedLogo = null,
	onSelect,
	secondaryLabel,
	onSecondary,
}: Props = $props();
</script>

{#if loading}
  <span class="text-[--text-muted] text-sm">Loading models…</span>
{:else if !available && configureLabel && onConfigure}
  <IconButton icon="settings" label={configureLabel} onclick={() => onConfigure()} />
{:else}
  <div class="model-setting-control">
    <Button onClick={onSelect}>
      {#if selectedLabel}
        <div class="model-setting-button-content">
          {#if selectedLogo}
            {@const Logo = selectedLogo}
            <Logo width={14} height={14} />
          {/if}
          <span>{selectedLabel}</span>
        </div>
      {:else}
        <span class="text-[--text-muted]">{placeholder}</span>
      {/if}
    </Button>

    {#if secondaryLabel && onSecondary}
      <Button buttonText={secondaryLabel} onClick={onSecondary} />
    {/if}
  </div>
{/if}

<style>
  .model-setting-control {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
    width: 100%;
  }

  .model-setting-button-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
