<script lang="ts">
  import { t } from "svelte-i18n";
  import ManagedEntitySection from "../../components/settings/ManagedEntitySection.svelte";
  import { PrivacyListModal } from "../../components/modal/PrivacyListModal";
  import ProviderItem from "../../components/settings/ProviderItem.svelte";
  import SettingGroup from "../../components/settings/SettingGroup.svelte";
  import SettingItem from "../../components/settings/SettingItem.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Text from "../../components/ui/Text.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { icon } from "../../utils/utils";
  import { Logger } from "../../utils/logging";
  import { ProviderSetupModal } from "../provider-setup/ProviderSetup";

  const pluginData = getData();
  const plugin = getPlugin();

  const privacyListModal = new PrivacyListModal(plugin.app);

  // Provider management state
  let configuredProviderIds = $derived(pluginData.getConfiguredProviders());

  function handleOpenProviderSetup() {
    new ProviderSetupModal(plugin, { templateId: "openai-compatible" }).open();
  }
</script>

<!-- Providers -->
<ManagedEntitySection
  heading="Providers"
  description="Providers connect Smart Second Brain to the AI services used for chat, embeddings, and other model-powered features."
  emptyMessage="No provider instances configured yet."
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

<!-- Data Management -->
<SettingGroup heading="Data Management">
  <SettingItem name={$t("settings.clear")} desc={$t("settings.clear_desc")}>
    <Button
      buttonText={$t("settings.clear_label")}
      styles="mod-warning"
      onClick={() => {
        Logger.log("Delete Plugin Data");
      }}
    />
  </SettingItem>
</SettingGroup>

<!-- Privacy -->
<SettingGroup heading="Privacy">
  <SettingItem
    name="Privacy List"
    class="privacy-setting-item"
    desc="Manage which files are considered private and blocked from non-trusted providers."
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

<!-- Observability -->
<SettingGroup heading="Debugging">
  <SettingItem
    name="LangSmith Integration"
    desc="Enable LangSmith telemetry for debugging and tracing"
  >
    <Toggle
      checked={pluginData.enableLangSmith}
      onchange={(checked) => (pluginData.enableLangSmith = checked)}
    />
  </SettingItem>

  {#if pluginData.enableLangSmith}
    <SettingItem name="API Key" desc="Private API key for LangSmith authentication">
      <Text
        placeholder="ls__1c...4b"
        inputType="secret"
        value={pluginData.langSmithApiKey}
        onblur={(v) => (pluginData.langSmithApiKey = v)}
      />
    </SettingItem>

    <SettingItem name="Project Name" desc="Project name to attribute runs">
      <Text
        placeholder="obsidian-agent"
        inputType="text"
        value={pluginData.langSmithProject}
        onblur={(v) => (pluginData.langSmithProject = v)}
      />
    </SettingItem>

    <SettingItem name="Endpoint URL" desc="Override LangSmith API base URL (optional)">
      <Text
        placeholder="https://api.smith.langchain.com"
        inputType="text"
        value={pluginData.langSmithEndpoint}
        onblur={(v) => (pluginData.langSmithEndpoint = v)}
      />
    </SettingItem>
  {/if}

  <SettingItem name={$t("settings.verbose")} desc={$t("settings.verbose_desc")}>
    <Toggle
      checked={pluginData.isVerbose}
      onchange={(checked) => (pluginData.isVerbose = checked)}
    />
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
