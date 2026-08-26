<script lang="ts">
import ManagedEntitySection from "../../components/settings/ManagedEntitySection.svelte";
import { PrivacyListModal } from "../../components/modal/PrivacyListModal";
import ProviderItem from "../../components/settings/ProviderItem.svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";
import { ProviderSetupModal } from "../provider-setup/ProviderSetup";

const pluginData = getData();
const plugin = getPlugin();

const privacyListModal = new PrivacyListModal(plugin.app);

// Provider management state
let configuredProviderIds = $derived(pluginData.getConfiguredProviders());

function handleOpenProviderSetup() {
	new ProviderSetupModal(plugin, {}).open();
}
</script>

<!-- Providers -->
<ManagedEntitySection
  heading="Providers"
  description="Providers connect Smart Second Brain to the AI services used for chat, embeddings, and other model-powered features."
  emptyMessage="No provider instances configured yet."
  hasItems={configuredProviderIds.length > 0}
>
  {#snippet actions()}
    <Button buttonText="Add provider" cta={true} onClick={handleOpenProviderSetup} />
  {/snippet}

  {#if configuredProviderIds.length > 0}
    {#each configuredProviderIds as provider (provider)}
      <ProviderItem {provider} />
    {/each}
  {/if}
</ManagedEntitySection>

<!-- Privacy -->
<SettingGroup heading="Privacy">
  <SettingItem
    name="Note access policy"
    class="privacy-setting-item"
    desc="Choose whether untrusted providers see nothing or everything by default, then manage the matching file list."
  >
    {#snippet nameSuffix()}
      <span
        class="privacy-trust-icon privacy-trust-icon--label"
        use:icon={"shield"}
        aria-hidden="true"
      ></span>
    {/snippet}

    <Button onClick={() => privacyListModal.open()} buttonText="Manage" />
  </SettingItem>
</SettingGroup>

<style>
  .privacy-trust-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--text-accent);
    flex-shrink: 0;
  }

  .privacy-trust-icon--label {
    width: 14px;
    height: 14px;
  }
</style>
