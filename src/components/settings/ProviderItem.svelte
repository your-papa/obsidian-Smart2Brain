<script lang="ts">
  import { Notice } from "obsidian";
  import type { Component } from "svelte";
  import { createProviderStateQuery, invalidateProviderState } from "../../lib/query";
  import { type LogoProps, getProviderDefinition } from "../../providers/index";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import ManagedEntityItem from "./ManagedEntityItem.svelte";
  import Button from "../ui/Button.svelte";
  import Badge from "../ui/Badge.svelte";
  import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
  import CircularLoader from "../ui/CircularLoader.svelte";
  import IconButton from "../ui/IconButton.svelte";
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
    {:else if query.data?.auth.success}
      <Badge label="Authenticated" tone="success" interactive onclick={refetch} />
    {:else}
      <Badge label="Auth failed" tone="error" interactive onclick={refetch} />
    {/if}
  {/snippet}

  {#snippet actions()}
    <Button buttonText="Configure" onClick={handleOpenSettings} />
    <IconButton icon="trash" label="Remove provider" onclick={() => void handleRemoveProvider()} />
  {/snippet}
</ManagedEntityItem>
