<script lang="ts">
import { Notice } from "obsidian";
import type { Component } from "svelte";
import { createProviderStateQuery, invalidateProviderState, removeProviderQueries } from "../../lib/query";
import { type LogoProps, getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import ManagedEntityItem from "./ManagedEntityItem.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
import CircularLoader from "../ui/CircularLoader.svelte";
import Button from "../ui/Button.svelte";
import { icon } from "../../utils/utils";
import { ProviderSetupModal } from "../../views/provider-setup/ProviderSetup";
import { confirmDelete, confirmDeleteWithOption } from "../modal/ConfirmModal";

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
	// Embeddings this provider built are expensive to recompute, so deleting them is a
	// separate, opt-in decision rather than a side effect of removing the provider —
	// re-adding the same provider and model later reuses the vectors as they are.
	// The checkbox only appears when there is actually something to delete.
	const ownedIndexes = data.embeddingIndexes.filter((index) => index.provider === provider);
	const indexedNotes = ownedIndexes.reduce((sum, index) => sum + (index.documentCount ?? 0), 0);

	if (ownedIndexes.length === 0) {
		if (!(await confirmDelete(plugin.app, displayName))) return;
		await removeProvider();
		return;
	}

	const { confirmed, checked } = await confirmDeleteWithOption(plugin.app, displayName, {
		label: "Also delete the embeddings built with this provider",
		description: `Frees the storage used by ${indexedNotes.toLocaleString()} indexed ${
			indexedNotes === 1 ? "note" : "notes"
		}. Leave this off to keep them — re-adding this provider reuses them instead of re-embedding, which can be slow and costly.`,
	});
	if (!confirmed) return;
	await removeProvider(checked);
}

async function removeProvider(purgeEmbeddings = false) {
	let orphanedIndexIds: string[];
	try {
		orphanedIndexIds = await data.deleteProvider(provider);
		// Drop cached auth/state entirely (not just invalidate) so re-adding a provider with
		// the same slug ID doesn't inherit this one's stale "connected" verdict from cache.
		removeProviderQueries(provider);
	} catch (error) {
		new Notice(error instanceof Error ? error.message : "Failed to remove provider");
		return;
	}

	if (!purgeEmbeddings) return;

	// Separate error scope: the provider IS removed by now, so a purge failure must not
	// report "Failed to remove provider". The vectors stay addressable by "provider:model"
	// id, so a failed purge is recoverable by re-adding the provider and deleting again.
	//
	// The vector store is only assigned at onLayoutReady, so it can genuinely be absent
	// (its type asserts non-null, but `onunload` guards it for the same reason). Deleting
	// embeddings is an explicit destructive choice the user opted into, so a missing
	// service must be reported rather than optional-chained away — silently completing
	// the dialog would leave every vector on disk with no sign anything was skipped.
	const vectorStore = plugin.vectorStoreService;
	if (!vectorStore) {
		new Notice("Provider removed. Its embeddings were kept — the index service is still starting up.");
		return;
	}

	try {
		for (const indexId of orphanedIndexIds) {
			await vectorStore.deleteIndex(indexId);
		}
	} catch (error) {
		new Notice(
			`Provider removed, but deleting its embeddings failed: ${error instanceof Error ? error.message : String(error)}`,
		);
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

  /* Touch: keep the icon visually 16px but grow the tap area to ~44px via
     padding, cancelled by negative margin so the header row layout is unchanged. */
  :global(.is-mobile) .provider-icon-button {
    padding: 14px;
    margin: -14px;
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
