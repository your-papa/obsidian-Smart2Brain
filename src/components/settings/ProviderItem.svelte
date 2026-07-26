<script lang="ts">
import { Notice } from "obsidian";
import type { Component } from "svelte";
import { createProviderStateQuery, invalidateProviderState } from "../../lib/query";
import { type LogoProps, getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import ManagedEntityItem from "./ManagedEntityItem.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
import CircularLoader from "../ui/CircularLoader.svelte";
import Button from "../ui/Button.svelte";
import { icon } from "../../utils/utils";
import { ProviderSetupModal } from "../../views/provider-setup/ProviderSetup";
import { confirmDelete } from "../modal/ConfirmModal";

interface Props {
	provider: string;
}

const { provider }: Props = $props();

const data = getData();
const plugin = getPlugin();
let providerDefinition = $derived(getProviderDefinition(provider, data.getAllProviderMeta()));

const query = createProviderStateQuery(() => provider);
let isCheckingAuth = $derived(query.isPending || query.isFetching);
let displayName = $derived(providerDefinition?.displayName ?? provider);
let isTrusted = $derived(data.isProviderTrusted(provider));
let authFailureMessage = $derived(
	query.data && !query.data.auth.success ? query.data.auth.message : "Authentication failed",
);
let Logo: Component<LogoProps> = $derived.by(() => {
	if (providerDefinition?.logo) {
		return providerDefinition.logo;
	}
	return GenericAIIcon;
});

function refetch() {
	invalidateProviderState(provider);
}

function handleOpenSettings() {
	new ProviderSetupModal(plugin, provider).open();
}

async function handleRemoveProvider() {
	if (!(await confirmDelete(plugin.app, displayName))) return;
	try {
		await data.deleteProvider(provider);
		invalidateProviderState(provider);
	} catch (error) {
		new Notice(error instanceof Error ? error.message : "Failed to remove provider");
	}
}
</script>

<ManagedEntityItem name={displayName}>
  {#snippet leading()}
    <Logo width={16} height={16} />
  {/snippet}

  {#snippet badges()}
    <div class="provider-status-group">
      {#if isCheckingAuth}
        <button
          type="button"
          class="provider-icon-button provider-status-indicator"
          title="Checking auth"
          aria-label="Checking auth"
          disabled
        >
          <CircularLoader size={12} color="var(--text-muted)" />
        </button>
      {:else if query.data?.auth.success}
        <button
          type="button"
          class="provider-icon-button provider-status-indicator provider-icon-indicator-success"
          title="Authenticated. Click to retry connection"
          aria-label="Authenticated. Click to retry connection"
          onclick={refetch}
        >
          <span class="provider-status-icon" use:icon={"check-circle"}></span>
        </button>
      {:else}
        <button
          type="button"
          class="provider-icon-button provider-status-indicator provider-icon-indicator-error"
          title={`${authFailureMessage}. Click to retry connection`}
          aria-label={`${authFailureMessage}. Click to retry connection`}
          onclick={refetch}
        >
          <span class="provider-status-icon" use:icon={"x-circle"}></span>
        </button>
      {/if}

      {#if isTrusted}
        <span
          class="provider-trust-tooltip"
          title="Trusted with private notes"
          aria-label="Trusted with private notes"
        >
          <span class="provider-icon-indicator provider-icon-indicator-accent">
            <span class="provider-trust-icon" use:icon={"shield"}></span>
          </span>
        </span>
      {/if}
    </div>
  {/snippet}

  {#snippet actions()}
    <Button
      iconId="settings"
      ariaLabel="Configure provider"
      tooltip="Configure provider"
      onClick={handleOpenSettings}
    />
    <Button
      iconId="trash"
      ariaLabel="Remove provider"
      tooltip="Remove provider"
      onClick={() => void handleRemoveProvider()}
    />
  {/snippet}
</ManagedEntityItem>

<style>
  .provider-status-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .provider-trust-tooltip {
    display: inline-flex;
  }

  .provider-status-indicator,
  .provider-icon-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    min-width: 16px;
    min-height: 16px;
  }

  .provider-icon-indicator-error {
    color: var(--text-error);
  }

  .provider-icon-indicator-accent {
    color: var(--text-accent);
  }

  .provider-icon-indicator-success {
    color: var(--text-success, #4caf50);
  }

  .provider-icon-button {
    padding: 0;
    margin: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    cursor: pointer;
    /* Size the button to its icon — the theme's default button height (30px) would
       otherwise inflate the header row and push the leading logo off-center. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 16px;
    line-height: 1;
  }

  .provider-icon-button:disabled {
    cursor: default;
  }

  .provider-icon-button:not(:disabled):hover {
    filter: brightness(1.05);
  }

  .provider-trust-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
  }

  .provider-status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
</style>
