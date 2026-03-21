<script lang="ts">
  import { Notice } from "obsidian";
  import type { Component } from "svelte";
  import { createProviderStateQuery, invalidateProviderState } from "../../lib/query";
  import { type LogoProps, getProviderDefinition } from "../../providers/index";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import ManagedEntityItem from "./ManagedEntityItem.svelte";
  import Badge from "../ui/Badge.svelte";
  import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
  import CircularLoader from "../ui/CircularLoader.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import { icon } from "../../utils/utils";
  import { ProviderSetupModal } from "../../views/provider-setup/ProviderSetup";

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
    try {
      await data.deleteProvider(provider);
      invalidateProviderState(provider);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to remove provider");
    }
  }
</script>

<ManagedEntityItem name={displayName} desc="Provider authentication and model configuration">
  {#snippet leading()}
    <Logo width={16} height={16} />
  {/snippet}

  {#snippet badges()}
    {#if isCheckingAuth}
      <Badge>
        <CircularLoader size={12} color="var(--text-muted)" />
        <span>Checking auth</span>
      </Badge>
    {/if}

    {#if isTrusted}
      <span
        class="provider-trust-tooltip"
        title="Trusted for private data"
        aria-label="Trusted for private data"
      >
        <span class="provider-icon-indicator provider-icon-indicator-accent">
          <span class="provider-trust-icon" use:icon={"shield"}></span>
        </span>
      </span>
    {/if}

    {#if !isCheckingAuth}
      {#if query.data?.auth.success}
        <button
          type="button"
          class="provider-icon-button provider-icon-indicator provider-icon-indicator-success"
          onclick={refetch}
          title="Authenticated"
          aria-label="Authenticated"
        >
          <span class="provider-status-icon" use:icon={"check-circle"}></span>
        </button>
      {:else}
        <Badge tone="error" interactive onclick={refetch}>
          <span class="provider-status-icon" use:icon={"x-circle"}></span>
          <span>{authFailureMessage}</span>
        </Badge>
      {/if}
    {/if}
  {/snippet}

  {#snippet actions()}
    <IconButton icon="settings" label="Configure provider" onclick={handleOpenSettings} />
    <IconButton icon="trash" label="Remove provider" onclick={() => void handleRemoveProvider()} />
  {/snippet}
</ManagedEntityItem>

<style>
  .provider-trust-tooltip {
    display: inline-flex;
  }

  .provider-icon-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    min-width: 16px;
    min-height: 16px;
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
    cursor: pointer;
    box-shadow: none;
  }

  .provider-icon-button:hover {
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
