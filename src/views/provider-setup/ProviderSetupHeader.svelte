<script lang="ts">
import CircularLoader from "../../components/ui/CircularLoader.svelte";
import { createAuthStateQuery } from "../../lib/query";
import { getData } from "../../stores/dataStore.svelte";
import { icon } from "../../utils/utils";

interface Props {
	provider: string;
	// Gate the status icon so it stays hidden on an untouched form (mirrors the modal's
	// hasCredentials logic). When false, only the trust icon (if trusted) can show.
	showStatus: boolean;
}

const { provider, showStatus }: Props = $props();

const data = getData();
const query = createAuthStateQuery(() => provider);
const isChecking = $derived(query.isPending || query.isFetching);
const isTrusted = $derived(data.isProviderTrusted(provider));
const failureMessage = $derived(query.data && !query.data.success ? query.data.message : "Authentication failed");
</script>

<span class="provider-status-group">
  {#if showStatus}
    {#if isChecking}
      <span class="provider-status-indicator" title="Checking connection" aria-label="Checking connection">
        <CircularLoader size={18} color="var(--text-muted)" />
      </span>
    {:else if query.data?.success}
      <span
        class="provider-status-indicator provider-icon-indicator-success"
        title="Connected"
        aria-label="Connected"
      >
        <span class="provider-status-icon" use:icon={"check-circle"}></span>
      </span>
    {:else if query.data !== undefined}
      <span
        class="provider-status-indicator provider-icon-indicator-error"
        title={failureMessage}
        aria-label={failureMessage}
      >
        <span class="provider-status-icon" use:icon={"x-circle"}></span>
      </span>
    {/if}
  {/if}

  {#if isTrusted}
    <span
      class="provider-icon-indicator provider-icon-indicator-accent"
      title="Trusted with private notes"
      aria-label="Trusted with private notes"
    >
      <span class="provider-status-icon" use:icon={"shield"}></span>
    </span>
  {/if}
</span>

<style>
  .provider-status-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .provider-status-indicator,
  .provider-icon-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    min-width: 20px;
    min-height: 20px;
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

  .provider-status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  /* Scale the injected Lucide SVG to fill the (now larger) icon box. */
  .provider-status-icon :global(svg) {
    width: 20px;
    height: 20px;
  }
</style>
