<script lang="ts">
import ManagedEntitySection from "../../components/settings/ManagedEntitySection.svelte";
import { PrivacyListModal } from "../../components/modal/PrivacyListModal";
import ProviderItem from "../../components/settings/ProviderItem.svelte";
import SecretSelect from "../../components/settings/SecretSelect.svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
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
	new ProviderSetupModal(plugin, { templateId: "openai-compatible" }).open();
}

// ─── Web Search ──────────────────────────────────────────
const webSearchProviderOptions = [
	{ display: "None", value: "" },
	{ display: "Brave Search", value: "brave" },
	{ display: "Tavily", value: "tavily" },
];
</script>

<!-- Providers -->
<ManagedEntitySection
  heading="Providers"
  description="Providers connect Smart Second Brain to the AI services used for chat, embeddings, and other model-powered features."
  emptyMessage="No provider instances configured yet."
  hasItems={configuredProviderIds.length > 0}
>
  {#snippet actions()}
    <div class="flex items-center justify-end w-full">
      <Button buttonText="Add Provider" cta={true} onClick={handleOpenProviderSetup} />
    </div>
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

<!-- Web Search -->
<SettingGroup heading="Web Search">
  <SettingItem
    name="Provider"
    desc="Search provider used by the web_search agent tool. Enable the tool per-agent in Agent settings."
  >
    <Dropdown
      type="options"
      dropdown={webSearchProviderOptions}
      selected={pluginData.webSearchProvider}
      onchange={(val) => (pluginData.webSearchProvider = val)}
    />
  </SettingItem>

  {#if pluginData.webSearchProvider}
    <SettingItem
      name="API Key"
      desc={pluginData.webSearchProvider === "brave"
        ? "Brave Search API key from api.search.brave.com"
        : "Tavily API key from app.tavily.com"}
    >
      <SecretSelect
        value={pluginData.webSearchApiKeyId}
        onChange={(secretId) => (pluginData.webSearchApiKeyId = secretId)}
      />
    </SettingItem>
  {/if}
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
